import type { Metadata } from "next";
export const metadata: Metadata = { title: "Explorer — MindFlayer", description: "Interactive dependency graph with community detection" };
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
