"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, Unplug, AlertCircle } from "lucide-react";

type Field = { key: string; label: string; secret: boolean; set: boolean };

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
};

type Summary = { secretConfigured: boolean; baseUrl: string; platforms: PlatformSummary[] };

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

const inputCls =
  "w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-command-border text-xs text-command-ink placeholder:text-command-muted focus:outline-none focus:border-command-accent";

export function OwnedSocialConnections() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [link, setLink] = useState<{ platform: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function refreshNow(p: PlatformSummary) {
    const json = await call(p.platform, "refresh");
    if (json) {
      const outcome = json.outcome as { result?: string; detail?: string } | undefined;
      setNotice((n) => ({ ...n, [p.platform]: outcome?.result === "refreshed" ? "Refreshed." : `Not refreshed: ${outcome?.detail ?? outcome?.result ?? "unknown"}` }));
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
                    <label className="text-[11px] font-medium text-command-soft block mb-1">{f.label}</label>
                    <input type={f.secret ? "password" : "text"} autoComplete="off" value={form[f.key] ?? ""} onChange={(e) => setField(p.platform, f.key, e.target.value)} placeholder={f.set ? "Saved (enter to replace)" : ""} className={inputCls} />
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
