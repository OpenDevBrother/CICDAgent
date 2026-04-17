import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  const expected = process.env.ALEXA_BRIDGE_API_KEY;
  if (expected && key !== expected) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, speech: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const prNumber = body.pr_number;
    if (!prNumber) return NextResponse.json({ ok: false, speech: "Please specify a PR number." }, { status: 400 });

    const owner = process.env.SENTINELQA_DEFAULT_OWNER ?? "";
    const repo = process.env.SENTINELQA_DEFAULT_REPO ?? "";

    // Fetch PR details
    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "";
    const prRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "MindFlayer" },
      }
    );

    if (!prRes.ok) return NextResponse.json({ ok: false, speech: `PR ${prNumber} not found.` }, { status: 404 });
    const pr = await prRes.json();

    // Start pipeline in background (non-blocking)
    const sessionId = `pipeline_${Date.now()}`;
    fetch(`http://localhost:3000/api/agent/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner, repo,
        branch: pr.base?.ref ?? "main",
        target_url: process.env.SENTINELQA_TARGET_URL ?? "http://localhost:5173",
        session_id: sessionId,
        selected_pr: {
          number: pr.number,
          title: pr.title,
          headRef: pr.head?.ref,
          baseRef: pr.base?.ref,
        },
      }),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      speech: `Started pipeline for PR ${prNumber}. Ask me for status in a moment.`,
    });
  } catch {
    return NextResponse.json({ ok: false, speech: "Failed to start pipeline." }, { status: 500 });
  }
}
