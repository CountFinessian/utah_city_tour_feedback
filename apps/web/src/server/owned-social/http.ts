/**
 * Shared HTTP helpers for the official-account checks ("Test keys") and the historical backfill.
 *
 * Error messages never contain a URL, header or response body, so a token cannot leak through them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- each platform returns untyped JSON; fields are read defensively */

export const TIMEOUT_MS = 15_000;

/** A problem we can explain to the leader in plain English. Its message is always safe to show. */
export class CheckError extends Error {
  status?: number;
  /** Platform error code from the response body (for example Meta's 4 / 17 / 32 / 613 rate limits). */
  code?: number | string;
  constructor(message: string, status?: number, code?: number | string) {
    super(message);
    this.name = "CheckError";
    this.status = status;
    this.code = code;
  }
}

export function toNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** One GET or POST with the standard timeout. Throws CheckError (no URL, header or body in the message). */
export async function requestJson(
  network: string,
  url: string,
  headers: Record<string, string>,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<Record<string, any>> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...headers,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  let json: Record<string, any> | null = null;
  try {
    json = (await res.json()) as Record<string, any>;
  } catch {
    json = null;
  }
  if (!res.ok) {
    // Meta reports a rejected token as HTTP 400 with error code 190.
    const status = res.status === 400 && json?.error?.code === 190 ? 401 : res.status;
    throw new CheckError(`${network} returned HTTP ${status}`, status, json?.error?.code);
  }
  return json ?? {};
}
