import { NextRequest, NextResponse } from "next/server";
import { askRepoQuestionAction } from "@/lib/vapi/voice-actions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { question?: string };
    const result = await askRepoQuestionAction(
      { origin: request.nextUrl.origin },
      body.question ?? "",
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, spoken_summary: error instanceof Error ? error.message : "Failed to answer repo question." },
      { status: 500 },
    );
  }
}
