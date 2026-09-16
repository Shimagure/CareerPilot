"""Production security headers (P3.2).

Adds a small set of browser-hardening headers to every HTTP response when the
application runs in the production environment. The set is intentionally
narrow: each header addresses a concrete, common browser risk — clickjacking
(X-Frame-Options), MIME sniffing (X-Content-Type-Options), and insecure
referrer disclosure (Referrer-Policy). None of them change response semantics
for API clients, CORS, authentication, or the public demo routes, so they are
safe to apply to every response.

No Content-Security-Policy is emitted here: the existing React/Vite frontend
has not been audited against a CSP, and introducing one that breaks the app
would be worse than not having one.

The environment is read from the (cached) production configuration on every
request — a fixed function of configuration, not a runtime toggle.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings


def production_security_headers() -> dict[str, str]:
    """Headers applied to every response in production. Pure and unit-testable."""
    return {
        "X-Frame-Options": "DENY",  # prevents clickjacking via <iframe>/<frame>
        "X-Content-Type-Options": "nosniff",  # stops MIME-type sniffing of responses
        "Referrer-Policy": "strict-origin-when-cross-origin",  # minimizes referrer leakage
    }


class SecurityHeadersMiddleware:
    """Starlette middleware that adds security headers to HTTP responses only
    while the application is in the production environment."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._headers = production_security_headers()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if not get_settings().is_production:
            await self.app(scope, receive, send)
            return

        headers = tuple(self._headers.items())

        async def send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                mutable = MutableHeaders(scope=message)
                for name, value in headers:
                    mutable.append(name, value)
            await send(message)

        await self.app(scope, receive, send_wrapper)