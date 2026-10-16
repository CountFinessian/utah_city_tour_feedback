# React Component Reference

This document provides a comprehensive reference for all 14 React components in the Utah City Tour Feedback application.

## Shell & Navigation

### `AppShell`
- **Path:** `src/components/AppShell.tsx`
- **Type:** Client Component
- **Props:** `{ children: React.ReactNode }`
- **Purpose:** Wraps the main application providing a desktop sidebar and a mobile header navigation. Manages user authentication state and session logout.
- **Key State:** `user` (auth state for current session)
- **API Calls:** `GET /api/auth/me`, `POST /api/auth/logout`
- **Child Components:** `CommandPalette`, standard HTML elements, Next.js `<Link>`

### `CommandPalette`
- **Path:** `src/components/domain/CommandPalette.tsx`
- **Type:** Client Component
- **Props:** `None`
- **Purpose:** A global ⌘K search dialog utilizing Radix UI and `cmdk` to provide fast navigation across the platform.
- **Key State:** `open` (controls dialog visibility)
- **API Calls:** None
- **Child Components:** `Dialog.Root`, `Dialog.Trigger`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Command` (from `cmdk`)

## Capture Flow

### `MobileCaptureApp`
- **Path:** `src/components/MobileCaptureApp.tsx`
- **Type:** Client Component
- **Props:** `{ serverAsr?: boolean }`
- **Purpose:** A native-style mobile application interface for tour hosts to quickly record debriefs, review transcripts, and capture prospect context.
- **Key State:** `currentUser`, `hostName`, `transcript`, `result`, `submitting`, `processingIndex`, `answers`, `contextOpen`
- **API Calls:** `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/observations`
- **Child Components:** `Recorder`, `MobileProgress`, `CaptureScreen`, `ReviewScreen`

### `CaptureForm`
- **Path:** `src/components/CaptureForm.tsx`
- **Type:** Client Component
- **Props:** `{ serverAsr?: boolean }`
- **Purpose:** A desktop multi-quadrant capture workspace to record debriefs, edit transcripts, and provide detailed prospect context before AI structuring.
- **Key State:** `hostName`, `transcript`, `result`, `submitting`, `processingIndex`, `answers`, `skipped`
- **API Calls:** `POST /api/observations`
- **Child Components:** `Recorder`, `WorkflowHeader`, `CaptureDraft`, `IntelligenceReview`, `CaptureRail`

### `Recorder`
- **Path:** `src/components/Recorder.tsx`
- **Type:** Client Component
- **Props:** `{ onText: (text: string) => void, serverAsr?: boolean, variant?: "compact" | "card" }`
- **Purpose:** A dual-engine voice recorder capable of utilizing a server-side ASR (via Whisper API) or an on-device Whisper model via WebAssembly.
- **Key State:** `phase` (idle/recording/loading/transcribing), `seconds`, `dlPct`, `note`
- **API Calls:** `POST /api/transcribe`
- **Child Components:** None

## Dashboard & Charts

### `CommandComponents`
- **Path:** `src/components/domain/CommandComponents.tsx`
- **Type:** Client Components (Multi-export)
- **Props:** Varies by component (e.g., `ConfidenceBadge` takes `level`, `score`, `sampleSize`)
- **Purpose:** A library of shared UI components for executive metrics, including `StatusBar`, `MetricTile`, `SignalBar`, `DivergingBar`, `JourneyRail`, `RecommendationCard`, `ConfidenceBadge`, and `DeltaChip`.
- **Key State:** None (Presentational)
- **API Calls:** None
- **Child Components:** `EvidencePopover`

### `CommandCharts`
- **Path:** `src/components/domain/CommandCharts.tsx`
- **Type:** Client Components (Multi-export)
- **Props:** 
  - `SentimentTimeline`: `{ data: { label: string, sentiment: number | null, count: number }[], sampleSize: number }`
  - `IntentFunnelChart`: `{ data: { intent: string, count: number }[], sampleSize: number }`
- **Purpose:** Recharts-based data visualizations showing sentiment shifts over time and an intent funnel breakdown.
- **Key State:** None
- **API Calls:** None
- **Child Components:** Recharts components (`AreaChart`, `BarChart`, `ResponsiveContainer`, etc.)

### `EvidencePopover`
- **Path:** `src/components/domain/EvidencePopover.tsx`
- **Type:** Client Component
- **Props:** `{ count: number, items: EvidenceItem[], label?: string }`
- **Purpose:** A Radix UI popover that displays verbatim quotes backing up AI intelligence claims, providing deep links to source transcripts.
- **Key State:** None (controlled by Radix Popover internal state)
- **API Calls:** None
- **Child Components:** `Popover.Root`, `Popover.Trigger`, `Popover.Portal`, `Popover.Content`

## Intelligence

### `AnalystConsole`
- **Path:** `src/components/domain/AnalystConsole.tsx`
- **Type:** Client Component
- **Props:** `None`
- **Purpose:** A conversational AI Analyst console that leverages One-Shot RAG to synthesize operational questions against the debrief corpus.
- **Key State:** `question`, `messages`, `busy`, `error`
- **API Calls:** `POST /api/analyst`
- **Child Components:** `ConfidenceBadge`, `EvidencePopover`

## Social Accounts

Page at `/social-accounts` (`src/app/(leadership)/social-accounts/page.tsx`, server component). It loads the admin summary, backfill summary, the dashboard and the setup guide markdown, then renders `SocialAccountsHub`.

### `SocialAccountsHub`
- **Path:** `src/components/SocialAccountsHub.tsx`
- **Type:** Client Component
- **Props:** `{ platforms, initialDashboard, dashboardFailed, backfill, guideMarkdown }`
- **Purpose:** Header, a five-platform status strip (Verified / Connected / Needs attention / Not set up), and the tabs Dashboard, Connections and Setup guide. The tab lives in `?tab=`. It defaults to Dashboard once all five platforms are verified, otherwise Connections.
- **Key State:** `platforms` (status, refreshed on tab change and window focus)
- **API Calls:** `GET /api/owned-social/admin`
- **Child Components:** `SocialAccountsDashboard`, `OwnedSocialConnections` (unchanged), `SocialGuideMarkdown`

### `SocialAccountsDashboard`
- **Path:** `src/components/SocialAccountsDashboard.tsx`
- **Type:** Client Component
- **Props:** `{ initial, loadFailed, verifiedCount, totalPlatforms, refreshTargets, backfill, onGoToConnections }`
- **Purpose:** 30-day KPI row, per-network cards, the 13-week views chart, the filterable recent-posts table with performance pills, top posts per network, and the footer with **Refresh data now**. Refresh runs the admin `backfill` action per connected platform in turn, then reloads. Data also reloads on window focus.
- **Key State:** `data`, `filter` (network chip), `progress`, `notice`, `busy`
- **API Calls:** `GET /api/owned-social/dashboard`, `POST /api/owned-social/admin` (`action: "backfill"`)
- **Child Components:** `WeeklyViewsChart` (lazy-loaded)

### `SocialAccountsCharts` / `SocialAccountsChartsLazy`
- **Path:** `src/components/domain/SocialAccountsCharts.tsx`, `src/components/domain/SocialAccountsChartsLazy.tsx`
- **Type:** Client Components (`next/dynamic`, `ssr: false`)
- **Props:** `WeeklyViewsChart({ weekly, networks })`: stacked weekly views, one color per network
- **Purpose:** Recharts bar chart for the weekly series. Lazy-loaded the same way as `CommandChartsLazy`.

### `SocialGuideMarkdown`
- **Path:** `src/components/SocialGuideMarkdown.tsx`
- **Type:** Client Component
- **Props:** `{ markdown: string }`
- **Purpose:** Renders `src/content/social-accounts-guide.md` with `react-markdown` and `remark-gfm`, styled for the dark theme. Fenced code blocks have a Copy button. Raw HTML is not rendered.

## Evidence & Admin

### `KnowledgeExplorer`
- **Path:** `src/components/KnowledgeExplorer.tsx`
- **Type:** Client Component
- **Props:** `{ observations: Observation[] }`
- **Purpose:** A corpus search and filtering interface to explore structured observation records and remove unwanted entries.
- **Key State:** `records`, `query`, `source`, `intent`, `objection`, `amenity`, `confirmDeleteRecord`, `deleting`
- **API Calls:** `DELETE /api/observations`
- **Child Components:** Filter controls (internal helper)

### `CorpusEvidenceManager`
- **Path:** `src/components/CorpusEvidenceManager.tsx`
- **Type:** Client Component
- **Props:** `{ initialObservations: Observation[] }`
- **Purpose:** An administrative table intended for the Settings page that lists evidence records with filters for incomplete items, enabling permanent deletion.
- **Key State:** `observations`, `filterSource`, `onlyIncomplete`, `searchQuery`, `confirmDeleteRecord`, `deleting`
- **API Calls:** `DELETE /api/observations`
- **Child Components:** None

### `InviteManager`
- **Path:** `src/components/InviteManager.tsx`
- **Type:** Client Component
- **Props:** `None`
- **Purpose:** Manages team onboarding by creating, upgrading, or removing host/leadership user accounts via magic link setups.
- **Key State:** `invites`, `email`, `role`, `loading`, `submitting`, `confirmRemoveUser`
- **API Calls:** `GET /api/auth/invite`, `POST /api/auth/invite`, `PATCH /api/auth/invite`, `DELETE /api/auth/invite`
- **Child Components:** None

### `DigestActions`
- **Path:** `src/components/DigestActions.tsx`
- **Type:** Client Component
- **Props:** `{ hasData: boolean }`
- **Purpose:** Provides environment actions to seed demo data, clear demo data, reset the entire corpus, or refresh the page.
- **Key State:** `busy`, `feedback`, `lastRefreshed`
- **API Calls:** `POST /api/seed`, `DELETE /api/seed`
- **Child Components:** None

---

## Component Hierarchy

A simplified tree mapping pages to components:

```text
app/layout.tsx
└── AppShell
    ├── CommandPalette
    └── (Page Content)

app/page.tsx (Index / Capture route)
└── MobileCaptureApp OR CaptureForm
    └── Recorder

app/command/page.tsx (Executive OS)
├── StatusBar
├── CommandCharts (SentimentTimeline, IntentFunnelChart)
├── MetricTile
├── SignalBar
├── DivergingBar
├── RecommendationCard
└── EvidencePopover (used inside metrics/charts)

app/analyst/page.tsx (AI Analyst)
└── AnalystConsole
    ├── ConfidenceBadge
    └── EvidencePopover

app/evidence/page.tsx (Source Corpus)
└── KnowledgeExplorer

app/settings/page.tsx (Team & Admin)
├── InviteManager
├── DigestActions
└── CorpusEvidenceManager
```
