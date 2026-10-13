function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A tiny standalone page for the people who open a connect link (they are not logged in to the app). */
export function statusPage(opts: { title: string; message: string; ok: boolean; status?: number; clearCookie?: string }): Response {
  const accent = opts.ok ? "#43d9c7" : "#f59e0b";
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(opts.title)} | Utah City</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070b12;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:30rem;padding:2rem;margin:1rem;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0d1420}
h1{margin:0 0 .75rem;font-size:1.35rem;color:${accent}}p{margin:0;line-height:1.6;color:#cbd5e1}
</style></head><body><main><h1>${escapeHtml(opts.title)}</h1><p>${escapeHtml(opts.message)}</p></main></body></html>`;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
  });
  if (opts.clearCookie) {
    headers.append("Set-Cookie", `${opts.clearCookie}=; Path=/api/owned-social/callback; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  return new Response(body, { status: opts.status ?? (opts.ok ? 200 : 400), headers });
}
