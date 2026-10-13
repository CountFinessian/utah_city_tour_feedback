import { NextResponse } from "next/server";
import { isOAuthPlatform } from "@/server/owned-social/platforms";
import { SecretNotConfiguredError } from "@/server/owned-social/crypto";
import { beginAuthorization } from "@/server/owned-social/service";
import { statusPage } from "@/server/owned-social/html";

export const dynamic = "force-dynamic";

/**
 * Public step 1. The account owner opens the single-use connect link a leader created.
 * Nothing is stored here; we validate the link and redirect to the platform's own approval screen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isOAuthPlatform(platform)) {
    return statusPage({ title: "Link not found", message: "This connect link is not valid.", ok: false, status: 404 });
  }
  try {
    const token = new URL(request.url).searchParams.get("t");
    const result = await beginAuthorization(platform, token);
    if (!result.ok) {
      return statusPage({
        title: result.reason === "not_configured" ? "Not ready yet" : "This link is no longer valid",
        message:
          result.reason === "not_configured"
            ? "This connection has not been set up on our side yet. Please let Jacob know."
            : "This connect link has expired or was already used. Please ask Jacob for a new one.",
        ok: false,
        status: result.reason === "not_configured" ? 503 : 410,
      });
    }
    const res = NextResponse.redirect(result.redirectUrl, 302);
    res.cookies.set({
      name: result.cookie.name,
      value: result.cookie.value,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/owned-social/callback",
      maxAge: result.cookie.maxAge,
    });
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (err) {
    if (err instanceof SecretNotConfiguredError) {
      return statusPage({ title: "Not ready yet", message: "This connection has not been set up on our side yet. Please let Jacob know.", ok: false, status: 503 });
    }
    console.error("[owned-social connect]", err instanceof Error ? err.message : err);
    return statusPage({ title: "Something went wrong", message: "We could not start the connection. Please try again or contact Jacob.", ok: false, status: 500 });
  }
}
