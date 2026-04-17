"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, GitBranch, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ArchitecturePage() {
  const [mermaidCode, setMermaidCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agent/axon/architecture")
      .then((r) => r.json())
      .then((d) => {
        setMermaidCode(d.mermaid ?? "");
        setNodeCount(d.nodeCount ?? 0);
        setEdgeCount(d.edgeCount ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!mermaidCode || !diagramRef.current) return;

    import("mermaid").then((mermaid) => {
      mermaid.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          primaryColor: "#1e293b",
          primaryTextColor: "#e2e8f0",
          primaryBorderColor: "#38bdf8",
          lineColor: "#475569",
          secondaryColor: "#0f172a",
          tertiaryColor: "#1e293b",
        },
      });
      diagramRef.current!.innerHTML = "";
      mermaid.default.render("arch-diagram", mermaidCode).then(({ svg }) => {
        if (diagramRef.current) diagramRef.current.innerHTML = svg;
      }).catch(() => {
        if (diagramRef.current) diagramRef.current.innerHTML = '<p class="text-red-400 text-sm">Failed to render diagram</p>';
      });
    });
  }, [mermaidCode]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between h-14 px-5 border-b border-border/40 glass-strong shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-bold">Architecture <span className="text-gradient-cyan">Diagram</span></h1>
        </div>
        <span className="text-xs text-muted-foreground font-mono">{nodeCount} modules, {edgeCount} edges</span>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto w-full space-y-4">
            <div className="glass rounded-xl neon-border p-6 overflow-x-auto">
              <div ref={diagramRef} className="min-h-[200px] flex items-center justify-center" />
            </div>

            <div className="glass rounded-xl neon-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Mermaid Source</p>
                <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs h-7 border-border/40">
                  {copied ? <Check className="w-3 h-3 mr-1 text-green-400" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <pre className="text-[11px] font-mono text-muted-foreground bg-black/20 rounded-lg p-3 overflow-x-auto whitespace-pre">
                {mermaidCode || "No diagram data"}
              </pre>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
