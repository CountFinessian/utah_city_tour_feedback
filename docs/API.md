# API Reference

All API routes are under `/api/`. Authentication is enforced by middleware (`src/middleware.ts`) unless noted as Public.

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
- **`POST`** (Public)
  - **Service:** `createOrUpdateInvitation`, `sendInvitationEmail`
  - **Request Body**: `{ "email": "...", "role": "host|leader", "name": "...", "title": "..." }`
  - **Response `200 OK`**: `{ "success": true, "setupUrl": "...", "emailSent": true, "invite": { ... } }`
  - **Errors**: `400 Bad Request` if email exists or invalid.
- **`PATCH`** (Leader role required)
  - **Service:** `updateUserRole`
  - **Request Body**: `{ "email": "...", "role": "host|leader" }`
  - **Response `200 OK`**: `{ "success": true, "email": "...", "role": "...", "message": "..." }`
  - **Errors**: `403 Forbidden` if not a leader.
- **`DELETE`** (Leader role required)
  - **Service:** `deleteUserAndInvitation`
  - **Request Query Params / Body**: `?email=...` or `{ "email": "..." }`
  - **Response `200 OK`**: `{ "success": true, "email": "...", "message": "..." }`
  - **Errors**: `403 Forbidden` if not a leader, `400 Bad Request` if deleting own account.

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
- **`DELETE`** (Leader role required)
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
