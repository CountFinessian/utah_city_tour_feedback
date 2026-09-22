import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  findUserByEmail,
  findInvitationByEmail,
  createOrUpdateInvitation,
  type UserRole,
} from "@/server/repositories/user-repository";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  signInvitationToken,
  signPasswordResetToken,
} from "@/server/auth/session";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/server/email/mailer";

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

async function getSessionToken(req: Request): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    const val = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (val) return val;
  } catch {
    // fall back to headers
  }
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : undefined;
}

export async function POST(req: Request) {
  try {
    const sessionToken = await getSessionToken(req);
    const session = await verifySessionToken(sessionToken);

    // Only Leadership can resend setup links or trigger password resets from admin panel
    if (!session || session.role !== "leader") {
      return NextResponse.json(
        { error: "Forbidden: Only Leadership accounts can trigger invites or password resets." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { email, action } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const origin = getAppOrigin(req);
    const leaderName = session.name || "Utah City Leadership";

    if (action === "reset-password") {
      const user = await findUserByEmail(normalizedEmail);
      if (!user) {
        return NextResponse.json(
          { error: `No active account was found for ${normalizedEmail}.` },
          { status: 404 }
        );
      }

      const token = await signPasswordResetToken({ email: user.email });
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

      const emailResult = await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        name: user.name,
        requestedBy: leaderName,
      });

      return NextResponse.json({
        success: true,
        action: "reset-password",
        email: user.email,
        resetUrl,
        emailSent: emailResult.success,
        emailError: emailResult.error,
        message: emailResult.success
          ? `Password reset link dispatched to ${user.email}.`
          : `Password reset link generated. Email notice: ${emailResult.error || "Delivery delayed."}`,
      });
    }

    if (action === "resend-setup") {
      let invite = await findInvitationByEmail(normalizedEmail);

      let token = invite?.token;
      const role: UserRole = invite?.role || "host";
      const name = invite?.name || "";

      // If token is missing or expired, generate a fresh signed token
      if (!token || (invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now())) {
        token = await signInvitationToken({
          email: normalizedEmail,
          role,
          name,
        });
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
        invite = await createOrUpdateInvitation({
          email: normalizedEmail,
          name,
          role,
          token,
          expiresAt,
        });
      }

      const setupUrl = `${origin}/setup-account?token=${encodeURIComponent(token)}`;

      const emailResult = await sendInvitationEmail({
        to: normalizedEmail,
        role,
        setupUrl,
        invitedByName: leaderName,
      });

      return NextResponse.json({
        success: true,
        action: "resend-setup",
        email: normalizedEmail,
        setupUrl,
        emailSent: emailResult.success,
        emailError: emailResult.error,
        message: emailResult.success
          ? `Account setup email dispatched to ${normalizedEmail}.`
          : `Setup link generated. Email notice: ${emailResult.error || "Delivery delayed."}`,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Expected 'resend-setup' or 'reset-password'." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[resend-invite POST error]", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process request." },
      { status: 500 }
    );
  }
}

