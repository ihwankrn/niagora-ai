import { connection } from "next/server";

import PublicProposalClientPage from "./PublicProposalClientPage";

type PageParams = {
  params: Promise<{ shareToken: string }>;
};

export default async function PublicProposalViewPage({ params }: PageParams) {
  await connection();
  const { shareToken } = await params;

  return <PublicProposalClientPage key={shareToken} shareToken={shareToken} />;
}
