import { describe, expect, it } from "vitest";
import {
  KNOWN_COVERAGE_GAP,
  alertAfterRun,
  buildListenerHealth,
  nextCoverageGap,
  watchdogAlert,
  type ListenerHealth,
} from "@/server/services/listener-health";
import { buildCoverageStatus, byGapLikelihood, needsGapRecheck, isUnreadNew } from "@/domain/social-listening/coverage";

const HOUR = 3_600_000;
const T = Date.parse("2026-11-10T12:00:00.000Z");
const at = (hoursAgo: number) => new Date(T - hoursAgo * HOUR);
const url = "https://www.utahcity.app/social-pulse";

function health(partial: Partial<ListenerHealth> = {}): ListenerHealth {
  return {
    lastRunAt: at(6).toISOString(),
    lastStopped: "done",
    lastSuccessAt: at(6).toISOString(),
    error: null,
    newComments: 0,
    coverageGap: null,
    lastAlert: null,
    ...partial,
  };
}

describe("listener health and alerts", () => {
  it("a successful check with zero new comments still moves the last successful check", () => {
    const next = buildListenerHealth(health(), { at: at(0), stopped: "done", listened: true, newComments: 0 });
    expect(next.lastSuccessAt).toBe(at(0).toISOString());
    expect(next.error).toBeNull();
  });

  it("opens a coverage gap only when a success follows more than 36 hours without one", () => {
    expect(nextCoverageGap(health(), { at: at(0), listened: true })).toBeNull();
    const after = nextCoverageGap(health({ lastSuccessAt: at(50).toISOString() }), { at: at(0), listened: true });
    expect(after).toEqual({ from: at(50).toISOString(), to: at(0).toISOString() });
    // Records written before gap tracking carry the known Oct 23 – Nov 5 outage forward.
    const legacy = health();
    delete (legacy as Partial<ListenerHealth>).coverageGap;
    expect(nextCoverageGap(legacy, { at: at(0), listened: true })).toEqual(KNOWN_COVERAGE_GAP);
  });

  it("alerts once when a scheduled run fails, then at most daily while it keeps failing", () => {
    const failed = buildListenerHealth(health(), { at: at(0), stopped: "balance", listened: false, error: "TREG_TOKEN was rejected", newComments: 0 });
    const first = alertAfterRun({ previous: health(), health: failed, now: at(0), pulseUrl: url });
    expect(first?.kind).toBe("failed");
    expect(first?.body).toContain("TREG_TOKEN was rejected");
    const alerted = { ...failed, lastAlert: { kind: "failed" as const, sentAt: at(0).toISOString() } };
    const sixHoursLater = buildListenerHealth(alerted, { at: new Date(T + 6 * HOUR), stopped: "balance", listened: false, newComments: 0 });
    expect(alertAfterRun({ previous: alerted, health: sixHoursLater, now: new Date(T + 6 * HOUR), pulseUrl: url })).toBeNull();
    const nextDay = buildListenerHealth(alerted, { at: new Date(T + 25 * HOUR), stopped: "balance", listened: false, newComments: 0 });
    expect(alertAfterRun({ previous: alerted, health: nextDay, now: new Date(T + 25 * HOUR), pulseUrl: url })?.kind).toBe("failed");
  });

  it("alerts when a run arrives after a skipped slot, and announces recovery after an alert", () => {
    // GitHub usually starts one slot a day, so a 27 hour gap is normal and must not alert.
    const daily = health({ lastRunAt: at(27).toISOString(), lastSuccessAt: at(27).toISOString() });
    expect(alertAfterRun({ previous: daily, health: buildListenerHealth(daily, { at: at(0), stopped: "done", listened: true, newComments: 0 }), now: at(0), pulseUrl: url })).toBeNull();

    const previous = health({ lastRunAt: at(31).toISOString(), lastSuccessAt: at(31).toISOString() });
    const now = buildListenerHealth(previous, { at: at(0), stopped: "done", listened: true, newComments: 2 });
    expect(alertAfterRun({ previous, health: now, now: at(0), pulseUrl: url })?.kind).toBe("missed");

    const afterAlert = health({ lastAlert: { kind: "failed", sentAt: at(6).toISOString() }, lastSuccessAt: at(30).toISOString() });
    const recovered = buildListenerHealth(afterAlert, { at: at(0), stopped: "done", listened: true, newComments: 0 });
    expect(alertAfterRun({ previous: afterAlert, health: recovered, now: at(0), pulseUrl: url })?.kind).toBe("recovered");
    expect(alertAfterRun({ previous: health(), health: buildListenerHealth(health(), { at: at(0), stopped: "done", listened: true, newComments: 0 }), now: at(0), pulseUrl: url })).toBeNull();
  });

  it("the daily watchdog catches runs that stopped arriving and days without a success", () => {
    expect(watchdogAlert({ health: health(), now: at(0), pulseUrl: url })).toBeNull();
    expect(watchdogAlert({ health: health({ lastRunAt: at(31).toISOString(), lastSuccessAt: at(31).toISOString() }), now: at(0), pulseUrl: url })?.kind).toBe("missed");
    expect(watchdogAlert({ health: health({ lastSuccessAt: at(32).toISOString(), error: "Treg 401" }), now: at(0), pulseUrl: url })?.kind).toBe("stale");
    expect(watchdogAlert({ health: null, now: at(0), pulseUrl: url })?.kind).toBe("stale");
  });
});

describe("coverage after an outage", () => {
  const gap = { from: at(24 * 14).toISOString(), to: at(2).toISOString() };
  const base = { relevanceStatus: "relevant", firstSeenAt: at(24 * 100).toISOString() };
  const read = { firstFullCrawlCompletedAt: at(24 * 100).toISOString(), lastCommentCheckAt: at(24 * 15).toISOString(), nextCommentCheckAt: at(24 * 14).toISOString() };

  it("classifies unread, outage re-check, overdue and historical posts as separate backlog", () => {
    const posts = [
      { ...base, firstSeenAt: at(24 * 3).toISOString() },
      { ...base },
      { ...base, ...read, lastActivityAt: at(24 * 16).toISOString() },
      { ...base, ...read, lastActivityAt: at(24 * 500).toISOString() },
      { ...base, ...read, lastActivityAt: at(24 * 16).toISOString(), lastCommentCheckAt: at(1).toISOString(), nextCommentCheckAt: at(-5).toISOString() },
      { ...base, relevanceStatus: "rejected" },
    ];
    const status = buildCoverageStatus({ posts, lastSuccessfulCheckAt: at(1).toISOString(), newestCommentPostedAt: at(24 * 10).toISOString(), gap, now: at(0) });
    expect(status.backlog).toEqual({ unreadNew: 1, unreadOlder: 1, gapRechecks: 1, overdueChecks: 1 });
    expect(status.provisional).toBe(true);
    expect(status.provisionalUntil).toBe(gap.to);
    expect(isUnreadNew(posts[0], gap)).toBe(true);
    expect(needsGapRecheck(posts[2], gap)).toBe(true);
    expect(needsGapRecheck(posts[4], gap)).toBe(false);
  });

  it("is final once the outage work is done, and without any gap", () => {
    const posts = [{ ...base, ...read, lastActivityAt: at(24 * 16).toISOString(), lastCommentCheckAt: at(1).toISOString() }];
    expect(buildCoverageStatus({ posts, lastSuccessfulCheckAt: null, newestCommentPostedAt: null, gap, now: at(0) }).provisional).toBe(false);
    expect(buildCoverageStatus({ posts: [{ ...base }], lastSuccessfulCheckAt: null, newestCommentPostedAt: null, gap: null, now: at(0) }).provisional).toBe(false);
  });

  it("orders re-checks by most recent activity", () => {
    const older = { ...base, lastActivityAt: at(24 * 40).toISOString(), commentCount: 500 };
    const newer = { ...base, lastActivityAt: at(24 * 15).toISOString(), commentCount: 1 };
    expect([older, newer].sort(byGapLikelihood)[0]).toBe(newer);
  });
});
