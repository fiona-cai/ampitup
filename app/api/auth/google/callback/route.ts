import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, googleConfig, writeTokens } from "@/lib/google";
import { employeeFromGoogle } from "@/lib/seed";
import { blankState, writeState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(request: NextRequest, error?: string) {
  const url = new URL("/", request.url);
  if (error) url.searchParams.set("google_error", error);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: "google_oauth_state", path: "/api/auth/google" });
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
    const tokens = await exchangeCode(config, code);
    await writeTokens(tokens);
    await writeState({
      ...blankState(),
      connected: true,
      employee: employeeFromGoogle(tokens.email, tokens.name),
    });
    return back(request);
  } catch (error) {
    console.error("Google sign-in failed:", error);
    return back(request, "token_exchange_failed");
  }
}
