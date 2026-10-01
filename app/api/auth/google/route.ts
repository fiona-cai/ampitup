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
  return response;
}
