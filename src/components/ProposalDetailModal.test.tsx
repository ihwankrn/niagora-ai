import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProposalDetailError } from "@/lib/proposals/detail-client";
import { proposalDetail } from "@/lib/proposals/detail-fixtures.test-data";
import { formatCents } from "@/types/proposals";

import ProposalDetailModal, { ProposalDetailContent, type ProposalDetailState } from "./ProposalDetailModal";

const noop = () => {};
const render = (state: ProposalDetailState) => renderToStaticMarkup(<ProposalDetailContent state={state} onRetry={noop} />);
const usd = (amount: string) => formatCents(Number(amount) * 100, "USD");

describe("ProposalDetailContent", () => {
  it("shows a loading state", () => {
    const html = render({ status: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading proposal details");
    expect(html).not.toContain("Deliverables");
  });

  it("shows an error with a retry button for retryable failures", () => {
    for (const kind of ["network", "server", "invalid_response"] as const) {
      const html = render({ status: "error", error: new ProposalDetailError(kind, `Failure ${kind}`) });
      expect(html).toContain('role="alert"');
      expect(html).toContain(`Failure ${kind}`);
      expect(html).toContain("Try again");
    }
  });

  it("does not offer a retry for not found or signed-out errors", () => {
    for (const kind of ["not_found", "unauthorized"] as const) {
      const html = render({ status: "error", error: new ProposalDetailError(kind, `Failure ${kind}`) });
      expect(html).toContain(`Failure ${kind}`);
      expect(html).not.toContain("Try again");
    }
  });

  it("renders deliverables, hours, rates, amounts and totals from the backend response", () => {
    const html = render({ status: "ready", proposal: proposalDetail });

    expect(html).toContain("Deliverables (2)");
    expect(html).toContain("Page layouts");
    expect(html).toContain("Home, About, Menu, Gallery, Contact");
    expect(html).toContain("Contact form");
    expect(html).toContain("10 hrs");
    expect(html).toContain("2.5 hrs");
    expect(html).toContain("12.5 hrs total");
    expect(html).toContain(usd("500"));
    expect(html).toContain(usd("150"));
    expect(html).toContain(usd("650"));
    expect(html).toContain(`${usd("50")}/hr`);
    expect(html).toContain(`${usd("60")}/hr`);
    expect(html).toContain("Five pages with a contact form");
    expect(html).toContain("Katering Bu Sari");
  });

  it("uses the proposal currency for every amount", () => {
    const eur = { ...proposalDetail, currency: "EUR" as const };
    const html = render({ status: "ready", proposal: eur });
    expect(html).toContain(formatCents(65_000, "EUR"));
    expect(html).not.toContain(usd("650"));
  });

  it("does not invent data that the backend did not send", () => {
    const html = render({ status: "ready", proposal: { ...proposalDetail, summary: null, clientEmail: null, items: [] } });
    expect(html).toContain("Deliverables (0)");
    expect(html).toContain("This proposal has no line items.");
    expect(html).not.toContain("Scope Summary");
    expect(html).not.toContain("client@example.com");
    expect(html).not.toContain("Approved");
    expect(html).not.toContain("Paid ");
  });
});

describe("ProposalDetailModal", () => {
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<ProposalDetailModal proposal={null} isOpen={false} onClose={noop} />)).toBe("");
  });

  it("opens in the loading state with only list-summary data in the header", () => {
    const summary = {
      id: proposalDetail.id,
      title: proposalDetail.title,
      clientName: proposalDetail.clientName,
      status: proposalDetail.status,
      currency: proposalDetail.currency,
      totalCents: proposalDetail.totalCents,
      createdAt: proposalDetail.createdAt,
    };
    const html = renderToStaticMarkup(<ProposalDetailModal proposal={summary} isOpen onClose={noop} />);

    expect(html).toContain("Company profile website");
    expect(html).toContain("Loading proposal details");
    // No placeholder detail values before the backend responds.
    expect(html).not.toContain("Deliverables");
    expect(html).not.toContain("/hr");
  });
});
