import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { axonClient } from "@/lib/mcp/axon-client";

const execFileAsync = promisify(execFile);

const SEARCH_LIMIT = 8;
const SEMANTIC_LIMIT = 6;
const MAX_FILE_SIZE_BYTES = 220_000;
const MAX_INDEX_FILE_SIZE_BYTES = 360_000;
const MAX_INDEX_FILES = 700;
const CHUNK_LINE_SIZE = 70;
const CHUNK_LINE_OVERLAP = 10;
const AI_TIMEOUT_MS = 8_000;
const AXON_TIMEOUT_MS = 4_000;
const RIPGREP_TIMEOUT_MS = 2_500;
const INDEX_BATCH_SIZE = 24;

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "out",
  "node_modules",
  "vendor",
  "tmp",
  "temp",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
]);

const IGNORED_FILE_PATTERNS = [
  /package-lock\.json$/i,
  /pnpm-lock\.ya?ml$/i,
  /yarn\.lock$/i,
  /bun\.lockb$/i,
  /Cargo\.lock$/i,
  /\.min\./i,
  /\.map$/i,
  /\.svg$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.webp$/i,
  /\.mp4$/i,
  /\.mov$/i,
  /\.pdf$/i,
  /\.zip$/i,
  /\.tar$/i,
  /\.gz$/i,
  /\.ico$/i,
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".cs",
  ".scala",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".toml",
  ".yml",
  ".yaml",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".graphql",
  ".prisma",
  ".html",
  ".css",
  ".scss",
  ".sass",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "can",
  "check",
  "could",
  "do",
  "does",
  "for",
  "find",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "latest",
  "me",
  "of",
  "on",
  "or",
  "please",
  "repo",
  "show",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "what",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
]);

const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  auth: ["auth", "authentication", "authorize", "login", "signin", "session", "nextauth", "middleware", "jwt", "oauth", "token"],
  login: ["login", "signin", "auth", "session", "token", "nextauth"],
  deploy: ["deploy", "deployment", "release", "production", "prod", "rollout", "ship"],
  failure: ["failure", "failed", "error", "exception", "stack", "trace", "status"],
  config: ["config", "configuration", "settings", "env", "dotenv", "process.env"],
  payment: ["payment", "billing", "checkout", "invoice", "stripe", "razorpay"],
  user: ["user", "account", "profile", "member", "session"],
  api: ["api", "route", "handler", "endpoint", "fetch"],
};

export interface RepoSearchMatch {
  relativePath: string;
  absolutePath: string;
  lineNumber: number;
  snippet: string;
  score: number;
  source: "lexical" | "semantic";
  language: string;
  startLine?: number;
  endLine?: number;
  symbolHints?: string[];
}

export interface RepoSearchStatus {
  repoPath: string | null;
  repoPathConfigured: boolean;
  repoPathReady: boolean;
  repoPathSource: "env" | "app-root" | "missing";
  repoKey: string | null;
  qdrantConfigured: boolean;
  codeIndexReady: boolean;
  codeIndexCount: number;
  qdrantCollection: string;
  axonConnected: boolean;
  aiEngineAvailable: boolean;
  warning?: string;
}

export interface RepoAnswerResult {
  answer: string;
  context: string;
  matches: RepoSearchMatch[];
  status: RepoSearchStatus;
}

export interface RepoIndexResult {
  ok: boolean;
  repo_path: string | null;
  repo_key: string | null;
  file_count: number;
  chunk_count: number;
  duration_ms: number;
  errors: string[];
  qdrant_collection: string;
  status: RepoSearchStatus;
}

interface RepoCodeChunk {
  id: string;
  text: string;
  relative_path: string;
  language: string;
  chunk_type: "code" | "config" | "docs";
  start_line: number;
  end_line: number;
  symbol_hints: string[];
}

interface SemanticMatchPayload {
  relative_path?: string;
  start_line?: number;
  end_line?: number;
  text?: string;
  snippet?: string;
  language?: string;
  symbol_hints?: string[];
  score?: number;
}

function getQdrantCodeCollectionName() {
  return process.env.QDRANT_CODE_COLLECTION?.trim() || "repo-code-chunks";
}

function getAiEngineUrl() {
  return process.env.AI_ENGINE_URL?.trim().replace(/\/$/, "") || "";
}

function normalizeRepoKey(repoPath: string) {
  return path.resolve(repoPath).replace(/\\/g, "/").toLowerCase();
}

function detectLanguage(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".py": "python",
    ".md": "markdown",
    ".mdx": "markdown",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".rs": "rust",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".env": "dotenv",
    ".sh": "shell",
    ".ps1": "powershell",
  };

  return map[extension] || extension.replace(/^\./, "") || "text";
}

function detectChunkType(relativePath: string): "code" | "config" | "docs" {
  const normalized = relativePath.toLowerCase();
  if (/readme|docs\//.test(normalized) || normalized.endsWith(".md") || normalized.endsWith(".mdx")) {
    return "docs";
  }
  if (
    normalized.endsWith(".json") ||
    normalized.endsWith(".toml") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".yaml") ||
    normalized.endsWith(".env") ||
    normalized.includes("config")
  ) {
    return "config";
  }
  return "code";
}

function isLikelyTextFile(filePath: string) {
  const baseName = path.basename(filePath);
  if (baseName.startsWith(".")) {
    return baseName === ".env" || baseName === ".env.local" || baseName === ".env.example";
  }

  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function shouldIgnoreRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return true;
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetRepoPath() {
  const configured = process.env.SENTINELQA_TARGET_REPO_PATH?.trim() || "";
  const appRoot = process.cwd();

  if (configured) {
    const repoPath = path.resolve(configured);
    const ready = await pathExists(repoPath);
    return {
      repoPath: ready ? repoPath : null,
      configured: true,
      ready,
      source: "env" as const,
      warning: ready ? undefined : `SENTINELQA_TARGET_REPO_PATH does not exist: ${repoPath}`,
    };
  }

  const fallbackReady = await pathExists(appRoot);
  return {
    repoPath: fallbackReady ? appRoot : null,
    configured: false,
    ready: fallbackReady,
    source: fallbackReady ? ("app-root" as const) : ("missing" as const),
    warning: fallbackReady
      ? "SENTINELQA_TARGET_REPO_PATH is not set, so repo Q&A is using the MindFlayer app repo as a fallback."
      : "SENTINELQA_TARGET_REPO_PATH is not configured.",
  };
}

async function safeReadTextFile(filePath: string, maxBytes: number) {
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) return null;

  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

async function collectRepoFiles(repoPath: string, maxFiles = MAX_INDEX_FILES) {
  const files: string[] = [];
  const stack = [repoPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>;
    try {
      entries = (await fs.readdir(current, { withFileTypes: true })) as Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(repoPath, absolutePath);
      if (!relativePath || shouldIgnoreRelativePath(relativePath)) continue;

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile() && isLikelyTextFile(absolutePath)) {
        files.push(absolutePath);
        if (files.length >= maxFiles) break;
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function extractQuotedPhrases(question: string) {
  return Array.from(question.matchAll(/"([^"]+)"/g)).map((match) => match[1].trim()).filter(Boolean);
}

function extractSearchTerms(question: string) {
  const lowered = question.toLowerCase();
  const quoted = extractQuotedPhrases(question);
  const rawTokens = lowered.match(/[a-zA-Z0-9_./-]{2,}/g) ?? [];
  const tokens = rawTokens.filter((token) => !STOP_WORDS.has(token));
  const expanded = new Set<string>();

  for (const phrase of quoted) expanded.add(phrase.toLowerCase());

  for (const token of tokens) {
    expanded.add(token);
    for (const [keyword, synonyms] of Object.entries(KEYWORD_EXPANSIONS)) {
      if (token.includes(keyword) || keyword.includes(token)) {
        synonyms.forEach((value) => expanded.add(value));
      }
    }
  }

  if (lowered.includes("auth")) {
    KEYWORD_EXPANSIONS.auth.forEach((value) => expanded.add(value));
  }

  return Array.from(expanded).filter((value) => value.length >= 2).slice(0, 12);
}

function extractSymbolHints(text: string) {
  const matches = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /function\s+([A-Za-z0-9_]+)/g,
    /class\s+([A-Za-z0-9_]+)/g,
    /const\s+([A-Za-z0-9_]+)\s*=/g,
    /def\s+([A-Za-z0-9_]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) matches.add(match[1]);
      if (matches.size >= 6) return Array.from(matches);
    }
  }

  return Array.from(matches);
}

function createSnippet(lines: string[], lineIndex: number) {
  const start = Math.max(0, lineIndex - 2);
  const end = Math.min(lines.length, lineIndex + 3);
  return lines.slice(start, end).join("\n").trim();
}

function calculateScore(question: string, relativePath: string, snippet: string, lineText: string, terms: string[]) {
  const loweredQuestion = question.toLowerCase();
  const loweredPath = relativePath.toLowerCase();
  const loweredSnippet = snippet.toLowerCase();
  const loweredLine = lineText.toLowerCase();

  let score = 0;

  for (const term of terms) {
    const loweredTerm = term.toLowerCase();
    if (!loweredTerm) continue;
    if (loweredLine.includes(loweredTerm)) score += 18;
    if (loweredSnippet.includes(loweredTerm)) score += 8;
    if (loweredPath.includes(loweredTerm)) score += 10;
    if (path.basename(loweredPath).includes(loweredTerm)) score += 14;
  }

  if (loweredQuestion.includes("where") || loweredQuestion.includes("which file") || loweredQuestion.includes("handled")) {
    score += 12;
  }
  if (/export|function|class|route|middleware|handler/.test(loweredSnippet)) {
    score += 7;
  }
  if (/auth|login|session|token|jwt|oauth|nextauth/.test(loweredSnippet) && /auth|login|session/.test(loweredQuestion)) {
    score += 15;
  }
  if (loweredPath.includes("test") || loweredPath.includes("spec")) {
    score -= 6;
  }

  return score;
}

async function searchWithRipgrep(repoPath: string, terms: string[]) {
  const binary = process.env.RIPGREP_PATH?.trim() || "rg";
  const results = new Map<string, RepoSearchMatch>();

  for (const term of terms.slice(0, 6)) {
    const args = [
      "--json",
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "-S",
      "-m",
      "1",
      "-g",
      "!node_modules/**",
      "-g",
      "!.next/**",
      "-g",
      "!dist/**",
      "-g",
      "!build/**",
      "-e",
      term,
      repoPath,
    ];

    try {
      const { stdout } = await execFileAsync(binary, args, {
        windowsHide: true,
        timeout: RIPGREP_TIMEOUT_MS,
        maxBuffer: 1_500_000,
      });

      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        if (parsed?.type !== "match") continue;
        const absolutePath = String(parsed?.data?.path?.text ?? "");
        const relativePath = path.relative(repoPath, absolutePath);
        if (!relativePath || shouldIgnoreRelativePath(relativePath)) continue;

        const lineNumber = Number(parsed?.data?.line_number ?? 1);
        const snippet = String(parsed?.data?.lines?.text ?? "").trim();
        const key = `${relativePath}:${lineNumber}`;
        if (results.has(key)) continue;

        results.set(key, {
          absolutePath,
          relativePath,
          lineNumber,
          snippet,
          score: 0,
          source: "lexical",
          language: detectLanguage(relativePath),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/No such file|ENOENT|Access is denied|failed to run/i.test(message)) {
        return [];
      }
      if (!/timed out|status 1|exit code 1/i.test(message)) {
        return [];
      }
    }
  }

  return Array.from(results.values());
}

async function searchByScanningFiles(repoPath: string, question: string, terms: string[]) {
  const files = await collectRepoFiles(repoPath, 450);
  const results: RepoSearchMatch[] = [];

  for (const absolutePath of files) {
    const relativePath = path.relative(repoPath, absolutePath);
    const content = await safeReadTextFile(absolutePath, MAX_FILE_SIZE_BYTES);
    if (!content) continue;

    const loweredContent = content.toLowerCase();
    const matchingTerms = terms.filter((term) => loweredContent.includes(term.toLowerCase()));
    const basename = path.basename(relativePath).toLowerCase();
    const pathMatches = terms.some((term) => basename.includes(term.toLowerCase()) || relativePath.toLowerCase().includes(term.toLowerCase()));
    if (matchingTerms.length === 0 && !pathMatches) continue;

    const lines = content.split(/\r?\n/);
    let bestResult: RepoSearchMatch | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index];
      const lineLower = lineText.toLowerCase();
      if (!matchingTerms.some((term) => lineLower.includes(term.toLowerCase()))) continue;

      const snippet = createSnippet(lines, index);
      const score = calculateScore(question, relativePath, snippet, lineText, matchingTerms);
      const candidate: RepoSearchMatch = {
        absolutePath,
        relativePath,
        lineNumber: index + 1,
        snippet,
        score,
        source: "lexical",
        language: detectLanguage(relativePath),
      };

      if (!bestResult || candidate.score > bestResult.score) {
        bestResult = candidate;
      }
    }

    if (!bestResult && pathMatches) {
      bestResult = {
        absolutePath,
        relativePath,
        lineNumber: 1,
        snippet: lines.slice(0, 5).join("\n").trim(),
        score: 20,
        source: "lexical",
        language: detectLanguage(relativePath),
      };
    }

    if (bestResult) {
      results.push(bestResult);
    }
  }

  return results;
}

async function runLexicalSearch(repoPath: string, question: string) {
  const terms = extractSearchTerms(question);
  const rgResults = await searchWithRipgrep(repoPath, terms);
  const fallbackResults = rgResults.length >= 4 ? [] : await searchByScanningFiles(repoPath, question, terms);

  const merged = new Map<string, RepoSearchMatch>();
  for (const result of [...rgResults, ...fallbackResults]) {
    const key = `${result.relativePath}:${result.lineNumber}`;
    if (!merged.has(key)) {
      const score = result.score || calculateScore(question, result.relativePath, result.snippet, result.snippet, terms);
      merged.set(key, { ...result, score });
    }
  }

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, SEARCH_LIMIT);
}

function createChunkId(repoKey: string, relativePath: string, startLine: number, endLine: number) {
  return `${repoKey}:${relativePath}:${startLine}:${endLine}`.replace(/[^a-zA-Z0-9:_./-]/g, "_");
}

function chunkFile(relativePath: string, content: string): RepoCodeChunk[] {
  const language = detectLanguage(relativePath);
  const chunkType = detectChunkType(relativePath);
  const lines = content.split(/\r?\n/);
  const chunks: RepoCodeChunk[] = [];
  const maxLineCount = chunkType === "docs" ? 90 : CHUNK_LINE_SIZE;
  const step = Math.max(15, maxLineCount - CHUNK_LINE_OVERLAP);

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + maxLineCount);
    const text = lines.slice(start, end).join("\n").trim();
    if (!text) continue;

    chunks.push({
      id: createChunkId("pending", relativePath, start + 1, end),
      text,
      relative_path: relativePath,
      language,
      chunk_type: chunkType,
      start_line: start + 1,
      end_line: end,
      symbol_hints: extractSymbolHints(text),
    });
  }

  return chunks;
}

async function callRepoCodeStatus(repoKey: string) {
  const aiEngineUrl = getAiEngineUrl();
  if (!aiEngineUrl) {
    return { aiEngineAvailable: false, qdrantConfigured: false, codeIndexReady: false, codeIndexCount: 0 };
  }

  try {
    const response = await fetch(`${aiEngineUrl}/repo-code/status?ts=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_key: repoKey }),
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { aiEngineAvailable: true, qdrantConfigured: false, codeIndexReady: false, codeIndexCount: 0 };
    }

    const data = await response.json();
    return {
      aiEngineAvailable: true,
      qdrantConfigured: Boolean(data?.qdrant_configured),
      codeIndexReady: Boolean(data?.code_index_ready),
      codeIndexCount: Number(data?.code_index_count ?? 0),
    };
  } catch {
    return { aiEngineAvailable: false, qdrantConfigured: false, codeIndexReady: false, codeIndexCount: 0 };
  }
}

async function searchSemanticMatches(question: string, repoKey: string) {
  const aiEngineUrl = getAiEngineUrl();
  if (!aiEngineUrl) return [] as RepoSearchMatch[];

  try {
    const response = await fetch(`${aiEngineUrl}/repo-code/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_key: repoKey, query: question, limit: SEMANTIC_LIMIT }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const matches = Array.isArray(data?.matches) ? (data.matches as SemanticMatchPayload[]) : [];

    return matches.map((match) => ({
      absolutePath: "",
      relativePath: String(match.relative_path ?? ""),
      lineNumber: Number(match.start_line ?? 1),
      startLine: typeof match.start_line === "number" ? match.start_line : undefined,
      endLine: typeof match.end_line === "number" ? match.end_line : undefined,
      snippet: String(match.snippet ?? match.text ?? "").trim(),
      score: Number(match.score ?? 0),
      source: "semantic" as const,
      language: String(match.language ?? detectLanguage(String(match.relative_path ?? ""))),
      symbolHints: Array.isArray(match.symbol_hints) ? match.symbol_hints.map((item) => String(item)) : [],
    })).filter((match) => match.relativePath);
  } catch {
    return [];
  }
}

function mergeMatches(repoPath: string, lexicalMatches: RepoSearchMatch[], semanticMatches: RepoSearchMatch[]) {
  const merged = new Map<string, RepoSearchMatch>();

  for (const match of lexicalMatches) {
    const key = `${match.relativePath}:${match.lineNumber}`;
    merged.set(key, match);
  }

  for (const match of semanticMatches) {
    const lineNumber = match.lineNumber || match.startLine || 1;
    const key = `${match.relativePath}:${lineNumber}`;
    const absolutePath = match.absolutePath || path.join(repoPath, match.relativePath);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        score: Math.max(existing.score, match.score + 6),
        snippet: existing.snippet.length >= match.snippet.length ? existing.snippet : match.snippet,
        symbolHints: existing.symbolHints?.length ? existing.symbolHints : match.symbolHints,
      });
      continue;
    }

    merged.set(key, {
      ...match,
      absolutePath,
      lineNumber,
      score: match.score + 4,
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, SEARCH_LIMIT);
}

function isLocationQuestion(question: string) {
  return /where|which file|which files|handled|defined|implemented|located|lives?/i.test(question);
}

function buildDeterministicAnswer(question: string, matches: RepoSearchMatch[], axonSummary?: string | null) {
  if (matches.length === 0) {
    return `I couldn't find strong matches for that in the configured repo. Try naming a feature, symbol, route, or file.`;
  }

  const lead = matches[0];
  const otherFiles = matches.slice(1, 3).map((match) => `${match.relativePath}:${match.lineNumber}`);
  const primary = `${lead.relativePath}:${lead.lineNumber}`;
  const snippet = lead.snippet.replace(/\s+/g, " ").trim();
  const condensedSnippet = snippet.length > 160 ? `${snippet.slice(0, 157).trimEnd()}…` : snippet;

  if (isLocationQuestion(question)) {
    const supporting = otherFiles.length > 0 ? ` Supporting files include ${otherFiles.join(", ")}.` : "";
    const axon = axonSummary ? ` ${axonSummary}` : "";
    return `The strongest match is ${primary}. It looks relevant because it mentions: ${condensedSnippet}.${supporting}${axon}`;
  }

  const secondary = otherFiles.length > 0 ? ` I also found related code in ${otherFiles.join(", ")}.` : "";
  const axon = axonSummary ? ` ${axonSummary}` : "";
  return `The best evidence is in ${primary}. ${condensedSnippet}.${secondary}${axon}`;
}

function buildContext(question: string, repoPath: string, matches: RepoSearchMatch[], status: RepoSearchStatus, axonSummary?: string | null) {
  const lines = [
    `Question: ${question}`,
    `Repo path: ${repoPath}`,
    `Repo path source: ${status.repoPathSource}`,
    `Qdrant code index ready: ${status.codeIndexReady ? "yes" : "no"}`,
    `Axon connected: ${status.axonConnected ? "yes" : "no"}`,
    "",
    "Top matches:",
  ];

  if (matches.length === 0) {
    lines.push("- No strong matches found.");
  } else {
    for (const match of matches.slice(0, 5)) {
      lines.push(`- ${match.relativePath}:${match.lineNumber} [${match.source}]`);
      lines.push(`  ${match.snippet.replace(/\s+/g, " ").trim()}`);
      if (match.symbolHints?.length) {
        lines.push(`  Symbols: ${match.symbolHints.join(", ")}`);
      }
    }
  }

  if (axonSummary) {
    lines.push("", `Axon enrichment: ${axonSummary}`);
  }

  return lines.join("\n");
}

async function getAxonEnrichment(question: string, matches: RepoSearchMatch[]) {
  if (!axonClient.isConnected || matches.length === 0) return null;

  try {
    const query = [question, path.basename(matches[0].relativePath)].join(" ");
    const search = await Promise.race([
      axonClient.search(query),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AXON_TIMEOUT_MS)),
    ]);

    const results = (search as any)?.results ?? [];
    if (!Array.isArray(results) || results.length === 0) return null;

    const topNode = results[0];
    const filePath = String(topNode?.filePath ?? "").replace(/\\/g, "/");
    const dependencySummary = filePath ? `Axon also surfaced ${topNode?.name ?? "a related node"} in ${filePath}.` : `Axon also surfaced ${topNode?.name ?? "a related node"}.`;
    return dependencySummary;
  } catch {
    return null;
  }
}

async function summarizeWithAi(question: string, context: string) {
  const aiEngineUrl = getAiEngineUrl();
  if (!aiEngineUrl) return null;

  try {
    const response = await fetch(`${aiEngineUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, context }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const answer = String(data?.answer ?? "").trim();
    if (!answer || answer.startsWith("Error:")) return null;
    return answer;
  } catch {
    return null;
  }
}

export async function getRepoSearchStatus(): Promise<RepoSearchStatus> {
  const resolved = await resolveTargetRepoPath();
  const repoPath = resolved.repoPath;
  const repoKey = repoPath ? normalizeRepoKey(repoPath) : null;
  const semanticStatus = repoKey ? await callRepoCodeStatus(repoKey) : { aiEngineAvailable: Boolean(getAiEngineUrl()), qdrantConfigured: false, codeIndexReady: false, codeIndexCount: 0 };

  return {
    repoPath,
    repoPathConfigured: resolved.configured,
    repoPathReady: resolved.ready,
    repoPathSource: resolved.source,
    repoKey,
    qdrantConfigured: semanticStatus.qdrantConfigured,
    codeIndexReady: semanticStatus.codeIndexReady,
    codeIndexCount: semanticStatus.codeIndexCount,
    qdrantCollection: getQdrantCodeCollectionName(),
    axonConnected: axonClient.isConnected,
    aiEngineAvailable: semanticStatus.aiEngineAvailable,
    warning: resolved.warning,
  };
}

export async function answerRepoQuestion(question: string): Promise<RepoAnswerResult> {
  const status = await getRepoSearchStatus();

  if (!status.repoPath || !status.repoPathReady) {
    const answer = status.warning || "The target repo path is not configured, so I can't search the codebase yet.";
    return { answer, context: answer, matches: [], status };
  }

  const lexicalMatches = await runLexicalSearch(status.repoPath, question);
  const semanticMatches = status.repoKey && status.codeIndexReady ? await searchSemanticMatches(question, status.repoKey) : [];
  const matches = mergeMatches(status.repoPath, lexicalMatches, semanticMatches);
  const axonSummary = matches.length > 0 ? await getAxonEnrichment(question, matches) : null;
  const context = buildContext(question, status.repoPath, matches, status, axonSummary);

  if (matches.length === 0) {
    return {
      answer: `I couldn't find strong matches for that in ${path.basename(status.repoPath)}. Try asking about a symbol, route, feature, or file name.`,
      context,
      matches,
      status,
    };
  }

  if (!isLocationQuestion(question)) {
    const aiAnswer = await summarizeWithAi(question, context);
    if (aiAnswer) {
      return { answer: aiAnswer, context, matches, status };
    }
  }

  return {
    answer: buildDeterministicAnswer(question, matches, axonSummary),
    context,
    matches,
    status,
  };
}

async function flushIndexBatch(repoKey: string, chunks: RepoCodeChunk[]) {
  const aiEngineUrl = getAiEngineUrl();
  if (!aiEngineUrl) {
    throw new Error("AI_ENGINE_URL is not configured for repo-code indexing.");
  }

  const payload = {
    repo_key: repoKey,
    chunks,
  };

  const response = await fetch(`${aiEngineUrl}/repo-code/upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(String(data?.detail ?? data?.error ?? `Repo-code upsert failed with ${response.status}`));
  }

  return response.json();
}

function normalizeRepoIndexError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s+/g, " ").trim();

  if (/getaddrinfo failed|no such host|enotfound|eai_again/i.test(message)) {
    return "Qdrant endpoint DNS lookup failed. Verify QDRANT_URL points to the live Qdrant Cloud cluster endpoint.";
  }

  if (/timed out|timeout|operation was aborted/i.test(message)) {
    return "Repo indexing timed out while contacting Qdrant or the AI engine. Check the Qdrant endpoint and try again.";
  }

  if (/qdrant client is not configured/i.test(message)) {
    return "Qdrant is not configured in the AI engine. Set QDRANT_URL and QDRANT_API_KEY.";
  }

  return message;
}

function isFatalRepoIndexError(message: string) {
  return /qdrant endpoint dns lookup failed|timed out while contacting qdrant|qdrant is not configured|repo-code upsert failed/i.test(
    message,
  );
}

export async function buildRepoCodeIndex(): Promise<RepoIndexResult> {
  const startedAt = Date.now();
  const status = await getRepoSearchStatus();

  if (!status.repoPath || !status.repoPathReady || !status.repoKey) {
    return {
      ok: false,
      repo_path: status.repoPath,
      repo_key: status.repoKey,
      file_count: 0,
      chunk_count: 0,
      duration_ms: Date.now() - startedAt,
      errors: [status.warning || "Repo path is not configured."],
      qdrant_collection: status.qdrantCollection,
      status,
    };
  }

  if (!getAiEngineUrl()) {
    return {
      ok: false,
      repo_path: status.repoPath,
      repo_key: status.repoKey,
      file_count: 0,
      chunk_count: 0,
      duration_ms: Date.now() - startedAt,
      errors: ["AI_ENGINE_URL is required to build the Qdrant code index."],
      qdrant_collection: status.qdrantCollection,
      status,
    };
  }

  const files = await collectRepoFiles(status.repoPath, MAX_INDEX_FILES);
  const errors: string[] = [];
  let fileCount = 0;
  let chunkCount = 0;
  let batch: RepoCodeChunk[] = [];
  let fatalError: string | null = null;

  for (const absolutePath of files) {
    const relativePath = path.relative(status.repoPath, absolutePath);
    const content = await safeReadTextFile(absolutePath, MAX_INDEX_FILE_SIZE_BYTES);
    if (!content) continue;

    const chunks = chunkFile(relativePath, content).map((chunk) => ({
      ...chunk,
      id: createChunkId(status.repoKey!, chunk.relative_path, chunk.start_line, chunk.end_line),
    }));

    if (chunks.length === 0) continue;

    batch.push(...chunks);
    fileCount += 1;
    chunkCount += chunks.length;

    if (batch.length >= INDEX_BATCH_SIZE) {
      try {
        await flushIndexBatch(status.repoKey, batch.splice(0, batch.length));
      } catch (error) {
        const normalizedError = normalizeRepoIndexError(error);
        if (!errors.includes(normalizedError)) {
          errors.push(normalizedError);
        }
        if (isFatalRepoIndexError(normalizedError)) {
          fatalError = normalizedError;
          break;
        }
      }
    }
  }

  if (!fatalError && batch.length > 0) {
    try {
      await flushIndexBatch(status.repoKey, batch);
    } catch (error) {
      const normalizedError = normalizeRepoIndexError(error);
      if (!errors.includes(normalizedError)) {
        errors.push(normalizedError);
      }
      if (isFatalRepoIndexError(normalizedError)) {
        fatalError = normalizedError;
      }
    }
  }

  const refreshedStatus = await getRepoSearchStatus();

  return {
    ok: errors.length === 0,
    repo_path: refreshedStatus.repoPath,
    repo_key: refreshedStatus.repoKey,
    file_count: fileCount,
    chunk_count: chunkCount,
    duration_ms: Date.now() - startedAt,
    errors,
    qdrant_collection: refreshedStatus.qdrantCollection,
    status: refreshedStatus,
  };
}

