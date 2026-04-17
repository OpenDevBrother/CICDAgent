import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { axonClient } from "@/lib/mcp/axon-client";

export const dynamic = "force-dynamic";

const region = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DYNAMODB_TABLE_NAME || "SentinelQA";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner")?.trim() || process.env.SENTINELQA_DEFAULT_OWNER || "";
  const repo = request.nextUrl.searchParams.get("repo")?.trim() || process.env.SENTINELQA_DEFAULT_REPO || "";

  try {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "begins_with(id, :prefix)",
      ExpressionAttributeValues: { ":prefix": "timeline_" },
      Limit: 30,
    }));

    const snapshots = (result.Items ?? [])
      .sort((a, b) => (a.merged_at ?? "").localeCompare(b.merged_at ?? ""))
      .map((item) => ({
        pr_number: item.pr_number,
        pr_title: item.pr_title,
        merged_by: item.merged_by,
        merged_at: item.merged_at,
        stats: item.stats,
        graph: item.graph,
      }));

    return NextResponse.json({ owner, repo, count: snapshots.length, snapshots });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch timeline" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pr_number, pr_title, merged_by } = body as {
      pr_number: number;
      pr_title?: string;
      merged_by?: string;
    };

    if (!pr_number) {
      return NextResponse.json({ error: "Missing pr_number" }, { status: 400 });
    }

    if (!axonClient.isConnected) {
      return NextResponse.json({ error: "Axon not running" }, { status: 503 });
    }

    const [overview, graphData] = await Promise.all([
      axonClient.getOverview(),
      axonClient.search("*").catch(() => null),
    ]);

    let graph = { nodes: [] as any[], edges: [] as any[] };
    try {
      const res = await fetch(`${process.env.AXON_API_URL}/api/graph`);
      if (res.ok) graph = await res.json();
    } catch {}

    const item = {
      id: `timeline_pr_${pr_number}`,
      type: "timeline_snapshot",
      pr_number,
      pr_title: pr_title ?? `PR #${pr_number}`,
      merged_by: merged_by ?? "unknown",
      merged_at: new Date().toISOString(),
      stats: {
        totalNodes: overview.totalNodes ?? 0,
        totalEdges: overview.totalEdges ?? 0,
        nodesByLabel: overview.nodesByLabel ?? {},
        edgesByType: overview.edgesByType ?? {},
      },
      graph,
      created_at: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 604800,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return NextResponse.json({
      success: true,
      snapshot: { pr_number, stats: item.stats, nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Snapshot failed" },
      { status: 500 }
    );
  }
}
