"""Published-brief routes for the rendered-page gates.

Why (2026-09-15): every route-derived gate (page-canvas, light-text,
contrast) enumerated `index.html` files — so `/evidence/` was audited and
`/evidence/?id=blog-2026-W29` never was. The listing is paper; the brief
injects a dark stylesheet from the data and repainted <body> near-black.
Seven briefs shipped black while every gate stayed green, because the
routes that carry post bodies are not files, they are rows.

`published_brief_routes(base)` asks the live posts API which briefs are
published and returns one route per brief, per reader shell. It RAISES
when the API cannot be read: a gate that cannot enumerate must fail, not
quietly audit fewer surfaces. Local previews (no Functions) are the one
legitimate skip, and the caller decides that by checking the base.
"""
from __future__ import annotations

import json
import urllib.request

KINDS = (("evidence", "/evidence/"), ("blog", "/trending/"))   # the trending shell lists kind=blog
UA = "mz-operator-tools/1.0 (routes)"


def _get_json(url: str, timeout: int):
    """curl first — it is the transport every other gate in this repo uses
    against the live site and the one the WAF/proxy demonstrably accepts;
    urllib got HTTP 400 from the same URL in this container. urllib is the
    fallback for a machine without curl. Either path raises on failure."""
    import shutil, subprocess
    if shutil.which("curl"):
        r = subprocess.run(["curl", "-sS", "--fail", "-A", UA, "-H", "Accept: application/json",
                            "--max-time", str(timeout), url], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"brief-routes: curl failed for {url}: {r.stderr.strip()[:160]}")
        return json.loads(r.stdout)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


SHELL_FOR_KIND = dict(KINDS)


def route_for(post_id: str, kind: str) -> str:
    """The reader's URL for one post.

    The shell is chosen by KIND, never by the id, because the id prefixes read
    the other way round: the weekly brief `blog-2026-W20` is kind "evidence"
    and lives at /evidence/, while the trend brief
    `evidence-2026-05-19-antihistamines...` is kind "blog" and lives at
    /trending/. Guessing from the prefix sends a post-publish gate to a page
    that does not exist, which is how a trend brief could be verified without
    anything being verified.
    """
    shell = SHELL_FOR_KIND.get((kind or "").strip().lower())
    if not shell:
        raise RuntimeError(f"route_for: unknown post kind {kind!r} for {post_id}")
    return f"{shell}?id={post_id}"


def is_local(base: str) -> bool:
    return "localhost" in base or "127.0.0.1" in base


def published_brief_routes(base: str, timeout: int = 30) -> list[str]:
    base = base.rstrip("/")
    routes: list[str] = []
    for kind, shell in KINDS:
        url = f"{base}/api/posts?kind={kind}&status=published"
        data = _get_json(url, timeout)
        items = data.get("posts") if isinstance(data, dict) else data
        if not isinstance(items, list):
            raise RuntimeError(f"brief-routes: unexpected shape from {url}: {str(data)[:120]}")
        for p in items:
            pid = str(p.get("id") or "").strip()
            if pid:
                routes.append(f"{shell}?id={pid}")
    return routes
