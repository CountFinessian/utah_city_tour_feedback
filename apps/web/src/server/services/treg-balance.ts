/** Team prepaid balance. A monitor run must not start under $1. */
export async function readTregBalanceUsd(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const token = process.env.TREG_TOKEN || "";
  if (!token) return null;
  try {
    const response = await fetchImpl("https://treg.to/balance", {
      method: "GET",
      headers: { "X-Treg-Token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.balance_usd === "number" && Number.isFinite(body.balance_usd)) return body.balance_usd;
    if (typeof body.balance_micro === "number" && Number.isFinite(body.balance_micro)) return body.balance_micro / 1_000_000;
    return null;
  } catch {
    return null;
  }
}
