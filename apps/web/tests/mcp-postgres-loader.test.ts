import { describe, expect, it } from "vitest";
import { loadPostgresCorpus } from "@/server/mcp/corpus/postgres-loader";
import { CORPUS_LIMITS } from "@/server/mcp/corpus/types";
import { NOW, createTestDb, loadTestCorpus } from "./mcp/fixtures";

describe("MCP Postgres loader (PGlite, real SQL)", () => {
  it("loads each dataset with the dashboard scope and maps rows with the app mappers", async () => {
    const { corpus } = await loadTestCorpus();
    expect(corpus.backend).toBe("postgres");
    expect(corpus.tours.status).toBe("available");
    expect(corpus.tours.rows.map((r) => r.id)).toEqual([
      "obs-t1",
      "obs-t6-demo",
      "obs-t2",
      "obs-t3",
      "obs-t7",
      "obs-t4",
      "obs-t5",
    ]);
    // dashboardImportant: relevant posts plus official comment sources with a kept comment; irrelevant excluded.
    expect(corpus.socialPosts.rows.map((p) => p.id).sort()).toEqual(["post-p1", "post-p2"]);
    // dashboardOnly: dropped rows and comments on irrelevant posts excluded.
    const commentIds = corpus.socialComments.rows.map((c) => c.id);
    expect(commentIds).not.toContain("cmt-c5-dropped");
    expect(commentIds).not.toContain("cmt-c8-irrelevant-post");
    expect(commentIds).toContain("cmt-c4-official");
    expect(corpus.officialPosts.rows.map((p) => p.postId)).toEqual(["ig-1", "tt-1"]);
    expect(corpus.topics.rows).toEqual([
      expect.objectContaining({ id: "topic-spooktah", mentionCount: 3, startsOn: "2026-10-01", endsOn: "2026-10-31" }),
    ]);
    expect(corpus.freshness.listenerLastSearchRunAt).toBe(new Date(NOW.getTime() - 2 * 3_600_000).toISOString());
    expect(corpus.freshness.listenerLastMonitorAt).toBe(new Date(NOW.getTime() - 3_600_000).toISOString());
    expect(corpus.freshness.officialMetricsLastCapturedAt).not.toBeNull();
  });

  it("never loads prospect email and scrubs names, emails and phones from free text", async () => {
    const { corpus } = await loadTestCorpus();
    const serialized = JSON.stringify(corpus.tours.rows);
    for (const secret of ["jane.doe@example.com", "raj@example.com", "801-555-1234", "Jane", "Doe", "Raj", "Patel", "Aiden"]) {
      expect(serialized).not.toContain(secret);
    }
    const t1 = corpus.tours.rows.find((r) => r.id === "obs-t1")!;
    expect(t1.transcript).toContain("[name] [name] loved the pool");
    expect(t1.transcript).toContain("[email]");
    expect(t1.transcript).toContain("[phone]");
    expect(t1.extraction.summary).toBe("[name] liked the pool but flagged rent and parking cost.");
    expect(Object.keys(t1)).not.toContain("prospectEmail");
  });

  it("runs every statement read-only: writes through the executor fail", async () => {
    const { exec, db } = await createTestDb();
    await expect(exec("delete from observations")).rejects.toThrow(/read-only transaction/i);
    await expect(exec("insert into social_search_runs (id, query_id, query_text, platform) values ('x','q','t','tiktok')")).rejects.toThrow(
      /read-only transaction/i,
    );
    await expect(exec("create table should_not_exist (id int)")).rejects.toThrow(/read-only transaction/i);
    const count = await db.query<{ n: number }>("select count(*)::int as n from observations");
    expect(count.rows[0].n).toBe(7);
  });

  it("reports missing tables as missing, not as zero", async () => {
    const { exec } = await createTestDb({ schema: false });
    const corpus = await loadPostgresCorpus(exec, NOW);
    for (const ds of [corpus.tours, corpus.socialPosts, corpus.socialComments, corpus.officialPosts, corpus.topics]) {
      expect(ds.status).toBe("missing");
      expect(ds.rows).toEqual([]);
    }
    expect(corpus.freshness.listenerLastSearchRunAt).toBeNull();
  });

  it("reports existing empty tables as empty", async () => {
    const { exec } = await createTestDb({ seed: false });
    const corpus = await loadPostgresCorpus(exec, NOW);
    expect(corpus.tours.status).toBe("empty");
    expect(corpus.socialComments.status).toBe("empty");
    expect(corpus.officialPosts.status).toBe("empty");
  });

  it("marks a dataset truncated when the row cap is hit", async () => {
    const { exec } = await createTestDb();
    const one = (await exec("select * from observations where id = 'obs-t7'"))[0];
    const corpus = await loadPostgresCorpus(async (text, params) => {
      if (text.includes("from observations")) {
        const limit = Number(params?.[0]);
        expect(limit).toBe(CORPUS_LIMITS.tours + 1);
        return Array.from({ length: limit }, (_, i) => ({ ...one, id: `obs-${i}` }));
      }
      return exec(text, params);
    }, NOW);
    expect(corpus.tours.truncated).toBe(true);
    expect(corpus.tours.rows.length).toBe(CORPUS_LIMITS.tours);
    expect(corpus.socialComments.truncated).toBe(false);
  });

  it("hides driver error text", async () => {
    const corpus = await loadPostgresCorpus(async () => {
      throw Object.assign(new Error("password authentication failed for user neondb_owner at ep-secret-host"), { code: "28P01" });
    }, NOW);
    expect(corpus.tours.status).toBe("unavailable");
    expect(corpus.tours.detail).toBe("Read failed (Postgres 28P01).");
    expect(JSON.stringify(corpus)).not.toContain("neondb_owner");
  });
});
