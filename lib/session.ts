import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { GoogleTokens } from "./google";

const COOKIE = "allot_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("Set SESSION_SECRET or GOOGLE_CLIENT_SECRET to enable sign-in.");
  return createHash("sha256").update(`allot-session:${secret}`).digest();
}

export function seal(tokens: GoogleTokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

export function unseal(value: string): GoogleTokens | null {
  try {
    const [iv, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as GoogleTokens;
    return parsed?.email && parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<GoogleTokens | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value ? unseal(value) : null;
}

export async function writeSession(tokens: GoogleTokens): Promise<void> {
  (await cookies()).set(COOKIE, seal(tokens), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
