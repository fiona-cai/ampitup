import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jevGate } from "./jev";
import { capFor, clampAmount, quoteFromPolicy } from "./price";
import { priceEvents } from "./pipeline";
import { chargePresets } from "./presets";
import { approveBudgeted, authorize } from "./ramp";
import { seedEvents } from "./seed";
import { summarize } from "./summary";
import { dayKey, localHour } from "./time";
import type { CalendarEvent } from "./types";

const byId = (events: CalendarEvent[], id: string) => {
  const event = events.find((item) => item.id === id);
  assert.ok(event, id);
  return event;
};

describe("local clock", () => {
  it("reads New York wall time", () => {
    assert.equal(localHour("2026-10-06T12:45:00-04:00"), 12);
    assert.equal(dayKey("2026-10-06T12:45:00-04:00"), "2026-10-06");
  });
});

describe("Jev", () => {
  const events = seedEvents();

  it("keeps money off internal, prepaid, and included meals", () => {
    assert.equal(jevGate(byId(events, "standup")).rule, "internal_meeting");
    assert.equal(jevGate(byId(events, "standup")).needsBudget, false);
    assert.equal(jevGate(byId(events, "retro")).rule, "internal_meeting");
    assert.equal(jevGate(byId(events, "focus")).rule, "focus_block");
    assert.equal(jevGate(byId(events, "flight")).rule, "already_paid");
    assert.equal(jevGate(byId(events, "conference-lunch")).reason, "Meal included in registration");
    assert.equal(jevGate(byId(events, "workshop")).reason, "Catered, no spend expected");
    assert.equal(jevGate(byId(events, "workshop")).needsBudget, false);
  });

  it("budgets meals and airport rides", () => {
    const lunch = jevGate(byId(events, "solo-lunch"));
    const dinner = jevGate(byId(events, "acme-dinner"));
    const ride = jevGate(byId(events, "uber-yyz"));
    assert.equal(lunch.rule, "solo_meal");
    assert.equal(dinner.rule, "client_meal");
    assert.equal(dinner.confidence, "high");
    assert.equal(ride.category, "transport");
  });

  it("flags a vague title and defaults it to the per diem", () => {
    const catchUp = jevGate(byId(events, "catch-up"));
    assert.equal(catchUp.needsBudget, true);
    assert.equal(catchUp.confidence, "low");
    assert.equal(catchUp.rule, "vague_title");
    assert.equal(catchUp.category, "default_per_diem");
  });

  it("scores an unnamed client dinner as a meal", () => {
    const decision = jevGate({
      id: "unnamed",
      title: "Acme",
      description: "",
      location: "Gramercy Tavern",
      start: "2026-10-06T19:00:00-04:00",
      end: "2026-10-06T20:00:00-04:00",
      city: "New York",
      attendees: [
        { name: "Maya Chen", email: "maya.chen@northwind.co" },
        { name: "Elena Voss", email: "elena.voss@acme.com" },
      ],
    });
    assert.equal(decision.rule, "classifier");
    assert.equal(decision.category, "client_meal");
    assert.equal(decision.confidence, "high");
  });

  it("does not budget an internal catch up or a mid-afternoon video call", () => {
    const internal = jevGate({
      ...byId(events, "catch-up"),
      id: "internal-catch",
      attendees: [{ name: "Maya Chen", email: "maya.chen@northwind.co" }],
    });
    assert.equal(internal.needsBudget, false);

    const review = jevGate({
      id: "review",
      title: "Quarterly review",
      description: "",
      location: "Zoom",
      start: "2026-10-07T15:00:00-04:00",
      end: "2026-10-07T15:45:00-04:00",
      city: "New York",
      attendees: [
        { name: "Maya Chen", email: "maya.chen@northwind.co" },
        { name: "Elena Voss", email: "elena.voss@acme.com" },
      ],
    });
    assert.equal(review.needsBudget, false);
    assert.equal(review.rule, "no_spend");
  });
});

describe("policy clamp", () => {
  const events = seedEvents();

  it("prices seeded events under the cap", () => {
    const dinner = byId(events, "acme-dinner");
    const quote = quoteFromPolicy(dinner, jevGate(dinner));
    assert.equal(quote.amount, 240);
    assert.equal(quote.cap, 280);
    assert.equal(quote.clamped, false);
    assert.equal(quote.reason, "4 attendees × $60, NYC");
    assert.equal(quote.policyRule, "$70/person client entertainment");

    const lunch = byId(events, "solo-lunch");
    const lunchQuote = quoteFromPolicy(lunch, jevGate(lunch));
    assert.equal(lunchQuote.amount, 25);
    assert.equal(lunchQuote.reason, "Single attendee, midday, local rates");

    const ride = byId(events, "uber-yyz");
    assert.equal(quoteFromPolicy(ride, jevGate(ride)).amount, 60);
    assert.equal(quoteFromPolicy(ride, jevGate(ride)).reason, "Distance and time of day");
  });

  it("never lets a quote through the cap", () => {
    const dinner = byId(events, "acme-dinner");
    const cap = capFor(dinner, "client_meal").cap;
    const clamped = clampAmount(500, cap);
    assert.equal(cap, 280);
    assert.equal(clamped.amount, 280);
    assert.equal(clamped.clamped, true);
  });
});

describe("seeded week", () => {
  it("budgets home events as well as travel", async () => {
    const events = seedEvents();
    const lumen = byId(events, "lumen-lunch");
    const lumenQuote = quoteFromPolicy(lumen, jevGate(lumen));
    assert.equal(jevGate(lumen).rule, "client_meal");
    assert.equal(lumenQuote.amount, 80);
    assert.equal(lumenQuote.reason, "2 attendees × $40, Waterloo");

    const team = byId(events, "team-dinner");
    assert.equal(jevGate(team).rule, "team_meal");
    assert.equal(quoteFromPolicy(team, jevGate(team)).amount, 175);

    const coffee = byId(events, "candidate-coffee");
    assert.equal(jevGate(coffee).category, "client_coffee");
    assert.equal(quoteFromPolicy(coffee, jevGate(coffee)).amount, 20);

    assert.equal(jevGate(byId(events, "monday-standup")).needsBudget, false);
  });

  it("matches the demo totals and declines a pooled lunch charge", async () => {
    const priced = await priceEvents(seedEvents());
    assert.equal(priced.filter((event) => event.budget).length, 9);
    assert.equal(priced.filter((event) => !event.budget).length, 7);

    const summary = summarize(priced, "Waterloo");
    assert.equal(summary.travelDays, 3);
    assert.deepEqual(
      summary.days.map((day) => day.travelCity),
      [null, "New York", "New York", "New York", null],
    );
    assert.equal(summary.perDiems, 300);
    assert.equal(summary.reimbursed, 560);
    assert.equal(summary.todayCost, 860);
    assert.equal(summary.contextCard, 730);
    assert.equal(summary.saved, 130);
    assert.equal(summary.contextReimbursements, 0);
    assert.equal(
      summary.saved,
      summary.days.reduce((sum, day) => sum + day.unused, 0),
    );

    const approved = approveBudgeted(priced);
    const lunch = chargePresets[0];
    const declined = authorize(approved, lunch);
    assert.equal(declined.charge.result, "declined");
    assert.equal(
      declined.charge.detail,
      "Declined. Solo lunch is capped at $25. This card can't borrow from Dinner with Acme.",
    );

    const dinner = chargePresets[1];
    const accepted = authorize(approved, dinner);
    assert.equal(accepted.charge.result, "approved");
    assert.equal(accepted.charge.eventTitle, "Dinner with Acme");
    assert.match(accepted.charge.detail, /\$60 left/);
    assert.match(accepted.charge.report ?? "", /receipt matched/);

    const local = authorize(approved, {
      amount: 40,
      time: "2026-10-05T12:30:00-04:00",
      merchant: "Proof Kitchen",
    });
    assert.equal(local.charge.result, "approved");
    assert.equal(local.charge.eventTitle, "Lunch with Lumen Health");
  });

  it("keeps more when a low-confidence event is rejected", async () => {
    const priced = await priceEvents(seedEvents());
    const rejected = priced.map((event) =>
      event.event.id === "catch-up" ? { ...event, approval: "rejected" as const } : event,
    );
    const summary = summarize(rejected, "Waterloo");
    assert.equal(summary.contextCard, 680);
    assert.equal(summary.saved, 180);
  });
});
