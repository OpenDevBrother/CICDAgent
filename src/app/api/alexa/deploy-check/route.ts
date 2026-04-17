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

  try {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "begins_with(id, :prefix)",
      ExpressionAttributeValues: { ":prefix": "pipeline_" },
      Limit: 50,
    }));
    const sessions = (result.Items ?? [])
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

    if (sessions.length === 0) {
      return NextResponse.json({ ok: false, safe: false, speech: "No pipeline runs found. Cannot determine deploy safety." });
    }

    const latest = sessions[0];
    const output = latest.output ?? {};
    const failed = output.failed ?? 0;
    const total = output.total ?? 0;
    const passed = output.passed ?? 0;
    const status = latest.status ?? "unknown";

    if (status === "running") {
      return NextResponse.json({ ok: true, safe: false, speech: "Pipeline is still running. Wait for it to finish before deploying." });
    }

    const safe = failed === 0 && total > 0;
    const speech = safe
      ? `Yes, safe to deploy. All ${passed} tests passed.`
      : `No, not safe to deploy. ${failed} out of ${total} tests failed.`;

    return NextResponse.json({ ok: true, safe, passed, failed, total, speech });
  } catch {
    return NextResponse.json({ ok: false, speech: "Failed to check deploy status." }, { status: 500 });
  }
}
