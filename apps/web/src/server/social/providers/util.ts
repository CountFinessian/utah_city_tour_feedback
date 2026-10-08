export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function firstArray(...candidates: unknown[]): unknown[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim().toLowerCase().replace(/,/g, "");
  const match = trimmed.match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return 0;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return 0;
  const unit = match[2];
  if (unit === "k") return Math.round(base * 1_000);
  if (unit === "m") return Math.round(base * 1_000_000);
  if (unit === "b") return Math.round(base * 1_000_000_000);
  return base;
}

export function epochIso(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && /[t\-:]/i.test(value)) return new Date(parsed).toISOString();
  }
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

export function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("?")[0].split("#")[0];
  }
}

export function cursorString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && value.trim() !== "0") return value.trim();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
  return undefined;
}

export function pickCursor(obj: Record<string, unknown> | null | undefined): string | undefined {
  if (!obj) return undefined;
  const nested = asRecord(obj.data);
  const candidates = [
    obj.nextCursor,
    obj.next_cursor,
    obj.continuation_token,
    obj.continuationToken,
    obj.pagination_token,
    obj.paginationToken,
    obj.max_cursor,
    obj.cursor,
    nested?.nextCursor,
    nested?.next_cursor,
    nested?.continuation_token,
    nested?.cursor,
  ];
  for (const candidate of candidates) {
    const cursor = cursorString(candidate);
    if (cursor) return cursor;
  }
  return undefined;
}

export type Recency = "hour" | "day" | "week" | "month" | "year" | "all";

export function recencyOf(since?: string): Recency {
  if (!since) return "all";
  const parsed = Date.parse(since);
  if (!Number.isFinite(parsed)) return "all";
  const days = (Date.now() - parsed) / 86_400_000;
  if (days <= 0.08) return "hour";
  if (days <= 1.5) return "day";
  if (days <= 8) return "week";
  if (days <= 32) return "month";
  if (days <= 370) return "year";
  return "all";
}

export function recordsOf(output: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown>[] {
  const roots = [output, asRecord(output?.data), asRecord(asRecord(output?.data)?.data), asRecord(output?.output)].filter(
    (root): root is Record<string, unknown> => Boolean(root)
  );
  for (const root of roots) {
    for (const key of keys) {
      const list = root[key];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
      }
    }
  }
  return [];
}

/** Treg wraps upstream JSON in `output`. Catalog examples and stubs sometimes are the upstream body. */
export function payloadOf(output: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!output) return {};
  const data = asRecord(output.data);
  if (data && (data.comments || data.reels || data.posts || data.videos || data.itemList || data.search_item_list || data.aweme_list)) {
    return data;
  }
  return output;
}
