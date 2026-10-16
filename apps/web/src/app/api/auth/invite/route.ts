import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createOrUpdateInvitation,
  listAllInvitationsWithStatus,
  findUserByEmail,
  findInvitationByEmail,
  updateUserRole,
  deleteUserAndInvitation,
} from "@/server/repositories/user-repository";
import { sendInvitationEmail } from "@/server/email/mailer";
import { SESSION_COOKIE_NAME, verifySessionToken, signInvitationToken, type SessionPayload } from "@/server/auth/session";
import { isLeadershipRole, normalizeRole, type UserRole } from "@/server/auth/roles";
import { liveSessionRole } from "@/server/auth/live-role";

export const dynamic = "force-dynamic";

const ASSIGNABLE_ROLES: readonly UserRole[] = ["host", "leader"];

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
    // /api/auth is public in middleware, and this list carries live setup links, so it must check the caller itself.
    const caller = await callerFrom(req);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isLeadershipRole(caller.role)) {
      return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
    }
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
    return NextResponse.json(
      { error: `Database error: ${err?.message || "Failed to load invitations"}` },
      { status: 500 }
    );
  }
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

/** The signed-in caller with their current role. Null when there is no valid session or the account is gone. */
type Caller = { session: SessionPayload; role: UserRole };

async function callerFrom(req: Request): Promise<Caller | null> {
  const session = await verifySessionToken(await getSessionToken(req));
  if (!session) return null;
  const role = await liveSessionRole(session);
  if (!role) return null;
  return { session, role };
}

export async function POST(req: Request) {
  try {
    // Inviting is a leadership action. This route previously had no authorization check at all.
    const caller = await callerFrom(req);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isLeadershipRole(caller.role)) {
      return NextResponse.json({ error: "Forbidden: Only members of Leadership can invite people." }, { status: 403 });
    }

    const body = await req.json();
    const { email, role, name, title } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const assignedRole = normalizeRole(role);
    if (!assignedRole || !ASSIGNABLE_ROLES.includes(assignedRole)) {
      return NextResponse.json({ error: "Role must be 'host' or 'leader'." }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Prevent inviting an email that already has an active registered account
    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser) {
      return NextResponse.json(
        { error: `An account already exists for ${normalizedEmail}. This user is already registered and can log in directly.` },
        { status: 400 }
      );
    }

    // 2. Prevent re-inviting an email where the invitation has already been claimed
    const existingInvite = await findInvitationByEmail(normalizedEmail);
    if (existingInvite?.claimedAt) {
      return NextResponse.json(
        { error: `An account already exists for ${normalizedEmail}. This user has already completed onboarding and can log in directly.` },
        { status: 400 }
      );
    }

    // 3. Prevent the current authenticated leader from inviting their own active email
    if (caller.session.email && caller.session.email.toLowerCase() === normalizedEmail) {
      return NextResponse.json(
        { error: `You are currently signed into this account (${normalizedEmail}). You cannot send an onboarding invitation to yourself.` },
        { status: 400 }
      );
    }
    const invitedByName = caller.session.name || "Utah City Leadership";

    const origin = getAppOrigin(req);
    // Generate cryptographically signed capability token (self-verifying across serverless instances)
    const token = await signInvitationToken({
      email: normalizedEmail,
      role: assignedRole,
      name: (name as string | undefined)?.trim() || "",
      title,
    });
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const invite = await createOrUpdateInvitation({
      email: normalizedEmail,
      name: (name as string | undefined)?.trim() || "",
      role: assignedRole,
      title,
      token,
      expiresAt,
    });

    const setupUrl = `${origin}/setup-account?token=${invite.token}`;

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

export async function PATCH(req: Request) {
  try {
    const caller = await callerFrom(req);

    // Leadership authorization check (current role from the database)
    if (!caller || !isLeadershipRole(caller.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only members of Leadership can upgrade user roles." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { email, role } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    const assignedRole = normalizeRole(role);
    if (!assignedRole || !ASSIGNABLE_ROLES.includes(assignedRole)) {
      return NextResponse.json({ error: "Role must be 'host' or 'leader'." }, { status: 400 });
    }

    const result = await updateUserRole(email, assignedRole);

    const label = assignedRole === "leader" ? "Leadership" : "Tour Host";
    return NextResponse.json({
      success: true,
      email,
      role: assignedRole,
      ...result,
      message: `User role has been updated to ${label}.`,
    });
  } catch (err: any) {
    console.error("[invite PATCH error]", err);
    return NextResponse.json(
      { error: `Database error: ${err?.message || "Failed to update role"}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const caller = await callerFrom(req);

    if (!caller || !isLeadershipRole(caller.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only members of Leadership can remove accounts." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    let targetEmail = searchParams.get("email");
    if (!targetEmail) {
      const body = await req.json().catch(() => ({}));
      targetEmail = body.email;
    }

    if (!targetEmail || typeof targetEmail !== "string" || !targetEmail.includes("@")) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    // Safety: a leader cannot remove their own account through this route
    if (caller.session.email && caller.session.email.toLowerCase() === targetEmail.toLowerCase()) {
      return NextResponse.json(
        { error: "Action blocked: You cannot delete your own active account." },
        { status: 400 }
      );
    }

    const result = await deleteUserAndInvitation(targetEmail);

    return NextResponse.json({
      success: true,
      email: targetEmail,
      ...result,
      message: `Account for ${targetEmail} has been removed.`,
    });
  } catch (err: any) {
    console.error("[invite DELETE error]", err);
    return NextResponse.json(
      { error: `Database error: ${err?.message || "Failed to remove account"}` },
      { status: 500 }
    );
  }
}
