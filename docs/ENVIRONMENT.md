# Environment Variables

All configuration is done through environment variables. For local development, set these in `.env.local` (gitignored). For production (Vercel), set them in **Project Settings → Environment Variables**.

The app is designed to work **with zero configuration** — it will fall back to file-based storage, heuristic extraction, and on-device transcription. Add keys progressively to unlock capabilities.

---

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | No | File store (`.data/`) | Neon Postgres pooled connection string. When set, all data persists to Postgres instead of local JSON files. Also checks `POSTGRES_URL` and `POSTGRES_PRISMA_URL` as fallbacks. |
| `DATA_DIR` | No | `.data` (local) or `$TMPDIR/utahcity-data` (Vercel) | Directory path for local JSON file storage. Only used when no database URL is configured. |

---

## AI / LLM

The app uses a priority cascade — it tries providers in order and falls back gracefully.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | No | — | Google Gemini API key. Primary LLM provider for extraction, narrative generation, and analyst. Also checks `GOOGLE_GENERATIVE_AI_API_KEY`. |
| `GOOGLE_MODEL` | No | `gemini-3.8-flash` | Gemini model identifier. |
| `ANTHROPIC_API_KEY` | No | — | Anthropic Claude API key. Used as secondary LLM provider if no Google key. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Anthropic model identifier. |
| `AI_GATEWAY_API_KEY` | No | — | Vercel AI Gateway credentials. Also checks `VERCEL_OIDC_TOKEN`. |
| `EXTRACTION_MODEL` | No | `anthropic/claude-sonnet-4-6` | AI Gateway model for extraction. |
| `NARRATIVE_MODEL` | No | `anthropic/claude-sonnet-4-6` | AI Gateway model for narrative generation. |

**LLM Priority**: Gemini → Anthropic → AI Gateway → Heuristic (no LLM needed)

---

## Speech-to-Text

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | No | — | OpenAI API key for server-side Whisper transcription. Used as fallback if Gemini multimodal ASR fails. |
| `ASR_MODEL` | No | `whisper-1` | OpenAI speech-to-text model. |
| `NEXT_PUBLIC_WHISPER_MODEL` | No | `Xenova/whisper-base.en` | Browser on-device Transformers.js Whisper model. Downloaded once (~80MB) per browser. No API key needed. |

**ASR Priority**: Gemini Flash multimodal (~800ms) → OpenAI Whisper → On-device WASM Whisper (no server needed)

---

## Email (Resend)

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | No | — | Resend API key for sending invitation emails and handling inbound webhooks. |
| `RESEND_WEBHOOK_SECRET` | No | — | Svix secret for cryptographic webhook signature verification. |
| `EMAIL_FROM` | No | `Utah City <onboarding@utahcity.app>` | Sender address for invitation/onboarding emails. |
| `SUPPORT_FORWARD_EMAIL` | No | `jawoba004@gmail.com` | Inbox where inbound `support@utahcity.app` emails are forwarded. |
| `SUPPORT_FROM_EMAIL` | No | `Utah City Support <support@utahcity.app>` | Sender identity for outbound support relay emails. |

---

## Authentication

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** (production) | Dev fallback | HMAC-SHA256 secret for signing session cookies and invitation tokens. **Must be set in production.** |

---

## Application

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | No | Auto-detected from host header | Canonical origin URL used for invitation setup links and redirects. |
| `WEEKLY_TOUR_TARGET_PER_HOST` | No | `12` | Weekly debrief target per host. Used for coverage calculations in the Operations dashboard. |

