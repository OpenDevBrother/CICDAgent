"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { ChevronDown, ChevronUp, DatabaseZap, GitBranch, Loader2, Mic, MicOff, Network, Phone, PhoneOff, Radio, RefreshCw, Sparkles, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createVapiAssistantConfig, getVapiServerBaseUrl, parseToolResult } from "@/lib/vapi/client";
import type { DashboardVoiceTab } from "@/lib/vapi/client";
import type { VoicePullRequestSummary, VoiceToolMetadata } from "@/lib/vapi/voice-actions";

interface VapiVoicePanelProps {
  owner: string;
  repo: string;
  branch: string;
  targetUrl: string;
  pullRequests: VoicePullRequestSummary[];
  selectedPrNumber: number | null;
  activeSessionId: string | null;
  onSelectPr: (prNumber: number) => void;
  onNavigateTab: (tab: DashboardVoiceTab) => void;
  onOpenPipeline: () => void;
  onOpenPrTracker: () => void;
  onToolMetadata: (metadata: VoiceToolMetadata) => void;
}

type VoiceState = "idle" | "connecting" | "active" | "ended" | "error";

interface RepoVoiceStatus {
  repoPath: string | null;
  repoPathConfigured: boolean;
  repoPathReady: boolean;
  repoPathSource: "env" | "app-root" | "missing";
  qdrantConfigured: boolean;
  codeIndexReady: boolean;
  codeIndexCount: number;
  qdrantCollection: string;
  axonConnected: boolean;
  aiEngineAvailable: boolean;
  warning?: string;
}

const PROMPTS = [
  "Show open PRs",
  "Run PR 12",
  "What failed?",
  "Is it safe to deploy?",
  "Where is auth handled?",
];

const CLIENT_TAB_TOOLS: Record<string, DashboardVoiceTab> = {
  open_pipeline_tab: "pipeline",
  open_agents_tab: "agents",
  open_test_results_tab: "tests",
  open_live_terminal_tab: "terminal",
  open_pr_tracker_tab: "prs",
};

const CLIENT_TAB_CONTEXT: Record<DashboardVoiceTab, string> = {
  pipeline:
    "The Pipeline tab is now open. Continue the same reply by briefly explaining that this section shows validation runs, repo config, selected PR controls, and pipeline progress. Do not call another navigation tool unless the user asks for a different section.",
  agents:
    "The Agents tab is now open. Continue the same reply by briefly explaining the five agents: The Architect plans and analyzes the repo, The Scripter runs Playwright tests, The Healer performs RCA and fixes, The Judge classifies failures, and The Courier sends GitHub and notification updates. Do not call another navigation tool unless the user asks for a different section.",
  tests:
    "The Test Results tab is now open. Continue the same reply by briefly explaining that this section shows passed, failed, running, and pending tests along with durations and failure details. Do not call another navigation tool unless the user asks for a different section.",
  terminal:
    "The Live Terminal tab is now open. Continue the same reply by briefly explaining that this section streams the pipeline logs, agent actions, warnings, and system messages in real time. Do not call another navigation tool unless the user asks for a different section.",
  prs:
    "The PR Tracker tab is now open. Continue the same reply by briefly explaining that this section lists the open pull requests, lets the user inspect the selected PR, and is where voice PR actions land. Do not call another navigation tool unless the user asks for a different section.",
};

export function VapiVoicePanel({
  owner,
  repo,
  branch,
  targetUrl,
  pullRequests,
  selectedPrNumber,
  activeSessionId,
  onSelectPr,
  onNavigateTab,
  onOpenPipeline,
  onOpenPrTracker,
  onToolMetadata,
}: VapiVoicePanelProps) {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY?.trim() ?? "";
  const vapiRef = useRef<Vapi | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Ready");
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [transcriptLog, setTranscriptLog] = useState<string[]>([]);
  const [lastToolAction, setLastToolAction] = useState("Awaiting voice action");
  const [voiceError, setVoiceError] = useState("");
  const [latestMetadata, setLatestMetadata] = useState<VoiceToolMetadata | null>(null);
  const [repoStatus, setRepoStatus] = useState<RepoVoiceStatus | null>(null);
  const [repoStatusLoading, setRepoStatusLoading] = useState(false);
  const [repoStatusError, setRepoStatusError] = useState("");
  const [indexingRepo, setIndexingRepo] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);
  const serverBaseUrl = useMemo(() => (origin ? getVapiServerBaseUrl(origin) : ""), [origin]);
  const needsPublicServer = serverBaseUrl.includes("localhost") || serverBaseUrl.includes("127.0.0.1");

  const assistantConfig = useMemo(
    () => createVapiAssistantConfig(origin || "", { owner, repo, branch, targetUrl, selectedPrNumber, activeSessionId }),
    [activeSessionId, branch, origin, owner, repo, selectedPrNumber, targetUrl],
  );

  const fetchRepoStatus = async () => {
    setRepoStatusLoading(true);
    setRepoStatusError("");

    try {
      const response = await fetch("/api/agent/repo-status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to load repo search status.");
      }
      setRepoStatus(data as RepoVoiceStatus);
    } catch (error) {
      setRepoStatusError(error instanceof Error ? error.message : "Failed to load repo search status.");
    } finally {
      setRepoStatusLoading(false);
    }
  };

  useEffect(() => {
    void fetchRepoStatus();
  }, []);

  useEffect(() => {
    if (!publicKey) return undefined;

    const instance = new Vapi(publicKey);
    vapiRef.current = instance;

    const handleCallStart = () => {
      setVoiceState("active");
      setStatusLabel("Listening live");
      setVoiceError("");
      if (pendingPromptRef.current) {
        instance.send({
          type: "add-message",
          message: {
            role: "user",
            content: pendingPromptRef.current,
          },
          triggerResponseEnabled: true,
        });
        pendingPromptRef.current = null;
      }
    };

    const handleCallEnd = () => {
      setVoiceState("ended");
      setStatusLabel("Call ended");
    };

    const handleError = (error: any) => {
      const message = error?.message || "Vapi call failed.";
      setVoiceState("error");
      setStatusLabel("Voice error");
      setVoiceError(String(message));
    };

    const handleMessage = (message: any) => {
      const type = message?.type;

      if (type === "status-update") {
        const status = String(message?.status ?? message?.message ?? "Voice update");
        setStatusLabel(status);
      }

      if (type === "transcript") {
        const role = String(message?.role ?? "assistant");
        const text = String(message?.transcript ?? message?.text ?? "").trim();
        if (!text) return;

        if (role === "user") {
          setUserTranscript(text);
        } else {
          setAssistantTranscript(text);
        }

        if (message?.transcriptType === "final" || message?.final === true) {
          setTranscriptLog((prev) => [`${role === "user" ? "You" : "Sentinel"}: ${text}`, ...prev].slice(0, 8));
        }
      }

      if (type === "tool-calls") {
        const toolCalls = message?.toolCallList ?? message?.toolCalls ?? [];
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          const firstTool = toolCalls[0];
          const toolName = firstTool?.function?.name ?? firstTool?.name ?? "tool";
          setLastToolAction(`Running ${toolName}`);

          toolCalls.forEach((toolCall: any) => {
            const functionName = toolCall?.function?.name ?? toolCall?.name;
            const tab = functionName ? CLIENT_TAB_TOOLS[functionName] : undefined;
            if (!tab) return;

            onNavigateTab(tab);
            setLastToolAction(`Opened ${tab} workspace`);

            instance.send({
              type: "add-message",
              message: {
                role: "system",
                content: `Context: the ${tab} dashboard section is now open and in view for the user. ${CLIENT_TAB_CONTEXT[tab]}`,
              },
              triggerResponseEnabled: true,
            });
          });
        }
      }

      if (type === "tool-calls-result") {
        const results = message?.results ?? (message?.toolCallResult ? [message.toolCallResult] : []);
        if (!Array.isArray(results) || results.length === 0) return;

        const firstResult = results[0];
        const parsed = parseToolResult(firstResult?.result);
        if (!parsed) return;

        const metadata = parsed as unknown as VoiceToolMetadata;
        setLatestMetadata(metadata);
        setLastToolAction(`Completed ${firstResult?.name ?? "tool"}`);
        if (metadata.spoken_summary) {
          setAssistantTranscript(metadata.spoken_summary);
        }
        if (Array.isArray(metadata.pull_requests) && metadata.pull_requests.length > 0) {
          onOpenPrTracker();
        }
        if (metadata.selected_pr?.number) {
          onSelectPr(metadata.selected_pr.number);
        }
        if (metadata.session_id) {
          onOpenPipeline();
        }
        onToolMetadata(metadata);
      }
    };

    instance.on("call-start", handleCallStart);
    instance.on("call-end", handleCallEnd);
    instance.on("error", handleError);
    instance.on("message", handleMessage);

    return () => {
      instance.removeListener("call-start", handleCallStart);
      instance.removeListener("call-end", handleCallEnd);
      instance.removeListener("error", handleError);
      instance.removeListener("message", handleMessage);
      void instance.stop().catch(() => undefined);
      vapiRef.current = null;
    };
  }, [onNavigateTab, onOpenPipeline, onOpenPrTracker, onSelectPr, onToolMetadata, publicKey]);

  const startVoice = async (prompt?: string) => {
    if (!publicKey || !vapiRef.current || voiceState === "connecting" || voiceState === "active") return;

    setVoiceState("connecting");
    setStatusLabel("Connecting");
    setVoiceError("");
    pendingPromptRef.current = prompt ?? null;

    try {
      await vapiRef.current.start(assistantConfig.assistant as any);
    } catch (error) {
      setVoiceState("error");
      setStatusLabel("Failed to start");
      setVoiceError(error instanceof Error ? error.message : "Unable to start Vapi.");
    }
  };

  const stopVoice = async () => {
    if (!vapiRef.current) return;
    await vapiRef.current.stop();
    setVoiceState("ended");
    setStatusLabel("Call ended");
  };

  const toggleMute = () => {
    if (!vapiRef.current) return;
    const nextMuted = !muted;
    vapiRef.current.setMuted(nextMuted);
    setMuted(nextMuted);
  };

  const sendPrompt = async (prompt: string) => {
    if (!vapiRef.current) return;
    if (voiceState !== "active") {
      await startVoice(prompt);
      return;
    }

    vapiRef.current.send({
      type: "add-message",
      message: {
        role: "user",
        content: prompt,
      },
      triggerResponseEnabled: true,
    });
  };

  const buildRepoIndex = async () => {
    setIndexingRepo(true);
    setRepoStatusError("");
    setLastToolAction("Building repo code index");

    try {
      const response = await fetch("/api/agent/repo-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (!response.ok) {
        const errors = Array.isArray(data?.errors) ? data.errors.join(" ") : data?.error;
        throw new Error(errors || "Repo indexing failed.");
      }
      setAssistantTranscript(
        data?.chunk_count
          ? `Indexed ${data.chunk_count} code chunks from ${data.file_count} files into ${data.qdrant_collection}.`
          : "Repo index completed.",
      );
      await fetchRepoStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repo indexing failed.";
      setRepoStatusError(message);
      setAssistantTranscript(message);
    } finally {
      setIndexingRepo(false);
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-950 to-cyan-500/10 p-5 shadow-[0_18px_70px_rgba(16,185,129,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-emerald-200">
            <Sparkles className="h-3.5 w-3.5" />
            Vapi Voice Copilot
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCollapsed((prev) => !prev)}
          className="shrink-0 gap-2 border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          {collapsed ? "Expand" : "Minimize"}
        </Button>
      </div>

      {collapsed ? (
        <div className="mt-4 flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/50 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-100">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-100">
                <Radio className="h-3.5 w-3.5" />
                {statusLabel}
              </span>
              <span className="truncate text-slate-300">Last action: {lastToolAction}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Session: {latestMetadata?.session_id || activeSessionId || "none"} • Selected PR: {latestMetadata?.selected_pr?.number || selectedPrNumber || "none"}
            </p>
            {voiceError ? <p className="mt-2 text-xs text-red-300">{voiceError}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={toggleMute}
              disabled={voiceState !== "active"}
              className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            {voiceState === "active" ? (
              <Button type="button" size="sm" onClick={() => void stopVoice()} className="gap-2 bg-red-500 text-white hover:bg-red-400">
                <PhoneOff className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => void startVoice()}
                disabled={!publicKey}
                className="gap-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400"
              >
                <Phone className="h-4 w-4" />
                Start
              </Button>
            )}
          </div>
        </div>
      ) : (
      <div className="mt-4 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl space-y-3">
          <div>
            <h2 className="text-2xl font-semibold text-white">Talk to MindFlayer like it is your DevOps engineer</h2>
            <p className="mt-1 text-sm text-slate-300">
              Use live voice to list open PRs, start a validation run, inspect failures, and ask repo questions without leaving the dashboard.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  void sendPrompt(prompt);
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-100 transition hover:border-emerald-300/40 hover:bg-white/10"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Live Call</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-100">
                <Radio className="h-4 w-4 text-emerald-300" />
                {statusLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={toggleMute}
                disabled={voiceState !== "active"}
                className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              {voiceState === "active" ? (
                <Button type="button" size="sm" onClick={() => void stopVoice()} className="gap-2 bg-red-500 text-white hover:bg-red-400">
                  <PhoneOff className="h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void startVoice()}
                  disabled={!publicKey}
                  className="gap-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                >
                  <Phone className="h-4 w-4" />
                  Start
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 text-sm text-slate-200">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest user transcript</p>
              <p className="mt-2 min-h-[24px] text-slate-100">{userTranscript || "Waiting for speech…"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Latest assistant response</p>
              <p className="mt-2 min-h-[24px] text-slate-100">{assistantTranscript || "No response yet."}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Last tool action</p>
              <p className="mt-2 text-slate-100">{lastToolAction}</p>
              <p className="mt-2 text-xs text-slate-400">
                Session: {latestMetadata?.session_id || activeSessionId || "none"} • Selected PR: {latestMetadata?.selected_pr?.number || selectedPrNumber || "none"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Repo search status</p>
                  <p className="mt-2 text-xs text-slate-300">
                    {repoStatus?.repoPathReady
                      ? `${repoStatus.repoPathSource === "env" ? "Configured" : "Fallback"} repo search is ready.`
                      : "Repo search is not ready yet."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void fetchRepoStatus()}
                    disabled={repoStatusLoading}
                    className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                  >
                    {repoStatusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void buildRepoIndex()}
                    disabled={indexingRepo || !repoStatus?.repoPathReady || !repoStatus?.aiEngineAvailable}
                    className="gap-2 border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
                  >
                    {indexingRepo ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                    Build code index
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${repoStatus?.repoPathReady ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-amber-400/30 bg-amber-400/10 text-amber-100"}`}>
                  <GitBranch className="h-3.5 w-3.5" />
                  Repo path {repoStatus?.repoPathReady ? "ready" : "missing"}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${repoStatus?.codeIndexReady ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
                  <DatabaseZap className="h-3.5 w-3.5" />
                  Code index {repoStatus?.codeIndexReady ? `${repoStatus.codeIndexCount} chunks` : "not built"}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${repoStatus?.axonConnected ? "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
                  <Network className="h-3.5 w-3.5" />
                  Axon {repoStatus?.axonConnected ? "connected" : "optional/offline"}
                </span>
              </div>
              {repoStatus?.warning ? <p className="mt-3 text-xs text-amber-200">{repoStatus.warning}</p> : null}
              {repoStatusError ? <p className="mt-2 text-xs text-red-300">{repoStatusError}</p> : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Recent transcript</p>
              <div className="mt-2 space-y-2 text-xs text-slate-300">
                {transcriptLog.length > 0 ? transcriptLog.map((entry) => <p key={entry}>{entry}</p>) : <p>No transcript events captured yet.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
          <Mic className="h-3.5 w-3.5" />
          {publicKey ? "Vapi key detected" : "Set NEXT_PUBLIC_VAPI_PUBLIC_KEY"}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
          PRs loaded: {pullRequests.length}
        </span>
        {repoStatus ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
            Qdrant collection: {repoStatus.qdrantCollection}
          </span>
        ) : null}
        {needsPublicServer ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-100">
            Server tools need a public URL. Set NEXT_PUBLIC_VAPI_SERVER_URL for remote Vapi webhooks.
          </span>
        ) : null}
        {voiceError ? <span className="text-red-300">{voiceError}</span> : null}
      </div>
    </section>
  );
}
