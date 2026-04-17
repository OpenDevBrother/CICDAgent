import { NextRequest, NextResponse } from "next/server";
import { runPullRequestAction } from "@/lib/vapi/voice-actions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { pr_number?: number; owner?: string; repo?: string };
    const result = await runPullRequestAction(
      { origin: request.nextUrl.origin },
      body.pr_number,
      { owner: body.owner, repo: body.repo },
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, spoken_summary: error instanceof Error ? error.message : "Failed to run pull request." },
      { status: 500 },
    );
  }
}
