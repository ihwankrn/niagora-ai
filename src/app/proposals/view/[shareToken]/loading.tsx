import Spinner from "@/components/Spinner";

import PublicProposalFrame from "./PublicProposalFrame";

export default function PublicProposalLoading() {
  return (
    <PublicProposalFrame>
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
        <div className="flex justify-center">
          <Spinner size="lg" color="indigo" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">Loading Proposal</h2>
          <p className="text-xs text-slate-500">
            Retrieving verified project scope and quote details from server...
          </p>
        </div>
      </div>
    </PublicProposalFrame>
  );
}
