/** Batch adapter: normalized gate requests on stdin, existing Jev decisions on stdout. */
import { readFileSync } from "node:fs";
import { jevGate } from "../lib/jev";
import type { BudgetGateRequest } from "../lib/budget-protocol";
import type { Attendee } from "../lib/types";

const requests: BudgetGateRequest[] = JSON.parse(readFileSync(0, "utf8"));
const decisions = requests.map(({ event }) => {
  const { totalCount, externalCount } = event.participants;
  if (totalCount === null || externalCount === null) return null;
  // Only internal/external presence and solo/team matter to Jev's gate. These
  // reserved domains are projection placeholders, never inferred identities.
  const attendees: Attendee[] = Array.from({ length: totalCount }, (_, index) => ({
    name: "Synthetic participant",
    email: `person${index}@${index < externalCount ? "guest.example" : "work.example"}`,
  }));
  return jevGate({
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    location: event.location.mode === "virtual" ? "Virtual" : event.location.label ?? "",
    city: event.location.city ?? "",
    start: event.schedule.start,
    end: event.schedule.end,
    attendees,
  }, { companyDomain: "work.example", timeZone: event.schedule.timeZone });
});
process.stdout.write(JSON.stringify(decisions));
