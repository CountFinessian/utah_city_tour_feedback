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
| `GOOGLE_MODEL` | No | `gemini-3.8-flash` | Gemini model for leadership summaries, extraction, and other non-comment calls. |
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
| `OPS_ALERT_EMAIL` | No | `jacob@utahcity.app` | Inbox for operational alert email, including Social Pulse when `SOCIAL_PULSE_ALERT_EMAIL` is unset. |
| `ALERT_EMAIL` | No | — | Second fallback inbox for operational alerts. |

---

## Social Pulse listener

Live listening uses the treg catalog (`utah-city-intelligence` team). Do not commit `TREG_TOKEN`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `TREG_TOKEN` | Yes, for live listening | — | Treg API token. Without it, cron and admin cycles refuse to run. |
| `CRON_SECRET` | No | Open when unset | Bearer secret for `POST /api/social-pulse/cron`. Also accepted as `?key=`. The leadership refresh button does not send this secret. |
| `SOCIAL_LISTENING_CYCLE_BUDGET_USD` | No | `0.5` | Per-cycle treg spend cap. Discovery and comment sync stop at this amount. |
| `SOCIAL_LISTENING_MAX_QUERIES` | No | `8` | Searches per cycle, least-recently-run first, with a slot per platform and Utah City account feeds. |
| `SOCIAL_LISTENING_MAX_COMMENT_POSTS` | No | `5` | Maximum posts whose comments are synced in one cycle. In-progress threads resume first, then brand-account posts. |
| `SOCIAL_LISTENING_MAX_COMMENT_PAGES` | No | `0` | Top-level comment pages per post. `0` keeps going until the provider cursor ends, the deadline, or the spend cap. A positive number finishes the harvest after that many pages. |
| `SOCIAL_LISTENING_MAX_REPLY_PARENTS` | No | `0` | Instagram reply parents to walk. `0` walks every parent seen on harvested pages, still bounded by the deadline and spend cap. |
| `SOCIAL_LISTENING_CYCLE_DEADLINE_MS` | No | `240000` | Stop the cycle this long after it starts and persist the comment cursor. Clamped to `270000` so a run ends before the 300s function limit. |
| `SOCIAL_LISTENING_CLASSIFY_CONCURRENCY` | No | `4` | How many ambiguous-comment model batches run at once (max 8). |
| `SOCIAL_LISTENING_CLASSIFY_BATCH_SIZE` | No | `20` | Ambiguous comments per model call (max 40). Keyword matches, junk, and already-classified wording skip the model. |
| `SOCIAL_LISTENING_CLASSIFY_MODEL` | No | `gemini-2.5-flash-lite` | Gemini model for comment sentiment and topic. Lowest-cost current Flash model with structured output ($0.10 / $0.40 per 1M tokens). Does not change the leadership summary model. |
| `SOCIAL_LISTENING_SYNC_COMMENTS` | No | off | When `true`, discover-mode cycles also sync comments. The comments cron mode syncs regardless. |
| `SOCIAL_LISTENING_USE_FIXTURES` | No | fixtures outside production | `true` forces bundled fixtures. `false` forces live treg even in development. |
| `SOCIAL_LISTENING_ALERTS` | No | on | Set `false` to skip immediate and daily Social Pulse email. |
| `SOCIAL_PULSE_ALERT_EMAIL` | No | `OPS_ALERT_EMAIL` | Inbox for immediate high-signal alerts and the daily digest. Requires `RESEND_API_KEY`. |

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

