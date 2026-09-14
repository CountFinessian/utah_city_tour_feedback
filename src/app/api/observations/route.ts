import { NextResponse, type NextRequest } from "next/server";
import {
  createOrRefineObservation,
  InputValidationError,
  listObservations,
  deleteObservation,
  type CreateObservationInput,
} from "@/server/services/observation-service";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ observations: await listObservations() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateObservationInput | null;

  try {
    const observation = await createOrRefineObservation(body ?? {});
    return NextResponse.json({ observation });
  } catch (err) {
    if (err instanceof InputValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/observations] failed to create observation:", err);
    return NextResponse.json({ error: "Could not create observation." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    let sessionToken: string | undefined;
    try {
      const cookieStore = await cookies();
      sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      const cookieHeader = req.headers.get("cookie") || "";
      const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      sessionToken = match ? match[1] : undefined;
    }

    if (sessionToken) {
      const session = await verifySessionToken(sessionToken);
      if (session && session.role !== "leader") {
        return NextResponse.json(
          { error: "Forbidden: Only members of Leadership can delete evidence." },
          { status: 403 }
        );
      }
    } else if (process.env.NODE_ENV !== "test") {
      return NextResponse.json(
        { error: "Unauthorized: Leadership access required." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id");
    if (!id) {
      const body = (await req.json().catch(() => null)) as { id?: string } | null;
      id = body?.id ?? null;
    }

    if (!id) {
      return NextResponse.json({ error: "Observation ID is required." }, { status: 400 });
    }

    const deleted = await deleteObservation(id);
    if (!deleted) {
      return NextResponse.json({ error: "Observation not found or already deleted." }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Evidence record removed from corpus." });
  } catch (err: any) {
    console.error("[api/observations DELETE] error:", err);
    return NextResponse.json({ error: err?.message || "Failed to delete evidence." }, { status: 500 });
  }
}
