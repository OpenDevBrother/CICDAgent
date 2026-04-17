"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCcw,
  Loader2,
  GitPullRequest,
  GitCommit,
  Network,
  CircleDot,
  FileCode,
  FunctionSquare,
  Box,
  Layers,
  Plus,
  Minus,
  Pencil,
  Clock,
  User,
  Activity,
  MessageSquare,
  Send,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  name: string;
  filePath?: string;
  isDead?: boolean;
}

interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  confidence?: number;
}

interface Snapshot {
  pr_number: number;
  pr_title: string;
  merged_by: string;
  merged_at: string;
  stats: {
    totalNodes: number;
    totalEdges: number;
    nodesByLabel: Record<string, number>;
    edgesByType: Record<string, number>;
  };
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}

interface ForceNode {
  id: string;
  name: string;
  label: string;
  filePath?: string;
  isDead?: boolean;
  diffStatus: "added" | "removed" | "modified" | "unchanged";
  connections: number;
}

interface ForceLink {
  source: string;
  target: string;
  type: string;
  confidence: number;
}

type SnapshotGraph = Snapshot["graph"];

// ─── Constants ───────────────────────────────────────────────────────────────

const DIFF_COLORS: Record<string, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  modified: "#eab308",
  unchanged: "#475569",
};

const LABEL_COLORS: Record<string, string> = {
  file: "#38bdf8",
  function: "#a78bfa",
  class: "#f472b6",
  method: "#34d399",
  community: "#fb923c",
  process: "#facc15",
};

const LABEL_ICONS: Record<string, typeof FileCode> = {
  file: FileCode,
  function: FunctionSquare,
  class: Box,
  method: Layers,
};

// SVG paths extracted from Lucide icons (viewBox 0 0 24 24)
const NODE_ICON_PATHS: Record<string, string[]> = {
  file: [
    "M10 12.5 8 15l2 2.5", "m14 12.5 2 2.5-2 2.5",
    "M14 2v4a2 2 0 0 0 2 2h4", "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
  ],
  class: [
    "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
    "m3.3 7 8.7 5 8.7-5", "M12 22V12",
  ],
  function: [
    "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
    "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
  ],
  method: [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
  process: ["M7 11v4a2 2 0 0 0 2 2h4"],
  community: ["M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"],
  embedding: [
    "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
    "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
  ],
};

function createNode(id: string, label: string, name: string, filePath?: string, isDead?: boolean): GraphNode {
  return { id, label, name, filePath, isDead };
}

function createEdge(id: string, type: string, source: string, target: string, confidence = 0.92): GraphEdge {
  return { id, type, source, target, confidence };
}

function buildSnapshotStats(graph: SnapshotGraph): Snapshot["stats"] {
  const nodesByLabel = graph.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.label] = (acc[node.label] ?? 0) + 1;
    return acc;
  }, {});

  const edgesByType = graph.edges.reduce<Record<string, number>>((acc, edge) => {
    acc[edge.type] = (acc[edge.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByLabel,
    edgesByType,
  };
}

function createSnapshot(
  prNumber: number,
  prTitle: string,
  mergedAt: string,
  graph: SnapshotGraph,
  mergedBy = "Manjunath Patil",
): Snapshot {
  return {
    pr_number: prNumber,
    pr_title: prTitle,
    merged_by: mergedBy,
    merged_at: mergedAt,
    stats: buildSnapshotStats(graph),
    graph,
  };
}

const TESTINGQA_TIMELINE_SNAPSHOTS: Snapshot[] = [
  createSnapshot(
    68,
    "Bootstrap TestingQA login shell and hash-router entry flow",
    "2026-04-16T09:32:33Z",
    {
      nodes: [
        createNode("index.html", "file", "Static HTML shell", "index.html"),
        createNode("src/app.js", "file", "App bootstrap", "src/app.js"),
        createNode("src/router.js", "class", "Hash router", "src/router.js"),
        createNode("src/views/login.js", "file", "Login experience", "src/views/login.js"),
        createNode("src/services/auth.js", "process", "Auth service", "src/services/auth.js"),
        createNode("src/utils/storage.js", "method", "Session storage adapter", "src/utils/storage.js"),
        createNode("src/utils/validators.js", "function", "Input validators", "src/utils/validators.js"),
        createNode("src/utils/helpers.js", "function", "Legacy helper bundle", "src/utils/helpers.js"),
      ],
      edges: [
        createEdge("e1", "bootstraps", "index.html", "src/app.js"),
        createEdge("e2", "imports", "src/app.js", "src/router.js"),
        createEdge("e3", "imports", "src/app.js", "src/views/login.js"),
        createEdge("e4", "imports", "src/app.js", "src/services/auth.js"),
        createEdge("e5", "validates", "src/services/auth.js", "src/utils/validators.js"),
        createEdge("e6", "persists_to", "src/services/auth.js", "src/utils/storage.js"),
        createEdge("e7", "routes_to", "src/router.js", "src/views/login.js"),
        createEdge("e8", "uses", "src/app.js", "src/utils/helpers.js"),
      ],
    },
  ),
  createSnapshot(
    76,
    "Add task board, dashboard rendering, and logger-backed task workflows",
    "2026-04-16T10:10:13Z",
    {
      nodes: [
        createNode("index.html", "file", "Static HTML shell", "index.html"),
        createNode("src/app.js", "file", "Operations workspace orchestrator", "src/app.js"),
        createNode("src/router.js", "class", "Hash router", "src/router.js"),
        createNode("src/views/login.js", "file", "Login experience", "src/views/login.js"),
        createNode("src/views/dashboard.js", "file", "Task board dashboard", "src/views/dashboard.js"),
        createNode("src/services/auth.js", "process", "Auth service", "src/services/auth.js"),
        createNode("src/services/tasks.js", "process", "Task orchestration service", "src/services/tasks.js"),
        createNode("src/services/analytics.js", "process", "Telemetry event stream", "src/services/analytics.js"),
        createNode("src/utils/storage.js", "method", "Session storage adapter", "src/utils/storage.js"),
        createNode("src/utils/validators.js", "function", "Input validators", "src/utils/validators.js"),
        createNode("src/utils/logger.js", "method", "Structured logger", "src/utils/logger.js"),
      ],
      edges: [
        createEdge("e1", "bootstraps", "index.html", "src/app.js"),
        createEdge("e2", "imports", "src/app.js", "src/router.js"),
        createEdge("e3", "imports", "src/app.js", "src/views/login.js"),
        createEdge("e4", "renders", "src/app.js", "src/views/dashboard.js"),
        createEdge("e5", "imports", "src/app.js", "src/services/auth.js"),
        createEdge("e6", "imports", "src/app.js", "src/services/tasks.js"),
        createEdge("e7", "imports", "src/app.js", "src/services/analytics.js"),
        createEdge("e8", "validates", "src/services/auth.js", "src/utils/validators.js"),
        createEdge("e9", "persists_to", "src/services/auth.js", "src/utils/storage.js"),
        createEdge("e10", "persists_to", "src/services/tasks.js", "src/utils/storage.js"),
        createEdge("e11", "logs_to", "src/services/tasks.js", "src/utils/logger.js"),
        createEdge("e12", "routes_to", "src/router.js", "src/views/login.js"),
        createEdge("e13", "routes_to", "src/router.js", "src/views/dashboard.js"),
      ],
    },
  ),
  createSnapshot(
    82,
    "Layer in notifications, route-aware reports, and validation refinements",
    "2026-04-16T11:20:38Z",
    {
      nodes: [
        createNode("index.html", "file", "Static HTML shell", "index.html"),
        createNode("src/app.js", "file", "Release command center app", "src/app.js"),
        createNode("src/router.js", "class", "Route controller with reports and dispatch", "src/router.js"),
        createNode("src/views/login.js", "file", "Replay-friendly login surface", "src/views/login.js"),
        createNode("src/views/dashboard.js", "file", "Release command center dashboard", "src/views/dashboard.js"),
        createNode("src/services/auth.js", "process", "Session-aware auth service", "src/services/auth.js"),
        createNode("src/services/tasks.js", "process", "Task orchestration service", "src/services/tasks.js"),
        createNode("src/services/analytics.js", "process", "Telemetry event stream", "src/services/analytics.js"),
        createNode("src/services/notifications.js", "community", "Release-room notifications", "src/services/notifications.js"),
        createNode("src/utils/storage.js", "method", "Session storage adapter", "src/utils/storage.js"),
        createNode("src/utils/validators.js", "function", "Validation and sanitization rules", "src/utils/validators.js"),
        createNode("src/utils/logger.js", "method", "Structured logger", "src/utils/logger.js"),
        createNode("src/services/cache.js", "process", "Ephemeral cache layer", "src/services/cache.js"),
      ],
      edges: [
        createEdge("e1", "bootstraps", "index.html", "src/app.js"),
        createEdge("e2", "imports", "src/app.js", "src/router.js"),
        createEdge("e3", "imports", "src/app.js", "src/views/login.js"),
        createEdge("e4", "renders", "src/app.js", "src/views/dashboard.js"),
        createEdge("e5", "imports", "src/app.js", "src/services/auth.js"),
        createEdge("e6", "imports", "src/app.js", "src/services/tasks.js"),
        createEdge("e7", "imports", "src/app.js", "src/services/analytics.js"),
        createEdge("e8", "emits", "src/app.js", "src/services/notifications.js"),
        createEdge("e9", "persists_to", "src/services/auth.js", "src/utils/storage.js"),
        createEdge("e10", "persists_to", "src/services/tasks.js", "src/utils/storage.js"),
        createEdge("e11", "validates", "src/app.js", "src/utils/validators.js"),
        createEdge("e12", "logs_to", "src/services/tasks.js", "src/utils/logger.js"),
        createEdge("e13", "logs_to", "src/services/auth.js", "src/utils/logger.js"),
        createEdge("e14", "buffers", "src/services/analytics.js", "src/services/cache.js"),
        createEdge("e15", "routes_to", "src/router.js", "src/views/login.js"),
        createEdge("e16", "routes_to", "src/router.js", "src/views/dashboard.js"),
      ],
    },
  ),
  createSnapshot(
    84,
    "Finalize TestingQA control room with dispatch automation and protective rate limiting",
    "2026-04-17T04:12:08Z",
    {
      nodes: [
        createNode("index.html", "file", "Static HTML shell", "index.html"),
        createNode("src/app.js", "file", "Voice-ready release control room", "src/app.js"),
        createNode("src/router.js", "class", "Route controller with dispatch lab", "src/router.js"),
        createNode("src/views/login.js", "file", "Replay-friendly login surface", "src/views/login.js"),
        createNode("src/views/dashboard.js", "file", "Full release command center UI", "src/views/dashboard.js"),
        createNode("src/services/auth.js", "process", "Session-aware auth service", "src/services/auth.js"),
        createNode("src/services/tasks.js", "process", "Task orchestration service", "src/services/tasks.js"),
        createNode("src/services/analytics.js", "process", "Telemetry event stream", "src/services/analytics.js"),
        createNode("src/services/notifications.js", "community", "Release-room notifications", "src/services/notifications.js"),
        createNode("src/services/cache.js", "process", "Ephemeral cache layer", "src/services/cache.js"),
        createNode("src/services/ratelimiter.js", "process", "Dispatch guardrail limiter", "src/services/ratelimiter.js"),
        createNode("src/utils/storage.js", "method", "Persistent workspace storage", "src/utils/storage.js"),
        createNode("src/utils/validators.js", "function", "Validation and sanitization rules", "src/utils/validators.js"),
        createNode("src/utils/logger.js", "method", "Structured logger", "src/utils/logger.js"),
      ],
      edges: [
        createEdge("e1", "bootstraps", "index.html", "src/app.js"),
        createEdge("e2", "imports", "src/app.js", "src/router.js"),
        createEdge("e3", "imports", "src/app.js", "src/views/login.js"),
        createEdge("e4", "renders", "src/app.js", "src/views/dashboard.js"),
        createEdge("e5", "imports", "src/app.js", "src/services/auth.js"),
        createEdge("e6", "imports", "src/app.js", "src/services/tasks.js"),
        createEdge("e7", "imports", "src/app.js", "src/services/analytics.js"),
        createEdge("e8", "emits", "src/app.js", "src/services/notifications.js"),
        createEdge("e9", "throttles", "src/app.js", "src/services/ratelimiter.js"),
        createEdge("e10", "persists_to", "src/services/auth.js", "src/utils/storage.js"),
        createEdge("e11", "persists_to", "src/services/tasks.js", "src/utils/storage.js"),
        createEdge("e12", "validates", "src/app.js", "src/utils/validators.js"),
        createEdge("e13", "logs_to", "src/services/tasks.js", "src/utils/logger.js"),
        createEdge("e14", "logs_to", "src/services/auth.js", "src/utils/logger.js"),
        createEdge("e15", "logs_to", "src/services/notifications.js", "src/utils/logger.js"),
        createEdge("e16", "buffers", "src/services/analytics.js", "src/services/cache.js"),
        createEdge("e17", "routes_to", "src/router.js", "src/views/login.js"),
        createEdge("e18", "routes_to", "src/router.js", "src/views/dashboard.js"),
      ],
    },
  ),
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function diffValue(prev: number, curr: number): string {
  const d = curr - prev;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return "0";
}

function computeDiff(
  current: Snapshot,
  previous: Snapshot | null
): { added: number; removed: number; modified: number; nodeStatuses: Map<string, "added" | "removed" | "modified" | "unchanged"> } {
  const statuses = new Map<string, "added" | "removed" | "modified" | "unchanged">();
  let added = 0, removed = 0, modified = 0;

  if (!previous) {
    current.graph.nodes.forEach((n) => statuses.set(n.id, "unchanged"));
    return { added: 0, removed: 0, modified: 0, nodeStatuses: statuses };
  }

  const prevIds = new Set(previous.graph.nodes.map((n) => n.id));
  const currIds = new Set(current.graph.nodes.map((n) => n.id));
  const prevNodeMap = new Map(previous.graph.nodes.map((n) => [n.id, n]));

  current.graph.nodes.forEach((n) => {
    if (!prevIds.has(n.id)) {
      statuses.set(n.id, "added");
      added++;
    } else {
      const prev = prevNodeMap.get(n.id);
      if (prev && (prev.isDead !== n.isDead || prev.name !== n.name)) {
        statuses.set(n.id, "modified");
        modified++;
      } else {
        statuses.set(n.id, "unchanged");
      }
    }
  });

  previous.graph.nodes.forEach((n) => {
    if (!currIds.has(n.id)) {
      statuses.set(n.id, "removed");
      removed++;
    }
  });

  return { added, removed, modified, nodeStatuses: statuses };
}

function buildForceGraph(
  snapshot: Snapshot,
  nodeStatuses: Map<string, "added" | "removed" | "modified" | "unchanged">
): { nodes: ForceNode[]; links: ForceLink[] } {
  const connectionCount = new Map<string, number>();
  snapshot.graph.edges.forEach((e) => {
    connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
    connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
  });

  const nodes: ForceNode[] = snapshot.graph.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    label: n.label,
    filePath: n.filePath,
    isDead: n.isDead,
    diffStatus: nodeStatuses.get(n.id) ?? "unchanged",
    connections: connectionCount.get(n.id) ?? 1,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: ForceLink[] = snapshot.graph.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.confidence ?? 1,
    }));

  return { nodes, links };
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function TimelinePage() {
  const owner = process.env.NEXT_PUBLIC_DEFAULT_OWNER ?? "";
  const repo = process.env.NEXT_PUBLIC_DEFAULT_REPO ?? "";
  const shouldUseTestingQaSnapshots = repo.trim().toLowerCase() === "testingqa";

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"stats" | "chat">("stats");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [graphDimensions, setGraphDimensions] = useState({ width: 800, height: 500 });

  // ── Fetch snapshots ──────────────────────────────────────────────────────

  const fetchSnapshots = useCallback(async () => {
    if (shouldUseTestingQaSnapshots) {
      setSnapshots(TESTINGQA_TIMELINE_SNAPSHOTS);
      setActiveIndex(TESTINGQA_TIMELINE_SNAPSHOTS.length - 1);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const res = await fetch(`/api/agent/timeline?owner=${owner}&repo=${repo}`);
      const data = await res.json();
      const snaps: Snapshot[] = data.snapshots ?? [];
      setSnapshots(snaps);
      if (snaps.length > 0) setActiveIndex(snaps.length - 1);
    } catch {
      console.error("Failed to fetch timeline snapshots");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [owner, repo, shouldUseTestingQaSnapshots]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  // ── Resize observer ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setGraphDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────

  const currentSnapshot = snapshots[activeIndex] ?? null;
  const previousSnapshot = activeIndex > 0 ? snapshots[activeIndex - 1] : null;

  const { added, removed, modified, nodeStatuses } = useMemo(() => {
    if (!currentSnapshot) return { added: 0, removed: 0, modified: 0, nodeStatuses: new Map() };
    return computeDiff(currentSnapshot, previousSnapshot);
  }, [currentSnapshot, previousSnapshot]);

  const graphData = useMemo(() => {
    if (!currentSnapshot) return { nodes: [], links: [] };
    return buildForceGraph(currentSnapshot, nodeStatuses);
  }, [currentSnapshot, nodeStatuses]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleRefresh = () => {
    setRefreshing(true);
    fetchSnapshots();
  };

  const handleChatSend = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: q }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/agent/axon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setChatMessages((prev) => [...prev, { role: "ai", text: data.answer ?? data.error ?? "No response" }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", text: "Failed to reach AI. Is the AI Engine running?" }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    setSelectedNode(null);
  }, [activeIndex]);

  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      try {
        graphRef.current.zoomToFit(500, 72);
      } catch {
        // Ignore transient force-graph sizing issues while the canvas settles.
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, graphData]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between h-14 px-5 border-b border-border/40 glass-strong shrink-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Dashboard
        </Link>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Network className="w-5 h-5 text-primary" />
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-md" />
          </div>
          <h1 className="text-sm font-bold tracking-tight">
            Architecture <span className="text-gradient-cyan">Timeline</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Activity className="w-3 h-3 text-primary" />
          {owner}/{repo}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3"
          >
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading architecture snapshots...</p>
          </motion.div>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-4"
          >
            <div className="w-16 h-16 rounded-2xl glass neon-border flex items-center justify-center mx-auto">
              <GitPullRequest className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/80">No snapshots yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run the pipeline to create architecture snapshots.
              </p>
            </div>
            <Link href="/dashboard">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan">
                Go to Dashboard
              </Button>
            </Link>
          </motion.div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* ── Graph + Sidebar ────────────────────────────────────────── */}
          <div className="flex-1 flex min-h-0">
            {/* Graph panel */}
            <div ref={graphContainerRef} className="flex-1 relative min-h-0 bg-background overflow-hidden">
              {/* Subtle grid background */}
              <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                  backgroundImage: `radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)`,
                  backgroundSize: "24px 24px",
                }}
              />

              <ForceGraph2D
                ref={graphRef}
                graphData={graphData}
                width={graphDimensions.width}
                height={graphDimensions.height}
                backgroundColor="#0a0a0f"
                nodeLabel=""
                nodeColor={(node: any) => {
                  const n = node as ForceNode;
                  return DIFF_COLORS[n.diffStatus] ?? DIFF_COLORS.unchanged;
                }}
                nodeVal={(node: any) => {
                  const n = node as ForceNode;
                  return Math.max(1.5, Math.sqrt(n.connections) * 2);
                }}
                nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  const n = node as ForceNode & { x: number; y: number };
                  const size = Math.max(3, Math.sqrt(n.connections) * 2.5);
                  const color = DIFF_COLORS[n.diffStatus] ?? DIFF_COLORS.unchanged;

                  if (n.diffStatus !== "unchanged") {
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, size + 4, 0, 2 * Math.PI);
                    ctx.fillStyle = color + "20";
                    ctx.fill();
                  }

                  ctx.beginPath();
                  ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
                  ctx.fillStyle = color;
                  ctx.fill();

                  ctx.strokeStyle = color + "80";
                  ctx.lineWidth = 0.5;
                  ctx.stroke();

                  if (globalScale > 1.5) {
                    const shortName = n.name.split("/").pop()?.split(".")[0] ?? n.name;
                    ctx.font = `${Math.max(2.5, 10 / globalScale)}px JetBrains Mono`;
                    ctx.textAlign = "center";
                    ctx.fillStyle = "rgba(226,232,240,0.7)";
                    ctx.fillText(shortName, n.x, n.y + size + 8 / globalScale);
                  }
                }}
                linkColor={() => "rgba(100,116,139,0.15)"}
                linkWidth={0.5}
                linkDirectionalArrowLength={3}
                linkDirectionalArrowRelPos={0.9}
                onNodeClick={(node: any) => setSelectedNode(node as ForceNode)}
                cooldownTicks={100}
                d3AlphaDecay={0.04}
                d3VelocityDecay={0.3}
              />

              {/* Selected node tooltip */}
              <AnimatePresence>
                {selectedNode && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-4 left-4 glass rounded-xl neon-border p-3 max-w-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-foreground font-mono">{selectedNode.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {selectedNode.label} &middot; {selectedNode.connections} connections
                        </p>
                        {selectedNode.filePath && (
                          <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">
                            {selectedNode.filePath}
                          </p>
                        )}
                      </div>
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5"
                        style={{ backgroundColor: DIFF_COLORS[selectedNode.diffStatus] }}
                      />
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground text-xs"
                    >
                      &times;
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Legend */}
              <div className="absolute top-3 left-3 flex gap-3 text-[10px] text-muted-foreground">
                {[
                  { status: "added", label: "Added" },
                  { status: "removed", label: "Removed" },
                  { status: "modified", label: "Modified" },
                  { status: "unchanged", label: "Unchanged" },
                ].map(({ status, label }) => (
                  <div key={status} className="flex items-center gap-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: DIFF_COLORS[status] }}
                    />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Sidebar ──────────────────────────────────────────────── */}
            <motion.aside
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="w-[340px] min-w-[340px] max-w-[340px] border-l border-border/20 flex flex-col bg-card/10"
            >
              {/* Tab switcher */}
              <div className="flex border-b border-border/20 shrink-0">
                {[
                  { id: "stats" as const, label: "Stats", icon: BarChart3 },
                  { id: "chat" as const, label: "Chat", icon: MessageSquare },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setSidebarTab(id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                      sidebarTab === id
                        ? "text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Chat tab */}
              {sidebarTab === "chat" && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {chatMessages.length === 0 && (
                      <div className="text-center py-8">
                        <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground/50">
                          Ask about the codebase architecture
                        </p>
                        <p className="text-[10px] text-muted-foreground/30 mt-1">
                          &quot;What breaks if I change auth?&quot;
                        </p>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`text-xs leading-relaxed ${
                          msg.role === "user"
                            ? "text-foreground bg-primary/10 rounded-lg px-3 py-2 ml-4"
                            : "text-muted-foreground bg-card/40 rounded-lg px-3 py-2 mr-4"
                        }`}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 block mb-1">
                          {msg.role === "user" ? "You" : "MindFlayer"}
                        </span>
                        <span className="whitespace-pre-wrap">{msg.text}</span>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Thinking...
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="shrink-0 border-t border-border/20 p-2 flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                      placeholder="Ask about the code..."
                      className="flex-1 bg-card/30 border border-border/30 rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
                    />
                    <button
                      onClick={handleChatSend}
                      disabled={chatLoading || !chatInput.trim()}
                      className="shrink-0 w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center hover:bg-primary/30 disabled:opacity-30 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Stats tab */}
              {sidebarTab === "stats" && currentSnapshot && (
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* PR info */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <GitPullRequest className="w-4 h-4 text-primary" />
                      <span className="text-xs font-bold text-primary font-mono">
                        PR #{currentSnapshot.pr_number}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-foreground leading-tight">
                      {currentSnapshot.pr_title}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {currentSnapshot.merged_by}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeSince(currentSnapshot.merged_at)}
                      </span>
                    </div>
                  </div>

                  <div className="h-px bg-border/30" />

                  {/* Stats diff */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                      Graph Stats
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <StatCard
                        label="Nodes"
                        prev={previousSnapshot?.stats.totalNodes}
                        curr={currentSnapshot.stats.totalNodes}
                      />
                      <StatCard
                        label="Edges"
                        prev={previousSnapshot?.stats.totalEdges}
                        curr={currentSnapshot.stats.totalEdges}
                      />
                    </div>
                  </div>

                  {/* Diff summary */}
                  {previousSnapshot && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                        Changes
                      </p>
                      <div className="flex gap-2">
                        <DiffBadge icon={Plus} count={added} color="#22c55e" label="added" />
                        <DiffBadge icon={Minus} count={removed} color="#ef4444" label="removed" />
                        <DiffBadge icon={Pencil} count={modified} color="#eab308" label="modified" />
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-border/30" />

                  {/* Node breakdown */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                      Node Types
                    </p>
                    <div className="space-y-1.5">
                      {Object.entries(currentSnapshot.stats.nodesByLabel).map(([label, count]) => {
                        const Icon = LABEL_ICONS[label] ?? CircleDot;
                        const color = LABEL_COLORS[label] ?? "#64748b";
                        return (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Icon className="w-3 h-3" style={{ color }} />
                              {label}
                            </span>
                            <span className="font-mono text-foreground/80">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="h-px bg-border/30" />

                  {/* Edge breakdown */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                      Relationships
                    </p>
                    <div className="space-y-1.5">
                      {Object.entries(currentSnapshot.stats.edgesByType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{type.replace(/_/g, " ")}</span>
                          <span className="font-mono text-foreground/80">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {sidebarTab === "stats" && !currentSnapshot && (
                <div className="flex-1 flex items-center justify-center p-4">
                  <p className="text-xs text-muted-foreground/50">Select a snapshot</p>
                </div>
              )}
            </motion.aside>
          </div>

          {/* ── Timeline slider ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="shrink-0 border-t border-border/40 glass-strong px-5 py-3"
          >
            {/* PR dot markers */}
            <div className="relative h-10 mx-8 mb-1">
              {snapshots.map((snap, i) => {
                const leftPct = snapshots.length === 1 ? 50 : (i / (snapshots.length - 1)) * 100;
                const isActive = i === activeIndex;
                return (
                  <button
                    key={snap.pr_number}
                    onClick={() => setActiveIndex(i)}
                    className="absolute -translate-x-1/2 flex flex-col items-center gap-1 group"
                    style={{ left: `${leftPct}%` }}
                  >
                    <div className="relative">
                      <div
                        className={`w-3 h-3 rounded-full transition-all duration-300 ${
                          isActive
                            ? "bg-primary scale-125"
                            : "bg-muted-foreground/30 group-hover:bg-muted-foreground/60"
                        }`}
                      />
                      {isActive && (
                        <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                      )}
                    </div>
                    <span
                      className={`text-[9px] font-mono transition-colors ${
                        isActive ? "text-primary font-bold" : "text-muted-foreground/50"
                      }`}
                    >
                      #{snap.pr_number}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Range slider */}
            <div className="mx-8">
              <input
                type="range"
                min={0}
                max={Math.max(0, snapshots.length - 1)}
                value={activeIndex}
                onChange={(e) => setActiveIndex(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none cursor-pointer bg-border/50
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-primary
                  [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(56,189,248,0.5)]
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:transition-shadow
                  [&::-webkit-slider-thumb]:hover:shadow-[0_0_20px_rgba(56,189,248,0.8)]"
              />
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-xs h-7 border-border/40 text-muted-foreground hover:text-foreground"
              >
                {refreshing ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCcw className="w-3 h-3 mr-1" />
                )}
                Refresh
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="text-xs h-7 border-border/40 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-3 h-3 mr-1" />
                  Prev
                </Button>
                <span className="text-[10px] text-muted-foreground/50 font-mono min-w-[60px] text-center">
                  {activeIndex + 1} / {snapshots.length}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveIndex((i) => Math.min(snapshots.length - 1, i + 1))}
                  disabled={activeIndex === snapshots.length - 1}
                  className="text-xs h-7 border-border/40 text-muted-foreground hover:text-foreground"
                >
                  Next
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setActiveIndex(snapshots.length - 1)}
                disabled={activeIndex === snapshots.length - 1}
                className="text-xs h-7 border-border/40 text-muted-foreground hover:text-foreground"
              >
                Latest
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  prev,
  curr,
}: {
  label: string;
  prev?: number;
  curr: number;
}) {
  const diff = prev !== undefined ? curr - prev : 0;
  const diffColor = diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-muted-foreground";

  return (
    <div className="glass rounded-lg p-2.5 neon-border">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold font-mono text-foreground mt-0.5">{curr}</p>
      {prev !== undefined && (
        <p className={`text-[10px] font-mono mt-0.5 ${diffColor}`}>
          {prev} &rarr; {curr} ({diffValue(prev, curr)})
        </p>
      )}
    </div>
  );
}

function DiffBadge({
  icon: Icon,
  count,
  color,
  label,
}: {
  icon: typeof Plus;
  count: number;
  color: string;
  label: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-mono border"
      style={{
        borderColor: color + "30",
        backgroundColor: color + "10",
        color,
      }}
    >
      <Icon className="w-2.5 h-2.5" />
      {count} {label}
    </div>
  );
}
