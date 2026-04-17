"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, Flame, Loader2, User, Clock, GitCommit } from "lucide-react";

interface Hotspot {
  path: string; commits: number; authors: string[]; topAuthor: string;
  lastDate: string; lastMessage: string; heat: number;
}

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function heatColor(heat: number): string {
  if (heat >= 80) return "#ef4444";
  if (heat >= 60) return "#f97316";
  if (heat >= 40) return "#eab308";
  if (heat >= 20) return "#22c55e";
  return "#64748b";
}

export default function HotspotsPage() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalFiles, setTotalFiles] = useState(0);

  useEffect(() => {
    fetch("/api/agent/hotspots")
      .then((r) => r.json())
      .then((d) => { setHotspots(d.hotspots ?? []); setTotalFiles(d.totalFiles ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between h-14 px-5 border-b border-border/40 glass-strong shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-400" />
          <h1 className="text-sm font-bold">Git <span className="text-gradient-cyan">Hotspots</span></h1>
        </div>
        <span className="text-xs text-muted-foreground font-mono">{totalFiles} files tracked</span>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-2">
            {hotspots.map((h, i) => (
              <div
                key={h.path}
                className="glass rounded-xl neon-border-hover p-4 flex items-center gap-4 transition-all"
              >
                <div className="shrink-0 w-8 text-center">
                  <span className="text-xs font-bold text-muted-foreground/40">#{i + 1}</span>
                </div>

                <div className="shrink-0 w-12">
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${h.heat}%`, backgroundColor: heatColor(h.heat) }}
                    />
                  </div>
                  <p className="text-[9px] text-center mt-1 font-mono" style={{ color: heatColor(h.heat) }}>
                    {h.heat}%
                  </p>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-foreground truncate">{h.path}</p>
                  <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{h.lastMessage}</p>
                </div>

                <div className="shrink-0 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <GitCommit className="w-3 h-3" />
                    {h.commits}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {h.topAuthor}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground/40">
                    <Clock className="w-3 h-3" />
                    {h.lastDate ? timeSince(h.lastDate) : "—"}
                  </span>
                </div>
              </div>
            ))}

            {hotspots.length === 0 && (
              <div className="text-center py-12">
                <Flame className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No hotspot data available.</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
