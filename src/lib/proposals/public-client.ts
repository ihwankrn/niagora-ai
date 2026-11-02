import { publicProposalApiResponseSchema } from "@/lib/contracts/public-proposals";

export class PublicProposalNotFoundError extends Error {
  constructor() {
    super("Proposal not found or share link is invalid");
    this.name = "PublicProposalNotFoundError";
  }
}

export async function fetchPublicProposal(token: string, signal?: AbortSignal) {
  const response = await fetch(`/api/public/proposals/${encodeURIComponent(token)}`, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "application/json" },
    signal,
  });

  if (response.status === 404) {
    throw new PublicProposalNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`Public proposal request failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  const result = publicProposalApiResponseSchema.safeParse(
    body && typeof body === "object" && "data" in body ? body.data : undefined,
  );

  if (!result.success) {
    throw new Error("Public proposal response was invalid");
  }

  return result.data;
}
