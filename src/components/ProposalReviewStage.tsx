"use client";

import { useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import { proposalSchema } from "@/lib/contracts/proposals";
import { quoteSchema } from "@/lib/contracts/quotes";
import {
  CURRENCIES,
  Currency,
  CalculateQuoteRequest,
  CreateProposalRequest,
  Proposal,
  QuoteCalculation,
  amountToCents,
  formatCents,
} from "@/types/proposals";

export interface ProposalItemDraft {
  id: string;
  title: string;
  description: string;
  estimatedHours: number;
}

interface ProposalReviewStageProps {
  briefId?: string;
  serviceLabel: string;
  initialTitle?: string;
  initialSummary?: string;
  initialItems: ProposalItemDraft[];
  questions?: string[];
  assumptions?: string[];
  onProposalSaved?: (proposal: Proposal) => void;
}

export default function ProposalReviewStage({
  briefId,
  serviceLabel,
  initialTitle = "",
  initialSummary = "",
  initialItems = [],
  questions = [],
  assumptions = [],
  onProposalSaved,
}: ProposalReviewStageProps) {
  // Field-field proposal
  const [title, setTitle] = useState(
    initialTitle || `${serviceLabel} Project Proposal`
  );
  const [summary, setSummary] = useState(initialSummary);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [hourlyRate, setHourlyRate] = useState<string>("50");

  // Items deliverables yang dapat diedit
  const [items, setItems] = useState<ProposalItemDraft[]>(initialItems);

  // State kalkulasi quote server
  const [isCalculating, setIsCalculating] = useState(false);
  const [quoteCalculation, setQuoteCalculation] =
    useState<QuoteCalculation | null>(null);
  const [quoteError, setQuoteError] = useState<{
    code?: string;
    message: string;
  } | null>(null);

  // State penyimpanan proposal draft
  const [isSaving, setIsSaving] = useState(false);
  const [savedProposal, setSavedProposal] = useState<Proposal | null>(null);
  const [saveError, setSaveError] = useState<{
    code?: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
  } | null>(null);

  // Client-side validation errors
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Reset kalkulasi saat item atau tarif diubah agar user selalu melakukan preview server
  function invalidateQuote() {
    if (quoteCalculation) {
      setQuoteCalculation(null);
    }
    if (quoteError) setQuoteError(null);
    if (saveError) setSaveError(null);
  }

  function handleItemChange(
    id: string,
    field: "title" | "description" | "estimatedHours",
    value: string | number
  ) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
    invalidateQuote();
  }

  function handleAddItem() {
    const newItem: ProposalItemDraft = {
      id: `item-${Date.now()}`,
      title: "",
      description: "",
      estimatedHours: 5,
    };
    setItems((prev) => [...prev, newItem]);
    invalidateQuote();
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    invalidateQuote();
  }

  function validateInputs(): string[] {
    const errors: string[] = [];
    if (!title.trim()) {
      errors.push("Proposal title is required.");
    } else if (title.trim().length > 200) {
      errors.push("Proposal title cannot exceed 200 characters.");
    }

    if (summary.trim().length > 5000) {
      errors.push("Proposal summary cannot exceed 5,000 characters.");
    }

    if (clientName.trim().length > 200) {
      errors.push("Client name cannot exceed 200 characters.");
    }

    if (clientEmail.trim()) {
      if (clientEmail.trim().length > 320) {
        errors.push("Client email cannot exceed 320 characters.");
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientEmail.trim())) {
        errors.push("Client email format is invalid.");
      }
    }

    const rateNum = parseFloat(hourlyRate);
    if (isNaN(rateNum) || rateNum <= 0) {
      errors.push("Hourly rate must be a positive number greater than 0.");
    } else if (rateNum > 100_000) {
      errors.push("Hourly rate cannot exceed 100,000 per hour.");
    }

    if (items.length === 0) {
      errors.push("At least one deliverable item is required.");
    } else if (items.length > 50) {
      errors.push("Maximum 50 deliverables allowed.");
    }

    items.forEach((it, idx) => {
      if (!it.title.trim()) {
        errors.push(`Item #${idx + 1} title cannot be empty.`);
      } else if (it.title.trim().length > 200) {
        errors.push(`Item #${idx + 1} title cannot exceed 200 characters.`);
      }

      if (it.description && it.description.trim().length > 2000) {
        errors.push(
          `Item #${idx + 1} description cannot exceed 2,000 characters.`
        );
      }

      if (it.estimatedHours <= 0) {
        errors.push(
          `Item #${idx + 1} estimated hours must be greater than 0.`
        );
      } else if (it.estimatedHours > 1000) {
        errors.push(
          `Item #${idx + 1} estimated hours cannot exceed 1,000 hours.`
        );
      } else if (
        Math.abs(it.estimatedHours * 100 - Math.round(it.estimatedHours * 100)) >
        1e-6
      ) {
        errors.push(
          `Item #${idx + 1} estimated hours must have at most 2 decimal places.`
        );
      }
    });

    return errors;
  }

  // 1. Eksekusi Kalkulasi Quote dari Server (POST /api/quotes/calculate)
  async function handleCalculateQuote() {
    const errors = validateInputs();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setQuoteError(null);
    setIsCalculating(true);

    try {
      const payload: CalculateQuoteRequest = {
        currency,
        hourlyRateCents: amountToCents(parseFloat(hourlyRate)),
        items: items.map((it) => ({
          title: it.title.trim(),
          description: it.description?.trim() || undefined,
          estimatedHours: Number(it.estimatedHours),
        })),
      };

      const res = await fetch("/api/quotes/calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json: unknown = await res.json();
        const parsed = quoteSchema.safeParse(
          json && typeof json === "object" && "data" in json ? json.data : undefined,
        );
        if (!parsed.success) {
          setQuoteError({
            code: "INVALID_RESPONSE",
            message: "The quote API returned a response that does not match its contract.",
          });
          return;
        }
        setQuoteCalculation(parsed.data);
        setQuoteError(null);
      } else {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code || String(res.status);
        const message =
          body?.error?.message ||
          (res.status === 401
            ? "Authentication required (401). Please sign in to calculate quotes."
            : res.status === 404
            ? body?.error?.message || "Quote calculation resource was not found."
            : res.status === 429
            ? "Rate limit exceeded (429). Please wait a moment."
            : `Quote calculation failed with status ${res.status}.`);
        setQuoteError({ code, message });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setQuoteError({
        code: "NETWORK_ERROR",
        message:
          error.message ||
          "Network error: Unable to connect to quote calculation service.",
      });
    } finally {
      setIsCalculating(false);
    }
  }

  // 2. Simpan Proposal Draft ke Server (POST /api/proposals)
  async function handleSaveDraft() {
    const errors = validateInputs();
    if (!quoteCalculation) {
      errors.push(
        "Please click 'Calculate Quote (Server)' to verify quote pricing before saving proposal draft."
      );
    }
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setSaveError(null);
    setIsSaving(true);

    try {
      const payload: CreateProposalRequest = {
        briefId: briefId || undefined,
        title: title.trim(),
        summary: summary.trim() || undefined,
        clientName: clientName.trim() || undefined,
        clientEmail: clientEmail.trim() || undefined,
        currency,
        hourlyRateCents: amountToCents(parseFloat(hourlyRate)),
        items: items.map((it) => ({
          title: it.title.trim(),
          description: it.description?.trim() || undefined,
          estimatedHours: Number(it.estimatedHours),
        })),
      };

      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 201 || res.ok) {
        const json: unknown = await res.json();
        const parsed = proposalSchema.safeParse(
          json && typeof json === "object" && "data" in json ? json.data : undefined,
        );
        if (!parsed.success) {
          setSaveError({
            code: "INVALID_RESPONSE",
            message: "The proposal API returned a response that does not match its contract.",
          });
          return;
        }
        const createdProposal: Proposal = parsed.data;
        setSavedProposal(parsed.data);
        setSaveError(null);
        if (onProposalSaved) {
          onProposalSaved(createdProposal);
        }
      } else {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code || String(res.status);
        const details = body?.error?.details;
        const message =
          body?.error?.message ||
          (res.status === 401
            ? "Authentication required (401). Sign in with a valid Supabase session to save proposals."
            : res.status === 404
            ? body?.error?.message || "The referenced proposal resource was not found."
            : res.status === 422 || res.status === 400
            ? "Validation error: Check item counts or hourly rates."
            : res.status === 429
            ? "Rate limit exceeded (429). Please wait a moment."
            : `Failed to save proposal draft (Status ${res.status}).`);
        setSaveError({ code, message, details });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setSaveError({
        code: "NETWORK_ERROR",
        message:
          error.message ||
          "Network error: Unable to reach proposal creation service.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // Tampilan ketika proposal berhasil disimpan sebagai draft
  if (savedProposal) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-2xs">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                PROPOSAL DRAFT CREATED
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-600">
                Status: {savedProposal.status}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-slate-900">
              {savedProposal.title}
            </h2>
            <p className="text-xs text-slate-500">
              Proposal ID: <code className="font-mono">{savedProposal.id}</code>
            </p>
          </div>
        </div>

        {/* Ringkasan Finansial yang Dikonfirmasi Server */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 text-xs">
          <div>
            <span className="text-slate-400 font-medium">Total Scope</span>
            <p className="text-sm font-bold text-slate-900 mt-0.5">
              {savedProposal.totalHours} Hours
            </p>
            <p className="text-[11px] text-slate-500">
              {savedProposal.items.length} deliverables
            </p>
          </div>
          <div>
            <span className="text-slate-400 font-medium">Hourly Base Rate</span>
            <p className="text-sm font-bold text-slate-900 mt-0.5">
              {formatCents(
                savedProposal.hourlyRateCents,
                savedProposal.currency
              )}
              /hr
            </p>
            <p className="text-[11px] text-slate-500">
              Currency: {savedProposal.currency}
            </p>
          </div>
          <div>
            <span className="text-slate-400 font-medium">
              Server Total (Cents)
            </span>
            <p className="text-base font-extrabold text-indigo-700 mt-0.5">
              {formatCents(savedProposal.totalCents, savedProposal.currency)}
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              {savedProposal.totalCents} integer cents
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-xs text-indigo-950 leading-relaxed">
          <p className="font-semibold text-indigo-900">Next Steps</p>
          <p className="mt-1 text-slate-600">
            Proposal Anda tersimpan dengan status <strong>draft</strong>.
            Buka proposal dari dashboard untuk membuat share link.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-slate-800"
          >
            <span>←</span>
            <span>View on Dashboard</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setSavedProposal(null);
              setQuoteCalculation(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            <span>Create Another Proposal</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7">
      {/* Header Tahap Review Proposal */}
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">
              📝
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
              Step 2 of 4 — Proposal Review & Pricing
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            Review Deliverables & Calculate Quote
          </h2>
          <p className="text-xs text-slate-500">
            Customize AI-generated tasks, set your rate, and preview server
            quote calculation.
          </p>
        </div>

        {briefId && (
          <span className="self-start sm:self-auto rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-mono text-slate-600">
            Linked Brief: {briefId.slice(0, 8)}...
          </span>
        )}
      </div>

      {/* Tampilan Asumsi & Pertanyaan Klien dari Hasil AI (jika tersedia) */}
      {(questions.length > 0 || assumptions.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {questions.length > 0 && (
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4 text-xs">
              <h4 className="font-bold text-amber-900 flex items-center gap-1.5 mb-2">
                <span>❓</span> Questions for Client
              </h4>
              <ul className="space-y-1 list-disc pl-4 text-amber-950/80">
                {questions.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {assumptions.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs">
              <h4 className="font-bold text-slate-700 flex items-center gap-1.5 mb-2">
                <span>📌</span> Scope Assumptions
              </h4>
              <ul className="space-y-1 list-disc pl-4 text-slate-600">
                {assumptions.map((a, idx) => (
                  <li key={idx}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Bagian Metadata Proposal */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Proposal Overview
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="proposal-title"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Proposal Title *
            </label>
            <input
              id="proposal-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                invalidateQuote();
              }}
              placeholder="e.g. Modern Web Development & PayPal Integration"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="client-name"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Client Name (Optional)
            </label>
            <input
              id="client-name"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="client-email"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Client Email (Optional)
            </label>
            <input
              id="client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="client@example.com"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="proposal-summary"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Summary / Scope Notes
            </label>
            <textarea
              id="proposal-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Executive summary of the proposal..."
              className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Bagian Mata Uang & Tarif Per Jam */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
          Pricing Parameters (Integer Cents Contract)
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="pricing-currency"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Settlement Currency
            </label>
            <select
              id="pricing-currency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value as Currency);
                invalidateQuote();
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
            >
              {CURRENCIES.map((curr) => (
                <option key={curr} value={curr}>
                  {curr} (PayPal Supported)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="pricing-hourly-rate"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Base Hourly Rate ({currency})
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-xs text-slate-400 font-semibold">
                $
              </span>
              <input
                id="pricing-hourly-rate"
                type="number"
                min="1"
                step="0.5"
                value={hourlyRate}
                onChange={(e) => {
                  setHourlyRate(e.target.value);
                  invalidateQuote();
                }}
                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-indigo-500"
              />
            </div>
            <span className="mt-1 block text-[10px] text-slate-400">
              Converts to {amountToCents(parseFloat(hourlyRate) || 0)} integer
              cents for API payload
            </span>
          </div>
        </div>
      </div>

      {/* Editor Deliverables & Jam */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Deliverables & Task Items ({items.length})
            </h3>
            <p className="text-[11px] text-slate-400">
              Modify hours, descriptions, or add additional scope milestones.
            </p>
          </div>

          <button
            type="button"
            onClick={handleAddItem}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
          >
            <span>+</span>
            <span>Add Deliverable</span>
          </button>
        </div>

        <div className="space-y-3">
          {items.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-xs text-slate-500">
              No deliverables yet. Add a work item to calculate and save this
              proposal.
            </p>
          )}
          {items.map((item, idx) => (
            <div
              key={item.id}
              className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
                  {idx + 1}
                </span>

                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) =>
                          handleItemChange(item.id, "title", e.target.value)
                        }
                        placeholder="Deliverable title..."
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-900 outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <div className="relative">
                        <input
                          type="number"
                          min="0.1"
                          step="0.25"
                          value={item.estimatedHours}
                          onChange={(e) =>
                            handleItemChange(
                              item.id,
                              "estimatedHours",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-xs text-slate-900 outline-none focus:border-indigo-500"
                        />
                        <span className="absolute right-3 top-2 text-[11px] text-slate-400">
                          hrs
                        </span>
                      </div>
                    </div>
                  </div>

                  <textarea
                    rows={2}
                    value={item.description}
                    onChange={(e) =>
                      handleItemChange(item.id, "description", e.target.value)
                    }
                    placeholder="Deliverable details / acceptance criteria..."
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-600 outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="text-slate-400 hover:text-red-600 p-1 transition"
                  title="Remove item"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Client Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
          <p className="font-bold mb-1">Please fix the following issues:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* SECTION: SERVER QUOTE CALCULATION PREVIEW */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm">⚡</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Server-Side Quote Preview
              </h3>
            </div>
            <p className="text-[11px] text-slate-500">
              Deterministic pricing computed via POST /api/quotes/calculate
              (integer arithmetic).
            </p>
          </div>

          <button
            type="button"
            onClick={handleCalculateQuote}
            disabled={isCalculating}
            className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 transition disabled:opacity-50"
          >
            {isCalculating ? (
              <>
                <Spinner size="sm" color="indigo" />
                <span>Calculating with server...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Calculate Quote (Server)</span>
              </>
            )}
          </button>
        </div>

        {/* Error Kalkulasi Quote */}
        {quoteError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
            <span className="font-bold">Quote Calculation Error:</span>{" "}
            {quoteError.message}
            {quoteError.code && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px]">
                {quoteError.code}
              </span>
            )}
          </div>
        )}

        {/* Hasil Kalkulasi Sukses dari Server */}
        {quoteCalculation && (
          <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-slate-800">
                  Verified Server Calculation
                </span>
              </div>
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                Deterministic
              </span>
            </div>

            <div className="divide-y divide-slate-100 text-xs">
              {quoteCalculation.items.map((line) => (
                <div
                  key={line.position}
                  className="flex items-center justify-between py-2"
                >
                  <span className="text-slate-700">
                    #{line.position + 1} {line.title} ({line.estimatedHours} hrs
                    @ {formatCents(line.hourlyRateCents, quoteCalculation.currency)}
                    /hr)
                  </span>
                  <span className="font-semibold text-slate-900">
                    {formatCents(line.amountCents, quoteCalculation.currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="text-xs font-bold text-slate-700">
                Total Estimate ({quoteCalculation.totalHours} hrs)
              </span>
              <span className="text-base font-extrabold text-indigo-700">
                {formatCents(quoteCalculation.totalCents, quoteCalculation.currency)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Save Error Banner */}
      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-1">
          <div className="flex items-center gap-2 font-bold">
            <span>⚠️ Save Proposal Error:</span>
            {saveError.code && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px]">
                {saveError.code}
              </span>
            )}
          </div>
          <p>{saveError.message}</p>
          {saveError.details && saveError.details.length > 0 && (
            <ul className="list-disc pl-4 pt-1 space-y-0.5 text-red-800">
              {saveError.details.map((d, i) => (
                <li key={i}>
                  <code className="font-mono">{d.path}</code>: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* TOMBOL AKSI SIMPAN PROPOSAL */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100">
        <div className="space-y-1">
          <p className="text-xs text-slate-500">
            Proposal will be saved with status <strong>draft</strong>.
          </p>
          {quoteCalculation ? (
            <p className="text-[11px] font-medium text-emerald-600 flex items-center gap-1">
              <span>✓</span> Quote preview verified:{" "}
              {formatCents(
                quoteCalculation.totalCents,
                quoteCalculation.currency
              )}{" "}
              ({quoteCalculation.totalHours} hrs)
            </p>
          ) : (
            <p className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
              <span>⚠️</span> Server quote preview required before saving
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={isSaving || !quoteCalculation}
          className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/20 hover:bg-indigo-700 active:bg-indigo-800 transition disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Spinner size="sm" color="white" />
              <span>Saving Proposal Draft to Server...</span>
            </>
          ) : (
            <>
              <span>💾</span>
              <span>Save Proposal Draft (POST /api/proposals)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
