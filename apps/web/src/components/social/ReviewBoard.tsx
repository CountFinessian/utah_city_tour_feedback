"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDot, ExternalLink, History, Inbox, Link2, Plus, RotateCcw, X } from "lucide-react";
import { stripTranscriptTimestamps } from "@/domain/sanitize-text";
import type { IssueView, ReviewBoard, ReviewItem } from "@/server/services/social-issues";

type Action = Record<string, unknown> & { action: string };

async function fetchBoard(): Promise<ReviewBoard> {
  const res = await fetch("/api/social-pulse/issues", { cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load issues");
  return res.json();
}

/** Review board state shared by the Needs review and Open issues tabs, and by comment actions elsewhere. */
export function useReviewBoard() {
  const [board, setBoard] = useState<ReviewBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBoard(await fetchBoard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    }
  }, []);

  const act = useCallback(
    async (action: Action): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch("/api/social-pulse/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Update failed");
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  useEffect(() => {
    let cancelled = false;
    fetchBoard()
      .then((json) => {
        if (cancelled) return;
        setBoard(json);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load issues");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { board, error, busy, refresh, act };
}

export type ReviewBoardState = ReturnType<typeof useReviewBoard>;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function snippet(text: string, max = 90): string {
  const clean = stripTranscriptTimestamps(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const REASON_STYLE: Record<ReviewItem["reason"], string> = {
  question: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  complaint: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  opportunity: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const STATUS_STYLE: Record<IssueView["status"], string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  in_progress: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  resolved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${className}`}>{children}</span>;
}

const inputClass =
  "bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#20d0c3]/60";
const buttonClass =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition disabled:opacity-50";
const primaryButton = `${buttonClass} bg-[#20d0c3]/15 border-[#20d0c3]/40 text-[#20d0c3] hover:bg-[#20d0c3]/25`;
const quietButton = `${buttonClass} bg-white/[0.03] border-white/10 text-slate-300 hover:bg-white/[0.07]`;

/**
 * Create an issue from a comment, or attach the comment to an open issue as a later mention.
 * Used on Needs review, Latest and Priority comments.
 */
export function CommentIssueActions({
  commentId,
  text,
  state,
  extra,
}: {
  commentId: string;
  text: string;
  state: ReviewBoardState;
  extra?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"idle" | "create" | "attach">("idle");
  const [title, setTitle] = useState(() => snippet(text, 80));
  const [owner, setOwner] = useState("");
  const [issueId, setIssueId] = useState("");
  const linked = state.board?.commentIssues[commentId];
  const openIssues = state.board?.openIssues || [];

  if (linked) {
    return (
      <span className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
        <Link2 className="w-3 h-3" />
        In issue: <span className="text-slate-200 font-semibold">{linked.title}</span>
        <Pill className={STATUS_STYLE[linked.status]}>{linked.status.replace("_", " ")}</Pill>
      </span>
    );
  }
  if (mode === "create") {
    return (
      <form
        className="flex flex-wrap items-center gap-2 w-full"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await state.act({ action: "promote", commentId, title, owner: owner || null })) setMode("idle");
        }}
      >
        <input aria-label="Issue title" className={`${inputClass} flex-1 min-w-[200px]`} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input aria-label="Owner" className={`${inputClass} w-36`} placeholder="Owner (e.g. Kate)" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <button type="submit" disabled={state.busy || !title.trim()} className={primaryButton}>
          Create issue
        </button>
        <button type="button" onClick={() => setMode("idle")} className={quietButton}>
          Cancel
        </button>
      </form>
    );
  }
  if (mode === "attach") {
    return (
      <form
        className="flex flex-wrap items-center gap-2 w-full"
        onSubmit={async (event) => {
          event.preventDefault();
          if (issueId && (await state.act({ action: "attach", issueId, commentId }))) setMode("idle");
        }}
      >
        <select aria-label="Open issue" className={`${inputClass} flex-1 min-w-[200px]`} value={issueId} onChange={(e) => setIssueId(e.target.value)} required>
          <option value="">Choose an open issue…</option>
          {openIssues.map((issue) => (
            <option key={issue.id} value={issue.id}>
              {issue.title}
            </option>
          ))}
        </select>
        <button type="submit" disabled={state.busy || !issueId} className={primaryButton}>
          Attach mention
        </button>
        <button type="button" onClick={() => setMode("idle")} className={quietButton}>
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setMode("create")} className={quietButton} disabled={!state.board}>
        <Plus className="w-3 h-3" /> Create issue
      </button>
      {openIssues.length > 0 && (
        <button type="button" onClick={() => setMode("attach")} className={quietButton}>
          <Link2 className="w-3 h-3" /> Add to issue
        </button>
      )}
      {extra}
    </div>
  );
}

export function NeedsReviewPanel({ state }: { state: ReviewBoardState }) {
  const items = state.board?.needsReview || [];
  return (
    <div className="space-y-4">
      <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Inbox className="w-4 h-4 text-[#20d0c3]" />
          Needs review
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Questions, complaints and opportunities from the last 30 days for Kate and Nate. Create an issue when something needs action,
          add it to an existing issue if it is another mention, or mark it reviewed.
        </p>
      </div>
      {state.error && <p className="text-xs text-rose-300">{state.error}</p>}
      {!state.board ? (
        <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="p-12 text-center text-sm text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
          Nothing waiting for review.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.commentId} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <Pill className={REASON_STYLE[item.reason]}>{item.reason}</Pill>
                <span className="font-semibold text-slate-200">@{item.author}</span>
                <span className="capitalize">{item.platform}</span>
                <span>Posted {formatDate(item.postedAt)}</span>
                {item.collectedAt && item.collectedAt.slice(0, 10) !== item.postedAt.slice(0, 10) && (
                  <span className="text-slate-500">collected {formatDate(item.collectedAt)}</span>
                )}
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold">
                    Source <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-sm text-slate-100 leading-relaxed break-words">&quot;{stripTranscriptTimestamps(item.text)}&quot;</p>
              <CommentIssueActions
                commentId={item.commentId}
                text={item.text}
                state={state}
                extra={
                  <>
                    <button type="button" className={quietButton} disabled={state.busy} onClick={() => state.act({ action: "review", commentId: item.commentId, status: "reviewed" })}>
                      <CheckCircle2 className="w-3 h-3" /> Mark reviewed
                    </button>
                    <button type="button" className={quietButton} disabled={state.busy} onClick={() => state.act({ action: "review", commentId: item.commentId, status: "dismissed" })}>
                      <X className="w-3 h-3" /> Dismiss
                    </button>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueCard({ issue, state }: { issue: IssueView; state: ReviewBoardState }) {
  const [owner, setOwner] = useState(issue.owner || "");
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const resolved = issue.status === "resolved";
  return (
    <li className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-3" data-issue-id={issue.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className={STATUS_STYLE[issue.status]}>{issue.status.replace("_", " ")}</Pill>
            <h4 className="text-sm font-bold text-white break-words">{issue.title}</h4>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <div>
              <dt className="inline">Owner: </dt>
              <dd className="inline text-slate-200 font-semibold">{issue.owner || "Unassigned"}</dd>
            </div>
            <div>
              <dt className="inline">Last mention: </dt>
              <dd className="inline text-slate-200 font-semibold">{formatDate(issue.lastMentionAt)}</dd>
            </div>
            <div>
              <dt className="inline">Mentions: </dt>
              <dd className="inline text-slate-200 font-semibold">{issue.mentionCount}</dd>
            </div>
            {issue.source && (
              <div>
                <dt className="inline">Source: </dt>
                <dd className="inline">
                  <a href={issue.source} target="_blank" rel="noopener noreferrer" className="text-[#20d0c3] hover:underline inline-flex items-center gap-1 font-semibold">
                    Latest mention <ExternalLink className="w-3 h-3" />
                  </a>
                </dd>
              </div>
            )}
            {resolved && (
              <div>
                <dt className="inline">Resolved: </dt>
                <dd className="inline text-slate-200 font-semibold">
                  {formatDate(issue.resolvedAt)}
                  {issue.resolvedBy ? ` by ${issue.resolvedBy}` : ""}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          {!resolved && issue.status === "open" && (
            <button type="button" className={quietButton} disabled={state.busy} onClick={() => state.act({ action: "update", issueId: issue.id, status: "in_progress" })}>
              <CircleDot className="w-3 h-3" /> Mark in progress
            </button>
          )}
          {!resolved && (
            <button type="button" className={primaryButton} disabled={state.busy} onClick={() => setResolving((v) => !v)}>
              <CheckCircle2 className="w-3 h-3" /> Resolve
            </button>
          )}
          {resolved && (
            <button type="button" className={quietButton} disabled={state.busy} onClick={() => state.act({ action: "reopen", issueId: issue.id })}>
              <RotateCcw className="w-3 h-3" /> Reopen
            </button>
          )}
        </div>
      </div>

      {resolving && !resolved && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await state.act({ action: "resolve", issueId: issue.id, resolution: resolution || null })) setResolving(false);
          }}
        >
          <input aria-label="Resolution note" className={`${inputClass} flex-1 min-w-[220px]`} placeholder="What was done (optional)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <button type="submit" className={primaryButton} disabled={state.busy}>
            Confirm resolve
          </button>
        </form>
      )}

      {!resolved && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            state.act({ action: "update", issueId: issue.id, owner: owner.trim() || null });
          }}
        >
          <input aria-label="Change owner" className={`${inputClass} w-44`} placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <button type="submit" className={quietButton} disabled={state.busy || (owner.trim() || null) === issue.owner}>
            Set owner
          </button>
        </form>
      )}

      <ul className="space-y-1.5 border-l border-white/10 pl-3">
        {issue.mentions.map((mention) => (
          <li key={mention.commentId} className="text-xs text-slate-300">
            &quot;{snippet(mention.text, 160)}&quot;{" "}
            <span className="text-slate-500">
              @{mention.author} · {mention.platform} · posted {formatDate(mention.postedAt)}
            </span>{" "}
            {mention.url && (
              <a href={mention.url} target="_blank" rel="noopener noreferrer" className="text-[#20d0c3] hover:underline inline-flex items-center gap-0.5">
                link <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="text-[11px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1" onClick={() => setShowHistory((v) => !v)}>
        <History className="w-3 h-3" /> {showHistory ? "Hide history" : `History (${issue.events.length})`}
      </button>
      {showHistory && (
        <ol className="space-y-1 text-[11px] text-slate-400">
          {issue.events.map((e) => (
            <li key={e.id}>
              <span className="text-slate-500">{formatDateTime(e.at)}</span> · {e.detail}
              {e.actor ? ` · ${e.actor}` : ""}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function OpenIssuesPanel({ state }: { state: ReviewBoardState }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = state.board?.openIssues || [];
  const resolved = state.board?.resolvedIssues || [];
  return (
    <div className="space-y-4">
      <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <CircleDot className="w-4 h-4 text-amber-400" />
            Open issues
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            What still needs action, with its owner, status, latest mention and source. Only reviewers create issues; nothing is opened
            automatically.
          </p>
        </div>
        {resolved.length > 0 && (
          <button type="button" className={quietButton} onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        )}
      </div>
      {state.error && <p className="text-xs text-rose-300">{state.error}</p>}
      {!state.board ? (
        <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
      ) : open.length === 0 ? (
        <p className="p-12 text-center text-sm text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
          No open issues. Create one from Needs review, Latest comments or Priority comments.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((issue) => (
            <IssueCard key={`${issue.id}:${issue.updatedAt}`} issue={issue} state={state} />
          ))}
        </ul>
      )}
      {showResolved && resolved.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Resolved</h4>
          <ul className="space-y-3">
            {resolved.map((issue) => (
              <IssueCard key={`${issue.id}:${issue.updatedAt}`} issue={issue} state={state} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
