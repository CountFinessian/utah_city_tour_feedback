import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFacebookComments } from "@/server/social/providers/facebook";
import { parseInstagramComments } from "@/server/social/providers/instagram";
import { socialProviders } from "@/server/social/providers";
import { parseRedditComments } from "@/server/social/providers/reddit";
import { parseTikTokSearch, parseTikTokVideo } from "@/server/social/providers/tiktok";
import { parseXPost } from "@/server/social/providers/x";
import { parseYouTubeVideo } from "@/server/social/providers/youtube";
import { tregClient } from "@/server/services/treg-client";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    headers: { get: () => "0" },
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TREG_TOKEN;
  delete process.env.SOCIAL_LISTENING_USE_FIXTURES;
});

describe("social providers", () => {
  it("documents comment ordering for every platform", () => {
    expect(socialProviders.tiktok.commentOrdering).toBe("ranked");
    expect(socialProviders.instagram.commentOrdering).toBe("newest_first");
    expect(socialProviders.youtube.commentOrdering).toBe("newest_first");
    expect(socialProviders.reddit.commentOrdering).toBe("newest_first");
    expect(socialProviders.x.commentOrdering).toBe("newest_first");
    expect(socialProviders.facebook.commentOrdering).toBe("relevance");
    expect(socialProviders.linkedin.commentOrdering).toBe("relevance");
  });

  it("maps X search fields from the anyapi shape and strips TikTok share params", () => {
    const post = parseXPost({
      id: "99",
      text: "Utah City traffic",
      authorUsername: "vineyard_local",
      replyCount: 4,
      likeCount: 8,
      viewCount: 100,
      createdUtc: 1_700_000_000,
    });
    expect(post?.authorUsername).toBe("vineyard_local");
    expect(post?.commentCount).toBe(4);
    expect(post?.likeCount).toBe(8);

    const video = parseTikTokVideo({
      aweme_info: {
        aweme_id: "7621280382356360462",
        desc: "petition",
        share_url: "https://www.tiktok.com/@utahcityutah/video/7621280382356360462?_r=1&u_code=abc",
        author: { unique_id: "utahcityutah" },
        statistics: { comment_count: 12 },
      },
    });
    expect(video?.contentId).toBe("7621280382356360462");
    expect(video?.url).not.toContain("_r=");
    expect(video?.commentCount).toBe(12);
  });

  it("maps YouTube web search videos, including abbreviated view counts", () => {
    const video = parseYouTubeVideo({
      video_id: "abcdefghijk",
      title: "Utah City tour",
      view_count: "24M views",
      published_time: "2 days ago",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      author: "Utah City",
    });
    expect(video?.contentId).toBe("abcdefghijk");
    expect(video?.viewCount).toBe(24_000_000);
    expect(video?.publishedAt).toBeUndefined();
    expect(video?.authorUsername).toBe("Utah City");
  });

  it("pages TikTok keyword search and does not call the routed page-1 tool", async () => {
    process.env.TREG_TOKEN = "test-token";
    process.env.SOCIAL_LISTENING_USE_FIXTURES = "false";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        const first = calls.length === 1;
        return jsonResponse({
          output: {
            data: {
              cursor: first ? 20 : 40,
              has_more: first ? 1 : 0,
              search_item_list: [
                {
                  aweme_info: {
                    aweme_id: first ? "111" : "222",
                    desc: "Utah City",
                    author: { unique_id: "creator" },
                    statistics: { comment_count: 1 },
                  },
                },
              ],
            },
          },
        });
      })
    );

    const items = await tregClient.searchPlatform("tiktok", "Utah City", 2, "keyword");
    expect(items.map((item) => item.contentId)).toEqual(["111", "222"]);
    expect(calls[0]).toContain("tikhub.tiktok.search.videos");
    expect(calls[0]).toContain("offset=0");
    expect(calls[1]).toContain("offset=20");
    expect(calls.some((url) => url.includes("treg.tiktok.search.videos"))).toBe(false);
    expect(parseTikTokSearch({ data: { search_item_list: [], has_more: false } }).done).toBe(true);
  });

  it("asks Reddit for newest comments with a t3_ fullname and skips reply calls that have no cursor", async () => {
    process.env.TREG_TOKEN = "test-token";
    process.env.SOCIAL_LISTENING_USE_FIXTURES = "false";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse({
          output: {
            comments: [{ kind: "t1", data: { id: "c1", body: "no parking downtown", author: "neighbor", score: 3 } }],
          },
        });
      })
    );

    const page = await tregClient.getCommentPage({ platform: "reddit", contentId: "abc123", phase: "comments" });
    expect(page.comments[0]?.text).toBe("no parking downtown");
    expect(page.provider).toContain("reddit-app-fetch-post-comments");
    expect(calls[0]).toContain("sort_type=NEW");
    expect(calls[0]).toContain("post_id=t3_abc123");

    const replies = await tregClient.getCommentPage({
      platform: "reddit",
      contentId: "abc123",
      phase: "replies",
      replyParentId: "c1",
    });
    expect(replies.done).toBe(true);
    expect(replies.comments).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(parseRedditComments({ comments: [] }).done).toBe(true);
  });

  it("stores Instagram reply parent ids and refuses Facebook replies without feedback tokens", async () => {
    process.env.TREG_TOKEN = "test-token";
    process.env.SOCIAL_LISTENING_USE_FIXTURES = "false";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method || "GET"} ${url} ${init?.body || ""}`);
        return jsonResponse({
          output: {
            data: {
              comments: [{ id: "r1", author: "fan", text: "agree", likes: 1 }],
              nextCursor: "",
            },
          },
        });
      })
    );

    const replies = await tregClient.getCommentPage({
      platform: "instagram",
      contentId: "SHORT",
      url: "https://www.instagram.com/reel/SHORT/",
      phase: "replies",
      replyParentId: "parent-9",
    });
    expect(replies.comments[0]?.parentCommentId).toBe("parent-9");
    expect(calls[0]).toContain("anyapi.instagram.comment_replies");
    expect(calls[0]).toContain("parent-9");

    const mapped = parseInstagramComments(
      { data: { comments: [{ id: "top", text: "hi", author: "a" }] } }
    );
    expect(mapped.comments[0]?.parentCommentId).toBeUndefined();

    const fb = parseFacebookComments({
      comments: [{ id: "f1", text: "love this", author: { name: "Ada" }, feedback_id: "fb1", expansion_token: "tok", reply_count: 2 }],
    });
    expect(fb.comments[0]?.feedbackId).toBe("fb1");
    expect(fb.comments[0]?.expansionToken).toBe("tok");

    const blocked = await tregClient.getCommentPage({
      platform: "facebook",
      contentId: "999",
      phase: "replies",
      replyParentId: "f1",
    });
    expect(blocked.comments).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
