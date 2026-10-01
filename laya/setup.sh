#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
uv sync --python 3.12 --frozen
hf download aac6fef/laya-mlx \
  --revision 20aed815fc6acde75733882e7ec0e3f28aeb9717 \
  --local-dir models/english
