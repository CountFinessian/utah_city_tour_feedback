import { describe, it, expect } from "vitest";
import { HUB_PLATFORMS } from "@/domain/owned-social-status";
import { SETUP_SECTIONS, sectionAnchor } from "@/components/social-setup/sections";
import { CARD_NETWORKS } from "@/components/social-setup/types";

describe("social setup walkthrough sections", () => {
  it("lists the platforms in guide order: TikTok, Meta, YouTube, X, LinkedIn", () => {
    expect(SETUP_SECTIONS.map((s) => s.platform)).toEqual(["tiktok", "meta", "youtube", "x", "linkedin"]);
  });

  it("gives every section a unique, stable anchor", () => {
    const anchors = SETUP_SECTIONS.map((s) => sectionAnchor(s.platform));
    expect(anchors).toEqual(["setup-tiktok", "setup-meta", "setup-youtube", "setup-x", "setup-linkedin"]);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("covers exactly the five hub platforms, each with backfill networks", () => {
    const hub = HUB_PLATFORMS.map((p) => p.platform).sort();
    expect(SETUP_SECTIONS.map((s) => s.platform).sort()).toEqual(hub);
    for (const section of SETUP_SECTIONS) {
      expect(CARD_NETWORKS[section.platform]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
