import { NextResponse } from "next/server";
import {
  createOrUpdateInvitation,
  listAllInvitationsWithStatus,
  type UserRole,
} from "@/server/repositories/user-repository";
import { generateSecureToken } from "@/server/auth/crypto";
import { sendInvitationEmail } from "@/server/email/mailer";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";

export const dynamic = "force-dynamic";

function getAppOrigin(req: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  try {
    const origin = getAppOrigin(req);
    const invitations = await listAllInvitationsWithStatus();

    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        email: inv.email,
        name: inv.name || inv.email.split("@")[0],
        role: inv.role,
        claimed: inv.claimed,
        setupUrl: inv.token ? `${origin}/setup-account?token=${inv.token}` : "",
      })),
    });
  } catch (err: any) {
    console.error("[invite GET error]", err);
    return NextResponse.json({ error: "Failed to load invitations" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, role, name, title } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    if (!role || (role !== "host" && role !== "leader")) {
      return NextResponse.json({ error: "Role must be 'host' or 'leader'." }, { status: 400 });
    }

    const origin = getAppOrigin(req);
    const token = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const invite = await createOrUpdateInvitation({
      email: email.trim().toLowerCase(),
      name: (name as string | undefined)?.trim() || "",
      role: role as UserRole,
      title,
      token,
      expiresAt,
    });

    const setupUrl = `${origin}/setup-account?token=${invite.token}`;

    // Get current leader name for invitation email if authenticated
    const cookieStore = await cookies();
    const tokenCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const currentUser = await verifySessionToken(tokenCookie);
    const invitedByName = currentUser?.name || "Utah City Leadership";

    // Automatically send secure onboarding email
    const emailResult = await sendInvitationEmail({
      to: invite.email,
      role: invite.role,
      setupUrl,
      invitedByName,
    });

    return NextResponse.json({
      success: true,
      setupUrl,
      emailSent: emailResult.success,
      emailError: emailResult.error,
      invite,
    });
  } catch (err: any) {
    console.error("[invite POST error]", err);
    return NextResponse.json({ error: err.message || "Failed to create invitation" }, { status: 500 });
  }
}
