@AGENTS.md
# Utah City — Operational Intelligence Platform

> **Read `AGENTS.md` for full project context.** This file is a quick reference for Claude Code.

## Identity
Next.js 16 app (App Router, React 19, TypeScript 5). Captures tour host debriefs, structures them with AI, and rolls data into leadership dashboards. Production: `https://utahcity.app`.

## Rules
- Do NOT deploy or push to production unless the user explicitly asks.
- Keep changes local for testing first.
- This app is lightweight and solves one business problem — data aggregation and insight generation.
- Next.js 16 has breaking changes from your training data. Check `node_modules/next/dist/docs/` before using unfamiliar APIs.

## Key Paths
- Domain types: `src/domain/observation.ts` (Observation, Extraction, ExtractionSchema)
- AI extraction: `src/server/ai/extraction.ts` (generateObject + heuristic fallback)
- Repositories: `src/server/repositories/` (auto-selects Postgres or file-based)
- Auth: `src/server/auth/` + `src/middleware.ts` (HMAC sessions, RBAC)
- API routes: `src/app/api/` (14 endpoints)
- Components: `src/components/` (14 React components)
- Tests: `tests/` (Vitest, 81+ tests)

## Commands
```bash
npm run dev       # Dev server on localhost:3000
npm test          # Run all unit/integration tests
npm run build     # TypeScript + production build
```

## Docs
- `docs/ARCHITECTURE.md` — System architecture
- `docs/API.md` — API reference
- `docs/DATA-MODEL.md` — Domain types & database schema
- `docs/COMPONENTS.md` — React component reference
- `docs/ENVIRONMENT.md` — Environment variables
