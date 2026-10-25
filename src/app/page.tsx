
"use client";

import { useState } from "react";

const services = [
  { value: "web_development", label: "Web Development" },
  { value: "graphic_design", label: "Graphic Design" },
  { value: "content_writing", label: "Content Writing" },
];

export default function Home() {
  const [brief, setBrief] = useState("");
  const [service, setService] = useState("web_development");
  const [result, setResult] = useState("");

  function handleAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (brief.trim().length < 20) {
      setResult("Brief terlalu singkat. Tambahkan detail kebutuhan klien, minimal 20 karakter.");
      return;
    }

    setResult(
      "Brief berhasil disiapkan! Tahap berikutnya adalah menghubungkan form ini ke API analisis AI."
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fc] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-6 md:flex md:flex-col">
          <a href="/" className="mb-10 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
              N
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">Niagora AI</p>
              <p className="text-xs text-slate-500">Freelance workspace</p>
            </div>
          </a>

          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>

          <nav className="space-y-2">
            <a
              href="#dashboard"
              className="flex items-center gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700"
            >
              <span>▦</span> Dashboard
            </a>
            <a
              href="#new-proposal"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <span>＋</span> New proposal
            </a>
            <a
              href="#projects"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <span>▤</span> Projects
            </a>
            <a
              href="#payments"
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              <span>↗</span> Payments
            </a>
          </nav>

          <div className="mt-auto rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold">From brief to payment</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Organize client requests, prepare proposals, and track payments in one workspace.
            </p>
          </div>
        </aside>

        <section id="dashboard" className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
            <div className="md:hidden">
              <p className="font-bold">Niagora AI</p>
              <p className="text-xs text-slate-500">Freelance workspace</p>
            </div>

            <div className="hidden md:block">
              <p className="text-sm text-slate-500">Workspace / Dashboard</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-500 sm:block">
                Freelancer workspace
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                F
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-10">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-sm font-semibold text-indigo-600">
                  YOUR FREELANCE COMMAND CENTER
                </p>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  Turn ideas into paid projects.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
                  Analyze client requests, define deliverables, and prepare clearer
                  proposals with the help of AI.
                </p>
              </div>

              <a
                href="#new-proposal"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                + Create proposal
              </a>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total projects" value="0" detail="Projects created" />
              <StatCard label="Pending proposals" value="0" detail="Awaiting client response" />
              <StatCard label="Paid projects" value="0" detail="Successfully paid" />
              <StatCard label="Revenue received" value="$0.00" detail="Verified payments only" />
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)]">
              <section
                id="new-proposal"
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
              >
                <div className="mb-6">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600">
                    ✳
                  </div>
                  <h2 className="text-xl font-bold">Analyze a client brief</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Describe what your client needs. Niagora AI will help turn the
                    request into a structured project proposal.
                  </p>
                </div>

                <form onSubmit={handleAnalyze} className="space-y-5">
                  <div>
                    <label
                      htmlFor="service"
                      className="mb-2 block text-sm font-semibold"
                    >
                      Service category
                    </label>
                    <select
                      id="service"
                      value={service}
                      onChange={(event) => setService(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    >
                      {services.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label
                        htmlFor="brief"
                        className="text-sm font-semibold"
                      >
                        Client brief
                      </label>
                      <span className="text-xs text-slate-400">
                        {brief.length} characters
                      </span>
                    </div>
                    <textarea
                      id="brief"
                      value={brief}
                      onChange={(event) => {
                        setBrief(event.target.value);
                        setResult("");
                      }}
                      placeholder="Example: I need an online store with a product catalog, shopping cart, checkout, and an admin dashboard to manage orders..."
                      rows={7}
                      className="w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="mt-2 text-xs text-slate-400">
                      Include the client’s goals, requested features, and any known requirements.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    ✳ Analyze brief
                  </button>

                  {result && (
                    <div
                      role="status"
                      className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-800"
                    >
                      {result}
                    </div>
                  )}
                </form>
              </section>

              <div className="space-y-6">
                <section className="rounded-2xl bg-slate-900 p-6 text-white">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">
                      Your workflow
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs">
                      4 steps
                    </span>
                  </div>
                  <h2 className="text-xl font-bold">
                    From request to revenue
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Keep every stage of your freelance project organized.
                  </p>

                  <div className="mt-6 space-y-4">
                    <WorkflowStep number="01" title="Analyze brief" detail="Understand client requirements" active />
                    <WorkflowStep number="02" title="Build proposal" detail="Define scope and pricing" />
                    <WorkflowStep number="03" title="Get approval" detail="Share with your client" />
                    <WorkflowStep number="04" title="Receive payment" detail="Checkout securely with PayPal" />
                  </div>
                </section>

                <section id="projects" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="font-bold">Recent projects</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Your projects will appear here after you create your first proposal.
                  </p>
                  <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center">
                    <div className="text-2xl text-slate-300">▤</div>
                    <p className="mt-2 text-sm font-medium text-slate-600">
                      No projects yet
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Start by analyzing a client brief.
                    </p>
                  </div>
                </section>

                <div id="payments" className="px-1 text-xs leading-5 text-slate-400">
                  Payment status and revenue will be populated from verified
                  backend payment records when the integration is implemented.
                </div>
              </div>
            </div>

            <footer className="border-t border-slate-200 pt-5 text-xs text-slate-400">
              Niagora AI · From client request to paid project.
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function WorkflowStep({
  number,
  title,
  detail,
  active = false,
}: {
  number: string;
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${active
            ? "bg-indigo-500 text-white"
            : "bg-white/10 text-slate-300"
          }`}
      >
        {number}
      </div>
      <div className="pt-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-slate-400">{detail}</p>
      </div>
    </div>
  );
}
