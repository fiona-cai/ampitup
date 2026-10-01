# ContextCard

ContextCard gives every business event its own right-sized budget, so spend matches the purpose of the event instead of a daily allowance.

It reads the calendar, decides which events need company money, prices each one, and turns each approved budget into a card limit that is only open around that event.

https://www.figma.com/board/FSOjXIOANdMZn3smWq5CCk/Ramp-it-Up?node-id=0-1&p=f&t=JhBuY6XVh6eyKl32-0

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The demo runs end to end with no keys: sign in, sync, approve the trip, then try the `$90 at 1:00 PM` charge against the $25 lunch.

`Reset demo` in the header clears the trip. State is kept in `data/state.json`, which is gitignored.

```bash
npm test
```

## Environment

All optional. Create `.env.local`:

```bash
# Claude sets the budget amounts. Without a key, policy rates are used.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# Pull the next 7 days from a real Google Calendar instead of the seeded trip.
CALENDAR_SOURCE=google
GOOGLE_ACCESS_TOKEN=
```

The Google token needs the `calendar.readonly` scope. If the call fails or returns no events, sync falls back to the seeded New York trip.

## How a budget is decided

1. **Jev** (`lib/jev.ts`) decides whether an event needs money at all. Clear cases are rules: prepaid or catered events, meals included in registration, focus blocks, and internal meetings get no budget, while rides and named meals do. Anything left is scored on external attendees, a meal-time start, and a physical location. Vague titles like "catch up" are flagged low confidence and default to the standard per diem.
2. **Claude** (`lib/price.ts`) sets the amount for events that pass Jev. It receives only the fields needed to price the event and returns JSON with an amount and a one-line reason.
3. **Policy clamp.** The cap is computed in code from `data/policy.json`, and every amount is clamped to it, including manager edits. The model can't exceed policy.
4. **Review.** A manager can approve the whole trip, or approve, edit, or reject single events.
5. **Enforce** (`lib/ramp.ts`). Each approved budget becomes a mock Ramp spend limit that opens 45 minutes before a meal (30 before a ride) and closes 90 minutes after (45 after a ride). A charge can only spend the limit open at that moment, so a lunch can't borrow from a dinner.

## Layout

| Path | What it is |
| --- | --- |
| `app/api/trip/route.ts` | Connect, sync, decide, charge, reset |
| `components/ContextCardApp.tsx` | Trip view, approval, charge simulator, savings summary |
| `lib/seed.ts` | Seeded 3-day New York trip |
| `lib/calendar.ts` | Google Calendar `events.list` sync |
| `lib/summary.ts` | Per diem vs. ContextCard totals |
| `data/policy.json` | Meal caps, client entertainment cap, city rates |
