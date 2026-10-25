import { AnalyzeBriefResponse } from "@/types/analysis";

interface AnalysisResultViewProps {
  data: AnalyzeBriefResponse | null;
  validationStatusMessage?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  serviceLabel?: string;
  onRetry?: () => void;
}

export default function AnalysisResultView({
  data,
  validationStatusMessage,
  errorMessage,
  errorCode,
  serviceLabel,
  onRetry,
}: AnalysisResultViewProps) {
  // 1. Tampilan jika terdapat error dari API backend (400, 401, 429, 502, dsb)
  if (errorMessage) {
    const isAuthError = errorCode === "UNAUTHORIZED" || errorCode === "401";
    const isAiUnavailable = errorCode === "AI_UNAVAILABLE" || errorCode === "502";
    const isRateLimited = errorCode === "RATE_LIMITED" || errorCode === "429";

    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/70 p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-600 text-xs font-bold text-white shadow-sm">
            !
          </div>
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-red-800">
                {isAuthError
                  ? "Authentication Required"
                  : isAiUnavailable
                  ? "AI Service Unavailable"
                  : isRateLimited
                  ? "Rate Limit Reached"
                  : "Analysis Request Failed"}
              </span>
              {errorCode && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-red-700">
                  {errorCode}
                </span>
              )}
            </div>

            <p className="text-xs text-red-950 font-medium leading-relaxed">
              {errorMessage}
            </p>

            {/* Informasi kontekstual untuk masing-masing error */}
            {isAuthError && (
              <p className="text-[11px] text-red-800/80 leading-relaxed pt-1">
                Endpoint <code className="bg-red-100/80 px-1 py-0.5 rounded font-mono">POST /api/briefs/analyze</code> memerlukan sesi Supabase Auth yang valid. Silakan login terlebih dahulu untuk mengakses analisis AI.
              </p>
            )}

            {isAiUnavailable && (
              <p className="text-[11px] text-red-800/80 leading-relaxed pt-1">
                Kredit token AI/LLM pada backend sedang tidak mencukupi atau layanan model sedang sibuk. Data brief Anda tetap aman.
              </p>
            )}

            {onRetry && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-red-700 transition"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. Tampilan data sukses yang nyata dari API Backend (AnalyzeBriefResponse)
  if (data) {
    const analysis = data.analysis;
    const deliverables = analysis?.deliverables || [];
    const questions = analysis?.clarificationQuestions || [];
    const assumptions = analysis?.assumptions || [];

    return (
      <div className="space-y-6 rounded-2xl border border-indigo-200/90 bg-white p-6 shadow-sm">
        {/* Header Hasil Analisis */}
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">
                ⚡
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                Verified AI Scope Breakdown
              </span>
              {data.briefId && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                  ID: {data.briefId.slice(0, 8)}...
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              {serviceLabel || data.serviceType} Project Scope
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-900">
              ⏱ Total: {data.totalEstimatedHours} hours
            </span>
          </div>
        </div>

        {/* Executive Summary */}
        {analysis?.summary && (
          <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-700 leading-relaxed border border-slate-100">
            <p className="font-semibold text-slate-900 mb-1">Scope Summary</p>
            <p>{analysis.summary}</p>
          </div>
        )}

        {/* Deliverables List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Deliverables & Estimates ({deliverables.length})
            </h4>
            <span className="text-[11px] text-slate-400">Hours breakdown</span>
          </div>

          {deliverables.length > 0 ? (
            <div className="space-y-2.5">
              {deliverables.map((item, index) => (
                <div
                  key={item.id || index}
                  className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-3.5 transition hover:border-slate-300"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold text-slate-600">
                        {index + 1}
                      </span>
                      <p className="text-xs font-bold text-slate-900">{item.title}</p>
                    </div>
                    {item.description && (
                      <p className="text-[11px] text-slate-500 leading-relaxed pl-7">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {item.estimatedHours !== undefined && (
                    <span className="shrink-0 self-start sm:self-center rounded-lg bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 text-[11px] border border-indigo-100">
                      {item.estimatedHours} hrs
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 text-xs text-slate-500 text-center">
              No estimated deliverables generated. Review clarification questions below.
            </div>
          )}
        </div>

        {/* Clarification Questions */}
        {questions.length > 0 && (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
            <h4 className="text-xs font-bold text-amber-900 mb-2 flex items-center gap-1.5">
              <span>❓</span> Questions for Client Clarification
            </h4>
            <ul className="space-y-1.5 text-xs text-amber-950/80 pl-4 list-disc">
              {questions.map((q, idx) => (
                <li key={idx}>{q}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Assumptions */}
        {assumptions.length > 0 && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4">
            <h4 className="text-xs font-bold text-slate-700 mb-2">
              Scope Assumptions & Boundaries
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-600 pl-4 list-disc">
              {assumptions.map((a, idx) => (
                <li key={idx}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // 3. State ketika form telah divalidasi dan menunggu eksekusi/respons backend
  if (validationStatusMessage) {
    return (
      <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/90 via-white to-purple-50/50 p-5 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white shadow-sm">
            ✓
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-sm font-bold text-indigo-950">
                Brief Validation Succeeded
              </p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {validationStatusMessage}
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50/80 p-3 text-xs text-amber-900 leading-relaxed">
              <span className="font-semibold">Status Integrasi:</span> Request terkirim ke endpoint backend{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                POST /api/briefs/analyze
              </code>
              . Frontend tidak menampilkan deliverables palsu jika belum menerima respons 200 OK yang terverifikasi.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 4. Default Empty State (sebelum form di-submit)
  return (
    <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl text-indigo-600">
        ⚡
      </div>
      <h3 className="mt-3 text-sm font-bold text-slate-800">
        AI Analysis Results Area
      </h3>
      <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
        Fill in the client brief and click &quot;Analyze Brief with AI&quot;. The structured deliverables, estimated hours, and client questions will appear here.
      </p>
    </div>
  );
}
