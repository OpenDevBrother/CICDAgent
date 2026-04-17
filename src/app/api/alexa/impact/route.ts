import { NextRequest, NextResponse } from "next/server";
import { axonClient } from "@/lib/mcp/axon-client";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  const expected = process.env.ALEXA_BRIDGE_API_KEY;
  if (expected && key !== expected) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ ok: false, speech: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const target = body.target?.trim();
    if (!target) return NextResponse.json({ ok: false, speech: "What file or symbol should I analyze?" }, { status: 400 });

    if (!axonClient.isConnected) {
      return NextResponse.json({ ok: false, speech: "Knowledge graph is not running." }, { status: 503 });
    }

    // Search for the target first
    const searchResult = await axonClient.search(target);
    const nodes = searchResult.results ?? [];

    if (nodes.length === 0) {
      return NextResponse.json({ ok: true, affected_count: 0, speech: `No symbols found matching ${target}.` });
    }

    // Get impact for top match
    const topNode = nodes[0];
    const impact = await axonClient.getImpact(topNode.nodeId, 2);
    const affected = (impact as any).affected ?? [];

    const speech = affected.length === 0
      ? `${topNode.name} has no known dependencies.`
      : `Changing ${topNode.name} affects ${affected.length} symbol${affected.length > 1 ? "s" : ""}. ${affected.slice(0, 3).map((a: any) => a.name).join(", ")}.`;

    return NextResponse.json({ ok: true, target: topNode.name, affected_count: affected.length, speech });
  } catch {
    return NextResponse.json({ ok: false, speech: "Impact analysis failed." }, { status: 502 });
  }
}
