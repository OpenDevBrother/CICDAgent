import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const dynamic = "force-dynamic";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }));
const TABLE = process.env.DYNAMODB_TABLE_NAME || "SentinelQA";

function checkAuth(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  const expected = process.env.ALEXA_BRIDGE_API_KEY;
  if (expected && key !== expected) return false;
  return true;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, speech: "Unauthorized" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("session_id");

  try {
    let session: any = null;

    if (sessionId) {
      const res = await fetch(`http://localhost:3000/api/agent/sessions/${sessionId}`);
      if (res.ok) session = await res.json();
    } else {
      // Get the most recent session
      const result = await ddb.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: "begins_with(id, :prefix)",
        ExpressionAttributeValues: { ":prefix": "pipeline_" },
        Limit: 50,
      }));
      const sessions = (result.Items ?? [])
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      if (sessions.length > 0) session = sessions[0];
    }

    if (!session) {
      return NextResponse.json({ ok: false, speech: "No pipeline runs found." });
    }

    const s = session.session ?? session;
    const output = s.output ?? {};
    const passed = output.passed ?? 0;
    const failed = output.failed ?? 0;
    const total = output.total ?? 0;
    const state = s.status ?? "unknown";

    let speech: string;
    if (state === "running") {
      speech = "Pipeline is still running.";
    } else if (failed === 0 && total > 0) {
      speech = `Pipeline complete. ${passed} out of ${total} tests passed. All clear.`;
    } else if (failed > 0) {
      speech = `Pipeline complete. ${failed} out of ${total} tests failed.`;
    } else {
      speech = `Pipeline status is ${state}.`;
    }

    return NextResponse.json({
      ok: true,
      session_id: s.id ?? sessionId,
      state,
      passed,
      failed,
      total,
      speech,
    });
  } catch {
    return NextResponse.json({ ok: false, speech: "Failed to get status." }, { status: 500 });
  }
}
