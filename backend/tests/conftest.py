"""Shared test configuration.

All ASGI test clients appear to the app as the same peer identity, so every
test shares the one in-process rate limiter. To keep tests independent (each
test already gets a fresh database), the limiter is reset before and after
every test — mirroring the per-test database isolation model used throughout
the suite.
"""
import pytest

from app import rate_limit


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    rate_limit.reset()
    yield
    rate_limit.reset()