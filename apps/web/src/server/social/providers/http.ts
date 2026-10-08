import { asRecord } from "./util";

export interface TregCallParams {
  endpointId: string;
  method?: "GET" | "POST";
  data?: Record<string, unknown>;
  queryParams?: Record<string, string | number | boolean | undefined>;
  maxCostUsd?: number;
  timeoutMs?: number;
}

export interface TregCallResult<T = unknown> {
  data: T | null;
  output: Record<string, unknown> | null;
  error?: string;
  servedBy?: string;
  costMicro: number;
  costUsd: number;
}

export interface TregLookupDebugInfo {
  endpointId: string;
  output: Record<string, unknown> | null;
  error?: string;
}

let lookupDebugSink: ((info: TregLookupDebugInfo) => void) | null = null;

/** Records response bodies for mode=lookup-debug. The caller must structure and drop them. */
export function setTregLookupDebugSink(sink: ((info: TregLookupDebugInfo) => void) | null): void {
  lookupDebugSink = sink;
}

function notifyLookupDebug(endpointId: string, output: Record<string, unknown> | null, error?: string): void {
  if (!lookupDebugSink) return;
  lookupDebugSink({ endpointId, output, error });
}

export class TregHttp {
  cycleCostMicro = 0;

  resetCycleCost(): void {
    this.cycleCostMicro = 0;
  }

  getCycleCostUsd(): number {
    return this.cycleCostMicro / 1_000_000;
  }

  getCycleCostMicro(): number {
    return this.cycleCostMicro;
  }

  async call<T = unknown>(params: TregCallParams): Promise<TregCallResult<T>> {
    const { endpointId, method = "POST", data, queryParams, maxCostUsd = 0.05, timeoutMs = 45000 } = params;
    const token = process.env.TREG_TOKEN || "";
    if (!token) {
      const error = "TREG_TOKEN is not set";
      notifyLookupDebug(endpointId, null, error);
      return { data: null, output: null, error, costMicro: 0, costUsd: 0 };
    }

    try {
      const sp = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams || {})) {
        if (value === undefined || value === "") continue;
        sp.append(key, String(value));
      }
      const qs = sp.toString();
      const url = `https://treg.to/call/${endpointId}${qs ? `?${qs}` : ""}`;
      const response = await fetch(url, {
        method,
        headers: {
          "X-Treg-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Treg-Route-Max-Cost": String(maxCostUsd),
        },
        body: method !== "GET" && data ? JSON.stringify(data) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const costHeader = Number(response.headers.get("x-treg-cost-micro") || 0);
      const servedBy = response.headers.get("x-treg-served-by") || undefined;
      const body = await response.json().catch(() => null);
      const bodyRec = asRecord(body);
      const tregMeta = asRecord(bodyRec?._treg);
      const costMicro = Number(tregMeta?.charged_micro ?? costHeader ?? 0);
      this.cycleCostMicro += costMicro;

      if (!response.ok) {
        const error = `HTTP ${response.status} from ${endpointId}`;
        notifyLookupDebug(endpointId, bodyRec, error);
        return {
          data: null,
          output: null,
          error,
          servedBy,
          costMicro,
          costUsd: costMicro / 1e6,
        };
      }

      const output = asRecord(bodyRec?.output) ?? bodyRec;
      notifyLookupDebug(endpointId, output);
      return {
        data: (output as T) ?? null,
        output,
        servedBy: servedBy || (typeof tregMeta?.served_by === "string" ? tregMeta.served_by : undefined),
        costMicro,
        costUsd: costMicro / 1e6,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyLookupDebug(endpointId, null, message);
      return { data: null, output: null, error: message, costMicro: 0, costUsd: 0 };
    }
  }
}

export const tregHttp = new TregHttp();
