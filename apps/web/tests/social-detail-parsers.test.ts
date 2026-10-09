import { describe, expect, it } from "vitest";
import { parseFacebookPost, parseFacebookSearch } from "@/server/social/providers/facebook";
import { parseInstagramPost } from "@/server/social/providers/instagram";
import { parseLinkedInPost } from "@/server/social/providers/linkedin";
import { parseRedditSearch } from "@/server/social/providers/reddit";
import { parseTikTokVideo } from "@/server/social/providers/tiktok";
import { parseXPost } from "@/server/social/providers/x";
import { parseYouTubeVideo, selectYouTubeDetail } from "@/server/social/providers/youtube";
import { parseAndNormalizePostIdentifier } from "@/domain/social-listening/deduplication";

describe("detail parsers", () => {
  it("reads TikTok itemStruct and aweme_detail", () => {
    const itemStruct = parseTikTokVideo({
      data: {
        itemInfo: {
          itemStruct: {
            id: "7621280382356360462",
            desc: "Fini Cafe at the Greenline #finicafe",
            author: { uniqueId: "itscarolynh", nickname: "Carolyn", id: "99" },
            challenges: [{ title: "finicafe" }],
          },
        },
      },
    });
    expect(itemStruct?.caption).toContain("Fini Cafe");
    expect(itemStruct?.caption).toContain("#finicafe");
    expect(itemStruct?.authorUsername).toBe("itscarolynh");
    expect(itemStruct?.authorId).toBe("99");

    const aweme = parseTikTokVideo({
      data: {
        aweme_detail: {
          aweme_id: "7636545255524846855",
          desc: "day in salt lake city",
          author: { unique_id: "jorge323.n" },
        },
      },
    });
    expect(aweme?.caption).toBe("day in salt lake city");
    expect(aweme?.authorUsername).toBe("jorge323.n");
  });

  it("reads Instagram edge captions and the owner handle", () => {
    const post = parseInstagramPost({
      data: {
        shortcode: "Cy_oSOOx0Gk",
        owner: { username: "utahcityutah", id: "123" },
        edge_media_to_caption: { edges: [{ node: { text: "Hello from #UtahCity" } }] },
      },
    });
    expect(post?.contentId).toBe("Cy_oSOOx0Gk");
    expect(post?.caption).toBe("Hello from #UtahCity");
    expect(post?.authorUsername).toBe("utahcityutah");
    expect(post?.authorId).toBe("123");
  });

  it("reads YouTube channel handle, channel id, title, and description", () => {
    const video = parseYouTubeVideo({
      data: {
        video_id: "DnQyX-UA7kY",
        title: "Welcome to Utah City",
        description: "A new city in Vineyard",
        author: "Utah City",
        channel_id: "UCwNkAzWu_PJ0DEiVU5NVo9A",
        channel_handle: "@UtahCity",
      },
    });
    expect(video?.title).toBe("Welcome to Utah City");
    expect(video?.description).toBe("A new city in Vineyard");
    expect(video?.caption).toContain("Vineyard");
    expect(video?.authorUsername).toBe("UtahCity");
    expect(video?.channelId).toBe("UCwNkAzWu_PJ0DEiVU5NVo9A");
    expect(video?.authorId).toBe("UCwNkAzWu_PJ0DEiVU5NVo9A");
  });

  it("does not keep an empty YouTube shell over a captioned lookup", () => {
    const shell = parseYouTubeVideo({
      id: "DnQyX-UA7kY",
      url: "https://www.youtube.com/watch?v=",
    });
    expect(shell?.authorUsername).toBe("yt_creator");
    expect(shell?.caption).toBe("");
    expect(shell?.url).toBe("https://www.youtube.com/watch?v=DnQyX-UA7kY");

    const full = parseYouTubeVideo({
      data: {
        video_id: "DnQyX-UA7kY",
        title: "Building the next great city, welcome to Utah City.",
        description: "A master-planned community.",
        author: "Utah City",
        channel_handle: "@UtahCity",
        channel_id: "UCwNkAzWu_PJ0DEiVU5NVo9A",
        url: "https://www.youtube.com/watch?v=",
      },
    });
    expect(selectYouTubeDetail(shell, full)?.authorUsername).toBe("UtahCity");
    expect(selectYouTubeDetail(shell, full)?.caption).toContain("welcome to Utah City");
    expect(selectYouTubeDetail(shell, full)?.url).toBe("https://www.youtube.com/watch?v=DnQyX-UA7kY");
    expect(parseYouTubeVideo({ url: "https://www.youtube.com/watch?v=" })).toBeNull();
    expect(parseAndNormalizePostIdentifier("youtube.com/watch?v=", "youtube")).toBeNull();
  });

  it("reads X text from data and from GraphQL legacy", () => {
    const flat = parseXPost({
      data: {
        id: "1697605773616935075",
        text: "Utah City in Vineyard",
        author: { screen_name: "JeffSpeckFAICP", name: "Jeff Speck" },
      },
    });
    expect(flat?.caption).toBe("Utah City in Vineyard");
    expect(flat?.authorUsername).toBe("JeffSpeckFAICP");

    const graph = parseXPost({
      data: {
        tweetResult: {
          result: {
            rest_id: "2025821503401468189",
            legacy: { full_text: "they paid $500k for the logo" },
            core: { user_results: { result: { rest_id: "55", legacy: { screen_name: "Dacivisualz" } } } },
          },
        },
      },
    });
    expect(graph?.contentId).toBe("2025821503401468189");
    expect(graph?.caption).toBe("they paid $500k for the logo");
    expect(graph?.authorUsername).toBe("Dacivisualz");
    expect(graph?.authorId).toBe("55");
  });

  it("reads Reddit app post details (postTitle and authorInfo)", () => {
    const page = parseRedditSearch({
      data: {
        postsInfoByIds: [
          {
            __typename: "SubredditPost",
            id: "t3_1sxqkyy",
            postTitle: "Here's how the 'urban core' development, Utah City, is shaping up",
            permalink: "/r/DevelopmentSLC/comments/1sxqkyy/heres_how_the_urban_core_development_utah_cit",
            url: "https://www.ksl.com/article/51486539/heres-how-the-urban-core-development-utah-city",
            content: null,
            authorInfo: { id: "t2_1uxfest9fo", name: "slc-urbanite" },
            subreddit: { name: "DevelopmentSLC", title: "Salt Lake City Urban Development" },
          },
        ],
      },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.caption).toContain("Utah City");
    expect(page.items[0]?.authorUsername).toBe("slc-urbanite");
    expect(page.items[0]?.authorId).toBe("t2_1uxfest9fo");
    expect(page.items[0]?.url).toContain("/r/DevelopmentSLC/comments/1sxqkyy/");
  });

  it("reads a Reddit listing title and author", () => {
    const page = parseRedditSearch({
      data: {
        children: [
          {
            kind: "t3",
            data: { name: "t3_1sxqkyy", title: "Utah City", selftext: "Vineyard downtown", author: "resident" },
          },
        ],
      },
    });
    expect(page.items[0]?.title).toBe("Utah City");
    expect(page.items[0]?.caption).toContain("Vineyard downtown");
    expect(page.items[0]?.authorUsername).toBe("resident");
  });

  it("reads a Facebook message under data", () => {
    const post = parseFacebookPost({
      data: {
        post_id: "fb1",
        message: "Come see Utah City",
        from: { name: "Utah City", id: "77" },
        url: "https://www.facebook.com/utahcityutah/posts/fb1",
      },
    });
    expect(post?.caption).toBe("Come see Utah City");
    expect(post?.authorUsername).toBe("Utah City");
    expect(post?.authorId).toBe("77");
  });

  it("drops Facebook keyword hits that are not facebook.com or fb.watch, and undated search hits", () => {
    const page = parseFacebookSearch({
      organic_results: [
        { link: "https://apps.apple.com/us/app/utah-city/id123", title: "Utah City", snippet: "Download" },
        { link: "https://www.apartments.com/vineyard-ut/", title: "Apartments", snippet: "Utah City" },
        { link: "https://www.ksl.com/article/utah-city", title: "KSL", snippet: "Utah City" },
        { link: "https://www.utah.gov/residents", title: "Utah", snippet: "cities" },
        { link: "https://utahcity.com/live", title: "Utah City", snippet: "the development" },
        {
          link: "https://www.instagram.com/popular/what-is-utah-city-utah/",
          title: "What Is Utah City Utah",
          snippet: "What Is Utah City Utah",
        },
        {
          link: "https://www.facebook.com/utahcityutah/posts/111",
          title: "Downtown",
          snippet: "Utah City downtown",
        },
        {
          link: "https://www.facebook.com/utahcityutah/posts/222",
          title: "Dated",
          snippet: "Utah City opening",
          created_at: "2024-06-01T00:00:00.000Z",
        },
        {
          link: "https://fb.watch/utahcityclip/",
          title: "Clip",
          snippet: "Utah City",
          created_at: "2024-06-02T00:00:00.000Z",
        },
      ],
    });
    expect(page.items.map((item) => item.url)).toEqual([
      "https://www.facebook.com/utahcityutah/posts/222",
      "https://fb.watch/utahcityclip/",
    ]);
  });

  it("keeps an official Facebook post that has no publish date", () => {
    const page = parseFacebookSearch(
      {
        posts: [
          {
            post_id: "999",
            message: "Spooky Fest this Friday at Greenline",
            url: "https://www.facebook.com/utahcityutah/posts/999",
          },
        ],
      },
      "utahcityutah"
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.publishedAt).toBeUndefined();
  });

  it("reads LinkedIn commentary under data", () => {
    const post = parseLinkedInPost({
      data: {
        urn: "urn:li:activity:1234567890123",
        commentary: { text: "Building Utah City" },
        author: { name: "Utah City", id: "li-1" },
      },
    });
    expect(post?.caption).toBe("Building Utah City");
    expect(post?.authorUsername).toBe("Utah City");
    expect(post?.authorId).toBe("li-1");
  });
});
