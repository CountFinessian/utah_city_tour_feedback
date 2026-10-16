import type { PlatformStatus, PlatformSummary } from "./types";

export const STATUS_STYLE: Record<PlatformStatus, { text: string; cls: string }> = {
  not_configured: { text: "Keys not saved", cls: "bg-slate-500/10 text-slate-300 border-slate-500/20" },
  incomplete: { text: "Some keys missing", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  ready_to_connect: { text: "Ready: send connect link", cls: "bg-sky-500/10 text-sky-300 border-sky-500/20" },
  connected: { text: "Connected", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  saved: { text: "Keys saved", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  reauth_soon: { text: "Re-approval due soon", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  reauth_needed: { text: "Needs re-approval", cls: "bg-red-500/10 text-red-300 border-red-500/20" },
};

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatCount(n?: number): string {
  return n === undefined ? "" : n.toLocaleString();
}

export function timeAgo(iso?: string): string {
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

export const inputCls =
  "w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-command-border text-xs text-command-ink placeholder:text-command-muted focus:outline-none focus:border-command-accent";

/** Keys can be tested once they are saved (Meta/X) or the account is connected (OAuth). */
export function canTest(p: PlatformSummary): boolean {
  if (p.kind === "static") return p.credentialsSaved;
  return p.status === "connected" || p.status === "reauth_soon";
}
