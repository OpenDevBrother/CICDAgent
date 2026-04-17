import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  label?: string;
  isDead?: boolean;
  children: TreeNode[];
  symbols: Array<{ name: string; type: string; line: number; isDead: boolean }>;
}

export async function GET() {
  const axonUrl = process.env.AXON_API_URL;
  if (!axonUrl) return NextResponse.json({ error: "AXON_API_URL not set" }, { status: 503 });

  try {
    const graphRes = await fetch(`${axonUrl}/api/graph`, { signal: AbortSignal.timeout(10000) });
    if (!graphRes.ok) return NextResponse.json({ error: "Axon graph unavailable" }, { status: 502 });
    const graph = await graphRes.json();

    const root: TreeNode = { name: "root", path: "", type: "folder", children: [], symbols: [] };

    const fileNodes = (graph.nodes ?? []).filter((n: any) => n.label === "file");
    const symbolNodes = (graph.nodes ?? []).filter((n: any) =>
      ["function", "method", "class"].includes(n.label)
    );

    for (const file of fileNodes) {
      const filePath: string = file.filePath ?? file.name ?? "";
      const parts = filePath.split(/[/\\]/).filter(Boolean);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;

        let child = current.children.find((c) => c.name === part);
        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, i + 1).join("/"),
            type: isFile ? "file" : "folder",
            label: isFile ? file.label : undefined,
            isDead: isFile ? file.isDead : undefined,
            children: [],
            symbols: [],
          };
          current.children.push(child);
        }
        current = child;
      }

      const fileSymbols = symbolNodes.filter((s: any) =>
        (s.filePath ?? "").replace(/\\/g, "/") === filePath.replace(/\\/g, "/")
      );
      current.symbols = fileSymbols.map((s: any) => ({
        name: s.name,
        type: s.label,
        line: s.startLine ?? 0,
        isDead: s.isDead ?? false,
      }));
    }

    const sortTree = (node: TreeNode) => {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortTree);
    };
    sortTree(root);

    return NextResponse.json({ tree: root.children });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 502 });
  }
}
