import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Client Proposal | Niagora AI",
  description: "Review a freelance project proposal shared with you.",
  robots: { index: false, follow: false },
};

export default function PublicProposalLayout({ children }: { children: ReactNode }) {
  return children;
}
