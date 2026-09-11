import { NextResponse } from "next/server";
import {
  createOrUpdateInvitation,
  listAllInvitationsWithStatus,
  type UserRole,
} from "@/server/repositories/user-repository";
import { generateSecureToken } from "@/server/auth/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { origin } = new URL(req.url);
    const invitations = await listAllInvitationsWithStatus();

    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        email: inv.email,
        name: inv.name,
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
    const { email, name, role, title } = body;

    if (!email || !name || !role) {
      return NextResponse.json({ error: "Missing required fields: email, name, role" }, { status: 400 });
    }

    if (role !== "host" && role !== "leader") {
      return NextResponse.json({ error: "Role must be 'host' or 'leader'" }, { status: 400 });
    }

    const { origin } = new URL(req.url);
    const token = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const invite = await createOrUpdateInvitation({
      email,
      name,
      role: role as UserRole,
      title,
      token,
      expiresAt,
    });

    return NextResponse.json({
      success: true,
      setupUrl: `${origin}/setup-account?token=${invite.token}`,
      invite,
    });
  } catch (err: any) {
    console.error("[invite POST error]", err);
    return NextResponse.json({ error: err.message || "Failed to create invitation" }, { status: 500 });
  }
}
