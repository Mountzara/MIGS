#!/usr/bin/env python3
"""Fill the popover findings four published posts shipped without.

The spec popover carries title, meta and a FINDING — the plain-language
"what this paper shows" line. Four published posts (blog-2026-W20 and three
May evidence deep-dives) carry popovers with only title+meta: 51 citations a
reader hovers and learns nothing from, even though the finding text sits in
the SAME POST's cite cards, where the pipeline normally sources it.

This does not re-implement the sourcing rules — it imports them from
scripts/apply_inline_refs.py (card_index, bad_finding): the same preamble
stripping, the same rejection of raw abstract dumps and author lists. A
card whose lens text fails those rules contributes nothing, exactly as it
would in the pipeline; those citations stay title+meta and are reported.

Edits ONLY the popover spans. Asserts the post's text outside popovers is
byte-identical before writing anything.

  python3 scripts/fix_post_popovers.py            # dry run
  python3 scripts/fix_post_popovers.py --apply
"""
import re, sys, os, json, html, base64, subprocess, importlib.util

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("air", os.path.join(os.path.dirname(__file__), "apply_inline_refs.py"))
air = importlib.util.module_from_spec(spec); spec.loader.exec_module(air)

BASE = "https://mountzara.com"
APPLY = "--apply" in sys.argv
ADMIN_USER = "chris.mabini@gmail.com"
ADMIN_PASS = os.environ.get("ADMIN_PASS_ENV") or "MartyBeans!2345"

def req(path, method="GET", body=None, auth=False):
    import tempfile
    cmd = ["curl", "-sS", "--fail-with-body", "-X", method,
           "-H", "User-Agent: mz-operator-tools/1.0 (fix_post_popovers)", BASE + path]
    if auth: cmd += ["-u", f"{ADMIN_USER}:{ADMIN_PASS}"]
    tmp = None
    if body is not None:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(body, tmp, ensure_ascii=False); tmp.close()
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@" + tmp.name]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if tmp: os.unlink(tmp.name)
    if out.returncode != 0:
        raise RuntimeError(f"{method} {path}: {out.stderr.strip()[:120]}")
    return json.loads(out.stdout)

POP_RE = re.compile(r'(<span class="mz-ref-pop"[^>]*>)([\s\S]*?)(</span>)(?=</sup>)')
PMID_NEAR = re.compile(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})|id="ref-pop-(\d{5,9})"')

def strip_pops(body):
    return POP_RE.sub("", body)

def main():
    ids = []
    for kind in ("evidence", "blog"):
        for p in (req(f"/api/posts?kind={kind}&status=published").get("posts") or []):
            if p["id"] not in ids: ids.append(p["id"])
    fixed_posts = 0
    for pid in ids:
        doc = req(f"/api/posts/{pid}")
        post = doc.get("post") or doc
        key = "body_html" if "body_html" in post else "body"
        body = post.get(key) or ""
        cards = air.card_index(body)
        added = [0]; renamed = [0]; nocard = []
        def sub(m):
            head, inner, tail = m.group(1), m.group(2), m.group(3)
            # One post (blog-2026-W20) was authored by an earlier pipeline whose
            # popovers used mz-ref-title/-meta/-finding, without the -pop- infix.
            # Content is complete; only the class schema differs. Normalise to the
            # one spec schema — a pure attribute rename, zero text changes.
            if 'class="mz-ref-title"' in inner and "mz-ref-pop-title" not in inner:
                inner = (inner
                         .replace('class="mz-ref-title"', 'class="mz-ref-pop-title"')
                         .replace('class="mz-ref-meta"', 'class="mz-ref-pop-meta"')
                         .replace('class="mz-ref-finding"', 'class="mz-ref-pop-finding"'))
                renamed[0] += 1
            if "mz-ref-pop-finding" in inner:
                return head + inner + tail
            # the pmid lives in the sup around this popover, or in the pop id
            around = body[max(0, m.start()-500):m.start()+len(m.group(0))]
            pm = None
            for mm in PMID_NEAR.finditer(around):
                pm = mm.group(1) or mm.group(2)
            card = cards.get(pm) if pm else None
            if not card or not card.get("finding"):
                nocard.append(pm or "?")
                return m.group(0)
            added[0] += 1
            finding = f'<span class="mz-ref-pop-finding">{html.escape(card["finding"], quote=False)}</span>'
            return head + inner + finding + tail
        out = POP_RE.sub(sub, body)
        assert strip_pops(out) == strip_pops(body), f"{pid}: text outside popovers changed — refusing"
        if not added[0] and not renamed[0]:
            continue
        fixed_posts += 1
        print(f"  {pid[:56]:58s} +{added[0]:3d} finding(s), {renamed[0]} popover(s) renamed to spec schema"
              + (f", {len(set(nocard))} citation(s) with no usable lens text" if nocard else ""))
        if APPLY:
            req(f"/api/posts/{pid}", "PUT", {key: out}, auth=True)
    print(f"\n{fixed_posts} post(s) {'updated' if APPLY else 'would change (dry run — pass --apply)'}")
    return 0

sys.exit(main())
