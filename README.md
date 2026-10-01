# Allot

Allot gives every business event its own right-sized budget, so spend matches the purpose of the event instead of a daily allowance. That covers a client lunch across town, a team dinner, a coffee with a candidate, or a week on the road.

It reads the employee's calendar, decides which events need company money, prices each one, and turns each approved budget into a mock card limit that is only open around that event. Money set aside for one event can't be spent on another. The charge simulator links approved attempts to an event and produces a mock expense line; it does not process real payments or match receipts.

Design board: [Figma](https://www.figma.com/board/FSOjXIOANdMZn3smWq5CCk/Ramp-it-Up?node-id=0-1&p=f&t=JhBuY6XVh6eyKl32-0)

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Walkthrough](#walkthrough)
- [How a budget is decided](#how-a-budget-is-decided)
- [Policy](#policy)
- [Card limits and charges](#card-limits-and-charges)
- [Savings summary](#savings-summary)
- [Configuration](#configuration)
- [API](#api)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Limitations](#limitations)

## Why

Most companies set spend limits without context:

- **Per diems pool.** Meal limits on a trip are tracked per day, not per meal. A $20 / $30 / $50 per diem is really a $100 daily pool, so skipping two meals funds a $100 solo dinner.
- **Money goes to events that need none.** A catered workshop, a conference with lunch included, or an internal standup still sits under the same allowance.
- **Real costs are under-budgeted.** A dinner with four prospects gets the same limit as a solo meal, so the employee pays the difference and files a reimbursement. At home there's usually no allowance at all, so every client lunch becomes an expense report.
- **Review happens after the fact.** Finance matches receipts to calendars by hand to work out what each charge was for.

The context needed to set the right limit is already on the calendar: who is attending, where, when, and why.

## Quick start

Requires Node 20 or later.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No keys are needed. Without them the app uses a seeded calendar and prices budgets from policy rates, so the demo behaves the same every time.

Other scripts:

```bash
npm test        # pipeline tests
npm run lint    # ESLint
npm run build   # production build
```

## Walkthrough

The seeded calendar belongs to Maya Chen at Northwind, who is based in Waterloo. Her week has events at home on Monday and Friday and a New York visit with the Acme account from Tuesday to Thursday.

1. **Load sample events.** In the empty event table, click "Load sample events" to run the seeded week through Jev and the pricer. No sign-in is needed for the sample. "Calendar sync" and Options → "Refresh events" reload the configured source; see [Configuration](#configuration) for real calendar access.
2. **Browse the table.** "Overview", "Needs review", "Live", and "No budget" organize the event rows by budget status. "Live" means an approved mock limit, not a real Ramp card or a guarantee that its time window is currently open. Search titles, descriptions, locations, cities, or attendees; Filter narrows the view by category or low confidence.
3. **Inspect and review.** Click an event name or Details to open its drawer. It shows context, attendees, Jev reasoning, pricing source, policy cap, card window, and simulated spending. Edit the amount, approve the budget, or select "No budget for this event" to reject it. Edits are clamped to policy, and $0 rejects the budget. Row checkboxes and the footer Select menu support bulk review.
4. **Use Options.** "Approve all budgets" approves budgeted events except ones already rejected. "Export visible events" downloads the current filtered rows as CSV. "Reset demo" clears the sample state so it can be loaded again.
5. **Try the Card simulator.** Open the card icon or Options → "Try a demo charge". Once budgets are approved, try the two presets:
   - **$90 at 1:00 PM on Tuesday** is declined: "Solo lunch is capped at $25. This card can't borrow from Dinner with Acme."
   - **$180 at 7:30 PM on Tuesday** is approved against the Acme dinner, leaving $60 on that mock limit, and produces an event-linked mock expense line.

   The form below the presets takes an approved event, merchant, and amount, and simulates the attempt at that event's start time. Recent attempts and event drawers show the result. No money moves and no receipt is uploaded or matched.
6. **Read the footer.** It shows visible and total event counts, the budgeted amount versus the modeled baseline, and a Demo label. This compares planned sample budgets, not measured customer savings or real expenditure.

### What the seeded week produces

| Day | Event | Result |
| --- | --- | --- |
| Mon (home) | Team standup | No budget: internal meeting |
| | Lunch with Lumen Health | $80: 2 attendees × $40, Waterloo |
| Tue (New York) | Team standup | No budget: internal meeting |
| | Uber to YYZ | $60: airport transfer |
| | Flight to LGA | No budget: prepaid |
| | Solo lunch | $25: single attendee, midday |
| | Dinner with Acme | $240: 4 attendees × $60, NYC |
| Wed (New York) | SaaS conference lunch | No budget: meal included in registration |
| | Sprint retro | No budget: internal meeting |
| | Catch up with Jordan | $50, low confidence: vague title, standard dinner per diem |
| Thu (New York) | Breakfast | $20: single attendee, morning |
| | Acme workshop | No budget: lunch catered by the client |
| | Focus block | No budget |
| | Uber to LGA | $60: airport transfer |
| Fri (home) | Coffee with Ravi (candidate) | $20: 2 attendees, coffee, Waterloo |
| | Team dinner | $175: 5 attendees, evening, local rates |

That's 9 budgets totalling $730 and 7 events at $0.

## How a budget is decided

Every event passes through four stages. Jev decides *whether* an event gets money, Claude decides *how much*, the server enforces the cap, and a person approves.

### 1. Jev: does this event need a budget?

`lib/jev.ts` returns `needsBudget`, a category, a confidence level, the rule that fired, and a short reason. It is deliberately not a model: the yes/no decision should be cheap, predictable, and easy to explain.

Rules run in order, and the first match wins:

| Rule | Matches | Result |
| --- | --- | --- |
| Already paid | "catered", "meal included", "lunch provided", "prepaid", "already booked", and similar | No budget |
| Focus block | "focus", "deep work", "heads down", "OOO", with no outside guests | No budget |
| Internal meeting | standup, retro, 1:1, one-on-one, sync, planning, all-hands, sprint review, with no outside guests | No budget |
| Transport | Uber, Lyft, taxi, cab, rideshare | Budget: transport |
| Named meal with outside guests | breakfast, lunch, dinner, brunch, drinks, coffee, tea | Budget: client meal, or client coffee if it's only coffee or tea |
| Named meal, internal | same words, no outside guests | Budget: solo meal or team meal |

Attendees are external when their email domain differs from the company domain in `data/policy.json`.

Events that match no rule are scored:

| Signal | Score |
| --- | --- |
| At least one external attendee | +2 (otherwise −3) |
| Starts at a meal time | +1 |
| Has a physical location (not Zoom, Meet, Teams, or a phone call) | +1 |
| Vague title ("catch up", "chat", "connect", "TBD") | −2 |

- External guests and a vague title: budget at the standard per diem, low confidence.
- External guests, a meal time, a place, and a score of 3 or more: budget as a client meal, high confidence.
- External guests at a meal time with a score of 1 or more: budget at the standard per diem, low confidence.
- Anything else: no budget.

Meal times are breakfast 6–10 AM, lunch 11 AM–3 PM, and dinner 5–10 PM, Eastern time.

### 2. Claude: how much?

For events that pass Jev, `lib/price.ts` calls the Anthropic Messages API with only the fields needed to price the event:

- title, description, location, city, start, and end
- the Jev category and confidence
- attendee names, each flagged as internal or external (email addresses are not sent)
- the cap and the policy rule it comes from
- the city rate table and the relevant policy sections

Claude returns JSON with an `amount` and a one-line `reason`. It cannot change the category, so it can't raise its own cap by reclassifying an event.

If there's no API key, the call fails or times out (12 seconds), or the response isn't valid JSON, that event falls back to a policy-rate price, such as "4 attendees × $60, NYC". The header above the events says whether budgets came from Claude, from policy rates, or a mix.

### 3. Policy clamp

The cap is computed in code from `data/policy.json` and the Jev category, never by the model. Every amount is clamped to the cap: Claude's quote, the fallback price, and manager edits. When a quote is clamped, the card shows "clamped from $X".

### 4. Review

Budgets start as pending. A manager can approve all of them at once or approve, edit, or reject them one by one. Only approved budgets become card limits. Rejecting an approved budget removes its limit, and editing one re-issues its limit at the new amount.

## Policy

`data/policy.json` holds the company domain, the per diem, the caps, the limit windows, and city rates.

**Caps**

| Category | Cap |
| --- | --- |
| Client meal | $70 per person |
| Client coffee | $15 per person |
| Solo meal | breakfast $20, lunch $25, dinner $50 |
| Team meal | per person: breakfast $20, lunch $30, dinner $50 |
| Airport transfer | $75 |
| Local ride | $40 |
| Low-confidence default | the per diem for that meal: $20, $30, or $50 |

**City rates** (what a reasonable amount looks like, always under the cap)

| City | Client meal per person | Solo breakfast | Solo lunch | Solo dinner | Airport transfer | Coffee per person |
| --- | --- | --- | --- | --- | --- | --- |
| New York | $60 | $20 | $25 | $55 | $60 | $15 |
| Chicago | $50 | $18 | $25 | $45 | $55 | $12 |
| Waterloo | $40 | $15 | $18 | $35 | $60 | $10 |
| Anywhere else | $45 | $18 | $22 | $40 | $50 | $12 |

"NYC" and "Manhattan" map to New York. To add a city, add an entry under `cities` and an alias in `lib/policy.ts`.

## Card limits and charges

`lib/ramp.ts` is a mock of a Ramp spend-limit API. Each approved budget becomes one limit with an amount, an open time, a close time, and a running total spent.

| Event type | Opens | Closes |
| --- | --- | --- |
| Meals and coffee | 45 minutes before the event | 90 minutes after it ends |
| Rides | 30 minutes before | 45 minutes after |

When a charge comes in:

1. Find the approved limits that are open at the charge time. If none are open, decline: limits don't cover the gaps between events.
2. If several are open, use the one with the shortest window, which is the most specific event.
3. If the charge is more than what's left on that limit, decline and name the event it can't borrow from.
4. Otherwise approve the simulated attempt, add it to the mock limit's spend, and write an expense line linked to the event. No receipt matching is performed.

Spend accumulates, so two charges against the same dinner share its limit. The last 12 charges are kept.

## Savings summary

`lib/summary.ts` compares the week against how spend works without Allot:

- **Travel days** (any event outside the home city) get a flat $100 per diem for meals. Meal spend above the per diem, and all transport, is paid out of pocket and reimbursed.
- **Home days** have no per diem, so every budgeted event is paid out of pocket and reimbursed.

Real costs get paid either way. The difference is per diem money that no event needed, and every reimbursement becomes a budget set up front instead.

For the seeded week:

| | Amount |
| --- | --- |
| Travel per diems (3 days × $100) | $300 |
| Reimbursements | $560 |
| **Without Allot** | **$860** |
| **Allot** | **$730** |
| Saved | $130 |
| Reimbursements filed with Allot | $0 |

Rejecting the low-confidence "Catch up with Jordan" budget lowers Allot to $680, and savings rise to $180.

## Configuration

Everything is optional. Create `.env.local`:

```bash
# Claude sets budget amounts. Without a key, policy rates are used.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# Pull the next 7 days from a real Google Calendar instead of the seeded week.
CALENDAR_SOURCE=google
GOOGLE_ACCESS_TOKEN=
```

**Google Calendar.** The token needs the `calendar.readonly` scope. Sync calls `events.list` on the primary calendar from now to 7 days out, with recurring events expanded, up to 50 events. All-day events are treated as 9 AM to 5 PM. Each event's city is inferred from its location and title, and anything unrecognized is treated as the employee's home city. If the call fails or returns nothing, sync falls back to the seeded week.

To get a token for testing, use the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) with the `https://www.googleapis.com/auth/calendar.readonly` scope. Tokens expire after about an hour.

**Demo employee.** The employee name, email, company, and home city are in `lib/seed.ts`. The company domain used to tell internal from external attendees is `companyDomain` in `data/policy.json`.

## API

Everything goes through one route, `app/api/events/route.ts`.

`GET /api/events` returns the current state: the employee, the sync window, every event with its Jev decision, budget, approval, and limit, recent charges, and the summary once synced.

`POST /api/events` takes a JSON body with an `action` and returns the same state:

| Action | Body | Effect |
| --- | --- | --- |
| `connect` | — | Marks the calendar as connected |
| `sync` | — | Loads events, runs Jev and pricing, and clears earlier charges |
| `decide` | `{ "all": true }` | Approves every pending budget |
| `decide` | `{ "eventId", "approval" }` | Sets one budget to `approved`, `rejected`, or `pending` |
| `decide` | `{ "eventId", "amount" }` | Edits one budget, clamped to its cap. `0` rejects it |
| `charge` | `{ "amount", "time", "merchant" }` | Authorizes a charge. `time` is ISO 8601 and `amount` is $1–$10,000 |
| `reset` | — | Clears all state |

Errors come back as `{ "error": "..." }`, with status 400 for bad input and 500 for anything unexpected.

```bash
curl -X POST localhost:3000/api/events -H 'content-type: application/json' \
  -d '{"action":"charge","amount":90,"time":"2026-10-06T13:00:00-04:00","merchant":"Sweetgreen"}'
```

State is stored in `data/state.json`, which is gitignored. Writes are queued so that requests within one server process don't overwrite each other.

## Project layout

| Path | What it is |
| --- | --- |
| `app/page.tsx` | Renders the app |
| `app/api/events/route.ts` | The API: connect, sync, decide, charge, reset |
| `components/RampAllotApp.tsx` | Ramp-style event table, status tabs, search/filter, selection, Options, CSV export, and modeled-baseline footer |
| `components/RampSidebar.tsx` | Navigation for events, policy, calendar sync, and prototype shell sections |
| `components/RampIcon.tsx` | Shared interface icons |
| `components/EventDetails.tsx` | Event context and budget drawer: edit, approve, reject, and simulated charges |
| `components/DemoCardPanel.tsx` | Mock charge presets, event-bound simulator, and recent attempts |
| `components/AppDialog.tsx` | Dialog and drawer shell |
| `lib/ui-events.ts` | Pure status counts, event filters, display windows, charge lookup, and avatars |
| `lib/jev.ts` | Jev rules and scorer |
| `lib/price.ts` | Claude pricing, policy-rate fallback, caps, and clamp |
| `lib/pipeline.ts` | Runs Jev and pricing over a list of events |
| `lib/ramp.ts` | Mock spend limits and charge authorization |
| `lib/summary.ts` | With vs. without Allot totals |
| `lib/calendar.ts` | Google Calendar sync |
| `lib/seed.ts` | Demo employee and seeded week |
| `lib/policy.ts` | Policy loader and city lookup |
| `lib/attendees.ts` | Internal vs. external attendees |
| `lib/time.ts` | Eastern-time formatting and meal slots |
| `lib/presets.ts` | The two demo charges |
| `lib/store.ts` | Reads and writes `data/state.json` |
| `lib/types.ts` | Shared types |
| `data/policy.json` | Caps, per diems, limit windows, city rates |

Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, and TypeScript.

## Testing

```bash
npm test
```

`lib/pipeline.test.ts` covers:

- Jev on the seeded events, including the vague "catch up", a client dinner with no meal word in its title, and internal or video-call events that shouldn't get money
- policy-rate prices and the clamp
- home-city events: the client lunch, the team dinner, and the candidate coffee
- the weekly totals, and that savings equal the unused per diem
- charge authorization: the declined $90 lunch, the approved $180 dinner, and a charge at home

The tests use policy-rate pricing and never call Claude.

## Limitations

This is a hackathon build. Not done yet:

- **No app sign-in flow.** Sample events load without authentication; real calendar access uses a token from the environment, not a Google OAuth button in this interface.
- **Ramp is mocked.** Limits and authorizations run in `lib/ramp.ts` and have the shape a real spend-limit integration would need.
- **One demo user.** State is a single JSON file with no accounts or roles. The employee and the manager use the same screen.
- **Eastern time only.** Meal times and display use `America/New_York`, and the charge form assumes the `-04:00` offset.
- **USD only.**
- **No receipts or real payments.** Approved simulated charges produce an event-linked mock expense line. There is no receipt upload or matching; the CSV export contains event rows, not receipts.
- **No ad hoc events.** Events come from the calendar; there's no form to add an unplanned one.
