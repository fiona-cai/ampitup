"""Classify short English text with the local Laya checkpoint."""

import argparse
import json
from pathlib import Path

import laya_mlx


MODEL_DIR = Path(__file__).resolve().parent / "models" / "english"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", help="Short English text to classify")
    parser.add_argument(
        "--labels",
        nargs="+",
        default=["billing", "technical", "sales"],
        help="Candidate categories (default: billing technical sales)",
    )
    parser.add_argument(
        "--question",
        default="Which category best describes this message?",
        help="Question that defines the classification task",
    )
    args = parser.parse_args()

    if not (MODEL_DIR / "model.safetensors").is_file():
        parser.error("model is missing; run ./setup.sh from the laya folder first")

    agent = laya_mlx.load(str(MODEL_DIR))
    result = agent.predict(
        args.text,
        {
            "category": {
                "type": "choice",
                "instructions": args.question,
                "criteria": args.labels,
            }
        },
    )
    print(json.dumps(result["answers"]["category"], indent=2))


if __name__ == "__main__":
    main()

