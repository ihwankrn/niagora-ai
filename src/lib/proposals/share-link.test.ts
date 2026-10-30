import { describe, expect, it } from "vitest";

import { shareTokenSchema } from "@/lib/contracts/payments";

import { PROPOSAL_VIEW_PATH, proposalShareUrl } from "./share-link";

const TOKEN = "AbC-_123".padEnd(43, "x");

describe("proposalShareUrl", () => {
  it("points at the frontend page /proposals/view/[shareToken]", () => {
    expect(PROPOSAL_VIEW_PATH).toBe("/proposals/view");
    expect(proposalShareUrl("http://localhost:3000", TOKEN)).toBe(`http://localhost:3000/proposals/view/${TOKEN}`);
  });

  it("uses only the origin of APP_BASE_URL", () => {
    expect(proposalShareUrl("https://niagora.example/some/path/?q=1", TOKEN)).toBe(`https://niagora.example/proposals/view/${TOKEN}`);
  });

  it("produces a token segment the public API accepts", () => {
    const token = new URL(proposalShareUrl("http://localhost:3000", TOKEN)).pathname.split("/").pop();
    expect(shareTokenSchema.safeParse(token).success).toBe(true);
  });
});
