import { beforeEach, describe, expect, it, vi } from "vitest";

import { proposalSchema } from "@/lib/contracts/proposals";
import { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({
  brief: { findFirst: vi.fn() },
  proposal: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  payment: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

const { createProposal, getDashboardStats, listProposals } = await import("./service");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "freelancer@example.com" };
const briefId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-25T12:00:00.000Z");

const input = {
  briefId,
  title: "Company profile website",
  currency: "USD" as const,
  hourlyRateCents: 5_000,
  items: [
    { title: "Pages", estimatedHours: 10 },
    { title: "Form", estimatedHours: 2.5, hourlyRateCents: 6_000 },
  ],
};

// Echo what Prisma would return for the create call.
function storedRecord(args: { data: Record<string, unknown> & { items: { create: Record<string, unknown>[] } } }) {
  const { items, ...data } = args.data;
  return {
    id: "33333333-3333-4333-8333-333333333333",
    ...data,
    status: "DRAFT",
    approvedAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
    items: items.create.map((item) => ({ ...item, estimatedHours: new Prisma.Decimal(item.estimatedHours as number) })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.brief.findFirst.mockResolvedValue({ id: briefId });
  db.proposal.create.mockImplementation(async (args) => storedRecord(args));
});

describe("createProposal", () => {
  it("stores server-computed amounts and returns a contract-valid proposal", async () => {
    const proposal = await createProposal(user, input);

    const { data } = db.proposal.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: user.id, briefId, subtotalCents: 65_000, totalCents: 65_000, currency: "USD" });
    expect(data.items.create.map((item: { amountCents: number }) => item.amountCents)).toEqual([50_000, 15_000]);
    expect(data.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url

    expect(proposalSchema.parse(proposal)).toEqual(proposal);
    expect(proposal).toMatchObject({ status: "draft", totalHours: 12.5, totalCents: 65_000, summary: null });
    expect(proposal).not.toHaveProperty("shareToken");
  });

  it("checks brief ownership with the session user and returns 404 otherwise", async () => {
    db.brief.findFirst.mockResolvedValue(null);

    await expect(createProposal(user, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.brief.findFirst).toHaveBeenCalledWith({ where: { id: briefId, userId: user.id }, select: { id: true } });
    expect(db.proposal.create).not.toHaveBeenCalled();
  });

  it("skips the brief lookup when no briefId is given", async () => {
    const { briefId: _unused, ...withoutBrief } = input;
    void _unused;
    await createProposal(user, withoutBrief);
    expect(db.brief.findFirst).not.toHaveBeenCalled();
    expect(db.proposal.create.mock.calls[0][0].data.briefId).toBeNull();
  });

  it("generates a different share token for every proposal", async () => {
    await createProposal(user, input);
    await createProposal(user, input);
    const [first, second] = db.proposal.create.mock.calls.map((call) => call[0].data.shareToken);
    expect(first).not.toBe(second);
  });

  it("rejects quotes above the cap before writing", async () => {
    await expect(
      createProposal(user, { ...input, hourlyRateCents: 10_000_000, items: [{ title: "x", estimatedHours: 1_000 }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(db.proposal.create).not.toHaveBeenCalled();
  });
});

describe("getDashboardStats", () => {
  it("scopes every query to the user and only counts verified payments", async () => {
    db.proposal.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    db.payment.groupBy.mockResolvedValue([
      { currency: "EUR", _sum: { amountCents: 12_000 } },
      { currency: "USD", _sum: { amountCents: 65_000 } },
    ]);

    const stats = await getDashboardStats(user.id);

    expect(stats).toEqual({
      totalProjects: 3,
      pendingProposals: 1,
      paidProjects: 2,
      revenueReceived: [
        { currency: "EUR", amountCents: 12_000 },
        { currency: "USD", amountCents: 65_000 },
      ],
    });
    const verified = { status: "COMPLETED", verifiedAt: { not: null } };
    expect(db.proposal.count.mock.calls.map((call) => call[0])).toEqual([
      { where: { userId: user.id } },
      { where: { userId: user.id, status: "SENT" } },
      { where: { userId: user.id, payments: { some: verified } } },
    ]);
    expect(db.payment.groupBy.mock.calls[0][0].where).toEqual({ ...verified, proposal: { userId: user.id } });
  });

  it("returns an empty revenue list when nothing is paid", async () => {
    db.proposal.count.mockResolvedValue(0);
    db.payment.groupBy.mockResolvedValue([]);
    expect((await getDashboardStats(user.id)).revenueReceived).toEqual([]);
  });
});

describe("listProposals", () => {
  it("lists only the user's proposals, newest first, with the requested limit", async () => {
    db.proposal.count.mockResolvedValue(0);
    db.payment.groupBy.mockResolvedValue([]);
    db.proposal.findMany.mockResolvedValue([
      { id: "p1", title: "Site", clientName: null, status: "PAID", currency: "USD", totalCents: 65_000, createdAt: now },
    ]);

    const result = await listProposals(user, { limit: 5 });

    expect(db.proposal.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    });
    expect(result.items).toEqual([
      { id: "p1", title: "Site", clientName: null, status: "paid", currency: "USD", totalCents: 65_000, createdAt: now.toISOString() },
    ]);
  });
});
