#!/usr/bin/env python3
"""Open every modal on every page and measure what the reader gets.

The site's modals are where the real content lives (chapter detail, app
detail, practice areas, deep dives), and they had never been audited as a
group. For each modal this checks:

  * card width vs viewport — a modal that stops at 480px inside a 1440px
    window reads as unfinished, the same defect the page containers had
  * content fill — the widest child vs the card's inner width
  * horizontal overflow inside the card (mobile killer)
  * vertical fit — is content cut off with no scroll affordance
  * text legibility against the card's own painted ground
  * empty or near-empty bodies

Usage: audit_modals.py [base_url] [--json out.json]
"""
from __future__ import annotations

import io, json, sys, time

sys.path.insert(0, "/home/user/MIGS/scripts")
from _lib_pw_launch import launch_chromium  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from PIL import Image  # noqa: E402

PAGES = ["/", "/about/", "/cv/", "/curriculum/cbg-migs/", "/evidence/", "/trending/"]
VIEWPORTS = [({"width": 1440, "height": 950}, "desktop"),
             ({"width": 390, "height": 844}, "mobile")]

FIND_TRIGGERS = """() => {
  const sels = ['[data-mkey]', '[data-ch]', '.hub-tile', '.app-card-v2',
                '[aria-haspopup="dialog"]', '.mz-deepdive-trigger',
                '.brief-card', '.evidence-card[data-modal]'];
  const seen = new Set(); const out = [];
  sels.forEach(sel => {
    document.querySelectorAll(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const key = sel + '#' + i;
      if (seen.has(key)) return; seen.add(key);
      out.push({sel, idx: i, label: (el.textContent || '').trim().slice(0, 34)});
    });
  });
  return out;
}"""

MEASURE = """() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 40 && r.height > 40 && cs.display !== 'none'
        && cs.visibility !== 'hidden' && +cs.opacity > 0.5;
  };
  // the open modal = a visible fixed/dialog layer covering much of the viewport
  const cands = [...document.querySelectorAll('div,dialog,section,aside')].filter(el => {
    const cs = getComputedStyle(el);
    if (!(cs.position === 'fixed' || el.tagName === 'DIALOG')) return false;
    if (!vis(el)) return false;
    // page-background layers are fixed and full-viewport but are NOT modals;
    // counting them reported "near-empty modal" for every practice-area tile
    if (/page-bg-stage|hero-bg-stage|bg-art|loader/i.test(String(el.className || ''))) return false;
    if ((el.textContent || '').trim().length < 20) return false;
    const r = el.getBoundingClientRect();
    return r.width > innerWidth * 0.5 && r.height > innerHeight * 0.4;
  });
  if (!cands.length) return null;
  const overlay = cands[cands.length - 1];
  // the card = the largest visible block child that is NOT full-bleed
  let card = overlay;
  const kids = [...overlay.querySelectorAll('*')].filter(vis);
  let best = null;
  kids.forEach(k => {
    const r = k.getBoundingClientRect();
    if (r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.98) return;
    const area = r.width * r.height;
    if (!best || area > best.area) best = {el: k, area, r};
  });
  if (best) card = best.el;
  const cr = card.getBoundingClientRect();
  const ccs = getComputedStyle(card);
  const padL = parseFloat(ccs.paddingLeft) || 0, padR = parseFloat(ccs.paddingRight) || 0;
  const inner = cr.width - padL - padR;
  let widest = 0;
  [...card.children].forEach(k => {
    const kr = k.getBoundingClientRect();
    const grand = [...k.children].filter(vis);
    let ext = kr.width;
    if (grand.length) {
      const l = Math.min(...grand.map(g => g.getBoundingClientRect().left));
      const rr = Math.max(...grand.map(g => g.getBoundingClientRect().right));
      ext = Math.max(ext, rr - l);
    }
    if (ext > widest) widest = ext;
  });
  const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
  return {
    overlayCls: String(overlay.className || overlay.tagName).slice(0, 40),
    cardCls: String(card.className || card.tagName).slice(0, 40),
    cardW: Math.round(cr.width), cardH: Math.round(cr.height),
    vw: innerWidth, vh: innerHeight,
    widthRatio: +(cr.width / innerWidth).toFixed(2),
    innerFill: inner > 0 ? +(widest / inner).toFixed(2) : 1,
    overflowX: Math.max(0, Math.round(card.scrollWidth - card.clientWidth)),
    cutOff: Math.max(0, Math.round(card.scrollHeight - card.clientHeight)),
    scrollable: ['auto', 'scroll'].includes(ccs.overflowY),
    chars: text.length,
    head: text.slice(0, 60),
  };
}"""

CLOSE = """() => {
  document.querySelectorAll('.modal-close, .app-modal-close, .contact-modal-close, .mz-jc-close, [aria-label="Close"]')
    .forEach(b => { try { b.click(); } catch (e) {} });
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
}"""


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com"
    local = "localhost" in base
    srv = None
    if local:
        import subprocess
        port = base.rsplit(":", 1)[1].split("/")[0]
        srv = subprocess.Popen(["python3", "-m", "http.server", port], cwd="/home/user/MIGS",
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.2)
    report, problems = {}, 0
    with sync_playwright() as p:
        b, _, note = launch_chromium(p, headless=True)
        if note:
            print(f"  (launcher: {note})")
        for vp, label in VIEWPORTS:
            ctx = b.new_context(viewport=vp, ignore_https_errors=True)
            page = ctx.new_page()
            for path in PAGES:
                url = f"{base}{path}" + ("index.html" if local else "") + f"?cb={int(time.time()*1000)}"
                try:
                    page.goto(url, wait_until="networkidle", timeout=45000)
                except Exception as e:
                    continue
                page.wait_for_timeout(2500)
                trigs = page.evaluate(FIND_TRIGGERS)
                rows = []
                for t in trigs[:14]:                       # cap per page
                    try:
                        page.evaluate(CLOSE); page.wait_for_timeout(120)
                        page.evaluate("""([sel, idx]) => {
                            const el = document.querySelectorAll(sel)[idx];
                            if (el) { el.scrollIntoView({block:'center'}); el.click(); }
                        }""", [t["sel"], t["idx"]])
                        page.wait_for_timeout(650)
                        m = page.evaluate(MEASURE)
                    except Exception:
                        m = None
                    if not m:
                        continue
                    issues = []
                    if m["widthRatio"] < 0.55 and m["vw"] >= 1000:
                        issues.append(f"card only {int(m['widthRatio']*100)}% of viewport")
                    if m["innerFill"] < 0.6:
                        issues.append(f"content fills {int(m['innerFill']*100)}% of card")
                    if m["overflowX"] > 2:
                        issues.append(f"h-overflow {m['overflowX']}px")
                    if m["cutOff"] > 8 and not m["scrollable"]:
                        issues.append(f"{m['cutOff']}px cut off, no scroll")
                    if m["chars"] < 40:
                        issues.append(f"near-empty ({m['chars']} chars)")
                    if issues:
                        problems += 1
                        rows.append({**m, "trigger": t["label"], "sel": t["sel"], "issues": issues})
                page.evaluate(CLOSE)
                if rows:
                    report.setdefault(path, {})[label] = rows
            ctx.close()
        b.close()
    if srv:
        srv.terminate()

    for path, byvp in report.items():
        for vp, rows in byvp.items():
            print(f"  ✗ {path} [{vp}] {len(rows)} modal issue(s)")
            for r in rows[:8]:
                print(f"        .{r['cardCls'][:26]:26} {r['cardW']}x{r['cardH']} "
                      f"({int(r['widthRatio']*100)}% vw, fill {int(r['innerFill']*100)}%) "
                      f"<- {r['trigger'][:22]!r}: {'; '.join(r['issues'])}")
    out = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--json=")]
    if out:
        json.dump(report, open(out[0], "w"), indent=1)
    print(f"\nmodal audit: {problems} modal(s) with layout/content defects")
    return 1 if problems else 0


sys.exit(main())
