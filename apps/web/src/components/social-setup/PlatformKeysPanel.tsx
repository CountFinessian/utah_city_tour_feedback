"use client";

import { AlertCircle, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { CopyField } from "./CopyField";
import { canTest, formatCount, formatDate, formatDateTime, inputCls, STATUS_STYLE, timeAgo } from "./format";
import { CARD_NETWORKS, type VerifyResult } from "./types";
import type { OwnedSocialContext } from "./useOwnedSocial";

function VerifyPanel({ result }: { result: VerifyResult }) {
  const tone = result.ok
    ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-300"
    : "border-red-500/30 bg-red-500/10 text-red-300";
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">{result.ok ? "✓ Working" : "✗ Problem"}</p>
        <p className="text-[10px] text-command-muted">Checked {formatDateTime(result.checkedAt)}</p>
      </div>

      {result.accounts.length > 0 && (
        <ul className="space-y-1">
          {result.accounts.map((a) => (
            <li key={a.network} className="text-[11px] text-command-soft">
              <span className="font-semibold text-command-ink">{a.network}</span>{" "}
              {a.matches ? (
                <span className="text-emerald-300">@{a.foundHandle} ✓</span>
              ) : (
                <span className="text-amber-300">
                  {a.foundHandle ? `Connected to @${a.foundHandle}, expected @${a.expectedHandle}` : `No account found, expected @${a.expectedHandle}`}
                </span>
              )}
              {a.followers !== undefined && <span className="text-command-muted"> · {formatCount(a.followers)} followers</span>}
              {a.postCount !== undefined && <span className="text-command-muted"> · {formatCount(a.postCount)} posts</span>}
            </li>
          ))}
        </ul>
      )}

      {result.error && <p className="text-[11px] text-red-300">{result.error}</p>}
      {result.hint && <p className="text-[11px] text-command-soft">{result.hint}</p>}

      {result.samplePosts.length > 0 && (
        <ul className="divide-y divide-command-border">
          {result.samplePosts.slice(0, 5).map((post) => {
            const metrics = [
              post.views !== undefined ? `${formatCount(post.views)} views` : "",
              post.likes !== undefined ? `${formatCount(post.likes)} likes` : "",
            ].filter(Boolean);
            return (
              <li key={`${post.network}-${post.id}`} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                <span className="text-command-soft truncate max-w-[70%]">
                  {post.title || `${post.network} post`}
                  {post.publishedAt ? <span className="text-command-muted"> · {formatDate(post.publishedAt)}</span> : null}
                </span>
                {metrics.length > 0 && <span className="text-command-muted shrink-0">{metrics.join(" · ")}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const ACTION_BUTTON =
  "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors cursor-pointer disabled:opacity-50";

/**
 * The paste-your-keys box for one platform, rendered under that platform's instructions.
 * Holds everything the platform card used to: key fields, Save, Authorize, Test keys, and a "More" area.
 */
export function PlatformKeysPanel({ platform, ctx }: { platform: string; ctx: OwnedSocialContext }) {
  const { data, busy } = ctx;
  const p = data?.platforms.find((item) => item.platform === platform);

  if (!data || !p) {
    return <p className="text-xs text-command-muted">Loading {platform} keys…</p>;
  }

  const isBusy = (action: string) => busy === `${p.platform}:${action}`;
  const form = ctx.forms[p.platform] ?? {};
  const panelLink = ctx.link?.platform === p.platform ? ctx.link : null;
  const verifyResult = ctx.verify[p.platform];
  const notice = ctx.notice[p.platform];
  const postHistory = (data.backfill ?? []).filter((row) => (CARD_NETWORKS[p.platform] ?? []).includes(row.network));
  const hasForm = Object.values(form).some((v) => v?.trim());
  const st = STATUS_STYLE[p.status];

  return (
    <section aria-label={`${p.label} keys`} className="rounded-xl border-2 border-command-accent/50 bg-command-accent/[0.04] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-command-ink">Paste your keys here</h4>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${st.cls}`}>{st.text}</span>
        </div>
        {p.kind === "oauth" && p.status !== "not_configured" && (
          <button
            type="button"
            onClick={() => ctx.authorizeNow(p)}
            disabled={busy !== null}
            title="Opens the platform's approval page. Sign in as the official Utah City account."
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-accent/40 bg-command-accent/10 text-command-ink hover:border-command-accent transition-colors cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-command-accent" />
            <span>Authorize</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {p.kind === "oauth" && p.appFieldLabels ? (
          <>
            <div>
              <label className="text-[11px] font-medium text-command-soft block mb-1">{p.appFieldLabels.clientId}</label>
              <input type="text" autoComplete="off" value={form.clientId ?? ""} onChange={(e) => ctx.setField(p.platform, "clientId", e.target.value)} placeholder={p.credentialsSaved ? "Saved (enter to replace)" : ""} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-command-soft block mb-1">{p.appFieldLabels.clientSecret}</label>
              <input type="password" autoComplete="off" value={form.clientSecret ?? ""} onChange={(e) => ctx.setField(p.platform, "clientSecret", e.target.value)} placeholder={p.credentialsSaved ? "Saved (enter to replace)" : ""} className={inputCls} />
            </div>
          </>
        ) : (
          p.fields?.map((f) => (
            <div key={f.key}>
              <label className="text-[11px] font-medium text-command-soft block mb-1">
                {f.label}
                {f.optional && <span className="text-command-muted"> (optional)</span>}
              </label>
              <input type={f.secret ? "password" : "text"} autoComplete="off" value={form[f.key] ?? ""} onChange={(e) => ctx.setField(p.platform, f.key, e.target.value)} placeholder={f.set ? "Saved (enter to replace)" : ""} className={inputCls} />
              {f.help && <p className="text-[10px] text-command-muted mt-1">{f.help}</p>}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => ctx.saveKeys(p)}
          disabled={busy !== null || !data.secretConfigured || !hasForm}
          className="btn btn-primary px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          {isBusy("save-credentials") ? "Saving..." : "Save keys"}
        </button>
        <button
          type="button"
          onClick={() => ctx.testKeys(p)}
          disabled={busy !== null || !canTest(p)}
          title={canTest(p) ? "Makes a read-only call to confirm the keys belong to the official account" : "Save keys (or connect the account) first"}
          className={ACTION_BUTTON}
        >
          <ShieldCheck className="h-3.5 w-3.5 text-command-accent" />
          <span>{isBusy("verify") ? "Testing..." : "Test keys"}</span>
        </button>
        {p.kind === "oauth" && p.redirectUri && (
          <span className="text-[11px] text-command-muted">
            Return link registered with {p.label}: <span className="font-mono break-all">{p.redirectUri}</span>
          </span>
        )}
        {notice && <span className="text-[11px] text-command-soft">{notice}</span>}
      </div>

      {verifyResult ? (
        <VerifyPanel result={verifyResult} />
      ) : p.lastVerifySummary ? (
        <p className="text-[11px] text-command-muted">
          Last test {formatDateTime(p.lastVerifiedAt)}: <span className={p.lastVerifyOk ? "text-emerald-300" : "text-red-300"}>{p.lastVerifySummary}</span>
        </p>
      ) : null}

      {p.officialAccounts && p.officialAccounts.length > 0 && (
        <p className="text-[11px] text-command-muted flex flex-wrap gap-x-3 gap-y-1">
          {p.officialAccounts.map((a) => (
            <span key={`${a.network}-${a.handle}`}>
              Expected: <span className="text-command-soft">{a.network} @{a.handle}</span>{" "}
              <a href={a.url} target="_blank" rel="noreferrer" className="text-command-accent hover:underline">
                ↗
              </a>
            </span>
          ))}
        </p>
      )}

      {p.lastError && p.kind === "oauth" && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>Last problem: {p.lastError}</span>
        </p>
      )}

      <details className="group rounded-lg border border-command-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-command-soft hover:text-command-ink">
          More: connect link, refresh, backfill, disconnect
        </summary>
        <div className="space-y-4 border-t border-command-border p-3">
          {p.kind === "oauth" && p.status !== "not_configured" && (
            <div className="space-y-2">
              <p className="text-[11px] text-command-muted">
                Use this when the account owner is someone else. It creates a one-time link to send them.
              </p>
              <button type="button" onClick={() => ctx.makeLink(p)} disabled={busy !== null} className={ACTION_BUTTON}>
                <Link2 className="h-3.5 w-3.5 text-command-accent" />
                <span>{isBusy("create-link") ? "Creating..." : "Create connect link"}</span>
              </button>
              {panelLink && (
                <div className="space-y-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3">
                  <p className="text-[11px] font-semibold text-emerald-300">
                    Send this to the {p.label} account owner. It works once and expires {formatDate(panelLink.expiresAt)}.
                  </p>
                  <CopyField value={panelLink.url} tone="link" />
                </div>
              )}
              {p.linkExpiresAt && !panelLink && (
                <p className="text-[11px] text-command-muted">A connect link is outstanding (expires {formatDate(p.linkExpiresAt)}). Creating a new one cancels it.</p>
              )}
            </div>
          )}

          {(p.accountLabel || p.connectedAt || p.lastRefreshedAt) && (
            <p className="text-[11px] text-command-muted">
              {p.accountLabel ? `Account: ${p.accountLabel}. ` : ""}
              {p.connectedAt ? `Connected ${formatDate(p.connectedAt)}. ` : ""}
              {p.lastRefreshedAt && p.kind === "oauth" ? `Last renewed ${formatDate(p.lastRefreshedAt)}. ` : ""}
              {p.kind === "oauth" && p.renews !== undefined ? (p.renews ? "Renews automatically." : "Cannot renew itself: needs re-approval when it lapses.") : ""}
              {p.status === "reauth_soon" && p.refreshExpiresAt ? ` Re-approval needed by ${formatDate(p.refreshExpiresAt)}.` : ""}
            </p>
          )}

          {p.detectedPageId && <p className="text-[11px] text-command-muted">Facebook Page detected automatically: {p.detectedPageId}</p>}

          <div className="space-y-1.5 rounded-lg border border-command-border p-3">
            <p className="text-[11px] font-semibold text-command-soft">Post history</p>
            {postHistory.map((row) => (
              <div key={row.network} className="text-[11px] text-command-muted">
                <span className="font-semibold text-command-soft">{row.label}:</span>{" "}
                {row.postCount.toLocaleString()} posts ·{" "}
                {row.historyComplete ? <span className="text-emerald-300">full history ✓</span> : "history in progress"}
                {row.lastRunAt ? ` · updated ${timeAgo(row.lastRunAt)}` : " · not run yet"}
                {row.lastError && <span className="block text-amber-300">Last problem: {row.lastError}</span>}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {p.kind === "oauth" && (p.status === "connected" || p.status === "reauth_soon" || p.status === "reauth_needed") && (
              <button type="button" onClick={() => ctx.refreshNow(p)} disabled={busy !== null} className={ACTION_BUTTON}>
                <RefreshCw className="h-3.5 w-3.5 text-command-accent" />
                <span>{isBusy("refresh") ? "Refreshing..." : "Refresh now"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => ctx.backfillNow(p)}
              disabled={busy !== null || !canTest(p)}
              title={canTest(p) ? "Pulls this account's posts and metrics now" : "Save keys (or connect the account) first"}
              className={ACTION_BUTTON}
            >
              <RefreshCw className="h-3.5 w-3.5 text-command-accent" />
              <span>{isBusy("backfill") ? "Backfilling..." : "Run backfill now"}</span>
            </button>
            {(p.credentialsSaved || p.status === "connected") && (
              <button
                type="button"
                onClick={() => ctx.disconnect(p)}
                disabled={busy !== null}
                className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/20 cursor-pointer disabled:opacity-50"
              >
                <Unplug className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
