import { describe, expect, it } from "vitest";

import {
  publicProposalApiResponseSchema,
  publicProposalTokenParamSchema,
} from "./public-proposals";

describe("public proposal API contract", () => {
  it("accepts backend token format and rejects malformed tokens", () => {
    const token = "a".repeat(43);

    expect(publicProposalTokenParamSchema.parse({ token })).toEqual({ token });
    expect(publicProposalTokenParamSchema.safeParse({ token: "invalid-token" }).success).toBe(false);
  });

  it("validates the public payload, including nullable freelancer names and all proposal statuses", () => {
    const response = {
      title: "Landing Page Project",
      summary: "Modern 5-page site",
      clientName: "Client Inc",
      freelancerName: null,
      status: "sent",
      currency: "USD",
      items: [
        {
          position: 0,
          title: "Design",
          description: "Visual direction",
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

    expect(publicProposalApiResponseSchema.parse(response)).toEqual(response);
    expect(
      publicProposalApiResponseSchema.parse({
        ...response,
        freelancerName: "Studio Freelancer",
        status: "paid",
        approvedAt: "2026-10-25T12:00:00.000Z",
        paidAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toMatchObject({
      freelancerName: "Studio Freelancer",
      status: "paid",
      approvedAt: "2026-10-25T12:00:00.000Z",
      paidAt: "2026-10-25T12:00:00.000Z",
    });
  });

  it("strips internal and payment data from parsed payloads", () => {
    const result = publicProposalApiResponseSchema.parse({
      title: "Landing Page Project",
      summary: null,
      clientName: null,
      freelancerName: null,
      status: "sent",
      currency: "USD",
      items: [],
      totalHours: 0,
      subtotalCents: 0,
      totalCents: 0,
      approvedAt: null,
      paidAt: null,
      id: "internal-id",
      userId: "internal-user-id",
      clientEmail: "private@example.com",
      shareToken: "private-token",
      payments: [{ paypalOrderId: "private-order" }],
    });

    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("clientEmail");
    expect(result).not.toHaveProperty("shareToken");
    expect(result).not.toHaveProperty("payments");
  });
});
