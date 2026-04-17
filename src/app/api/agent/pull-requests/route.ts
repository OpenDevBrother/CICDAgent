import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PullRequestSummary {
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

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner")?.trim() ?? "";
  const repo = request.nextUrl.searchParams.get("repo")?.trim() ?? "";
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "open";
  const query = request.nextUrl.searchParams.get("query")?.trim().toLowerCase() ?? "";

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Missing required query params: owner, repo" },
      { status: 400 }
    );
  }

  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? process.env.GITHUB_PAT;
  if (!token) {
    return NextResponse.json(
      { error: "GitHub PAT not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`,
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
      const errText = await res.text();
      return NextResponse.json(
        { error: `GitHub API error (${res.status}): ${errText}` },
        { status: 502 }
      );
    }

    const raw = await res.json();

    let pullRequests: PullRequestSummary[] = (raw as any[]).map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
      author: pr.user?.login ?? "unknown",
      headRef: pr.head?.ref ?? "",
      baseRef: pr.base?.ref ?? "",
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    }));

    if (query) {
      pullRequests = pullRequests.filter((pr) => {
        const haystack = `${pr.title} ${pr.number} ${pr.author} ${pr.headRef} ${pr.baseRef}`.toLowerCase();
        return haystack.includes(query);
      });
    }

    return NextResponse.json({
      owner,
      repo,
      state,
      count: pullRequests.length,
      pull_requests: pullRequests,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch pull requests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
