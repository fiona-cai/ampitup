import fs from "fs";
import os from "os";
import path from "path";

// Hosted Redis (Upstash, from the Vercel Marketplace) when its REST credentials are set.
// Otherwise JSON files: data/ locally, or the temp dir on Vercel, which only lives as long as one instance.

const PREFIX = "allot:";

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function storageKind(): "redis" | "file" | "ephemeral" {
  if (redisConfig()) return "redis";
  return process.env.VERCEL ? "ephemeral" : "file";
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("Redis is not configured.");
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || body.error) throw new Error(`Redis ${command[0]} failed: ${body.error ?? response.status}`);
  return body.result;
}

function filePath(key: string): string {
  const dir = storageKind() === "ephemeral" ? path.join(os.tmpdir(), "allot") : path.join(process.cwd(), "data");
  return path.join(dir, `${key}.json`);
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (redisConfig()) {
    const raw = await redis(["GET", PREFIX + key]);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath(key), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown, options: { secret?: boolean } = {}): Promise<void> {
  if (redisConfig()) {
    await redis(["SET", PREFIX + key, JSON.stringify(value)]);
    return;
  }
  const file = filePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), options.secret ? { mode: 0o600 } : undefined);
}

export async function deleteKey(key: string): Promise<void> {
  if (redisConfig()) {
    await redis(["DEL", PREFIX + key]);
    return;
  }
  fs.rmSync(filePath(key), { force: true });
}
