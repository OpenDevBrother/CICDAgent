import { NextRequest, NextResponse } from "next/server";
import { axonClient } from "@/lib/mcp/axon-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!axonClient.isConnected) {
    return NextResponse.json(
      { error: "Axon not configured (AXON_API_URL not set)" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { action, query, nodeId, depth } = body as {
      action: string;
      query?: string;
      nodeId?: string;
      depth?: number;
    };

    switch (action) {
      case "search": {
        if (!query) {
          return NextResponse.json({ error: "Missing query" }, { status: 400 });
        }
        const results = await axonClient.search(query);
        return NextResponse.json(results);
      }

      case "overview": {
        const overview = await axonClient.getOverview();
        return NextResponse.json(overview);
      }

      case "impact": {
        if (!nodeId) {
          return NextResponse.json({ error: "Missing nodeId" }, { status: 400 });
        }
        const impact = await axonClient.getImpact(nodeId, depth ?? 2);
        return NextResponse.json(impact);
      }

      case "deadcode": {
        const deadcode = await axonClient.getDeadCode();
        return NextResponse.json(deadcode);
      }

      case "communities": {
        const communities = await axonClient.getCommunities();
        return NextResponse.json({ communities });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use: search, overview, impact, deadcode, communities` },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Axon request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
