"use client";

import { useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import Spinner from "@/components/Spinner";
import AnalysisResultView from "@/components/AnalysisResultView";
import {
  AnalyzeBriefRequest,
  AnalyzeBriefResponse,
  ApiErrorBody,
  ApiSuccessBody,
  ServiceType,
} from "@/types/analysis";

interface ServiceOption {
  value: ServiceType;
  label: string;
  icon: string;
  description: string;
  example: string;
}

const services: ServiceOption[] = [
  {
    value: "web_development",
    label: "Web Development",
    icon: "💻",
    description: "Websites, landing pages, web applications, or API integrations.",
    example:
      "Client needs a modern 5-page marketing website with custom animations, contact form, product showcase, and PayPal checkout integration for their digital courses.",
  },
  {
    value: "graphic_design",
    label: "Graphic Design",
    icon: "🎨",
    description: "Branding, logos, UI/UX mockups, illustrations, or marketing assets.",
    example:
      "Client requests a complete brand identity revamp: primary logo, monochrome mark, brand guide with typography rules, and 10 editable social media templates.",
  },
  {
    value: "content_writing",
    label: "Content Writing",
    icon: "✍️",
    description: "SEO blog posts, website copywriting, technical docs, or email copy.",
    example:
      "Client needs 6 high-ranking SEO articles (approx 1,500 words each) covering freelance business management, invoice factoring, and international client billing.",
  },
];

export default function NewProposalPage() {
  const [service, setService] = useState<ServiceType>("web_development");
  const [brief, setBrief] = useState("");
  const [briefError, setBriefError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Pisahkan state validasi form dari state respons analisis
  const [analysisResult, setAnalysisResult] =
    useState<AnalyzeBriefResponse | null>(null);
  const [validationNotice, setValidationNotice] = useState<string | null>(null);
  const [apiError, setApiError] = useState<{
    message: string;
    code?: string;
  } | null>(null);

  function validateBrief(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Brief cannot be empty. Please explain the client's project requirements.";
    }
    if (trimmed.length < 20) {
      return `Brief is too short (${trimmed.length}/20 characters). Minimum 20 characters required.`;
    }
    return null;
  }

  function handleBriefChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = event.target.value;
    setBrief(newValue);
    if (validationNotice) setValidationNotice(null);
    if (apiError) setApiError(null);
    if (analysisResult) setAnalysisResult(null);

    // Perbarui atau hapus pesan error secara dinamis jika sudah pernah submit
    if (hasAttemptedSubmit) {
      setBriefError(validateBrief(newValue));
    }
  }

  function handleApplyExample(exampleText: string) {
    setBrief(exampleText);
    if (validationNotice) setValidationNotice(null);
    if (apiError) setApiError(null);
    if (analysisResult) setAnalysisResult(null);

    if (hasAttemptedSubmit) {
      setBriefError(validateBrief(exampleText));
    }
  }

  async function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAnalyzing) return;

    setHasAttemptedSubmit(true);
    const errorMsg = validateBrief(brief);

    if (errorMsg) {
      setBriefError(errorMsg);
      return;
    }

    setBriefError(null);
    setApiError(null);
    setValidationNotice(null);
    setAnalysisResult(null);
    setIsAnalyzing(true);

    try {
      const payload: AnalyzeBriefRequest = {
        brief: brief.trim(),
        serviceType: service,
      };

      // Melakukan request nyata ke endpoint backend
      const response = await fetch("/api/briefs/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const json =
          (await response.json()) as ApiSuccessBody<AnalyzeBriefResponse>;
        setAnalysisResult(json.data);
        setValidationNotice(null);
        setApiError(null);
      } else {
        let errorData: ApiErrorBody | null = null;
        try {
          errorData = (await response.json()) as ApiErrorBody;
        } catch {
          // Respons bukan JSON
        }

        const errorCode = errorData?.error?.code || String(response.status);
        const serverMessage = errorData?.error?.message;

        if (response.status === 401) {
          setApiError({
            code: "UNAUTHORIZED",
            message:
              serverMessage ||
              "Sesi login tidak ditemukan (401 Unauthorized). Endpoint analisis AI memerlukan autentikasi Supabase yang valid.",
          });
        } else if (response.status === 429) {
          setApiError({
            code: "RATE_LIMITED",
            message:
              serverMessage ||
              "Batas analisis tercapai (429 Rate Limited). Maksimal 20 analisis per jam per pengguna.",
          });
        } else if (response.status === 502) {
          setApiError({
            code: "AI_UNAVAILABLE",
            message:
              serverMessage ||
              "Layanan AI Claude sedang tidak dapat diakses atau kuota saldo Anthropic pada backend sedang tidak mencukupi (502 Bad Gateway).",
          });
        } else if (response.status === 400) {
          setApiError({
            code: "VALIDATION_ERROR",
            message:
              serverMessage ||
              "Data brief atau kategori layanan tidak valid sesuai skema backend (400 Bad Request).",
          });
        } else if (response.status === 404) {
          setApiError({
            code: "404_NOT_FOUND",
            message:
              "Endpoint POST /api/briefs/analyze belum aktif di runtime branch ini (404 Not Found). Menunggu penggabungan branch Backend (feature/backend-ai-paypal).",
          });
        } else {
          setApiError({
            code: errorCode,
            message:
              serverMessage ||
              `Permintaan analisis gagal dengan status HTTP ${response.status}.`,
          });
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      setApiError({
        code: "NETWORK_ERROR",
        message:
          error.message ||
          "Gagal terhubung ke server. Periksa koneksi jaringan Anda.",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  const isInvalidBrief = Boolean(hasAttemptedSubmit && briefError);
  const activeServiceObj =
    services.find((s) => s.value === service) || services[0];

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 antialiased selection:bg-indigo-500 selection:text-white">
      <div className="flex min-h-screen">
        {/* Sidebar Navigasi */}
        <Sidebar
          activePage="new-proposal"
          isMobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />

        {/* Konten Halaman New Proposal */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header Bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md sm:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMobileNavOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 md:hidden"
                aria-label="Open navigation menu"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>

              {/* Breadcrumb Navigation */}
              <nav className="flex items-center gap-1.5 text-xs text-slate-400">
                <Link
                  href="/"
                  className="font-medium text-slate-500 hover:text-slate-800 transition"
                >
                  Dashboard
                </Link>
                <span>/</span>
                <span className="font-semibold text-slate-900">
                  New Proposal
                </span>
              </nav>
            </div>

            {/* Back to Dashboard Link & Sandbox Tag */}
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                PayPal Sandbox Pending
              </span>

              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900"
              >
                <span>←</span>
                <span>Back to Dashboard</span>
              </Link>
            </div>
          </header>

          {/* Main Form & Results Container */}
          <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
            {/* Page Title & Context */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 bg-indigo-50/80 px-3 py-0.5 text-[11px] font-semibold text-indigo-700 mb-2">
                  <span>⚡</span>
                  <span>AI Scope & Proposal Generator</span>
                </div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                  Create a New Project Proposal
                </h1>
                <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
                  Paste the raw brief from your client conversation. Niagora AI
                  will structure it into milestones, deliverable hours,
                  clarification questions, and escrow-ready estimates.
                </p>
              </div>

              <Link
                href="/"
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
              >
                <span>Dashboard overview</span>
                <span>→</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
              {/* KOLOM KIRI: FORM BRIEF & CATEGORY (7 Kolom) */}
              <section className="lg:col-span-7 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7">
                <form onSubmit={handleAnalyze} className="space-y-6">
                  {/* Service Category Selection */}
                  <div>
                    <label
                      htmlFor="service-category"
                      className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500"
                    >
                      1. Select Service Category
                    </label>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {services.map((item) => {
                        const isSelected = service === item.value;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              setService(item.value);
                              if (!brief) {
                                handleApplyExample(item.example);
                              }
                            }}
                            className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                              isSelected
                                ? "border-indigo-600 bg-indigo-50/60 text-indigo-950 shadow-2xs ring-1 ring-indigo-600"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/60"
                            }`}
                          >
                            <div>
                              <span className="text-lg">{item.icon}</span>
                              <p className="mt-1 text-xs font-bold">
                                {item.label}
                              </p>
                            </div>
                            <span className="mt-2 text-[10px] text-slate-400 line-clamp-2">
                              {item.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Client Brief Textarea */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label
                        htmlFor="brief"
                        className="text-xs font-bold uppercase tracking-wider text-slate-500"
                      >
                        2. Client Brief & Requirements
                      </label>

                      <span
                        className={`text-xs ${
                          isInvalidBrief
                            ? "font-semibold text-red-600"
                            : "text-slate-400"
                        }`}
                      >
                        {brief.trim().length} / 20 min chars
                      </span>
                    </div>

                    <div className="relative">
                      <textarea
                        id="brief"
                        name="brief"
                        value={brief}
                        onChange={handleBriefChange}
                        placeholder="Paste or write the client brief here: project objectives, features requested, technical preferences, deadline hints, and budget details..."
                        rows={8}
                        aria-invalid={isInvalidBrief}
                        aria-describedby={
                          isInvalidBrief ? "brief-error" : "brief-hint"
                        }
                        className={`w-full resize-y rounded-xl border p-4 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:ring-2 ${
                          isInvalidBrief
                            ? "border-red-500 bg-red-50/20 focus:border-red-500 focus:ring-red-100"
                            : "border-slate-200/90 focus:border-indigo-500 focus:ring-indigo-100"
                        }`}
                      />

                      {/* Shortcut Tombol Contoh Brief */}
                      <button
                        type="button"
                        onClick={() =>
                          handleApplyExample(activeServiceObj.example)
                        }
                        className="absolute bottom-3 right-3 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-2xs backdrop-blur-xs transition hover:bg-slate-100 hover:text-slate-900"
                      >
                        Use sample brief ↵
                      </button>
                    </div>

                    {isInvalidBrief ? (
                      <p
                        id="brief-error"
                        role="alert"
                        className="mt-2 text-xs font-medium text-red-600"
                      >
                        {briefError}
                      </p>
                    ) : (
                      <p
                        id="brief-hint"
                        className="mt-2 text-[11px] text-slate-400"
                      >
                        Include goals, features, and constraints. Minimum 20
                        characters after trimming.
                      </p>
                    )}
                  </div>

                  {/* Tombol Submit & Status */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isAnalyzing}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition ${
                        isAnalyzing
                          ? "cursor-not-allowed bg-indigo-400"
                          : "bg-indigo-600 shadow-indigo-500/20 hover:bg-indigo-700 active:bg-indigo-800"
                      }`}
                    >
                      {isAnalyzing ? (
                        <>
                          <Spinner size="sm" color="white" />
                          <span>Dispatching brief to AI engine...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡</span>
                          <span>Analyze Brief with AI</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              {/* KOLOM KANAN: PREVIEW HASIL ANALISIS & INTEGRASI (5 Kolom) */}
              <section className="lg:col-span-5 space-y-6">
                <AnalysisResultView
                  data={analysisResult}
                  validationStatusMessage={validationNotice}
                  errorMessage={apiError?.message}
                  errorCode={apiError?.code}
                  serviceLabel={activeServiceObj.label}
                  onRetry={() => {
                    const fakeEvent = {
                      preventDefault: () => {},
                    } as React.FormEvent<HTMLFormElement>;
                    handleAnalyze(fakeEvent);
                  }}
                />

                {/* Info Card Alur Proposal */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Workflow Reminder
                  </h3>
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-indigo-600">Step 1:</span>
                      <span>Validate and deconstruct brief deliverables.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-indigo-600">Step 2:</span>
                      <span>
                        Review task items, estimated hours, and client questions.
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-indigo-600">Step 3:</span>
                      <span>
                        Generate shareable client link & PayPal checkout.
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
