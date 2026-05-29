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
  §0.8   — KB-anchor manifest present. Canonical location is the post's
            top-level structured fields (`pmids_cited`, `kb_entries_retrieved`,
            `run_manifest_path`, `topics_covered`). Legacy HTML-comment
            embed is accepted as a fallback for W20/W21-era posts.

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

# §3.12 — medicolegal disclaimer markers. Checked against VISIBLE text only
# (comments stripped) so a `<!-- TODO: add disclaimer -->` comment cannot
# falsely satisfy the check. Discovered via negative-test 2026-05-25.
DISCLAIMER = re.compile(
    r"medicolegal|AI-assisted|not a substitute|professional advice|not medical advice",
    re.IGNORECASE,
)

# §0.8 — KB-anchor manifest detection.
#
# The §0.8 manifest lives inside an HTML comment per CLAUDE.md §0.8.1. A
# legitimate manifest is a JSON-shaped block carrying at least one of the
# structural keys (kb_entries_retrieved, pmids_cited, topic_groups_anchored,
# kb_chunks_loaded). The earlier "match the literal phrase 'KB-anchor
# manifest'" rule had a false-positive on bodies that merely MENTIONED the
# manifest in prose or in placeholder comments — discovered via the
# negative-test 2026-05-25.
#
# Strategy: pull every HTML comment, look inside each for ≥1 structural
# manifest key. Comment-text without those keys does NOT count.
KB_MANIFEST_KEYS = re.compile(
    # Any kb_*, pmid_*, pmids_*, or topic_*_anchored / *_synthesis_*
    # key — covers the two emit conventions in production:
    #   W20 / trend briefs: topic_groups_anchored, pmid_count, pmids_efetched_per_card
    #   W21:                kb_topic_syntheses_loaded, topic_synthesis_id
    # plus the older kb_anchor_manifest / kb_entries_retrieved / pmids_cited.
    # A real manifest will carry ≥1 of these as a JSON key. Phrase-only
    # mentions in placeholder comments will not.
    r'"(?:'
    r'kb_[a-z_]+|'
    r'pmids?_[a-z_]+|'
    r'pmid_count|'
    r'topic_[a-z_]+_anchored|'
    r'topic_synthesis_id|'
    r'topic_groups_anchored|'
    r'manifest'
    r')"\s*:',
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

# §3.8 item 24 (added 2026-05-25) + §3.9 deep-dive modal — every cite card on
# a trend brief or Monday Morning post MUST have:
#   1. A <button class="mz-deepdive-trigger" onclick="openDeepDive('dd-<PMID>')">
#   2. A sibling <dialog class="mz-jc-modal" id="dd-<PMID>"> per unique PMID
#   3. The dialog contains all 13 §3.9 sections by anchor id
# Section 5 (verbatim abstract) renders from PubMed efetch per §3.7; other 12
# sections may be authored or marked `<span class="mz-jc-pending-tag">Pending review</span>`.
# Authoring path is the Cowork peer-review workflow per §3.9 — NEVER programmatic.
DEEPDIVE_TRIGGER = re.compile(r'class="[^"]*mz-deepdive-trigger[^"]*"', re.IGNORECASE)
DEEPDIVE_DIALOG = re.compile(
    r'<dialog[^>]*class="[^"]*mz-jc-modal[^"]*"[^>]*id="dd-([^"]+)"',
    re.IGNORECASE,
)
DEEPDIVE_OPEN_CALL = re.compile(
    r"openDeepDive\(['\"]dd-([^'\"]+)['\"]\)",
    re.IGNORECASE,
)
# 13 anchor sections per §3.9 deep-dive modal anatomy.
# Production naming convention (verified against blog-2026-W21 2026-05-25):
# section IDs are emitted as `dd-<PMID>-<suffix>`; the suffix is one of:
DEEPDIVE_SECTION_ANCHORS = [
    "bottom",        # TL;DR / bottom-line-up-front
    "question",      # Clinical question
    "pico",          # PICO breakdown
    "methods",       # Methodology
    "abstract",      # Verbatim PubMed abstract (§3.7)
    "findings",      # Key findings
    "rob",           # Risk of bias
    "strengths",     # Strengths
    "applicability", # External validity / applicability
    "kb",            # KB placement
    "equity",        # Equity considerations
    "monday",        # Monday-clinic takeaway
    "prompts",       # Discussion prompts
]

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


_MZ_ABSTRACT_ELEMENT = re.compile(
    r'<details[^>]*class="[^"]*mz-abstract[^"]*"[^>]*>',
    re.IGNORECASE,
)


def cards_with_abstracts(article_contents: Iterable[str]) -> int:
    """Per §3.7 + §3.8: a card "has an abstract" only if it contains an
    actual `<details class="mz-abstract">` element. The earlier substring
    check matched any occurrence of the literal text 'mz-abstract' — which
    fires on cards that merely DESCRIBE the absence of the block in prose.
    Discovered via negative-test 2026-05-25."""
    return sum(1 for c in article_contents if _MZ_ABSTRACT_ELEMENT.search(c))


# ---------------------------------------------------------------------------
# Core auditor
# ---------------------------------------------------------------------------


def audit_post(post: dict) -> PostAudit:
    pid = post.get("id") or ""
    kind = post.get("kind") or ""
    title = (post.get("title") or "")[:120]
    body = post.get("body_html") or ""

    # Additional user-facing surfaces that §1.2 + §3.7/§3.11 govern, NOT just
    # body_html. The /evidence/ post detail page renders `summary` as the
    # "CLAIM UNDER REVIEW" panel, `verdict` as the labelled verdict line,
    # and `title` as the page H1. Social drafts (linkedin_draft,
    # instagram_draft) are public-facing the moment they're queued.
    # Discovered 2026-05-25 when an audit of W20 visually showed
    #   "MIGS Monday Morning — ... §0.8 KB-anchored synthesis ... verified PMIDs"
    # in the rendered summary — invisible to a body_html-only scan.
    summary = post.get("summary") or ""
    verdict_str = post.get("verdict") or ""
    li_draft = post.get("linkedin_draft") or ""
    ig_draft = post.get("instagram_draft") or ""

    # `visible` = the rendered text the reader sees from body_html (no HTML
    # markup, no JS, no CSS) PLUS the public-facing string fields. Used for
    # §1.2 / §3.7 / §3.9 scans which govern user-facing text only. The full
    # `body` is still used for §3.8 / §3.10 / §0.8 checks that operate on
    # the HTML structure itself.
    visible_body = visible_text(body)
    visible = "\n".join([
        title, summary, verdict_str, li_draft, ig_draft, visible_body,
    ])
    log.info(
        "auditing %s (kind=%s title=%r body_html=%d, summary=%d, verdict=%d, li=%d, ig=%d, visible=%d chars)",
        pid, kind, title[:60], len(body), len(summary), len(verdict_str),
        len(li_draft), len(ig_draft), len(visible),
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
    # Scan VISIBLE text — a `<!-- TODO: add disclaimer -->` comment must NOT
    # falsely satisfy this. Found via negative-test 2026-05-25.
    disclaimer_hits = DISCLAIMER.findall(visible_body)
    audit.add(
        "§3.12 medicolegal disclaimer present",
        bool(disclaimer_hits),
        f"{len(disclaimer_hits)} marker(s)" if disclaimer_hits else "absent",
    )

    # -- §0.8 manifest -------------------------------------------------------
    # CANONICAL DETECTION (2026-05-25 update — verified against
    # functions/api/posts/[[path]].js lines 302-322):
    #
    # The §0.8 KB-anchor manifest is stored as STRUCTURED TOP-LEVEL FIELDS
    # on every post R2 record:
    #     pmids_cited:           array of PMIDs (required for clinical posts)
    #     kb_entries_retrieved:  array of KB-chunk synthesis ids
    #     run_manifest_path:     R2 path to the full pipeline manifest
    #     topics_covered:        array of clinical topic groups
    #     gaps_surfaced:         array of evidence gaps surfaced
    #
    # These top-level fields are the truth-of-record. The legacy convention
    # of embedding the same JSON inside an HTML comment (used in W20/W21)
    # is a duplicative *secondary* surface. Either location satisfies §0.8.
    #
    # A pre-2026-05-25 version of this audit only scanned HTML comments
    # and incorrectly failed every pipeline-rendered draft because the
    # gold_brief_render.py output writes the structured fields without
    # the legacy HTML-comment duplicate. Discovered by user 2026-05-25:
    #   "permanently fix this so if claude.md needs to be updated then
    #    fucking update it as we go"
    manifest_in_comment = False
    for cmt in re.finditer(r"<!--(.*?)-->", body, re.DOTALL):
        if KB_MANIFEST_KEYS.search(cmt.group(1)):
            manifest_in_comment = True
            break

    # Treat the structured fields as authoritative.
    pmids_list = post.get("pmids_cited") or []
    kb_list = post.get("kb_entries_retrieved") or []
    topics_list = post.get("topics_covered") or []
    run_manifest = post.get("run_manifest_path") or ""
    manifest_in_fields = (
        (isinstance(pmids_list, list) and len(pmids_list) > 0)
        or (isinstance(kb_list, list) and len(kb_list) > 0)
        or bool(run_manifest)
    )
    manifest_present = manifest_in_comment or manifest_in_fields

    detail_bits: list[str] = []
    if manifest_in_fields:
        detail_bits.append(
            f"top-level fields: pmids_cited={len(pmids_list) if isinstance(pmids_list, list) else '?'}, "
            f"kb_entries_retrieved={len(kb_list) if isinstance(kb_list, list) else '?'}, "
            f"topics_covered={len(topics_list) if isinstance(topics_list, list) else '?'}, "
            f"run_manifest_path={'set' if run_manifest else 'empty'}"
        )
    if manifest_in_comment:
        detail_bits.append("HTML-comment manifest also present")
    if not manifest_present:
        detail_bits.append(
            "absent in BOTH the post's top-level fields "
            "(pmids_cited / kb_entries_retrieved / run_manifest_path) "
            "AND in any HTML comment — clinical posts MUST carry the manifest"
        )

    audit.add(
        "§0.8 KB-anchor manifest present",
        manifest_present,
        " · ".join(detail_bits) if detail_bits else "",
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

    # -- §3.8 item 24 + §3.9 deep-dive modal coverage -----------------------
    # Trend briefs AND Monday Morning posts require every cite card to have
    # a deep-dive trigger + matching modal. Only check when the post has
    # cards in the first place.
    if cards_n > 0:
        trigger_count = len(DEEPDIVE_TRIGGER.findall(body))
        open_calls = set(DEEPDIVE_OPEN_CALL.findall(body))
        dialog_ids = set(DEEPDIVE_DIALOG.findall(body))

        # Rule a: every card has a trigger. Triggers can exceed cards (the
        # 5-papers section reuses cards), so ≥1 trigger per card is the floor.
        audit.add(
            "§3.8 item 24 — every cite card has a deep-dive trigger",
            trigger_count >= cards_n,
            f"{trigger_count} triggers vs {cards_n} cards"
            + (" — MISSING triggers" if trigger_count < cards_n else ""),
        )

        # Rule b: openDeepDive(...) IDs must each have a matching <dialog id="dd-...">
        unmatched_calls = open_calls - dialog_ids
        unmatched_dialogs = dialog_ids - open_calls
        audit.add(
            "§3.8 item 24 — every openDeepDive('dd-<PMID>') has a matching <dialog>",
            not unmatched_calls,
            f"{len(unmatched_calls)} unmatched openDeepDive ids: {sorted(unmatched_calls)[:3]}"
            if unmatched_calls else f"{len(dialog_ids)} unique dialogs",
        )
        if unmatched_dialogs:
            audit.add(
                "§3.8 item 24 — orphaned dialogs (informational)",
                True,
                f"{len(unmatched_dialogs)} dialog(s) with no openDeepDive call",
            )

        # Rule b.1 (added 2026-05-25): the HTML id attribute MUST be unique
        # per-document — W3C HTML Living Standard §3.2.5.1. A duplicate
        # `id="dd-<PMID>"` means the browser will only ever target the
        # FIRST occurrence on `document.getElementById(...)` /
        # `showModal()` — the others are dead DOM. Discovered on W21
        # 2026-05-25: 115 actual dialogs, 103 unique PMIDs, 12 dialogs
        # silently unreachable.
        all_dialog_ids = re.findall(
            r'<dialog[^>]*class="[^"]*mz-jc-modal[^"]*"[^>]*id="dd-([^"]+)"',
            body, re.IGNORECASE,
        )
        from collections import Counter as _Counter
        id_counts = _Counter(all_dialog_ids)
        dup_ids = {k: v for k, v in id_counts.items() if v > 1}
        audit.add(
            "§3.8 item 24 — dialog ids are unique (W3C HTML id-uniqueness)",
            not dup_ids,
            (f"{len(dup_ids)} duplicate dd-<PMID> id(s) across "
             f"{sum(dup_ids.values())} dialog elements: "
             f"{sorted(dup_ids.items(), key=lambda x: -x[1])[:5]}")
            if dup_ids else
            f"{len(all_dialog_ids)} dialogs, {len(id_counts)} unique ids",
        )

        # Rule c: each dialog must contain ALL 13 §3.9 section anchors.
        # Production emits anchors as `id="dd-<PMID>-<suffix>"` per the
        # naming convention verified on blog-2026-W21 (2026-05-25). We
        # iterate each dialog, capture its PMID from id="dd-<PMID>", then
        # check that every required suffix is present as `id="dd-<PMID>-<suffix>"`.
        modals_complete = 0
        modals_partial = 0
        partial_examples: list[str] = []
        for m in re.finditer(
            r'<dialog[^>]*class="[^"]*mz-jc-modal[^"]*"[^>]*id="dd-([^"]+)"[^>]*>(.*?)</dialog>',
            body, re.IGNORECASE | re.DOTALL,
        ):
            pmid = m.group(1)
            content = m.group(2)
            missing = [
                a for a in DEEPDIVE_SECTION_ANCHORS
                if not re.search(rf'\bid="dd-{re.escape(pmid)}-{re.escape(a)}"', content)
            ]
            if not missing:
                modals_complete += 1
            else:
                modals_partial += 1
                if len(partial_examples) < 3:
                    partial_examples.append(f"dd-{pmid}: missing {missing[:4]}")
        audit.add(
            "§3.8 item 24 — every modal has all 13 §3.9 sections",
            modals_partial == 0 and modals_complete >= 1 if dialog_ids
            else trigger_count == 0,  # if no triggers either, the post is exempt above
            (f"{modals_complete} complete, {modals_partial} partial of {len(dialog_ids)} dialogs"
             + (f" — examples: {partial_examples}" if partial_examples else "")
             if dialog_ids else "no dialogs (n/a)"),
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
    parser.add_argument("--pre-put", type=Path,
                        help="MANDATORY pre-write gate per CLAUDE.md §3.7.1. "
                        "Pass a JSON file containing the proposed post payload "
                        "(any subset of title/summary/verdict/linkedin_draft/"
                        "instagram_draft/body_html). Audit runs against the "
                        "payload BEFORE any PUT/POST. Non-zero exit = abort write.")
    args = parser.parse_args(argv)

    posts: list[dict] = []

    # §3.7.1 pre-PUT gate — pipeline scripts call this BEFORE writing to
    # /api/posts/*. Payload may be any subset of post fields; we audit
    # the FULL POST STATE AFTER THE PROPOSED PUT (merged with current
    # live post). This is the truthful audit — if you're only updating
    # `summary`, body_html stays whatever's live, and we audit what the
    # post will look like once your PUT lands.
    if args.pre_put:
        if not args.pre_put.is_file():
            log.error("pre-put payload not found: %s", args.pre_put)
            return 3
        try:
            payload = json.loads(args.pre_put.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.error("pre-put payload JSON parse failed: %s", e)
            return 3

        post_id = payload.get("id") or args.pre_put.stem
        merged: dict
        if post_id and not post_id.startswith("pre-put"):
            # Try to fetch the existing post and merge the payload on top.
            try:
                live = fetch_post(post_id)
                merged = dict(live)
                merged.update({
                    k: v for k, v in payload.items()
                    if v is not None and k != "id"
                })
                log.info("PRE-PUT GATE: merged proposed payload onto live %s "
                         "(payload fields: %s)",
                         post_id,
                         [k for k in payload if k != "id"])
            except Exception as e:
                log.warning("could not fetch live post %s (%s) — auditing "
                            "payload as-is", post_id, e)
                merged = {
                    "id": post_id, "kind": payload.get("kind") or "pre-put",
                    "title": "", "summary": "", "verdict": "",
                    "linkedin_draft": "", "instagram_draft": "",
                    "body_html": "", "week_label": None,
                }
                merged.update({k: v for k, v in payload.items() if k != "id"})
        else:
            # Synthetic / no-live-post test path. Audit fields as-is. We
            # PASS THROUGH the full payload (rather than allowlisting a
            # handful of fields) so the §0.8.2 structured manifest fields
            # (pmids_cited, kb_entries_retrieved, run_manifest_path,
            # topics_covered, gaps_surfaced) reach the auditor — without
            # this, a synthetic payload that legitimately carries the
            # canonical structured manifest would falsely fail §0.8.
            # Discovered 2026-05-25 during the §0.8 detection-rule fix.
            merged = {
                "id": post_id,
                "kind": payload.get("kind") or "pre-put",
                "title": "", "summary": "", "verdict": "",
                "linkedin_draft": "", "instagram_draft": "",
                "body_html": "", "week_label": None,
            }
            merged.update({k: v for k, v in payload.items() if k != "id"})
            log.info("PRE-PUT GATE: synthetic payload audit for %s "
                     "(payload fields: %s)",
                     post_id,
                     sorted([k for k in payload if k != "id"]))
        posts = [merged]
    elif args.file:
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
