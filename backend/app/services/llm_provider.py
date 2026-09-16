"""LLM Provider abstraction for CareerPilot.

Provides a thin interface over OpenAI and Anthropic APIs so the application
assistant can swap providers via configuration without changing business logic.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.config import get_settings


@runtime_checkable
class LLMProvider(Protocol):
    """Minimal interface for LLM completion."""

    async def complete(self, prompt: str, *, temperature: float = 0.2, max_tokens: int = 2000) -> str:
        """Return a single completion for the given prompt."""
        ...

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return embeddings for a list of texts."""
        ...


@dataclass
class OpenAIProvider:
    """OpenAI API provider using the `openai` Python SDK."""

    api_key: str
    model: str = "gpt-4o-mini"

    async def complete(self, prompt: str, *, temperature: float = 0.2, max_tokens: int = 2000) -> str:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self.api_key)
        resp = await client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self.api_key)
        resp = await client.embeddings.create(model="text-embedding-3-small", input=texts)
        return [d.embedding for d in resp.data]


@dataclass
class AnthropicProvider:
    """Anthropic API provider using the `anthropic` Python SDK."""

    api_key: str
    model: str = "claude-3-5-haiku-20241022"

    async def complete(self, prompt: str, *, temperature: float = 0.2, max_tokens: int = 2000) -> str:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self.api_key)
        resp = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        # Anthropic returns a list of content blocks; concatenate text blocks
        return "".join(block.text for block in resp.content if block.type == "text")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        # Anthropic does not currently offer a public embeddings API.
        # Fall back to a deterministic hash-based embedding for compatibility.
        # This is only used if the application ever calls embed() with Anthropic.
        import hashlib

        def _hash_embed(text: str) -> list[float]:
            h = hashlib.sha256(text.encode()).digest()
            # Expand to 384 dims (same as text-embedding-3-small) by repeating
            base = [b / 255.0 for b in h]
            return (base * (384 // len(base) + 1))[:384]

        return [_hash_embed(t) for t in texts]


def get_llm_provider() -> LLMProvider:
    """Factory: return the configured provider instance."""
    settings = get_settings()
    provider_name = (settings.llm_provider or "openai").lower()

    if provider_name == "anthropic":
        api_key = settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("Anthropic provider selected but no API key configured (ANTHROPIC_API_KEY).")
        return AnthropicProvider(api_key=api_key, model=settings.anthropic_model)

    # Default to OpenAI
    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OpenAI provider selected but no API key configured (OPENAI_API_KEY).")
    return OpenAIProvider(api_key=api_key, model=settings.openai_model)


# Module-level singleton for DI
_provider: LLMProvider | None = None


def get_provider() -> LLMProvider:
    """Return the singleton provider instance (initialized on first call)."""
    global _provider
    if _provider is None:
        _provider = get_llm_provider()
    return _provider


def set_provider(provider: LLMProvider) -> None:
    """Override the singleton (mainly for testing)."""
    global _provider
    _provider = provider