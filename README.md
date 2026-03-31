<div align="center">

# 🔍 AXD

### AI-Powered Code Review for GitHub Pull Requests

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Claude](https://img.shields.io/badge/Claude_Sonnet_4-Anthropic-D4A574?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![GitHub App](https://img.shields.io/badge/GitHub_App-181717?style=for-the-badge&logo=github&logoColor=white)](https://docs.github.com/en/apps)
[![License: MIT](https://img.shields.io/badge/License-MIT-22C55E?style=for-the-badge)](LICENSE)

**AXD reviews your pull requests like a principal engineer — catching bugs, security vulnerabilities, and performance issues before they hit production.**

[Getting Started](#-quick-start) · [How It Works](#-how-it-works) · [Configuration](#-configuration) · [Architecture](#-architecture) · [Contributing](#-contributing)

---

</div>

## ✨ What Makes AXD Different

| Feature | AXD | Generic AI Bots |
|---------|-----|-----------------|
| **Zero false positives** | Only reports issues with 80%+ confidence | Flags everything, wastes developer time |
| **Actionable suggestions** | Every issue includes exact code fix | Vague "consider refactoring" comments |
| **Context-aware** | Reads PR description, understands intent | Reviews diff in isolation |
| **Team-configurable** | `.prbot.yml` with custom rules per repo | One-size-fits-all |
| **Not noisy** | Groups all comments in ONE review | Spams 20 individual comments |
| **Updates on push** | Edits existing comment instead of re-posting | New comment on every push |

## 🎯 What It Catches

```
🔴 Critical    SQL injection, XSS, missing auth, hardcoded secrets
🟠 High        Race conditions, unhandled promises, N+1 queries
🟡 Medium      Missing error handling, incorrect type coercion
🔵 Low         Redundant code, suboptimal patterns
```

<details>
<summary><b>20+ specific patterns it looks for</b></summary>

**JavaScript/TypeScript:**
- `==` instead of `===` (type coercion bugs)
- Missing `await` on async functions
- `.catch()` swallowing errors without logging
- `Array.find()` result used without null check
- `JSON.parse()` without try/catch
- RegExp ReDoS vulnerabilities
- Prototype pollution via `Object.assign`

**Security:**
- SQL injection via string concatenation
- XSS from unescaped HTML output
- SSRF in user-controlled URLs
- Path traversal via `../` in user input
- Hardcoded secrets / API keys
- Missing CORS validation
- TOCTOU race conditions

**Performance:**
- N+1 database queries
- O(n²) where O(n) is possible
- Synchronous I/O in async paths
- Unbounded loops over user data
- Memory allocation in hot paths

</details>

## 🚀 Quick Start

### 1. Register a GitHub App

Go to **GitHub Settings > Developer Settings > GitHub Apps > New GitHub App** and set:

| Setting | Value |
|---------|-------|
| **Webhook URL** | `https://your-domain.com/api/webhooks/github` |
| **Webhook Secret** | Generate a random string |
| **Repository Permissions** | Contents: `Read`, Pull Requests: `Read & Write`, Checks: `Read & Write` |
| **Event Subscriptions** | `Pull Request`, `Installation` |

Download the private key (`.pem` file).

### 2. Clone & Install

```bash
git clone https://github.com/KartikeyaNainkhwal/axd.git
cd axd
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

```env
# GitHub App (from step 1)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-api03-...

# Infrastructure
DATABASE_URL=postgresql://user:pass@localhost:5432/axd
REDIS_URL=redis://localhost:6379
```

### 4. Start Infrastructure & Run

```bash
# Start PostgreSQL + Redis
npm run docker:dev

# Initialize database
npx prisma db push

# Start the bot
npm run dev
```

### 5. Install the App on Your Repo

Go to your GitHub App's page → **Install App** → Select your repository.

Open a PR — AXD will review it automatically! 🎉

## 🔧 Configuration

Drop a `.prbot.yml` in your repo root to customize review behavior:

```yaml
# What should the bot focus on?
review_focus:
  - security
  - performance
  - error-handling

# Skip these files
ignore_paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "docs/**"
  - ".github/**"

# Team-specific rules (injected into Claude's prompt)
custom_rules:
  - "Always check for SQL injection in any database query"
  - "Enforce async/await over .then() chains"
  - "All API endpoints must validate request body with Zod"
  - "Never commit console.log — use the logger instead"

# Minimum severity to comment on
severity_threshold: medium    # critical | high | medium | low

# Auto-approve clean PRs?
auto_approve_if_no_issues: true

# Your stack (helps Claude understand context)
language_hints:
  primary: typescript
  frameworks: [express, prisma, react]
  runtime: node

# Limits
max_files_per_review: 25
```

## ⚡ How It Works

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     GitHub                              │
                    │                                                         │
 Developer          │   PR opened/pushed ──► Webhook ──────────────────┐     │
 pushes code  ──────┤                                                   │     │
                    │   ◄── Review posted   ◄── Summary comment ◄──┐   │     │
                    └───────────────────────────────────────────────┼───┼─────┘
                                                                    │   │
                    ┌───────────────────────────────────────────────┼───┼─────┐
                    │                   AXD Server                  │   │     │
                    │                                               │   │     │
                    │   ┌───────────┐    ┌──────────────┐          │   │     │
                    │   │  Express  │    │   BullMQ      │  ┌──────┘   │     │
                    │   │  Webhook  │───►│   Job Queue   │  │          │     │
                    │   │  Server   │    │  (Redis)      │  │          │     │
                    │   └───────────┘    └──────┬───────┘  │          │     │
                    │                           │          │          │     │
                    │                    ┌──────▼───────┐  │          │     │
                    │                    │   Worker     │  │          │     │
                    │                    │              │  │          │     │
                    │    ┌───────────┐   │ 1. Fetch PR  │  │          │     │
                    │    │   Diff    │◄──│ 2. Parse diff│  │          │     │
                    │    │  Parser   │──►│ 3. Chunk     │  │          │     │
                    │    └───────────┘   │ 4. Review    │  │          │     │
                    │                    │ 5. Post      │──┘          │     │
                    │    ┌───────────┐   │              │             │     │
                    │    │  Claude   │◄──│              │─────────────┘     │
                    │    │  Sonnet   │──►│              │                   │
                    │    └───────────┘   └──────┬───────┘                   │
                    │                           │                           │
                    │    ┌───────────┐   ┌──────▼───────┐                   │
                    │    │ PostgreSQL│◄──│   Prisma     │                   │
                    │    │           │   │   ORM        │                   │
                    │    └───────────┘   └──────────────┘                   │
                    └───────────────────────────────────────────────────────┘
```

### The Review Pipeline

```
Webhook received
  │
  ├─► Signature verified (HMAC-SHA256)
  ├─► Event filtered (opened / synchronize / reopened)
  └─► Job enqueued to Redis
        │
        ├─► 1. Authenticate as GitHub App Installation
        ├─► 2. Fetch PR metadata + diff
        ├─► 3. Parse unified diff (line numbers preserved)
        ├─► 4. Filter files (respect .prbot.yml ignore_paths)
        ├─► 5. Chunk into ≤80k token batches (priority: security > core > tests)
        ├─► 6. Send to Claude with system prompt + repo rules
        │      └─► Retry 3x with exponential backoff (1s → 2s → 4s)
        │      └─► Auto-repair malformed JSON responses
        ├─► 7. Validate response with Zod schema
        ├─► 8. Post atomic PR review (all comments in ONE submission)
        ├─► 9. Post/update summary comment with stats
        └─► 10. Save to database (review history + feedback tracking)
```

## 🏗️ Architecture

```
src/
├── api/                    # REST API layer
│   ├── controllers/        # Health, repos, reviews, feedback endpoints
│   ├── middleware/          # Auth, rate limiting
│   └── router.ts
│
├── config/                 # App configuration
│   ├── env.ts              # Zod-validated environment variables
│   ├── logger.ts           # Pino structured logging
│   └── redis.ts            # Redis/BullMQ connection
│
├── db/                     # Database layer
│   ├── client.ts           # Prisma client (driver adapters)
│   └── repositories/       # Installation, Repository, Review, Feedback repos
│
├── github/                 # GitHub integration
│   ├── app.ts              # GitHub App setup
│   ├── webhooks.ts         # Webhook event handlers
│   ├── diff-parser.ts      # Unified diff → structured data
│   ├── chunk-extractor.ts  # Token-aware chunking with priority
│   ├── context-builder.ts  # Fetches surrounding code for context
│   ├── stats-builder.ts    # Complexity & risk analysis
│   └── review-poster.ts    # Atomic PR review posting
│
├── llm/                    # LLM engine
│   ├── prompts.ts          # System prompt + user prompt builder
│   ├── client.ts           # Claude API with retries + JSON repair
│   ├── parser.ts           # Response parsing + Zod validation
│   └── reviewer.ts         # Multi-chunk review orchestrator
│
├── queue/                  # Job processing
│   ├── review.queue.ts     # BullMQ queue definition
│   ├── review.worker.ts    # 10-step review job processor
│   └── retry.ts            # Retry strategies
│
├── services/               # Business logic
│   ├── config.service.ts   # .prbot.yml fetcher + merger
│   ├── review.service.ts   # Core review pipeline
│   └── usage.service.ts    # Token usage tracking
│
├── types/                  # TypeScript types
│   ├── config.types.ts     # RepoConfig Zod schema
│   ├── diff.types.ts       # Diff/chunk/context types
│   ├── github.types.ts     # Webhook payload types
│   └── review.types.ts     # LLM response schema
│
└── index.ts                # Entry point
```

## 🗄️ Database Schema

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Installation │     │  Repository  │     │    Review     │     │   Feedback   │
├──────────────┤     ├──────────────┤     ├──────────────┤     ├──────────────┤
│ githubId     │◄───►│ githubId     │◄───►│ prNumber     │     │ vote         │
│ accountLogin │     │ fullName     │     │ headSha      │     │  (👍 / 👎)   │
│ accountType  │     │ isActive     │     │ verdict      │     │ reason       │
│ plan         │     │ config (JSON)│     │ filesReviewed│     │ githubUser   │
│ accessToken  │     │ language     │     │ durationMs   │     └──────┬───────┘
└──────────────┘     └──────────────┘     │ promptTokens │            │
                                          └──────┬───────┘            │
                                                 │                    │
                                          ┌──────▼───────┐            │
                                          │ReviewComment │◄───────────┘
                                          ├──────────────┤
                                          │ path         │
                                          │ line         │
                                          │ severity     │
                                          │ type         │
                                          │ title        │
                                          │ suggestion   │
                                          │ codeSnippet  │
                                          └──────────────┘
```

## 📊 What the Review Looks Like

When AXD reviews a PR, it posts:

**1. Inline comments** at exact line numbers:

> 🟠 High 🔒 **Missing auth check on admin endpoint**
>
> This endpoint modifies user roles but doesn't verify the caller has admin privileges. Any authenticated user could escalate permissions.
>
> **💡 Suggestion:** Add `requireRole('admin')` middleware before the handler
>
> ```suggestion
> router.put('/users/:id/role', requireRole('admin'), updateUserRole);
> ```

**2. Summary comment** with full breakdown:

> # ✅ Approved
>
> > Well-structured authentication module with proper separation of concerns.
>
> ### 📊 Issue Breakdown
> | Severity | Count |
> |----------|-------|
> | 🟡 Medium | 2 |
> | 🔵 Low | 1 |
>
> <details><summary><b>👏 What's Done Well</b></summary>
>
> - ✅ Good use of bcrypt for password hashing
> - ✅ Proper error handling in all async functions
> - ✅ JWT token expiry correctly configured
>
> </details>
>
> ---
> <sub>📝 Reviewed **8** files in **3.2s** · 12,450 tokens · Commit: `abc1234`</sub>
> <sub>🤖 Powered by **AXD** · 2026-04-01 03:00:00 UTC</sub>

## 🛠️ Tech Stack

| Component | Technology | Why |
|-----------|------------|-----|
| **Runtime** | Node.js 20+ | Async-first, excellent GitHub SDK support |
| **Language** | TypeScript 6 | End-to-end type safety, Zod schema validation |
| **AI Model** | Claude claude-sonnet-4-6 | Best code understanding, structured JSON output |
| **Web Framework** | Express 5 | Lightweight, middleware ecosystem |
| **Database** | PostgreSQL + Prisma 7 | Relational data, type-safe ORM, migrations |
| **Queue** | BullMQ + Redis | Decouples webhook from slow LLM calls, retries |
| **GitHub** | Octokit + GitHub App | Fine-grained permissions, installation tokens |
| **Logging** | Pino | Structured JSON logs, 5x faster than Winston |
| **Validation** | Zod | Runtime type validation for env, config, LLM output |
| **Deployment** | Docker Compose | PostgreSQL + Redis in one command |

## 📝 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + version |
| `POST` | `/api/webhooks/github` | GitHub webhook receiver |
| `GET` | `/api/repos` | List tracked repositories |
| `GET` | `/api/repos/:id/config` | Get repo config |
| `PUT` | `/api/repos/:id/config` | Update repo config |
| `GET` | `/api/repos/:id/reviews` | List review history |
| `GET` | `/api/reviews/:id` | Get review details |
| `POST` | `/api/reviews/:id/comments/:commentId/feedback` | Submit comment feedback |

## 🐳 Docker Development

```bash
# Start PostgreSQL + Redis
npm run docker:dev

# View logs
docker compose -f docker/docker-compose.yml logs -f

# Stop
npm run docker:down
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Run smoke tests (verifies all modules)
npx tsx tests/smoke.ts
```

**Current test coverage:**
- ✅ 22 unit tests (diff parser + LLM parser)
- ✅ 20 smoke tests (all 6 modules: diff, chunks, stats, config, LLM, prompts)

## 🚢 Deployment

### Railway / Render / Fly.io

1. Set all environment variables from `.env.example`
2. Build command: `npm run build && npx prisma db push`
3. Start command: `npm start`
4. Update your GitHub App's webhook URL

### Self-hosted

```bash
docker build -t axd .
docker run -p 3000:3000 --env-file .env axd
```

## 🗺️ Roadmap

- [x] GitHub webhook handler with signature verification
- [x] Diff parser with line-level tracking
- [x] Token-aware chunking with priority classification
- [x] Claude integration with retry + JSON repair
- [x] Per-repo configuration via `.prbot.yml`
- [x] Atomic PR review posting (one review, not comment spam)
- [x] Comment update on re-push (no spam)
- [x] Feedback system (👍/👎 on comments)
- [ ] Dashboard UI for config management
- [ ] PR review analytics & metrics
- [ ] Custom model support (GPT-4, Gemini)
- [ ] Monorepo support (per-package config)
- [ ] Slack/Discord notifications
- [ ] Self-hosted single-binary distribution

## 🤝 Contributing

Contributions are welcome! Please read the [contributing guide](docs/CONTRIBUTING.md) first.

```bash
# Fork & clone
git clone https://github.com/YOUR_USERNAME/axd.git
cd axd
npm install

# Create a branch
git checkout -b feat/your-feature

# Make changes, test, and submit a PR
npm test
npm run lint
```

## 📄 License

MIT © [Kartikeya Nainkhwal](https://github.com/KartikeyaNainkhwal)

---

<div align="center">

**Built with ❤️ by [Kartikeya Nainkhwal](https://github.com/KartikeyaNainkhwal)**

*CS Undergraduate @ IIT Bhilai*

⭐ Star this repo if you find it useful!

</div>
