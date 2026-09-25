<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:user-custom-rules -->
# CRITICAL SAFETY RULE: STRICT PROHIBITION ON UNAPPROVED CODE PUSHES

## NEVER RUN `git push` WITHOUT EXPLICIT USER AUTHORIZATION
1. **ABSOLUTE PROHIBITION ON UNAPPROVED REMOTE PUSHES:**
   - Under NO circumstances may the AI agent run `git push`, `git push origin`, or any command that pushes commits to a remote repository/branch unless the user has EXPLICITLY and UNAMBIGUOUSLY requested or authorized it in the current conversation turn.
   - All changes, code edits, and git commits (`git commit`) MUST remain strictly local until explicit user sign-off.
   - Never assume permission to push based on "finishing a task", "cleaning up", or "submitting".

2. **WHY THIS RULE EXISTS:**
   - Safety: Prevents premature, untested, or unvetted code from triggering remote CI/CD pipelines, workflows, or deployments.
   - Workflow Efficiency: Saves API/runner workflows and eliminates waiting for remote builds to complete.
   - User Control: The user must inspect and approve all changes before anything is published to remote or production.

3. **WORKFLOW PROCEDURE:**
   - Complete work locally.
   - Run local linting, tests (`npm test`), and local builds (`npm run build`) to verify correctness.
   - Commit locally if appropriate.
   - Present the summary to the user and await their explicit authorization before proposing or executing `git push`.
<!-- END:user-custom-rules -->

<!-- BEGIN:project-context -->
# Utah City — Operational Intelligence Platform

## What This App Is
A Next.js 16 application that captures tour host debriefs (voice or text), structures them with AI (LLM extraction or heuristic fallback), and rolls the data up into leadership dashboards with evidence-backed metrics, an AI analyst console, and team management. Production URL: `https://utahcity.app`.

## Tech Stack
- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript 5**
- **Vercel AI SDK v6** with multi-provider routing: Google Gemini → Anthropic Claude → AI Gateway → Heuristic
- **Neon Postgres** (serverless HTTP driver) with file-based JSON fallback
- **Resend** for email (invitations + bidirectional support relay via webhooks)
- **Tailwind CSS v4**, **Radix UI**, **Recharts**, **cmdk**
- **Transformers.js** (on-device Whisper WASM for client-side speech-to-text)
- **Vitest** + **Playwright** for testing

## Directory Map
```
src/
├── app/
│   ├── (capture)/              → Mobile capture page at /
│   ├── (leadership)/           → Leadership dashboard pages (wrapped in AppShell)
│   │   ├── analyst/page.tsx    → /analyst — AI RAG console
│   │   ├── command/page.tsx    → /command — Executive Command Center
│   │   ├── evidence/page.tsx   → /evidence — Evidence Library
│   │   ├── journey/page.tsx    → /journey — Resident lifecycle
│   │   ├── operations/page.tsx → /operations — Host adoption monitoring
│   │   ├── settings/page.tsx   → /settings — Team & corpus admin
│   │   └── signals/page.tsx    → /signals — Objection & amenity signals
│   ├── api/                    → 14 API route handlers
│   ├── login/page.tsx          → Sign-in page
│   └── setup-account/page.tsx  → Account activation via invitation token
├── components/                 → 9 top-level React components
│   └── domain/                 → 5 dashboard/chart/analyst components
├── domain/                     → Core types: Observation, Extraction, Platform schemas
│   ├── observation.ts          → Zod ExtractionSchema, controlled vocabularies
│   ├── platform.ts             → Generalized interaction/signal/entity schemas
│   ├── evidence-matcher.ts     → Semantic excerpt extraction, word boundary matching
│   └── sanitize-text.ts        → Transcript cleanup (UTF-8 repair, translation stripping)
├── lib/                        → Utilities (cn(), whisper-client, re-export facades)
└── server/
    ├── ai/                     → LLM extraction, transcription, context caching, model config
    ├── analyst/                → RAG analyst service + system prompt
    ├── analytics/adoption.ts   → Host adoption & coverage analytics
    ├── auth/                   → Crypto (PBKDF2), sessions (HMAC-SHA256), user verification
    ├── command/command-view.ts → Command center data aggregator
    ├── db/migrations/          → SQL migration scripts (future platform schema)
    ├── email/mailer.ts         → Resend invitation email sender
    ├── intelligence/           → Command center builder (actions, journey health)
    ├── reporting/digest.ts     → Deterministic rollups, guardrails, narrative generation
    ├── repositories/           → Data access layer (Postgres + file-based, auto-selected)
    └── services/               → Application services (observations, digest, seed, status)
```

## Key Architecture Patterns

### Repository Pattern
`src/server/repositories/observations.ts` checks if `DATABASE_URL` is set:
- **Yes** → uses `postgres-observation-repository.ts` (Neon serverless driver)
- **No** → uses `file-observation-repository.ts` (JSON in `.data/`)

### LLM Fallback Chain
`src/server/ai/model-config.ts` checks providers in order:
1. Google Gemini (`GEMINI_API_KEY`)
2. Anthropic Claude (`ANTHROPIC_API_KEY`)
3. Vercel AI Gateway (`AI_GATEWAY_API_KEY`)
4. Heuristic (no key needed — deterministic regex/keyword extraction)

### ASR Fallback Chain
1. Server: Google Gemini Flash multimodal transcription (~800ms)
2. Server: OpenAI Whisper API
3. Client: On-device Transformers.js WASM Whisper (no server needed)

### Auth & RBAC
- `src/middleware.ts` validates `uc_session` cookie on every request
- Two roles: `host` (capture only) and `leader` (full access)
- Sessions: HMAC-SHA256 signed `[payloadB64].[sigB64]` tokens
- Passwords: PBKDF2 with 100k iterations
- Invitations: cryptographically signed tokens with 30-day expiry

### Email Relay
`src/app/api/webhooks/resend/route.ts` implements bidirectional support@utahcity.app:
- Customer → support@utahcity.app → webhook → forward to SUPPORT_FORWARD_EMAIL with reply+<encoded>@utahcity.app
- Admin replies → webhook decodes customer email → sends from support@utahcity.app

## Core Data Type
The `Observation` is the central record (defined in `src/domain/observation.ts`):
- Contains raw `transcript`, host/prospect metadata, `engine` (llm|heuristic), and `extraction`
- `Extraction` has: summary, sentiment (-2..+2), intent (hot/warm/cold/unknown), objections (14 types), amenities (17 catalog items), follow-up questions, coverage score (0..1)

## API Endpoints (14 total)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/login | Public | Authenticate & set session cookie |
| POST | /api/auth/logout | Public | Clear session |
| GET | /api/auth/me | Session | Current user identity |
| GET/POST | /api/auth/setup-account | Token | Verify invitation / register credentials |
| GET/POST/PATCH/DELETE | /api/auth/invite | Leader | Team invite & account lifecycle |
| GET/POST/DELETE | /api/observations | Session (DELETE: Leader) | CRUD observations |
| POST | /api/analyst | Leader | AI analyst question answering |
| GET | /api/digest | Leader | Leadership digest + narrative |
| POST/DELETE | /api/seed | Leader | Load/clear demo data |
| POST | /api/transcribe | Session | Server-side audio transcription |
| GET | /api/status | Public | Health check |
| GET/POST | /api/webhooks/resend | Public/Svix | Inbound email webhook |
| GET/POST | /api/webhooks/inbound | Public/Svix | Alias for resend webhook |

## Tests
```bash
npm test              # Vitest: 81+ unit/integration tests
npm run build         # TypeScript + Turbopack production build
```

## Detailed Documentation
- `docs/ARCHITECTURE.md` — System architecture deep-dive
- `docs/API.md` — Complete API reference with schemas
- `docs/DATA-MODEL.md` — Domain types, database schema, vocabularies
- `docs/COMPONENTS.md` — React component reference with props
- `docs/ENVIRONMENT.md` — Environment variable reference
<!-- END:project-context -->
