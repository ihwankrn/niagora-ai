import "server-only";

import { randomUUID } from "node:crypto";

import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";

import { getPaypalConfig } from "./client";

// PayPal Invoicing calls go through the official PayPal Agent Toolkit. The
// toolkit's own tool schemas are never handed to the model: the billing agent
// exposes narrower tools and this module fills in the arguments on the server,
// so amounts, recipients and invoice ids never come from the model.

export type InvoiceTool =
  | "create_invoice"
  | "get_invoice"
  | "send_invoice"
  | "send_invoice_reminder"
  | "cancel_sent_invoice"
  | "delete_invoice";

const INVOICE_ACTIONS = {
  invoices: { create: true, get: true, send: true, sendReminder: true, cancel: true, delete: true },
};

export class InvoicingError extends Error {
  constructor(
    readonly tool: InvoiceTool,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`PayPal ${tool} failed`);
    this.name = "InvoicingError";
  }
}

type Toolkit = Pick<PayPalAgentToolkit, "handleToolCall">;

let cached: { key: string; toolkit: Toolkit } | undefined;
let toolkitFactory: (clientId: string, clientSecret: string) => Toolkit = (clientId, clientSecret) =>
  new PayPalAgentToolkit({
    clientId,
    clientSecret,
    // getPaypalConfig() refuses anything but sandbox, and so does this context.
    configuration: { actions: INVOICE_ACTIONS, context: { sandbox: true } },
  });

function getToolkit(): Toolkit {
  const { clientId, clientSecret } = getPaypalConfig();
  const key = `${clientId}:${clientSecret}`;
  if (!cached || cached.key !== key) cached = { key, toolkit: toolkitFactory(clientId, clientSecret) };
  return cached.toolkit;
}

/** Test hook: replace the toolkit constructor. */
export function setInvoiceToolkitFactoryForTests(factory: typeof toolkitFactory) {
  toolkitFactory = factory;
  cached = undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runInvoiceTool(tool: InvoiceTool, args: Record<string, unknown>): Promise<unknown> {
  let message: Awaited<ReturnType<Toolkit["handleToolCall"]>>;
  try {
    message = await getToolkit().handleToolCall({
      id: `call_${randomUUID()}`,
      type: "function",
      function: { name: tool, arguments: JSON.stringify(args) },
    });
  } catch {
    throw new InvoicingError(tool);
  }

  const content = typeof message.content === "string" ? message.content : undefined;
  // Some endpoints answer 204 No Content, which the toolkit serializes as nothing.
  if (content === undefined || content === "undefined" || content === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new InvoicingError(tool);
  }

  // The toolkit reports failures in its result instead of throwing:
  // { ok: false, status, code, message } or { error: { message, type } }.
  if (isRecord(parsed) && (parsed.ok === false || "error" in parsed)) {
    throw new InvoicingError(
      tool,
      typeof parsed.status === "number" ? parsed.status : undefined,
      typeof parsed.code === "string" ? parsed.code : undefined,
    );
  }
  return parsed;
}
