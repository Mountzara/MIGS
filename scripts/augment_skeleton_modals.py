#!/usr/bin/env python3
"""DEPRECATED — DO NOT INVOKE.

This script was a legacy modal-skeleton augmenter from the pre-§3.8 codification of canonical 13-section anatomy era of the MountZara content
pipeline. The MountZara codebase audit on 2026-05-26 flagged it as a
fence-off candidate because it could produce content that violates the
latest CLAUDE.md §0.4.1 / §3.7.1 / §3.8 / §3.9 / §3.10 / §3.12 hard rules
if invoked today. Canonical replacement: rebuild_w21_post.py + apply_w21_deep_dive_patch.py Cowork-peer-review workflow (per §3.9 2026-05-20).

If you have a reason to read this file (e.g. recover a prior render
shape, audit a pre-2026-05-26 intermediate state), open it in an editor
rather than executing it.

To restore execution, remove this guard AND ensure the file's output
passes `scripts/regression_audit.py --body-html` or `--post-json`
against the latest CLAUDE.md hard-rule set before any R2 PUT."""

import sys as _sys
_sys.stderr.write(
    "\n!! DEPRECATED LEGACY SCRIPT — refusing to run.\n"
    "!! See module docstring for the canonical replacement.\n"
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/augment_skeleton_modals.py\n\n"
)
_sys.exit(2)


"""augment_skeleton_modals.py — §3.8 item 24 / §3.9 skeleton-modal augmenter.

Adds the deep-dive trigger + dialog scaffold to every <article class="mz-cite-card">
on a post that predates §3.8 item 24 (added 2026-05-25). The clinical content
of the 12 clinician-authored sections is marked
`<span class="mz-jc-pending-tag">Pending review</span>` per the explicit §3.8
item 24 fallback rule — NEVER programmatically generated (forbidden by §3.9).

Section 5 (verbatim abstract) is sourced from the existing
`<details class="mz-abstract">` block already on each card (per §3.7).

What this script DOES:
  - Inject the canonical mz-jc-modal CSS + openDeepDive/closeDeepDive JS once
    near the top of body_html (extracted from blog-2026-W21 production).
  - For each <article class="mz-cite-card">:
      * Extract PMID from the existing <a class="mz-cite-pmid" href="...">.
      * Extract title from <p class="mz-cite-title"> / <h3 class="mz-cite-title">.
      * Extract meta line from <p class="mz-cite-meta">.
      * Extract verbatim abstract from <details class="mz-abstract"> (or empty).
      * Wrap the existing PubMed link in <div class="mz-cite-actions"> and
        append a <button class="mz-deepdive-trigger" onclick="openDeepDive('dd-<PMID>')">.
  - Append one <dialog class="mz-jc-modal" id="dd-<PMID>"> per unique PMID at
    the end of body_html, with abstract section populated and other 12 marked
    "Pending review".

What this script does NOT do:
  - Generate ANY clinical content for the 12 clinician-authored sections.
    That's per §3.9: "NO heuristic / regex-based clinical-content extraction".
  - PUT to R2. Output is written to /tmp/<slug>.augmented.html for review.
  - Modify existing dialogs (idempotent — skips PMIDs that already have one).

Per CLAUDE.md §0.4 — `KNOWN GAP:` produced bodies are §3.8 item 24
"structurally compliant with Pending review markers" only. The 12 sections
must subsequently flow through the Cowork peer-review pipeline per §3.9
before the resulting clinical content is shippable.

Usage:
    python3 scripts/augment_skeleton_modals.py <post-id>
    python3 scripts/augment_skeleton_modals.py --put <post-id>     # PUT after review
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s | %(message)s")
log = logging.getLogger("augment")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15"
ROOT = Path("/Users/beans/Developer/MountZara/MIGS")
W21_TEMPLATE_DIR = Path("/tmp")
OUTPUT_DIR = Path("/tmp")


def fetch_post(post_id: str) -> dict:
    req = urllib.request.Request(
        f"https://mountzara.com/api/posts/{post_id}",
        headers={"User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def load_template(path: Path) -> str:
    if not path.is_file():
        log.error("template not found: %s — run the extraction step first", path)
        sys.exit(3)
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Card parsing
# ---------------------------------------------------------------------------

ARTICLE_RE = re.compile(
    r'<article[^>]*class="[^"]*mz-cite-card[^"]*"[^>]*>(.*?)</article>',
    re.IGNORECASE | re.DOTALL,
)
PMID_LINK_RE = re.compile(
    r'<a[^>]*class="[^"]*mz-cite-pmid[^"]*"[^>]*href="https?://pubmed\.ncbi\.nlm\.nih\.gov/(\d+)/?"[^>]*>.*?</a>',
    re.IGNORECASE | re.DOTALL,
)
TITLE_RE = re.compile(
    r'<(?:p|h3|h4)[^>]*class="[^"]*mz-cite-title[^"]*"[^>]*>(.*?)</(?:p|h3|h4)>',
    re.IGNORECASE | re.DOTALL,
)
META_RE = re.compile(
    r'<p[^>]*class="[^"]*mz-cite-meta[^"]*"[^>]*>(.*?)</p>',
    re.IGNORECASE | re.DOTALL,
)
ABSTRACT_RE = re.compile(
    r'<details[^>]*class="[^"]*mz-abstract[^"]*"[^>]*>(.*?)</details>',
    re.IGNORECASE | re.DOTALL,
)


def strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html).strip()


def extract_card_fields(article_inner: str) -> dict:
    m_pmid = PMID_LINK_RE.search(article_inner)
    m_title = TITLE_RE.search(article_inner)
    m_meta = META_RE.search(article_inner)
    m_abs = ABSTRACT_RE.search(article_inner)
    return {
        "pmid": m_pmid.group(1) if m_pmid else None,
        "title": strip_tags(m_title.group(1)) if m_title else "",
        "meta": strip_tags(m_meta.group(1)) if m_meta else "",
        "abstract_inner": m_abs.group(1) if m_abs else "",
    }


# ---------------------------------------------------------------------------
# Augmentation
# ---------------------------------------------------------------------------

TRIGGER_TEMPLATE = (
    '<div class="mz-cite-actions">'
    '{pmid_link}'
    '<button class="mz-deepdive-trigger" type="button" '
    'onclick="openDeepDive(\'dd-{pmid}\')" '
    'aria-haspopup="dialog" aria-controls="dd-{pmid}">'
    'Open deep dive · journal-club analysis</button>'
    '</div>'
)


def inject_card_trigger(article_inner: str, pmid: str) -> tuple[str, bool]:
    """If the card already has a deep-dive trigger, return unchanged. Else
    wrap the existing PubMed link in <div class="mz-cite-actions"> alongside
    a new trigger button. Returns (new_inner, was_changed)."""
    if "mz-deepdive-trigger" in article_inner:
        return article_inner, False
    m = PMID_LINK_RE.search(article_inner)
    if not m:
        log.warning("PMID %s — card has no PubMed link to wrap; skipping trigger", pmid)
        return article_inner, False
    pmid_link = m.group(0)
    actions = TRIGGER_TEMPLATE.format(pmid=pmid, pmid_link=pmid_link)
    new_inner = article_inner.replace(pmid_link, actions, 1)
    return new_inner, True


# ---------------------------------------------------------------------------
# Dialog template
# ---------------------------------------------------------------------------

# Skeleton dialog with 13 sections — section 5 (abstract) is populated from
# the card's verbatim PubMed efetch; the other 12 show the honest §3.8 item 24
# `Pending review` marker. Section IDs match the production naming
# convention verified on blog-2026-W21 (dd-<PMID>-<suffix>).
PENDING_TAG = '<span class="mz-jc-pending-tag">Pending review</span>'

DIALOG_TEMPLATE = """
<dialog class="mz-jc-modal" id="dd-{pmid}" aria-labelledby="dd-{pmid}-title">
  <div class="mz-jc-modal-inner">
    <button class="mz-jc-close" type="button" aria-label="Close" onclick="closeDeepDive('dd-{pmid}')">×</button>
    <header class="mz-jc-modal-header">
      <p class="mz-jc-modal-eyebrow">Journal Club · Deep Dive</p>
      <h2 class="mz-jc-modal-title" id="dd-{pmid}-title">{title}</h2>
      <p class="mz-jc-modal-cite">{meta}</p>
      <p class="mz-jc-modal-meta"><strong>PubMed</strong> · <a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noopener noreferrer">PMID {pmid} ↗</a></p>
    </header>
    <nav class="mz-jc-modal-toc" aria-label="Journal-club sections">
      <a href="#dd-{pmid}-bottom">TL;DR</a>
      <a href="#dd-{pmid}-question">Clinical question</a>
      <a href="#dd-{pmid}-pico">PICO</a>
      <a href="#dd-{pmid}-methods">Methods</a>
      <a href="#dd-{pmid}-abstract">Verbatim abstract</a>
      <a href="#dd-{pmid}-findings">Key findings</a>
      <a href="#dd-{pmid}-rob">Risk of bias</a>
      <a href="#dd-{pmid}-strengths">Strengths</a>
      <a href="#dd-{pmid}-applicability">Applicability</a>
      <a href="#dd-{pmid}-kb">In the literature</a>
      <a href="#dd-{pmid}-equity">Equity</a>
      <a href="#dd-{pmid}-monday">Monday clinic</a>
      <a href="#dd-{pmid}-prompts">Discussion</a>
    </nav>
    <section class="mz-jc-section mz-jc-section-bottom-line" id="dd-{pmid}-bottom">
      <h3>The bottom line for the surgeon</h3>
      <p class="mz-jc-bottom">{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-question" id="dd-{pmid}-question">
      <h3>1 · Clinical question</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-pico" id="dd-{pmid}-pico">
      <h3>2 · PICO</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-methods" id="dd-{pmid}-methods">
      <h3>3 · Methodology</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-abstract" id="dd-{pmid}-abstract">
      <h3>4 · Verbatim abstract (PubMed efetch)</h3>
      {abstract_block}
    </section>
    <section class="mz-jc-section mz-jc-findings" id="dd-{pmid}-findings">
      <h3>5 · Key findings</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-rob" id="dd-{pmid}-rob">
      <h3>6 · Risk of bias</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-strengths" id="dd-{pmid}-strengths">
      <h3>7 · Strengths</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-applicability" id="dd-{pmid}-applicability">
      <h3>8 · External validity / applicability</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-kb" id="dd-{pmid}-kb">
      <h3>9 · Where it fits in the literature (KB placement)</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-equity" id="dd-{pmid}-equity">
      <h3>10 · Equity considerations</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-monday" id="dd-{pmid}-monday">
      <h3>11 · Monday-clinic takeaway</h3>
      <p>{pending}</p>
    </section>
    <section class="mz-jc-section mz-jc-prompts" id="dd-{pmid}-prompts">
      <h3>12 · Discussion prompts</h3>
      <p>{pending}</p>
    </section>
  </div>
</dialog>
""".strip()


def build_dialog(pmid: str, title: str, meta: str, abstract_inner: str) -> str:
    abstract_block = (
        abstract_inner
        if abstract_inner.strip()
        else f'<p class="mz-jc-pending">{PENDING_TAG} — no PubMed abstract on card.</p>'
    )
    return DIALOG_TEMPLATE.format(
        pmid=pmid,
        title=title or "Deep dive",
        meta=meta or "—",
        abstract_block=abstract_block,
        pending=PENDING_TAG,
    )


# ---------------------------------------------------------------------------
# Top-level augment
# ---------------------------------------------------------------------------


def augment(body_html: str, modal_css: str, modal_js: str) -> tuple[str, dict]:
    """Return (augmented_body, stats)."""
    stats = {"cards_seen": 0, "triggers_injected": 0,
             "dialogs_created": 0, "skipped_no_pmid": 0}
    pmid_to_dialog: dict[str, str] = {}

    def replace_article(m: re.Match) -> str:
        stats["cards_seen"] += 1
        inner = m.group(1)
        fields = extract_card_fields(inner)
        pmid = fields["pmid"]
        if not pmid:
            stats["skipped_no_pmid"] += 1
            return m.group(0)
        new_inner, changed = inject_card_trigger(inner, pmid)
        if changed:
            stats["triggers_injected"] += 1
        if pmid not in pmid_to_dialog:
            pmid_to_dialog[pmid] = build_dialog(
                pmid, fields["title"], fields["meta"], fields["abstract_inner"]
            )
            stats["dialogs_created"] += 1
        article_open = m.group(0)[: m.start(1) - m.start(0)]
        return article_open + new_inner + "</article>"

    new_body = ARTICLE_RE.sub(replace_article, body_html)

    # If the post already has the modal CSS/JS, skip; otherwise prepend.
    head_assets = ""
    if "mz-jc-modal" not in new_body or "openDeepDive" not in new_body:
        head_assets = f"\n<!-- §3.8 item 24 deep-dive modal infrastructure -->\n{modal_css}\n{modal_js}\n"

    # Append dialogs once, after the existing body, in numeric PMID order
    # (stable across reruns).
    dialogs_html = "\n".join(pmid_to_dialog[p] for p in sorted(pmid_to_dialog))

    augmented = head_assets + new_body + "\n<!-- §3.8 item 24 deep-dive dialogs -->\n" + dialogs_html + "\n"
    return augmented, stats


# ---------------------------------------------------------------------------
# Admin PUT helper
# ---------------------------------------------------------------------------


def admin_put(post_id: str, body_html: str) -> None:
    log.info("PUT /api/posts/%s — %d chars", post_id, len(body_html))
    # Use scripts/_lib_admin_auth.sh resolution path.
    env = os.environ.copy()
    auth_cmd = (
        f"source {ROOT}/scripts/_lib_admin_auth.sh && resolve_admin_auth && "
        f"echo MZ_ADMIN_USER=$MZ_ADMIN_USER && echo MZ_ADMIN_PASS=$MZ_ADMIN_PASS"
    )
    proc = subprocess.run(
        ["bash", "-c", auth_cmd], capture_output=True, text=True, check=True,
    )
    user = pwd = None
    for line in proc.stdout.splitlines():
        if line.startswith("MZ_ADMIN_USER="):
            user = line.split("=", 1)[1]
        if line.startswith("MZ_ADMIN_PASS="):
            pwd = line.split("=", 1)[1]
    if not user or not pwd:
        log.error("admin auth resolution failed:\n%s\n%s", proc.stdout, proc.stderr)
        sys.exit(4)

    payload = json.dumps({"body_html": body_html}).encode("utf-8")
    import base64
    auth = base64.b64encode(f"{user}:{pwd}".encode()).decode()
    req = urllib.request.Request(
        f"https://mountzara.com/api/posts/{post_id}",
        data=payload,
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {auth}",
            "User-Agent": UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            log.info("PUT response: HTTP %s — %s", r.status, r.read().decode()[:120])
    except urllib.error.HTTPError as e:
        log.error("PUT failed: HTTP %s — %s", e.code, e.read().decode()[:200])
        sys.exit(5)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("post_id")
    parser.add_argument("--put", action="store_true",
                        help="PUT the augmented body_html to /api/posts/<post_id>")
    args = parser.parse_args(argv)

    modal_css = load_template(W21_TEMPLATE_DIR / "dd_style.html")
    modal_js = load_template(W21_TEMPLATE_DIR / "dd_script.html")

    post = fetch_post(args.post_id)
    body = post.get("body_html") or ""
    if not body:
        log.error("post %s has empty body_html", args.post_id)
        return 3
    log.info("loaded %s — %d chars", args.post_id, len(body))

    augmented, stats = augment(body, modal_css, modal_js)
    out_path = OUTPUT_DIR / f"{args.post_id}.augmented.html"
    out_path.write_text(augmented, encoding="utf-8")
    log.info("wrote %s — %d chars", out_path, len(augmented))
    log.info("stats: %s", stats)

    if args.put:
        admin_put(args.post_id, augmented)
        log.info("done")
    else:
        log.info("DRY RUN — review %s and re-run with --put to ship", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
