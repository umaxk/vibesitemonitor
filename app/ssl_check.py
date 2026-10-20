import asyncio
import os
import socket
import ssl
import tempfile
from urllib.parse import urlsplit


def _certificate_expiry(url: str, timeout: float) -> tuple[float | None, str | None]:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return None, "Not an HTTPS URL"
    host = parts.hostname
    port = parts.port or 443

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=host) as tls:
                der = tls.getpeercert(binary_form=True)
        if not der:
            return None, "Certificate is unavailable"
        cert = _decode_certificate(der)
        not_after = cert.get("notAfter") if cert else None
        if not not_after:
            return None, "Certificate expiry is unavailable"
        return float(ssl.cert_time_to_seconds(not_after)), None
    except Exception as exc:  # noqa: BLE001 - report any TLS/socket failure
        return None, f"{type(exc).__name__}: {exc}"


def _decode_certificate(der: bytes) -> dict:
    """Decode a peer certificate without enabling hostname/chain verification."""
    pem = ssl.DER_cert_to_PEM_cert(der)
    fd, path = tempfile.mkstemp(suffix=".pem")
    try:
        with os.fdopen(fd, "w", encoding="ascii") as handle:
            handle.write(pem)
        return ssl._ssl._test_decode_cert(path)  # type: ignore[attr-defined]
    finally:
        os.unlink(path)


async def get_certificate_expiry(
    url: str, timeout: float = 10
) -> tuple[float | None, str | None]:
    return await asyncio.to_thread(_certificate_expiry, url, timeout)
