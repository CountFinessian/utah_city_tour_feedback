# Deployment

## Web (Vercel)

In the Vercel project settings:

1. **Root Directory:** `apps/web`
2. **Install Command:** `cd ../.. && npm ci`
3. **Build Command:** `npm run build` (runs in `apps/web` via workspace layout; if needed use `cd ../.. && npm run build -w @utah-city/web`)
4. **Framework Preset:** Next.js

Production URL: https://www.utahcity.app

## Apple (TestFlight / App Store)

Capacitor shell lives in `apps/mobile`. CI: `.github/workflows/deploy-ios.yml`.

```bash
npm run mobile:sync
npm run mobile:open
```

Bundle ID: `com.utahcity.host`

