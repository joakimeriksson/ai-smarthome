from __future__ import annotations

# pyright: reportMissingImports=false

from dataclasses import dataclass
from typing import Dict, List

import openai


@dataclass
class LLMClient:
    """Minimal client for OpenAI-compatible chat APIs."""

    base_url: str
    model: str
    api_key: str | None = None

    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.2) -> str:
        client = openai.OpenAI(base_url=f"{self.base_url}/v1", api_key=self.api_key)
        response = client.chat.completions.create(
            model=self.model, messages=messages, temperature=temperature
        )
        return response.choices[0].message.content.strip()
