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

    const memberToComm = new Map<string, number>();
    (communities as any[]).forEach((c: any, i: number) => {
      const members = c.members ?? [];
      if (Array.isArray(members)) {
        members.forEach((m: string) => memberToComm.set(m, i));
      }
    });

    const connectionCount = new Map<string, number>();
    (graph.edges ?? []).forEach((e: any) => {
      connectionCount.set(e.source, (connectionCount.get(e.source) ?? 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) ?? 0) + 1);
    });

    const nodes = (graph.nodes ?? []).map((n: any) => ({
      ...n,
      communityId: memberToComm.get(n.id) ?? -1,
      connections: connectionCount.get(n.id) ?? 0,
    }));

    return NextResponse.json({
      nodes,
      edges: graph.edges ?? [],
      communities: (communities as any[]).map((c: any, i: number) => ({
        id: i,
        name: c.name ?? `Cluster ${i + 1}`,
        memberCount: c.memberCount ?? (c.members?.length ?? 0),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
