# AI Analyst post-fix evaluation (2026-11-05)

Evaluates branch `analyst-reliability-fixes` (worktree `utah_city_analyst_fixes`, base `43362e8`, uncommitted) after the first three audit fixes: model timeout and abort, honest fallback, and a richer payload. Nothing was merged or deployed. Follows `docs/audits/ai-analyst-quality-audit-2026-11-05.md` (in the main checkout).

> **Update:** fixes 1 and 2 were then applied, Claude was made the primary model, and all 31 questions were re-run twice. Score 45% → 63–65%, fallbacks 44% → 0%. Three aggregate questions now return confident wrong numbers. The updated verdict is in **Addenda 1 and 2** near the end, and it supersedes the pilot verdict above them.

## Read this first: what was and wasn't tested

| | |
|---|---|
| **Model** | **Claude `claude-sonnet-4-6` via `ANTHROPIC_API_KEY`**, the app's built-in second provider. Production uses **Gemini**, which was not available. Quality, latency and timeout results describe this pipeline on Claude, not production. **Re-run on the production model before relying on these numbers.** |
| **Build** | `npm ci` from the lockfile in the worktree (no symlinks), then `npm run build`: **passed**. |
| **App path** | Built app (`next start`) on `127.0.0.1` only. Signed in as a local throwaway leader. Questions sent as `POST /api/analyst {question}`, exactly as the UI does. |
| **Data** | A read-only snapshot of the **40 production debriefs**, taken via the user's authorised session (approved), served from an isolated local file store. The production DB was never connected. Mutations used **synthetic** data only. |
| **Ground truth** | An independent Python script over the snapshot, using America/Denver dates. It never uses the analyst's output. |
| **Blocked** | **Gemini cached-context path** (needs a Gemini key; also inactive at 40 records, since the corpus is about 18k tokens, below the 32k cache minimum). **Provider-side billing of aborted calls** (no usage console access). |

## Scorecard

Rubric per question: **2** correct and complete; **1** partially correct (right records but a wrong number, overstated claim, or weakly supported citation); **0** wrong, not answered, or fallback. A fallback is honest, but it counts as a quality failure. "E" means exact ground truth; "H" means human judgement against the source records.

| Dimension | Result | Basis |
|---|---|---|
| **Overall (run A, 31 questions)** | **28 / 62 points (45%)**: 11 correct, 6 partial, 14 failed (12 timeouts + 2 unanswerable follow-ups) | E+H |
| Completed answers only (19) | 11 correct, 6 partial, 2 honest declines; **no confidently wrong answer to an exact question** | E+H |
| **Fallback rate** | **22 of 50 model-attempted requests (44%)**; run A alone 12/31 (39%). All were `model_timeout` at 25.0 s. Target was under 5%. | measured |
| Latency (completed) | p50 13.8 s, p90 23.6 s, max 24.9 s; latency ≈ 1.4 s + 26.8 ms × output tokens (r = 0.99), so 25 s ≈ 880 output tokens | measured |
| Simple exact counts and date filters | **8/8 correct when completed** (total, October, Oct 29 in Denver, 7 size/layout, 1 noise, 5 Sundance, 1 parking, 11 fitness) | E |
| Comparisons, rates, denominators | **0/4 exact** (P04 ×2 runs, P15, P25): numerators often right, denominators invented or changed between runs | E |
| Evidence completeness | Exact-set questions: complete in 7/8 (P11 cited one extra, supporting record). Qualitative: P05 omitted 1 relevant record. | E/H |
| Citations support claims | 0 unknown IDs; **32/34 quoted phrases verbatim in a cited record**; 2 misquotes (P11). P06: 3 of 7 citations don't support "walkability". | E (quotes), H |
| Insufficient evidence | 4/4 correct (pool, schools, greeting, single noise record called anecdotal) | E |
| Multi-turn | **0/2.** Follow-ups get an honest "please clarify" (no history is sent), identical across 3 runs. | E |
| Repeatability (3 cold runs) | Completed answers stable: P01, P20, P29 identical citations and counts ×3. **Completion flips** for P04, P15, P19 (sometimes answered, sometimes timed out). | measured |
| Freshness | Delete propagates; **an in-place edit is served stale** from the answer cache (same question). Rewording bypasses it. | measured |
| Fallback wording | 0, 2, 20-match and no-topic cases all consistent (claimed count = evidence = bullets; "8 most recent" only when total > 8) | measured |
| Cancellation | App closes the provider connection at the deadline (5/5 at 3,997–4,001 ms vs a 4 s limit) | measured |

---

## 1. Architecture actually in use

- **Full-corpus context only.** There is no retrieval and no structured query step. Every question sends all records through `toAnalystRecord`, plus all-time digest totals.
- **Measured at a local capture endpoint (no model).** 40/40 production records reach the model with distinct IDs and no truncation (largest transcript 1,518 chars sent in full). The request body is **69.5 KB, about 18.2k input tokens**.
- **Growth** (synthetic, real model):

| Records | Request body | Tokens (in+out) | Latency, short answer | Correct? |
|---|---|---|---|---|
| 40 (prod) | 69.5 KB | ~18.3k + output | 1.8 s (short) to 24.9 s (long) | — |
| 150 | 176 KB | 43,210 | 6.7 s | 2/2 sauna records |
| 400 | 456 KB | 111,672 | 8.4 s | 2/2 sauna records |

  Input size barely moves latency; **output length drives it**. Cost grows linearly: each question re-sends the whole corpus. The code has no truncation guard, so a corpus beyond the model's context window would fail into a `model_error` fallback.
- **Counting is delegated to the model.** Code computes only all-time digest totals (`allTimeMetrics`). Every date-scoped count, comparison and denominator is the model's own arithmetic.

## 2. Counts, denominators, comparisons

| Question | Truth (E) | Answer | Verdict |
|---|---|---|---|
| P01 tours in Oct 2026 | 12 | 12 (×3 runs, same 12 IDs) | exact |
| P02 total | 40 | 40 | exact |
| P29 tours on Oct 29 (Denver) | 2 (both are Oct 30 in UTC) | 2 (×3 runs) | exact; timezone handled |
| P08 size/layout | 7 tours | "7 of the 40", all 7 cited | exact |
| P04 pricing Sep vs Oct | Structured price objections: Sep 0, Oct 2; Oct total 12 | Run A: "4 … out of 13 total October records"; run B: "4 of 10 substantive" | numerator broadened to "budget references"; **denominator wrong and different each run** |
| P15 increasing? | Price objections: 0 before Oct 2026, 2 Oct, 4 Nov | Run C: "1 of 28 earlier vs 6 of 12 recent" | direction right; earlier "1" is a *fees* objection; 28+12 = 40 contradicts its own "6 test records excluded" |
| P25 price + hot | 4 | 5 ("objection or budget constraint") | definition drift |
| P03 / P16 / P28 / P12 / P13 ("most common", "share", "most", "how many hot", average) | size/layout 9 mentions; 18/40; fitness 11; hot 25; 1.2 | **timed out every time** | not evaluable; these are exactly the questions code should count |

**Pattern.** Single-filter counts are reliable. Anything needing a denominator, a rate, or a "most common" ranking either times out or invents its population. The model also excluded "test/blank" records on its own initiative (it found 2–6 depending on the run), which changes denominators between runs.

## 3. Tour date vs capture time

- **Only `createdAt` (capture/submit time) exists.** There is no tour-date field. 6 of 40 transcripts contain relative or explicit date phrases ("yesterday", "on Saturday", …) that could imply a different tour date. The analyst cannot resolve them, and nothing records them.
- **Utah-time boundaries now work.** 6 of 40 debriefs were captured after 17:00 MT, which is the next day in UTC. P29 counted both Oct 29 evening captures correctly in all 3 runs, and the UI repeat agreed.
- **Wording slips.** In P01 and P29 the model correctly says "captured". In P11 and P25 it says "toured Nov 5", and in the synthetic test "toured October 29": capture dates presented as tour dates.
- **What it can answer when tour dates are missing:** "captured in period X" questions, exactly. "Toured on date X" only as a proxy, and the answer should say so.

## 4. Direct vs cached context, permissions, freshness

- **Cached path: BLOCKED.** It is Gemini-only (`getOrSetContextCache` requires a Gemini key) and inactive below about 131k characters anyway. Unit tests confirm both paths now share `toAnalystRecord`, so the record shape and the omitted emails match. Live equivalence is unverified.
- **Permissions:** both paths send **every** record to **every** leader. There is no per-user or per-property scope to differ.
- **Freshness** (real model, synthetic store, normal `POST /api/observations` and `DELETE` path):

| Step | Result |
|---|---|
| Ask "Which debriefs mention the sauna?" | 2 (correct), 6.2 s |
| Edit `syn-020` to add a sauna mention | 200 |
| Same question | **2 (stale), 7 ms from the answer cache** |
| Reworded question | 3 (correct, fresh) |
| Delete `syn-006`, same question | "2 of 39" (correct, fresh) |

  The answer cache's fingerprint (count + newest `createdAt`) misses in-place edits and re-extraction for up to 15 minutes (audit F6, not yet fixed).

## 5. Qualitative review (human judgement against source records)

| Q | Judgement |
|---|---|
| P08 size/layout comments | Accurate per-tour detail; quotes verbatim. **2** |
| P10 noise | Correct single record, called anecdotal; the counter-example ("quietness") is real. **2** |
| P11 Sundance | Correct 5 tours; the 6th citation (resident praise) is legitimate. Two quoted phrases are not verbatim, one of them ("lifestyle value") is invented. **1** |
| P05 walkability | Both explicit records found. Counts an "on-site stores" wish and "Greenline park so close" as walkability ("3 of 40"). **Omits** the explicit "walking space" record that P06 includes. **1** |
| P06 on foot (paraphrase) | "Multiple debriefs confirm…": 3 of 7 citations (e-bikes, "organization of the area", "city-like feel") don't support walkability. Overgeneralises. **1** |
| P17 most-asked questions | Truth: all 11 logged questions are unique. Correctly says explicit questions are sparse, then asserts pricing questions "recur in nearly every tour", which is unsupported. **1** |
| P23 single tour | Complete and faithful. **2** |

No answer contradicted its own cited evidence on a fact. The failure mode is **inflation**: interpretive matches reported as counts, and paraphrases presented as quotes.

## 6. Repeatability (3 cold runs plus 1 warm)

| Q | Run A | Run B | Run C | Warm (after A) |
|---|---|---|---|---|
| P01 count | ✓ 21.8 s | ✓ 21.8 s | ✓ 21.2 s | cache 4 ms |
| P03 most frequent objections | timeout | timeout | timeout | timeout |
| P04 Sep vs Oct | partial | partial (different denominator) | timeout | cache 5 ms |
| P15 increasing | timeout | timeout | partial 24.9 s | timeout |
| P19 fitness (broad) | timeout | ✓ 23.8 s | timeout | ✓ 24.7 s |
| P20 follow-up | clarify | clarify | clarify | cache 5 ms |
| P26 why not converting (broad) | timeout | timeout | timeout | timeout |
| P29 date | ✓ 7.4 s | ✓ 7.4 s | ✓ 7.3 s | cache 6 ms |

When an answer completes, its citations and exact counts are stable. Whether it completes is not: any answer near 880 output tokens is a coin flip. Warm-cache repeats return in about 5 ms, but **fallbacks are never cached**, so a timed-out question costs a full 25 s every time.

## 7. Timeout and cancellation

- **Demonstrated (local stub provider, real SDK and HTTP stack):** the app closed the provider socket at 3,997–4,001 ms against a 4,000 ms limit, 5/5 times. The user got a labelled fallback in about 4.0 s.
- **Real provider:** 22 requests ended with `ModelTimeoutError` at 25,002–25,021 ms, each with exactly one attempt (Anthropic config has one model, so no second wait). The app aborts its HTTP request at that point.
- **Not establishable:** whether Anthropic kept generating, or billed input/output, for the 22 aborted requests. Aborted calls return no usage, so **measured usage covers completed calls only**. Measured: **737k tokens** across 34 completed real-model requests (28 prod snapshot, 1 smoke, 2 growth, 3 freshness), plus 1 UI request, background re-extraction after the edit, and 22 aborted calls, none of which are measured.

## 8. Fallback wording

| Case (synthetic, planted) | Truth | Text | Evidence | Bullets |
|---|---|---|---|---|
| Zero match ("elevator") | 0 | "No debriefs contain the words "elevator"" | 0 | 0 |
| Fewer than 8 ("sauna") | 2 | "2 of 40 debriefs…" (no "listed" claim) | 2 | 2 |
| More than 8 ("parking") | 20 | "20 of 40 … The 8 most recent are listed." | 8 | 8 |
| No topic ("total captured") | — | "This question has no topic words to search for" | 0 | 0 |

All 12 production-data fallbacks also had claimed count = evidence = bullets. Remaining wording defects:
- Duplicate terms ("bend" listed twice).
- Date and filler words treated as topics ("last", "days", "one", "host", "ran").
- Synonym expansion (car, garage, spots) isn't disclosed in the "contain the words" list.

UI verified on localhost: the amber banner, the `low` badge, and the latency chip render. The completed-answer view renders, the citation popover links resolve to `/evidence?highlight=<id>`, and the page scrolls to and highlights the right record.

---

## Per-question results (run A, cold, production snapshot, Claude Sonnet 4.6)

L = model answered, F = fallback (timeout). Truth basis: E exact, H human.

| ID | Type | Truth | Result | ms | Score | Basis / note |
|---|---|---|---|---|---|---|
| P01 | count + month | 12 | L: 12, cites the 12 | 21,832 | 2 | E |
| P02 | count | 40 | L: 40 | 2,717 | 2 | E |
| P03 | most common | size/layout 9 (7 tours), price 6 | F (no-topic msg) ×3 runs | 25,014 | 0 | E |
| P04 | comparison | Sep 0 / Oct 2 of 12 | L: "4 of 13" | 22,221 | 1 | E; wrong denominator |
| P05 | qualitative | 2 explicit + 1 "walking space" | L: 3 cited, omits 1 | 13,247 | 1 | H |
| P06 | paraphrase | as P05 | L: 7 cited, 3 unsupported | 18,124 | 1 | H |
| P07 | list | 7 tours | F: 13 keyword matches | 25,025 | 0 | E |
| P08 | quotes | 7 tours | L: 7/7, quotes verbatim | 22,035 | 2 | E+H |
| P09 | property | not captured | F | 25,020 | 0 | E |
| P10 | sparse topic | 1 | L: 1, anecdotal | 10,197 | 2 | E+H |
| P11 | amenity | 5 | L: 5 (+1 resident), 2 misquotes | 17,402 | 1 | E+H |
| P12 | count (intent) | 25 hot | F | 25,010 | 0 | E |
| P13 | average | 1.2 | F | 25,012 | 0 | E |
| P14 | last 7 days | 9 | F | 25,025 | 0 | E |
| P15 | trend | 0 → 2 → 4 | F (partial in run C) | 25,024 | 0 | E |
| P16 | share | 18/40 | F | 25,022 | 0 | E |
| P17 | most-asked | none repeat | L: overgeneralises | 23,645 | 1 | E+H |
| P18 | absent topic | none | L: insufficient | 3,717 | 2 | E |
| P19 | amenity (broad) | 11 (10 pos) | F (✓ in run B) | 25,044 | 0 | E |
| P20 | follow-up | needs history | L: asks to clarify | 5,120 | 0 | E; honest |
| P21 | follow-up + date | needs history | L: asks to restate | 3,076 | 0 | E; honest |
| P22 | greeting | decline | L: decline | 2,077 | 2 | E |
| P23 | single tour | noise, safety, praise | L: faithful | 13,787 | 2 | H |
| P24 | host ranking | Host A, 16 | F | 25,015 | 0 | E |
| P25 | combination | 4 | L: 5 (broadened) | 19,820 | 1 | E |
| P26 | interpretation | — | F ×3 runs | 25,010 | 0 | H |
| P27 | parking | 1 | L: 1 | 10,065 | 2 | E |
| P28 | amenity ranking | fitness 11 | F | 25,021 | 0 | E |
| P29 | Utah-time day | 2 | L: 2 (clock times blanked, see below) | 7,402 | 2 | E |
| P30 | absent topic | none | L: insufficient | 1,834 | 2 | E |
| P31 | P01 lowercased | 12 | cache hit | 5 | 2 | E |

## Highest-impact remaining failures

1. **Long answers time out (44% fallback).** Latency is output-bound (r = 0.99). Broad and "most common" questions (P03, P26, P28) produced answers past about 880 tokens and never completed in 3 tries.
2. **Model-computed denominators.** "4 of 13" vs truth 2 of 12 (P04); "1 of 28 vs 6 of 12" (P15). The numbers change between runs, and they're presented with `high` confidence.
3. **Stale answer after an edit.** Demonstrated live: the cached "2" was served after the source changed to 3.
4. **Clock times erased from answers.** `cleanAnalystText` runs `sanitizeTranscript`, whose timestamp stripper removes "18:07"-style times, so P29 and the UI showed "(capturedAt )".
5. **Follow-ups are unsupported** (0/2), and **interpretive inflation** shows up in qualitative answers (P05, P06, P11, P17).
6. **Test and blank records in the corpus** (the model flagged 2–6) shift denominators unpredictably.

## Smallest fixes, in order

| # | Fix | Addresses | Effort |
|---|---|---|---|
| 1 | Cap answer length: `maxOutputTokens: 600` plus a prompt rule ("≤ 180 words; list at most 8 items, then 'and N more'"). Optionally show partial output via streaming later. | Failure 1. Fit predicts about 17 s at 600 tokens. | 1 h |
| 2 | Stop sanitising model output with the transcript timestamp stripper (apply `sanitizeTranscript` to transcripts only). | Failure 4 | 15 min |
| 3 | Code-computed `AUTHORITATIVE_COUNTS` for the question's Denver range (totals, per-month, per objection/amenity type, intent, any-objection share), reusing `mcp/query/tours.ts`. Prompt: "numbers must come from this block". | Failures 1 (shorter answers) and 2; P03, P12, P13, P16, P24, P28 | 1–2 d |
| 4 | Fix the answer-cache fingerprint to hash `id + engine + extraction + transcript length`. | Failure 3 | 1 h |
| 5 | Prompt: "say 'captured on', never 'toured on'"; quotes must be verbatim or unquoted; separate counted facts from interpretation. Server: flag quotes not found in cited records. | Section 3 wording, P11, P05/P06 | 0.5 d |
| 6 | Send the last 3 turns as history. | Failure 5 (follow-ups) | 0.5–1 d |
| 7 | Mark or remove test/blank records (owner decision on production data). Fallback: dedupe terms, treat date words as non-topics, mention synonyms. | Failure 6, fallback polish | 0.5 d |

## What the team can use now (on this branch, with Claude)

- **Confident:** total counts; counts for one month or one Utah-time day; "which tours mention X" for a single objection or amenity type; a single-tour summary; "is there any evidence about X" (absent topics are declined correctly). Each of these completed under 25 s in testing and matched exact truth.
- **Verify before using:**
  - Any comparison, trend, share or "most common" (often times out; denominators unreliable).
  - Qualitative theme summaries: check the citations; counts there are interpretive.
  - Anything phrased as "toured on".
  - Follow-ups: restate the full question.
  - Anything right after a record was edited (up to 15 minutes stale).

## Ready for a supervised pilot with Kate and Nate?

**Not yet, but close.** The three fixes worked as designed:
- When the analyst answers, simple counts, dates and citations are correct and repeatable.
- Fallbacks are honest and correctly worded.
- Cancellation works.

But 44% of model-attempted questions time out on this model, and comparison answers carry wrong denominators at `high` confidence.

**Recommended gate:** apply fixes 1 and 2 (about an hour), then re-run this 31-question set **on the production model (Gemini)**. Start a supervised pilot when:
- fallback is under 5%,
- exact-count questions score 100%, and
- Kate and Nate get a one-page "use / verify" guide based on the list above.

Fixes 3 and 4 should land before trend or comparison questions are allowed.

## Addendum: re-run after fixes 1 and 2

### What changed on the branch
- **Fix 1, answer length:** every model call now has `maxOutputTokens: 600` (env `ANALYST_MAX_OUTPUT_TOKENS`). A new prompt rule 5 asks for "180 words or fewer… at most 5 short bullets", and the cached-path prompt gets the same limit. `finishReason` is now logged, with a warning when the cap is hit.
- **Fix 2, clock times:** `cleanAnalystText` no longer runs `sanitizeTranscript`, so clock times stay in answers. The shared sanitizer, which social listening also uses, is unchanged.
- **Follow-on fix, a regression found while re-testing:** a first attempt cut P03 off partway through its citation line, which lost its evidence links and showed the raw `CITED_OBSERVATIONS: [...` text. The parser now accepts a list that is cut off or spread across lines, keeps the complete IDs, and always removes the line from the answer.
- **Tests:** 4 new unit tests, 598 total pass; `tsc`, ESLint and `npm run build` are clean.

### Setup
- Same as the main run. A fresh read-only snapshot was taken with approval; it still holds 40 debriefs.
- The independently recomputed ground truth is identical: October 12, Oct 29 = 2, last 7 days 9, size/layout 9 mentions in 7 tours, price 6, hot 25, any objection 18, Host A 16.
- Model `claude-sonnet-4-6`, app built and served on `127.0.0.1`.
- Runs: 31 questions cold (run A′), then the 8-question repeat set cold twice (runs B′ and C′), with a server restart before each.
- An earlier attempt ran out of Anthropic credit after P11. Its partial results were discarded, and everything below comes from the complete re-run.
- Scoring is slightly stricter than in run A: an answer whose headline number is right but whose added breakdown is wrong scores 1, not 2.

### Scorecard: before and after

| Dimension | Run A (before) | Run A′ (after fixes 1 + 2) |
|---|---|---|
| **Overall** | 28 / 62 (45%): 11 correct, 6 partial, 14 failed | **40 / 62 (65%)**: 14 correct, 12 partial, 5 failed |
| **Fallback rate** | 22 of 50 model-attempted (44%), all timeouts | **0 of 46 (0%)** |
| Latency (completed) | p50 13.8 s, p90 23.6 s, max 24.9 s | p50 15.5 s, p90 19.5 s, **max 23.5 s**; 4 of 46 over 20 s |
| Answers hitting the 600-token cap | — | 11 of 46. Mostly cut inside the citation list; all 11 still recovered 6–16 cited IDs. One answer (P14) visibly ends mid-sentence. |
| Prompt length rule (≤ 180 words) | — | 9 of 30 answers over 180 words (max 245). Only partly followed; the token cap is what bounds latency. |
| Clock times kept (fix 2) | "(capturedAt )" | **Confirmed live**: a P29 repeat shows "18:07" and "18:05" |
| Quotes | 32/34 verbatim | Of 45 quotes taken from records, 41 are verbatim in a cited record and 1 is a single word found elsewhere; **3 paraphrases are presented as quotes** (P28 ×1, P26 ×2) |
| Insufficient evidence / greeting | 4/4 | 4/4 (P18, P22, P30, plus P10 called anecdotal) |
| Multi-turn | 0/2, honest clarify | 0/2. **P21 got worse:** it says it lacks context, then makes up an October summary ("13 debriefs", "6 hot, 3 warm"; truth 12, 4 hot, 5 warm). |
| Tokens | 737k across 34 completed | 860k across 46 completed (about 18.7k per request) |

### Per-question results (run A′)

| ID | Type | Truth | Run A′ answer | s | Before → after |
|---|---|---|---|---|---|
| P01 | Oct count | 12 | 12, cites the 12 (×3 runs). The intent breakdown it adds is wrong and contradicts itself | 18.1 | 2 → 1 |
| P02 | total | 40 | 40 | 4.8 | 2 → 2 |
| P03 | most common | size/layout 9 mentions in 7 tours; price 6 | Ranking and the other counts are right; "Size/Layout — 9 debriefs" is wrong (×3 runs) | 19.2 | 0 → 1 |
| P04 | Sep vs Oct | Sep 0 of 5, Oct 2 of 12 | Sep "1 of 3 substantive", Oct "4 of 10" (×3 runs); direction right | 15.3 | 1 → 1 |
| P05 | walkability | 2 explicit + 1 "walking space" | 3 cited, still omits "walking space" | 16.3 | 1 → 1 |
| P06 | paraphrase | as P05 | 4 cited, all supportive, includes "walking space" | 9.0 | 1 → 2 |
| P07 | list | 7 tours | Lists the 7 correctly but heads it "8 of 40" | 22.6 | 0 → 1 |
| P08 | quotes | 9 objections in 7 tours | "9 … across 7 debriefs", cites the 7, quotes verbatim | 15.5 | 2 → 2 |
| P09 | building | not recorded | Says so, then infers from unit numbers (labelled inferential) | 16.3 | 0 → 1 |
| P10 | sparse topic | 1 | 1, anecdotal, counter-example | 9.5 | 2 → 2 |
| P11 | amenity | 5 | 5 (+1 resident), quotes verbatim | 13.7 | 1 → 2 |
| P12 | intent count | 25 hot | 25 | 18.1 | 0 → 2 |
| P13 | average | 1.2 | 1.2 is right; the added distribution is slightly wrong (+2: 16 vs 17; 0: 8 vs 7) | 19.6 | 0 → 1 |
| P14 | last 7 days | **9** | **"12 tours"**; puts two Oct 29 (Denver) captures on Oct 30 | 16.8 | 0 → **0** |
| P15 | trend | price 0 → 2 (Oct) → 4 (Nov) | "6 total, 5 recent; the earlier one (Aug 2025) was fee transparency". All 6 are recent; the Aug record is a fees objection | 15.7 | 0 → 1 |
| P16 | share | **18/40 (45%)** | **"22 of 40 (55%)"** | 19.7 | 0 → **0** |
| P17 | most-asked | 11 questions, none repeat | Again calls pricing the "dominant implicit question" | 12.2 | 1 → 1 |
| P18 | absent | none | insufficient | 3.1 | 2 → 2 |
| P19 | amenity | 11 (10 positive) | 11, 10 positive, cites exactly the 11 (×3 runs) | 16.3 | 0 → 2 |
| P20 | follow-up | needs history | asks to clarify (×3 runs) | 2.8 | 0 → 0 |
| P21 | follow-up + date | needs history | **makes up October figures** after saying it lacks context | 19.3 | 0 → 0 |
| P22 | greeting | decline | decline | 1.7 | 2 → 2 |
| P23 | single tour | noise, safety, praise | faithful | 7.9 | 2 → 2 |
| P24 | host ranking | **Host A, 16** (Host B 10) | **Names Host B first with "13", Host A "12"** | 19.3 | 0 → **0** |
| P25 | combination | 4 | 5 (adds a hot tour that has no price objection) | 15.1 | 1 → 1 |
| P26 | interpretation | — | Reasonable themes, but recycles "9 debriefs" for size/layout; denominator changes between runs (40 → "27 substantive") | 18.1 | 0 → 1 |
| P27 | parking | 1 | 1, framed as a soft preference | 7.4 | 2 → 2 |
| P28 | amenity ranking | fitness 11 | fitness 11 / 10 positive, Sundance 5, clubhouse 4; one paraphrase in quotes | 16.3 | 0 → 1 |
| P29 | Utah-time day | 2 | 2 (×3 runs); clock times kept | 7.5 | 2 → 2 |
| P30 | absent | none | insufficient | 2.1 | 2 → 2 |
| P31 | cache hit | 12 | 12 | 0.004 | 2 → 2 |

### Repeatability (3 cold runs)
- **Stable and correct:** P01 (12), P19 (11 / 10 positive), P29 (2), P20 (clarify).
- **Stable but wrong:** P03 ("9 debriefs" ×3) and P04 ("1 of 3" vs "4 of 10" ×3). Repeating a question does not reveal these errors.
- **Unstable:** P26's denominator (40 in run A′, "27 substantive" in B′ and C′).
- Every question completed in all 3 runs; before, P04, P15 and P19 flipped between answering and timing out.

### What this changes
1. **The timeout problem is solved on this model:** 0 fallbacks in 46 attempts, with the slowest answer at 23.5 s, about 1.5 s of headroom under the 25 s limit. This is still Claude, not production's Gemini.
2. **But the questions that used to time out now complete, and some are confidently wrong.** Every answer carries `high` confidence. Of the six aggregate questions that never completed before (P12, P13, P14, P16, P24, P28), three are now wrong:
   - P14 last 7 days: 12 vs 9;
   - P16 share with an objection: 22/40 vs 18/40;
   - P24 top host: wrong host, wrong count.

   A timeout was visible; a wrong number is not. So **fix 3 (code-computed counts) is now the gate for any count, share, ranking, trend or date-window question.**
3. **Single-topic lookups are reliable:** one objection or amenity type, one day, one tour, and absent topics (P08, P10, P11, P18, P19, P23, P27, P29, P30).
4. **Smaller issues to address with fix 5:** tours vs mentions (P03, P07, P26), paraphrases in quotation marks, and made-up figures on an unanswerable follow-up (P21).

### Updated pilot verdict
**Ready for a narrow supervised pilot. Not yet for count or trend questions.**
- **Allowed in the pilot:**
  - total and per-month counts;
  - single-day counts in Utah time;
  - "which tours mention X";
  - "what did visitors say about X";
  - single-tour summaries;
  - absent-topic checks.
- **Blocked until fix 3 lands:**
  - "how many in the last N days";
  - shares and percentages;
  - rankings ("which host / amenity / objection most");
  - comparisons and trends.
- **Pilot rules:**
  - restate the full question instead of asking a follow-up;
  - check citations before quoting a number in a decision.
- **Still required before relying on these numbers in production:** a re-run on Gemini.

## Addendum 2: Claude as the production model (final code)

### What changed
At the user's request, Claude is now the primary model wherever the app can use it.
- **`llmModel()` and `llmLabel()`:** prefer Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) whenever `ANTHROPIC_API_KEY` is set. Gemini is used when it is the only key. This moves the AI Analyst, debrief extraction, OAG structuring and leadership narratives to Claude.
- **Analyst model order:** the analyst tries Claude first, then Gemini (`llmModelChain()`). A fast error, such as an exhausted credit balance, an outage or a retired model id, now moves on to Gemini instead of serving the keyword fallback. A timeout still stops without a second attempt.
- **Gemini context cache:** used only while Gemini is the primary model.
- **Still on Gemini by design:**
  - Social Pulse relevance (`relevanceModel`);
  - comment classification (`commentClassifyModel`);
  - audio transcription;
  - Social Pulse topic reports (`topic-intelligence.ts` calls `getGoogleModel()` directly). Left unchanged because that file belongs to the social-listening work in progress elsewhere; switching it is a one-line change once that work lands.
- **Model version:** `claude-sonnet-4-6` is kept because it is the model these results measure. Newer Claude models (for example Opus 5.5) reject the `temperature` the app sends, and their always-on thinking would use up the 600-token answer cap. Moving to one needs those two changes and a re-run of this evaluation.
- **Tests:** 6 new tests: provider order, Gemini fallback after a fast Claude error, no fallback after a timeout, and Social Pulse staying on Gemini. 604 tests pass; `tsc`, ESLint and `npm run build` are clean.

### Final re-run on this code (run A″ plus two cold repeats, fresh snapshot, identical ground truth)
The local environment has only the Anthropic key, so this run measures the Claude primary path. The Gemini fallback is covered by unit tests only.

| | Run A (before fixes) | Run A′ (fixes 1 + 2) | **Run A″ (final)** |
|---|---|---|---|
| Score | 28/62 (45%) | 40/62 (65%) | **39/62 (63%)**: 13 correct, 13 partial, 5 failed |
| Fallbacks | 22/50 | 0/46 | **0/46** |
| Latency | p50 13.8 s, max 24.9 s | p50 15.5 s, max 23.5 s | **p50 15.7 s, p90 19.7 s, max 20.5 s** |
| Quotes verbatim in a cited record | 32/34 | 41/45 | 31/37 (5 paraphrases in quotation marks, 1 single word found elsewhere) |
| Clock times | blanked | kept (repeat run) | **kept in the cold run** (P29: "capturedAt 18:07") |

The results match run A′ question for question, apart from three changes:
- **P04 got worse.** "October had only 4 substantive tour debriefs"; the truth is 12, with 10 substantive. The question is still scored 1, but its denominators are now wrong in a different way in each run.
- **P11 lost a point** for a paraphrase shown in quotation marks ("really impressed").
- **P28 lost a point** for "trails: 2" (truth 3); fitness 11/10 and Sundance 5 are exact.

The same confident errors repeat:
- P14, last 7 days: 12 vs 9;
- P16, share with an objection: 22/40 vs 18/40;
- P24, top host: wrong host, "13" vs 16;
- P21, invented October figures (now "14 debriefs").

### Extraction on Claude (live smoke test, two synthetic debriefs, no real data)
- **Works:** both calls used the LLM path with schema-valid output, in 8.8 s and 4.6 s.
- **Labels differ from what a human might choose:**
  - "asked how to apply… move in early December" was rated **warm**, not hot;
  - "the second parking spot fee is a problem" was filed as **fees**, not parking.

  Neither is clearly wrong. Because the analyst counts these labels, debriefs extracted by Claude may be categorised differently from older ones extracted by Gemini. Spot-check the first week of Claude-extracted debriefs.

### Before deploying (owner actions)
1. Add a **funded** `ANTHROPIC_API_KEY` to the Vercel production environment. Keep `GEMINI_API_KEY`: Social Pulse needs it, and it is now the analyst's fallback.
2. Merge `analyst-reliability-fixes` and deploy.
3. Watch the server logs for `[analyst] serving keyword fallback` and `[analyst] answer hit maxOutputTokens` during the first week.

The pilot verdict in Addendum 1 is unchanged: a narrow supervised pilot (single-topic lookups, totals, one month or one day) is fine. Count, share, ranking, trend and date-window questions wait for fix 3.

## Artefacts and cleanup
- The harness (`eval.mjs`, `ground_truth.py`, stub providers, synthetic generator) lived in the session scratchpad, isolated from app code.
- The production snapshots (one per run) and raw answer files were deleted after each run; only redacted figures appear here.
- No production data was modified. No commit, merge or deploy.
