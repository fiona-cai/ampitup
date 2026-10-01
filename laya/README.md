# Local Laya classifier

This folder runs the open-weight English [Laya](https://github.com/NandhaKishorM/laya) checkpoint locally on Apple Silicon through the [Laya-MLX](https://github.com/mizorewww/laya-mlx) runtime. The MLX runtime is an independent port of the original model. Laya answers typed text questions: category choices, ordinal scores, and yes/no probabilities. This example uses category choices. It is not a chat model.

## Run

From this folder, with `uv` and `hf` on your PATH:

```sh
./setup.sh
uv run --offline python classify.py "I was charged twice. Please refund me."
uv run --offline python classify.py "The app crashes at login" --labels billing technical sales
```

For your own categories, provide labels and a question:

```sh
uv run --offline python classify.py "Please cancel my plan" \
  --labels cancellation billing support \
  --question "Which team should handle this request?"
```

The virtual environment and model files stay in this folder and are ignored by Git. The checkpoint is about 843 MB; the tracked example remains small. After setup, inference reads the local checkpoint and needs no network connection. English input is limited to 512 total tokens shared by the text, question, and labels. The output probabilities are model estimates and should be checked against real examples before using them for important decisions.
