"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, ShieldCheck, Unplug, AlertCircle } from "lucide-react";

type Field = { key: string; label: string; secret: boolean; set: boolean; optional?: boolean; help?: string };

type VerifiedAccount = {
  network: string;
  expectedHandle: string;
  foundHandle?: string;
  name?: string;
  followers?: number;
  postCount?: number;
  matches: boolean;
};

type SamplePost = {
  network: string;
  id: string;
  title?: string;
  publishedAt?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

type VerifyResult = {
  platform: string;
  ok: boolean;
  checkedAt: string;
  accounts: VerifiedAccount[];
  samplePosts: SamplePost[];
  error?: string;
  hint?: string;
};

type PlatformSummary = {
  platform: string;
  label: string;
  kind: "oauth" | "static";
  status: "not_configured" | "ready_to_connect" | "connected" | "reauth_soon" | "reauth_needed" | "saved" | "incomplete";
  accountLabel?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  connectedAt?: string;
  lastRefreshedAt?: string;
  lastError?: string;
  renews?: boolean;
  redirectUri?: string;
  credentialsSaved: boolean;
  appFieldLabels?: { clientId: string; clientSecret: string };
  fields?: Field[];
  linkExpiresAt?: string;
  lastVerifiedAt?: string;
  lastVerifyOk?: boolean;
  lastVerifySummary?: string;
  officialAccounts?: Array<{ network: string; handle: string; url: string }>;
  detectedPageId?: string;
};

type BackfillRow = {
  network: string;
  label: string;
  postCount: number;
  historyComplete: boolean;
  lastRunAt?: string;
  lastError?: string;
  lastNewPosts?: number;
  lastUpdatedPosts?: number;
};

type BackfillOutcome = {
  network: string;
  result: "ok" | "skipped" | "error";
  newPosts: number;
  updatedPosts: number;
  historyComplete: boolean;
  detail?: string;
};

type Summary = {
  secretConfigured: boolean;
  baseUrl: string;
  platforms: PlatformSummary[];
  backfill?: BackfillRow[];
};

/** Which backfill networks belong to each platform card (Meta covers Facebook and Instagram). */
const CARD_NETWORKS: Record<string, string[]> = {
  tiktok: ["tiktok"],
  youtube: ["youtube"],
  linkedin: ["linkedin"],
  meta: ["facebook", "instagram"],
  x: ["x"],
};

const STATUS_STYLE: Record<PlatformSummary["status"], { text: string; cls: string }> = {
  not_configured: { text: "Keys not saved", cls: "bg-slate-500/10 text-slate-300 border-slate-500/20" },
  incomplete: { text: "Some keys missing", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  ready_to_connect: { text: "Ready: send connect link", cls: "bg-sky-500/10 text-sky-300 border-sky-500/20" },
  connected: { text: "Connected", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  saved: { text: "Keys saved", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  reauth_soon: { text: "Re-approval due soon", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  reauth_needed: { text: "Needs re-approval", cls: "bg-red-500/10 text-red-300 border-red-500/20" },
};

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatCount(n?: number): string {
  return n === undefined ? "" : n.toLocaleString();
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatDate(iso);
}

const inputCls =
  "w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-command-border text-xs text-command-ink placeholder:text-command-muted focus:outline-none focus:border-command-accent";

/** Keys can be tested once they are saved (Meta/X) or the account is connected (OAuth). */
function canTest(p: PlatformSummary): boolean {
  if (p.kind === "static") return p.credentialsSaved;
  return p.status === "connected" || p.status === "reauth_soon";
}

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

export function OwnedSocialConnections() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [link, setLink] = useState<{ platform: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [verify, setVerify] = useState<Record<string, VerifyResult>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owned-social/admin", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Failed to load connections");
        return;
      }
      setError(null);
      setData(json as Summary);
    } catch {
      setError("Network error loading connections");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/owned-social/admin", { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, json: await res.json() }))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          setError(json?.error || "Failed to load connections");
          return;
        }
        setError(null);
        setData(json as Summary);
      })
      .catch(() => {
        if (!cancelled) setError("Network error loading connections");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(platform: string, key: string, value: string) {
    setForms((prev) => ({ ...prev, [platform]: { ...(prev[platform] ?? {}), [key]: value } }));
  }

  async function call(platform: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${platform}:${action}`);
    setNotice((n) => ({ ...n, [platform]: "" }));
    try {
      const res = await fetch("/api/owned-social/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, platform, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice((n) => ({ ...n, [platform]: json?.error || "Request failed" }));
        return null;
      }
      return json as Record<string, unknown>;
    } catch {
      setNotice((n) => ({ ...n, [platform]: "Network error" }));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveKeys(p: PlatformSummary) {
    const values = forms[p.platform] ?? {};
    const body = p.kind === "oauth" ? { clientId: values.clientId, clientSecret: values.clientSecret } : { fields: values };
    const json = await call(p.platform, "save-credentials", body);
    if (json) {
      setForms((prev) => ({ ...prev, [p.platform]: {} }));
      setNotice((n) => ({ ...n, [p.platform]: "Saved (encrypted)." }));
      await load();
    }
  }

  async function makeLink(p: PlatformSummary) {
    const json = await call(p.platform, "create-link");
    if (json && typeof json.url === "string") {
      setLink({ platform: p.platform, url: json.url, expiresAt: String(json.expiresAt ?? "") });
      setCopied(false);
      await load();
    }
  }

  /** For a leader who owns the account: approve it here instead of sending a connect link to someone else. */
  async function authorizeNow(p: PlatformSummary) {
    // Open the tab before the request so the browser treats it as a click, not a blocked pop-up.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const json = await call(p.platform, "create-link");
    if (!tab) return;
    if (json && typeof json.url === "string") {
      tab.location.href = json.url;
      window.addEventListener("focus", () => void load(), { once: true });
    } else {
      tab.close();
    }
  }

  async function refreshNow(p: PlatformSummary) {
    const json = await call(p.platform, "refresh");
    if (json) {
      const outcome = json.outcome as { result?: string; detail?: string } | undefined;
      setNotice((n) => ({ ...n, [p.platform]: outcome?.result === "refreshed" ? "Refreshed." : `Not refreshed: ${outcome?.detail ?? outcome?.result ?? "unknown"}` }));
      await load();
    }
  }

  async function testKeys(p: PlatformSummary) {
    const json = await call(p.platform, "verify");
    if (json && json.result) {
      setVerify((prev) => ({ ...prev, [p.platform]: json.result as VerifyResult }));
      await load();
    }
  }

  async function backfillNow(p: PlatformSummary) {
    const json = await call(p.platform, "backfill");
    if (json && Array.isArray(json.outcomes)) {
      const labels = new Map((data?.backfill ?? []).map((row) => [row.network, row.label]));
      const parts = (json.outcomes as BackfillOutcome[]).map((o) => {
        const label = labels.get(o.network) ?? o.network;
        if (o.result === "ok") return `${label}: ${o.newPosts} new, ${o.updatedPosts} updated${o.detail ? ` (${o.detail})` : ""}`;
        return `${label}: ${o.detail ?? o.result}`;
      });
      setNotice((n) => ({ ...n, [p.platform]: parts.join(" · ") || "Nothing to backfill." }));
      await load();
    }
  }

  async function disconnect(p: PlatformSummary) {
    if (!window.confirm(`Disconnect ${p.label}? ${p.kind === "static" ? "Saved keys will be deleted." : "The connection will be removed; saved app keys are kept."}`)) return;
    const json = await call(p.platform, "disconnect");
    if (json) {
      if (link?.platform === p.platform) setLink(null);
      await load();
    }
  }

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!data) return <p className="text-xs text-command-muted">Loading connections...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a href="/api/owned-social/posts?format=csv" className="text-xs text-command-accent hover:underline">
          Download all posts (CSV)
        </a>
      </div>

      {!data.secretConfigured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          AUTH_SECRET is not set on the server, so keys cannot be stored yet. Set it (or OWNED_SOCIAL_SECRET) and redeploy.
        </div>
      )}

      {data.platforms.map((p) => {
        const st = STATUS_STYLE[p.status];
        const form = forms[p.platform] ?? {};
        const isBusy = (action: string) => busy === `${p.platform}:${action}`;
        return (
          <div key={p.platform} className="rounded-xl border border-command-border bg-white/[0.02] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-command-ink">{p.label}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${st.cls}`}>{st.text}</span>
              </div>
              <div className="flex items-center gap-2">
                {p.kind === "oauth" && p.status !== "not_configured" && (
                  <button
                    type="button"
                    onClick={() => authorizeNow(p)}
                    disabled={busy !== null}
                    title="Opens the platform's approval page. Sign in as the official Utah City account."
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-accent/40 bg-command-accent/10 text-command-ink hover:border-command-accent transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-command-accent" />
                    <span>Authorize</span>
                  </button>
                )}
                {p.kind === "oauth" && p.status !== "not_configured" && (
                  <button
                    type="button"
                    onClick={() => makeLink(p)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Link2 className="h-3.5 w-3.5 text-command-accent" />
                    <span>{isBusy("create-link") ? "Creating..." : "Create connect link"}</span>
                  </button>
                )}
                {p.kind === "oauth" && (p.status === "connected" || p.status === "reauth_soon" || p.status === "reauth_needed") && (
                  <button
                    type="button"
                    onClick={() => refreshNow(p)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-command-accent" />
                    <span>{isBusy("refresh") ? "Refreshing..." : "Refresh now"}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => backfillNow(p)}
                  disabled={busy !== null || !canTest(p)}
                  title={canTest(p) ? "Pulls this account's posts and metrics now" : "Save keys (or connect the account) first"}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-command-accent" />
                  <span>{isBusy("backfill") ? "Backfilling..." : "Run backfill now"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => testKeys(p)}
                  disabled={busy !== null || !canTest(p)}
                  title={canTest(p) ? "Makes a read-only call to confirm the keys belong to the official account" : "Save keys (or connect the account) first"}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-command-border hover:border-command-accent text-command-soft hover:text-command-ink transition-colors cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-command-accent" />
                  <span>{isBusy("verify") ? "Testing..." : "Test keys"}</span>
                </button>
                {(p.credentialsSaved || p.status === "connected") && (
                  <button
                    type="button"
                    onClick={() => disconnect(p)}
                    disabled={busy !== null}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    <span>Disconnect</span>
                  </button>
                )}
              </div>
            </div>

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

            {(p.accountLabel || p.connectedAt || p.lastRefreshedAt) && (
              <p className="text-[11px] text-command-muted">
                {p.accountLabel ? `Account: ${p.accountLabel}. ` : ""}
                {p.connectedAt ? `Connected ${formatDate(p.connectedAt)}. ` : ""}
                {p.lastRefreshedAt && p.kind === "oauth" ? `Last renewed ${formatDate(p.lastRefreshedAt)}. ` : ""}
                {p.kind === "oauth" && p.renews !== undefined ? (p.renews ? "Renews automatically." : "Cannot renew itself: needs re-approval when it lapses.") : ""}
                {p.status === "reauth_soon" && p.refreshExpiresAt ? ` Re-approval needed by ${formatDate(p.refreshExpiresAt)}.` : ""}
              </p>
            )}
            {p.lastError && p.kind === "oauth" && <p className="text-[11px] text-amber-300">Last problem: {p.lastError}</p>}
            {p.linkExpiresAt && !(link?.platform === p.platform) && (
              <p className="text-[11px] text-command-muted">A connect link is outstanding (expires {formatDate(p.linkExpiresAt)}). Creating a new one cancels it.</p>
            )}

            <div className="rounded-lg border border-command-border p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-command-soft">Post history</p>
              {(data.backfill ?? [])
                .filter((row) => (CARD_NETWORKS[p.platform] ?? []).includes(row.network))
                .map((row) => (
                  <div key={row.network} className="text-[11px] text-command-muted">
                    <span className="text-command-soft font-semibold">{row.label}:</span>{" "}
                    {row.postCount.toLocaleString()} posts ·{" "}
                    {row.historyComplete ? <span className="text-emerald-300">full history ✓</span> : "history in progress"}
                    {row.lastRunAt ? ` · updated ${timeAgo(row.lastRunAt)}` : " · not run yet"}
                    {row.lastError && <span className="block text-amber-300">Last problem: {row.lastError}</span>}
                  </div>
                ))}
            </div>

            {p.detectedPageId && <p className="text-[11px] text-command-muted">Facebook Page detected automatically: {p.detectedPageId}</p>}

            {link?.platform === p.platform && (
              <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 space-y-2">
                <p className="text-[11px] text-emerald-300 font-semibold">
                  Send this to the {p.label} account owner. It works once and expires {formatDate(link.expiresAt)}.
                </p>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={link.url} className="w-full px-2.5 py-1 rounded bg-black/40 border border-emerald-800/60 text-[11px] font-mono text-emerald-100 select-all focus:outline-none" />
                  <button
                    type="button"
                    onClick={() => copy(link.url)}
                    className="px-2.5 py-1 rounded bg-command-accent text-slate-900 font-bold text-[11px] flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            )}

            {verify[p.platform] ? (
              <VerifyPanel result={verify[p.platform]} />
            ) : p.lastVerifySummary ? (
              <p className="text-[11px] text-command-muted">
                Last test {formatDateTime(p.lastVerifiedAt)}: <span className={p.lastVerifyOk ? "text-emerald-300" : "text-red-300"}>{p.lastVerifySummary}</span>
              </p>
            ) : null}

            {/* Keys the marketing team sends back */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {p.kind === "oauth" && p.appFieldLabels ? (
                <>
                  <div>
                    <label className="text-[11px] font-medium text-command-soft block mb-1">{p.appFieldLabels.clientId}</label>
                    <input type="text" autoComplete="off" value={form.clientId ?? ""} onChange={(e) => setField(p.platform, "clientId", e.target.value)} placeholder={p.credentialsSaved ? "Saved (enter to replace)" : ""} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-command-soft block mb-1">{p.appFieldLabels.clientSecret}</label>
                    <input type="password" autoComplete="off" value={form.clientSecret ?? ""} onChange={(e) => setField(p.platform, "clientSecret", e.target.value)} placeholder={p.credentialsSaved ? "Saved (enter to replace)" : ""} className={inputCls} />
                  </div>
                </>
              ) : (
                p.fields?.map((f) => (
                  <div key={f.key}>
                    <label className="text-[11px] font-medium text-command-soft block mb-1">
                      {f.label}
                      {f.optional && <span className="text-command-muted"> (optional)</span>}
                    </label>
                    <input type={f.secret ? "password" : "text"} autoComplete="off" value={form[f.key] ?? ""} onChange={(e) => setField(p.platform, f.key, e.target.value)} placeholder={f.set ? "Saved (enter to replace)" : ""} className={inputCls} />
                    {f.help && <p className="text-[10px] text-command-muted mt-1">{f.help}</p>}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => saveKeys(p)}
                disabled={busy !== null || !data.secretConfigured || Object.values(form).every((v) => !v?.trim())}
                className="btn btn-primary px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isBusy("save-credentials") ? "Saving..." : "Save keys"}
              </button>
              {p.kind === "oauth" && p.redirectUri && (
                <span className="text-[11px] text-command-muted">
                  Return link registered with {p.label}: <span className="font-mono">{p.redirectUri}</span>
                </span>
              )}
              {notice[p.platform] && <span className="text-[11px] text-command-soft">{notice[p.platform]}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
