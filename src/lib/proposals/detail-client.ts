import { type Proposal, proposalSchema } from "@/lib/contracts/proposals";

export type ProposalDetailErrorKind = "unauthorized" | "not_found" | "server" | "invalid_response" | "network";

export class ProposalDetailError extends Error {
  readonly kind: ProposalDetailErrorKind;
  readonly httpStatus?: number;

  constructor(kind: ProposalDetailErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = "ProposalDetailError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

// Loads the signed-in freelancer's proposal from GET /api/proposals/:id.
// The session cookie is sent same-origin; the user is never passed explicitly.
export async function fetchProposalDetail(proposalId: string, signal?: AbortSignal): Promise<Proposal> {
  let response: Response;
  try {
    response = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProposalDetailError("network", "Could not reach the server. Check your connection and try again.");
  }

  if (response.status === 401) {
    throw new ProposalDetailError("unauthorized", "Your session has expired. Please sign in again.", 401);
  }
  if (response.status === 404) {
    throw new ProposalDetailError("not_found", "This proposal was not found or you do not have access to it.", 404);
  }
  if (!response.ok) {
    throw new ProposalDetailError("server", "The server could not load this proposal. Please try again.", response.status);
  }

  const body: unknown = await response.json().catch(() => undefined);
  const result = proposalSchema.safeParse(body && typeof body === "object" && "data" in body ? body.data : undefined);
  if (!result.success) {
    throw new ProposalDetailError("invalid_response", "The server returned an unexpected proposal format.", response.status);
  }
  return result.data;
}
