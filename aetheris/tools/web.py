"""Network tools — outbound HTTP fetch with SSRF protection.

Web access is the one capability that reaches outside the process, so it ships
**disabled by default** (``AETHERIS_WEB_ENABLED=false``) and, once enabled, is
constrained by:

* scheme allowlist (http/https only — no file://, gopher://, data:);
* DNS resolution followed by an IP check that blocks loopback, link-local,
  private, reserved, and multicast ranges (the standard SSRF surface, including
  cloud metadata endpoints at 169.254.169.254);
* the same check re-applied to every redirect hop;
* a response size cap and a request timeout;
* HTML reduced to readable text so the model receives content, not markup.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from ..core.config import settings
from .registry import ToolError, register

_ALLOWED_SCHEMES = {"http", "https"}
_MAX_REDIRECTS = 4


def _assert_public_host(url: str) -> None:
    """Reject URLs that resolve to a non-public address (SSRF defence)."""
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ToolError(f"Only http:// and https:// URLs are allowed (got '{parsed.scheme}').")
    host = parsed.hostname
    if not host:
        raise ToolError("The URL has no host component.")

    if settings.web_allowed_hosts:
        allowed = {h.strip().lower() for h in settings.web_allowed_hosts.split(",") if h.strip()}
        if allowed and not any(host.lower() == a or host.lower().endswith("." + a) for a in allowed):
            raise ToolError(f"Host '{host}' is not in AETHERIS_WEB_ALLOWED_HOSTS.")

    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise ToolError(f"Could not resolve host '{host}': {exc}") from exc

    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise ToolError(
                f"Refusing to fetch '{host}': it resolves to the non-public address "
                f"{address}. Internal and metadata endpoints are blocked."
            )


class _TextExtractor(HTMLParser):
    """Collect visible text from an HTML document, dropping script/style/nav."""

    _SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer", "form"}
    _BREAK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True
        elif tag in self._BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data.strip()
            return
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        joined = " ".join(self.parts)
        joined = re.sub(r"[ \t]+", " ", joined)
        return re.sub(r"\n\s*\n+", "\n\n", joined).strip()


@register(
    "web_fetch",
    (
        "Fetch a web page or API endpoint over HTTP(S) and return its readable text "
        "content. Use it to consult documentation, read a link the user supplied, or "
        "check a fact that may have changed since training. Provide a complete URL "
        "including the scheme."
    ),
    {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "Absolute http:// or https:// URL to retrieve.",
            },
            "max_chars": {
                "type": "integer",
                "description": "Maximum characters of extracted text to return.",
                "minimum": 500,
                "maximum": 40000,
            },
        },
        "required": ["url"],
    },
    requires_optin=True,
    optin_setting="web_enabled",
    tags=("network", "research"),
)
async def web_fetch(url: str, max_chars: int = 8000) -> str:
    """Retrieve a URL and return its text content."""
    if not settings.web_enabled:
        raise ToolError(
            "Web access is disabled. Set AETHERIS_WEB_ENABLED=true to enable web_fetch."
        )
    url = (url or "").strip()
    if not url:
        raise ToolError("No URL was provided.")
    if "://" not in url:
        url = "https://" + url

    limit = max(500, min(int(max_chars or 8000), 40000))
    _assert_public_host(url)

    headers = {
        "User-Agent": "Aetheris/1.0 (+https://github.com/rajaram-2005/Aetheris)",
        "Accept": "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            timeout=settings.web_timeout, follow_redirects=False, headers=headers
        ) as client:
            current = url
            for _ in range(_MAX_REDIRECTS + 1):
                response = await client.get(current)
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        break
                    current = str(response.next_request.url) if response.next_request else location
                    # Re-validate every hop: redirects are a classic SSRF bypass.
                    _assert_public_host(current)
                    continue
                break
            else:
                raise ToolError("Too many redirects.")

            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            raw = response.text[: settings.web_max_bytes]
    except httpx.HTTPStatusError as exc:
        raise ToolError(
            f"HTTP {exc.response.status_code} from {current}: {exc.response.reason_phrase}"
        ) from exc
    except httpx.HTTPError as exc:
        raise ToolError(f"Request to {url} failed: {exc}") from exc

    if "html" in content_type:
        parser = _TextExtractor()
        parser.feed(raw)
        body = parser.text()
        title = parser.title or current
    else:
        body = raw.strip()
        title = current

    if len(body) > limit:
        body = body[:limit] + f"\n… [truncated at {limit} characters]"
    if not body:
        body = "(the response contained no extractable text)"

    return f"Source: {current}\nTitle: {title}\nContent-Type: {content_type}\n\n{body}"


__all__ = ["web_fetch"]
