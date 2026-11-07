import type { ReactNode } from "react";

import PrintButton from "./PrintButton";

export default function PublicProposalFrame({
  children,
  showPrint = false,
}: {
  children: ReactNode;
  showPrint?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900 antialiased">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-base font-black text-white shadow-sm">
              N
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-slate-900">Niagora AI</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-600 uppercase">
                  Client Portal
                </span>
              </div>
              <p className="hidden text-[11px] text-slate-500 sm:block">
                Transparent Freelance Project Proposals
              </p>
            </div>
          </div>
          {showPrint ? <PrintButton /> : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
        <div className="mx-auto max-w-4xl px-4">
          <p>© Niagora AI. AI-powered freelance proposal copilot.</p>
        </div>
      </footer>
    </div>
  );
}
