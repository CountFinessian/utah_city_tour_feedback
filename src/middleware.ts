import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";

const LEADERSHIP_ROUTES = [
  "/command",
  "/analyst",
  "/journey",
  "/signals",
  "/evidence",
  "/operations",
  "/settings",
  "/digest",
  "/manager",
  "/executive",
  "/knowledge",
];

const LEADERSHIP_APIS = [
  "/api/analyst",
  "/api/digest",
  "/api/seed",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public routes
  if (
    pathname === "/login" ||
    pathname === "/setup-account" ||
    pathname === "/reset-password" ||
    pathname === "/privacy" ||
    pathname === "/support" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname === "/api/status" ||
    pathname.startsWith("/_next") ||
    pathname.includes(".") // static files: favicon.ico, images, etc.
  ) {
    // If visiting /login while already authenticated, redirect to role home
    if (pathname === "/login") {
      const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
      const session = await verifySessionToken(token);
      if (session) {
        const dest = session.role === "host" ? "/" : "/command";
        return NextResponse.redirect(new URL(dest, req.url));
      }
    }
    return NextResponse.next();
  }

  // 2. Check session token
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // 3. Enforce Role-Based Access Control
  const isLeadershipRoute = LEADERSHIP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isLeadershipApi = LEADERSHIP_APIS.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (session.role !== "leader") {
    if (isLeadershipRoute) {
      const captureUrl = new URL("/", req.url);
      captureUrl.searchParams.set("unauthorized", "leadership");
      return NextResponse.redirect(captureUrl);
    }
    if (isLeadershipApi) {
      return NextResponse.json({ error: "Forbidden: Leadership access required" }, { status: 403 });
    }
  }

  // 4. Inject authenticated user headers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", session.id);
  requestHeaders.set("x-user-email", session.email);
  requestHeaders.set("x-user-name", session.name);
  requestHeaders.set("x-user-role", session.role);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
