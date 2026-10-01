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

## Jev harness

Install Node dependencies with `npm ci`. Run the bundled fixture with independently
authored expected labels, or point at another v1.0 snapshot:

```sh
npm run harness -- --expected data/demo/expected.json --fail-on-mismatch
npm run harness -- --input path/to/snapshot.json --output data/harness/custom.json
npm run test:protocol
```

The report includes each original gate request, its derived context, the existing
Jev decision, the final gate, label totals, and an optional confusion matrix.
`--expected` accepts a JSON object mapping event IDs to `needs_budget`, `no_budget`,
or `needs_review`. Only labeled events are scored; unknown IDs or labels are
rejected. `--fail-on-mismatch` exits with status 1 for regression failures. Without
expected labels, accuracy is `null`. Demo fixture results do not establish accuracy
on real calendars. Re-author fixture labels when intentionally changing the demo.

Confirmed connector facts take precedence: cancelled, declined, and personal
events receive no work budget; unknown purpose/attendance/coverage needs review;
an unpaid expense remains eligible even when another expense is covered. If
expense facts are unknown, the harness records the raw Jev decision and routes
the event to review before funding. Busyness does not itself justify spending.

The batch bridge calls the real `lib/jev.ts`, with the event's time zone and
reserved participant email domains derived from known counts. These are projection
placeholders, not inferred identities. Unknown counts skip the Jev projection.
The `mock` backend identifies Jev's deterministic gate encoding: its one-hot
distribution is not a model probability or accuracy estimate. `policy_guard`
also uses deterministic encodings. This leaves the v1.0 wire schema unchanged.

### Optional local Laya comparison

```sh
./laya/setup.sh
npm run harness -- --backend laya --output data/harness/laya.json
```

Laya handles events whose structured facts do not already settle the gate. It
receives a compact serialization of event facts, day/week load, transition
pressure, and funding scope. The checkpoint is loaded once per run. The report
retains raw probabilities, token counts, and truncation flags. Truncation or a
top-class probability below `--min-confidence` (default `0.75`) forces review.
Unknown expense coverage still needs confirmation regardless of model confidence.
Inference runs locally; the harness does not download a model or call cloud APIs.

## Conditioned dummy data

[`../data/demo/samples.json`](../data/demo/samples.json) contains 500 generated
events using seed 42. Generate more from the demo or any valid snapshot:

```sh
npm run data:sample -- --count 500 --seed 42 --output data/demo/samples.json
npm run data:sample -- --input path/to/snapshot.json --count 1000 --seed 7 \
  --start 2026-11-01 --days 30 --output data/harness/custom-samples.json
npm run harness -- --input data/harness/custom-samples.json
```

The sampler preserves supplied policy, event types, missing facts, expense
coverage, and participant counts. It samples events with replacement, assigns
new synthetic IDs/provenance, reschedules within the requested window, and varies
positive expense estimates by up to 20%. The same input/options reproduce the
same snapshot. All-day boundaries and daylight saving offsets are validated.
This is fixture augmentation, not model training or unrestricted JSON ingestion:
adapt other formats to the standardized snapshot first. Supplied titles and
descriptions are retained, so sampling real data does not anonymize that text.
Generated fixtures do not automatically receive ground-truth labels.

Harness reports are ignored under `data/harness/`; the bundled demo fixtures are
tracked so other contributors can pull and use them immediately. This CLI harness
does not modify the web demo's stored state, price events, or issue cards.
