import "server-only";

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = () => process.env.TELEGRAM_CHAT_ID ?? "";

async function send(text: string, chatId?: string): Promise<void> {
  const token = BOT_TOKEN();
  const chat = chatId ?? CHAT_ID();

  if (!token || !chat) {
    console.warn("[Telegram] Bot token or chat ID not configured — skipping");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] Failed (${res.status}): ${err}`);
    } else {
      console.log("[Telegram] Message sent");
    }
  } catch (err) {
    console.error("[Telegram] Error:", err);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function notifyPipelineStarted(
  owner: string, repo: string, branch: string, prNumber?: number,
): Promise<void> {
  const pr = prNumber ? ` (PR #${prNumber})` : "";
  await send(
    `🚀 <b>Pipeline Started</b>${pr}\n` +
    `Repo: ${esc(owner)}/${esc(repo)}\n` +
    `Branch: <code>${esc(branch)}</code>`
  );
}

export async function notifyAgentStarted(agent: string, message: string): Promise<void> {
  await send(`📦 <b>[${esc(agent)}]</b> ${esc(message)}`);
}

export async function notifyAgentCompleted(agent: string, message: string): Promise<void> {
  await send(`✅ <b>[${esc(agent)}]</b> ${esc(message)}`);
}

export async function notifyAgentWarning(agent: string, message: string): Promise<void> {
  await send(`⚠️ <b>[${esc(agent)}]</b> ${esc(message)}`);
}

export async function notifyTestResults(
  passed: number, failed: number, total: number, durationMs: number,
): Promise<void> {
  const icon = failed > 0 ? "❌" : "✅";
  await send(
    `${icon} <b>Test Results:</b> ${passed}/${total} passed\n` +
    `Failed: ${failed} | Duration: ${(durationMs / 1000).toFixed(1)}s`
  );
}

export async function notifyIssueCreated(url: string, number: number): Promise<void> {
  await send(`📨 <b>[Courier]</b> Created issue #${number}\n🔗 ${esc(url)}`);
}

export async function notifyPRCreated(url: string, number: number): Promise<void> {
  await send(`📬 <b>[Writer]</b> Opened PR #${number}\n🔗 ${esc(url)}`);
}

export async function notifyPipelineCompleted(summary: string): Promise<void> {
  await send(`🏁 <b>Pipeline Complete</b>\n${esc(summary)}`);
}

export async function notifyPipelineError(stage: string, error: string): Promise<void> {
  await send(`🚨 <b>Pipeline Error</b> in ${esc(stage)}\n${esc(error).slice(0, 500)}`);
}
