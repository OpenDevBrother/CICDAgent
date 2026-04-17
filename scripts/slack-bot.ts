import * as dotenv from "dotenv";
import * as path from "path";
import { App, LogLevel } from "@slack/bolt";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const OWNER = process.env.SENTINELQA_DEFAULT_OWNER ?? "";
const REPO = process.env.SENTINELQA_DEFAULT_REPO ?? "";
const API_BASE = "http://localhost:3000";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

let cachedPrs: Array<{
  number: number;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  createdAt?: string;
}> = [];
let lastSessionId = "";

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

// ─── /prs ────────────────────────────────────────────────────────────────────

app.command("/prs", async ({ ack, respond }) => {
  await ack();

  if (!OWNER || !REPO) {
    await respond("SENTINELQA_DEFAULT_OWNER or SENTINELQA_DEFAULT_REPO not set");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/agent/pull-requests?owner=${OWNER}&repo=${REPO}&state=open`);
    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: ${data.error ?? "Failed to fetch PRs"}`);
      return;
    }

    const prs = data.pull_requests ?? [];
    cachedPrs = prs;

    if (prs.length === 0) {
      await respond(`:clipboard: No open PRs in ${OWNER}/${REPO}`);
      return;
    }

    let msg = `:clipboard: *Open PRs — ${OWNER}/${REPO}*\n\n`;
    for (const pr of prs) {
      const ago = pr.createdAt ? timeSince(pr.createdAt) : "";
      msg += `*#${pr.number}* — ${pr.title}\n`;
      msg += `   \`${pr.headRef}\` → \`${pr.baseRef}\`\n`;
      msg += `   by ${pr.author}${ago ? ` • ${ago}` : ""}\n\n`;
    }
    msg += `Use \`/run <number>\` to test a PR`;

    await respond(msg);
  } catch {
    await respond(":x: Could not reach MindFlayer API. Is `npm run dev` running?");
  }
});

// ─── /run ────────────────────────────────────────────────────────────────────

app.command("/run", async ({ ack, respond, command }) => {
  await ack();

  const prNumber = parseInt(command.text.trim(), 10);
  if (isNaN(prNumber)) {
    await respond(":x: Usage: `/run <PR number>`\nExample: `/run 1`");
    return;
  }

  let pr = cachedPrs.find((p) => p.number === prNumber);
  if (!pr) {
    try {
      const res = await fetch(`${API_BASE}/api/agent/pull-requests?owner=${OWNER}&repo=${REPO}&state=open`);
      const data = await res.json();
      if (res.ok) {
        cachedPrs = data.pull_requests ?? [];
        pr = cachedPrs.find((p) => p.number === prNumber);
      }
    } catch {}
  }

  if (!pr) {
    const available = cachedPrs.map((p) => `#${p.number}`).join(", ") || "none";
    await respond(`:x: PR #${prNumber} not found.\nOpen PRs: ${available}\n\nRun \`/prs\` to refresh.`);
    return;
  }

  await respond(`:rocket: *Starting pipeline for PR #${pr.number}*\n${pr.title}\n\`${pr.headRef}\` → \`${pr.baseRef}\`\n\nUpdates will follow...`);

  try {
    const res = await fetch(`${API_BASE}/api/agent/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: OWNER,
        repo: REPO,
        branch: pr.baseRef,
        target_url: process.env.SENTINELQA_TARGET_URL ?? "http://localhost:5173",
        selected_pr: {
          number: pr.number,
          title: pr.title,
          headRef: pr.headRef,
          baseRef: pr.baseRef,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: Pipeline failed to start: ${data.error ?? "Unknown error"}`);
      return;
    }

    lastSessionId = data.session_id ?? "";
    const results = data.results ?? {};
    const passed = results.passed ?? 0;
    const failed = results.failed ?? 0;
    const total = results.total ?? 0;
    const duration = results.duration_ms ?? 0;
    const details = results.details ?? [];
    const courierResult = data.courier ?? {};
    const prResult = data.pr ?? {};

    let summary = `:checkered_flag: *Pipeline Complete — PR #${pr.number}*\n\n`;

    for (const test of details) {
      const icon = test.status === "passed" ? ":white_check_mark:" : ":x:";
      summary += `${icon} ${test.name}\n`;
      if (test.status === "failed" && test.error) {
        const shortErr = test.error.split("\n")[0].slice(0, 100);
        summary += `   _${shortErr}_\n`;
      }
    }

    summary += `\n:bar_chart: Results: ${passed}/${total} passed`;
    if (failed > 0) summary += ` | ${failed} failed`;
    summary += `\n:stopwatch: Duration: ${(duration / 1000).toFixed(1)}s\n`;

    if (courierResult.url) summary += `\n:envelope: Issue: ${courierResult.url}`;
    if (prResult.url) summary += `\n:mailbox_with_mail: Fix PR: ${prResult.url}`;
    summary += `\n\n:id: Session: \`${lastSessionId}\``;

    await respond(summary);
  } catch (err) {
    await respond(`:x: Pipeline request failed. Is MindFlayer running?\n${err instanceof Error ? err.message : ""}`);
  }
});

// ─── /status ─────────────────────────────────────────────────────────────────

app.command("/showstatus", async ({ ack, respond }) => {
  await ack();

  if (!lastSessionId) {
    await respond(":x: No pipeline has been run yet. Use `/run` first.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/agent/sessions/${lastSessionId}`);
    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: Session not found: ${lastSessionId}`);
      return;
    }

    const session = data.session ?? data;
    const output = session.output ?? {};
    const courier = session.courier_result ?? {};

    let msg = `:bar_chart: *Session Status*\n\n`;
    msg += `:id: \`${lastSessionId}\`\n`;
    msg += `Status: *${session.status ?? "unknown"}*\n`;
    if (output.total) msg += `Tests: ${output.passed ?? 0}/${output.total} passed\n`;
    if (courier.url) msg += `${courier.type === "pr" ? ":mailbox_with_mail: PR" : ":envelope: Issue"}: ${courier.url}\n`;

    await respond(msg);
  } catch {
    await respond(":x: Could not reach MindFlayer API.");
  }
});

// ─── /ask ────────────────────────────────────────────────────────────────────

app.command("/ask", async ({ ack, respond, command }) => {
  await ack();

  const question = command.text.trim();
  if (!question) {
    await respond(":x: Usage: `/ask <question>`\nExample: `/ask what files handle auth`");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/agent/axon/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    if (!res.ok && !data.answer) {
      await respond(`:x: ${data.error ?? "Chat failed"}`);
      return;
    }

    const answer = data.answer ?? "No answer generated";
    await respond(`:bulb: *MindFlayer*\n\n${answer}`);
  } catch {
    await respond(":x: AI Engine or Axon not running.");
  }
});

// ─── /impact ─────────────────────────────────────────────────────────────────

app.command("/impact", async ({ ack, respond, command }) => {
  await ack();

  const symbol = command.text.trim();
  if (!symbol) {
    await respond(":x: Usage: `/impact <symbol or file>`\nExample: `/impact validators.js`");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "impact", nodeId: symbol }),
    });
    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: ${data.error ?? "Impact analysis failed"}`);
      return;
    }

    const affected = data.affected ?? [];
    let msg = `:bar_chart: *Blast Radius: ${symbol}*\n\nAffected: *${affected.length}* symbols\n\n`;
    for (const a of affected.slice(0, 10)) {
      msg += `${"→".repeat(a.depth ?? 1)} ${a.name} (${a.type})\n`;
    }
    if (affected.length > 10) msg += `\n... and ${affected.length - 10} more`;

    await respond(msg);
  } catch {
    await respond(":x: Axon not running. Start with: `axon ui --watch`");
  }
});

// ─── /deadcode ───────────────────────────────────────────────────────────────

app.command("/deadcode", async ({ ack, respond }) => {
  await ack();

  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deadcode" }),
    });
    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: ${data.error ?? "Dead code scan failed"}`);
      return;
    }

    const total = data.total ?? 0;
    const byFile = data.byFile ?? {};

    if (total === 0) {
      await respond(":white_check_mark: *No dead code found!* Repository is clean.");
      return;
    }

    let msg = `:warning: *Dead Code Found: ${total} symbols*\n\n`;
    let shown = 0;
    for (const [file, symbols] of Object.entries(byFile)) {
      if (shown >= 10) break;
      msg += `:page_facing_up: *${file}*\n`;
      for (const s of (symbols as any[]).slice(0, 3)) {
        msg += `   :wastebasket: \`${s.name}\` (${s.type}) line ${s.line}\n`;
        shown++;
      }
      msg += "\n";
    }
    if (total > shown) msg += `... and ${total - shown} more`;

    await respond(msg);
  } catch {
    await respond(":x: Axon not running. Start with: `axon ui --watch`");
  }
});

// ─── /graph ──────────────────────────────────────────────────────────────────

app.command("/graph", async ({ ack, respond }) => {
  await ack();

  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "overview" }),
    });
    const data = await res.json();

    if (!res.ok) {
      await respond(`:x: ${data.error ?? "Overview failed"}`);
      return;
    }

    const nodesByLabel = data.nodesByLabel ?? {};
    const edgesByType = data.edgesByType ?? {};

    let msg = `:brain: *Knowledge Graph Overview*\n\n`;
    msg += `Nodes: *${data.totalNodes ?? 0}*\n`;
    msg += `Edges: *${data.totalEdges ?? 0}*\n\n`;

    const labels = Object.entries(nodesByLabel).map(([k, v]) => `${k}: ${v}`).join(", ");
    if (labels) msg += `:package: ${labels}\n`;
    const edges = Object.entries(edgesByType).map(([k, v]) => `${k}: ${v}`).join(", ");
    if (edges) msg += `:link: ${edges}\n`;
    msg += `\n:globe_with_meridians: Dashboard: http://localhost:8420`;

    await respond(msg);
  } catch {
    await respond(":x: Axon not running. Start with: `axon ui --watch`");
  }
});

// ─── /screenshot ─────────────────────────────────────────────────────────────

app.command("/screenshot", async ({ ack, respond, command, client }) => {
  await ack();

  const url = command.text.trim() || undefined;
  await respond(":camera: Taking screenshot...");

  try {
    const body: Record<string, string> = {};
    if (url) body.url = url;

    const res = await fetch(`${API_BASE}/api/agent/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      await respond(`:x: ${data.error ?? "Screenshot failed"}`);
      return;
    }

    const buffer = Buffer.from(data.image, "base64");

    await client.filesUploadV2({
      channel_id: command.channel_id,
      file: buffer,
      filename: "screenshot.jpg",
      title: `Screenshot of ${data.url ?? "target app"}`,
    });
  } catch (err) {
    await respond(`:x: Screenshot failed. Is the target app running?\n${err instanceof Error ? err.message : ""}`);
  }
});

// ─── /mf-help ────────────────────────────────────────────────────────────────

app.command("/mf-help", async ({ ack, respond }) => {
  await ack();

  await respond(
    `:robot_face: *MindFlayer Boss Agent*\n\n` +
    `*Pipeline*\n` +
    `/prs — List open pull requests\n` +
    `/run <number> — Run pipeline for a PR\n` +
    `/showstatus — Check last pipeline results\n` +
    `/screenshot — Live screenshot of target app\n\n` +
    `*Knowledge Graph*\n` +
    `/ask <question> — Search codebase\n` +
    `/impact <symbol> — Blast radius analysis\n` +
    `/deadcode — Find unreachable code\n` +
    `/graph — Knowledge graph stats\n\n` +
    `/mf-help — Show this message\n\n` +
    `_Repo: ${OWNER}/${REPO}_`
  );
});

// ─── Start ───────────────────────────────────────────────────────────────────

(async () => {
  await app.start();
  console.log("🤖 MindFlayer Slack Bot started (Socket Mode)");
  console.log(`   Owner: ${OWNER}, Repo: ${REPO}`);
})();
