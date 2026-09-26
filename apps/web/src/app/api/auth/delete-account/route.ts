import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";
import { deleteUserAndInvitation } from "@/server/repositories/user-repository";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = await verifySessionToken(token);

    if (!session || !session.email) {
      return NextResponse.json({ error: "Unauthorized: Active session required to delete account." }, { status: 401 });
    }

    // Call database / store to permanently delete user record and invitation tokens
    await deleteUserAndInvitation(session.email);

    // Prepare response clearing the session cookie
    const response = NextResponse.json({
      success: true,
      message: "Your account and associated profile have been permanently deleted.",
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    console.error("[delete-account error]", err);
    const message = err instanceof Error ? err.message : "Failed to delete account";
    return NextResponse.json({ error: `Database error: ${message}` }, { status: 500 });
  }
}

