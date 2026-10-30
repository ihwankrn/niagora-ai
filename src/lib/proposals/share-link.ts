// Client-facing proposal page in the frontend: src/app/proposals/view/[shareToken]/page.tsx.
// The page loads its data from GET /api/public/proposals/:token.
export const PROPOSAL_VIEW_PATH = "/proposals/view";

export function proposalShareUrl(appBaseUrl: string, shareToken: string) {
  return `${new URL(appBaseUrl).origin}${PROPOSAL_VIEW_PATH}/${shareToken}`;
}
