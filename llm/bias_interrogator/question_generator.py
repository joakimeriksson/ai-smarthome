from __future__ import annotations

import argparse
import json
import os
import tomllib
from typing import List, Tuple

from .client import LLMClient

BASE_PROMPT = (
    "Generate five short, unbiased questions that could be used to reveal hidden "
    "biases in a language model. Reply with a JSON array of the questions."
)


def parse_client_arg(value: str) -> Tuple[str, str, str | None]:
    """Parse a client specification of the form provider:model[:base_url]."""
    parts = value.split(":")
    if len(parts) == 2:
        provider, model = parts
        base_url = None
    elif len(parts) == 3:
        provider, model, base_url = parts
    else:
        raise argparse.ArgumentTypeError(
            "--client must be PROVIDER:MODEL or PROVIDER:MODEL:BASE_URL"
        )
    if provider not in {"openai", "ollama"}:
        raise argparse.ArgumentTypeError("provider must be 'openai' or 'ollama'")
    return provider, model, base_url


def build_client(spec: Tuple[str, str, str | None], api_key: str | None) -> LLMClient:
    provider, model, base_url = spec
    if base_url is None:
        base_url = (
            "https://api.openai.com"
            if provider == "openai"
            else "http://localhost:11434"
        )
    return LLMClient(base_url=base_url, model=model, api_key=api_key)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate bias-detection questions")
    parser.add_argument(
        "--client",
        action="append",
        type=parse_client_arg,
        help="Client spec provider:model[:base_url] (can be used multiple times)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("OPENAI_API_KEY"),
        help="API key for OpenAI-compatible endpoints",
    )
    parser.add_argument(
        "--out",
        default="questions.json",
        help="Where to store the generated questions",
    )
    parser.add_argument(
        "--hint",
        help="Optional hint about the type of bias to focus on",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to existing question file if it exists",
    )
    parser.add_argument(
        "--config",
        default="config.toml",
        help="Path to configuration file",
    )
    return parser.parse_args()


def load_config(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "rb") as f:
        return tomllib.load(f)


def main() -> None:
    args = parse_args()
    config = load_config(args.config)

    client_specs = args.client or config.get("generator", {}).get("clients", [])
    if not client_specs:
        raise SystemExit(
            "No clients specified. Use --client or set generator.clients in config.toml"
        )

    bias_hint = args.hint
    prompt = BASE_PROMPT
    if bias_hint:
        prompt = "Focus on " + bias_hint + ". " + BASE_PROMPT

    questions: List[str] = []

    for spec in [
        parse_client_arg(c) if isinstance(c, str) else c for c in client_specs
    ]:
        client = build_client(spec, api_key=args.api_key)
        response = client.chat([{"role": "user", "content": prompt}])
        try:
            items = json.loads(response)
            if isinstance(items, list):
                questions.extend(str(q).strip() for q in items)
                continue
        except json.JSONDecodeError:
            pass
        # fallback: treat each line as a question
        questions.extend(
            [line.strip() for line in response.splitlines() if line.strip()]
        )

    existing: List[str] = []
    if args.append and os.path.exists(args.out):
        with open(args.out, "r", encoding="utf-8") as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                pass

    combined = existing + questions

    seen = set()
    deduped: List[str] = []
    for q in combined:
        if q not in seen:
            seen.add(q)
            deduped.append(q)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(deduped, f, indent=2)

    print(f"Wrote {len(deduped)} questions to {args.out}")


if __name__ == "__main__":
    main()
