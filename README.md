# Utah City — Host Intelligence

Monorepo for **Utah City Host Intelligence** (tour debriefs → structured signals → leadership dashboards).

> Not a city-council app. The old folder name `utah_city_council_feedback_2wktrial` was a trial codename.

## Apps

| Package | Path | Delivers |
|---|---|---|
| `@utah-city/web` | [`apps/web`](apps/web) | Next.js site + APIs → Vercel (`utahcity.app`) |
| `@utah-city/mobile` | [`apps/mobile`](apps/mobile) | Capacitor iOS shell → TestFlight / App Store |

The iOS app loads the live web app (`https://www.utahcity.app`). One product, two delivery shells.

```
utah-city/
  apps/
    web/       # Next.js 16 — capture + Command / Evidence / Analyst
    mobile/    # Capacitor + Xcode (com.utahcity.host)
  docs/
  package.json # npm workspaces root
```

## Quick start

```bash
npm ci
npm run dev          # web → http://localhost:3000
npm run mobile:sync  # Capacitor iOS sync
```

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Next dev server (`apps/web`) |
| `npm run build` | Production web build |
| `npm test` | Vitest (web) |
| `npm run mobile:sync` | `cap sync ios` |
| `npm run mobile:open` | Open Xcode project |

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Vercel + App Store setup.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system design.

## Local folder name

The git repo directory may still be named `utah_city_tour_feedback_2wktrial` if the IDE has the folder locked. Rename it to `utah-city` when nothing has it open:

```bash
# from bedrockDemo/, with Cursor closed on this folder if needed
ren utah_city_tour_feedback_2wktrial utah-city
```
