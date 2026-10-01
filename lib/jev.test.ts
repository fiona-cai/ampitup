import assert from "node:assert/strict";
import { it } from "node:test";
import { jevGate } from "./jev";
import type { CalendarEvent } from "./types";

const event: CalendarEvent = {
  id: "custom-input", title: "Account review", description: "", location: "Client office",
  city: "Los Angeles", start: "2026-10-06T11:00:00Z", end: "2026-10-06T12:00:00Z",
  attendees: [{ name: "Employee", email: "self@work.example" }, { name: "Guest", email: "client@guest.example" }],
};

it("conditions meal-time inference on the supplied event time zone", () => {
  assert.equal(jevGate(event).category, "client_meal");
  assert.equal(jevGate(event, { timeZone: "America/Los_Angeles" }).needsBudget, false);
});

it("uses the supplied company domain for internal meeting rules", () => {
  const internal = { ...event, title: "Focus block", attendees: [event.attendees[0]] };
  assert.equal(jevGate(internal, { companyDomain: "work.example" }).rule, "focus_block");
  assert.notEqual(jevGate(internal).rule, "focus_block");
});
