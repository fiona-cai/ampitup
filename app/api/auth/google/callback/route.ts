import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, googleConfig, writeScriptTokens } from "@/lib/google";
import { readSession, writeSession } from "@/lib/session";
import { employeeFromGoogle, readState, writeState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(request: NextRequest, error?: string) {
  const target = request.cookies.get("google_oauth_return")?.value;
  const url = new URL(target?.startsWith("/") && !target.startsWith("//") ? target : "/", request.url);
  if (error) url.searchParams.set("google_error", error);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: "google_oauth_state", path: "/api/auth/google" });
  response.cookies.delete({ name: "google_oauth_return", path: "/api/auth/google" });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const denied = params.get("error");
  if (denied) return back(request, denied);

  const expected = request.cookies.get("google_oauth_state")?.value;
  const state = params.get("state");
  const code = params.get("code");
  if (!expected || !state || state !== expected) return back(request, "state_mismatch");
  if (!code) return back(request, "missing_code");

  const config = googleConfig(request.nextUrl.origin);
  if (!config) return back(request, "not_configured");

  try {
    const previous = await readSession();
    const tokens = await exchangeCode(config, code);
    if (!tokens.refreshToken && previous?.email === tokens.email) tokens.refreshToken = previous.refreshToken;
    await writeSession(tokens);
    await writeScriptTokens(tokens);
    const current = await readState(employeeFromGoogle(tokens.email, tokens.name));
    await writeState(current);
    return back(request);
  } catch (error) {
    console.error("Google sign-in failed:", error);
    return back(request, "token_exchange_failed");
  }
}
