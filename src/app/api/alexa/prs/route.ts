import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  const expected = process.env.ALEXA_BRIDGE_API_KEY;
  if (expected && key !== expected) return false;
  return true;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, speech: "Unauthorized" }, { status: 401 });

  const owner = process.env.SENTINELQA_DEFAULT_OWNER ?? "";
  const repo = process.env.SENTINELQA_DEFAULT_REPO ?? "";
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=5`,
      {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "MindFlayer",
        },
      }
    );
    const prs = await res.json();
    const list = (prs as any[]).slice(0, 3).map((p: any) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? "unknown",
    }));

    const speech = list.length === 0
      ? "No open pull requests."
      : `There are ${list.length} open pull requests. ${list.map((p) => `PR ${p.number}: ${p.title}`).join(". ")}.`;

    return NextResponse.json({ ok: true, count: list.length, pull_requests: list, speech });
  } catch {
    return NextResponse.json({ ok: false, speech: "Failed to fetch pull requests." }, { status: 502 });
  }
}
