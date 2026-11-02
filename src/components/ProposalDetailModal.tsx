"use client";

import { useEffect, useState } from "react";
import type { Currency, ProposalStatus, ProposalSummary, Proposal } from "@/types/proposals";
import { sendProposalResponseSchema, type SendProposalResponse } from "@/lib/contracts/payments";
import { fetchProposalDetail, ProposalDetailError } from "@/lib/proposals/detail-client";
import Spinner from "@/components/Spinner";

export type ProposalDetailItem = ProposalSummary;

export interface ProposalDetailModalProps {
  proposal: ProposalDetailItem | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

interface ApiErrorInfo {
  code: string;
  message: string;
  httpStatus?: number;
}

// Detail data always comes from GET /api/proposals/:id; nothing is filled in locally.
export type ProposalDetailState =
  | { status: "loading" }
  | { status: "error"; error: ProposalDetailError }
  | { status: "ready"; proposal: Proposal };

function formatCents(cents: number, currency: Currency): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
  return formatter.format(cents / 100);
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
}

// The backend returns an absolute shareUrl; keep relative values working too.
function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
}

function getStatusBadge(status: ProposalStatus) {
  switch (status) {
    case "paid":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "sent":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "draft":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "rejected":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelled":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

interface ProposalDetailContentProps {
  state: ProposalDetailState;
  onRetry: () => void;
}

// Loading, error and success views for the proposal detail section.
export function ProposalDetailContent({ state, onRetry }: ProposalDetailContentProps) {
  if (state.status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 text-xs text-slate-600"
      >
        <Spinner size="sm" />
        <span>Loading proposal details…</span>
      </div>
    );
  }

  if (state.status === "error") {
    const { error } = state;
    const canRetry = error.kind !== "not_found" && error.kind !== "unauthorized";
    return (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-2">
        <div className="flex items-center gap-1.5 font-bold text-rose-900">
          <span>⚠️</span>
          <span>Could not load proposal details</span>
        </div>
        <p>{error.message}</p>
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 transition"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const { proposal } = state;
  return (
    <div className="space-y-4" data-testid="proposal-detail">
      {/* Pricing Summary Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 text-xs">
        <div>
          <span className="text-slate-400 font-medium">Client</span>
          <p className="mt-0.5 font-bold text-slate-800 truncate">{proposal.clientName || "Not specified"}</p>
          {proposal.clientEmail && <p className="text-[10px] text-slate-500 truncate">{proposal.clientEmail}</p>}
        </div>
        <div>
          <span className="text-slate-400 font-medium">Default Rate</span>
          <p className="mt-0.5 font-bold text-slate-800">
            {formatCents(proposal.hourlyRateCents, proposal.currency)}/hr
          </p>
          <p className="text-[10px] text-slate-500">{proposal.currency}</p>
        </div>
        <div>
          <span className="text-slate-400 font-medium">Total Quote</span>
          <p className="mt-0.5 font-bold text-indigo-700">{formatCents(proposal.totalCents, proposal.currency)}</p>
          <p className="text-[10px] text-slate-500">{formatHours(proposal.totalHours)} total</p>
        </div>
        <div>
          <span className="text-slate-400 font-medium">Created On</span>
          <p className="mt-0.5 font-bold text-slate-800">{formatDate(proposal.createdAt)}</p>
          <p className="text-[10px] text-slate-500">Updated {formatDate(proposal.updatedAt)}</p>
        </div>
      </div>

      {/* Proposal Summary Notes */}
      {proposal.summary && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 text-xs text-slate-600">
          <span className="font-semibold text-slate-800 block mb-1">Scope Summary</span>
          <p className="leading-relaxed">{proposal.summary}</p>
        </div>
      )}

      {/* Deliverables List */}
      <div className="space-y-2.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Deliverables ({proposal.items.length})
        </h4>
        {proposal.items.length === 0 ? (
          <p className="text-xs text-slate-500">This proposal has no line items.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
            {proposal.items.map((item) => (
              <div
                key={item.position}
                className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white p-2.5 text-xs"
              >
                <div className="space-y-0.5 pr-2">
                  <p className="font-semibold text-slate-800">
                    #{item.position + 1} {item.title}
                  </p>
                  {item.description && <p className="text-[11px] text-slate-500 line-clamp-2">{item.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <span className="font-semibold text-slate-900">{formatHours(item.estimatedHours)}</span>
                  <p className="text-[11px] text-slate-500">
                    × {formatCents(item.hourlyRateCents, proposal.currency)}/hr
                  </p>
                  <p className="text-[11px] font-bold text-indigo-600">{formatCents(item.amountCents, proposal.currency)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-semibold text-slate-800">{formatCents(proposal.subtotalCents, proposal.currency)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800">Total</span>
          <span className="font-bold text-indigo-700">{formatCents(proposal.totalCents, proposal.currency)}</span>
        </div>
      </div>

      {(proposal.approvedAt || proposal.paidAt) && (
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-500">
          {proposal.approvedAt && <span>Approved {formatDate(proposal.approvedAt)}</span>}
          {proposal.paidAt && <span>Paid {formatDate(proposal.paidAt)}</span>}
        </div>
      )}
    </div>
  );
}

interface DialogContentProps {
  initialProposal: ProposalDetailItem;
  onClose: () => void;
  onRefresh?: () => void;
}

function ProposalDetailModalDialog({
  initialProposal,
  onClose,
  onRefresh,
}: DialogContentProps) {
  const proposalId = initialProposal.id;

  const [detail, setDetail] = useState<ProposalDetailState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Delivery / send state
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<ApiErrorInfo | null>(null);
  const [sendResult, setSendResult] = useState<SendProposalResponse | null>(null);

  // Clipboard copy state
  const [copiedId, setCopiedId] = useState(false);
  const [copiedShareUrl, setCopiedShareUrl] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  // Load the full proposal from GET /api/proposals/:id (again on retry).
  useEffect(() => {
    const controller = new AbortController();
    fetchProposalDetail(proposalId, controller.signal)
      .then((proposal) => setDetail({ status: "ready", proposal }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetail({
          status: "error",
          error:
            error instanceof ProposalDetailError
              ? error
              : new ProposalDetailError("network", "An unexpected error occurred while loading this proposal."),
        });
      });
    return () => controller.abort();
  }, [proposalId, loadAttempt]);

  function handleRetryLoad() {
    setDetail({ status: "loading" });
    setLoadAttempt((attempt) => attempt + 1);
  }

  // Header fields come from the list summary until the detail has loaded.
  const loaded = detail.status === "ready" ? detail.proposal : null;
  const title = loaded?.title ?? initialProposal.title;
  const status = loaded?.status ?? initialProposal.status;
  const currency = loaded?.currency ?? initialProposal.currency;
  const totalCents = loaded?.totalCents ?? initialProposal.totalCents;
  const clientName = loaded?.clientName ?? initialProposal.clientName;

  const isTerminalStatus =
    status === "approved" ||
    status === "paid" ||
    status === "rejected" ||
    status === "cancelled";

  // Handle proposal dispatch via POST /api/proposals/[id]/send
  async function handleSendProposal() {
    setIsSending(true);
    setSendError(null);
    setClipboardError(null);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/send`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        let message = "Failed to dispatch proposal.";
        const code = json?.error?.code || `HTTP_${res.status}`;

        if (res.status === 401) {
          message = "Unauthorized. Please sign in to send proposals.";
        } else if (res.status === 404) {
          message = "Proposal not found or access denied.";
        } else if (res.status === 409) {
          message =
            json?.error?.message ||
            "Conflict: Proposal has already been approved, paid, or cancelled and cannot be resent.";
        } else if (res.status === 400 || res.status === 422) {
          message = json?.error?.message || "Invalid delivery parameters.";
        } else if (res.status === 429) {
          message = "Rate limit reached. Please wait a moment before resending.";
        } else if (res.status >= 500) {
          message = "Server error occurred during proposal dispatch.";
        } else if (json?.error?.message) {
          message = json.error.message;
        }

        setSendError({ code, message, httpStatus: res.status });
        return;
      }

      if (json?.data) {
        const parsed = sendProposalResponseSchema.safeParse(json?.data);
        if (!parsed.success) {
          setSendError({
            code: "INVALID_RESPONSE",
            message: "Server returned an invalid send-proposal response.",
          });
          return;
        }
        const result: SendProposalResponse = parsed.data;
        setSendResult(result);

        // The send response carries the full, updated proposal.
        setDetail({ status: "ready", proposal: result.proposal });

        setShowSendConfirmation(false);

        // Trigger dashboard list and stats refresh
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setSendError({
          code: "INVALID_RESPONSE",
          message: "Server did not return a valid delivery payload.",
        });
      }
    } catch (err) {
      setSendError({
        code: "NETWORK_ERROR",
        message:
          err instanceof TypeError
            ? "Network connectivity failure. Please check your internet connection."
            : "An unexpected network error occurred while sending.",
      });
    } finally {
      setIsSending(false);
    }
  }

  // Safe clipboard copy handler with explicit fallback handling
  async function handleCopyShareUrl(url: string) {
    const fullUrl = toAbsoluteUrl(url);

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        setCopiedShareUrl(true);
        setClipboardError(null);
        setTimeout(() => setCopiedShareUrl(false), 2500);
      } else {
        throw new Error("Clipboard API unavailable in this browser environment.");
      }
    } catch {
      setClipboardError(
        "Could not copy to clipboard automatically. Please highlight and copy the link manually below."
      );
      setCopiedShareUrl(false);
    }
  }

  function handleCopyId() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(proposalId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      }
    } catch {
      // Ignore ID copy failure
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xl space-y-6 z-10 my-8"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${getStatusBadge(
                  status
                )}`}
              >
                {status}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                ID: {proposalId.slice(0, 8)}...
              </span>
              <button
                type="button"
                onClick={handleCopyId}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 transition font-medium"
              >
                {copiedId ? "✓ Copied" : "Copy UUID"}
              </button>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <ProposalDetailContent state={detail} onRetry={handleRetryLoad} />

        {/* Active Client Share Link Display (from server response) */}
        {sendResult?.shareUrl && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
                <span>🔗</span>
                <span>Active Client Share Link</span>
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                Delivery via share_link
              </span>
            </div>

            <p className="text-xs text-slate-600">
              Clients can review this proposal using the share link:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={toAbsoluteUrl(sendResult.shareUrl)}
                className="w-full font-mono text-[11px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() =>
                  handleCopyShareUrl(
                    sendResult.shareUrl
                  )
                }
                className="shrink-0 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition"
              >
                {copiedShareUrl ? "✓ Copied" : "Copy Link"}
              </button>
            </div>

            {clipboardError && (
              <p className="text-[11px] text-amber-700 font-medium">
                ⚠️ {clipboardError}
              </p>
            )}

          </div>
        )}

        {/* SECTION: CLIENT PROPOSAL DELIVERY */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Client Proposal Delivery
              </h3>
              <p className="text-[11px] text-slate-500">
                Generate a secure link for the client to review this proposal.
              </p>
            </div>

            {isTerminalStatus ? (
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
                Status Locked ({status})
              </span>
            ) : status === "sent" ? (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
                Awaiting Client Response
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                Ready for Dispatch
              </span>
            )}
          </div>

          {/* Terminal Status Notice */}
          {isTerminalStatus && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
              ℹ️ This proposal has reached the <strong>{status}</strong> stage. Further delivery dispatch is restricted to maintain transaction integrity.
            </div>
          )}

          {/* Send Error Banner */}
          {sendError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-900">
                <span>⚠️</span>
                <span>Dispatch Failed [{sendError.code}]</span>
              </div>
              <p>{sendError.message}</p>
            </div>
          )}

          {/* Action Trigger Buttons */}
          {!isTerminalStatus && !showSendConfirmation && (
            <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowSendConfirmation(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-indigo-700 transition"
              >
                <span>✉️</span>
                <span>
                  {status === "sent"
                    ? "Resend / Update Client Link"
                    : "Send Proposal to Client"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyId}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <span>📋</span>
                <span>{copiedId ? "Copied Proposal ID" : "Copy Proposal ID"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Confirmation & Dispatch Dialog */}
        {showSendConfirmation && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
              <span className="font-bold text-xs text-indigo-950 flex items-center gap-1.5">
                <span>✉️</span> Confirm Client Proposal Dispatch
              </span>
              <button
                type="button"
                onClick={() => setShowSendConfirmation(false)}
                className="text-xs text-indigo-700 hover:text-indigo-900 font-medium"
              >
                ✕ Cancel
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-slate-700">
              <p>
                <strong>Proposal:</strong> {title}
              </p>
              <p>
                <strong>Client:</strong> {clientName || "Unnamed Client"}
              </p>
              <p>
                <strong>Total Amount:</strong>{" "}
                {formatCents(totalCents, currency)}
              </p>
            </div>

            <p className="rounded-lg border border-indigo-100 bg-white/70 p-3 text-xs text-slate-600">
              Sending changes a draft to sent and returns a share link. Deliver the link to your client directly.
            </p>

            {/* Confirmation Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-indigo-100">
              <button
                type="button"
                onClick={handleSendProposal}
                disabled={isSending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-60"
              >
                {isSending ? (
                  <>
                    <Spinner size="sm" color="white" />
                    <span>Processing Server Dispatch...</span>
                  </>
                ) : (
                  <>
                    <span>Confirm & Dispatch</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowSendConfirmation(false)}
                disabled={isSending}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProposalDetailModal({
  proposal,
  isOpen,
  onClose,
  onRefresh,
}: ProposalDetailModalProps) {
  if (!isOpen || !proposal) return null;

  return (
    <ProposalDetailModalDialog
      key={proposal.id}
      initialProposal={proposal}
      onClose={onClose}
      onRefresh={onRefresh}
    />
  );
}
