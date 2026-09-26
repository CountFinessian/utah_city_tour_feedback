import { NextResponse } from "next/server";
import { findInvitationByToken, claimInvitation } from "@/server/repositories/user-repository";
import { generateSalt, hashPassword } from "@/server/auth/crypto";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, signSessionToken } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Missing invitation token" }, { status: 400 });
    }

    const invitation = await findInvitationByToken(token);
    if (!invitation) {
      return NextResponse.json({ error: "Invitation link not recognized or invalid." }, { status: 404 });
    }

    if (invitation.claimedAt) {
      return NextResponse.json(
        { error: "This invitation link has already been used. Please log in with your credentials." },
        { status: 400 }
      );
    }

    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "This invitation link has expired. Please request a new setup link." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      title: invitation.title,
    });
  } catch (err) {
    console.error("[setup-account GET error]", err);
    return NextResponse.json({ error: "Failed to verify invitation" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, name, firstName, lastName, password } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing invitation token" }, { status: 400 });
    }

    const fullName = name?.trim() || [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!fullName) {
      return NextResponse.json({ error: "Please provide your first and last name." }, { status: 400 });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long." }, { status: 400 });
    }

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const newUser = await claimInvitation(token, hash, salt, fullName);
    const sessionToken = await signSessionToken(newUser);
    const redirectTo = newUser.role === "host" ? "/" : "/command";

    const response = NextResponse.json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        title: newUser.title,
      },
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
    console.error("[setup-account POST error]", err);
    return NextResponse.json(
      { error: err.message || "Failed to set up account credentials." },
      { status: 400 }
    );
  }
}
