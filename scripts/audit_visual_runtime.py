# -*- coding: utf-8 -*-
"""
VISUAL / INTERACTIVE runtime gate — Playwright-driven, like audit_runtime_css.py.

Loads the LIVE site in a real headless browser and verifies that the things a
reader actually SEES are working at runtime — not just present in the source:

  • IMAGES        — every <img> is loaded (naturalWidth > 0), none broken.
  • AUTOPLAY VIDS — every video with `autoplay` (the .video-preview tiles) is
                    actually playing: not paused, currentTime advancing, ready.
  • HERO VIDEO    — the opening #heroVideo plays (not paused, time advancing,
                    readyState ≥ 2) and covers the screen edge-to-edge
                    (boundingRect width ≈ viewport width — "plays to scale, end
                    to end of screen").
  • KEN BURNS     — the .ken-burns element has the heroKenBurns* animation,
                    animationPlayState === 'running', and its transform ACTUALLY
                    CHANGES over a sampling interval (i.e. it's animating, not
                    stuck) — the "plays on time / to scale" check.
  • KEY ANIMATIONS— gradientShift / monogramFadeIn / fadeUp resolve (the opening
                    sequence completes: monogram + hero content reach opacity 1).

Runs on a machine WITH Playwright + Chromium (the deploy machine); the deploy
script skips it gracefully when Playwright isn't installed (same as
audit_runtime_css.py). Exit 0 = all pass, 2 = a visual/runtime failure.

Usage:
  python3 scripts/audit_visual_runtime.py            # homepage, desktop + mobile
  python3 scripts/audit_visual_runtime.py --url <u>
"""
from __future__ import annotations
import argparse, sys, time

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("⚠️  Playwright not installed — visual gate cannot run here. Install "
          "with `pip install playwright && playwright install chromium`, or run "
          "on the deploy machine. (Skipping is handled by deploy-prod.sh.)",
          file=sys.stderr)
    sys.exit(3)

BASE = "https://mountzara.com"

# (label, viewport) — check desktop and an iPhone-class viewport
VIEWPORTS = [("desktop", {"width": 1440, "height": 900}),
             ("mobile",  {"width": 430, "height": 932})]


def chk(name, ok, detail=""):
    return {"name": name, "pass": bool(ok), "detail": detail}


def audit(page, label) -> list[dict]:
    page.goto(f"{BASE}/?cb={int(time.time())}", wait_until="domcontentloaded", timeout=30000)
    # ORCHESTRATION-AWARE WAIT. The hero is deliberately sequenced: the page
    # loader shows ~6s, then startHeroSequence() hides it, calls #heroVideo.play()
    # (the 8s "drawing" animation), and JS adds .ken-burns. So we do NOT hardcode
    # a wait — we poll up to 14s for the hero sequence to actually begin
    # (#heroVideo.currentTime advancing), then give it a moment to settle.
    started = False
    try:
        page.wait_for_function(
            "() => { const v=document.querySelector('#heroVideo'); return v && v.currentTime > 0.05; }",
            timeout=14000)
        started = True
    except Exception:
        pass
    page.wait_for_timeout(2500)
    res = []
    res.append(chk(f"[{label}] hero sequence started on time (loader→video within 14s)", started,
                   "ok" if started else "hero video never started within 14s of load"))

    # 1) IMAGES loaded
    broken = page.evaluate("""() => [...document.images]
        .filter(i => i.offsetParent !== null && i.complete && i.naturalWidth === 0)
        .map(i => i.currentSrc || i.src).slice(0,8)""")
    res.append(chk(f"[{label}] all visible images loaded", not broken,
                   f"{len(broken)} broken: {broken}" if broken else "ok"))

    # 2) AUTOPLAY videos actually playing
    t0 = page.evaluate("""() => [...document.querySelectorAll('video[autoplay]')]
        .filter(v => v.offsetParent !== null)
        .map((v,i) => ({i, t: v.currentTime, paused: v.paused, ready: v.readyState}))""")
    page.wait_for_timeout(1200)
    t1 = page.evaluate("""() => [...document.querySelectorAll('video[autoplay]')]
        .filter(v => v.offsetParent !== null)
        .map((v,i) => ({i, t: v.currentTime, paused: v.paused, ready: v.readyState}))""")
    bad = []
    for a, b in zip(t0, t1):
        if a["paused"] or b["paused"] or b["ready"] < 2 or b["t"] <= a["t"]:
            bad.append(f"video#{a['i']}(paused={b['paused']},Δt={b['t']-a['t']:.2f},ready={b['ready']})")
    res.append(chk(f"[{label}] autoplay videos are playing", not bad and len(t1) > 0,
                   f"{len(bad)} not playing: {bad}" if bad else f"{len(t1)} playing"))

    # 3) HERO video plays + covers the screen edge-to-edge
    hero0 = page.evaluate("""() => { const v=document.querySelector('#heroVideo'); if(!v) return null;
        const r=v.getBoundingClientRect();
        return {paused:v.paused, t:v.currentTime, ready:v.readyState,
                w:r.width, vw:window.innerWidth, h:r.height}; }""")
    page.wait_for_timeout(1000)
    hero1 = page.evaluate("""() => { const v=document.querySelector('#heroVideo'); if(!v) return null;
        return {paused:v.paused, t:v.currentTime}; }""")
    if hero0 is None:
        res.append(chk(f"[{label}] hero video present", False, "#heroVideo not found"))
    else:
        playing = (not hero1["paused"]) and hero1["t"] > hero0["t"] and hero0["ready"] >= 2
        res.append(chk(f"[{label}] hero video playing", playing,
                       f"paused={hero1['paused']} Δt={hero1['t']-hero0['t']:.2f} ready={hero0['ready']}"))
        edge = hero0["w"] >= hero0["vw"] * 0.98
        res.append(chk(f"[{label}] hero video covers screen edge-to-edge", edge,
                       f"video width {hero0['w']:.0f}px vs viewport {hero0['vw']}px"))

    # 4) KEN BURNS animating (transform changes) + applied
    kb0 = page.evaluate("""() => { const e=document.querySelector('.ken-burns'); if(!e) return null;
        const cs=getComputedStyle(e);
        return {name:cs.animationName, state:cs.animationPlayState, transform:cs.transform}; }""")
    page.wait_for_timeout(1500)
    kb1 = page.evaluate("""() => { const e=document.querySelector('.ken-burns'); if(!e) return null;
        return {transform:getComputedStyle(e).transform}; }""")
    if kb0 is None:
        res.append(chk(f"[{label}] ken-burns element present", False, ".ken-burns not found"))
    else:
        applied = "kenburns" in kb0["name"].lower() and kb0["state"] == "running"
        res.append(chk(f"[{label}] ken-burns animation applied + running", applied,
                       f"name={kb0['name']} state={kb0['state']}"))
        res.append(chk(f"[{label}] ken-burns is actually animating (transform changes)",
                       kb0["transform"] != kb1["transform"],
                       "transform static (stuck)" if kb0["transform"] == kb1["transform"] else "moving"))

    # 5) opening sequence resolves — monogram + hero content reach opacity 1
    seq = page.evaluate("""() => {
        const out={};
        for (const sel of ['.site-monogram','.hero-content','[class*="monogram"]','[class*="fade-up"]']) {
            const el=document.querySelector(sel);
            if (el) out[sel]=parseFloat(getComputedStyle(el).opacity);
        }
        return out; }""")
    faded_in = all(v >= 0.95 for v in seq.values()) if seq else False
    res.append(chk(f"[{label}] opening fade-in animations completed", faded_in,
                   str(seq) if seq else "no monogram/fade elements found"))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE)
    a = ap.parse_args()
    all_res = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, vp in VIEWPORTS:
            page = browser.new_page(viewport=vp)
            try:
                all_res += audit(page, label)
            except Exception as e:
                all_res.append(chk(f"[{label}] audit ran", False, f"exception: {e}"))
            page.close()
        browser.close()
    fails = [r for r in all_res if not r["pass"]]
    for r in all_res:
        print(f"   {'✓' if r['pass'] else '✗'}  {r['name']}  · {r['detail']}")
    print(f"\n[VISUAL] {len(all_res)-len(fails)}/{len(all_res)} checks passed")
    if fails:
        print("🛑 visual/interactive failures — the page LOOKS broken at runtime, not just in source.")
    return 2 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
