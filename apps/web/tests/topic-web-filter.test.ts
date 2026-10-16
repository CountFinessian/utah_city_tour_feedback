import { describe, expect, it } from "vitest";
import { isSocialPlatformUrl, matchesTopicOnWeb, SPOOKTAH_CITY_TOPIC } from "@/domain/social-listening/topics";
import { acceptWebMention } from "@/server/services/topic-web-search";

const topic = SPOOKTAH_CITY_TOPIC;

// Cases taken from the first production wide-net refresh (2026-10-16).
describe("open-web topic filter", () => {
  it("rejects generic event words without a Utah City anchor", () => {
    expect(matchesTopicOnWeb("Canine costume contest at Larson Family Winery in Sonoma — pet costume contest", topic)).toBe(false);
    expect(matchesTopicOnWeb("Downtown Farmers Market - Pet Costume Contest. Bring your furry friend!", topic)).toBe(false);
    expect(matchesTopicOnWeb("Spooktah season! Best haunted houses in Salt Lake", topic)).toBe(false);
  });

  it("accepts the full event name or a keyword with an anchor", () => {
    expect(matchesTopicOnWeb("Spooktah City returns this October", topic)).toBe(true);
    expect(matchesTopicOnWeb("Pet costume contest on the Greenline in Vineyard this Friday", topic)).toBe(true);
    expect(matchesTopicOnWeb("Free ghost mini golf at Utah City", topic)).toBe(true);
  });

  it("skips social hosts for web/news but keeps Threads posts", () => {
    expect(isSocialPlatformUrl("https://www.instagram.com/p/DXFkWLriW4I/")).toBe(true);
    expect(isSocialPlatformUrl("https://m.facebook.com/events/123")).toBe(true);
    expect(isSocialPlatformUrl("https://www.ksl.com/article/123")).toBe(false);
    const officialViaGoogle = "Jack picked his pumpkin. Now it's your turn. Spooktah City is taking over the Utah City Greenline!";
    expect(acceptWebMention("web", "https://www.instagram.com/p/abc/", officialViaGoogle, topic)).toBe(false);
    expect(acceptWebMention("news", "https://www.ksl.com/a/1", "Spooktah City draws families to Vineyard", topic)).toBe(true);
    expect(acceptWebMention("threads", "https://www.threads.net/@resident/post/xyz", "spooktah was so fun", topic)).toBe(true);
  });
});
