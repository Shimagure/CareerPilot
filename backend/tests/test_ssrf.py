"""P3.3 tests: outbound URL SSRF / DNS-rebinding validation.

Covers:
  - public IP literals are allowed
  - loopback, private, link-local, CGNAT, reserved, unspecified destinations blocked
  - unsafe schemes (ftp/javascript/data/etc.) rejected
  - blocked hostnames (localhost, metadata endpoints) rejected
  - a hostname that resolves to a private address is blocked (mocked DNS)
  - a hostname that resolves to a public address is allowed (mocked DNS)
  - DNS resolution failure is rejected
  - allow_redirect=True returns None (not raise) for unsafe redirect destinations
  - PinnedTransport connects to the validated IP(s), never a fresh DNS lookup
  - DNS-rebinding TOCTOU: validation resolves a public IP, a later private
    rebind cannot re-route the connection (the URL host is rewritten to the
    pinned IP before any connect, so no second DNS lookup reaches the
    destination)
  - Host header and TLS SNI are preserved for the original hostname
  - IPv4 and IPv6 pins both connect safely
  - an unpinned host fails closed (httpx.ConnectError) with no connect attempt

All tests are deterministic; real DNS / network calls are never made.  The
transport connects through a RecordingBackend test seam (httpcore's
AsyncNetworkBackend abstraction), so no socket is ever opened.
"""
from __future__ import annotations

import socket

import httpx
import pytest
from httpcore import ConnectError as HttpcoreConnectError
from httpcore._backends.base import AsyncNetworkBackend, AsyncNetworkStream
from unittest.mock import patch

from app.ssrf import validate_outbound_url, PinnedTransport, UrlValidation


CANNED_HTTP = (
    b"HTTP/1.1 200 OK\r\n"
    b"Content-Type: text/html\r\n"
    b"Content-Length: 2\r\n"
    b"\r\n"
    b"ok"
)


class FakeNetworkStream(AsyncNetworkStream):
    """Duck-typed httpcore network stream that records what is sent and serves
    a canned HTTP response so requests complete deterministically."""

    def __init__(self, sent: bytearray, sni_hostnames: list, response: bytes = CANNED_HTTP):
        self._sent = sent
        self._sni_hostnames = sni_hostnames
        self._remaining = bytearray(response)

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        chunk = self._remaining[:max_bytes]
        self._remaining = self._remaining[len(chunk):]
        return bytes(chunk)

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self._sent.extend(buffer)

    async def aclose(self) -> None:
        pass

    async def start_tls(self, ssl_context, server_hostname: str | None = None, timeout=None):
        self._sni_hostnames.append(server_hostname)
        return self

    def get_extra_info(self, info: str):
        return None


class RecordingBackend(AsyncNetworkBackend):
    """Replaces httpcore's real network backend so no socket is ever opened;
    records every host a connection would be attempted to."""

    def __init__(self, host_hits: list, *, fail_connect: bool = True,
                 sent: bytearray | None = None, sni_hostnames: list | None = None):
        self._host_hits = host_hits
        self._fail_connect = fail_connect
        self._sent = sent
        self._sni_hostnames = sni_hostnames if sni_hostnames is not None else []

    async def connect_tcp(self, host, port, timeout: float | None = None,
                          local_address: str | None = None, socket_options=None) -> AsyncNetworkStream:
        self._host_hits.append(host)
        if self._fail_connect:
            # httpcore.ConnectError is what httpx maps to httpx.ConnectError;
            # a raw OSError here would escape unwrapped.
            raise HttpcoreConnectError("test: no real network connections")
        return FakeNetworkStream(self._sent, self._sni_hostnames)

    async def connect_unix_socket(self, path, timeout: float | None = None, socket_options=None) -> AsyncNetworkStream:
        raise OSError("test: no unix sockets")

    async def sleep(self, seconds: float) -> None:
        pass


def _pinned_client(pinned: dict, backend: AsyncNetworkBackend, url: str):
    transport = PinnedTransport(pinned, network_backend=backend, trust_env=False)
    return httpx.AsyncClient(transport=transport, trust_env=False, base_url=url)


class TestSchemeValidation:
    def test_rejects_missing_url(self):
        with pytest.raises(ValueError):
            validate_outbound_url("")
        assert validate_outbound_url("", allow_redirect=True) is None

    def test_rejects_non_http_schemes(self):
        for url in (
            "ftp://example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "gopher://example.com",
            "ws://example.com",
        ):
            with pytest.raises(ValueError):
                validate_outbound_url(url)

    def test_rejects_malformed_url(self):
        for url in ("not a url", "://nohost", "example.com/job", "http://"):
            with pytest.raises(ValueError):
                validate_outbound_url(url)


class TestPublicDestinationsAllowed:
    def test_public_ipv4_allowed(self):
        result = validate_outbound_url("http://8.8.8.8/jobs")
        assert result is not None
        assert result.scheme == "http"
        assert result.hostname == "8.8.8.8"
        assert result.resolved_ips == ("8.8.8.8",)

    def test_public_ipv6_allowed(self):
        # 2001:4860:4860::8888 is a public Google DNS address.
        result = validate_outbound_url("https://[2001:4860:4860::8888]/")
        assert result is not None
        assert result.hostname == "2001:4860:4860::8888"

    def test_https_public_hostname_resolving_public(self):
        # Mock DNS so no real lookup happens.
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 0)),
        ]) as mock:
            result = validate_outbound_url("https://example.com/jobs")
            assert result is not None
            assert result.hostname == "example.com"
            assert result.resolved_ips == ("8.8.8.8",)
            mock.assert_called_once()


class TestBlockedIPLiterals:
    @pytest.mark.parametrize("ip", [
        "127.0.0.1",
        "127.0.0.2",
        "::1",
        "10.0.0.1",
        "10.255.255.255",
        "192.168.1.1",
        "192.168.0.254",
        "172.16.0.1",
        "172.31.255.254",
        "169.254.169.254",  # link-local + metadata
        "169.254.0.1",
        "fe80::1",
        "100.64.0.1",        # CGNAT
        "100.127.255.254",   # CGNAT upper
        "0.0.0.0",           # unspecified
        "240.0.0.1",         # reserved
        "fd00::1",           # IPv6 ULA (private)
    ])
    def test_blocked_ip_literal(self, ip):
        with pytest.raises(ValueError, match="blocked"):
            validate_outbound_url(f"http://{ip}/path")


class TestBlockedHostnames:
    @pytest.mark.parametrize("hostname", [
        "localhost",
        "localhost.localdomain",
        "LOCALHOST",  # case-insensitive
        "metadata.google.internal",
        "metadata.azure.com",
        "metadata",
    ])
    def test_banned_hostname_blocked_without_dns(self, hostname):
        # If the hostname were resolved, a real DNS call would happen; asserting
        # the block happens pre-resolution proves no network access occurs.
        with patch("app.ssrf.socket.getaddrinfo") as mock_dns:
            with pytest.raises(ValueError, match="blocked"):
                validate_outbound_url(f"http://{hostname}/")
        mock_dns.assert_not_called()


class TestDNSSmartRebinding:
    def test_hostname_resolving_private_is_blocked(self):
        # An attacker-controlled hostname returns a private address on first
        # resolution; validation must reject it.
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.50.10", 0)),
        ]):
            with pytest.raises(ValueError, match="blocked"):
                validate_outbound_url("http://attacker.example.com/")

    def test_hostname_resolving_loopback_is_blocked(self):
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0)),
        ]):
            with pytest.raises(ValueError, match="blocked"):
                validate_outbound_url("https://internal.host/")

    def test_hostname_resolving_metadata_is_blocked(self):
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0)),
        ]):
            with pytest.raises(ValueError, match="blocked"):
                validate_outbound_url("http://metadata.evil/")

    def test_mixed_resolution_with_any_private_ip_is_blocked(self):
        # A hostname returning public AND private addresses must be rejected —
        # the client could be routed to either.
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.9", 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0)),
        ]):
            with pytest.raises(ValueError, match="blocked"):
                validate_outbound_url("http://split.example.com/")

    def test_dns_failure_rejected(self):
        with patch("app.ssrf.socket.getaddrinfo", side_effect=socket.gaierror("nodename nor servname")):
            with pytest.raises(ValueError, match="resolve"):
                validate_outbound_url("http://nonexistent.example.com/")

    def test_empty_resolution_rejected(self):
        with patch("app.ssrf.socket.getaddrinfo", return_value=[]):
            with pytest.raises(ValueError, match="resolve"):
                validate_outbound_url("http://example.com/")


class TestAllowRedirectMode:
    def test_unsafe_redirect_destination_returns_none(self):
        # In redirect-following mode, an unsafe destination must NOT raise; the
        # caller treats it as "do not follow".
        assert validate_outbound_url("http://127.0.0.1/x", allow_redirect=True) is None
        assert validate_outbound_url("ftp://evil.example/", allow_redirect=True) is None
        assert validate_outbound_url("not-a-url", allow_redirect=True) is None
        assert validate_outbound_url("", allow_redirect=True) is None

    def test_private_resolving_redirect_returns_none(self):
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 0)),
        ]):
            assert validate_outbound_url("http://evil.example.com/", allow_redirect=True) is None

    def test_safe_redirect_destination_still_validates(self):
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0)),
        ]):
            result = validate_outbound_url("https://example.com/page2", allow_redirect=True)
            assert result is not None
            assert result.hostname == "example.com"


class TestPinnedTransport:
    """The PinnedTransport connects to the exact validated IP(s) — never a
    fresh DNS lookup — while preserving Host/SNI for the original hostname."""

    @pytest.mark.asyncio
    async def test_connection_uses_validated_ip_even_if_dns_rebinds(self):
        # Scenario: validation resolved example.com -> 93.184.216.34.  At
        # connection time the attacker rebinds DNS so a *fresh* lookup would
        # return a private address (the TOCTOU vector).  The transport must
        # connect to the pinned public IP and must never attempt 10.0.0.1.
        hits = []
        client = _pinned_client(
            {"example.com": ("93.184.216.34",)},
            RecordingBackend(hits),
            "http://example.com/",
        )
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 0)),
        ]):
            with pytest.raises(httpx.ConnectError):
                await client.get("http://example.com/jobs")
        await client.aclose()
        assert hits == ["93.184.216.34"]
        assert "10.0.0.1" not in hits

    @pytest.mark.asyncio
    async def test_validation_result_is_a_usable_pin_set(self):
        # The validation result's resolved_ips are exactly what the transport
        # connects to — proves the validate_outbound_url -> PinnedTransport
        # contract (validation carries usable validated IP data).
        with patch("app.ssrf.socket.getaddrinfo", return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34",)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2606:2800:220:1:248:1893:25c8:1946",)),
        ]):
            validation = validate_outbound_url("https://example.com/jobs")
        assert validation is not None
        assert validation.resolved_ips == ("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946")

        hits = []
        client = _pinned_client(
            {validation.hostname.lower(): validation.resolved_ips},
            RecordingBackend(hits),
            "https://example.com/",
        )
        with pytest.raises(httpx.ConnectError):
            await client.get("https://example.com/jobs")
        await client.aclose()
        assert hits == ["93.184.216.34"]  # deterministic IPv4 preference

    @pytest.mark.asyncio
    async def test_request_completes_and_preserves_host_and_sni(self):
        hits, sent, sni = [], bytearray(), []
        client = _pinned_client(
            {"example.com": ("93.184.216.34", "2001:4860:4860::8888")},
            RecordingBackend(hits, fail_connect=False, sent=sent, sni_hostnames=sni),
            "https://example.com/",
        )
        resp = await client.get("https://example.com/jobs")
        await client.aclose()
        assert resp.status_code == 200
        assert hits == ["93.184.216.34"]
        assert sni == ["example.com"]                             # TLS SNI preserved
        wire = bytes(sent)
        assert b"\r\nhost: example.com\r\n" in wire              # original Host header
        assert not wire.startswith(b"GET /jobs HTTP/1.1\r\nhost: 93.184.216.34")  # never the IP

    @pytest.mark.asyncio
    async def test_ipv6_pin_connects_to_validated_v6(self):
        hits = []
        client = _pinned_client(
            {"dual.example.com": ("2001:4860:4860::8888",)},
            RecordingBackend(hits),
            "http://dual.example.com/",
        )
        with pytest.raises(httpx.ConnectError):
            await client.get("http://dual.example.com/")
        await client.aclose()
        assert hits == ["2001:4860:4860::8888"]

    @pytest.mark.asyncio
    async def test_unpinned_host_fails_closed_without_connecting(self):
        hits = []
        client = _pinned_client(
            {"example.com": ("93.184.216.34",)},
            RecordingBackend(hits),
            "http://example.com/",
        )
        with pytest.raises(httpx.ConnectError, match="unvalidated host"):
            await client.get("http://unpinned.example.org/")
        await client.aclose()
        assert hits == []  # fail-closed: no connect attempt is even made

    @pytest.mark.asyncio
    async def test_repinned_transport_connects_only_to_new_validated_ip(self):
        # What the endpoint does after a redirect: it re-validates the target
        # and builds a transport with the NEW pinned map (fresh validated IPs
        # for the redirect host).  The transport must connect only to the new
        # validated IP.  (The endpoint-level redirect/robots-pin behavior is
        # asserted in test_audit.py.)
        hits = []
        client = _pinned_client(
            {"redirected.example.com": ("203.0.113.7",)},
            RecordingBackend(hits),
            "http://redirected.example.com/",
        )
        with pytest.raises(httpx.ConnectError):
            await client.get("http://redirected.example.com/landing")
        await client.aclose()
        assert hits == ["203.0.113.7"]