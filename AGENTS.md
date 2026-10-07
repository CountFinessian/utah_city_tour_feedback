# Agent notes — Utah City monorepo

- **Product:** Utah City Host Intelligence (host capture + leadership intelligence). Not a council app.
- **Monorepo root:** this directory (`utah-city`).
- **Web app:** `apps/web` (Next.js). Edit product UI/API here.
- **Apple shell:** `apps/mobile` (Capacitor). Native chrome only; loads production web URL.
- **Do not push** unless Jacob explicitly asks.
- Workspace rules live under `.cursor/rules/` (repo) and may be mirrored at the Cursor workspace (`bedrockDemo/.cursor/rules/`).
- **External / live data:** use the **treg** MCP (`utah-city-intelligence` team) — `catalog_search` → `call`. Do not commit `TREG_TOKEN`.

