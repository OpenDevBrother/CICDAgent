const AXON_URL = () => process.env.AXON_API_URL ?? "";

async function callAxonGet<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const base = AXON_URL();
  if (!base) throw new Error("AXON_API_URL not configured");

  const res = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Axon error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

async function callAxonPost<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const base = AXON_URL();
  if (!base) throw new Error("AXON_API_URL not configured");

  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Axon error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

export interface AxonOverview {
  totalNodes: number;
  totalEdges: number;
  nodesByLabel: Record<string, number>;
  edgesByType: Record<string, number>;
  [key: string]: unknown;
}

export interface AxonSearchResult {
  results: Array<{
    nodeId: string;
    name: string;
    label: string;
    filePath?: string;
    score?: number;
    snippet?: string;
    [key: string]: unknown;
  }>;
}

export interface AxonImpactResult {
  [key: string]: unknown;
}

export interface AxonDeadCodeResult {
  total: number;
  byFile: Record<string, Array<{
    name: string;
    type: string;
    line: number;
    [key: string]: unknown;
  }>>;
}

export interface AxonCommunity {
  [key: string]: unknown;
}

class AxonClient {
  get isConnected(): boolean {
    return !!AXON_URL();
  }

  async search(query: string): Promise<AxonSearchResult> {
    return callAxonPost("/api/search", { query });
  }

  async getOverview(): Promise<AxonOverview> {
    return callAxonGet("/api/overview");
  }

  async getImpact(nodeId: string, depth = 2): Promise<AxonImpactResult> {
    return callAxonGet(`/api/impact/${encodeURIComponent(nodeId)}?depth=${depth}`);
  }

  async getDeadCode(): Promise<AxonDeadCodeResult> {
    return callAxonGet("/api/dead-code");
  }

  async getCommunities(): Promise<AxonCommunity[]> {
    return callAxonGet("/api/communities");
  }
}

export const axonClient = new AxonClient();
