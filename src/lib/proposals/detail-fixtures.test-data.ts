import type { Proposal } from "@/lib/contracts/proposals";

// A proposal exactly as GET /api/proposals/:id returns it.
export const proposalDetail: Proposal = {
  id: "33333333-3333-4333-8333-333333333333",
  briefId: null,
  title: "Company profile website",
  summary: "Five pages with a contact form",
  clientName: "Katering Bu Sari",
  clientEmail: "client@example.com",
  status: "draft",
  currency: "USD",
  hourlyRateCents: 5_000,
  items: [
    { position: 0, title: "Page layouts", description: "Home, About, Menu, Gallery, Contact", estimatedHours: 10, hourlyRateCents: 5_000, amountCents: 50_000 },
    { position: 1, title: "Contact form", description: null, estimatedHours: 2.5, hourlyRateCents: 6_000, amountCents: 15_000 },
  ],
  totalHours: 12.5,
  subtotalCents: 65_000,
  totalCents: 65_000,
  approvedAt: null,
  paidAt: null,
  createdAt: "2026-10-25T11:35:00.000Z",
  updatedAt: "2026-10-26T08:00:00.000Z",
};
