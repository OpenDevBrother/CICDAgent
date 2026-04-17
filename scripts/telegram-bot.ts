import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const OWNER = process.env.SENTINELQA_DEFAULT_OWNER ?? "";
const REPO = process.env.SENTINELQA_DEFAULT_REPO ?? "";
const API_BASE = "http://localhost:3000";

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

console.log(`🤖 MindFlayer Telegram Bot starting...`);
console.log(`   Owner: ${OWNER}, Repo: ${REPO}`);
console.log(`   Chat ID: ${CHAT_ID}`);

let offset = 0;
let lastSessionId = "";
let cachedPrs: Array<{
  number: number;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
}> = [];

async function sendMessage(text: string, chatId?: string): Promise<void> {
  const chat = chatId ?? CHAT_ID;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[Bot] Failed to send:", err);
  }
}

async function handlePrs(chatId: string): Promise<void> {
  if (!OWNER || !REPO) {
    await sendMessage("❌ SENTINELQA_DEFAULT_OWNER or SENTINELQA_DEFAULT_REPO not set", chatId);
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/agent/pull-requests?owner=${OWNER}&repo=${REPO}&state=open`
    );
    const data = await res.json();

    if (!res.ok) {
      await sendMessage(`❌ Error: ${data.error ?? "Failed to fetch PRs"}`, chatId);
      return;
    }

    const prs = data.pull_requests ?? [];
    cachedPrs = prs;

    if (prs.length === 0) {
      await sendMessage(`📋 No open PRs in ${OWNER}/${REPO}`, chatId);
      return;
    }

    let msg = `📋 <b>Open PRs — ${OWNER}/${REPO}</b>\n\n`;
    for (const pr of prs) {
      const ago = pr.createdAt
        ? timeSince(new Date(pr.createdAt))
        : "";
      msg += `<b>#${pr.number}</b> — ${escHtml(pr.title)}\n`;
      msg += `   <code>${pr.headRef}</code> → <code>${pr.baseRef}</code>\n`;
      msg += `   by ${escHtml(pr.author)}${ago ? ` • ${ago}` : ""}\n\n`;
    }
    msg += `Reply <code>/run &lt;number&gt;</code> to test a PR`;

    await sendMessage(msg, chatId);
  } catch (err) {
    await sendMessage(`❌ Could not reach MindFlayer API. Is npm run dev running?`, chatId);
  }
}

async function handleRun(chatId: string, prNumber: number): Promise<void> {
  // Auto-fetch PRs if cache is empty or PR not found
  let pr = cachedPrs.find((p) => p.number === prNumber);
  if (!pr) {
    try {
      const res = await fetch(
        `${API_BASE}/api/agent/pull-requests?owner=${OWNER}&repo=${REPO}&state=open`
      );
      const data = await res.json();
      if (res.ok) {
        cachedPrs = data.pull_requests ?? [];
        pr = cachedPrs.find((p) => p.number === prNumber);
      }
    } catch {}
  }

  if (!pr) {
    const available = cachedPrs.map((p) => `#${p.number}`).join(", ") || "none";
    await sendMessage(
      `❌ PR #${prNumber} not found.\nOpen PRs: ${available}\n\nRun /prs to refresh.`,
      chatId
    );
    return;
  }

  await sendMessage(
    `🚀 <b>Starting pipeline for PR #${pr.number}</b>\n` +
      `${escHtml(pr.title)}\n` +
      `<code>${pr.headRef}</code> → <code>${pr.baseRef}</code>\n\n` +
      `Updates will follow...`,
    chatId
  );

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
      await sendMessage(`❌ Pipeline failed to start: ${data.error ?? "Unknown error"}`, chatId);
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

    let summary = `🏁 <b>Pipeline Complete — PR #${pr.number}</b>\n\n`;

    // Per-test results
    for (const test of details) {
      const icon = test.status === "passed" ? "✅" : "❌";
      summary += `${icon} ${escHtml(test.name)}\n`;
      if (test.status === "failed" && test.error) {
        const shortErr = test.error.split("\n")[0].slice(0, 100);
        summary += `   <i>${escHtml(shortErr)}</i>\n`;
      }
    }

    summary += `\n📊 Results: ${passed}/${total} passed`;
    if (failed > 0) summary += ` | ${failed} failed`;
    summary += `\n⏱ Duration: ${(duration / 1000).toFixed(1)}s\n`;

    if (courierResult.url) {
      summary += `\n📨 Issue: ${escHtml(courierResult.url)}`;
    }
    if (prResult.url) {
      summary += `\n📬 Fix PR: ${escHtml(prResult.url)}`;
    }

    summary += `\n\n🆔 Session: <code>${lastSessionId}</code>`;

    await sendMessage(summary, chatId);
  } catch (err) {
    await sendMessage(
      `❌ Pipeline request failed. Is MindFlayer running?\n${err instanceof Error ? err.message : "Unknown error"}`,
      chatId
    );
  }
}

async function handleStatus(chatId: string): Promise<void> {
  if (!lastSessionId) {
    await sendMessage("❌ No pipeline has been run yet. Use /run first.", chatId);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/agent/sessions/${lastSessionId}`);
    const data = await res.json();

    if (!res.ok) {
      await sendMessage(`❌ Session not found: ${lastSessionId}`, chatId);
      return;
    }

    const session = data.session ?? data;
    const output = session.output ?? {};
    const courier = session.courier_result ?? {};

    let msg = `📊 <b>Session Status</b>\n\n`;
    msg += `🆔 <code>${lastSessionId}</code>\n`;
    msg += `Status: <b>${session.status ?? "unknown"}</b>\n`;

    if (output.total) {
      msg += `Tests: ${output.passed ?? 0}/${output.total} passed\n`;
    }
    if (courier.url) {
      msg += `${courier.type === "pr" ? "📬 PR" : "📨 Issue"}: ${escHtml(courier.url)}\n`;
    }

    await sendMessage(msg, chatId);
  } catch {
    await sendMessage(`❌ Could not reach MindFlayer API.`, chatId);
  }
}

async function handleAsk(chatId: string, question: string): Promise<void> {
  await sendMessage(`🧠 Analyzing...`, chatId);
  try {
    const res = await fetch(`${API_BASE}/api/agent/axon/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (!res.ok && !data.answer) {
      await sendMessage(`❌ ${data.error ?? "Chat failed"}`, chatId);
      return;
    }
    const answer = data.answer ?? "No answer generated";
    await sendMessage(`💡 <b>MindFlayer</b>\n\n${escHtml(answer)}`, chatId);
  } catch {
    await sendMessage(`❌ AI Engine or Axon not running.`, chatId);
  }
}

async function handleImpact(chatId: string, symbol: string): Promise<void> {
  await sendMessage(`📊 Analyzing blast radius of <code>${escHtml(symbol)}</code>...`, chatId);
  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "impact", nodeId: symbol }),
    });
    const data = await res.json();
    if (!res.ok) {
      await sendMessage(`❌ ${data.error ?? "Impact analysis failed"}`, chatId);
      return;
    }
    const affected = data.affected ?? [];
    let msg = `📊 <b>Blast Radius: ${escHtml(symbol)}</b>\n\n`;
    msg += `Affected: <b>${affected.length}</b> symbols\n\n`;
    for (const a of affected.slice(0, 10)) {
      msg += `${"→".repeat(a.depth ?? 1)} ${escHtml(a.name)} (${escHtml(a.type)})\n`;
    }
    if (affected.length > 10) msg += `\n... and ${affected.length - 10} more`;
    await sendMessage(msg, chatId);
  } catch {
    await sendMessage(`❌ Axon not running. Start with: axon ui --watch`, chatId);
  }
}

async function handleDeadCode(chatId: string): Promise<void> {
  await sendMessage(`🔍 Scanning for dead code...`, chatId);
  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deadcode" }),
    });
    const data = await res.json();
    if (!res.ok) {
      await sendMessage(`❌ ${data.error ?? "Dead code scan failed"}`, chatId);
      return;
    }
    const total = data.total ?? 0;
    const byFile = data.byFile ?? {};
    if (total === 0) {
      await sendMessage(`✅ <b>No dead code found!</b> Repository is clean.`, chatId);
      return;
    }
    let msg = `⚠️ <b>Dead Code Found: ${total} symbols</b>\n\n`;
    let shown = 0;
    for (const [file, symbols] of Object.entries(byFile)) {
      if (shown >= 10) break;
      msg += `📄 <b>${escHtml(file)}</b>\n`;
      for (const s of (symbols as any[]).slice(0, 3)) {
        msg += `   🗑 <code>${escHtml(s.name)}</code> (${escHtml(s.type)}) line ${s.line}\n`;
        shown++;
      }
      msg += "\n";
    }
    if (total > shown) msg += `... and ${total - shown} more`;
    await sendMessage(msg, chatId);
  } catch {
    await sendMessage(`❌ Axon not running. Start with: axon ui --watch`, chatId);
  }
}

async function handleGraph(chatId: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/agent/axon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "overview" }),
    });
    const data = await res.json();
    if (!res.ok) {
      await sendMessage(`❌ ${data.error ?? "Overview failed"}`, chatId);
      return;
    }
    const nodesByLabel = data.nodesByLabel ?? {};
    const edgesByType = data.edgesByType ?? {};
    let msg = `🧠 <b>Knowledge Graph Overview</b>\n\n`;
    msg += `Nodes: <b>${data.totalNodes ?? 0}</b>\n`;
    msg += `Edges: <b>${data.totalEdges ?? 0}</b>\n\n`;
    const labels = Object.entries(nodesByLabel).map(([k, v]) => `${k}: ${v}`).join(", ");
    if (labels) msg += `📦 ${labels}\n`;
    const edges = Object.entries(edgesByType).map(([k, v]) => `${k}: ${v}`).join(", ");
    if (edges) msg += `🔗 ${edges}\n`;
    msg += `\n🌐 Dashboard: http://localhost:8420`;
    await sendMessage(msg, chatId);
  } catch {
    await sendMessage(`❌ Axon not running. Start with: axon ui --watch`, chatId);
  }
}

async function handleScreenshot(chatId: string, url?: string): Promise<void> {
  await sendMessage(`📸 Taking screenshot...`, chatId);
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
      await sendMessage(`❌ ${data.error ?? "Screenshot failed"}`, chatId);
      return;
    }

    const base64Image: string = data.image;
    const mimeType: string = data.mimeType ?? "image/jpeg";
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const buffer = Buffer.from(base64Image, "base64");
    const blob = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("photo", blob, `screenshot.${ext}`);
    formData.append("caption", `Screenshot of ${data.url ?? "target app"}`);

    const photoRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: formData }
    );

    if (!photoRes.ok) {
      const err = await photoRes.text();
      console.error("[Bot] sendPhoto failed:", err);
      await sendMessage(`❌ Failed to send photo to Telegram`, chatId);
    }
  } catch (err) {
    await sendMessage(
      `❌ Screenshot failed. Is the target app running?\n${err instanceof Error ? err.message : ""}`,
      chatId
    );
  }
}

async function handleHelp(chatId: string): Promise<void> {
  await sendMessage(
    `🤖 <b>MindFlayer Boss Agent</b>\n\n` +
      `<b>Pipeline</b>\n` +
      `/prs — List open pull requests\n` +
      `/run &lt;number&gt; — Run pipeline for a PR\n` +
      `/status — Check last pipeline results\n` +
      `/screenshot — Live screenshot of target app\n\n` +
      `<b>Knowledge Graph</b>\n` +
      `/ask &lt;question&gt; — Search codebase\n` +
      `/impact &lt;symbol&gt; — Blast radius analysis\n` +
      `/deadcode — Find unreachable code\n` +
      `/graph — Knowledge graph stats\n\n` +
      `/help — Show this message\n\n` +
      `<i>Repo: ${OWNER}/${REPO}</i>`,
    chatId
  );
}

async function processUpdate(text: string, chatId: string): Promise<void> {
  const trimmed = text.trim();
  const [cmd, ...args] = trimmed.split(/\s+/);
  const command = cmd.toLowerCase().replace(/^\//, "");

  switch (command) {
    case "prs":
    case "pr":
      await handlePrs(chatId);
      break;

    case "run":
    case "test": {
      const num = parseInt(args[0], 10);
      if (isNaN(num)) {
        await sendMessage("❌ Usage: /run &lt;PR number&gt;\nExample: /run 1", chatId);
      } else {
        await handleRun(chatId, num);
      }
      break;
    }

    case "status":
      await handleStatus(chatId);
      break;

    case "ask":
    case "search": {
      if (!args.length) {
        await sendMessage("❌ Usage: /ask &lt;question&gt;\nExample: /ask what files exist", chatId);
      } else {
        await handleAsk(chatId, args.join(" "));
      }
      break;
    }

    case "impact": {
      if (!args.length) {
        await sendMessage("❌ Usage: /impact &lt;symbol or file&gt;\nExample: /impact index.html", chatId);
      } else {
        await handleImpact(chatId, args[0]);
      }
      break;
    }

    case "deadcode":
      await handleDeadCode(chatId);
      break;

    case "graph":
      await handleGraph(chatId);
      break;

    case "screenshot":
    case "ss":
    case "preview": {
      const screenshotUrl = args.length > 0 ? args[0] : undefined;
      await handleScreenshot(chatId, screenshotUrl);
      break;
    }

    case "help":
    case "start":
      await handleHelp(chatId);
      break;

    default:
      await sendMessage(
        `Unknown command: <code>${escHtml(trimmed)}</code>\nSend /help for available commands.`,
        chatId
      );
  }
}

async function poll(): Promise<void> {
  console.log("🤖 Bot polling started. Waiting for commands...\n");

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );

      const data = await res.json();

      if (!data.ok || !data.result) {
        console.error("[Bot] Bad response:", data);
        await sleep(2000);
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;

        const msg = update.message;
        if (!msg?.text) continue;

        const chatId = String(msg.chat.id);
        const username = msg.from?.username ?? "unknown";
        console.log(`[${username}] ${msg.text}`);

        await processUpdate(msg.text, chatId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") continue;
      console.error("[Bot] Poll error:", err);
      await sleep(3000);
    }
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

poll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
