import { NextRequest, NextResponse } from "next/server";
import { dispatchVoiceAction } from "@/lib/vapi/voice-actions";

export const dynamic = "force-dynamic";

function parseArguments(raw: unknown) {
  if (!raw) return {} as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }
  return raw as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const toolCallList =
    body?.message?.toolCallList ??
    body?.message?.toolCalls ??
    body?.message?.tool_calls ??
    body?.toolCallList ??
    [];

  if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
    return NextResponse.json({ results: [], error: "No tool calls found." }, { status: 200 });
  }

  const results = await Promise.all(
    toolCallList.map(async (toolCall: any, index: number) => {
      const name =
        toolCall?.function?.name ??
        toolCall?.toolCall?.function?.name ??
        toolCall?.name ??
        "unknown_tool";
      const toolCallId =
        toolCall?.id ??
        toolCall?.toolCallId ??
        toolCall?.toolCall?.id ??
        `${name}_${index}`;
      const args = parseArguments(
        toolCall?.parameters ??
          toolCall?.toolCall?.parameters ??
          toolCall?.function?.arguments ??
          toolCall?.toolCall?.function?.arguments ??
          toolCall?.arguments,
      );

      try {
        const result = await dispatchVoiceAction({ origin: request.nextUrl.origin }, name, args);
        return {
          toolCallId,
          name,
          result: JSON.stringify(result),
        };
      } catch (error) {
        return {
          toolCallId,
          name,
          error: error instanceof Error ? error.message : `Tool ${name} failed.`,
        };
      }
    }),
  );

  return NextResponse.json({ results });
}
