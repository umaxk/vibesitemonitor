import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

BLOCKED_NETWORKS = {
    4: [
        ipaddress.ip_network("0.0.0.0/8"),
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("100.64.0.0/10"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("169.254.0.0/16"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.0.0.0/24"),
        ipaddress.ip_network("192.0.2.0/24"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("198.18.0.0/15"),
        ipaddress.ip_network("198.51.100.0/24"),
        ipaddress.ip_network("203.0.113.0/24"),
        ipaddress.ip_network("224.0.0.0/4"),
        ipaddress.ip_network("240.0.0.0/4"),
    ],
    6: [
        ipaddress.ip_network("::/128"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("::ffff:0:0/96"),
        ipaddress.ip_network("fe80::/10"),
        ipaddress.ip_network("fc00::/7"),
        ipaddress.ip_network("ff00::/8"),
        ipaddress.ip_network("2001:db8::/32"),
    ],
}


class DisallowedHostError(ValueError):
    """Raised when a URL points at a private or otherwise forbidden address."""


def is_allowed_host(host: str | None) -> bool:
    if not host:
        return False
    name = host.strip().lower().rstrip(".")
    if not name:
        return False
    if name == "localhost" or name.endswith(".localhost") or name.endswith(".local"):
        return False
    try:
        infos = socket.getaddrinfo(name, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError):
        return False
    if not infos:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if any(ip in net for net in BLOCKED_NETWORKS[ip.version]):
            return False
    return True


def check_url(url: str) -> None:
    host = urlsplit(str(url)).hostname
    if not is_allowed_host(host):
        raise DisallowedHostError(
            f"Blocked: URL host '{host or ''}' is not allowed"
        )


async def check_url_async(url: str) -> None:
    await asyncio.to_thread(check_url, url)
