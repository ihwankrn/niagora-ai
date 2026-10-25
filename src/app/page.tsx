"use client";

import { useState } from "react";
import Link from "next/link";
import StatCard from "@/components/StatCard";
import Sidebar from "@/components/Sidebar";
import Spinner from "@/components/Spinner";
import TransformationFlow from "@/components/TransformationFlow";

const services = [
  {
    value: "web_development",
    label: "Web Development",
    icon: "💻",
    example:
      "I need a responsive 5-page marketing website for a SaaS startup with dynamic pricing tables, contact forms, and PayPal subscription checkout.",
  },
  {
    value: "graphic_design",
    label: "Graphic Design",
    icon: "🎨",
    example:
      "We need a complete brand identity package including modern logo variations, color palette, brand guidelines, and social media templates.",
  },
  {
    value: "content_writing",
    label: "Content Writing",
    icon: "✍️",
    example:
      "Need 8 SEO-optimized blog articles (1,200 words each) covering freelance finance, client invoicing strategies, and PayPal cross-border payments.",
  },
];

export default function Home() {
  const [brief, setBrief] = useState("");
  const [service, setService] = useState("web_development");
  const [result, setResult] = useState("");
  const [briefError, setBriefError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<
    "all" | "draft" | "sent" | "paid"
  >("all");

  function validateBrief(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Brief cannot be empty. Please explain the client's project requirements.";
    }
    if (trimmed.length < 20) {
      return `Brief is too short (${trimmed.length}/20 characters). Add more project details, minimum 20 characters.`;
    }
    return null;
  }

  function handleBriefChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = event.target.value;
    setBrief(newValue);
    if (result) setResult("");

    // Dynamically clear or update error message if user already submitted once
    if (hasAttemptedSubmit) {
      setBriefError(validateBrief(newValue));
    }
  }

  function handleApplyExample(exampleText: string) {
    setBrief(exampleText);
    if (result) setResult("");
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
    setIsAnalyzing(true);

    try {
      // Integration note: AI backend endpoint contract is pending coordinator agreement.
      // try-finally ensures the loading state is safely released without fake progress.
      setResult(
        "Brief successfully validated! The AI analysis engine is currently awaiting backend endpoint deployment. Scope breakdown and PayPal estimate generation will be rendered here once connected."
      );
    } catch {
      setResult(
        "An unexpected error occurred while validating the brief. Please try again."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  const isInvalidBrief = Boolean(hasAttemptedSubmit && briefError);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 antialiased selection:bg-indigo-500 selection:text-white">
      <div className="flex min-h-screen">
        {/* Main Sidebar */}
        <Sidebar
          activePage="dashboard"
          isMobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />

        {/* Dashboard Main Canvas */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Header Bar */}
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

              <div className="hidden sm:block">
                <nav className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="font-medium text-slate-700">Workspace</span>
                  <span>/</span>
                  <span className="text-slate-500">Dashboard</span>
                </nav>
              </div>

              <div className="sm:hidden font-bold text-slate-900 tracking-tight">
                Niagora <span className="text-indigo-600">AI</span>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-slate-200/90 bg-slate-50/80 px-3 py-1.5 text-xs font-medium text-slate-600 md:flex">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span>PayPal Sandbox — Integration Pending</span>
              </div>

              <Link
                href="/new-proposal"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800"
              >
                <span>+</span>
                <span className="hidden sm:inline">New Proposal</span>
                <span className="sm:hidden">Proposal</span>
              </Link>
            </div>
          </header>

          {/* Main Scrollable Content */}
          <div className="mx-auto w-full max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
            {/* HERO SECTION */}
            <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8">
              <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 bg-indigo-50/80 px-3 py-1 text-xs font-semibold text-indigo-700 shadow-2xs">
                    <span className="text-[10px]">✨</span>
                    <span>AI-Powered Freelance Business Copilot</span>
                  </div>

                  <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-4xl sm:leading-tight">
                    Turn ideas into{" "}
                    <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                      paid projects.
                    </span>
                  </h1>

                  <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                    Transform unstructured client briefs into detailed scope
                    breakdowns, realistic hours, ready-to-sign proposals, and
                    planned PayPal escrow settlement.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/new-proposal"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-700 active:bg-indigo-800"
                  >
                    <span>⚡</span>
                    <span>Analyze Brief Now</span>
                  </Link>
                  <a
                    href="#lifecycle"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
                  >
                    View Pipeline
                  </a>
                </div>
              </div>

              {/* Lifecycle Transformation Diagram */}
              <div id="lifecycle" className="mt-8 pt-6 border-t border-slate-100">
                <TransformationFlow />
              </div>
            </section>

            {/* METRICS / STATS OVERVIEW */}
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard
                label="Total Projects"
                value="0"
                detail="All workspace initiatives"
                badge="Active"
                icon={
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                }
              />
              <StatCard
                label="Pending Proposals"
                value="0"
                detail="Awaiting client acceptance"
                badge="In Review"
                icon={
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                }
              />
              <StatCard
                label="Paid Projects"
                value="0"
                detail="Settled via PayPal"
                badge="Completed"
                icon={
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
              />
              <StatCard
                label="Total Revenue"
                value="$0.00"
                detail="Verified sandbox payouts"
                badge="USD"
                icon={
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
              />
            </section>

            {/* CORE WORKSPACE GRID: BRIEF ANALYZER & PIPELINE */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* PRIMARY COLUMN: AI BRIEF ANALYZER (STAR FEATURE) */}
              <section
                id="new-proposal"
                className="lg:col-span-7 xl:col-span-8 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7"
              >
                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-lg text-white shadow-sm shadow-indigo-500/20">
                      ⚡
                    </div>
                    <div>
                      <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                        Analyze a Client Brief
                      </h2>
                      <p className="text-xs text-slate-500">
                        Input client chat, audio note, or requirements summary.
                      </p>
                    </div>
                  </div>

                  <span className="w-fit rounded-full border border-indigo-100 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                    Step 1 of 4
                  </span>
                </div>

                <form onSubmit={handleAnalyze} className="space-y-6">
                  {/* Service Category Pills */}
                  <div>
                    <label
                      htmlFor="service-category"
                      className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500"
                    >
                      Service Category
                    </label>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                            className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                              isSelected
                                ? "border-indigo-600 bg-indigo-50/50 text-indigo-900 shadow-2xs ring-1 ring-indigo-600"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/60"
                            }`}
                          >
                            <span className="text-base">{item.icon}</span>
                            <span className="text-xs font-semibold">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Client Brief Input */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label
                        htmlFor="brief"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                      >
                        Client Brief Details
                      </label>

                      <div className="flex items-center gap-2">
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
                    </div>

                    <div className="relative">
                      <textarea
                        id="brief"
                        name="brief"
                        value={brief}
                        onChange={handleBriefChange}
                        placeholder="Describe what your client is asking for, key features, expected deliverables, and any known timelines..."
                        rows={7}
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

                      {/* Quick Sample Brief Shortcut */}
                      <button
                        type="button"
                        onClick={() => {
                          const currentService =
                            services.find((s) => s.value === service) ||
                            services[0];
                          handleApplyExample(currentService.example);
                        }}
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
                        Tip: You can paste raw client WhatsApp messages, email
                        threads, or quick notes. Minimum 20 characters required.
                      </p>
                    )}
                  </div>

                  {/* Submit Button */}
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
                          <span>Analyzing brief with AI engine...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡</span>
                          <span>Generate Project Scope & Estimate</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Analysis Result Banner */}
                  {result && (
                    <div
                      role="status"
                      className="rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-purple-50/70 p-4 text-xs leading-relaxed text-indigo-950 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">
                          ✓
                        </span>
                        <div>
                          <p className="font-bold text-indigo-900">
                            Brief Verification Complete
                          </p>
                          <p className="mt-1 text-slate-600">{result}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </form>
              </section>

              {/* SECONDARY COLUMN: PIPELINE STATUS & QUICK GUIDE */}
              <div className="lg:col-span-5 xl:col-span-4 space-y-6">
                {/* Proposal Lifecycle Monitor */}
                <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                      <span className="text-xs font-semibold tracking-wider uppercase text-slate-300">
                        Pipeline Monitor
                      </span>
                    </div>
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
                      Standard Track
                    </span>
                  </div>

                  <h3 className="mt-3 text-base font-bold text-white">
                    Proposal Health & Status
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Track the stages from client brief ingestion to completed
                    PayPal payment release.
                  </p>

                  <div className="mt-5 space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-xs border border-white/5">
                      <span className="text-slate-300">1. Brief Ingestion</span>
                      <span className="font-semibold text-emerald-400">
                        Ready
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-xs border border-white/5">
                      <span className="text-slate-300">2. Scope Breakdown</span>
                      <span className="text-slate-400">Pending AI</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-xs border border-white/5">
                      <span className="text-slate-300">3. Client Approval</span>
                      <span className="text-slate-400">Draft mode</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-xs border border-white/5">
                      <span className="text-slate-300">4. PayPal Escrow</span>
                      <span className="font-semibold text-indigo-300">
                        Sandbox Mode
                      </span>
                    </div>
                  </div>
                </section>

                {/* Freelancer Copilot Tips Card */}
                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Pro Freelancer Tip
                  </h3>
                  <h4 className="mt-2 text-sm font-bold text-slate-900">
                    How to get 98% accurate estimates
                  </h4>
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    Always include client constraints such as timeline
                    milestones, target audience, and third-party integrations in
                    your brief.
                  </p>

                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-[11px] text-slate-600">
                    <p className="font-semibold text-slate-800">
                      Example deliverables identified:
                    </p>
                    <ul className="mt-1.5 space-y-1 text-slate-500">
                      <li>• Wireframes & High-fidelity Prototypes</li>
                      <li>• Frontend responsive components</li>
                      <li>• PayPal Sandbox integration testing</li>
                    </ul>
                  </div>
                </section>
              </div>
            </div>

            {/* RECENT PROJECTS / PROPOSALS TABLE SECTION */}
            <section
              id="projects"
              className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-7"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-900">
                    Recent Proposals & Projects
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Manage created proposals, client feedback, and verified
                    PayPal settlements.
                  </p>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-1">
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "draft", label: "Drafts" },
                      { id: "sent", label: "Awaiting Client" },
                      { id: "paid", label: "Paid" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setProjectFilter(tab.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                        projectFilter === tab.id
                          ? "bg-white text-slate-900 shadow-2xs font-semibold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Informative Empty State */}
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200/90 bg-slate-50/40 px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-2xs">
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>

                <h3 className="mt-3.5 text-sm font-bold text-slate-800">
                  No proposals found in {projectFilter}
                </h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                  Ready to win your next client? Paste a client brief above and
                  generate your first structured proposal in seconds.
                </p>

                <div className="mt-5 flex items-center gap-3">
                  <Link
                    href="/new-proposal"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-indigo-700"
                  >
                    <span>+</span>
                    <span>Create Proposal Now</span>
                  </Link>
                </div>
              </div>
            </section>

            {/* PAYMENTS & SECURITY CALLOUT */}
            <section
              id="payments"
              className="rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xs"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      PAYPAL INTEGRATION
                    </span>
                    <span className="text-xs text-slate-400">
                      Sandbox — Integration Pending
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white">
                    Planned Payouts & Milestone Protection
                  </h3>
                  <p className="max-w-xl text-xs text-slate-300 leading-relaxed">
                    Niagora AI proposals will connect directly with PayPal checkout once backend contracts are deployed. Planned for secure client approval and milestone payouts.
                  </p>
                </div>

                <div className="shrink-0">
                  <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-200">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    PayPal Sandbox — Integration Pending
                  </span>
                </div>
              </div>
            </section>

            {/* WORKSPACE FOOTER */}
            <footer className="flex flex-col items-center justify-between gap-3 border-t border-slate-200/80 pt-6 text-xs text-slate-400 sm:flex-row">
              <p>
                Niagora AI © 2026 — AI-powered freelance proposal & PayPal
                payment engine.
              </p>
              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <a href="#dashboard" className="hover:text-slate-800">
                  Dashboard
                </a>
                <span>·</span>
                <a href="#new-proposal" className="hover:text-slate-800">
                  New Proposal
                </a>
                <span>·</span>
                <a href="#projects" className="hover:text-slate-800">
                  Projects
                </a>
                <span>·</span>
                <a href="#payments" className="hover:text-slate-800">
                  Payments
                </a>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
