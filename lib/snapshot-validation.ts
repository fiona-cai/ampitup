import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../protocol/budget.schema.json";
import type { EventSnapshot } from "./budget-protocol";
import { dateInZone, instantInZone } from "./event-context";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const check = ajv.compile<EventSnapshot>(schema);

export function validateSnapshot(value: unknown): EventSnapshot {
  if (!check(value)) throw new Error(`Invalid snapshot: ${ajv.errorsText(check.errors, { separator: "; " })}`);
  const snapshot = value;
  dateInZone(snapshot.window.start, snapshot.subject.timeZone);
  const from = Date.parse(snapshot.window.start), until = Date.parse(snapshot.window.end);
  if (from >= until) throw new Error("Snapshot window end must be after its start.");
  const ids = new Set<string>(), sources = new Set<string>();
  for (const event of snapshot.events) {
    if (ids.has(event.id)) throw new Error(`Duplicate event ID: ${event.id}`);
    ids.add(event.id);
    const start = Date.parse(event.schedule.start), end = Date.parse(event.schedule.end);
    if (end <= start || start < from || start >= until) throw new Error(`${event.title}: invalid event interval or start outside snapshot window.`);
    for (const instant of [event.schedule.start, event.schedule.end]) {
      const expected = instantInZone(Date.parse(instant), event.schedule.timeZone);
      const offset = instant.endsWith("Z") ? "+00:00" : instant.slice(-6);
      if (offset !== expected.slice(-6)) throw new Error(`${event.title}: timestamp offset does not match its time zone.`);
      if (event.schedule.allDay && expected.slice(11, 19) !== "00:00:00") throw new Error(`${event.title}: all-day boundaries must be local midnight.`);
    }
    if (event.participants.totalCount !== null && event.participants.externalCount !== null && event.participants.externalCount > event.participants.totalCount) throw new Error(`${event.title}: external participants exceed the total.`);
    for (const source of event.sources) {
      const key = JSON.stringify([source.provider, source.collectionId, source.recordId]);
      if (sources.has(key)) throw new Error("Duplicate source record; merge provenance into one event.");
      sources.add(key);
    }
    for (const pointer of event.missingFields) {
      let current: unknown = event;
      for (const part of pointer.slice(1).split("/").map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))) {
        if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) throw new Error(`${event.title}: invalid missing-field pointer ${pointer}.`);
        current = (current as Record<string, unknown>)[part];
      }
      if (current !== null && current !== "unknown") throw new Error(`${event.title}: ${pointer} must point to an unknown fact.`);
    }
  }
  return snapshot;
}
