# Social Pulse operations

How the comment collector runs, how it reports coverage, how it recovers from an outage, and how
reviewers turn comments into tracked issues.

## Schedule and alerts

| What | Where | When (UTC) |
|---|---|---|
| Monitor run (discovery, first reads, due checks) | GitHub Actions `social-pulse-listener.yml` → `/api/social-pulse/cron?mode=monitor` | `17 */6 * * *` requested; in practice GitHub starts about one slot a day (09:00–15:00 UTC) |
| Topic refresh (advisory) | same workflow, after a monitor run | same |
| Watchdog | Vercel cron (`apps/web/vercel.json`) → `/api/social-pulse/cron?mode=watchdog` | `0 15 * * *` (8 AM MST / 9 AM MDT) |

Alerts go through the existing ops mail path (`sendOpsAlertEmail`, Resend) to `SOCIAL_PULSE_ALERT_EMAIL`:

- **failed**: a scheduled monitor run could not reach Treg (rejected key, low balance) or crashed. The
  GitHub job also fails, which emails the workflow owner as before.
- **missed**: a run arrived more than 30 hours after the previous one, so a whole day was skipped.
- **watchdog**: no run in 30 hours, or no successful check in 30 hours (catches GitHub not scheduling at all).
- **recovered**: the first success after an alert.

The same kind of alert repeats at most once a day. State lives in `app_settings.social_listener_health`
(`lastAlert`).

## Coverage facts on the dashboard

The Live Pulse shows three separate facts:

- **Last successful check**: the last scheduled run that reached Treg. A run that finds no new comments
  still counts.
- **Newest comment posted**: the original posting date of the newest collected public comment.
- **Backlog**: new posts not yet read, outage re-checks left, routine checks due, and older posts never
  read (historical backfill).

Activity is counted by posting date, so a comment posted nine days ago and collected today lands in the
week it was posted. While a coverage gap still has unread new posts or outage re-checks, the counts are
labeled provisional. Below five comments in either week, the week-over-week percentage is replaced by
"N comments this week · M last week".

A coverage gap opens when a success follows more than 36 hours without one
(`listener-health.ts`). The Oct 22 – Nov 5 2026 outage predates gap tracking and is recorded as
`KNOWN_COVERAGE_GAP`.

## Catch-up pass

Run from GitHub: Actions → Social Pulse listener → Run workflow → mode `catchup`, or
`gh workflow run social-pulse-listener.yml -f mode=catchup`.

- Same ingestion path as the monitor (first crawl, delta checks, upserts keyed by canonical id), with no
  discovery and no topic refresh, and the scheduled run's cursor left alone.
- Order: unread posts found since the gap began, then posts active within 90 days before it, most
  recently active first. Long-dormant posts and the historical backfill are left to the schedule.
- Bounds: each call stops at 240 s or $0.50 of Treg; the pass stops at $2 total
  (`CATCHUP_PASS_BUDGET_USD`); the workflow makes at most 10 calls.
- Resumable: every post is saved as it is read or checked. Progress is in
  `social_listener_state.cursors.catchUp`; re-running continues with whatever is left.

Each call returns `remaining` (backlog after the call), `pass` (totals so far, including Treg spend) and
`complete`.

## Views

- **Latest comments** (Live Pulse stream): every collected comment on tracked posts in the last 30
  days, newest posting date first. Reactions and official replies are included and labeled.
- **Needs review**: questions, complaints and opportunities from the last 30 days that no one has
  reviewed. Reviewers create an issue, add the comment to an existing issue, mark it reviewed, or dismiss it.
- **Open issues**: issues reviewers created, with owner, status, last mention, mention count and source.
  Resolving moves an issue to the resolved list; it keeps its mentions and full history and can be reopened.
- **Priority comments · History**: the existing importance ranking, unchanged. It is a record to review,
  not a list of unresolved items.
- **External discovery**: open-web conversations for selected narratives. Hidden until it has results (see below).

Issue data: `social_issues`, `social_issue_mentions` (a snapshot of each attached comment),
`social_issue_events` (history) and `social_comment_reviews`. Nothing is deleted.

## External discovery (not enabled)

Topic intelligence can already search beyond Utah City's tracked posts: Google organic results, Google
News, Threads and Google Maps reviews, stored in `social_topic_mentions`, which never enter the comment
totals. `NARRATIVE_PRESETS` (`domain/social-listening/narratives.ts`) define Walkability, FrontRunner
access and Reasons to visit, limited to those web sources.

They are not created, because a topic searches on every scheduled run and that is recurring Treg spend
(searches deduped per 24 hours, capped at $0.75 a refresh; measured about $0.003 per social search and
$0.00015 per web call). The smallest next step is for a leader to POST each preset's `request` to
`/api/social-pulse/topics`. The External discovery tab appears once any of them has results.
