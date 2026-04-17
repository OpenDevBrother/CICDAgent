import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Architecture Timeline — MindFlayer",
  description: "Visual history of codebase architecture evolution",
};

export default function TimelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
