"""Outbound URL validation for SSRF and DNS-rebinding protection.

Provides scheme validation, DNS resolution, and resolved-IP safety
checks.  Used by admin source analysis to prevent requests to
loopback, private, link-local, metadata, or otherwise non-public
destinations.

Design:
  - validate_outbound_url(url, allow_redirect=False):
      * returns UrlValidation on success;
      * raises BlockedDestinationError (a ValueError) with a short,
        safe, specific message when the URL's destination is
        non-public (loopback/private/link-local/metadata/...);
      * raises ValueError for malformed URLs, non-http(s) schemes,
        or DNS failure.
  - allow_redirect=True: any failure returns None instead of raising,
    so redirect-follower callers can treat a bad redirect as "do not
    follow".  (Callers that need to distinguish *blocked* from
    *malformed* on redirects should call with allow_redirect=False and
    catch BlockedDestinationError vs ValueError separately.)

DNS-rebinding / TOCTOU protection: the validation result carries the
resolved IP(s).  Callers should use a PinnedTransport to issue the HTTP
request: it connects to the exact validated IP(s) (never a fresh DNS
lookup) while preserving the original hostname for the Host header and
TLS SNI, so redirects and second lookups cannot re-route the connection
to a destination that was not validated at SSRF-check time.
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False


class BlockedDestinationError(ValueError):
    """Raised when a URL's destination resolves to a non-public address."""


_HOSTNAME_BLOCK_MESSAGES = {
    "localhost": "Access to localhost is blocked",
    "localhost.localdomain": "Access to localhost is blocked",
    "169.254.169.254": "Access to metadata endpoints is blocked",
    "metadata.google.internal": "Access to metadata endpoints is blocked",
    "metadata.azure.com": "Access to metadata endpoints is blocked",
    "metadata": "Access to metadata endpoints is blocked",
}


def _block_reason_for_ip(ip_str: str) -> Optional[str]:
    """Return a safe block message for a non-public IP, else None."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return "Invalid IP address"
    if ip.is_loopback:
        return "Access to loopback addresses is blocked"
    if ip.is_private:
        return "Access to private addresses is blocked"
    if ip.is_link_local:
        return "Access to link-local addresses is blocked"
    if ip.is_reserved:
        return "Access to reserved addresses is blocked"
    if ip.is_unspecified:
        return "Access to unspecified addresses is blocked"
    # CGNAT range 100.64.0.0/10 (not covered by is_private on all Python versions)
    if ip.version == 4:
        ip_int = int(ip)
        if 0x64400000 <= ip_int <= 0x647FFFFF:
            return "Access to CGNAT addresses is blocked"
    return None


@dataclass(frozen=True)
class UrlValidation:
    """Result of a successful outbound URL validation."""
    scheme: str
    hostname: str
    resolved_ips: tuple[str, ...]


def _validate_url(url_str: str) -> UrlValidation:
    """Core validation (raises ValueError / BlockedDestinationError)."""
    parsed = urlparse(url_str)

    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only HTTP/HTTPS URLs are allowed")

    hostname = parsed.hostname
    netloc = parsed.netloc or ""
    if not hostname or ("::" in netloc and not netloc.startswith("[")):
        # urlparse misparses unbracketed IPv6:
        #   "http://::1/path"      → hostname=None, netloc="::1"
        #   "http://fe80::1/path"  → hostname="fe80", netloc="fe80::1"
        # Extract the full IPv6 from the netloc and validate as IP literal.
        if "::" in netloc:
            prefix = (hostname or "").split("[", 1)[0]
            suffix = netloc.split("::", 1)[1]
            # Strip port if present (last :<digits> after the IPv6 part)
            last_colon = suffix.rfind(":")
            if last_colon > 0 and suffix[last_colon + 1:].isdigit():
                suffix = suffix[:last_colon]
            ipv6_str = f"{prefix}::{suffix}"
            try:
                ip = ipaddress.ip_address(ipv6_str)
            except ValueError:
                ip = None
            if ip is not None:
                reason = _block_reason_for_ip(str(ip))
                if reason:
                    raise BlockedDestinationError(reason)
                return UrlValidation(
                    scheme=parsed.scheme,
                    hostname=str(ip),
                    resolved_ips=(str(ip),),
                )
        if not hostname:
            raise ValueError("URL has no hostname")

    lower_host = hostname.lower()
    if lower_host in _HOSTNAME_BLOCK_MESSAGES:
        raise BlockedDestinationError(_HOSTNAME_BLOCK_MESSAGES[lower_host])

    # Hostname is an IP literal — validate it directly, no DNS needed.
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None

    if ip is not None:
        reason = _block_reason_for_ip(str(ip))
        if reason:
            raise BlockedDestinationError(reason)
        return UrlValidation(
            scheme=parsed.scheme,
            hostname=hostname,
            resolved_ips=(str(ip),),
        )

    # Resolve hostname and validate every resolved address.
    try:
        addrinfos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except (socket.gaierror, OSError):
        raise ValueError("Cannot resolve hostname")

    if not addrinfos:
        raise ValueError("Cannot resolve hostname")

    resolved_ips = []
    for family, _, _, _, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        reason = _block_reason_for_ip(ip_str)
        if reason:
            raise BlockedDestinationError(reason)
        resolved_ips.append(ip_str)

    return UrlValidation(
        scheme=parsed.scheme,
        hostname=hostname,
        resolved_ips=tuple(resolved_ips),
    )


def validate_outbound_url(
    url_str: str,
    *,
    allow_redirect: bool = False,
) -> Optional[UrlValidation]:
    """Validate an outbound URL for safe scheme and resolved IP.

    On success returns a UrlValidation.  On failure:
      - allow_redirect=False: raises ValueError (BlockedDestinationError for
        non-public destinations) with a short, safe message — a caller maps
        this to an HTTP 400.
      - allow_redirect=True: returns None.
    """
    if not url_str:
        if allow_redirect:
            return None
        raise ValueError("URL is required")

    if allow_redirect:
        try:
            return _validate_url(url_str)
        except ValueError:
            return None

    return _validate_url(url_str)


class PinnedTransport(httpx.AsyncHTTPTransport):
    """
    httpx 0.28 transport that pins validated hostnames to validated IPs.

    httpx 0.28 / httpcore 1.x removed the resolver abstraction: connections
    are opened by passing the request host directly to ``anyio.connect_tcp``,
    which performs its own lookup.  To close the DNS-rebinding TOCTOU this
    transport rewrites the request URL's host to the IP(s) validated during
    SSRF checks, while preserving the original hostname for:
      * the HTTP ``Host`` header (injected explicitly), and
      * TLS SNI / certificate validation (via the ``sni_hostname`` extension
        that httpcore applies when starting TLS).

    Because the connect target is the validated IP literal, no DNS lookup
    happens for a pinned host — a second lookup cannot re-route the
    connection to a private address.

    Fail-closed: a request whose hostname is not in the pinned map raises
    ``httpx.ConnectError`` instead of silently re-resolving.

    Usage:
        validation = validate_outbound_url(url)
        transport = PinnedTransport({validation.hostname: validation.resolved_ips})
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            response = await client.get(url)  # connects to validated IP, Host/SNI intact
    """

    def __init__(
        self,
        pinned: dict[str, tuple[str, ...]],
        *,
        network_backend: Optional[Any] = None,
        **kwargs: Any,
    ) -> None:
        if not _HAS_HTTPX:
            raise RuntimeError("httpx is required for PinnedTransport")
        super().__init__(**kwargs)
        self._pinned = {k.lower(): tuple(v) for k, v in pinned.items()}
        if network_backend is not None:
            # Test seam: httpcore.AsyncConnectionPool accepts a network_backend
            # (its documented knob) but httpx.AsyncHTTPTransport does not expose
            # it, so inject it post-construction before any connection exists.
            self._pool._network_backend = network_backend

    def _select_pinned_ip(self, ips: tuple[str, ...]) -> str:
        # Deterministic: prefer an IPv4 pin (broadest compatibility), else the
        # first valid IPv6 pin.  Every address fed in here was validated as
        # public at SSRF-check time.
        for version_match in (4, 6):
            for ip in ips:
                try:
                    if ipaddress.ip_address(ip).version == version_match:
                        return ip
                except ValueError:
                    continue
        raise ValueError("Pinned destination contains no valid IP addresses")

    async def handle_async_request(
        self, request: Any
    ) -> Any:
        host = (request.url.host or "").lower()
        ips = self._pinned.get(host)
        if ips is None:
            raise httpx.ConnectError(
                f"Refusing to connect to unvalidated host '{request.url.host}'"
            )

        ip = self._select_pinned_ip(ips)
        new_url = request.url.copy_with(host=ip)

        headers = request.headers.copy()
        headers["host"] = _original_host_header_value(request.url)

        extensions = dict(request.extensions)
        extensions["sni_hostname"] = request.url.host

        pinned_request = httpx.Request(
            method=request.method,
            url=new_url,
            headers=headers,
            stream=request.stream,
            extensions=extensions,
        )
        return await super().handle_async_request(pinned_request)


def _original_host_header_value(url: Any) -> str:
    """Host-header value for the original URL hostname (bracketed IPv6)."""
    host = url.host or ""
    if not host:
        return host
    host_for_header = f"[{host}]" if ":" in host and not host.startswith("[") else host
    default_port = {"http": 80, "https": 443, "ws": 80, "wss": 443}.get(url.scheme)
    if url.port is not None and url.port != default_port:
        return f"{host_for_header}:{url.port}"
    return host_for_header


def safe_destination_summary(url_str: str) -> dict:
    """Return sanitized destination components for audit logging.

    Only the scheme, host (never userinfo), optional port, and a bounded
    path are returned.  Username/password, query strings, fragments, raw
    tokens/API keys, and the original URL are deliberately absent so audit
    logs cannot leak credentials or bearer data.
    """
    parsed = urlparse(url_str)
    return {
        "scheme": parsed.scheme or "",
        "host": parsed.hostname or "",
        "port": parsed.port,
        "path": (parsed.path or "")[:100],
    }


__all__ = [
    "BlockedDestinationError",
    "UrlValidation",
    "validate_outbound_url",
    "PinnedTransport",
    "safe_destination_summary",
]