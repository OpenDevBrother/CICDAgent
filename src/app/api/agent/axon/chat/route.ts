import { NextRequest, NextResponse } from "next/server";
import { answerRepoQuestion } from "@/lib/repo-answer/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question } = body as { question?: string };

    if (!question?.trim()) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const result = await answerRepoQuestion(question.trim());

    return NextResponse.json({
      answer: result.answer,
      context: result.context,
      matches: result.matches,
      status: result.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 },
    );
  }
}
