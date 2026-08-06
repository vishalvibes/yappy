"""Desktop Google OAuth browser → custom-protocol bridge.

Supabase (and Google) won't reliably redirect straight to `yappy-dev://…`,
so the system browser lands here over HTTP; we bounce into the Electron app.
"""

from html import escape
from urllib.parse import urlencode

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["oauth"])

_ALLOWED_PROTOCOLS = frozenset({"yappy", "yappy-dev"})


def _deep_link(app_protocol: str, request: Request) -> str | None:
    if app_protocol not in _ALLOWED_PROTOCOLS:
        return None
    # Preserve every OAuth query param except our own app_protocol marker.
    params = [
        (k, v)
        for k, v in request.query_params.multi_items()
        if k != "app_protocol"
    ]
    query = urlencode(params)
    base = f"{app_protocol}://auth/callback"
    return f"{base}?{query}" if query else base


@router.get("/oauth/google/desktop/callback", response_class=HTMLResponse)
async def google_desktop_oauth_callback(
    request: Request,
    app_protocol: str = Query(default="yappy-dev"),
) -> HTMLResponse:
    deep_link = _deep_link(app_protocol, request)
    if deep_link is None:
        return HTMLResponse(
            "<!doctype html><title>Yappy</title><p>Invalid app_protocol.</p>",
            status_code=400,
        )

    safe_href = escape(deep_link, quote=True)
    # Single navigation only — meta refresh + location.replace both fired
    # yappy-dev:// and macOS prompted / focused the app twice.
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Opening Yappy…</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 2rem; color: #111; }}
    a {{ color: #2563eb; }}
  </style>
</head>
<body>
  <p>Opening Yappy…</p>
  <p>If nothing happens, <a id="open" href="{safe_href}">click here to continue</a>.</p>
  <script>
    (function () {{
      var href = {deep_link!r};
      var opened = false;
      function openApp() {{
        if (opened) return;
        opened = true;
        window.location.replace(href);
      }}
      openApp();
      setTimeout(function () {{
        try {{ window.close(); }} catch (e) {{}}
      }}, 10000);
    }})();
  </script>
</body>
</html>
"""
    return HTMLResponse(html)
