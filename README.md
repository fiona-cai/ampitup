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

Requires Node 20.9 or later. The homepage runs the contextual Laya + Luna demo on Apple Silicon.

```bash
npm ci
./laya/setup.sh
codex login
npm run dev -- --hostname 127.0.0.1
```

Open [http://localhost:3000](http://localhost:3000). Local Laya classifies the supplied calendar; real `gpt-6-luna` calls use your authenticated Codex CLI. Setup requires `uv`, the Hugging Face `hf` CLI, and Codex. There is no fake pricing fallback on the homepage.

The homepage uses the consolidated Ramp UI. Click **Run Jev** to watch events sort into No funding, Needs funding, and Dubious, then **Run Luna** to price only the candidates. Open an event for rationale, history, approval, and actual-spend feedback. **Cards & calendar** retains the team's calendar sync and card simulator. **Context** contains the money and workload controls; the full JSON/data harness remains at `/harness`.

On this configured Mac, **Live models** calls actual local Laya and authenticated gpt-6-luna. **Verified replay** plays captured real model outputs quickly and is explicitly labeled. Vercel defaults to replay because its serverless runtime has no local Apple GPU or Codex login. Replays reject changed facts; live mode accepts custom v1.0 JSON. Both the ordinary and $120-wallet recordings enforce policy and cumulative funds.

The original Figma source is retained in `UI FOLDER/` as a separate Vite project; the Next.js application uses the team's port in `components/RampAllotApp.tsx`. The safeguard branch has also been merged, including atomic hosted-budget writes and charge idempotency.

The calendar-driven Ramp app runs at [http://localhost:3000/classic](http://localhost:3000/classic), and at `/` on Vercel. The walkthrough and pipeline below describe that route. It needs Google sign-in; Claude is optional.

Other scripts:

```bash
npm test        # pipeline tests
npm run lint    # ESLint
npm run build   # production build
```

## Walkthrough

Everything runs on the signed-in user's own Google Calendar. Each browser has its own session, and each Google account has its own budgets, approvals, and charges.

1. **Sign in.** Click "Sign in with Google" and grant read-only calendar access; see [Google sign-in](#google-sign-in). The app reads your next 7 days and runs them through Jev and the pricer straight away. Your name, email, and company domain come from your Google account. Set your home city under "Calendar sync" so travel days and per diems are counted correctly. Options → "Refresh events" reads the calendar again and keeps decisions on events that haven't changed.
2. **Browse the table.** "Overview", "Needs review", "Live", and "No budget" organize the event rows by budget status. "Live" means an approved mock limit, not a real Ramp card or a guarantee that its time window is currently open. Search titles, descriptions, locations, cities, or attendees; Filter narrows the view by category or low confidence.
3. **Inspect and review.** Click an event name or Details to open its drawer. It shows context, attendees, Jev reasoning, pricing source, policy cap, card window, and simulated spending. Edit the amount, approve the budget, or select "No budget for this event" to reject it. Edits are clamped to policy, and $0 rejects the budget. Row checkboxes and the footer Select menu support bulk review.
4. **Use Options.** "Approve all budgets" approves budgeted events except ones already rejected. "Export visible events" downloads the current filtered rows as CSV. "Clear approvals and re-price" discards your decisions and charges and prices the calendar from scratch.
5. **Try the Card simulator.** Open the card icon or Options → "Simulate a card charge". Once budgets are approved, two presets are built from your calendar: one that overspends the first solo meal and one that fits inside the biggest meal. On the fixture week from `npm run seed:google` they are:
   - **$90 at 1:00 PM on Tuesday** is declined: "Solo lunch is capped at $25. This card can't borrow from Dinner with Acme."
   - **$180 at 7:30 PM on Tuesday** is approved against the Acme dinner, leaving $60 on that mock limit, and produces an event-linked mock expense line.

   The form below the presets takes an approved event, merchant, and amount, and simulates the attempt at that event's start time. Recent attempts and event drawers show the result. No money moves and no receipt is uploaded or matched.
6. **Read the footer.** It shows visible and total event counts and the budgeted amount versus the modeled baseline. This compares planned budgets, not real expenditure.

"Sign out" in Calendar sync revokes the Google token and ends the session; your budgets stay saved for the next sign-in. Card charges are always simulated.

### What the fixture week produces

`npm run seed:google` copies a fixture week onto your calendar. It belongs to Maya Chen at Northwind, who is based in Waterloo, with events at home on Monday and Friday and a New York visit with the Acme account from Tuesday to Thursday. Set your home city to Waterloo to reproduce these results.

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
2. If several are open, decline unless the request names one `eventId`. Budgets cannot be pooled or guessed.
3. If the charge is more than what's left on that limit, decline and name the event it can't borrow from.
4. Otherwise approve the simulated attempt, add it to the mock limit's spend, and write an expense line linked to the event. No receipt matching is performed.

Spend accumulates, so two distinct charges against the same dinner share its limit. The last 12 attempts are displayed; idempotency receipts are retained separately.

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

Everything is optional. Copy `.env.example` to `.env.local` and fill in what you need, then restart `npm run dev`.

```bash
cp .env.example .env.local
```

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude sets budget amounts. Without it, policy rates are used |
| `ANTHROPIC_MODEL` | Defaults to `claude-sonnet-4-5` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Turns on real Google sign-in and calendar sync |
| `GOOGLE_REDIRECT_URI` | Defaults to `<current origin>/api/auth/google/callback` |
| `COMPANY_DOMAIN` | Email domain that counts as internal. Defaults to the signed-in user's domain |
| `COMPANY_NAME` | Display name for the company |
| `HOME_CITY` | Default home city for new users. Each user can change theirs under Calendar sync |
| `SESSION_SECRET` | Encrypts session cookies. Defaults to a key derived from `GOOGLE_CLIENT_SECRET` |

### Google sign-in

Google credentials are required: without them, the app shows a sign-in page explaining what to configure.

**1. Set up Google Cloud (once, about 10 minutes)**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Go to **APIs & Services → Library**, search for **Google Calendar API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer consoles):
   - Audience: **External**, publishing status **Testing**.
   - Add the scopes `openid`, `email`, `profile`, `.../auth/calendar.readonly`, and `.../auth/calendar.events`. The last one is only used by the seed script.
   - Under **Test users**, add every Google account that will sign in: your own, your teammates', and the demo account.
4. Go to **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`. Add one for each other origin you use, such as a deployed URL.
5. Copy the client ID and secret into `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

In Testing mode, Google shows an "unverified app" warning on the consent screen. Click **Continue**. Only listed test users can sign in, and refresh tokens expire after 7 days, so you'll be asked to sign in again after that.

**2. Sign in**

Click **Sign in with Google** and approve read-only calendar access. You're sent back to the page you started from, and your next 7 days sync automatically.

**3. Load the fixture week onto a calendar (optional, for a predictable demo)**

A real calendar is unpredictable. For a demo, sign in locally with a dedicated Google account and copy the fixture week onto it:

```bash
# 1. Grant write access once, in the browser:
open http://localhost:3000/api/auth/google?write=1

# 2. Copy the 16 fixture events, starting tomorrow:
npm run seed:google

# Or pick the first day, or remove the seeded events:
npm run seed:google -- --start 2026-10-12
npm run seed:google -- --clear
```

The script tags every event it creates, so running it again replaces the old copies instead of duplicating them. It never sends invitations. Teammates are added as plus-addresses of your own mailbox, such as `you+priya@gmail.com`, so they count as internal. Clients get `.example` addresses, such as `elena.voss@acme.example`, so they count as external. Times are set in Eastern time.

After seeding, click **Sign out**, then sign in again without `?write=1`, so the app itself only holds read access.

### How sync reads a Google Calendar

- Sync reads the primary calendar from now to 7 days out, with recurring events expanded, up to 50 events.
- Cancelled events, events you declined, and meeting rooms in the attendee list are skipped. HTML in descriptions is stripped.
- Only timed events with valid, explicit-offset start and end timestamps are imported. All-day/date-only events are skipped rather than assigned invented hours, so they cannot create spending windows.
- Each event's city is inferred from its location and title. Anything unrecognized is treated as the home city, so put a city name such as "New York" in the location of travel events.
- Attendees on the company domain are internal and everyone else is external. On a personal Gmail account, that means other Gmail users count as internal, so set `COMPANY_DOMAIN` if that matters.
- An empty calendar shows "No events in the next 7 days". If Google can't be reached, sync reports the error and keeps the last synced events. If Google rejects the token, the session ends and you're asked to sign in again.

### How sessions and tokens are handled

- The sign-in flow uses a random `state` value, stored in an HTTP-only cookie for 10 minutes, to reject forged callbacks.
- Access and refresh tokens live in an `allot_session` cookie, encrypted with AES-256-GCM. The cookie is HTTP-only, so page scripts can't read it, and it lasts 30 days. The server never stores tokens, so sign-in works on Vercel without a database.
- Budgets, approvals, and charges are stored per Google account, under `state:<email>`.
- Access tokens are refreshed automatically when they're within a minute of expiring.
- **Sign out** revokes the token with Google and deletes the cookie.
- In local development only, the latest sign-in is also written to `data/google.json` (gitignored, owner-only permissions) so `npm run seed:google` can use it.

### Notion event context

Notion is a read-only connector to the shared `EventSnapshot` v1.0 format in `protocol/budget.schema.json`. It reads a selected database/data source; it does not change Notion pages, approve budgets, or merge events into the current Calendar demo state.

1. Create a Notion API connection with **Read content** only, and share only the intended event database with it. Browser sign-in alone does not give the server API access.
2. Set `NOTION_TOKEN` and `NOTION_DATABASE_ID` (or `NOTION_DATA_SOURCE_ID`) in gitignored `.env.local`. Keep `NOTION_IS_SIMULATED=true` for the supplied synthetic data. For deployment, configure the same server-only variables and redeploy.
3. In **Calendar sync → Notion context**, choose **Export Notion events**, or run:

```bash
npm run sync:notion -- --simulated --output data/harness/notion-snapshot.json
python protocol/validate.py data/harness/notion-snapshot.json
```

The CLI uses the existing October demo subject, policy, and window. Supply `--template snapshot.json` to use another valid subject/policy/window, or override `--start` and `--end` with explicit-offset timestamps. Exported files under `data/harness/` are ignored by Git.

Import `data/demo/notion-events.csv` into a Notion database for eight synthetic event plans. Map **Start** and **End** to Text so their full ISO timestamps and offsets are retained. The remaining columns describe location, participant counts, purpose, attendance, status, and explicit expense facts. `Expense facts` is a JSON array: `[]` confirms no expense; `null` means unknown. Cancelled records remain cancelled in the unified JSON.

`GET /api/integrations/notion` exports the canonical JSON; `?download=1` adds an attachment filename. `?status=1` reports configuration without exposing credentials. `?diagnostics=1` reports skipped or out-of-window rows separately, and export headers also include skipped counts. Untimed or invalid rows are skipped with diagnostics rather than assigned invented spending windows.

## Deployment

The consolidated Ramp homepage runs the funding pipeline everywhere. It uses local live providers on the configured Mac and explicitly labeled verified replay on Vercel. The `/harness` route retains the detailed developer harness.

Production runs on Vercel at [allot-ramp.vercel.app](https://allot-ramp.vercel.app), in the `fionacais-projects/allot` project. Every push to `main` deploys automatically through the GitHub connection.

**Storage.** Vercel can't keep files between requests, so each user's state goes to Upstash Redis when `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) are set. Without them, a deployment stores state in its temp directory, which is lost whenever Vercel starts a new instance, and the calendar connections panel shows a warning. Locally, everything stays in `data/`.

To connect Redis, accept the Upstash terms for the team once in the browser, then run:

```bash
vercel integration add upstash/upstash-kv --name allot-kv
```

This creates the database, adds its variables to every environment, and pulls them into `.env.local`. Redeploy afterwards.

**Environment variables.** Set them with `vercel env add NAME production`, or in the project settings, then redeploy:

- `ANTHROPIC_API_KEY`, to have Claude set budgets.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, for Google sign-in.
- `GOOGLE_REDIRECT_URI=https://allot-ramp.vercel.app/api/auth/google/callback`, so sign-in works the same from any of the project's URLs. Add the same URI to the OAuth client in Google Cloud.

**Access.** Vercel's Deployment Protection puts the generated `*-fionacais-projects.vercel.app` URLs behind a Vercel login. `allot-ramp.vercel.app` is a production domain, so it's public.

## API

The app's data goes through one route, `app/api/events/route.ts`. Google sign-in uses two more:

- `GET /api/auth/google` redirects to Google's consent screen. Add `?write=1` to also request event write access for the seed script.
- `GET /api/auth/google/callback` exchanges the code for tokens, sets the session cookie, and redirects back to the page that started sign-in. On failure it adds `?google_error=<reason>`, and the app shows a message.

Every `/api/events` request acts as the session's Google account. Without a session it returns status 401 with `{ "error", "signedIn": false, "googleConfigured" }`.

`GET /api/events` returns the user's state: the employee, the sync window, every event with its Jev decision, budget, approval, and limit, recent charges, the summary once synced, and the storage backend.

`POST /api/events` takes a JSON body with an `action` and returns the same state:

| Action | Body | Effect |
| --- | --- | --- |
| `sync` | — | Reads the Google Calendar, runs Jev and pricing, and preserves spending and charge history |
| `profile` | `{ "homeCity" }` | Sets the user's home city |
| `decide` | `{ "all": true }` | Approves every pending budget |
| `decide` | `{ "eventId", "approval" }` | Sets one budget to `approved`, `rejected`, or `pending` |
| `decide` | `{ "eventId", "amount" }` | Edits one budget, clamped to its cap. `0` rejects it |
| `charge` | `{ "amount", "time", "merchant", "eventId"?, "requestId"? }` | Authorizes a mock charge. `time` includes an explicit offset; `amount` is $0.01–$10,000 in cents. Use a stable `requestId` for retries |
| `reset` | — | Clears the user's events and charges. Stays signed in |
| `signout` | — | Revokes the Google token and ends the session. Saved state is kept |

Errors come back as `{ "error": "..." }`, with status 400 for bad input, 401 when signed out, 409 for a conflicting write or charge request ID, 502 when Google Calendar fails, and 500 for anything unexpected.

Each Google account's state is stored in Redis when configured, otherwise in gitignored `data/state:<email>.json` locally. Writes use compare-and-set so concurrent hosted requests cannot overwrite newer spending. Charge requests retry against fresh state; stale sync or approval writes return HTTP 409 and can be retried after refreshing.

Removed or cancelled source events are archived: their spending history remains, but they cannot be approved or charged. If the event returns in the source, it requires fresh review and retains its prior spending.

Send a stable `requestId` with each logical charge. Repeating the same ID and payload returns the original charge without another debit. Reusing the ID for a different payload returns HTTP 409. Receipts persist independently of the 12 most recent displayed attempts and are cleared with the account's state.

## Project layout

| Path | What it is |
| --- | --- |
| `app/page.tsx` | Renders the app |
| `app/api/events/route.ts` | The API: sync, profile, decide, charge, reset, sign out |
| `app/api/auth/google/route.ts` | Starts Google sign-in |
| `app/api/auth/google/callback/route.ts` | Finishes Google sign-in and sets the session cookie |
| `lib/session.ts` | Encrypted session cookie holding the Google tokens |
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
| `lib/calendar.ts` | Google Calendar sync and event mapping |
| `lib/google.ts` | OAuth URLs, token exchange, refresh, and revoke |
| `lib/seed.ts` | Fixture week for tests and the seed script |
| `lib/policy.ts` | Policy loader and city lookup |
| `lib/attendees.ts` | Internal vs. external attendees |
| `lib/time.ts` | Eastern-time formatting and meal slots |
| `lib/presets.ts` | The two demo charges, built from the calendar |
| `scripts/seed-google-calendar.ts` | Copies the fixture week onto a Google Calendar |
| `.env.example` | Every environment variable |
| `lib/store.ts` | Per-user state, and the employee profile from Google |
| `lib/types.ts` | Shared types |
| `data/policy.json` | Caps, per diems, limit windows, city rates |

Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, and TypeScript.

## Testing

The standardized connector JSON and file-based Jev harness are documented in
[`protocol/README.md`](protocol/README.md). They include a validated monthly
fixture, 500 conditioned dummy samples, expected gate labels, and an optional
local Laya backend.

```bash
npm run harness -- --expected data/demo/expected.json --fail-on-mismatch
npm run data:sample -- --count 1000 --seed 7
npm run test:protocol
```

```bash
npm test
```

`lib/pipeline.test.ts` covers:

- Jev on the seeded events, including the vague "catch up", a client dinner with no meal word in its title, and internal or video-call events that shouldn't get money
- policy-rate prices and the clamp
- home-city events: the client lunch, the team dinner, and the candidate coffee
- the weekly totals, and that savings equal the unused per diem
- charge authorization: the declined $90 lunch, the approved $180 dinner, and a charge at home
- Google event mapping: rooms, HTML descriptions, cancelled and declined events, all-day events, home-city defaults, and internal teammates on the signed-in domain

The tests use policy-rate pricing and never call Claude or Google.

## Limitations

This is a hackathon build. Not done yet:

- **Google app is unverified.** It runs in Testing mode, so only listed test users can sign in, and they have to sign in again every 7 days.
- **Ramp is mocked.** Limits and authorizations run in `lib/ramp.ts` and have the shape a real spend-limit integration would need.
- **No roles.** Each Google account sees only its own events, but there is no separate manager view: the employee approves their own budgets.
- **Eastern time only.** Meal times and display use `America/New_York`, and the charge form assumes the `-04:00` offset.
- **USD only.**
- **No receipts or real payments.** Approved simulated charges produce an event-linked mock expense line. There is no receipt upload or matching; the CSV export contains event rows, not receipts.
- **No ad hoc events.** Events come from the calendar; there's no form to add an unplanned one.
