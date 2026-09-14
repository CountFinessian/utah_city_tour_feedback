import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";
import { findUserByEmail } from "@/server/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Validate that user still exists in the database
  const liveUser = await findUserByEmail(session.email);
  if (!liveUser) {
    const response = NextResponse.json({ user: null, error: "Account revoked" }, { status: 401 });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  return NextResponse.json({
    user: {
      id: liveUser.id,
      email: liveUser.email,
      name: liveUser.name,
      role: liveUser.role,
      title: liveUser.title,
    },
  });
}
