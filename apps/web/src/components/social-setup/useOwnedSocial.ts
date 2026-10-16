"use client";

import { useCallback, useEffect, useState } from "react";
import type { BackfillOutcome, PlatformSummary, Summary, VerifyResult } from "./types";

const ENDPOINT = "/api/owned-social/admin";

export type ConnectLink = { platform: string; url: string; expiresAt: string };

/** Everything the walkthrough and its key panels need. Created once by the walkthrough and passed down. */
export type OwnedSocialContext = {
  data: Summary | null;
  error: string | null;
  /** `${platform}:${action}` while a request is running, otherwise null. */
  busy: string | null;
  notice: Record<string, string>;
  forms: Record<string, Record<string, string>>;
  setField: (platform: string, key: string, value: string) => void;
  link: ConnectLink | null;
  verify: Record<string, VerifyResult>;
  saveKeys: (p: PlatformSummary) => Promise<void>;
  makeLink: (p: PlatformSummary) => Promise<void>;
  authorizeNow: (p: PlatformSummary) => Promise<void>;
  refreshNow: (p: PlatformSummary) => Promise<void>;
  testKeys: (p: PlatformSummary) => Promise<void>;
  backfillNow: (p: PlatformSummary) => Promise<void>;
  disconnect: (p: PlatformSummary) => Promise<void>;
};

/** Loads the status summary once and exposes every key action. Leadership-only endpoint; the server rejects other roles. */
export function useOwnedSocial(): OwnedSocialContext {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [link, setLink] = useState<ConnectLink | null>(null);
  const [verify, setVerify] = useState<Record<string, VerifyResult>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
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
    fetch(ENDPOINT, { cache: "no-store" })
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
      const res = await fetch(ENDPOINT, {
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
      setLink((current) => (current?.platform === p.platform ? null : current));
      await load();
    }
  }

  return {
    data,
    error,
    busy,
    notice,
    forms,
    setField,
    link,
    verify,
    saveKeys,
    makeLink,
    authorizeNow,
    refreshNow,
    testKeys,
    backfillNow,
    disconnect,
  };
}
