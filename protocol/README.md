# Standardized event and budget JSON — v1.0

Start with [`examples/event-snapshot.json`](examples/event-snapshot.json).
[`budget.schema.json`](budget.schema.json) is the authoritative JSON Schema
(Draft 2020-12); [`../lib/budget-protocol.ts`](../lib/budget-protocol.ts) provides
matching TypeScript types. The schema version is `"1.0"`.

Connectors normalize their data into an `EventSnapshot`. The gate consumes a
`BudgetGateRequest` per event: the normalized event, its derived calendar
context, and the snapshot's policy. A `BudgetPricingRequest` adds the gate result
and remaining limits. The pricer returns a `BudgetProposal`; approval and card
issuance happen separately. The current web demo still uses `CalendarEvent`.

## Contract rules

- All amounts ending in `Minor` are integer minor units of `policy.currency`
  (for example, `2800` means USD 28.00). Category caps apply to the entire event,
  including all beneficiaries, and are not multiplied by participant count.
- `expenses: null` means unknown expense facts. `expenses: []` means confirmed
  no expected expense. Coverage belongs to each expense line: a provided lunch
  can coexist with an unpaid taxi. Do not mark the entire event paid.
- Keep unknown facts as `null` or the field's `"unknown"` enum. `missingFields`
  contains event-relative JSON pointers to unknown facts, not fabricated values.
- Use stable, namespaced event IDs. Edits keep their ID; recurring instances
  get distinct IDs. Merge duplicate connector records into one event and keep
  each original record in `sources`.
- Timestamps must include their UTC offset. Schedule offsets must agree with
  the IANA `timeZone`; all-day boundaries are local midnight. Snapshot windows
  include their start and exclude their end.
- Preserve cancelled events, declined attendance, and personal events as facts;
  they must not be funded from the work policy.
- Schedule load excludes cancelled/declined events, unions overlapping timed
  events, and counts all-day events separately. `complete: false` marks a partial
  day or week at the snapshot boundary. Travel minutes are supplied estimates.
- `needs_review` is a distinct gate outcome. Gate `confidence` is the probability
  of `rawLabel`, not measured accuracy. `label` can be changed by a review guard
  without changing the raw probabilities. `mock` probabilities are synthetic.
- Consumers should validate before processing. Unknown object properties are
  rejected so connector mistakes are visible. Changes to wire shapes require a
  new schema version and coordinated consumer updates.

## Validate and generate

From the repository root, with Python 3.12+ and `uv` installed:

```sh
uv run --project protocol python protocol/validate.py \
  protocol/examples/event-snapshot.json data/demo/month.json

# Validate another wire type using its schema definition.
uv run --project protocol python protocol/validate.py gate.json --definition gate

# Regenerate the bundled deterministic October calendar and one-event example.
uv run --project protocol python protocol/generate_demo.py
```

[`../data/demo/month.json`](../data/demo/month.json) supplies a synthetic month
with varied workload, external guests, missing facts, partial expense coverage,
cancelled/declined events, personal events, and merged provenance. No real
accounts are needed. `context_for(event, snapshot)` in `context.py` derives the
day/week and transition features for a gate request.
