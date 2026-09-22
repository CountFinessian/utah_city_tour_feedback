# Utah City — Host Intelligence (MVP)
# Utah City — Operational Intelligence Platform

The thinnest slice of the Utah City **operational memory** system: capture what hosts
hear on every tour, structure it automatically, and roll it up into a leadership
"What Hosts Are Hearing" digest.
A lightweight Next.js application that captures tour host debriefs, structures them with AI, and rolls the data up into leadership dashboards. Built for one business problem: **turn what hosts hear on every tour into structured, actionable intelligence for Utah City leadership**.

This is the Host-touchpoint MVP from the strategy plan — one touchpoint, one persona,
one decision-maker consuming the output. It deliberately excludes other touchpoints,
prediction, and dashboards until the capture habit is real.
## Quick Start

## The loop
```bash
# 1. Install dependencies
npm install

# 2. (Optional) Copy and configure environment variables
cp .env.example .env.local
# See docs/ENVIRONMENT.md for details on each variable

# 3. Start the dev server
npm run dev
# Open http://localhost:3000
```
host talks (or types)  ─►  transcript  ─►  LLM extraction into a minimal ontology
        ▲                                          │
        │                                          ▼
   weekly digest  ◄──  aggregation  ◄──  stored Observation (objections, amenity
   for leadership                          reactions, intent, sentiment, follow-ups)
```

- **Capture** (`/`) — mobile-first. Tap the mic and talk (transcribed **on-device** with
  Whisper via transformers.js — no API key, fully private), or type. The system extracts
  objections (controlled vocabulary), amenity reactions, prospect intent, sentiment,
  family/lifestyle signals, questions asked, and the follow-ups that would complete the
  picture — then suggests refinements (the "ambient coverage" idea).
- **Manager** (`/manager`) — adoption view. Per-host coverage vs. a weekly target, a
  7-day activity sparkline, last-logged streaks, and who needs a nudge. Adoption is the
  make-or-break metric: no debriefs, no intelligence.
- **Digest** (`/digest`) — leadership view. Top objections (note how *parking* recurs in
  the demo data), amenity interest, pipeline read, recurring questions, and an
  auto-written weekly brief.
The app works **with zero API keys and no database** — it falls back to file-based storage, heuristic extraction, and on-device Whisper transcription. Add keys progressively to unlock AI-powered capabilities.

## Run it
Check system status at [`/api/status`](http://localhost:3000/api/status).

```bash
npm run dev
# open http://localhost:3000  → click "Load demo data" on the Digest page
```
---

It works **with no API keys and no database**: extraction falls back to a deterministic
heuristic, the digest brief uses a grounded template, and data persists to a local JSON
file. To upgrade, copy `.env.example` to `.env.local`:
## Features

- `DATABASE_URL` → durable Postgres (Neon) instead of the JSON file. The Vercel Neon
  Marketplace integration sets this automatically on deploy.
- `AI_GATEWAY_API_KEY` → Claude-quality extraction + an LLM-written narrative (via the
  Vercel AI Gateway; models are swappable with `EXTRACTION_MODEL` / `NARRATIVE_MODEL`).
  On Vercel this works automatically via OIDC — no key needed.
- Voice is transcribed **on-device** by default (transformers.js Whisper, `whisper-base.en`,
  ~80 MB downloaded once per browser — no key, no server). `NEXT_PUBLIC_WHISPER_MODEL` swaps the
  model; `OPENAI_API_KEY` optionally switches to faster server-side Whisper instead.
### Capture (`/`)
Mobile-first tour debrief capture. Hosts tap the mic and talk (transcribed on-device via Whisper WASM — no API key, fully private), or type. The system extracts objections, amenity reactions, prospect intent, sentiment, family/lifestyle signals, questions asked, and follow-up gaps — then suggests refinements.

Check wiring at `/api/status` (reports storage backend, extraction engine, model).
### Command Center (`/command`)
Executive dashboard for leadership. Intelligence score, KPI tiles with week-over-week deltas, sentiment timeline, intent funnel, top objections, amenity reactions, AI-generated executive narrative, journey rail, and ranked recommendations — all backed by verbatim evidence popovers.

### AI Analyst (`/analyst`)
Conversational RAG interface. Leadership can query the entire corpus in natural language (e.g. "Why are tours not converting?") and receive evidence-backed answers with confidence ratings, sample sizes, and supporting quotes.

### Evidence Library (`/evidence`)
Search, filter, and inspect individual tour debriefs. Multi-attribute filtering (source, intent, objection type, amenity), full transcript expansion, follow-up gap inspection, and record deletion.

### Signals (`/signals`)
Dense objection and amenity signal view with evidence drill-down.

### Operations (`/operations`)
Host adoption monitoring — per-host debrief counts, completeness scores, recency, staleness, and hot-lead tracking.

### Journey (`/journey`)
Resident lifecycle intelligence from tour through referral.

### Settings (`/settings`)
Team administration (invite, upgrade, remove members), corpus management (load/clear demo data, delete evidence records).

---

## Architecture

| Concern | Where | Note |
| Concern | Location | Description |
|---|---|---|
| Ontology (zod schema + controlled vocabularies) | `src/lib/ontology.ts` | The minimal Observation/Signal model |
| Extraction (LLM + offline fallback) | `src/lib/extract.ts` | `generateObject` with a heuristic backup |
| Storage | `src/lib/store.ts` | File-based JSON (`.data/`) — swap for Postgres + a vector store in production |
| Aggregation + narrative | `src/lib/digest.ts` | Deterministic rollups; LLM prose when available |
| API | `src/app/api/*` | `observations`, `transcribe`, `digest`, `seed` |
| UI | `src/app/`, `src/components/` | Next.js App Router, Tailwind v4 |
| Domain types & schemas | `src/domain/` | `Observation`, `Extraction` (Zod), controlled vocabularies |
| AI extraction | `src/server/ai/extraction.ts` | LLM `generateObject` + heuristic fallback |
| Transcription | `src/server/ai/transcription.ts` | Gemini Flash → OpenAI Whisper → on-device WASM |
| Storage | `src/server/repositories/` | Postgres (Neon) or file-based JSON, auto-selected |
| Aggregation | `src/server/reporting/`, `src/server/command/` | Digest rollups, command view, adoption analytics |
| Analyst (RAG) | `src/server/analyst/` | Gemini context-cached one-shot RAG |
| Auth & RBAC | `src/server/auth/`, `src/middleware.ts` | HMAC-SHA256 sessions, PBKDF2, invitation tokens |
| Email relay | `src/app/api/webhooks/resend/` | Bidirectional `support@utahcity.app` proxy |
| API routes | `src/app/api/` | 14 endpoints (see `docs/API.md`) |
| UI components | `src/components/` | 14 React components (see `docs/COMPONENTS.md`) |
| Pages | `src/app/` | 2 route groups: `(capture)` for hosts, `(leadership)` for leaders |

Built with Next.js 16, React 19, the Vercel AI SDK v6, and Tailwind CSS v4.
**Detailed docs:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/API.md`](docs/API.md) · [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) · [`docs/COMPONENTS.md`](docs/COMPONENTS.md) · [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)

---

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Runtime:** React 19, TypeScript 5
- **AI:** Vercel AI SDK v6, Google Gemini, Anthropic Claude, Transformers.js (on-device Whisper)
- **Database:** Neon Postgres (serverless HTTP driver) with file-based fallback
- **Email:** Resend (invitations + bidirectional support relay)
- **Styling:** Tailwind CSS v4, Radix UI primitives, Recharts
- **Auth:** Custom HMAC-SHA256 stateless sessions, PBKDF2 password hashing
- **Testing:** Vitest (unit/integration), Playwright (E2E)

---

## Auth & Roles

Two roles: **Host** (tour capture only) and **Leader** (full dashboard access).

| Route | Host | Leader |
|---|---|---|
| `/` (Capture) | ✅ | ✅ |
| `/command`, `/analyst`, `/evidence`, etc. | ❌ (redirected) | ✅ |
| `/settings` | ❌ | ✅ |
| `POST /api/observations` | ✅ | ✅ |
| `DELETE /api/observations` | ❌ (403) | ✅ |
| `/api/analyst`, `/api/digest`, `/api/seed` | ❌ (403) | ✅ |

Default seed accounts (development only):
- **Nate** — `nate@utahcity.com` (Leader)
- **Aiden** — `aiden@utahcity.com` (Host)

---

## Environment Variables

See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for the complete reference. Copy `.env.example` to `.env.local` to get started.

**Key variables:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `GEMINI_API_KEY` | Google Gemini for extraction + ASR |
| `RESEND_API_KEY` | Email invitations + support relay |
| `AUTH_SECRET` | Session signing secret (**required in production**) |

---

## Tests

```bash
npm test              # Vitest: unit + API-route integration (38 tests)
npm run test:e2e      # Playwright: real-browser capture → digest flow (4 tests)
npm run test:e2e:voice # Playwright: fake-mic WAV → on-device Whisper → transcript (1 test)
npm test              # Vitest: unit + integration (81+ tests)
npm run test:e2e      # Playwright: real-browser capture → dashboard flow
npm run test:e2e:voice # Playwright: fake-mic WAV → on-device Whisper → transcript
```

- **Unit/integration** (`tests/`): heuristic extraction (incl. the word-boundary regression
  that stopped "spa" matching "space"), digest aggregation, adoption/coverage, the file-store
  roundtrip, ontology validation, the `/api/*` route handlers, and `transcribeAudio`
  (unavailable, success, provider-error, and network-failure paths via a mocked provider).
- **E2E** (`e2e/`): boots an isolated, offline app and drives Chromium through typing a
  debrief → "Structure" → asserting the extracted signals, plus the manager and digest pages.
  The mic itself can't be driven headlessly, but the transcription *logic* is unit-tested and
  every downstream step is covered.
Test coverage includes: extraction (LLM + heuristic), evidence matching, digest aggregation, adoption analytics, auth (sessions, tokens, passwords), observation service, ontology validation, API routes, webhook handling, context caching, and transcription pipelines.

> **Production swaps (flagged, not built):** the JSON file store isn't durable on
> serverless filesystems — move to Postgres + a vector index (the Section 7 dual-store).
> And before any segmentation/prediction feature, clear the fair-housing and
> recording-consent review noted in the strategy doc's risk register.
---

## Deployment

The app deploys to **Vercel** with a **Neon** Postgres database and **Resend** for email.

1. Push to `main` → Vercel auto-deploys
2. Set environment variables in Vercel Project Settings
3. Configure DNS (Resend MX records for inbound email)
4. Production URL: `https://utahcity.app`

---

## Project Structure

```
src/
├── app/
│   ├── (capture)/          # Mobile capture route group (/)
│   ├── (leadership)/       # Leadership dashboard routes (/command, /analyst, etc.)
│   ├── api/                # 14 API route handlers
│   ├── login/              # Login page
│   └── setup-account/      # Account activation page
├── components/             # 9 top-level React components
│   └── domain/             # 5 domain-specific components (charts, analyst, etc.)
├── domain/                 # Core types, schemas, vocabularies
├── lib/                    # Utilities, re-exports, on-device whisper client
└── server/
    ├── ai/                 # LLM extraction, transcription, context caching
    ├── analyst/            # RAG analyst service
    ├── analytics/          # Adoption & coverage analytics
    ├── auth/               # Crypto, sessions, user verification
    ├── command/            # Command center view aggregator
    ├── db/migrations/      # SQL migration scripts
    ├── email/              # Resend mailer
    ├── intelligence/       # Command center builder
    ├── reporting/          # Digest rollups & narrative
    ├── repositories/       # Data access (Postgres + file-based)
    └── services/           # Application services
```
