import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const axonUrl = process.env.AXON_API_URL;
  if (!axonUrl) return NextResponse.json({ error: "AXON_API_URL not set" }, { status: 503 });

  try {
    const [graphRes, commRes] = await Promise.all([
      fetch(`${axonUrl}/api/graph`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${axonUrl}/api/communities`, { signal: AbortSignal.timeout(10000) }),
    ]);

    const graph = graphRes.ok ? await graphRes.json() : { nodes: [], edges: [] };
    const commData = commRes.ok ? await commRes.json() : { communities: [] };
    const communities = commData.communities ?? commData ?? [];

    const nodes = (graph.nodes ?? []).filter((n: any) =>
      ["file", "class"].includes(n.label)
    );

    const connectionCount = new Map<string, number>();
    (graph.edges ?? []).forEach((e: any) => {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
    });

    const topNodes = nodes
      .map((n: any) => ({ ...n, conns: connectionCount.get(n.id) ?? 0 }))
      .sort((a: any, b: any) => b.conns - a.conns)
      .slice(0, 20);

    const topIds = new Set(topNodes.map((n: any) => n.id));

    const memberToComm = new Map<string, number>();
    (communities as any[]).forEach((c: any, i: number) => {
      (c.members ?? []).forEach((m: string) => memberToComm.set(m, i));
    });

    const commGroups = new Map<number, any[]>();
    for (const n of topNodes) {
      const cid = memberToComm.get(n.id) ?? -1;
      if (!commGroups.has(cid)) commGroups.set(cid, []);
      commGroups.get(cid)!.push(n);
    }

    const relevantEdges = (graph.edges ?? []).filter((e: any) =>
      topIds.has(e.source) && topIds.has(e.target) && e.type !== "defines" && e.type !== "member_of"
    );

    const nodeAlias = new Map<string, string>();
    let aliasCounter = 0;
    const getAlias = (id: string) => {
      if (!nodeAlias.has(id)) nodeAlias.set(id, String.fromCharCode(65 + (aliasCounter++ % 26)) + (aliasCounter > 26 ? aliasCounter : ""));
      return nodeAlias.get(id)!;
    };

    let mermaid = "graph TD\n";

    for (const [cid, members] of commGroups) {
      const commName = (communities as any[])[cid]?.name ?? `Module ${cid + 1}`;
      if (cid >= 0) mermaid += `  subgraph ${commName.replace(/[^a-zA-Z0-9 ]/g, "")}\n`;
      for (const n of members) {
        const alias = getAlias(n.id);
        const name = (n.filePath ?? n.name ?? "").split(/[/\\]/).pop() ?? n.name;
        mermaid += `    ${alias}["${name}"]\n`;
      }
      if (cid >= 0) mermaid += `  end\n`;
    }

    for (const e of relevantEdges) {
      const src = getAlias(e.source);
      const tgt = getAlias(e.target);
      const label = e.type === "calls" ? "calls" : e.type === "imports" ? "imports" : "";
      mermaid += label ? `  ${src} -->|${label}| ${tgt}\n` : `  ${src} --> ${tgt}\n`;
    }

    return NextResponse.json({ mermaid, nodeCount: topNodes.length, edgeCount: relevantEdges.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
