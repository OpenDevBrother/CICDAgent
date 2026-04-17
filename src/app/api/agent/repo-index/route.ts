import { NextResponse } from "next/server";
import { buildRepoCodeIndex } from "@/lib/repo-answer/service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await buildRepoCodeIndex();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repo indexing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
