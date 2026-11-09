import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/http";

const invoices = vi.hoisted(() => ({
  listProposalsForAgent: vi.fn(),
  sendInvoiceForProposal: vi.fn(),
  checkInvoice: vi.fn(),
  remindInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
}));
vi.mock("@/lib/invoices/service", () => invoices);

const { runBillingAgent } = await import("./billing-agent");

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const INVOICE = {
  proposalId: PROPOSAL_ID,
  status: "sent",
  invoiceNumber: "0007",
  amountCents: 132_500,
  currency: "USD",
  payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2AAAA",
  paidAt: null,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const toolCall = (name: string, args: unknown, id = `call_${name}`) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const turn = (message: Record<string, unknown>) =>
  json(200, { model: "openai/gpt-oss-120b", choices: [{ finish_reason: "stop", message: { content: null, ...message } }] });

function fakeFetch(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
}
const sentMessages = (fn: ReturnType<typeof fakeFetch>, call: number) => JSON.parse(String(fn.mock.calls[call][1]?.body)).messages;

const ask = [{ role: "user" as const, content: "Send a PayPal invoice for the catering proposal" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GROQ_API_KEY", "gsk_test_key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  invoices.listProposalsForAgent.mockResolvedValue([
    { id: PROPOSAL_ID, title: "Catering website", clientName: "Rasa", hasClientEmail: true, status: "approved", total: "1325.00 USD", invoice: null },
  ]);
  invoices.sendInvoiceForProposal.mockResolvedValue({ invoice: INVOICE, alreadySent: false });
});

describe("runBillingAgent", () => {
  it("lets the model pick tools, runs them for the signed-in user, and reports the actions", async () => {
    const fetchImpl = fakeFetch(
      turn({ tool_calls: [toolCall("list_proposals", {})] }),
      turn({ tool_calls: [toolCall("send_invoice", { proposal_id: PROPOSAL_ID, note: "Thanks" })] }),
      turn({ content: "Invoice 0007 for 1,325.00 USD was sent." }),
    );

    const result = await runBillingAgent(USER, ask, fetchImpl);

    expect(invoices.sendInvoiceForProposal).toHaveBeenCalledWith(USER, PROPOSAL_ID, { clientEmail: undefined, note: "Thanks" });
    expect(result.reply).toBe("Invoice 0007 for 1,325.00 USD was sent.");
    expect(result.actions).toEqual([
      { tool: "send_invoice", proposalId: PROPOSAL_ID, ok: true, summary: "Sent invoice 0007 (1325.00 USD)", invoice: INVOICE },
    ]);

    // The tool result goes back to the model, tied to its call id.
    const third = sentMessages(fetchImpl, 2);
    expect(third.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_send_invoice" });
    expect(JSON.parse(third.at(-1).content)).toMatchObject({ invoice: { invoiceNumber: "0007" } });
  });

  it("sends tool definitions without any amount field the model could fill in", async () => {
    const fetchImpl = fakeFetch(turn({ content: "Hi" }));
    await runBillingAgent(USER, ask, fetchImpl);

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
      "list_proposals",
      "send_invoice",
      "check_invoice",
      "remind_invoice",
      "cancel_invoice",
    ]);
    const argumentNames = body.tools.flatMap((tool: { function: { parameters: { properties: object } } }) =>
      Object.keys(tool.function.parameters.properties),
    );
    expect(argumentNames.join(" ")).not.toMatch(/amount|price|total|currency|quantity|item|invoice_id|recipient/i);
  });

  it("rejects bad tool arguments and unknown tools without running anything", async () => {
    const fetchImpl = fakeFetch(
      turn({
        tool_calls: [
          toolCall("send_invoice", { proposal_id: "not-a-uuid" }, "a"),
          toolCall("create_order", { amount: "1.00" }, "b"),
          toolCall("send_invoice", { proposal_id: PROPOSAL_ID, amount: "1.00" }, "c"),
        ],
      }),
      turn({ content: "I could not do that." }),
    );

    await runBillingAgent(USER, ask, fetchImpl);

    // Extra keys are dropped by the schema; only the proposal id reaches the service.
    expect(invoices.sendInvoiceForProposal).toHaveBeenCalledTimes(1);
    expect(invoices.sendInvoiceForProposal).toHaveBeenCalledWith(USER, PROPOSAL_ID, { clientEmail: undefined, note: undefined });
    const toolResults = sentMessages(fetchImpl, 1).filter((m: { role: string }) => m.role === "tool");
    expect(JSON.parse(toolResults[0].content).error).toMatch(/Invalid tool arguments/);
    expect(JSON.parse(toolResults[1].content).error).toMatch(/Unknown tool/);
  });

  it("passes a safe service error to the model and records a failed action", async () => {
    invoices.sendInvoiceForProposal.mockRejectedValue(
      new ApiError("CONFLICT", "The client has to approve the proposal before it can be invoiced."),
    );
    const fetchImpl = fakeFetch(
      turn({ tool_calls: [toolCall("send_invoice", { proposal_id: PROPOSAL_ID })] }),
      turn({ content: "The client has not approved it yet." }),
    );

    const result = await runBillingAgent(USER, ask, fetchImpl);

    expect(result.actions[0]).toMatchObject({ ok: false, summary: "The client has to approve the proposal before it can be invoiced." });
  });

  it("hides unexpected errors from the model", async () => {
    invoices.checkInvoice.mockRejectedValue(new Error("connect ECONNREFUSED db.internal:5432 password=secret"));
    const fetchImpl = fakeFetch(turn({ tool_calls: [toolCall("check_invoice", { proposal_id: PROPOSAL_ID })] }), turn({ content: "Failed." }));

    await runBillingAgent(USER, ask, fetchImpl);

    const toolResult = sentMessages(fetchImpl, 1).at(-1);
    expect(toolResult.content).not.toMatch(/ECONNREFUSED|secret/);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret/);
  });

  it("stops after a bounded number of steps and says what was done", async () => {
    const loop = () => turn({ tool_calls: [toolCall("list_proposals", {})] });
    const fetchImpl = fakeFetch(loop(), loop(), loop(), loop(), loop(), loop(), loop());

    const result = await runBillingAgent(USER, ask, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(result.reply).toMatch(/could not finish/);
  });

  it("fails cleanly without a key or when Groq rejects it", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const unused = fakeFetch();
    await expect(runBillingAgent(USER, ask, unused)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(unused).not.toHaveBeenCalled();

    vi.stubEnv("GROQ_API_KEY", "gsk_test_key");
    await expect(runBillingAgent(USER, ask, fakeFetch(json(403, { error: { message: "Access denied" } })))).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/gsk_test_key/);
  });
});
