"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiErrorBodySchema } from "@/lib/contracts/errors";
import {
  billingAgentResponseSchema,
  MAX_AGENT_MESSAGES,
  MAX_AGENT_MESSAGE_LENGTH,
  type AgentMessage,
} from "@/lib/contracts/agent";

const suggestions = [
  "Which proposals are unpaid?",
  "Send a PayPal invoice for my approved proposal",
  "Has my invoice been paid?",
];

export default function BillingAgentPanel({
  onRefresh,
}: {
  onRefresh(): void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [actions, setActions] = useState<
    ReturnType<typeof billingAgentResponseSchema.parse>["actions"]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;

    const nextMessages = [
      ...messages,
      { role: "user" as const, content: trimmed },
    ].slice(-MAX_AGENT_MESSAGES);
    setMessages(nextMessages);
    setInput("");
    setActions([]);
    setError(null);
    setIsLoading(true);

    // A long earlier reply must not make the next request invalid, so the
    // history sent back is clipped to the API's per-message limit.
    const requestMessages = nextMessages.slice(-MAX_AGENT_MESSAGES).map((message) => ({
      ...message,
      content: message.content.slice(0, MAX_AGENT_MESSAGE_LENGTH),
    }));
    try {
      const response = await fetch("/api/agent/billing", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: requestMessages }),
      });

      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      if (!response.ok) {
        const parsedError = apiErrorBodySchema.safeParse(body);
        setError(
          parsedError.success
            ? parsedError.data.error.message
            : `The billing agent request failed (HTTP ${response.status}). Please try again.`,
        );
        return;
      }

      const payload =
        body && typeof body === "object" && "data" in body
          ? body.data
          : undefined;
      const parsedResponse = billingAgentResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        setError("The billing agent returned an invalid response. Please try again.");
        return;
      }

      const result = parsedResponse.data;
      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: result.reply,
      };
      setMessages((current) =>
        [...current, assistantMessage].slice(-MAX_AGENT_MESSAGES),
      );
      setActions(result.actions);
      if (result.actions.some((action) => action.ok)) {
        onRefresh();
      }
    } catch {
      setError("Could not reach the billing agent. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">
          AI Billing Agent
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Ask about unpaid proposals and PayPal invoices.
        </p>
      </div>

      <div
        className="max-h-96 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 sm:p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">
            Choose a suggestion or ask the billing agent a question.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${index}-${message.role}`}
              className={`max-w-[90%] whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-indigo-600 text-white"
                  : "mr-auto border border-slate-200 bg-white text-slate-800"
              }`}
            >
              {message.content}
            </div>
          ))
        )}
        {isLoading ? (
          <p role="status" className="text-xs font-medium text-slate-500">
            Agent is working…
          </p>
        ) : null}
      </div>

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Billing agent actions">
          {actions.map((action, index) => (
            <span
              key={`${action.tool}-${index}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                action.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <span aria-hidden="true">{action.ok ? "✓" : "✕"}</span>
              <span>{action.summary}</span>
            </span>
          ))}
          {actions.map((action, index) =>
            action.invoice?.payerViewUrl ? (
              <a
                key={`invoice-${index}`}
                href={action.invoice.payerViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                Open PayPal invoice
              </a>
            ) : null,
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={isLoading}
            onClick={() => void sendMessage(suggestion)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="billing-agent-message">
          Message the AI Billing Agent
        </label>
        <input
          id="billing-agent-message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={MAX_AGENT_MESSAGE_LENGTH}
          disabled={isLoading}
          placeholder="Ask about proposals or invoices…"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
