import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicProposal, PublicProposalNotFoundError } from "./public-client";

const publicProposal = {
  title: "Landing Page Project",
  summary: "Modern 5-page site",
  clientName: "Private Client",
  freelancerName: "Studio Freelancer",
  status: "sent",
  currency: "USD",
  items: [
    {
      position: 0,
      title: "Design",
      description: "Visual direction and layout",
      estimatedHours: 10,
      hourlyRateCents: 5_000,
      amountCents: 50_000,
    },
  ],
  totalHours: 10,
  subtotalCents: 50_000,
  totalCents: 50_000,
  approvedAt: null,
  paidAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPublicProposal", () => {
  it("requests and validates proposal data from the public endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ...publicProposal,
            id: "11111111-1111-4111-8111-111111111111",
            clientEmail: "client@example.com",
            shareToken: "private-token",
            payments: [{ paypalOrderId: "private-order" }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicProposal("a".repeat(43));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/proposals/${"a".repeat(43)}`,
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "omit" }),
    );
    expect(result).toEqual(publicProposal);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("clientEmail");
    expect(result).not.toHaveProperty("shareToken");
    expect(result).not.toHaveProperty("payments");
  });

  it("treats HTTP 404 as an invalid or unavailable proposal link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(fetchPublicProposal("a".repeat(43))).rejects.toBeInstanceOf(PublicProposalNotFoundError);
  });

  it("surfaces non-404 HTTP failures as service errors", async () => {
    const response = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", response);

    await expect(fetchPublicProposal("a".repeat(43))).rejects.toThrow(
      "Public proposal request failed with status 400",
    );
  });

  it("surfaces network failures so the page can show its retry state", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await expect(fetchPublicProposal("valid_token")).rejects.toBe(networkError);
  });

  it("rejects malformed success payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { id: "not-a-proposal" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(fetchPublicProposal("valid_token")).rejects.toThrow("Public proposal response was invalid");
  });
});
