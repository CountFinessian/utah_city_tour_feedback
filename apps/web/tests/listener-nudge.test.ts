import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  LISTENER_NUDGE_CRON,
  LISTENER_NUDGE_SKIP_MS,
  LISTENER_PRIMARY_CRON,
  shouldSkipListenerNudge,
} from "@/domain/social-listening/listener-nudge";

const NOW = Date.parse("2026-10-09T07:47:00.000Z");

describe("listener backup slot", () => {
  it("skips the :47 slot when a scheduled monitor succeeded within 2 hours", () => {
    expect(
      shouldSkipListenerNudge({
        eventName: "schedule",
        schedule: LISTENER_NUDGE_CRON,
        now: NOW,
        recentScheduledSuccessAt: new Date(NOW - 90 * 60 * 1000).toISOString(),
      })
    ).toBe(true);
  });

  it("runs the backup when the last scheduled success is older than 2 hours", () => {
    expect(
      shouldSkipListenerNudge({
        eventName: "schedule",
        schedule: LISTENER_NUDGE_CRON,
        now: NOW,
        recentScheduledSuccessAt: new Date(NOW - LISTENER_NUDGE_SKIP_MS - 60_000).toISOString(),
      })
    ).toBe(false);
  });

  it("does not skip the primary slot or a manual run", () => {
    expect(
      shouldSkipListenerNudge({
        eventName: "schedule",
        schedule: LISTENER_PRIMARY_CRON,
        now: NOW,
        recentScheduledSuccessAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
      })
    ).toBe(false);
    expect(
      shouldSkipListenerNudge({
        eventName: "workflow_dispatch",
        schedule: LISTENER_NUDGE_CRON,
        now: NOW,
        recentScheduledSuccessAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
      })
    ).toBe(false);
    expect(
      shouldSkipListenerNudge({
        eventName: "schedule",
        schedule: LISTENER_NUDGE_CRON,
        now: NOW,
        recentScheduledSuccessAt: null,
      })
    ).toBe(false);
  });

  it("wires the workflow to exit before the production call", () => {
    const listener = readFileSync(path.join(process.cwd(), "../../.github/workflows/social-pulse-listener.yml"), "utf8");
    const skipAt = listener.indexOf("Skip backup slot after a recent scheduled success");
    const curlAt = listener.indexOf("Trigger production listening cycle");
    expect(skipAt).toBeGreaterThan(-1);
    expect(curlAt).toBeGreaterThan(skipAt);
    expect(listener).toContain(`github.event.schedule == '${LISTENER_NUDGE_CRON}'`);
    expect(listener).toContain("event=schedule&status=success");
    expect(listener).toContain("now - 7200");
    expect(listener).toContain("steps.backup.outputs.skip != 'true'");
    expect(listener).toContain("cancel-in-progress: false");
    expect(listener).not.toContain("https://utahcity.app/api/social-pulse/cron");
  });
});
