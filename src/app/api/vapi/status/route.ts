import { NextRequest, NextResponse } from "next/server";
import { getPipelineStatusAction } from "@/lib/vapi/voice-actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id") ?? undefined;
    const result = await getPipelineStatusAction({ origin: request.nextUrl.origin }, sessionId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, spoken_summary: error instanceof Error ? error.message : "Failed to fetch pipeline status." },
      { status: 500 },
    );
  }
}
