# -*- coding: utf-8 -*-
"""
apply_authored.py — MECHANICAL merge of clinician-accepted journal-club content
into a post's body_html, replacing the per-section `mz-jc-pending` placeholders.

This is the APPLY half of the deep-dive workflow (see DEEP_DIVE_AUTHORING_PLAN.md
§1). It is structural string surgery only — it GENERATES NOTHING. It takes an
authored mapping that a clinician has accepted and splices each section's text
into the matching `dd-<PMID>-<section>` block. Per CLAUDE.md §3.9 the *authoring*
must already have happened (clinician peer-review); this tool only moves accepted
text into place, the same class of operation as the purge_w2*_offtopic.py scripts.

Authored mapping shape (per PMID, every key optional — only provided sections
are applied; sections not present stay exactly as they are):
    {
      "<PMID>": {
        "bottom":   "<p-inner HTML for the surgeon's bottom line>",
        "monday":   "<p-inner HTML for the change/hold/counsel call>",
        "pico":     {"P": "...", "I": "...", "C": "...", "O": "..."},  # D/S left as-is
        "question": "<full inner HTML for the 'why this matters' section body>",
        "equity":   "<p-inner HTML for the equity paragraph>",
      },
      ...
    }

Usage:
    python3 apply_authored.py --post <body.json> --authored <map.py|.json> \\
            [--out <out.json>] [--apply]
Default is DRY-RUN: prints a per-section diff summary and writes nothing.
`--apply` writes the merged JSON to --out (or <post>.applied.json). It still
never uploads to R2 — deploy is a separate, explicit step after clinician
sign-off on the dry-run diff.
"""
from __future__ import annotations
import argparse, importlib.util, json, re, sys
from html import escape

PENDING_CLASS = "mz-jc-pending"
# Two template eras carry the pending marker differently:
#   W21: section class token `mz-jc-pending` + an h3 badge <span ...>PENDING REVIEW</span>
#   W20: NO section-class token; a bare placeholder <p><span ...>Pending review</span></p>
# Strip the badge span regardless of inner-text casing, and the class token if present.
PENDING_TAG_RE = re.compile(r'\s*<span class="mz-jc-pending-tag">[^<]*</span>')
PENDING_PLACEHOLDER_RE = re.compile(
    r'<span class="mz-jc-pending-tag">[^<]*</span>', re.IGNORECASE)


def _load_authored(path: str) -> dict:
    """Load the authored mapping from a .json file or a .py module exposing
    AUTHORED (the w21_authored.py shape)."""
    if path.endswith(".json"):
        with open(path) as fh:
            return json.load(fh)
    spec = importlib.util.spec_from_file_location("authored_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "AUTHORED"):
        raise SystemExit(f"{path} has no AUTHORED dict")
    return mod.AUTHORED


def _find_section(body: str, pmid: str, section: str) -> tuple[int, int, str] | None:
    """Return (start, end, html) of the <section …id="dd-<PMID>-<section>">…</section>
    block, or None. Matches across all three template eras (mz-jc-section for
    W20/W21, dd-section for W23/W24)."""
    pat = re.compile(
        rf'<section class="(?:mz-jc-section|dd-section)[^"]*" id="dd-{re.escape(pmid)}-{section}">.*?</section>',
        re.DOTALL)
    m = pat.search(body)
    return (m.start(), m.end(), m.group(0)) if m else None


def _strip_pending(block: str) -> str:
    """Remove the pending class token (W21/W23/W24) and any pending badge/
    placeholder span, so an applied section carries no pending marker."""
    block = re.sub(r'(<section class="(?:mz-jc-section|dd-section)[^"]*?)\s*' + PENDING_CLASS + r'(["\s])',
                   r'\1\2', block, count=1)
    block = PENDING_PLACEHOLDER_RE.sub('', block)
    return block


_BLOCK_START = re.compile(r'^\s*<(ul|ol|dl|div|table|p)\b', re.IGNORECASE)


def _apply_text(block: str, content: str) -> tuple[str, bool]:
    """Template-agnostic content insert after the section's <h3>.
    - Inline/prose content → replace the inner of the FIRST content <p>
      (keeps W21's classed <p class="mz-jc-bottom">… and W20's bare <p> wrapper).
    - Block-level content (starts with <ul>/<ol>/<dl>/…, e.g. discussion prompts)
      → replace the ENTIRE following <p>…</p> placeholder with the block so we
      never nest a block inside <p> (invalid HTML)."""
    # Optional wrapper between <h3> and the content <p> (W23/W24: <div class="dd-body">).
    after_h3 = r'(<h3\b.*?</h3>\s*(?:<div[^>]*class="[^"]*dd-body[^"]*"[^>]*>\s*)?'
    if _BLOCK_START.match(content):
        pat = re.compile(after_h3 + r')<p\b[^>]*>.*?</p>', re.DOTALL)
        if not pat.search(block):
            return block, False
        return pat.sub(lambda m: m.group(1) + content, block, count=1), True
    pat = re.compile(after_h3 + r'<p\b[^>]*>).*?(</p>)', re.DOTALL)
    if not pat.search(block):
        return block, False
    return pat.sub(lambda m: m.group(1) + content + m.group(2), block, count=1), True


def _build_pico_dl(fields: dict) -> str:
    """Render a P/I/C/O/D/S dict into a <dl> for templates whose pico section is
    a bare <p> placeholder (W20)."""
    label = [("P", "Population"), ("I", "Intervention / Exposure"),
             ("C", "Comparator"), ("O", "Outcome"),
             ("D", "Design"), ("S", "Sample")]
    rows = "".join(f"<dt>{lab}</dt><dd>{fields[k]}</dd>"
                   for k, lab in label if k in fields)
    return f"<dl>{rows}</dl>"


def _apply_pico(block: str, fields: dict) -> tuple[str, bool]:
    """W21 path: replace the <dd> after each named <dt> in an existing PICO <dl>.
    W20 path: the section is a bare <p> placeholder — swap it for a built <dl>."""
    if "<dl>" in block:
        label = {"P": "Population", "I": "Intervention / Exposure",
                 "C": "Comparator", "O": "Outcome"}
        ok_any = False
        for key, text in fields.items():
            if key not in label:
                continue
            pat = re.compile(rf'(<dt>{re.escape(label[key])}</dt><dd>).*?(</dd>)', re.DOTALL)
            if pat.search(block):
                block = pat.sub(lambda m: m.group(1) + text + m.group(2), block, count=1)
                ok_any = True
        return block, ok_any
    # bare-<p> placeholder: replace the whole content <p>…</p> with the <dl>.
    # Allow an optional dd-body wrapper (W23/W24) between <h3> and the <p>.
    pat = re.compile(
        r'(<h3\b.*?</h3>\s*(?:<div[^>]*class="[^"]*dd-body[^"]*"[^>]*>\s*)?)<p\b[^>]*>.*?</p>',
        re.DOTALL)
    if not pat.search(block):
        return block, False
    dl = _build_pico_dl(fields)
    return pat.sub(lambda m: m.group(1) + dl, block, count=1), True


def apply_to_body(body: str, authored: dict) -> tuple[str, list[str], list[str]]:
    """Return (new_body, applied_log, warnings)."""
    applied: list[str] = []
    warnings: list[str] = []
    for pmid, sections in authored.items():
        for section, content in sections.items():
            loc = _find_section(body, pmid, section)
            if not loc:
                warnings.append(f"{pmid}/{section}: no section block found — skipped")
                continue
            start, end, block = loc
            was_pending = (PENDING_CLASS in block) or ('mz-jc-pending-tag' in block)
            if isinstance(content, dict):  # pico
                new_block, ok = _apply_pico(block, content)
            else:
                new_block, ok = _apply_text(block, content)
            if not ok:
                warnings.append(f"{pmid}/{section}: content slot not found — skipped")
                continue
            new_block = _strip_pending(new_block)
            body = body[:start] + new_block + body[end:]
            applied.append(f"{pmid}/{section}{' (was pending)' if was_pending else ''}")
    return body, applied, warnings


def integrity_checks(before: str, after: str, authored: dict) -> list[str]:
    errs: list[str] = []
    # modal + section counts must be identical (we edit in place, never add/remove)
    for tag, pat in [("dialog", r'<dialog class="mz-jc-modal"'),
                     ("section", r'<section class="mz-jc-section')]:
        b, a = len(re.findall(pat, before)), len(re.findall(pat, after))
        if b != a:
            errs.append(f"{tag} count changed {b}->{a}")
    # tag balance for the elements we touch
    for tag in ("section", "p", "dl", "dd", "dt", "dialog"):
        o = len(re.findall(rf'<{tag}[ >]', after)); c = len(re.findall(rf'</{tag}>', after))
        if o != c:
            errs.append(f"<{tag}> balance {o} open / {c} close")
    # every applied (pmid, section) must no longer carry a pending marker
    # (class token OR placeholder span), across both template eras.
    for pmid, sections in authored.items():
        for section in sections:
            loc = _find_section(after, pmid, section)
            if loc and (PENDING_CLASS in loc[2] or 'mz-jc-pending-tag' in loc[2]):
                errs.append(f"{pmid}/{section}: still marked pending after apply")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--post", required=True, help="post JSON with body_html")
    ap.add_argument("--authored", required=True, help="authored map (.py AUTHORED or .json)")
    ap.add_argument("--out", help="output JSON path (default <post>.applied.json)")
    ap.add_argument("--apply", action="store_true", help="write output (default dry-run)")
    args = ap.parse_args()

    post = json.load(open(args.post))
    authored = _load_authored(args.authored)
    before = post["body_html"]
    after, applied, warnings = apply_to_body(before, authored)
    errs = integrity_checks(before, after, authored)

    print(f"=== apply_authored: {post.get('id')} ===")
    print(f"authored PMIDs in map: {len(authored)}")
    print(f"sections applied: {len(applied)}")
    for a in applied:
        print(f"   + {a}")
    if warnings:
        print(f"warnings ({len(warnings)}):")
        for w in warnings:
            print(f"   ! {w}")
    # show remaining pending across the whole post
    rem = len(re.findall(PENDING_CLASS, after))
    print(f"remaining mz-jc-pending in post after apply: {rem}")
    print(f"body length: {len(before)} -> {len(after)} (delta {len(after)-len(before)})")

    if errs:
        print("\n!!! INTEGRITY ERRORS — NOT WRITING OUTPUT:")
        for e in errs:
            print("   -", e)
        return 1

    if not args.apply:
        print("\nDRY-RUN (no file written). Re-run with --apply after clinician sign-off.")
        return 0

    out = args.out or args.post.replace(".json", ".applied.json")
    post["body_html"] = after
    json.dump(post, open(out, "w"), ensure_ascii=False, indent=2)
    print(f"\nALL CHECKS PASSED -> wrote {out}")
    print("NOTE: this does NOT deploy. Upload to R2 is a separate explicit step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
