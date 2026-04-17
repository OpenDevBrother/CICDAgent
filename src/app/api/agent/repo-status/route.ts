import { NextResponse } from "next/server";
import { getRepoSearchStatus } from "@/lib/repo-answer/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getRepoSearchStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load repo status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
