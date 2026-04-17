"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Network, Loader2 } from "lucide-react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const COMMUNITY_COLORS = [
  "#6366f1", "#ec4899", "#10b981", "#f59e0b", "#3b82f6", "#ef4444",
  "#8b5cf6", "#14b8a6", "#f97316", "#06b6d4", "#84cc16", "#e879f9",
  "#22d3ee", "#a3e635", "#fb7185", "#38bdf8", "#facc15", "#4ade80",
  "#c084fc", "#2dd4bf", "#fbbf24", "#818cf8", "#34d399", "#fb923c",
];

interface GraphNode {
  id: string; name: string; label: string; filePath?: string;
  communityId: number; connections: number; isDead?: boolean;
  x?: number; y?: number;
}
interface GraphEdge { source: string; target: string; type: string; }
interface Community { id: number; name: string; memberCount: number; }

export default function ExplorerPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    fetch("/api/agent/axon/graph")
      .then((r) => r.json())
      .then((d) => { setNodes(d.nodes ?? []); setEdges(d.edges ?? []); setCommunities(d.communities ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDims({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    const n = node as GraphNode;
    setSelectedNode(n);
    const connected = new Set<string>([n.id]);
    edges.forEach((e) => {
      const src = typeof e.source === "object" ? (e.source as any).id : e.source;
      const tgt = typeof e.target === "object" ? (e.target as any).id : e.target;
      if (src === n.id) connected.add(tgt);
      if (tgt === n.id) connected.add(src);
    });
    setHighlightNodes(connected);
  }, [edges]);

  const graphData = { nodes, links: edges.filter((e) => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    return nodeIds.has(e.source as string) && nodeIds.has(e.target as string);
  })};

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between h-14 px-5 border-b border-border/40 glass-strong shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-bold">Dependency <span className="text-gradient-cyan">Explorer</span></h1>
        </div>
        <span className="text-xs text-muted-foreground font-mono">{nodes.length} nodes, {edges.length} edges</span>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div ref={containerRef} className="flex-[7] relative min-h-0 overflow-hidden bg-background">
            <ForceGraph2D
              graphData={graphData}
              width={dims.width}
              height={dims.height}
              backgroundColor="#0a0a0f"
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const n = node as GraphNode;
                const size = Math.max(3, Math.sqrt(n.connections) * 3);
                const color = n.communityId >= 0 ? COMMUNITY_COLORS[n.communityId % 24] : "#475569";
                const dimmed = highlightNodes.size > 0 && !highlightNodes.has(n.id);

                ctx.globalAlpha = dimmed ? 0.15 : 1;
                ctx.beginPath();
                ctx.arc(n.x!, n.y!, size, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = color + "80";
                ctx.lineWidth = 0.5;
                ctx.stroke();

                if (globalScale > 1.2 && !dimmed) {
                  const name = (n.name ?? "").split("/").pop()?.split(".")[0] ?? n.name;
                  ctx.font = `${Math.max(2.5, 10 / globalScale)}px JetBrains Mono`;
                  ctx.textAlign = "center";
                  ctx.fillStyle = "rgba(226,232,240,0.8)";
                  ctx.fillText(name, n.x!, n.y! + size + 8 / globalScale);
                }
                ctx.globalAlpha = 1;
              }}
              linkColor={(link: any) => {
                if (highlightNodes.size === 0) return "rgba(100,116,139,0.12)";
                const src = typeof link.source === "object" ? link.source.id : link.source;
                const tgt = typeof link.target === "object" ? link.target.id : link.target;
                return highlightNodes.has(src) && highlightNodes.has(tgt) ? "rgba(56,189,248,0.5)" : "rgba(100,116,139,0.05)";
              }}
              linkWidth={0.5}
              onNodeClick={handleNodeClick}
              onBackgroundClick={() => { setHighlightNodes(new Set()); setSelectedNode(null); }}
              cooldownTicks={100}
              d3AlphaDecay={0.04}
              d3VelocityDecay={0.3}
            />
          </div>

          <motion.aside initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-[3] border-l border-border/20 overflow-y-auto bg-card/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">Communities</p>
            <div className="space-y-2">
              {communities.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COMMUNITY_COLORS[c.id % 24] }} />
                  <span className="text-foreground/80">{c.name}</span>
                  <span className="text-muted-foreground/50 ml-auto">{c.memberCount}</span>
                </div>
              ))}
            </div>

            {selectedNode && (
              <div className="mt-6 pt-4 border-t border-border/20">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">Selected</p>
                <p className="text-sm font-bold font-mono text-foreground">{selectedNode.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedNode.label} &middot; {selectedNode.connections} connections</p>
                {selectedNode.filePath && <p className="text-[10px] text-muted-foreground/50 font-mono mt-1">{selectedNode.filePath}</p>}
                {selectedNode.isDead && <p className="text-[10px] text-red-400 mt-1">Dead code</p>}
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </div>
  );
}
