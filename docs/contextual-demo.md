# Contextual Laya + Luna demo

The homepage is the consolidated Ramp UI with an animated two-stage funding pipeline. Click Run Jev, then Run Luna; rationale and feedback live in event drawers. The detailed harness is at `/harness`. Live mode calls actual models; Verified replay is explicitly labeled and accepts only exact recorded contexts. It uses the synthetic LARP month (`data/demo/month.json`, 118 events), the seeded augmented calendar (`data/demo/samples.json`, 500 events), or an uploaded v1.0 snapshot. The reusable JSON template and schema are in `protocol/`; the wire contract is unchanged.

## Start

On Apple Silicon, install Node 20.9+, `uv`, the Hugging Face `hf` CLI, and Codex, then run:

```sh
npm ci
./laya/setup.sh
codex login
npm run dev -- --hostname 127.0.0.1
```

Open http://localhost:3000. The English Laya checkpoint and virtual environment are local, ignored assets; setup downloads the pinned checkpoint. Luna uses `gpt-6-luna` through the signed-in Codex CLI, without reading credentials into the app. Set `ALLOT_CODEX_BIN` if the CLI is installed at a custom path. This is a local Node application; its authenticated model endpoint should stay on localhost.

## Funding decision

1. `laya/contextual_gate.py` performs actual MLX inference on the Apple GPU. Its three labels map to the standard contract: **No funding at all** (`no_budget`), **Definitely needs funding** (`needs_budget`), and **Dubious** (`needs_review`). Each event receives a compact context containing calendar load, feasibility, wallet, purpose, costs, and relevant history. The UI exposes raw probabilities and any explicit guard override. Truncated or uncertain predictions become dubious. Cancelled, declined, personal, free, and fully covered events are guarded against funding. Confirmed unpaid costs cannot silently disappear behind an inconsistent no-funding prediction.
2. Only definite/dubious events are sent to real Luna. The batch includes detailed context, estimates, category policy, remaining funds, and relevant historical assignments. Luna returns amounts in integer minor currency units, expense lines, a specific rationale, history IDs actually used, and clarification questions. Invalid output or model failure surfaces an error; the app never substitutes a rule-generated result and calls it a successful model run.
3. Code aggregates duplicate category lines, applies category caps, and enforces remaining daily, weekly, and monthly funds. Priority accounts for importance and feasibility. Definite funded events reserve money; dubious proposals reserve nothing until explicitly approved. Rejection releases the reservation. Changing context and reallocating clears previous approvals. Reviews reuse the exact cached model result only when snapshot and settings match.

The inputs include duration, difficulty-weighted effort, importance, attendance, event status, business/personal scope, participants, location, coverage of each expense, overlaps, travel gaps, daily/weekly calendar occupancy, per-event capacity, weekly/monthly prior spending, daily prior spending through the API, and policy caps. Calendar arithmetic respects the employee timezone, midnight boundaries, and daylight-saving transitions.

## Memory and feedback

`data/jev-memory.json` stores recent proposals and model runs locally and is ignored by Git. Every allocation creates an assignment. Similarity considers expense category, title, city, importance, and participants; actual spending and feedback receive stronger weight than unverified proposals. Both Laya and Luna receive relevant history, and Luna must cite real supplied assignment IDs when it uses a pattern.

Use **Too low**, **About right**, **Too high**, and **Actual spend**, then run Laya + Luna again. This is persistent memory and feedback conditioning, not a weight-training pipeline. Previous model proposals remain explicitly unverified; neither repetitions nor self-generated rationales are treated as evidence of successful spending. The history panel shows recent assignments, while retrieval can use older relevant feedback within the retained 500 assignments.

## Test or integrate

`GET /api/demo` returns the default Laya-classified preview. `POST /api/demo` accepts `action` (`preview`, `allocate`, `feedback`, `clear_memory`), `snapshot` or `dataset`, partial `settings`, and optional cached `runId`/`approvals`. Feedback takes `{assignmentId, value, actualMinor?}`; monetary fields use minor currency units. Uploaded snapshots are validated against the authoritative JSON Schema and cross-field invariants before inference.

```sh
npm test
npm run test:protocol
npm run lint
npm run build
```

The existing Python CLI harness remains available through `npm run harness`; see `protocol/README.md` for generating and validating arbitrary synthetic snapshots. Cards & calendar preserves the team’s calendar/card workflow in the same app. On Vercel the pipeline uses verified recordings of real Laya/Luna runs; locally live mode runs those providers.

## Scope

The calendar and wallet are simulated. Approval changes local reservations; this route does not send payments, create cards, or synchronize bank balances. Actual spending is user-entered evidence. The checkpoint is used as downloaded, and model predictions still require review. The batch allocator limits a week to 80 funding candidates, with clear errors on unavailable providers or invalid outputs.

## Verified live run

On 2026-10-01, the October 5 week sent 29 events through local Laya and only 10 funding candidates through real Luna. The initial partner dinner proposal was $240. After recording “too low” feedback and $260 actual spending, a new live allocation proposed $260 and cited the corrected prior assignment: “a comparable prior proposal was marked too low against $260 actual spending.” The returned plan stayed within the weekly balance. These observations demonstrate memory conditioning; they do not claim checkpoint fine-tuning.
