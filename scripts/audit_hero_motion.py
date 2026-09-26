#!/usr/bin/env python3
"""The opening animation must RUN and COMPLETE — verified at every deploy.

Owner (2026-09-02, after the intro appeared frozen on his device): "the
opening page animation is stalling AGAIN - WHY CAN'T YOU PREVENT THIS
FROM BREAKING AFTER EVERY REVISION?" The hero fingerprint lock protects
the animation-critical CODE from accidental edits, but nothing verified
the RENDERED lifecycle — a halted script, a 404'd asset, a broken
handoff, or a stuck intro overlay all shipped invisibly. This gate
watches the animation actually happen, on desktop AND iPhone emulation.

Checks per form factor, against live DOM signals first, pixels second:
  1. HERO PRESENT + LOADED — .hero-video exists and its media decoded
     (naturalWidth/videoWidth > 0). Catches a 404'd or renamed asset.
  2. LIFECYCLE COMPLETES — within 16s the hero reaches its settled end
     state: IMG pipeline swaps src to the last-frame asset; VIDEO
     pipeline reaches its end (currentTime advances then stops at
     duration). Catches frozen handoff and halted scripts.
  3. MOTION HAPPENED — cumulative pixel difference between an early
     frame and the settled frame exceeds a floor (the drawing actually
     drew; a static frame from t=0 fails). Catches a dead animation
     that still has the right src.
  4. NO STUCK OVERLAY — any intro/loader overlay (.cinematic-intro)
     is gone or invisible by the deadline. Catches an endless spinner.

  python3 scripts/audit_hero_motion.py https://mountzara.com
  python3 scripts/audit_hero_motion.py http://127.0.0.1:8099
"""
import os, sys, time
from io import BytesIO

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from PIL import Image, ImageChops  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com").rstrip("/")
DEADLINE_S = 16

STATE_JS = """() => {
    const v = document.querySelector('.hero-video');
    const intro = document.querySelector('.cinematic-intro');
    const st = { present: !!v };
    if (v) {
        st.tag = v.tagName;
        st.src = (v.currentSrc || v.src || '');
        if (v.tagName === 'VIDEO') {
            st.decoded = v.videoWidth > 0;
            st.time = +v.currentTime.toFixed(2);
            st.dur = +(v.duration || 0).toFixed(2);
            st.ended = v.ended || (v.duration && v.currentTime >= v.duration - 0.05);
        } else {
            st.decoded = v.naturalWidth > 0;
            st.lastFrame = /last-frame/.test(st.src);
        }
    }
    st.overlayGone = !intro || getComputedStyle(intro).opacity === '0'
        || getComputedStyle(intro).display === 'none' || !intro.isConnected;
    return st;
}"""

def mean_diff(a_png, b_png):
    a = Image.open(BytesIO(a_png)).convert("RGB")
    b = Image.open(BytesIO(b_png)).convert("RGB")
    d = ImageChops.difference(a, b)
    px = list(d.getdata())
    return sum(sum(c) for c in px) / len(px)

def run_factor(browser, label, ctx_args, clip):
    problems = []
    ctx = browser.new_context(**ctx_args)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:160]))
    page.goto(f"{BASE}/?cb={int(time.time())}{label}", wait_until="domcontentloaded", timeout=60000)
    # Sample the "before" frame as soon as the hero element exists rather than
    # at a blind 1.8s. Under load the wall-clock wait could land AFTER the
    # animation had already settled, making early and late identical and
    # reading as "the drawing never drew" on a homepage that drew fine.
    for _ in range(24):
        try:
            if page.evaluate(STATE_JS).get("present"):
                break
        except Exception:
            pass
        page.wait_for_timeout(100)
    page.wait_for_timeout(400)
    early = page.screenshot(clip=clip)
    first_video_time = None
    settled = None
    deadline = time.time() + DEADLINE_S
    while time.time() < deadline:
        st = page.evaluate(STATE_JS)
        if st.get("tag") == "VIDEO" and first_video_time is None and st.get("time"):
            first_video_time = st["time"]
        done = (st.get("tag") == "IMG" and st.get("lastFrame") and st.get("decoded")) or \
               (st.get("tag") == "VIDEO" and st.get("ended") and st.get("decoded"))
        if done and st.get("overlayGone"):
            settled = st
            break
        page.wait_for_timeout(900)
    final_st = settled or page.evaluate(STATE_JS)
    late = page.screenshot(clip=clip)
    if not final_st.get("present"):
        problems.append("no .hero-video element rendered")
    elif not final_st.get("decoded"):
        problems.append(f"hero media never decoded (src …{final_st.get('src','')[-50:]})")
    if settled is None:
        problems.append(f"animation lifecycle did NOT complete within {DEADLINE_S}s "
                        f"(state: tag={final_st.get('tag')} src=…{final_st.get('src','')[-40:]} "
                        f"time={final_st.get('time')} overlayGone={final_st.get('overlayGone')})")
    if not final_st.get("overlayGone"):
        problems.append("intro overlay still visible at the deadline (stuck spinner)")
    motion = mean_diff(early, late)
    if motion < 0.8:
        problems.append(f"no visible motion between t≈2s and the settled frame (mean diff {motion:.2f}) — the drawing never drew")
    if errors:
        problems.append(f"page errors during the intro: {errors[:2]}")
    ctx.close()
    return problems, motion

def main():
    all_problems = []
    with sync_playwright() as p:
        browser, engine, note = launch_engine(p, "webkit")
        if note:
            print("NOTE:", note)
        for label, ctx_args, clip in (
            ("d", {"viewport": {"width": 1280, "height": 800}},
             {"x": 0, "y": 60, "width": 1280, "height": 640}),
            ("m", {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2,
                   "is_mobile": True, "has_touch": True,
                   "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                                 "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"},
             {"x": 0, "y": 80, "width": 390, "height": 560}),
        ):
            name = "desktop" if label == "d" else "iphone"
            probs, motion = run_factor(browser, label, ctx_args, clip)
            # Structural failures (missing element, never decoded, stuck
            # overlay, page errors) stand immediately. A motion-floor failure
            # is a sampled quantity and the one thing contention can fake, so
            # re-measure once on a fresh context before condemning a deploy.
            if probs and all("no visible motion" in pr for pr in probs):
                print(f"  … {name}: motion floor missed ({motion:.2f}) — re-measuring once")
                probs, motion = run_factor(browser, label + "r", ctx_args, clip)
            if probs:
                for pr in probs:
                    print(f"  ✗ {name}: {pr}")
                all_problems += [(name, pr) for pr in probs]
            else:
                print(f"  ✓ {name}: animation ran and settled (motion {motion:.1f})")
        browser.close()
    if all_problems:
        print(f"\n🛑 HERO-MOTION GATE FAILED — the opening animation is broken on "
              f"{len(set(n for n, _ in all_problems))} form factor(s).")
        return 1
    print("hero-motion gate: CLEAN — the opening animation runs and completes on desktop and iPhone")
    return 0

sys.exit(main())
