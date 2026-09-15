# Utah City Operational Intelligence - Data Model

This document comprehensively outlines the data model underlying the Utah City platform, as derived from the core TypeScript domain definitions, authentication models, and PostgreSQL schemas.

## 1. Core Types

### Observation

The central data record representing a single tour/leasing observation. Found in [`src/domain/observation.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/domain/observation.ts).

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Unique identifier for the observation |
| `createdAt` | `string` | ISO timestamp of creation |
| `source` | `"live" \| "demo"` | Indicates whether this was a real tour or a demo |
| `hostName` | `string?` | Name of the person hosting the tour (optional) |
| `floorPlan` | `string?` | Specific floor plan shown (optional) |
| `prospectTag` | `string?` | Custom tag applied to the prospect (optional) |
| `prospectFirstName` | `string?` | Prospect's first name (optional) |
| `prospectLastName` | `string?` | Prospect's last name (optional) |
| `prospectEmail` | `string?` | Prospect's email (optional) |
| `transcript` | `string` | The raw (or sanitized) conversation transcript |
| `engine` | `"llm" \| "heuristic"` | The extraction engine used to process the transcript |
| `extraction` | `Extraction` | The structured data extracted from the transcript |

### Extraction

The AI-extracted structured data, defined by `ExtractionSchema`.

| Field | Type | Purpose |
| --- | --- | --- |
| `summary` | `string` | One or two neutral sentences recapping the tour and the prospect. |
| `overallSentiment` | `number` | Prospect sentiment: -2 very negative, 0 neutral, +2 very positive. |
| `prospectIntent` | `"hot" \| "warm" \| "cold" \| "unknown"` | Likelihood to lease based on the signals in the debrief. |
| `familyComposition` | `string \| null` | Household makeup if mentioned (e.g. "couple with a dog", "single professional", "family with 2 kids"), otherwise null. |
| `lifestyleSignals` | `string[]` | Lifestyle / preference signals: remote work, fitness, entertaining, pets, commuter, etc. |
| `excitementMoments` | `string[]` | Specific things that visibly excited or delighted the prospect. |
| `hesitationMoments` | `string[]` | Specific things that caused hesitation, concern, or cooling. |
| `questionsAsked` | `string[]` | Questions the prospect asked, normalized to a short canonical form. |
| `objections` | `Objection[]` | Concrete objections or blockers the prospect raised. Details below. |
| `amenities` | `AmenityReaction[]` | Amenities the prospect reacted to, positively or negatively. Details below. |
| `followUpQuestions` | `string[]` | 1-4 questions the host should still answer to complete the picture (coverage gaps). |
| `coverageScore` | `number` | 0-1 estimate of how complete this debrief is. |

#### Nested Extraction Types

**Objection**
- `type`: `ObjectionType` (see Controlled Vocabularies)
- `detail`: `string` - Short, verbatim-grounded description of the objection.
- `severity`: `"low" | "medium" | "high"`

**AmenityReaction**
- `name`: `string` - Amenity name in lowercase snake_case, from the catalog when possible.
- `reaction`: `"positive" | "negative" | "neutral"`
- `detail`: `string`

## 2. Controlled Vocabularies

### Objection Types
14 types of common prospect objections:
- `price` (Price)
- `fees` (Fees)
- `parking` (Parking / Garage)
- `location` (Location)
- `commute` (Commute)
- `noise` (Noise)
- `size_or_layout` (Size / Layout)
- `pet_policy` (Pet Policy)
- `amenities` (Amenities)
- `availability_or_timing` (Availability / Timing)
- `application_or_process` (Application / Process)
- `lease_terms` (Lease Terms)
- `safety` (Safety)
- `other` (Other)

### Amenity Catalog
17 supported amenities:
- `pool` (Pool)
- `fitness_center` (Fitness Center)
- `dog_park` (Dog Park)
- `parking_garage` (Parking / Garage)
- `clubhouse` (Clubhouse)
- `coworking_space` (Coworking Space)
- `rooftop_deck` (Rooftop Deck)
- `package_room` (Package Room)
- `ev_charging` (EV Charging)
- `playground` (Playground)
- `trails` (Trails)
- `retail_dining` (Retail / Dining)
- `security` (Security)
- `spa` (Spa)
- `grilling_area` (Grilling Area)
- `bike_storage` (Bike Storage)
- `concierge` (Concierge)

## 3. User & Auth Types

Found primarily in [`src/server/repositories/user-repository.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/server/repositories/user-repository.ts) and [`src/server/auth/session.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/server/auth/session.ts).

### `UserRole`
`"host" | "leader"`

### `StoredUser`
| Field | Type |
| --- | --- |
| `id` | `string` |
| `email` | `string` |
| `name` | `string` |
| `role` | `UserRole` |
| `title` | `string?` |
| `passwordHash` | `string` |
| `passwordSalt` | `string` |
| `createdAt` | `string` |

### `StoredInvitation`
| Field | Type |
| --- | --- |
| `id` | `string` |
| `email` | `string` |
| `name` | `string?` |
| `role` | `UserRole` |
| `title` | `string?` |
| `token` | `string` |
| `expiresAt` | `string` |
| `claimedAt` | `string? \| null` |
| `createdAt` | `string` |

### `InvitationWithStatus`
Same as `StoredInvitation`, but adds `claimed: boolean` and makes `expiresAt` optional. Used for the UI to represent the status of invites.

### `SessionPayload`
Signed inside the session cookie:
- `id` (string)
- `email` (string)
- `name` (string)
- `role` (UserRole)
- `title` (string?)
- `exp` (number - Unix timestamp in seconds)

### `InvitationTokenPayload`
Signed inside the invitation token:
- `email` (string)
- `role` (UserRole)
- `name` (string?)
- `title` (string?)
- `exp` (number - Unix timestamp in seconds)
- `nonce` (string)

## 4. Database Schema

Current production tables.

### `observations`
| Column | Type | Index |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Primary Key |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | `observations_created_at_idx` (DESC) |
| `source` | `TEXT NOT NULL DEFAULT 'live'` | |
| `host_name` | `TEXT` | |
| `prospect_first_name` | `TEXT` | |
| `prospect_last_name` | `TEXT` | |
| `prospect_email` | `TEXT` | |
| `transcript` | `TEXT NOT NULL` | |
| `engine` | `TEXT NOT NULL` | |
| `extraction` | `JSONB NOT NULL` | |

### `users`
| Column | Type | Index |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Primary Key |
| `email` | `TEXT UNIQUE NOT NULL` | Unique |
| `name` | `TEXT NOT NULL` | |
| `role` | `TEXT NOT NULL` | |
| `title` | `TEXT` | |
| `password_hash` | `TEXT NOT NULL` | |
| `password_salt` | `TEXT NOT NULL` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

Seed Accounts: Nate (`usr_leader_nate`) and Aiden (`usr_host_aiden`).

### `invitations`
| Column | Type | Index |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Primary Key |
| `email` | `TEXT UNIQUE NOT NULL` | Unique |
| `name` | `TEXT` | |
| `role` | `TEXT NOT NULL` | |
| `title` | `TEXT` | |
| `token` | `TEXT UNIQUE NOT NULL` | Unique |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | |
| `claimed_at` | `TIMESTAMPTZ` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

## 5. Platform Schema (Future)

Located in [`src/server/db/migrations/0001_operational_intelligence.sql`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/server/db/migrations/0001_operational_intelligence.sql). The system is generalizing to track interactions across the entire resident lifecycle.

Tables introduced:
- `organizations`, `properties`: Multi-tenant hierarchy.
- `users`: Redefined to link to `organizations`.
- `interactions`: Core record for any engagement (tour debrief, call, email).
- `transcript_artifacts`: Stores raw transcripts for interactions.
- `entities`: Stable nouns (people, units, floor plans) over time.
- `observations_v2`: Versioned extractions tied to an interaction.
- `signals`: Atomic extracted insights (sentiment, intent, objections) tied to entities.
- `operational_events`: Key timeline events.
- `follow_up_tasks`: Actionable tasks created from interactions.
- `recommendations`: System-generated operational recommendations.
- `metric_snapshots`: Aggregated analytics data points.
- `executive_reports`: Generated narrative reports.
- `ai_runs`: Audit trail for LLM prompt executions.

## 6. Helper Functions

Key domain logic utilities.

### [`src/domain/observation.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/domain/observation.ts)
- `labelize(s: string): string`: Converts snake_case strings to Title Case labels.
- `objectionLabel(t: string): string`: Returns a human-readable label for a given objection type, falling back to `labelize()`.
- `amenityLabel(t: string): string`: Returns a human-readable label for a given amenity, falling back to `labelize()`.

### [`src/domain/evidence-matcher.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/domain/evidence-matcher.ts)
- `extractCleanExcerpt(transcript: string, terms: string[]): string`: Extracts clean, concise quote snippets by identifying the local window of maximum semantic density for the requested category/terms bounded by natural discourse markers.
- `matchesTerm(haystack: string, term: string): boolean`: Checks whether a transcript contains a term as a distinct whole word or hyphenated token, preventing false-positive substring matches.
- `buildEvidenceItem(obs: Observation, terms: string[]): EvidenceItem`: Builds an EvidenceItem with clean attribution, summary context as label, and sentence-level verbatim quote as excerpt.

### [`src/domain/sanitize-text.ts`](file:///c:/Users/PC_User/jacob/bedrockDemo/utah_city_tour_feedback_2wktrial/src/domain/sanitize-text.ts)
- `sanitizeTranscript(text: string): string`: Cleans corrupted transcription text (e.g. resolving `\uFFFD` chars in contractions, corrupted em-dashes) and strips parenthetical translation markers ("Translated from Spanish:").
