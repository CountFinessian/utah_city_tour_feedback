import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/server/auth/session";
import { userAccountExists } from "@/server/auth/session-alive";

const LEADERSHIP_ROUTES = [
  "/command",
  "/social-pulse",
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
  "/api/social-pulse/admin",
  "/api/social-pulse/posts",
  "/api/social-pulse/refresh",
  "/api/social-pulse/dashboard",
  "/api/social-pulse/comments",
  "/api/owned-social/admin",
];

/** Only real static asset requests (never API routes) skip authentication. */
const STATIC_ASSET_PATTERN =
  /\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml|webmanifest|js|css|map|woff2?|ttf|otf)$/i;

/** Identity headers that only this middleware may set. */
const USER_IDENTITY_HEADERS = ["x-user-id", "x-user-email", "x-user-name", "x-user-role"] as const;

/** Copy of the incoming headers with any client-supplied identity headers removed. */
function sanitizedRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  for (const name of USER_IDENTITY_HEADERS) headers.delete(name);
  return headers;
}

function clearSessionAndRedirectToLogin(req: NextRequest, reason?: string) {
  const loginUrl = new URL("/login", req.url);
  if (reason) loginUrl.searchParams.set(reason, "true");
  const res = NextResponse.redirect(loginUrl);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    maxAge: 0,
    path: "/",
  });
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const userAgent = req.headers.get("user-agent") || "";
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);

  // 1. Allow public routes
  if (
    pathname === "/login" ||
    pathname === "/setup-account" ||
    pathname === "/reset-password" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/support" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname === "/api/status" ||
    // Background Social Pulse listener (auth handled inside the route via CRON_SECRET)
    pathname === "/api/social-pulse/cron" ||
    // Official-account connections. The marketing team is not logged in: connect/callback are guarded by
    // single-use signed links + a state cookie, and the refresh cron by CRON_SECRET (all checked inside the routes).
    pathname.startsWith("/api/owned-social/connect/") ||
    pathname.startsWith("/api/owned-social/callback/") ||
    pathname === "/api/owned-social/cron" ||
    pathname.startsWith("/_next") ||
    (!pathname.startsWith("/api/") && STATIC_ASSET_PATTERN.test(pathname)) // static files: favicon.ico, images, etc.
  ) {
    // If visiting /login while already authenticated, redirect to role home (or / if mobile)
    if (pathname === "/login") {
      const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
      const session = await verifySessionToken(token);
      if (session) {
        const stillExists = await userAccountExists(session.email);
        if (stillExists === false) {
          return clearSessionAndRedirectToLogin(req, "deleted");
        }
        const dest = (session.role === "host" || isMobile) ? "/" : "/command";
        return NextResponse.redirect(new URL(dest, req.url));
      }
    }
    return NextResponse.next({ request: { headers: sanitizedRequestHeaders(req) } });
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

  // 2b. Revoke sessions for deleted accounts (JWT alone is not enough)
  const stillExists = await userAccountExists(session.email);
  if (stillExists === false) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Account revoked" }, { status: 401 });
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: "",
        httpOnly: true,
        maxAge: 0,
        path: "/",
      });
      return res;
    }
    return clearSessionAndRedirectToLogin(req, "deleted");
  }

  // 3. Enforce Role-Based Access Control and Mobile Surface Constraints
  const isLeadershipRoute = LEADERSHIP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const isLeadershipApi = LEADERSHIP_APIS.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  // Mobile users (even leadership) are restricted to the streamlined capture screen
  if (isMobile && isLeadershipRoute) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Desktop/PC users in leadership role default to Command view instead of mobile capture
  if (
    pathname === "/" &&
    !isMobile &&
    session.role === "leader" &&
    !req.nextUrl.searchParams.has("surface") &&
    !req.nextUrl.searchParams.has("capture") &&
    !req.nextUrl.searchParams.has("mode")
  ) {
    return NextResponse.redirect(new URL("/command", req.url));
  }

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
  const requestHeaders = sanitizedRequestHeaders(req);
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
