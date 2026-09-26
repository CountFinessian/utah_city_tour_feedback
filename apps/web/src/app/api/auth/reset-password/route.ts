import { NextResponse } from "next/server";
import { findUserByEmail, updateUserPassword } from "@/server/repositories/user-repository";
import { verifyPasswordResetToken, signSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { generateSalt, hashPassword } from "@/server/auth/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Missing password reset token." }, { status: 400 });
    }

    const payload = await verifyPasswordResetToken(token);
    if (!payload || !payload.email) {
      return NextResponse.json(
        { error: "This password reset link is invalid or has expired. Please request a new link." },
        { status: 400 }
      );
    }

    const user = await findUserByEmail(payload.email);
    if (!user) {
      return NextResponse.json(
        { error: "No user account was found associated with this reset link." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      valid: true,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err: any) {
    console.error("[reset-password GET error]", err);
    return NextResponse.json(
      { error: err?.message || "Failed to verify password reset token." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, password } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing password reset token." }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    const payload = await verifyPasswordResetToken(token);
    if (!payload || !payload.email) {
      return NextResponse.json(
        { error: "This password reset link is invalid or has expired. Please request a new link." },
        { status: 400 }
      );
    }

    const user = await findUserByEmail(payload.email);
    if (!user) {
      return NextResponse.json(
        { error: "No user account was found associated with this reset link." },
        { status: 404 }
      );
    }

    // Generate new salt and hash
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const updated = await updateUserPassword(user.email, hash, salt);
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update password. Please try again." },
        { status: 500 }
      );
    }

    // Auto-login: Sign session token and set session cookie
    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      title: user.title,
    };
    const sessionToken = await signSessionToken(sessionUser);
    const redirectTo = user.role === "host" ? "/" : "/command";

    const response = NextResponse.json({
      success: true,
      message: "Password updated successfully.",
      user: sessionUser,
      redirectTo,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("[reset-password POST error]", err);
    return NextResponse.json(
      { error: err?.message || "Failed to reset password." },
      { status: 500 }
    );
  }
}

