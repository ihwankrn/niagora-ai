"use client";

import { useState } from "react";

import type { PublicProposalApiResponse } from "@/lib/contracts/public-proposals";
import type { ProposalStatus } from "@/lib/contracts/proposals";
import { formatCents } from "@/types/proposals";

import PublicProposalPayment from "./PublicProposalPayment";
import PublicProposalFrame from "./PublicProposalFrame";

function getStatusBadge(status: ProposalStatus) {
  switch (status) {
    case "paid":
      return {
        label: "Paid & Confirmed",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "approved":
      return {
        label: "Approved by Client",
        className: "border-teal-200 bg-teal-50 text-teal-700",
      };
    case "sent":
      return {
        label: "Awaiting Client Acceptance",
        className: "border-blue-200 bg-blue-50 text-blue-700",
      };
    case "invoiced":
      return {
        label: "Invoiced",
        className: "border-sky-200 bg-sky-50 text-sky-700",
      };
    case "draft":
      return {
        label: "Draft Preview",
        className: "border-slate-200 bg-slate-100 text-slate-700",
      };
    case "rejected":
      return {
        label: "Declined",
        className: "border-rose-200 bg-rose-50 text-rose-700",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    default:
      return {
        label: status,
        className: "border-slate-200 bg-slate-100 text-slate-600",
      };
  }
}

export default function PublicProposalView({
  data,
  shareToken,
}: {
  data: PublicProposalApiResponse;
  shareToken: string;
}) {
  const [status, setStatus] = useState(data.status);
  const badge = getStatusBadge(status);

  return (
    <PublicProposalFrame showPrint>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs sm:p-5">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wider uppercase ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs sm:p-8">
          <div className="space-y-3 border-b border-slate-100 pb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{data.title}</h1>

            <div className="pt-2">
              {data.freelancerName ? (
                <div className="space-y-0.5 rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                  <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                    Prepared By
                  </span>
                  <p className="text-sm font-bold text-slate-800">{data.freelancerName}</p>
                </div>
              ) : null}
            </div>
          </div>

          {data.summary ? (
            <div className="space-y-2">
              <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                Project Overview & Scope
              </h2>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-xs leading-relaxed whitespace-pre-line text-slate-700 sm:text-sm">
                {data.summary}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                Deliverables & Milestones ({data.items.length})
              </h2>
              {data.totalHours > 0 ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {data.totalHours} estimated hours
                </span>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    <tr>
                      <th className="w-12 px-4 py-3 text-center">#</th>
                      <th className="px-4 py-3">Work Deliverable</th>
                      <th className="px-4 py-3 text-right">Est. Hours</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          No deliverables are listed on this proposal.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((item) => (
                        <tr key={`${item.position}-${item.title}`} className="transition hover:bg-slate-50/50">
                          <td className="px-4 py-3.5 text-center font-mono text-slate-400">{item.position + 1}</td>
                          <td className="space-y-0.5 px-4 py-3.5">
                            <p className="text-xs font-semibold text-slate-900 sm:text-sm">{item.title}</p>
                            {item.description ? (
                              <p className="text-[11px] text-slate-500">{item.description}</p>
                            ) : null}
                            <p className="text-[11px] text-slate-500">
                              {formatCents(item.hourlyRateCents, data.currency)} / hour
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-right font-medium whitespace-nowrap text-slate-700">
                            {item.estimatedHours} hrs
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold whitespace-nowrap text-slate-900">
                            {formatCents(item.amountCents, data.currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-slate-50 p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-indigo-100/80 pb-4 sm:flex-row sm:items-center">
              <div>
                <span className="block text-[11px] font-semibold tracking-wider text-indigo-700 uppercase">
                  Financial Summary
                </span>
                <p className="mt-0.5 text-xs text-slate-600">
                  Deterministic calculation based on agreed deliverables. Zero hidden fees.
                </p>
              </div>
              <div className="text-right">
                <span className="block text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  Currency
                </span>
                <span className="text-xs font-bold text-slate-800">{data.currency}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>Total Estimated Work:</span>
                <span className="font-semibold text-slate-800">{data.totalHours} hours</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-800">
                  {formatCents(data.subtotalCents, data.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-indigo-100 pt-2">
                <div>
                  <span className="block text-sm font-bold text-slate-900">Total Project Estimate</span>
                  <span className="text-[11px] text-slate-500">Exact amount payable upon acceptance</span>
                </div>
                <span className="text-2xl font-extrabold tracking-tight text-indigo-700 sm:text-3xl">
                  {formatCents(data.totalCents, data.currency)}
                </span>
              </div>
            </div>
          </div>

          <PublicProposalPayment
            token={shareToken}
            initialStatus={status}
            currency={data.currency}
            totalCents={data.totalCents}
            onStatusChange={setStatus}
          />
        </div>
      </div>
    </PublicProposalFrame>
  );
}
