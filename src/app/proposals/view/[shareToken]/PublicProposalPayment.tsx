"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Currency } from "@/lib/contracts/common";
import type { ProposalStatus } from "@/lib/contracts/proposals";
import {
  approvePublicProposal,
  capturePublicProposalPaypalOrder,
  createPublicProposalPaypalOrder,
  decidePaymentConflict,
  type PaymentConflictSource,
  PublicProposalPaymentError,
  readLatestProposalStatus,
} from "@/lib/proposals/payment-client";

interface PaypalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}

interface PaypalSdk {
  Buttons(options: {
    style: { layout: "vertical"; color: "gold"; shape: "rect"; label: "paypal" };
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel(): void;
    onError(error: unknown): void;
  }): PaypalButtons;
}

declare global {
  interface Window {
    paypal?: PaypalSdk;
  }
}

type CaptureState = "capturing" | "retry" | "pending";

function formatCurrency(cents: number, currency: Currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default function PublicProposalPayment({
  token,
  initialStatus,
  currency,
  totalCents,
  onStatusChange,
}: {
  token: string;
  initialStatus: ProposalStatus;
  currency: Currency;
  totalCents: number;
  onStatusChange(status: ProposalStatus): void;
}) {
  const [proposalStatus, setProposalStatus] = useState(initialStatus);
  const [isApproving, setIsApproving] = useState(false);
  const [captureOrderId, setCaptureOrderId] = useState<string | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [paymentBlocked, setPaymentBlocked] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const buttonsContainer = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim();
  const sdkUrl = clientId
    ? `https://www.paypal.com/sdk/js?${new URLSearchParams({
        "client-id": clientId,
        currency,
        intent: "capture",
      }).toString()}`
    : null;

  // 409 CONFLICT has several causes, so act on the proposal's current status.
  const resolveConflict = useCallback(
    async (source: PaymentConflictSource) => {
      const outcome = decidePaymentConflict(source, await readLatestProposalStatus(token));
      if (outcome.kind === "show-status") {
        setProposalStatus(outcome.status);
        onStatusChange(outcome.status);
        setCaptureOrderId(null);
        setCaptureState(null);
        setMessage(null);
      } else if (outcome.kind === "restart-payment") {
        setCaptureOrderId(null);
        setCaptureState(null);
        setMessage("Order pembayaran ini sudah tidak berlaku. Silakan mulai pembayaran lagi.");
      } else if (outcome.kind === "blocked") {
        setPaymentBlocked(true);
        setCaptureState(null);
        setMessage(null);
      } else {
        setCaptureState("retry");
        setMessage("Status capture belum dapat dipastikan. Tekan Coba Lagi untuk memeriksa order yang sama.");
      }
    },
    [onStatusChange, token],
  );

  const captureOrder = useCallback(
    async (orderId: string) => {
      setCaptureOrderId(orderId);
      setCaptureState("capturing");
      setMessage(null);

      try {
        const result = await capturePublicProposalPaypalOrder(token, orderId);
        if (result.paymentStatus === "completed" || result.proposalStatus === "paid") {
          setProposalStatus("paid");
          onStatusChange("paid");
          setCaptureOrderId(null);
          setCaptureState(null);
          return;
        }

        setCaptureState("pending");
        setMessage("Pembayaran sedang diproses. Periksa kembali status dengan order yang sama.");
      } catch (error: unknown) {
        if (
          error instanceof PublicProposalPaymentError &&
          error.status === 409 &&
          error.code === "CONFLICT"
        ) {
          await resolveConflict("capture");
          return;
        }

        if (
          error instanceof PublicProposalPaymentError &&
          error.status === 422 &&
          error.code === "PAYMENT_DECLINED"
        ) {
          setCaptureOrderId(null);
          setCaptureState(null);
          setMessage("Metode pembayaran ditolak. Silakan coba metode pembayaran lain.");
          return;
        }

        setCaptureState("retry");
        setMessage(
          error instanceof PublicProposalPaymentError &&
            error.status === 502 &&
            error.code === "PAYMENT_PROVIDER_ERROR"
            ? "Pembayaran sedang diverifikasi. Jangan mulai pembayaran baru. Tekan Coba Lagi untuk mengirim ulang capture dengan order yang sama."
            : "Status capture belum dapat dipastikan. Tekan Coba Lagi untuk memeriksa order yang sama.",
        );
      }
    },
    [onStatusChange, resolveConflict, token],
  );

  useEffect(() => {
    const container = buttonsContainer.current;
    const paypal = window.paypal;
    if (
      !sdkReady ||
      !paypal ||
      !container ||
      proposalStatus !== "approved" ||
      paymentBlocked ||
      captureState
    ) {
      return;
    }

    let active = true;
    let buttons: PaypalButtons | null = null;

    void Promise.resolve()
      .then(() => {
        if (!active) {
          return null;
        }

        buttons = paypal.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
          createOrder: async () => {
            try {
              const order = await createPublicProposalPaypalOrder(token);
              if (active) {
                setCaptureOrderId(order.orderId);
                setMessage(null);
              }
              return order.orderId;
            } catch (error: unknown) {
              if (active && error instanceof PublicProposalPaymentError && error.status === 409) {
                await resolveConflict("create-order");
              } else if (active) {
                // A failed order request can also mean an earlier payment could
                // not be recorded, so never tell the client that nothing was paid.
                setMessage(
                  "Order pembayaran belum dapat dibuat. Jika Anda sudah pernah membayar proposal ini, jangan bayar lagi dan periksa kembali nanti. Jika belum, silakan coba lagi.",
                );
              }
              throw error;
            }
          },
          onApprove: async (data) => {
            if (data.orderID) {
              await captureOrder(data.orderID);
            }
          },
          onCancel: () => setMessage("Pembayaran dibatalkan. Anda dapat melanjutkan kapan saja."),
          onError: () => {
            // Keep a more specific message set by createOrder or onApprove.
            setMessage((current) => current ?? "PayPal mengalami kendala. Muat ulang halaman lalu coba lagi.");
          },
        });
        return buttons;
      })
      .then((createdButtons) => {
        if (createdButtons && active) {
          return createdButtons.render(container);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          console.error("Unable to render PayPal Sandbox buttons", error);
          setSdkError("Tombol PayPal Sandbox gagal dimuat. Muat ulang halaman untuk mencoba kembali.");
        }
      });

    return () => {
      active = false;
      if (buttons) {
        void buttons.close().catch((error: unknown) => {
          console.error("Unable to close PayPal Sandbox buttons", error);
        });
      }
    };
  }, [captureOrder, captureState, paymentBlocked, proposalStatus, resolveConflict, sdkReady, token]);

  async function handleApprove() {
    setIsApproving(true);
    setMessage(null);
    try {
      const proposal = await approvePublicProposal(token);
      setProposalStatus(proposal.status);
      onStatusChange(proposal.status);
      if (proposal.status !== "approved" && proposal.status !== "paid") {
        setMessage("Proposal tidak dapat disetujui. Muat ulang halaman untuk melihat status terbaru.");
      }
    } catch (error: unknown) {
      setMessage(
        error instanceof PublicProposalPaymentError
          ? error.message
          : "Persetujuan proposal gagal. Periksa koneksi lalu coba kembali.",
      );
    } finally {
      setIsApproving(false);
    }
  }

  async function handleRecheck() {
    setPaymentBlocked(false);
    setMessage(null);
    const latestStatus = await readLatestProposalStatus(token);
    if (latestStatus && latestStatus !== proposalStatus) {
      setProposalStatus(latestStatus);
      onStatusChange(latestStatus);
    }
  }

  const canApprove = proposalStatus === "sent" && !isApproving;
  const showSandboxScript =
    proposalStatus === "approved" && !paymentBlocked && captureState === null && Boolean(sdkUrl);

  return (
    <section
      aria-labelledby="proposal-payment-heading"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div>
        <h2 id="proposal-payment-heading" className="text-sm font-bold text-slate-900">
          Persetujuan & Pembayaran
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Total pembayaran: <strong>{formatCurrency(totalCents, currency)}</strong>
        </p>
      </div>

      {proposalStatus === "sent" ? (
        <button
          type="button"
          disabled={!canApprove}
          onClick={() => void handleApprove()}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isApproving ? "Menyetujui..." : "Setujui Proposal"}
        </button>
      ) : null}

      {proposalStatus === "approved" && paymentBlocked ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p role="status" className="text-sm text-amber-900">
            Pembayaran baru belum bisa dimulai karena ada pembayaran untuk proposal ini yang sedang diproses atau ditinjau.
            Jangan bayar lagi. Periksa kembali beberapa saat lagi, atau hubungi freelancer jika statusnya tidak berubah.
          </p>
          <button
            type="button"
            onClick={() => void handleRecheck()}
            className="rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
          >
            Periksa Lagi
          </button>
        </div>
      ) : null}

      {proposalStatus === "approved" && captureState === "retry" && captureOrderId ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p role="alert" className="text-sm text-amber-900">
            {message}
          </p>
          <button
            type="button"
            onClick={() => void captureOrder(captureOrderId)}
            className="rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-800"
          >
            Coba Lagi
          </button>
        </div>
      ) : null}

      {proposalStatus === "approved" && captureState === "pending" && captureOrderId ? (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p role="status" className="text-sm text-blue-900">{message}</p>
          <button
            type="button"
            onClick={() => void captureOrder(captureOrderId)}
            className="rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-900 transition hover:bg-blue-100"
          >
            Periksa Pembayaran Lagi
          </button>
        </div>
      ) : null}

      {proposalStatus === "approved" && captureState === "capturing" ? (
        <p role="status" className="text-sm text-slate-600">Memverifikasi pembayaran...</p>
      ) : null}

      {proposalStatus === "approved" && !paymentBlocked && captureState === null ? (
        <>
          {message ? <p role="alert" className="text-sm text-amber-900">{message}</p> : null}
          {sdkUrl ? (
            <>
              {showSandboxScript ? (
                <Script
                  src={sdkUrl}
                  strategy="afterInteractive"
                  onReady={() => setSdkReady(true)}
                  onError={() => setSdkError("PayPal Sandbox SDK tidak dapat dimuat. Periksa koneksi lalu muat ulang halaman.")}
                />
              ) : null}
              <div ref={buttonsContainer} />
              {sdkError ? <p role="alert" className="text-sm text-rose-700">{sdkError}</p> : null}
            </>
          ) : (
            <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Pembayaran Sandbox belum dikonfigurasi. Tetapkan NEXT_PUBLIC_PAYPAL_CLIENT_ID ke client ID aplikasi PayPal Sandbox.
            </p>
          )}
        </>
      ) : null}

      {proposalStatus === "paid" ? (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Pembayaran telah dikonfirmasi. Tidak ada order baru yang dapat dibuat.
        </p>
      ) : null}

      {proposalStatus === "cancelled" ? (
        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Proposal dibatalkan. Pembayaran tidak tersedia.
        </p>
      ) : null}

      {message && proposalStatus !== "approved" ? (
        <p role="alert" className="text-sm text-rose-700">{message}</p>
      ) : null}
    </section>
  );
}
