import "server-only";

import { randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/http";
import type { AuthUser } from "@/lib/auth/session";
import { type Currency, currencySchema } from "@/lib/contracts/common";
import type {
  CreateProposalRequest,
  DashboardStats,
  ListProposalsQuery,
  ListProposalsResponse,
  Proposal,
  ProposalStatus,
} from "@/lib/contracts/proposals";
import { prisma } from "@/lib/db";
import { calculateQuoteOrThrow } from "@/lib/quotes/service";
import type { Prisma, ProposalStatus as DbProposalStatus } from "@/generated/prisma/client";

const STATUS_FROM_DB: Record<DbProposalStatus, ProposalStatus> = {
  DRAFT: "draft",
  SENT: "sent",
  APPROVED: "approved",
  REJECTED: "rejected",
  PAID: "paid",
  CANCELLED: "cancelled",
};

// Only payments that were captured and then verified against the PayPal API
// count as paid or as revenue.
const VERIFIED_PAYMENT: Prisma.PaymentWhereInput = { status: "COMPLETED", verifiedAt: { not: null } };

const proposalWithItems = {
  include: { items: { orderBy: { position: "asc" } } },
} satisfies Prisma.ProposalDefaultArgs;
type ProposalWithItems = Prisma.ProposalGetPayload<typeof proposalWithItems>;

function toCurrency(value: string): Currency {
  return currencySchema.parse(value.trim());
}

function toProposal(record: ProposalWithItems): Proposal {
  const items = record.items.map((item) => ({
    position: item.position,
    title: item.title,
    description: item.description,
    estimatedHours: item.estimatedHours.toNumber(),
    hourlyRateCents: item.hourlyRateCents,
    amountCents: item.amountCents,
  }));
  const totalHundredths = items.reduce((sum, item) => sum + Math.round(item.estimatedHours * 100), 0);

  return {
    id: record.id,
    briefId: record.briefId,
    title: record.title,
    summary: record.summary,
    clientName: record.clientName,
    clientEmail: record.clientEmail,
    status: STATUS_FROM_DB[record.status],
    currency: toCurrency(record.currency),
    hourlyRateCents: record.hourlyRateCents,
    items,
    totalHours: totalHundredths / 100,
    subtotalCents: record.subtotalCents,
    totalCents: record.totalCents,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    paidAt: record.paidAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function createProposal(user: AuthUser, input: CreateProposalRequest): Promise<Proposal> {
  if (input.briefId) {
    // Same 404 whether the brief is missing or owned by someone else.
    const brief = await prisma.brief.findFirst({ where: { id: input.briefId, userId: user.id }, select: { id: true } });
    if (!brief) {
      throw new ApiError("NOT_FOUND", "Brief not found");
    }
  }

  // Prices come only from the server-side quote engine.
  const quote = calculateQuoteOrThrow({ currency: input.currency, hourlyRateCents: input.hourlyRateCents, items: input.items });

  const record = await prisma.proposal.create({
    data: {
      userId: user.id,
      briefId: input.briefId ?? null,
      title: input.title,
      summary: input.summary ?? null,
      clientName: input.clientName ?? null,
      clientEmail: input.clientEmail ?? null,
      currency: quote.currency,
      hourlyRateCents: quote.hourlyRateCents,
      subtotalCents: quote.subtotalCents,
      totalCents: quote.totalCents,
      shareToken: randomBytes(32).toString("base64url"),
      items: {
        create: quote.items.map((item) => ({
          position: item.position,
          title: item.title,
          description: item.description,
          estimatedHours: item.estimatedHours,
          hourlyRateCents: item.hourlyRateCents,
          amountCents: item.amountCents,
        })),
      },
    },
    ...proposalWithItems,
  });

  return toProposal(record);
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const [totalProjects, pendingProposals, paidProjects, revenue] = await Promise.all([
    prisma.proposal.count({ where: { userId } }),
    prisma.proposal.count({ where: { userId, status: "SENT" } }),
    prisma.proposal.count({ where: { userId, payments: { some: VERIFIED_PAYMENT } } }),
    prisma.payment.groupBy({
      by: ["currency"],
      where: { ...VERIFIED_PAYMENT, proposal: { userId } },
      _sum: { amountCents: true },
      orderBy: { currency: "asc" },
    }),
  ]);

  return {
    totalProjects,
    pendingProposals,
    paidProjects,
    revenueReceived: revenue.map((row) => ({
      currency: toCurrency(row.currency),
      amountCents: row._sum.amountCents ?? 0,
    })),
  };
}

export async function listProposals(user: AuthUser, query: ListProposalsQuery): Promise<ListProposalsResponse> {
  const [records, stats] = await Promise.all([
    prisma.proposal.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      select: { id: true, title: true, clientName: true, status: true, currency: true, totalCents: true, createdAt: true },
    }),
    getDashboardStats(user.id),
  ]);

  return {
    items: records.map((record) => ({
      id: record.id,
      title: record.title,
      clientName: record.clientName,
      status: STATUS_FROM_DB[record.status],
      currency: toCurrency(record.currency),
      totalCents: record.totalCents,
      createdAt: record.createdAt.toISOString(),
    })),
    stats,
  };
}
