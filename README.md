# MindFlayer

**Autonomous DevOps Autopilot** — AI agents that test, diagnose, and fix your code. From PR to production, zero human intervention.

Built for autonomous DevOps validation and remediation workflows.

---

## What It Does

Point MindFlayer at a pull request. Five AI agents take over:

1. **Architect** — reads your codebase via GitHub MCP, builds a knowledge graph of every function, import, and dependency
2. **Scripter** — generates targeted E2E test plans using AWS Bedrock LLMs, informed by past test plans (RAG)
3. **Tester** — executes tests in a real Chromium browser via Playwright MCP
4. **Healer** — performs root cause analysis on failures with up to 3 iterative fix attempts (circuit breaker), learns from past fixes (RAG)
5. **Courier** — creates GitHub issues for failures, opens fix PRs with generated test files, notifies Slack and Telegram

Control everything from Telegram or Slack:

```
/prs              → list open pull requests
/run 1            → trigger pipeline for PR #1
/status           → check results
/ask auth         → query the knowledge graph
/impact auth.js   → blast radius analysis
/deadcode         → find unreachable code
/graph            → architecture overview
/screenshot       → live screenshot of target app
```

---

## Architecture

```
Telegram / Slack / Dashboard
        |
        v
  Next.js API (port 3000)
        |
   Orchestrator
   |    |    |    |    |
   v    v    v    v    v
 Arch  Script Test  Heal  Courier
   |    |     |     |      |
   v    v     v     v      v
Bedrock Bedrock Playwright Bedrock GitHub
Qwen3   Qwen3   MCP       Sonnet  MCP
        |                  |
        v                  v
   Axon Graph           Qdrant
                     (RAG memory)
                          |
                          v
                     CloudWatch
                     (metrics)
```

---

## Healer Loop (Circuit Breaker)

The Healer doesn't just fix once — it iterates:

```
Tests fail → Healer attempt 1 (confidence 72%)
           → Healer attempt 2 with attempt 1's context (confidence 88%)
           → Healer attempt 3 with all prior context (confidence 95%)
           → Best fix (highest confidence) pushed to GitHub
```

- Max 3 attempts per pipeline run
- Each attempt sees previous attempts' RCA + fixes
- Stops early if confidence >= 90%
- Best fix across all attempts is used
- Escalates if all attempts fail

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, Framer Motion, Radix UI |
| Real-time | Socket.IO (live pipeline updates) |
| Graph Viz | react-force-graph-2d (architecture timeline) |
| AI Engine | FastAPI + LangGraph (Python) |
| LLMs | AWS Bedrock — Qwen3 Coder (Architect), Claude Sonnet 4.6 (Healer), Claude Haiku 4.5 (Judge) |
| Embeddings | Amazon Titan Embed Text v2 (1024-dim) |
| Database | Amazon DynamoDB (sessions, auth) |
| Vector Store | Qdrant (RAG memory) |
| Monitoring | Amazon CloudWatch (pipeline metrics) |
| Knowledge Graph | Axon (AST-based code intelligence) |
| Browser Testing | Playwright MCP (headless Chromium) |
| Auth | NextAuth v4 + DynamoDB Adapter |
| Notifications | Telegram Bot, Slack Bot (interactive), Slack Webhooks, Notion API |
| Code Integration | GitHub MCP (read repos, create PRs/issues) |

---

## Cloud Services Used

| Service | Purpose |
|---|---|
| **Amazon Bedrock** | LLM inference — Qwen3 Coder, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **Amazon DynamoDB** | Session persistence, user auth, timeline snapshots |
| **Qdrant** | Vector search for RAG (past fixes + test plans + repo code chunks) |
| **Amazon Titan Embeddings v2** | Text-to-vector (1024-dim) for similarity search |
| **Amazon CloudWatch** | Pipeline metrics — TestsPassed, TestsFailed, TestsTotal, PipelineDuration |
| **Amazon EC2 / OCI Compute** | Production compute host (AWS or OCI Always Free A1) |

---

## Project Structure

```
mindflayer/
├── src/
│   ├── app/
│   │   ├── dashboard/        # Main pipeline dashboard
│   │   ├── timeline/         # Architecture evolution viewer
│   │   ├── auth/             # GitHub OAuth login
│   │   ├── pricing/          # Pricing page
│   │   └── api/
│   │       ├── agent/
│   │       │   ├── pipeline/      # POST — run full pipeline
│   │       │   ├── pull-requests/ # GET — list PRs (GitHub API)
│   │       │   ├── axon/          # POST — knowledge graph queries
│   │       │   ├── timeline/      # GET/POST — architecture snapshots
│   │       │   ├── screenshot/    # POST — live browser screenshot
│   │       │   ├── sessions/      # GET — session details
│   │       │   └── status/        # GET — agent health
│   │       ├── auth/              # NextAuth routes
│   │       ├── courier/           # PR/Issue creation
│   │       └── watchdog/          # CloudWatch metrics + anomaly detection
│   ├── lib/
│   │   ├── mcp/
│   │   │   ├── orchestrator.ts      # Pipeline coordinator (heal loop)
│   │   │   ├── github-client.ts     # GitHub MCP client
│   │   │   ├── playwright-client.ts # Playwright MCP client (+ screenshot)
│   │   │   ├── test-runner.ts       # Test execution engine
│   │   │   ├── courier.ts           # PR/Issue agent
│   │   │   ├── axon-client.ts       # Knowledge graph client
│   │   │   ├── ai-engine-client.ts  # LangGraph API client
│   │   │   ├── watchdog.ts          # CloudWatch publish + anomaly detection
│   │   │   └── session-provider.ts  # DB provider factory
│   │   ├── notifications/
│   │   │   ├── telegram.ts  # Telegram Bot API
│   │   │   └── slack.ts     # Slack Webhooks
│   │   ├── notion/           # Notion reporting
│   │   └── db/               # User CRUD (DynamoDB/MongoDB)
│   └── components/           # UI components (shadcn/ui)
│
├── ai-engine/                # Python AI service
│   ├── server.py             # FastAPI server (port 8000)
│   ├── nodes/
│   │   ├── architect.py      # Test plan generation (Qwen3 Coder)
│   │   ├── healer.py         # Root cause analysis (Claude Sonnet 4.6)
│   │   ├── decision.py       # Failure classification (Claude Haiku 4.5)
│   │   ├── courier_decision.py
│   │   └── courier_execute.py
│   ├── memory/
│   │   ├── store_qdrant.py        # RAG storage (Qdrant)
│   │   ├── retriever_qdrant.py    # RAG retrieval (Qdrant)
│   │   └── provider.py            # Vector DB factory
│   └── llm/
│       ├── client.py         # LLM provider config
│       └── embeddings.py     # Titan embeddings
│
├── scripts/
│   ├── telegram-bot.ts       # Telegram Boss Agent (9 commands)
│   ├── slack-bot.ts          # Slack Boss Agent (9 commands)
│   ├── create-dynamodb-tables.ts
│   ├── ec2-setup.sh          # Legacy EC2 deployment script
│   └── deploy/
│       ├── providers/oci.sh  # OCI deployment orchestrator
│       └── oci/              # OCI modular deployment scripts
│
└── .env                      # Configuration
```

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+
- AWS CLI configured with credentials
- GitHub Personal Access Token

### 1. Install dependencies

```bash
npm install

cd ai-engine
pip install -r requirements.txt
```

### 2. Configure environment

Create `.env` in the project root:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate-a-secret>
GITHUB_ID=<github-oauth-client-id>
GITHUB_SECRET=<github-oauth-client-secret>
GITHUB_PERSONAL_ACCESS_TOKEN=<github-pat>

AWS_REGION=us-east-1
AWS_BEDROCK_REGION=us-east-1
DB_PROVIDER=dynamodb
DYNAMODB_TABLE_NAME=SentinelQA
DYNAMODB_NEXTAUTH_TABLE_NAME=SentinelQA-NextAuth

AI_ENGINE_URL=http://localhost:8000

SENTINELQA_DEFAULT_OWNER=<github-username>
SENTINELQA_DEFAULT_REPO=<repo-name>
SENTINELQA_TARGET_URL=http://localhost:5173
NEXT_PUBLIC_DEFAULT_OWNER=<github-username>
NEXT_PUBLIC_DEFAULT_REPO=<repo-name>

SLACK_WEBHOOK_URL=<slack-webhook>
SLACK_BOT_TOKEN=<xoxb-token>
SLACK_APP_TOKEN=<xapp-token>
NOTION_TOKEN=<notion-token>
NOTION_DATABASE_ID=<notion-db-id>
TELEGRAM_BOT_TOKEN=<telegram-bot-token>
TELEGRAM_CHAT_ID=<telegram-chat-id>
AXON_API_URL=http://localhost:8420
```

Create `ai-engine/.env`:

```env
LLM_PROVIDER=bedrock
AWS_BEDROCK_REGION=us-east-1
EMBEDDING_PROVIDER=bedrock
VECTOR_PROVIDER=qdrant
QDRANT_URL=<qdrant-url>
QDRANT_API_KEY=<qdrant-api-key>
QDRANT_ARCHITECT_COLLECTION=architect-memory
QDRANT_HEALER_COLLECTION=healer-memory
QDRANT_CODE_COLLECTION=repo-code-chunks
HEALER_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-6
JUDGE_BEDROCK_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

### 3. Provision AWS managed resources

```bash
npm run db:create-tables
```

### 4. Index target repo with Axon

```bash
pip install axoniq
cd /path/to/target-repo
axon analyze . --no-embeddings
```

### 5. Run locally (5 terminals)

```bash
# Terminal 1: Dashboard
npm run dev

# Terminal 2: Target app
cd /path/to/target-repo && npx serve . -l 5173

# Terminal 3: Telegram bot
npm run telegram:bot

# Terminal 4: Slack bot
npm run slack:bot

# Terminal 5: AI Engine
cd ai-engine && python server.py
```

### 6. Deploy to AWS EC2

```bash
# Launch t3.small instance with setup script
bash scripts/ec2-setup.sh
```

### 7. Deploy to OCI Always Free (modular path)

```bash
cp scripts/deploy/oci/oci-free-tier.env.example scripts/deploy/oci/oci-free-tier.env
# Edit values in scripts/deploy/oci/oci-free-tier.env

bash scripts/deploy/providers/oci.sh preflight scripts/deploy/oci/oci-free-tier.env
bash scripts/deploy/providers/oci.sh network scripts/deploy/oci/oci-free-tier.env
bash scripts/deploy/providers/oci.sh launch scripts/deploy/oci/oci-free-tier.env
bash scripts/deploy/providers/oci.sh bootstrap scripts/deploy/oci/oci-free-tier.env
bash scripts/deploy/providers/oci.sh deploy scripts/deploy/oci/oci-free-tier.env
bash scripts/deploy/providers/oci.sh verify scripts/deploy/oci/oci-free-tier.env
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/prs` | List open pull requests |
| `/run <number>` | Run pipeline for a PR |
| `/status` | Check last pipeline results |
| `/screenshot [url]` | Live screenshot of target app |
| `/ask <question>` | Search the knowledge graph |
| `/impact <symbol>` | Blast radius analysis |
| `/deadcode` | Find unreachable code |
| `/graph` | Knowledge graph stats |
| `/help` | Show all commands |

## Slack Commands

Same as Telegram, except `/status` → `/showstatus` and `/help` → `/mf-help` (Slack reserves those).

---

## Pipeline Flow

```
1. Architect reads repo code via GitHub MCP
2. Axon enriches with knowledge graph (nodes, edges, communities)
3. Reads mindflayer.config.json for mandatory tests + limits
4. Scripter generates test plan via Bedrock (Qwen3 Coder)
   └── RAG: retrieves similar past test plans from Qdrant
5. Playwright MCP executes tests in headless Chromium
6. If failures:
   a. Healer runs RCA via Bedrock (Claude Sonnet 4.6) — up to 3 attempts
      └── RAG: retrieves similar past fixes from Qdrant
      └── Each attempt sees previous attempts' context
      └── Keeps highest confidence fix
   b. Judge classifies failures via Bedrock (Claude Haiku 4.5)
   c. Courier creates GitHub Issue with failure report
7. Test Writer generates .spec.ts files + applies healer fixes
8. Courier opens fix PR on GitHub
9. Notifications sent to Telegram + Slack
10. Results logged to Notion + CloudWatch
11. Fix + test plan stored in Qdrant for future RAG retrieval
```

---

## Mandatory Tests

Drop a `mindflayer.config.json` in your target repo:

```json
{
  "mandatory_tests": [
    "## Mandatory Test Suite",
    "",
    "### Scenario: Page loads",
    "- Navigate to {TARGET_URL}",
    "- Assert page contains \"Welcome\""
  ],
  "max_generated_tests": 10
}
```

Mandatory tests always run first. AI-generated tests capped at `max_generated_tests`.

---

## Architecture Timeline

The `/timeline` page visualizes how the codebase structure evolves over merged PRs:

- Force-directed graph showing files, functions, classes, and their relationships
- Timeline slider to scrub through snapshots
- Diff highlighting: green (added), red (removed), yellow (modified)
- PR metadata sidebar with stats comparison
- Powered by Axon knowledge graph snapshots stored in DynamoDB

---

## Database Provider Pattern

Dual database backends via environment variables — no code changes to switch:

| Component | Env Var | Options |
|---|---|---|
| Auth + Sessions | `DB_PROVIDER` | `dynamodb` or `mongodb` |
| Vector Store (RAG) | `VECTOR_PROVIDER` | `qdrant` or `mongodb` |

---

## CloudWatch Metrics

Every pipeline run publishes to the `MindFlayer` CloudWatch namespace:

| Metric | Unit |
|---|---|
| `TestsTotal` | Count |
| `TestsPassed` | Count |
| `TestsFailed` | Count |
| `PipelineDuration` | Milliseconds |
| `HealerConfidence` | None (0.0-1.0) |

Dimension: `Repo: {owner}/{repo}`

---

## Cleanup

```bash
# Delete EC2
aws ec2 terminate-instances --instance-ids <id>

# DynamoDB + CloudWatch can stay (free tier)
```

---

## Team

Built by the MindFlayer team.
