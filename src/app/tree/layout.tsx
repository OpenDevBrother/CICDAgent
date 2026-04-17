import type { Metadata } from "next";
export const metadata: Metadata = { title: "File Tree — MindFlayer", description: "Hierarchical codebase file tree with module grouping" };
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
