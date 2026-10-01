"""Three funding outcomes, conditioned on event, wallet, feasibility and history."""

import json
import sys

import laya_mlx
from laya_mlx.common import build_prefix
from budget_gate import MODEL_DIR

QUESTION = {"funding": {
    "type": "choice",
    "instructions": "Should the company fund this event?",
    "criteria": {
        "Definitely needs funding": "The work event needs new money for an unpaid expense.",
        "No funding at all": "No expense, personal expense, or already paid.",
        "Dubious": "Not enough information or event cannot be attended.",
    },
}}


def state_for(row, settings, currency):
    event, context = row["event"], row["context"]
    costs = event["expenses"]
    coverage = "Expected expenses and coverage are unknown." if costs is None else (
        "Confirmed no expected expenses." if not costs else "; ".join(
            f"{line['category']} {line['coverage'].replace('_', ' ')}; estimated "
            f"{line['estimatedAmountMinor'] / 100 if line['estimatedAmountMinor'] is not None else 'unknown'} {currency}"
            for line in costs))
    remaining = row["remainingBefore"]
    history = "; ".join(
        f"{past['category']} proposed {past['amountMinor'] / 100}; actual "
        f"{past['actualMinor'] / 100 if past['actualMinor'] is not None else 'unobserved'}; feedback {past['feedback'] or 'none'}"
        for past in row["history"][:2]) or "No comparable prior assignments."
    return (
        f"Event: {event['title']}. {event['purpose']['scope']} purpose; {event['status']}; attendance {event['attendance']}. "
        f"Expenses: {coverage}. "
        f"Importance {event['purpose']['importance']}; difficulty {event['purpose']['difficulty']}; duration {context['durationMinutes']} minutes. "
        f"Participants {event['participants']['totalCount']}, external {event['participants']['externalCount']}. "
        f"Location {event['location']['mode']} in {event['location']['city'] or 'unknown city'}. "
        f"Schedule conflicts {len(row['feasibility']['conflicts'])}; travel shortfall {row['feasibility']['travelShortfallMinutes']} minutes. "
        f"Busy today {context['day']['busyMinutes']/60:.1f} hours (limit {settings['maxDailyHours']}); "
        f"busy week {context['week']['busyMinutes']/60:.1f} hours (limit {settings['maxWeeklyHours']}). "
        f"Available {currency}: today {remaining['dailyMinor']/100}, this week {remaining['weeklyMinor']/100}, this month {remaining['monthlyMinor']/100}. "
        f"Earlier assignments (proposals are not proof of success): {history}"
    )


def main():
    payload = json.load(sys.stdin)
    agent = laya_mlx.load(str(MODEL_DIR))
    prefix, _ = build_prefix(agent.tok, agent._to_internal(QUESTION["funding"]), agent.cfg.get("head_max_len", 192))
    room = agent.cfg.get("max_len", 512) - len(prefix) - 1
    result = {}
    for row in payload["events"]:
        state = state_for(row, payload["settings"], payload["currency"])
        token_count = len(agent.tok(state.replace(agent.tok.mask_token, " "))["input_ids"])
        prediction = agent.predict(state, QUESTION)
        labels = {"Definitely needs funding": "needs_budget", "No funding at all": "no_budget", "Dubious": "needs_review"}
        probabilities = {labels[key]: value for key, value in prediction["answers"]["funding"]["probabilities"].items()}
        total = sum(probabilities.values())
        probabilities = {key: value / total for key, value in probabilities.items()}
        selected = max(probabilities, key=probabilities.get)
        result[row["event"]["id"]] = {"rawLabel": selected, "probabilities": probabilities,
            "confidence": probabilities[selected], "inputTokens": prediction["usage"]["input_tokens"],
            "truncated": token_count > room, "override": None}
    json.dump(result, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
