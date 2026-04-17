export interface VoiceAssistantContext {
  owner: string;
  repo: string;
  branch: string;
  targetUrl: string;
  selectedPrNumber: number | null;
  activeSessionId: string | null;
}

export type DashboardVoiceTab =
  | "pipeline"
  | "agents"
  | "tests"
  | "terminal"
  | "prs";

function buildPrompt(context: VoiceAssistantContext) {
  return [
    "You are MindFlayer Voice, a concise DevOps copilot for PR validation and repo debugging.",
    `Current repo: ${context.owner}/${context.repo} on branch ${context.branch}.`,
    `Target URL: ${context.targetUrl}.`,
    context.selectedPrNumber ? `Selected PR: ${context.selectedPrNumber}.` : "No PR is selected yet.",
    context.activeSessionId ? `Latest known session: ${context.activeSessionId}.` : "No pipeline session is active yet.",
    "The dashboard keeps the voice copilot at the top and swaps the lower workspace between five sections: Pipeline for validation runs and config, Agents for the active specialist agents, Test Results for execution outcomes, Live Terminal for the streamed logs, and PR Tracker for open pull requests.",
    "This project is a voice-first DevOps copilot that monitors pull requests, runs validation pipelines, shows agent reasoning, answers repo questions, and surfaces live debugging context from MindFlayer.",
    "The main agents are The Architect for planning and repo analysis, The Scripter for Playwright execution, The Healer for RCA and fixes, The Judge for classification, and The Courier for GitHub and notification delivery.",
    "Be action-first and brief. Use tools instead of guessing whenever the user asks about pull requests, pipeline status, deploy safety, repo structure, or dashboard navigation.",
    "If the user says run the first one, they mean the first PR from the latest PR list you returned.",
    "If a PR reference is ambiguous, ask one short clarification question.",
    "When the user asks to open, go to, take them to, or show one of the five dashboard sections, immediately call the matching navigation tool before speaking.",
    "Use your built-in context to explain the project, repo, agents, and dashboard sections in short spoken answers without calling repo tools unless the user asks for deeper codebase detail.",
    "After each tool call, summarize the result in one or two short spoken sentences.",
  ].join(" ");
}

function buildServerUrl(origin: string) {
  const override = process.env.NEXT_PUBLIC_VAPI_SERVER_URL?.trim();
  return override && override.length > 0 ? override.replace(/\/$/, "") : origin.replace(/\/$/, "");
}

export function getVapiServerBaseUrl(origin: string) {
  return buildServerUrl(origin);
}

export function createVapiAssistantConfig(origin: string, context: VoiceAssistantContext) {
  const serverUrl = `${buildServerUrl(origin)}/api/vapi/tool`;
  const prompt = buildPrompt(context);

  const tools = [
    {
      type: "function",
      async: false,
      server: { url: serverUrl },
      function: {
        name: "list_pull_requests",
        description: "List the latest open pull requests for the current repository.",
        parameters: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Optional repository owner override." },
            repo: { type: "string", description: "Optional repository name override." },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      server: { url: serverUrl },
      function: {
        name: "run_pull_request",
        description: "Start the MindFlayer pipeline for an open pull request.",
        parameters: {
          type: "object",
          properties: {
            pr_number: { type: "number", description: "The pull request number to run." },
            owner: { type: "string" },
            repo: { type: "string" },
          },
          required: ["pr_number"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      server: { url: serverUrl },
      function: {
        name: "get_pipeline_status",
        description: "Check the latest MindFlayer pipeline status and whether it is safe to deploy.",
        parameters: {
          type: "object",
          properties: {
            session_id: { type: "string", description: "Optional session id to inspect." },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      server: { url: serverUrl },
      function: {
        name: "ask_repo_question",
        description: "Ask the repo graph and AI engine a question about the codebase.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "The repo question to answer." },
          },
          required: ["question"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      function: {
        name: "open_pipeline_tab",
        description: "Open the Pipeline section of the dashboard and move the user to the pipeline workspace.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      function: {
        name: "open_agents_tab",
        description: "Open the Agents section of the dashboard and move the user to the agent overview workspace.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      function: {
        name: "open_test_results_tab",
        description: "Open the Test Results section of the dashboard and move the user to the execution results workspace.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      function: {
        name: "open_live_terminal_tab",
        description: "Open the Live Terminal section of the dashboard and move the user to the streamed logs workspace.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      async: false,
      function: {
        name: "open_pr_tracker_tab",
        description: "Open the PR Tracker section of the dashboard and move the user to the pull request workspace.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ];

  const assistant = {
    name: "MindFlayer Voice",
    firstMessageMode: "assistant-waits-for-user",
    transcriber: {
      provider: "assembly-ai",
      speechModel: "universal-streaming-english",
      language: "en",
      keytermsPrompt: [
        "MindFlayer",
        "pull request",
        "PR",
        "GitHub",
        "pipeline",
        "DevOps",
        "deploy",
        "Qdrant",
        "Vapi",
        "auth",
      ],
    },
    model: {
      provider: "openai",
      model: "gpt-4.1",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
      tools,
    },
    voice: {
      provider: "openai",
      voiceId: "alloy",
    },
    clientMessages: ["transcript", "status-update", "speech-update", "tool-calls", "tool-calls-result"],
    serverMessages: ["tool-calls"],
  } as any;

  return {
    assistant,
    assistantOverrides: {
      model: assistant.model,
      voice: assistant.voice,
      transcriber: assistant.transcriber,
      firstMessageMode: assistant.firstMessageMode,
      clientMessages: assistant.clientMessages,
      serverMessages: assistant.serverMessages,
    } as any,
  };
}

export function parseToolResult(result: unknown) {
  if (typeof result !== "string") return null;

  try {
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return null;
  }
}
