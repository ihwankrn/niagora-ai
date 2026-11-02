"use client";

import { useEffect, useState } from "react";

import Spinner from "@/components/Spinner";
import {
  publicProposalTokenParamSchema,
  type PublicProposalApiResponse,
} from "@/lib/contracts/public-proposals";
import { fetchPublicProposal, PublicProposalNotFoundError } from "@/lib/proposals/public-client";

import PublicProposalFrame from "./PublicProposalFrame";
import PublicProposalView from "./PublicProposalView";
import ReloadButton from "./ReloadButton";

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; proposal: PublicProposalApiResponse };

function NotFoundState() {
  return (
    <PublicProposalFrame>
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-xs sm:p-14">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-2xl">
          🔍
        </div>
        <div className="mx-auto max-w-md space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Proposal Not Found</h1>
          <p className="text-xs leading-relaxed text-slate-600">
            This proposal link is invalid or the proposal is no longer available.
          </p>
        </div>
        <div className="mx-auto max-w-md space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-4 text-left text-xs text-slate-500">
          <p className="font-semibold text-slate-700">What should you do?</p>
          <p>Verify that you copied the complete link shared by your freelancer.</p>
          <p>If the issue persists, request an updated share link.</p>
        </div>
      </div>
    </PublicProposalFrame>
  );
}

function ErrorState() {
  return (
    <PublicProposalFrame>
      <div className="space-y-6 rounded-2xl border border-rose-200 bg-white p-10 text-center shadow-xs sm:p-14">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-2xl">
          ⚠️
        </div>
        <div className="mx-auto max-w-md space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Temporary Service Issue</h1>
          <p className="text-xs leading-relaxed text-slate-600">
            We could not load this proposal. Check your connection and try again.
          </p>
        </div>
        <ReloadButton />
      </div>
    </PublicProposalFrame>
  );
}

function LoadingState() {
  return (
    <PublicProposalFrame>
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
        <div className="flex justify-center">
          <Spinner size="lg" color="indigo" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">Loading Proposal</h2>
          <p className="text-xs text-slate-500">Retrieving proposal details securely from the server...</p>
        </div>
      </div>
    </PublicProposalFrame>
  );
}

export default function PublicProposalClientPage({ shareToken }: { shareToken: string }) {
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    const tokenResult = publicProposalTokenParamSchema.safeParse({ token: shareToken });
    if (!tokenResult.success) {
      return;
    }

    const controller = new AbortController();

    void fetchPublicProposal(tokenResult.data.token, controller.signal).then(
      (proposal) => setState({ status: "ready", proposal }),
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: error instanceof PublicProposalNotFoundError ? "not-found" : "error",
        });
      },
    );

    return () => controller.abort();
  }, [shareToken]);

  if (!publicProposalTokenParamSchema.safeParse({ token: shareToken }).success) {
    return <NotFoundState />;
  }
  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "not-found") {
    return <NotFoundState />;
  }
  if (state.status === "error") {
    return <ErrorState />;
  }

  return <PublicProposalView data={state.proposal} />;
}
