import fs from "fs";
import path from "path";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const IDENTITY_SCOPES = ["openid", "email", "profile"];

const tokenPath = path.join(process.cwd(), "data", "google.json");

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  email: string;
  name: string;
};

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function googleConfig(origin?: string): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${origin ?? "http://localhost:3000"}/api/auth/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

export function authUrl(config: GoogleConfig, state: string, write: boolean): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...IDENTITY_SCOPES, READ_SCOPE, ...(write ? [WRITE_SCOPE] : [])].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Google token request failed (${response.status})`);
  }
  return body;
}

export async function exchangeCode(config: GoogleConfig, code: string): Promise<GoogleTokens> {
  const body = await postToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const accessToken = body.access_token as string;

  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await profileResponse.json()) as { email?: string; name?: string };
  if (!profileResponse.ok || !profile.email) throw new Error("Google did not return an email address.");

  return {
    accessToken,
    refreshToken: body.refresh_token ?? readTokens()?.refreshToken ?? null,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scope: body.scope ?? "",
    email: profile.email,
    name: profile.name || profile.email,
  };
}

export function readTokens(): GoogleTokens | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as GoogleTokens;
    return parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTokens(tokens: GoogleTokens): void {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export async function clearTokens(): Promise<void> {
  const tokens = readTokens();
  fs.rmSync(tokenPath, { force: true });
  const token = tokens?.refreshToken ?? tokens?.accessToken;
  if (!token) return;
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export function hasScope(tokens: GoogleTokens, scope: string): boolean {
  return tokens.scope.split(" ").includes(scope);
}

export async function accessToken(config: GoogleConfig | null = googleConfig()): Promise<string | null> {
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken || !config) return null;

  const body = await postToken({
    refresh_token: tokens.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const next: GoogleTokens = {
    ...tokens,
    accessToken: body.access_token as string,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scope: body.scope ?? tokens.scope,
  };
  writeTokens(next);
  return next.accessToken;
}
