# API Reference

All API routes are under `/api/`. Authentication is enforced by middleware (`src/middleware.ts`) unless noted as Public.

## Roles and access

Roles are `host` and `leader`.

- **Host**: tour capture only.
- **Leader** ("Leadership"): command, analyst, evidence, settings, the social dashboard, Social Accounts (analytics and the Setup & keys tab), social API keys, inviting hosts and leaders, and removing people from the app.

Leader-only (every leader has these; hosts get `403`):
- Managing social API keys: every method of `/api/owned-social/admin` (save, authorize, disconnect, refresh, test, backfill, status). Non-leaders get `403 "Forbidden: Leadership access required"`.
- Inviting people and changing roles: `POST` and `PATCH /api/auth/invite`. The assignable roles are `host` and `leader`.
- Removing people from the app: `DELETE /api/auth/invite`. A leader cannot remove their own account.

Role freshness: middleware looks up the user's current role in the database (60-second cache) on every request and uses it for the route gates and the `x-user-role` header. A role change applies without re-login. The role in the session cookie is used only when the database cannot be reached. Routes that read the session cookie directly (`/api/auth/*`, `/api/observations` DELETE, `/api/social-pulse/refresh`) also check the current role in the database. A user who no longer exists is refused. An unrecognized stored role, including the retired `admin`, is treated as `host`.


## 1. Authentication

### `POST /api/auth/login`
Authenticates a user and creates a session cookie.
- **Authentication:** Public
- **Service:** `verifyUserCredentials`, `signSessionToken`
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "mypassword"
  }
  ```
- **Response:**
  - `200 OK`: `{ "success": true, "user": { ... }, "redirectTo": "/" }` (Sets `session` cookie)
  - `400 Bad Request`: `{ "error": "Email and password are required." }`
  - `401 Unauthorized`: `{ "error": "Invalid email or password..." }`

### `POST /api/auth/logout`
Clears the user's session cookie.
- **Authentication:** Public (implicitly clears existing session)
- **Request:** None
- **Response:**
  - `200 OK`: `{ "success": true }` (Clears `session` cookie)

### `GET /api/auth/me`
Retrieves the currently authenticated user's profile.
- **Authentication:** Session required
- **Service:** `verifySessionToken`, `findUserByEmail`
- **Request:** None
- **Response:**
  - `200 OK`: `{ "user": { "id": "...", "email": "...", "name": "...", "role": "...", "title": "..." } }`
  - `401 Unauthorized`: `{ "user": null }` or `{ "user": null, "error": "Account revoked" }`

### `GET /api/auth/setup-account`
Verifies an invitation token and returns the invited user's details.
- **Authentication:** Public
- **Service:** `findInvitationByToken`
- **Request Query Params:** `?token=<invitation_token>`
- **Response:**
  - `200 OK`: `{ "email": "...", "name": "...", "role": "...", "title": "..." }`
  - `400 Bad Request`: `{ "error": "Missing invitation token" }` (or expired/claimed)
  - `404 Not Found`: `{ "error": "Invitation link not recognized or invalid." }`

### `POST /api/auth/setup-account`
Claims an invitation and sets a password for the new account.
- **Authentication:** Public
- **Service:** `claimInvitation`, `signSessionToken`
- **Request Body:**
  ```json
  {
    "token": "...",
    "name": "Full Name",
    "firstName": "First",
    "lastName": "Last",
    "password": "newpassword"
  }
  ```
- **Response:**
  - `200 OK`: `{ "success": true, "user": { ... }, "redirectTo": "..." }` (Sets `session` cookie)
  - `400 Bad Request`: `{ "error": "..." }`

### `/api/auth/invite`
Manages user invitations.
- **`GET`** (Public)
  - **Service:** `listAllInvitationsWithStatus`
  - **Response `200 OK`**: `{ "invitations": [ { "email": "...", "name": "...", "role": "...", "claimed": false, "setupUrl": "..." } ] }`
- **`POST`** (Leadership role required: leader)
  - **Service:** `createOrUpdateInvitation`, `sendInvitationEmail`
  - **Request Body**: `{ "email": "...", "role": "host|leader", "name": "...", "title": "..." }`
  - **Response `200 OK`**: `{ "success": true, "setupUrl": "...", "emailSent": true, "invite": { ... } }`
  - **Errors**: `401 Unauthorized` without a session. `403 Forbidden` for non-leadership. `400 Bad Request` if email exists, invalid, or the role is not `host` or `leader`.
- **`PATCH`** (Leadership role required: leader)
  - **Service:** `updateUserRole`
  - **Request Body**: `{ "email": "...", "role": "host|leader" }`
  - **Response `200 OK`**: `{ "success": true, "email": "...", "role": "...", "message": "..." }`
  - **Errors**: `403 Forbidden` if not leadership. `400 Bad Request` if the role is not `host` or `leader`.
- **`DELETE`** (Leadership role required: leader)
  - **Service:** `deleteUserAndInvitation`
  - **Request Query Params / Body**: `?email=...` or `{ "email": "..." }`
  - **Response `200 OK`**: `{ "success": true, "email": "...", "message": "..." }`
  - **Errors**: `403 Forbidden` with `"Forbidden: Only members of Leadership can remove accounts."` for hosts and anonymous callers. `400 Bad Request` if the leader targets their own account.

---

## 2. Observations

### `/api/observations`
Manages observation/evidence records.
- **`GET`** (Public)
  - **Service:** `listObservations`
  - **Response `200 OK`**: `{ "observations": [ ... ] }`
- **`POST`** (Public)
  - **Service:** `createOrRefineObservation`
  - **Request Body**: `CreateObservationInput` schema (JSON)
  - **Response `200 OK`**: `{ "observation": { ... } }`
  - **Errors**: Returns appropriate HTTP status on validation errors.
- **`DELETE`** (Leadership role required: leader)
  - **Service:** `deleteObservation`
  - **Request Query Params / Body**: `?id=...` or `{ "id": "..." }`
  - **Response `200 OK`**: `{ "success": true, "message": "..." }`
  - **Errors**: `401 Unauthorized` or `403 Forbidden` if not a leader, `404 Not Found` if observation does not exist.

---

## 3. Intelligence

### `POST /api/analyst`
Asks the AI analyst a question about the observations.
- **Authentication:** Public
- **Service:** `answerAnalystQuestion`
- **Request Body:**
  ```json
  {
    "question": "What are the most common complaints?"
  }
  ```
- **Response:**
  - `200 OK`: JSON containing the analyst's answer.
  - `400 Bad Request`: `{ "error": "Question is required." }`

### `GET /api/digest`
Generates a leadership digest of recent observations.
- **Authentication:** Public
- **Service:** `getLeadershipDigest`
- **Request:** None
- **Response `200 OK`**: `{ "digest": { ... }, "narrative": "..." }`

---

## 4. Data Management

### `/api/seed`
Manages demo data seeding.
- **`POST`** (Public)
  - **Service:** `loadDemoData`
  - **Response `200 OK`**: `{ "ok": true, ... (seed results) }`
- **`DELETE`** (Public)
  - **Service:** `clearSeedData`
  - **Request Query Params:** `?scope=all` (optional, defaults to 'demo' only)
  - **Response `200 OK`**: `{ "ok": true, ... (clear results) }`

---

## 5. Transcription

### `POST /api/transcribe`
Transcribes an audio file.
- **Authentication:** Public
- **Service:** `transcribeAudio`
- **Request:** `FormData` containing an `audio` Blob.
- **Response:**
  - `200 OK`: Transcription result object.
  - `400 Bad Request`: `{ "error": "No audio provided." }`
  - `502 Bad Gateway`: Transcription service error.
- **Example cURL:**
  ```bash
  curl -X POST -F "audio=@recording.webm" http://localhost:3000/api/transcribe
  ```

---

## 6. System

### `GET /api/status`
Returns the platform status (lightweight health check).
- **Authentication:** Public
- **Service:** `getPlatformStatus`
- **Response `200 OK`**: JSON status object.

---

## 6b. Official Account Connections (leader for keys and analytics; cron separate)

### `GET /api/owned-social/admin`

**Leader only.** Any other caller gets `403 {"error": "Forbidden: Leadership access required"}`. Applies to every method on this route.

Connection status per platform plus `backfill`: per network `{ network, label, postCount, historyComplete, lastRunAt?, lastError?, lastNewPosts?, lastUpdatedPosts? }`. Never returns a secret.

### `POST /api/owned-social/admin`

Body `{ action, platform, ... }` where `action` is `save-credentials`, `create-link`, `refresh`, `disconnect`, `verify`, or `backfill`.

- `backfill` runs the historical backfill now for the platform's networks (`meta` = Facebook and Instagram, `x` = X). Returns `{ ok, outcomes }` where each outcome is `{ network, result: "ok" | "skipped" | "error", newPosts, updatedPosts, historyComplete, detail? }`. X is read with OAuth 1.0a user context and stops at `X_MAX_POSTS_PER_RUN`; hitting the cap is an `ok` outcome whose `detail` says so.

### `GET /api/owned-social/posts`

Leadership (leader) export of backfilled posts, newest first. Query: `network` (`tiktok`, `youtube`, `linkedin`, `facebook`, `instagram`, `x`), `since` (date or ISO 8601), `format` (`json`, default, or `csv`). JSON returns `{ count, posts }`. CSV (up to 50,000 rows) has the columns `network,post_id,published_at,title,url,media_type,duration_sec,views,likes,comments,shares,saves,reach,impressions,clicks,watch_minutes,avg_view_seconds`. Cells that start with `= + - @` are prefixed with an apostrophe to block spreadsheet formula injection.

### `GET /api/owned-social/dashboard`

Leadership (leader) analytics for the official accounts' posts (`src/server/owned-social/dashboard.ts`), over the last 90 days. Returns `{ generatedAt, windowDays, lastUpdatedAt, totals30d, networks, recentPosts, topPosts, weekly }`:

- `networks[]`: per network with posts, views, likes, comments and shares over 30 days, `engagementRate30d` (likes + comments + shares) / views, and `medianViews90d`.
- `recentPosts`: newest 50 across networks, each with `performanceIndex` (views / that network's 90-day median) and `label` (`Above typical` at 1.5 or more, `Typical` from 0.67, `Below typical` under 0.67, `Still growing` under 72 hours old).
- `topPosts`: top 5 by views per network. `weekly`: 13 Monday-start weeks (UTC) of views and post counts per network, by publish date.

Responses are `Cache-Control: no-store`. Hosts get `403`.

### `GET|POST /api/owned-social/cron`

Bearer `CRON_SECRET` required (fails closed in production). Query `mode`:

- `all` (default): renew OAuth connections, then backfill posts.
- `refresh`: renew only.
- `backfill`: backfill only.

Response: `{ ok, outcomes, backfill, alerts }`. `ok` is false when a renewal failed (the workflow fails on that). `alerts` lists the platforms that were emailed, or why not (already alerted within 3 days, no recipients, send failed). Email problems never change the status code.

Returns `{ ok, outcomes, backfill }`. `ok` reflects renewal failures only: backfill errors appear in `backfill` but do not fail the response. Unknown modes return 400.

## 7. Webhooks

### `/api/webhooks/resend`
Handles inbound emails via Resend.
- **`GET`** (Public)
  - **Response `200 OK`**: `{ "status": "active", "service": "...", "forwardTo": "...", ... }`
- **`POST`** (Public - verified via Svix signature)
  - **Service:** Resend API
  - **Request:** JSON payload from Resend with headers (`svix-id`, `svix-timestamp`, `svix-signature`).
  - **Response `200 OK`**: `{ "success": true, ... }` (on successful delivery or relay)
  - **Errors**: `400 Bad Request` on invalid signature/payload, `500 Internal Server Error` on API failure.

### `/api/webhooks/inbound`
Alias for `/api/webhooks/resend`. Re-exports `GET` and `POST`.
