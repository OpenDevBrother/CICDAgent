"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, FolderOpen, Folder, FileCode, ChevronRight, ChevronDown, Loader2, Zap, Box, CircleDot, AlertTriangle } from "lucide-react";

interface TreeNode {
  name: string; path: string; type: "folder" | "file";
  isDead?: boolean; children: TreeNode[];
  symbols: Array<{ name: string; type: string; line: number; isDead: boolean }>;
}

const SYMBOL_ICONS: Record<string, typeof Zap> = { function: Zap, method: Zap, class: Box };

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0 || node.symbols.length > 0;
  const isFolder = node.type === "folder";

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-1.5 py-1.5 px-2 text-xs hover:bg-card/40 rounded transition-colors ${
          node.isDead ? "text-red-400/70" : "text-foreground/80"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          open ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
        ) : <span className="w-3" />}
        {isFolder ? (
          open ? <FolderOpen className="w-3.5 h-3.5 text-amber-400/80 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
        ) : (
          <FileCode className="w-3.5 h-3.5 text-primary/60 shrink-0" />
        )}
        <span className="font-mono truncate">{node.name}</span>
        {node.isDead && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 ml-auto" />}
        {!isFolder && node.symbols.length > 0 && (
          <span className="text-[9px] text-muted-foreground/40 ml-auto">{node.symbols.length} symbols</span>
        )}
      </button>

      {open && (
        <div>
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
          {node.symbols.map((sym, i) => {
            const Icon = SYMBOL_ICONS[sym.type] ?? CircleDot;
            return (
              <div
                key={`${sym.name}-${i}`}
                className={`flex items-center gap-1.5 py-1 px-2 text-[11px] ${
                  sym.isDead ? "text-red-400/60" : "text-muted-foreground"
                }`}
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="font-mono truncate">{sym.name}</span>
                <span className="text-[9px] text-muted-foreground/30 ml-auto">{sym.type}</span>
                {sym.isDead && <AlertTriangle className="w-2.5 h-2.5 text-red-400 shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TreePage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agent/axon/tree")
      .then((r) => r.json())
      .then((d) => setTree(d.tree ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const countItems = (nodes: TreeNode[]): { files: number; folders: number; symbols: number } => {
    let files = 0, folders = 0, symbols = 0;
    for (const n of nodes) {
      if (n.type === "folder") { folders++; } else { files++; symbols += n.symbols.length; }
      const sub = countItems(n.children);
      files += sub.files; folders += sub.folders; symbols += sub.symbols;
    }
    return { files, folders, symbols };
  };
  const counts = countItems(tree);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between h-14 px-5 border-b border-border/40 glass-strong shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-amber-400" />
          <h1 className="text-sm font-bold">File <span className="text-gradient-cyan">Tree</span></h1>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {counts.files} files, {counts.folders} folders, {counts.symbols} symbols
        </span>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 overflow-y-auto p-2">
          <div className="glass rounded-xl neon-border p-2 max-w-3xl mx-auto">
            {tree.map((node) => (
              <TreeItem key={node.path} node={node} />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
