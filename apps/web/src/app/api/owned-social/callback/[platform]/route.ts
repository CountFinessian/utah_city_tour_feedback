import { isOAuthPlatform, PLATFORM_LABELS } from "@/server/owned-social/platforms";
import { SecretNotConfiguredError } from "@/server/owned-social/crypto";
import { finishAuthorization, stateCookieName } from "@/server/owned-social/service";
import { statusPage } from "@/server/owned-social/html";

export const dynamic = "force-dynamic";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

/**
 * Public step 2. The platform sends the owner back here after they click Authorize.
 * We verify the signed state against the browser cookie, swap the code for keys, and store them encrypted.
 */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isOAuthPlatform(platform)) {
    return statusPage({ title: "Link not found", message: "This page is not valid.", ok: false, status: 404 });
  }
  const cookieName = stateCookieName(platform);
  const label = PLATFORM_LABELS[platform];
  const url = new URL(request.url);

  // The owner declined on the platform's screen.
  if (url.searchParams.get("error")) {
    return statusPage({
      title: "Connection cancelled",
      message: `${label} was not connected. If that was a mistake, ask Jacob for a new link.`,
      ok: false,
      status: 400,
      clearCookie: cookieName,
    });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return statusPage({ title: "Link not valid", message: "This page can only be reached from a connect link.", ok: false, status: 400, clearCookie: cookieName });
  }

  try {
    const result = await finishAuthorization(platform, {
      code,
      state: url.searchParams.get("state"),
      cookieNonce: readCookie(request, cookieName),
    });
    if (!result.ok) {
      const expired = result.reason === "link_expired";
      console.warn(`[owned-social callback] ${platform}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
      return statusPage({
        title: expired ? "This link was already used" : "We could not connect",
        message: expired
          ? "This connect link has expired or was already used. Please ask Jacob for a new one."
          : "Something did not match up, so nothing was saved. Please ask Jacob for a new link and try again in the same browser.",
        ok: false,
        status: expired ? 410 : 400,
        clearCookie: cookieName,
      });
    }
    return statusPage({
      title: `${label} connected`,
      message: `Thank you. ${result.accountLabel ? `Connected account: ${result.accountLabel}. ` : ""}Utah City can now read performance numbers for this account (read-only). You can close this tab.`,
      ok: true,
      clearCookie: cookieName,
    });
  } catch (err) {
    if (err instanceof SecretNotConfiguredError) {
      return statusPage({ title: "Not ready yet", message: "This connection has not been set up on our side yet. Please let Jacob know.", ok: false, status: 503, clearCookie: cookieName });
    }
    console.error("[owned-social callback]", platform, err instanceof Error ? err.message : err);
    return statusPage({ title: "Something went wrong", message: "We could not finish connecting. Please contact Jacob.", ok: false, status: 500, clearCookie: cookieName });
  }
}
