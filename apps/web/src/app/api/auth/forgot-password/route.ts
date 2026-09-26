import { NextResponse } from "next/server";
import { findUserByEmail, findInvitationByEmail } from "@/server/repositories/user-repository";
import { signPasswordResetToken } from "@/server/auth/session";
import { sendPasswordResetEmail, sendInvitationEmail } from "@/server/email/mailer";

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const origin = getAppOrigin(req);

    // Check if user exists as an active registered account
    const user = await findUserByEmail(normalizedEmail);

    if (user) {
      const token = await signPasswordResetToken({ email: user.email });
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        name: user.name,
      });

      return NextResponse.json({
        success: true,
        message: "If an account exists with this email address, a password reset link has been dispatched.",
      });
    }

    // Check if the email belongs to a pending invitation (user hasn't completed setup yet)
    const invitation = await findInvitationByEmail(normalizedEmail);
    if (invitation && !invitation.claimedAt && invitation.token) {
      const setupUrl = `${origin}/setup-account?token=${encodeURIComponent(invitation.token)}`;
      await sendInvitationEmail({
        to: invitation.email,
        role: invitation.role,
        setupUrl,
        invitedByName: "Utah City Team",
      });

      return NextResponse.json({
        success: true,
        message: "Your account is currently pending setup. We have resent your account activation link.",
      });
    }

    // Generic success response to prevent account enumeration
    return NextResponse.json({
      success: true,
      message: "If an account exists with this email address, a password reset link has been dispatched.",
    });
  } catch (err: any) {
    console.error("[forgot-password POST error]", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process password reset request." },
      { status: 500 }
    );
  }
}

