import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl, googleConfig } from "@/lib/google";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = googleConfig(request.nextUrl.origin);
  if (!config) {
    return NextResponse.redirect(new URL("/?google_error=not_configured", request.url));
  }

  const state = randomBytes(24).toString("hex");
  const write = request.nextUrl.searchParams.get("write") === "1";
  const response = NextResponse.redirect(authUrl(config, state, write));
  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/auth/google",
    maxAge: 600,
  });
  const referer = request.headers.get("referer");
  const from = referer && URL.canParse(referer) ? new URL(referer) : null;
  if (from && from.origin === request.nextUrl.origin && !from.pathname.startsWith("/api/")) {
    response.cookies.set("google_oauth_return", from.pathname, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/api/auth/google",
      maxAge: 600,
    });
  }
  return response;
}
