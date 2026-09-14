import { NextResponse } from "next/server";
import { verifyUserCredentials } from "@/server/auth/users";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, signSessionToken } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const user = await verifyUserCredentials(email, password);

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Invalid email or password. If you have an invitation, please activate your account using your setup link.",
        },
        { status: 401 }
      );
    }

    const token = await signSessionToken(user);
    const redirectTo = user.role === "host" ? "/" : "/command";

    const response = NextResponse.json({
      success: true,
      user,
      redirectTo,
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    console.error("[login error]", error);
    const message = error instanceof Error ? error.message : "Authentication failed. Please try again.";
    return NextResponse.json({ error: `Database error: ${message}` }, { status: 500 });
  }
}

