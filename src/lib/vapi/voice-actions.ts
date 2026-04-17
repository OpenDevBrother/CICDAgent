import { sessionManager } from "@/lib/mcp/session-provider";

export interface VoicePullRequestSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  headRef: string;
  baseRef: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface VoiceToolMetadata {
  owner?: string;
  repo?: string;
  spoken_summary: string;
  pull_requests?: VoicePullRequestSummary[];
  pull_request_count?: number;
  selected_pr?: VoicePullRequestSummary;
  session_id?: string;
  pipeline_started?: boolean;
  state?: string;
  passed?: number;
  failed?: number;
  total?: number;
  safe_to_deploy?: boolean;
  courier?: { type?: string; url?: string; number?: number };
  answer?: string;
  context?: string;
}

interface VoiceActionContext {
  origin: string;
  owner?: string;
  repo?: string;
  branch?: string;
  targetUrl?: string;
  githubMcpMode?: "docker" | "npx";
  slackChannel?: string;
}

interface VoiceActionResult {
  ok: boolean;
  spoken_summary: string;
  [key: string]: unknown;
}

const MAX_VOICE_PULL_REQUEST_RESULTS = 8;

function resolveAppOrigin(origin: string) {
  const configured =
    process.env.INTERNAL_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.SENTINELQA_APP_URL?.trim() ||
    "";

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  return origin.replace(/\/$/, "");
}

function getEffectiveConfig(overrides?: Partial<VoiceActionContext>) {
  return {
    owner: overrides?.owner?.trim() || process.env.SENTINELQA_DEFAULT_OWNER || "",
    repo: overrides?.repo?.trim() || process.env.SENTINELQA_DEFAULT_REPO || "",
    branch: overrides?.branch?.trim() || process.env.SENTINELQA_DEFAULT_BRANCH || "main",
    targetUrl: overrides?.targetUrl?.trim() || process.env.SENTINELQA_TARGET_URL || "",
    githubMcpMode: overrides?.githubMcpMode || "npx",
    slackChannel: overrides?.slackChannel?.trim() || "",
  };
}

function trimForVoice(text: string, maxLength = 260) {
  const normalized = text.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildHeaders() {
  return { "Content-Type": "application/json" };
}

async function fetchPullRequests(origin: string, overrides?: Partial<VoiceActionContext>) {
  const appOrigin = resolveAppOrigin(origin);
  const config = getEffectiveConfig(overrides);
  if (!config.owner || !config.repo) {
    throw new Error("Owner and repo are not configured.");
  }

  const query = new URLSearchParams({
    owner: config.owner,
    repo: config.repo,
    state: "open",
  });

  const response = await fetch(`${appOrigin}/api/agent/pull-requests?${query.toString()}`, {
    cache: "no-store",
    headers: buildHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error ?? "Failed to load pull requests.");
  }

  return {
    owner: config.owner,
    repo: config.repo,
    pullRequests: (data?.pull_requests ?? []) as VoicePullRequestSummary[],
  };
}

function summarizePullRequests(owner: string, repo: string, pullRequests: VoicePullRequestSummary[]) {
  if (pullRequests.length === 0) {
    return `There are no open pull requests in ${owner}/${repo} right now.`;
  }

  const preview = pullRequests
    .slice(0, 3)
    .map((pr) => `PR ${pr.number}: ${trimForVoice(pr.title, 50)}`)
    .join(". ");

  return `I found ${pullRequests.length} open pull request${pullRequests.length === 1 ? "" : "s"} in ${owner}/${repo}. ${preview}`;
}

export async function listPullRequestsAction(
  context: VoiceActionContext,
  overrides?: Partial<VoiceActionContext>,
): Promise<VoiceActionResult & VoiceToolMetadata> {
  const { owner, repo, pullRequests } = await fetchPullRequests(context.origin, overrides);
  const voiceSafePullRequests = pullRequests.slice(0, MAX_VOICE_PULL_REQUEST_RESULTS);
  return {
    ok: true,
    owner,
    repo,
    spoken_summary: summarizePullRequests(owner, repo, pullRequests),
    pull_requests: voiceSafePullRequests,
    pull_request_count: pullRequests.length,
  };
}

export async function runPullRequestAction(
  context: VoiceActionContext,
  prNumber?: number,
  overrides?: Partial<VoiceActionContext>,
): Promise<VoiceActionResult & VoiceToolMetadata> {
  const config = getEffectiveConfig(overrides);
  const { pullRequests } = await fetchPullRequests(context.origin, config);

  if (pullRequests.length === 0) {
    return {
      ok: false,
      spoken_summary: `I could not find any open pull requests to run in ${config.owner}/${config.repo}.`,
    };
  }

  if (!prNumber) {
    return {
      ok: false,
      spoken_summary: "Tell me which pull request to run, for example run PR 12.",
      pull_requests: pullRequests,
    };
  }

  const selectedPr = pullRequests.find((pr) => pr.number === prNumber);
  if (!selectedPr) {
    return {
      ok: false,
      spoken_summary: `I couldn't find PR ${prNumber} in the current open pull request list.`,
      pull_requests: pullRequests,
    };
  }

  if (!config.targetUrl) {
    return {
      ok: false,
      spoken_summary: "The target URL is not configured, so I cannot start the pipeline yet.",
      selected_pr: selectedPr,
    };
  }

  const sessionId = `pipeline_${Date.now()}`;
  const payload = {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    target_url: config.targetUrl,
    github_mcp_mode: config.githubMcpMode,
    slack_channel: config.slackChannel || undefined,
    session_id: sessionId,
    selected_pr: {
      number: selectedPr.number,
      title: selectedPr.title,
      url: selectedPr.url,
      headRef: selectedPr.headRef,
      baseRef: selectedPr.baseRef,
    },
  };

  const appOrigin = resolveAppOrigin(context.origin);

  void fetch(`${appOrigin}/api/agent/pipeline`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error("[vapi/run-pr] Background pipeline trigger failed", error);
  });

  return {
    ok: true,
    spoken_summary: `Starting pipeline run for PR ${selectedPr.number}, ${trimForVoice(selectedPr.title, 80)}. I will keep tracking session ${sessionId}.`,
    session_id: sessionId,
    selected_pr: selectedPr,
    pipeline_started: true,
    state: "running",
  };
}

function buildStatusSummary(session: any) {
  const output = session?.output ?? {};
  const total = Number(output?.total ?? 0);
  const passed = Number(output?.passed ?? 0);
  const failed = Number(output?.failed ?? 0);
  const state = String(session?.status ?? "unknown");
  const safeToDeploy = state === "completed" && total > 0 && failed === 0;

  if (state === "running" || state === "pending") {
    return {
      spoken_summary: `The latest pipeline session ${session.id} is still ${state}. I would wait before deploying.`,
      safeToDeploy: false,
      passed,
      failed,
      total,
      state,
    };
  }

  if (safeToDeploy) {
    return {
      spoken_summary: `Session ${session.id} looks safe to deploy. All ${passed} out of ${total} tests passed.`,
      safeToDeploy,
      passed,
      failed,
      total,
      state,
    };
  }

  if (total > 0) {
    return {
      spoken_summary: `Session ${session.id} is not safe to deploy. ${failed} out of ${total} tests failed.`,
      safeToDeploy,
      passed,
      failed,
      total,
      state,
    };
  }

  return {
    spoken_summary: `Session ${session.id} finished with status ${state}, but I do not have test totals yet.`,
    safeToDeploy,
    passed,
    failed,
    total,
    state,
  };
}

export async function getPipelineStatusAction(
  _context: VoiceActionContext,
  sessionId?: string,
): Promise<VoiceActionResult & VoiceToolMetadata> {
  const session = sessionId
    ? await sessionManager.getSession(sessionId)
    : (await sessionManager.listSessions()).find((item: any) => item?.id);

  if (!session) {
    return {
      ok: false,
      spoken_summary: "I couldn't find a recent pipeline session yet.",
    };
  }

  const summary = buildStatusSummary(session);
  return {
    ok: true,
    spoken_summary: summary.spoken_summary,
    session_id: session.id,
    state: summary.state,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    safe_to_deploy: summary.safeToDeploy,
    courier: session.courier_result,
  };
}

export async function askRepoQuestionAction(
  context: VoiceActionContext,
  question: string,
): Promise<VoiceActionResult & VoiceToolMetadata> {
  const cleanQuestion = question?.trim();
  if (!cleanQuestion) {
    return {
      ok: false,
      spoken_summary: "Ask a repo question and I will search the codebase for you.",
    };
  }

  const appOrigin = resolveAppOrigin(context.origin);

  const response = await fetch(`${appOrigin}/api/agent/axon/chat`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ question: cleanQuestion }),
  });
  const data = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      spoken_summary: trimForVoice(data?.answer ?? data?.error ?? "The repo assistant failed to answer right now."),
      answer: data?.answer,
      context: data?.context,
    };
  }

  const answer = String(data?.answer ?? "No answer generated.");
  return {
    ok: true,
    spoken_summary: trimForVoice(answer),
    answer,
    context: typeof data?.context === "string" ? trimForVoice(data.context, 1000) : undefined,
  };
}

export async function dispatchVoiceAction(
  context: VoiceActionContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<VoiceActionResult & VoiceToolMetadata> {
  if (toolName === "list_pull_requests") {
    return listPullRequestsAction(context, {
      owner: typeof args.owner === "string" ? args.owner : undefined,
      repo: typeof args.repo === "string" ? args.repo : undefined,
    });
  }

  if (toolName === "run_pull_request") {
    return runPullRequestAction(
      context,
      typeof args.pr_number === "number" ? args.pr_number : Number(args.pr_number || 0) || undefined,
      {
        owner: typeof args.owner === "string" ? args.owner : undefined,
        repo: typeof args.repo === "string" ? args.repo : undefined,
      },
    );
  }

  if (toolName === "get_pipeline_status") {
    return getPipelineStatusAction(
      context,
      typeof args.session_id === "string" ? args.session_id : undefined,
    );
  }

  if (toolName === "ask_repo_question") {
    return askRepoQuestionAction(
      context,
      typeof args.question === "string" ? args.question : "",
    );
  }

  return {
    ok: false,
    spoken_summary: `Tool ${toolName} is not supported by the voice bridge.`,
  };
}
