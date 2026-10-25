interface FlowStep {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  badge: string;
  isAi?: boolean;
}

const steps: FlowStep[] = [
  {
    id: "brief",
    number: "01",
    title: "Client Brief",
    subtitle: "Raw needs & requirements",
    badge: "Input",
  },
  {
    id: "ai",
    number: "02",
    title: "AI Analysis",
    subtitle: "Scopes, tasks & hour estimates",
    badge: "AI Copilot",
    isAi: true,
  },
  {
    id: "proposal",
    number: "03",
    title: "Proposal Ready",
    subtitle: "Clear deliverables & terms",
    badge: "Client view",
  },
  {
    id: "paid",
    number: "04",
    title: "Paid Project",
    subtitle: "PayPal checkout & release",
    badge: "Planned integration",
  },
];

export default function TransformationFlow() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/70 to-indigo-50/30 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white shadow-sm shadow-indigo-500/30">
            ⚡
          </span>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
            Target Freelance Lifecycle
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs backdrop-blur-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          PayPal Sandbox — Integration Pending
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={`relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-200 ${
              step.isAi
                ? "border-indigo-300/80 bg-gradient-to-b from-indigo-50/60 via-white to-purple-50/40 shadow-xs ring-1 ring-indigo-500/10"
                : "border-slate-200/80 bg-white/90 hover:border-slate-300"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[11px] font-bold ${
                    step.isAi ? "text-indigo-600" : "text-slate-400"
                  }`}
                >
                  STEP {step.number}
                </span>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                    step.isAi
                      ? "bg-indigo-600 text-white shadow-2xs shadow-indigo-500/20"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {step.badge}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {step.id === "brief" && (
                  <svg
                    className="h-4 w-4 text-slate-700"
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
                )}
                {step.id === "ai" && (
                  <svg
                    className="h-4 w-4 text-indigo-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                )}
                {step.id === "proposal" && (
                  <svg
                    className="h-4 w-4 text-slate-700"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                )}
                {step.id === "paid" && (
                  <svg
                    className="h-4 w-4 text-amber-600"
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
                )}
                <h4 className="text-sm font-bold text-slate-900">
                  {step.title}
                </h4>
              </div>

              <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                {step.subtitle}
              </p>
            </div>

            {index < steps.length - 1 && (
              <div className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white border border-slate-200 text-[10px] text-slate-400 shadow-2xs">
                  →
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
