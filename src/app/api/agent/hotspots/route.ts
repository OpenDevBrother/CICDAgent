import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner") || process.env.SENTINELQA_DEFAULT_OWNER || "";
  const repo = req.nextUrl.searchParams.get("repo") || process.env.SENTINELQA_DEFAULT_REPO || "";
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";

  if (!owner || !repo) {
    return NextResponse.json({ error: "Missing owner/repo" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`,
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

    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API error: ${res.status}` }, { status: 502 });
    }

    const commits = await res.json();

    const fileChurn = new Map<string, { commits: number; authors: Set<string>; lastDate: string; lastMessage: string }>();

    for (const commit of commits as any[]) {
      const sha = commit.sha;
      const author = commit.commit?.author?.name ?? "unknown";
      const date = commit.commit?.author?.date ?? "";
      const message = commit.commit?.message?.split("\n")[0] ?? "";

      try {
        const detailRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "MindFlayer",
            },
          }
        );
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();

        for (const file of (detail.files ?? []) as any[]) {
          const path = file.filename;
          if (!fileChurn.has(path)) {
            fileChurn.set(path, { commits: 0, authors: new Set(), lastDate: "", lastMessage: "" });
          }
          const entry = fileChurn.get(path)!;
          entry.commits++;
          entry.authors.add(author);
          if (!entry.lastDate || date > entry.lastDate) {
            entry.lastDate = date;
            entry.lastMessage = message;
          }
        }
      } catch {
        continue;
      }

      if (fileChurn.size > 200) break;
    }

    const hotspots = [...fileChurn.entries()]
      .map(([path, data]) => ({
        path,
        commits: data.commits,
        authors: [...data.authors],
        topAuthor: [...data.authors][0] ?? "unknown",
        lastDate: data.lastDate,
        lastMessage: data.lastMessage,
      }))
      .sort((a, b) => b.commits - a.commits);

    const maxCommits = hotspots[0]?.commits ?? 1;
    const withHeat = hotspots.map((h) => ({
      ...h,
      heat: Math.round((h.commits / maxCommits) * 100),
    }));

    return NextResponse.json({
      owner,
      repo,
      totalFiles: withHeat.length,
      hotspots: withHeat.slice(0, 30),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
