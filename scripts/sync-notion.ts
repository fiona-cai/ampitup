import { loadEnvConfig } from "@next/env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EventSnapshot } from "../lib/budget-protocol";
import { loadNotionSnapshot, normalizeNotionPages, notionConfig } from "../lib/notion";

loadEnvConfig(process.cwd());

function args(argv: string[]): { flags: Set<string>; values: Map<string, string> } {
  const flags = new Set<string>(), values = new Map<string, string>();
  const valueFlags = new Set(["--database", "--data-source", "--template", "--output", "--raw-file", "--start", "--end"]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--simulated" || key === "--help") flags.add(key);
    else if (valueFlags.has(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) values.set(key, argv[++i]);
    else throw new Error(`Unknown option or missing argument: ${key}`);
  }
  return { flags, values };
}

async function main() {
  const { flags, values } = args(process.argv.slice(2));
  if (flags.has("--help")) {
    console.log("Read-only Notion → EventSnapshot v1.0\n\nOptions: --database ID/URL | --data-source ID, --template snapshot.json, --start ISO, --end ISO, --simulated, --output file.json\nOptional offline adapter check: --raw-file notion-pages.json\nLoads .env.local: NOTION_TOKEN, NOTION_DATABASE_ID or NOTION_DATA_SOURCE_ID.\nDefault output: data/harness/notion-snapshot.json (git-ignored). The default template/policy is simulated.");
    return;
  }
  const templatePath = values.get("--template") ?? "protocol/examples/event-snapshot.json";
  const template = JSON.parse(await readFile(templatePath, "utf8")) as EventSnapshot;
  if (template.schemaVersion !== "1.0" || !template.subject || !template.window || !template.policy) throw new Error("The template must be an EventSnapshot v1.0 with subject, window and policy.");
  const seed = {
    subject: template.subject, policy: template.policy,
    window: { start: values.get("--start") ?? template.window.start, end: values.get("--end") ?? template.window.end },
    isSimulated: flags.has("--simulated") || template.isSimulated,
  };
  const configured = notionConfig();
  const databaseId = values.get("--database") ?? configured?.databaseId ?? process.env.NOTION_DATABASE_ID;
  const dataSourceId = values.get("--data-source") ?? configured?.dataSourceId ?? process.env.NOTION_DATA_SOURCE_ID;
  const rawFile = values.get("--raw-file");
  let result;
  if (rawFile) {
    const raw: unknown = JSON.parse(await readFile(rawFile, "utf8"));
    const pages = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "results" in raw ? raw.results : null;
    if (!Array.isArray(pages)) throw new Error("The raw file must contain a page array or a Notion query response.");
    result = normalizeNotionPages(pages, dataSourceId ?? databaseId ?? "offline", seed);
  } else {
    const token = configured?.token ?? process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY;
    if (!token || (!databaseId && !dataSourceId)) throw new Error("Set NOTION_TOKEN and NOTION_DATABASE_ID/NOTION_DATA_SOURCE_ID in .env.local before syncing.");
    result = await loadNotionSnapshot({ token, databaseId, dataSourceId, isSimulated: seed.isSimulated || configured?.isSimulated !== false }, seed);
  }
  const output = path.resolve(values.get("--output") ?? "data/harness/notion-snapshot.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result.snapshot, null, 2)}\n`, { mode: 0o600 });
  // Separate diagnostics preserve the schema's strict no-extra-properties contract.
  if (result.warnings.length) await writeFile(`${output}.warnings.json`, `${JSON.stringify(result.warnings, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${result.snapshot.events.length} event(s) to ${output}. Read ${result.fetchedCount} row(s); skipped ${result.warnings.length} invalid/untimed row(s), ${result.outsideWindowCount} outside the window. Simulated facts: ${result.snapshot.isSimulated}.`);
  if (result.warnings.length) console.log(`Skipped-record diagnostics: ${output}.warnings.json`);
}

main().catch((error: unknown) => {
  // Do not include fetched records, environment values or token-bearing request objects.
  console.error(error instanceof Error ? error.message : "Notion sync failed.");
  process.exitCode = 1;
});
