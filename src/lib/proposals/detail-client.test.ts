import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProposalDetail, ProposalDetailError } from "./detail-client";
import { proposalDetail } from "./detail-fixtures.test-data";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchProposalDetail", () => {
  it("requests GET /api/proposals/:id without caching and validates the response", async () => {
    const fetchMock = stubFetch(async () => json(200, { data: proposalDetail }));

    const result = await fetchProposalDetail(proposalDetail.id);

    expect(result).toEqual(proposalDetail);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/proposals/${proposalDetail.id}`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
  });

  it("drops fields that are not part of the contract", async () => {
    stubFetch(async () => json(200, { data: { ...proposalDetail, shareToken: "secret", userId: "u1" } }));
    const result = await fetchProposalDetail(proposalDetail.id);
    expect(result).not.toHaveProperty("shareToken");
    expect(result).not.toHaveProperty("userId");
  });

  it.each([
    [401, "unauthorized"],
    [404, "not_found"],
    [500, "server"],
    [502, "server"],
  ])("maps HTTP %s to %s", async (status, kind) => {
    stubFetch(async () => json(status, { error: { code: "X", message: "x" } }));
    const error = await fetchProposalDetail(proposalDetail.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProposalDetailError);
    expect(error).toMatchObject({ kind, httpStatus: status });
  });

  it("rejects a response that does not match the contract", async () => {
    stubFetch(async () => json(200, { data: { ...proposalDetail, totalCents: "65000" } }));
    await expect(fetchProposalDetail(proposalDetail.id)).rejects.toMatchObject({ kind: "invalid_response" });
    stubFetch(async () => new Response("<html>", { status: 200 }));
    await expect(fetchProposalDetail(proposalDetail.id)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("reports network failures as a retryable network error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchProposalDetail(proposalDetail.id)).rejects.toMatchObject({ kind: "network" });
  });

  it("lets an abort pass through so a closed modal can ignore it", async () => {
    stubFetch(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchProposalDetail(proposalDetail.id)).rejects.toMatchObject({ name: "AbortError" });
  });
});
