#!/usr/bin/env python3
"""Text must use the width it is given — no mid-page wraps, no dead columns.

Owner report (2026-09-02): "many parts of the website where the text
formatting is confused — text wraps to next line in middle of page,
doesn't actually make use of entire width in areas it should."

Runtime audit, measured not eyeballed. For every visible element carrying
substantial text (>=60 chars of its own text, >=2 rendered lines) on every
derived route, at desktop width (1440):

  * NARROW-OFF-CENTER — the element is much narrower than the width its
    container offers (elW < 62% of avail, avail > 800px) AND it is NOT
    centered (side gaps differ by >120px): a column stuck to one side with
    dead space beside it. A centered measure-capped column (~68ch) is good
    typography and is NOT flagged.
  * PREMATURE-WRAP — the rendered line boxes stop well short of the
    element's own width (longest line < 72% of elW): text breaking in the
    middle of its box (text-wrap:balance on prose, pre-line whitespace,
    stray <br>, a narrow inline ancestor).
  * TINY-MEASURE — the element's box itself is under 420px while its
    container offers >900px, centered or not: a strip of text in a void.

Reports offenders grouped by CSS signature (tag.classes) with route,
sample text, and the computed properties that usually cause it
(max-width, text-wrap, white-space). Routes are DERIVED from the tree
(same rule as audit_light_text.py).

  python3 scripts/audit_text_width.py https://mountzara.com
  python3 scripts/audit_text_width.py http://127.0.0.1:8099 --routes=/,/about/
"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com").rstrip("/")
ROUTES = None
for a in sys.argv[2:]:
    if a.startswith("--routes="):
        ROUTES = [r if r.startswith("/") else "/" + r for r in a.split("=", 1)[1].split(",") if r]

def derive_routes():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    routes = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", ".git", "docs", "scripts",
                                    "functions", "assets", "schema", "cron-worker",
                                    "companion-app")]
        if "index.html" in filenames:
            rel = os.path.relpath(dirpath, root)
            routes.append("/" if rel == "." else "/" + rel.replace(os.sep, "/") + "/")
    if os.path.exists(os.path.join(root, "404.html")):
        routes.append("/404.html")
    return sorted(routes)

JS = r"""() => {
  const out = [];
  const seenText = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let el;
  while ((el = walk.nextNode())) {
    const tag = el.tagName;
    if (["SCRIPT","STYLE","NOSCRIPT","SVG","CANVAS","VIDEO","TEMPLATE","DIALOG"].includes(tag)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    // own text only (not descendants') so one paragraph = one record
    let own = "";
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, " ").trim();
    if (own.length < 60) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0) continue;
    if (seenText.has(own.slice(0, 80))) continue;
    seenText.add(own.slice(0, 80));
    // Content inside a CLOSED <details> still reports geometry in WebKit —
    // skip it; only rendered text can wrap wrong.
    if (el.closest("details:not([open])")) continue;
    // TRUE line-box geometry: rects of the element's VISIBLE text nodes,
    // grouped by line top — a line's width is the span from its leftmost
    // fragment to its rightmost. Two false-positive sources excluded:
    // per-text-node measurement (paragraphs carrying <em>/<strong>/<a>
    // split into short fragments) and hidden descendants (the
    // visibility:hidden citation popovers still return range rects).
    const byTop = new Map();
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = tw.nextNode())) {
      if (!tn.textContent.trim()) continue;
      let hid = false, a = tn.parentElement;
      while (a && a !== el.parentElement) {
        const acs2 = getComputedStyle(a);
        if (acs2.visibility === "hidden" || acs2.display === "none" || Number(acs2.opacity) === 0) { hid = true; break; }
        a = a.parentElement;
      }
      if (hid) continue;
      const range = document.createRange();
      range.selectNodeContents(tn);
      for (const rr of range.getClientRects()) {
        if (rr.width < 4 || rr.height < 4) continue;
        const k = Math.round(rr.top / 6);
        const g = byTop.get(k) || { l: rr.left, r: rr.right };
        g.l = Math.min(g.l, rr.left); g.r = Math.max(g.r, rr.right);
        byTop.set(k, g);
      }
    }
    const lines = byTop.size;
    if (lines < 2) continue;
    let maxLine = 0;
    for (const g of byTop.values()) maxLine = Math.max(maxLine, g.r - g.l);
    // available width from nearest sized block ancestor — but a grid/flex
    // CELL's available width is its own track, not the whole container:
    // if the parent lays out multiple columns, the element already fills
    // its cell, so skip the narrow checks for it.
    let anc = el.parentElement, avail = 0, inCell = false;
    while (anc && anc !== document.body) {
      const acs = getComputedStyle(anc);
      if (acs.display.includes("grid")) {
        const cols = (acs.gridTemplateColumns || "").split(" ").filter(Boolean).length;
        if (cols > 1) inCell = true;
      }
      if (acs.display.includes("flex") && !acs.flexDirection.startsWith("column")) {
        let kids = 0;
        for (const c of anc.children) if (getComputedStyle(c).display !== "none") kids++;
        if (kids > 1) inCell = true;
      }
      if (acs.display !== "inline" && anc.clientWidth > 0) {
        avail = anc.clientWidth - parseFloat(acs.paddingLeft) - parseFloat(acs.paddingRight);
        break;
      }
      anc = anc.parentElement;
    }
    if (!avail) avail = document.body.clientWidth;
    if (inCell) avail = Math.min(avail, r.width);   // cell fills its track by definition
    const elW = r.width;
    const ar = anc ? anc.getBoundingClientRect() : {left: 0, right: document.body.clientWidth};
    const leftGap = r.left - ar.left, rightGap = ar.right - r.right;
    const centered = Math.abs(leftGap - rightGap) <= 120;
    const sig = tag.toLowerCase() + (el.className && typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
    const rec = { sig, lines, elW: Math.round(elW), avail: Math.round(avail),
                  maxLine: Math.round(maxLine),
                  leftGap: Math.round(leftGap), rightGap: Math.round(rightGap),
                  maxWidth: cs.maxWidth, textWrap: cs.textWrap || "", whiteSpace: cs.whiteSpace,
                  sample: own.slice(0, 90) };
    if (avail > 800 && elW < 0.62 * avail && !centered) { rec.kind = "narrow-off-center"; out.push(rec); continue; }
    // An INLINE element that starts mid-line wraps "early" by normal flow —
    // only block-level boxes can genuinely wrap prematurely.
    const isBlockish = !cs.display.startsWith("inline");
    if (isBlockish && maxLine > 0 && maxLine < 0.72 * elW) { rec.kind = "premature-wrap"; out.push(rec); continue; }
    if (avail > 900 && elW < 420) { rec.kind = "tiny-measure"; out.push(rec); continue; }
  }
  return out;
}"""

def main():
    routes = ROUTES or derive_routes()
    print(f"  measuring text-width use on {len(routes)} route(s) at 1440px")
    findings = {}
    with sync_playwright() as p:
        browser, engine, note = launch_engine(p, "webkit")
        if note:
            print("NOTE:", note)
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        for route in routes:
            try:
                page.goto(f"{BASE}{route}?cb={int(time.time())}", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(900)
                page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
                recs = page.evaluate(JS)
            except Exception as e:
                print(f"  ! {route}: could not measure: {str(e)[:80]}")
                continue
            for rec in recs:
                key = (rec["kind"], rec["sig"])
                findings.setdefault(key, {"routes": set(), "n": 0, "ex": rec})
                findings[key]["routes"].add(route)
                findings[key]["n"] += 1
        browser.close()
    if not findings:
        print("text-width audit: CLEAN — no confused text blocks found")
        return 0
    print(f"\n{sum(v['n'] for v in findings.values())} confused text block(s), "
          f"{len(findings)} distinct signature(s):\n")
    for (kind, sig), v in sorted(findings.items(), key=lambda kv: -kv[1]["n"]):
        ex = v["ex"]
        rts = sorted(v["routes"])
        print(f"  [{kind}] {sig}  ×{v['n']}  on {len(rts)} route(s) e.g. {rts[0]}")
        print(f"      elW {ex['elW']} of avail {ex['avail']} · longest line {ex['maxLine']} · "
              f"gaps L{ex['leftGap']}/R{ex['rightGap']} · max-width {ex['maxWidth']} · "
              f"text-wrap {ex['textWrap'] or '-'} · white-space {ex['whiteSpace']}")
        print(f"      \"{ex['sample']}…\"")
    return 1

sys.exit(main())
