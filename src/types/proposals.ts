export { CURRENCIES, MAX_HOURLY_RATE_CENTS, MAX_ITEM_HOURS } from "@/lib/contracts/common";
export { PROPOSAL_STATUSES } from "@/lib/contracts/proposals";
export { MAX_QUOTE_ITEMS } from "@/lib/contracts/quotes";
export type { Currency } from "@/lib/contracts/common";
export type {
  CreateProposalRequest,
  DashboardStats,
  ListProposalsQuery,
  ListProposalsResponse,
  Proposal,
  ProposalStatus,
  ProposalSummary,
} from "@/lib/contracts/proposals";
export type {
  CalculateQuoteRequest,
  Quote as QuoteCalculation,
  QuoteLine,
  QuoteItemInput,
} from "@/lib/contracts/quotes";

import type { Currency } from "@/lib/contracts/common";

export type ProposalItem = import("@/lib/contracts/quotes").QuoteLine;

export function formatCents(amountCents: number, currency: Currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToAmount(cents: number): number {
  return cents / 100;
}
