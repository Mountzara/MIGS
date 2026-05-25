#!/usr/bin/env python3
"""audit_live_post.py — Unified cross-cutting compliance audit for a single
mountzara.com post (live or local body_html).

Codifies the rules from /Users/beans/Documents/CLAUDE.md:
  §1.2   — CBG/MIGS canonical naming (never "MIGS" alone; never "MIGS & CBG")
  §3.7   — No infra-language in visible body (HTML comments stripped first
            because the §0.8 manifest legitimately lives in a comment)
  §3.8   — Per-<article> cite-card count (the FORBIDDEN substring method
            inflates by ~2×; use the article-iterator method)
            — abstracts == cards (no missing abstract blocks)
            — no "0 recent studies" / "0 foundational papers" headers
            — at least one mz-cite-grid div present
            — no "REVIEW REQUIRED" verdict label leaking to a published post
  §3.10  — No blue tokens (#1d4ed8 / #2563eb / #3b82f6 / #60a5fa / #0ea5e9)
            — purple #6d28d9 reachable (inline body_html OR via the page-shell
            CSS — caller must verify visually per §0.2.1 if shell-supplied)
  §3.12  — Medicolegal AI disclaimer present
  §0.8   — KB-anchor manifest present (in HTML comment or visible disclosure)

Usage:
  python3 scripts/audit_live_post.py <post-id-or-URL>
  python3 scripts/audit_live_post.py --list           # audit every published post
  python3 scripts/audit_live_post.py --file <path>    # audit a local body_html file

Exit codes:
  0 — all gates passed
  2 — one or more gates failed
  3 — usage / IO error

Per CLAUDE.md §3.8 (2026-05-21 update — verbatim user directive: "make sure
you make it happen, update claude.md, do what is needed to make sure this
always happen across all my sessions with claude") — this script IS the
"always-run before a fix" tool that future Claude sessions must consult
before attempting any post repair.

Per §4.4 every check logs at INFO so the audit trail is greppable.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Logging — per global §4.4 mandatory debug logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s | %(message)s",
)
log = logging.getLogger("audit_live_post")

API_LIST = "https://mountzara.com/api/posts/?status=published"
API_POST = "https://mountzara.com/api/posts/{}"

# Cloudflare WAF blocks the default urllib UA. Use a normal browser string.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)

# ---------------------------------------------------------------------------
# Tokens / patterns
# ---------------------------------------------------------------------------

# §3.10 — blue tokens that are forbidden
BLUE_TOKENS = re.compile(
    r"#1d4ed8|#2563eb|#3b82f6|#60a5fa|#0ea5e9|#1e40af|#1e3a8a",
    re.IGNORECASE,
)

# §3.10 — canonical purple brand token
PURPLE_BRAND = re.compile(r"#6d28d9", re.IGNORECASE)

# §3.12 — medicolegal disclaimer markers
DISCLAIMER = re.compile(
    r"medicolegal|AI-assisted|not a substitute|professional advice|not medical advice",
    re.IGNORECASE,
)

# §0.8 — KB-anchor manifest markers (comments OR visible disclosures)
KB_MANIFEST = re.compile(
    r"KB-anchor manifest|kb_anchor_manifest|kb-anchor-manifest|kb_manifest|"
    r"§0\.8 manifest|topic_groups_anchored",
    re.IGNORECASE,
)

# §1.2 — bare "MIGS" detection (must always be "CBG/MIGS"). We match
# the literal word boundary around "MIGS" and exclude appearances inside
# already-canonical "CBG/MIGS" / "CBG-MIGS" sequences and inside the
# FMIGS / fellowship-context where the proper noun "FMIGS" is allowed.
BARE_MIGS = re.compile(
    r"(?<!CBG/)(?<!CBG-)(?<!F)\bMIGS\b",
    re.IGNORECASE,
)

# §1.2 — wrong-order combination
WRONG_ORDER = re.compile(r"MIGS\s*[&·]\s*CBG|MIGS\s*&amp;\s*CBG", re.IGNORECASE)

# §3.7 / §3.11 — infra-language (forbidden in visible body, allowed in
# HTML comments where the §0.8 manifest legitimately lives).
INFRA_LANGUAGE = re.compile(
    r"MountZara KB|"
    r"MountZara clinical knowledge base|"
    r"clinical knowledge base|"
    r"NCBI E-Utilities|"
    r"in this session|"
    r"§\s*0\.8(?!\.\d)|"  # bare §0.8 but not §0.8.1
    r"RAG manifest|"
    r"three-phase RAG",
    re.IGNORECASE,
)

# §3.8 — REVIEW REQUIRED verdict label (auto-verdict heuristic placeholder).
# A published post that still shows this means the clinician override didn't
# run before publish — hard fail.
REVIEW_REQUIRED = re.compile(r"REVIEW REQUIRED", re.IGNORECASE)

# §3.8 — "0 recent studies" / "0 foundational paper" headers that the
# pre-2026-05-20 renderer emitted when cite-grid was empty.
ZERO_HEADERS = re.compile(
    r">\s*0\s+(recent studies|foundational paper)",
    re.IGNORECASE,
)

# §3.8 — per-<article> cite-card extraction (CANONICAL — see CLAUDE.md
# §3.8 2026-05-21 update: substring count of "mz-cite-card" is FORBIDDEN).
ARTICLE_CARD = re.compile(
    r'<article[^>]*class="[^"]*mz-cite-card[^"]*"[^>]*>(.*?)</article>',
    re.IGNORECASE | re.DOTALL,
)

# §3.8 — section structure markers
VERDICT_GAUGE = re.compile(r"mz-verdict-gauge|verdict-gauge", re.IGNORECASE)
EVIDENCE_PYRAMID = re.compile(r"mz-evidence-pyramid|evidence-pyramid", re.IGNORECASE)
CITE_GRID = re.compile(r'class="[^"]*mz-cite-grid[^"]*"', re.IGNORECASE)

# §3.9 — Monday Morning markers
SUBSPECIALTY_PARA = re.compile(r"subspecialty|per-subspecialty|per-group", re.IGNORECASE)
PENDING_PLACEHOLDER = re.compile(r"\[\s*pending\s*\]", re.IGNORECASE)
MZ_REF_SUPS = re.compile(r'class="[^"]*mz-ref[^"]*"', re.IGNORECASE)

# HTML comment stripper — §0.8 manifest lives in <!-- ... --> comments
# which are not "visible body" for §3.7 / §1.2 purposes.
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

# §1.2 false-positive guard: CSS class names + HTML attributes are markup,
# not "user-facing or public-facing text". A class name like
# `mz-post-do-migs` (slug for a "From a DO + CBG/MIGS lens" section) is
# not a §1.2 violation. Same for href="/something/migs/" paths, JS
# identifiers like dataset.migsRefs, etc. We extract VISIBLE TEXT content
# only — drop everything between < and > before the §1.2 / §3.7 scans.
HTML_TAG = re.compile(r"<[^>]+>", re.DOTALL)
# Also drop <script> and <style> contents entirely — they hold JS / CSS
# tokens that are markup, not prose.
SCRIPT_OR_STYLE_BLOCK = re.compile(
    r"<(script|style)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)


def visible_text(body_html: str) -> str:
    """Strip HTML comments, <script>/<style> blocks, then all tags. What
    remains is the rendered text content that would be visible to a reader
    of the deployed page — the surface §1.2 / §3.7 actually govern."""
    s = HTML_COMMENT.sub("", body_html)
    s = SCRIPT_OR_STYLE_BLOCK.sub("", s)
    s = HTML_TAG.sub(" ", s)
    return s

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class CheckResult:
    label: str        # CLAUDE.md section + short description
    passed: bool
    detail: str = ""

    @property
    def mark(self) -> str:
        return "PASS" if self.passed else "FAIL"


@dataclass
class PostAudit:
    post_id: str
    kind: str
    title: str
    body_html_len: int
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def fails(self) -> int:
        return sum(1 for c in self.checks if not c.passed)

    def add(self, label: str, passed: bool, detail: str = "") -> None:
        self.checks.append(CheckResult(label, passed, detail))


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    log.debug("fetch_json %s", url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def list_published_posts() -> list[dict]:
    data = fetch_json(API_LIST)
    return data.get("posts", [])


def fetch_post(post_id: str) -> dict:
    return fetch_json(API_POST.format(post_id))


# ---------------------------------------------------------------------------
# Per-<article> count helpers (§3.8 2026-05-21 hard rule)
# ---------------------------------------------------------------------------


def article_cards(body_html: str) -> list[str]:
    """Return the list of <article class="mz-cite-card ...">...</article>
    contents. CANONICAL count per CLAUDE.md §3.8 2026-05-21."""
    return ARTICLE_CARD.findall(body_html)


def cards_with_abstracts(article_contents: Iterable[str]) -> int:
    return sum(1 for c in article_contents if "mz-abstract" in c)


# ---------------------------------------------------------------------------
# Core auditor
# ---------------------------------------------------------------------------


def audit_post(post: dict) -> PostAudit:
    pid = post.get("id") or ""
    kind = post.get("kind") or ""
    title = (post.get("title") or "")[:120]
    body = post.get("body_html") or ""
    # `visible` = the rendered text the reader sees (no HTML markup, no JS,
    # no CSS). Used for §1.2 / §3.7 / §3.9 scans which govern user-facing
    # text only. The full `body` is still used for §3.8 / §3.10 / §0.8
    # checks that operate on the HTML structure itself.
    visible = visible_text(body)
    log.info(
        "auditing %s (kind=%s title=%r body_html=%d chars, visible_text=%d chars)",
        pid, kind, title[:60], len(body), len(visible),
    )

    audit = PostAudit(post_id=pid, kind=kind, title=title, body_html_len=len(body))
    if not body:
        audit.add("§9.4 body_html present", False, "0 chars — fetch must have failed")
        return audit
    audit.add("§9.4 body_html present", True, f"{len(body):,} chars")

    # -- §1.2 canonical naming ----------------------------------------------
    wrong_order_hits = WRONG_ORDER.findall(visible)
    audit.add(
        "§1.2 no 'MIGS & CBG' (wrong order)",
        not wrong_order_hits,
        f"found {len(wrong_order_hits)} occurrence(s)" if wrong_order_hits else "",
    )

    # Per §1.2 verbatim — "Never 'MIGS' alone in user-facing or public-facing
    # text" — the strict requirement is the absence of bare MIGS, not the
    # mandatory presence of "CBG/MIGS". A trend brief about menopausal
    # vasomotor symptoms can legitimately not mention CBG/MIGS in its prose
    # while still being published on the CBG/MIGS-branded blog. Track both
    # but only fail on bare-MIGS occurrences.
    bare_migs_hits = BARE_MIGS.findall(visible)
    cbg_migs_hits = len(re.findall(r"CBG/MIGS|CBG-MIGS", visible))
    audit.add(
        "§1.2 no bare 'MIGS' (CBG/MIGS canonical)",
        len(bare_migs_hits) == 0,
        f"{len(bare_migs_hits)} bare MIGS, {cbg_migs_hits} CBG/MIGS" if bare_migs_hits else f"{cbg_migs_hits} CBG/MIGS occurrences",
    )
    audit.add(
        "§1.2 CBG/MIGS naming present (informational)",
        True,
        f"{cbg_migs_hits} occurrence(s)" if cbg_migs_hits else "none — post doesn't reference the subspecialty (OK if topic-neutral)",
    )

    # -- §3.7 / §3.11 infra-language ----------------------------------------
    infra_hits = INFRA_LANGUAGE.findall(visible)
    audit.add(
        "§3.7/§3.11 no infra-language in visible body",
        not infra_hits,
        f"found {len(infra_hits)} match(es): {sorted(set(infra_hits))[:5]}" if infra_hits else "",
    )

    # -- §3.10 design tokens ------------------------------------------------
    blue_hits = BLUE_TOKENS.findall(body)
    audit.add(
        "§3.10 no blue tokens",
        not blue_hits,
        f"found {sorted(set(t.lower() for t in blue_hits))}" if blue_hits else "",
    )

    purple_present_inline = bool(PURPLE_BRAND.search(body))
    # Purple may come from the global stylesheet rather than inline body_html.
    # We record it as informational; the visual VERIFY in §0.2.1 catches the
    # rendered case.
    audit.add(
        "§3.10 purple #6d28d9 in body_html (informational)",
        True,
        "present inline" if purple_present_inline else "not inline — relies on global CSS (verify visually)",
    )

    # -- §3.12 medicolegal disclaimer ---------------------------------------
    disclaimer_hits = DISCLAIMER.findall(body)
    audit.add(
        "§3.12 medicolegal disclaimer present",
        bool(disclaimer_hits),
        f"{len(disclaimer_hits)} marker(s)" if disclaimer_hits else "absent",
    )

    # -- §0.8 manifest -------------------------------------------------------
    manifest_present = bool(KB_MANIFEST.search(body))
    audit.add(
        "§0.8 KB-anchor manifest present",
        manifest_present,
        "found" if manifest_present else "absent — clinical posts MUST carry the manifest",
    )

    # -- §3.8 / §3.9 verdict-label tripwire ---------------------------------
    review_hits = REVIEW_REQUIRED.findall(body)
    audit.add(
        "§3.8 no 'REVIEW REQUIRED' verdict label",
        not review_hits,
        f"found {len(review_hits)} occurrence(s)" if review_hits else "",
    )

    # -- §3.8 / §3.9 cite-card count (canonical per-<article> method) -------
    cards = article_cards(body)
    cards_n = len(cards)
    abs_n = cards_with_abstracts(cards)
    if cards_n > 0:
        audit.add(
            f"§3.8 cite-card count via <article> (CANONICAL, not substring)",
            True,
            f"{cards_n} cards, {abs_n} with mz-abstract",
        )
        audit.add(
            "§3.8 abstracts == cards (no missing abstract blocks)",
            abs_n == cards_n,
            f"{cards_n - abs_n} card(s) missing abstract block" if abs_n < cards_n else "",
        )
    else:
        audit.add(
            "§3.8 cite-card count via <article>",
            True,
            "0 cards (post has no cite-card surface — n/a for this post type)",
        )

    # -- §3.8 cite-grid + structure -----------------------------------------
    cite_grid_count = len(CITE_GRID.findall(body))
    is_trend = (kind == "blog") or ("trend" in title.lower())
    if is_trend:
        audit.add(
            "§3.8 at least one <div class=mz-cite-grid> (trend brief)",
            cite_grid_count >= 1,
            f"found {cite_grid_count}",
        )
        audit.add(
            "§3.8 verdict gauge present (trend brief)",
            bool(VERDICT_GAUGE.search(body)),
            "" if VERDICT_GAUGE.search(body) else "absent",
        )
        audit.add(
            "§3.8 evidence pyramid present (trend brief)",
            bool(EVIDENCE_PYRAMID.search(body)),
            "" if EVIDENCE_PYRAMID.search(body) else "absent",
        )
    else:
        audit.add(
            "§3.8 cite-grid count (info — trend-brief check skipped)",
            True,
            f"found {cite_grid_count}",
        )

    # -- §3.8 zero-headers tripwire -----------------------------------------
    zero_hits = ZERO_HEADERS.findall(body)
    audit.add(
        "§3.8 no '>0 recent/foundational paper' headers",
        not zero_hits,
        f"found {len(zero_hits)} occurrence(s)" if zero_hits else "",
    )

    # -- §3.9 Monday-morning specific ---------------------------------------
    week_label = post.get("week_label") or ""
    is_monday = week_label.startswith("2026-W") or "Monday" in title
    if is_monday:
        audit.add(
            "§3.9 subspecialty / per-group synthesis paragraphs",
            bool(SUBSPECIALTY_PARA.search(body)),
            "",
        )
        audit.add(
            "§3.9 NO '[ pending ]' visible placeholders",
            not PENDING_PLACEHOLDER.search(visible),
            "found visible [ pending ] placeholder" if PENDING_PLACEHOLDER.search(visible) else "",
        )
        audit.add(
            "§3.9 mz-ref superscripts present",
            bool(MZ_REF_SUPS.search(body)),
            "",
        )

    return audit


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def print_audit(audit: PostAudit) -> None:
    print(f"--- {audit.post_id} ({audit.kind}) ---")
    print(f"    title: {audit.title}")
    print(f"    body:  {audit.body_html_len:,} chars")
    for c in audit.checks:
        marker = "✓" if c.passed else "✗"
        line = f"    {marker}  {c.label}"
        if c.detail:
            line += f"  · {c.detail}"
        print(line)
    print()


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="CLAUDE.md §1.2/§3.7/§3.8/§3.9/§3.10/§3.12/§0.8 audit.",
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="Post id (e.g. blog-2026-W21) OR full URL OR omit to audit ALL "
        "published posts when --list is set.",
    )
    parser.add_argument("--list", action="store_true",
                        help="Audit every published post returned by /api/posts/?status=published.")
    parser.add_argument("--file", type=Path,
                        help="Audit a local body_html file (post id = filename stem).")
    args = parser.parse_args(argv)

    posts: list[dict] = []

    if args.file:
        if not args.file.is_file():
            log.error("file not found: %s", args.file)
            return 3
        posts = [{
            "id": args.file.stem,
            "kind": "local-file",
            "title": args.file.name,
            "body_html": args.file.read_text(encoding="utf-8"),
        }]
    elif args.list or not args.target:
        try:
            stubs = list_published_posts()
        except Exception as e:
            log.error("failed to list posts: %s", e)
            return 3
        log.info("auditing %d published post(s)", len(stubs))
        for stub in stubs:
            try:
                posts.append(fetch_post(stub["id"]))
            except Exception as e:
                log.error("failed to fetch %s: %s", stub.get("id"), e)
    else:
        tgt = args.target
        if tgt.startswith("http"):
            # Best-effort id extraction from /evidence/?post=<id>
            m = re.search(r"[?&]post=([^&]+)", tgt)
            if not m:
                log.error("cannot extract post id from URL: %s", tgt)
                return 3
            tgt = m.group(1)
        try:
            posts = [fetch_post(tgt)]
        except Exception as e:
            log.error("failed to fetch %s: %s", tgt, e)
            return 3

    total_fails = 0
    for p in posts:
        audit = audit_post(p)
        print_audit(audit)
        total_fails += audit.fails

    print(f"=== TOTAL FAILS: {total_fails} ===")
    return 0 if total_fails == 0 else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
