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

# Test on the engines that REAL users run. iPhone uses Safari/WebKit — NOT
# Chromium — and WebKit has different video-autoplay and animation behavior, so
# a Chromium-with-a-small-viewport test is not a faithful iPhone test. We run
# desktop on Chromium and the iPhone profile on WebKit with a real device
# descriptor (UA, DPR, touch, is_mobile).
#   (label, engine, device-name-or-None, viewport-or-None, extra-context-opts)
PROFILES = [
    ("desktop · chromium",         "chromium", None, {"width": 1440, "height": 900}, {}),
    ("iPhone · webkit",            "webkit",   "iPhone 14 Pro Max", None, {}),
    # Reduce Motion is a common iOS accessibility setting; the hero must still
    # present sensibly (not blank) with it on.
    ("iPhone reduce-motion · webkit", "webkit", "iPhone 14 Pro Max", None,
     {"reduced_motion": "reduce"}),
]


def chk(name, ok, detail=""):
    return {"name": name, "pass": bool(ok), "detail": detail}


def audit(page, label, reduce_motion=False) -> list[dict]:
    page.goto(f"{BASE}/?cb={int(time.time())}", wait_until="domcontentloaded", timeout=30000)
    # ORCHESTRATION-AWARE WAIT. The hero is deliberately sequenced: the page
    # loader shows ~6s, then startHeroSequence() hides it, calls #heroVideo.play()
    # (the 8s "drawing" animation), and JS adds .ken-burns. So we do NOT hardcode
    # a wait — we poll up to 14s for the hero sequence to actually begin
    # (#heroVideo.currentTime advancing), then give it a moment to settle.
    # 2026-08-10 — "started" must match the CURRENT architecture: on touch
    # devices (and whenever autoplay is refused) the bootstrap replaces the
    # hero <video> with the animated-WebP <img>, which has no currentTime.
    # Started = video visibly advancing OR the animated image attached with
    # real pixel data. currentTime-only made every real-WebKit iPhone run
    # fail by definition.
    started = False
    try:
        page.wait_for_function(
            """() => { const v = document.querySelector('#heroVideo');
                 if (!v) return false;
                 if (v.tagName === 'VIDEO') return v.currentTime > 0.05;
                 if (v.tagName === 'CANVAS') return v.dataset.mzArt === '1';
                 return v.complete && v.naturalWidth > 0; }""",
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
        .filter(i => (i.currentSrc || i.src))   // src-less = intentional slot (e.g. #heroImgSlot), not broken
        .filter(i => i.offsetParent !== null && i.complete && i.naturalWidth === 0)
        .map(i => i.currentSrc || i.src).slice(0,8)""")
    res.append(chk(f"[{label}] all visible images loaded", not broken,
                   f"{len(broken)} broken: {broken}" if broken else "ok"))

    # 2a) iOS AUTOPLAY PREREQUISITE — iOS Safari only autoplays a video that is
    # muted AND playsinline. A video that's set to autoplay/JS-played but lacks
    # either will simply NOT play on iPhone (the failure that's invisible on
    # desktop). Checked on every autoplay video and the JS-played hero.
    badprereq = page.evaluate("""() => [...document.querySelectorAll('video')]
        .filter(v => (v.autoplay || v.id === 'heroVideo') &&
                     (!v.muted || !(v.hasAttribute('playsinline') || v.hasAttribute('webkit-playsinline'))))
        .map(v => `${v.id||v.className}(muted=${v.muted},inline=${v.hasAttribute('playsinline')})`)""")
    res.append(chk(f"[{label}] videos meet iOS autoplay prereqs (muted+playsinline)", not badprereq,
                   f"would NOT autoplay on iPhone: {badprereq}" if badprereq else "ok"))

    # 2) AUTOPLAY videos actually playing. POLL for up to ~8s for every autoplay
    # video to reach a playing state (not paused, ready, time advancing) — this
    # gives them a fair chance to start and avoids failing on a momentary mid-
    # load sample, while still catching a video that GENUINELY never autoplays
    # on this engine (the real iOS/WebKit autoplay-reliability failure).
    # 2026-08-10 — judge the reels AS A VIEWER MEETS THEM. They are
    # preload="none" and wake only near the viewport (measured perf: eager
    # loading cost 10 MB at page open), so sampling them 18 viewports
    # offscreen proves nothing. Scroll the first reel into view, give the
    # wake/refusal machinery time to act, then require MOTION: a playing
    # video OR the looping animated preview it swaps to when this engine
    # refuses (or cannot decode) video autoplay — that swap IS the shipped
    # behavior for the user's Safari, which refuses all video autoplay.
    # One reel at a time, centered in the viewport, exactly as a scrolling
    # viewer meets it: the wake machinery is viewport-driven and the preview
    # images are loading=lazy, so judging all four from one scroll position
    # reports designed-in idleness as failure.
    # confirm time is advancing (not frozen) with a short two-sample check.
    # `decodable` calibration (2026-07-22): Playwright's Chromium test build
    # ships WITHOUT proprietary codecs, so an mp4-only <video> reports
    # networkState=NO_SOURCE here while playing perfectly in every real
    # consumer browser (all of which ship H.264). A video whose sources this
    # ENGINE cannot decode is unjudgeable — report it as skipped, loudly,
    # instead of failing the audit. A decodable video that genuinely fails
    # to autoplay (paused / frozen / never buffers) still FAILS.
    if reduce_motion:
        # Reduce Motion: the site deliberately rests the reels on their
        # posters (home.js strips autoplay and pauses them) — autoplaying
        # surgical loops against an OS less-motion request is the defect,
        # not the pass state. Assert they are actually at rest.
        page.evaluate("""() => { const el = document.querySelector('.video-preview');
            if (el) el.scrollIntoView({block: 'center'}); }""")
        page.wait_for_timeout(1500)
        still = page.evaluate("""() => [...document.querySelectorAll('video.video-preview')]
            .filter(v => !v.paused).length""")
        res.append(chk(f"[{label}] reels rest under Reduce Motion", still == 0,
                       f"{still} reel(s) auto-playing despite prefers-reduced-motion"
                       if still else "all reels at rest on posters"))
        n_reels = 0                        # skip the motion-judging loop below
    else:
        n_reels = page.evaluate("() => document.querySelectorAll('.video-preview').length")
    # home.js OWNS the reel wake/swap machinery and loads on settle or first
    # user intent (2026-08-10c) — the scroll below triggers it. Judging reel
    # #0 before the script has evaluated judges the loader, not the page.
    if n_reels:
        page.evaluate("() => window.scrollTo(0, Math.min(600, document.body.scrollHeight))")
        try:
            page.wait_for_function("() => !!window.__mzHomeLoaded", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(1200)
    bad, undecodable, judged = [], [], 0
    for ri in range(n_reels):
        page.evaluate("""(i) => { const el = document.querySelectorAll('.video-preview')[i];
            if (el) el.scrollIntoView({block: 'center'}); }""", ri)
        try:
            page.wait_for_function("""(i) => {
                const v = document.querySelectorAll('.video-preview')[i];
                if (!v) return true;
                return v.tagName === 'IMG' ? (v.complete && v.naturalWidth > 0)
                                           : (!v.paused && v.readyState >= 2);
            }""", arg=ri, timeout=5000)
        except Exception:
            pass
        a = page.evaluate("""(i) => { const v = document.querySelectorAll('.video-preview')[i];
            return v ? {tag: v.tagName, t: v.currentTime || 0} : null; }""", ri)
        page.wait_for_timeout(500)
        b = page.evaluate("""(i) => { const v = document.querySelectorAll('.video-preview')[i];
            if (!v) return null;
            return {tag: v.tagName, t: v.currentTime || 0, paused: !!v.paused,
                ready: v.readyState || 0,
                net: v.networkState === undefined ? -1 : v.networkState,
                src: (v.currentSrc || v.src || '').split('/').pop().split('?')[0],
                preview: v.tagName === 'IMG' && /-preview\\.webp/.test(v.src || '')
                         && v.complete && v.naturalWidth > 0,
                h264: v.canPlayType ? v.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '' : false}; }""", ri)
        if not a or not b:
            continue
        if b.get("preview"):
            judged += 1                     # animated preview attached = motion
            continue
        if b["tag"] == "IMG":
            bad.append(f"video#{ri}(img-not-loaded:{b['src']})")
            continue
        frozen = abs(b["t"] - a["t"]) < 0.02   # loop-wrap (t1<t0) is fine; frozen is not
        if frozen and not b["paused"] and b["ready"] >= 2:
            # a playing 6s loop can wrap between samples and land within
            # 20ms of where it started (measured: Δt=-0.02 false-failed the
            # gate) — confirm stillness with a second window before failing
            page.wait_for_timeout(700)
            t2 = page.evaluate("""(i) => { const v = document.querySelectorAll('.video-preview')[i];
                return v && v.tagName === 'VIDEO' ? (v.currentTime || 0) : null; }""", ri)
            frozen = t2 is not None and abs(t2 - b["t"]) < 0.02
        if frozen:
            # The page's standing stall guard converts a frozen reel to its
            # animated preview within ~2 x 3s ticks. That self-heal IS the
            # shipped behavior — give it time to act before judging.
            try:
                page.wait_for_function("""(i) => {
                    const v = document.querySelectorAll('.video-preview')[i];
                    if (!v) return true;
                    if (v.tagName === 'IMG') return v.complete && v.naturalWidth > 0;
                    return !v.paused && v.currentTime > 0.05 && v.dataset.mzStallN === '0';
                }""", arg=ri, timeout=10000)
            except Exception:
                pass
            h = page.evaluate("""(i) => { const v = document.querySelectorAll('.video-preview')[i];
                if (!v) return null;
                // IMG attached = the stall guard converted it: that IS the
                // heal. It is centered in the viewport, so it will paint as
                // soon as its bytes land (the proxied fetch can outlast this
                // probe's window — completion is not the test here).
                if (v.tagName === 'IMG')
                    return {healed: /-preview\\.webp/.test(v.src || ''), tag: 'IMG'};
                return {healed: false, t: v.currentTime || 0, tag: 'VIDEO'}; }""", ri)
            if h and (h.get("healed") or (h.get("tag") == "VIDEO" and abs(h.get("t", 0) - b["t"]) > 0.05)):
                judged += 1
                continue
        # ready<2 alone is NOT failure while time advances — a looping video
        # reports HAVE_METADATA for an instant at the wrap (observed:
        # Δt=-0.55, paused=False flagged as not-playing). Paused or frozen is.
        if b["paused"] or frozen:
            # networkState 3 = NETWORK_NO_SOURCE: the ENGINE rejected every
            # source (codec unsupported in this test build) — distinct from a
            # slow network (state 2 = NETWORK_LOADING), which still FAILS.
            if b["ready"] == 0 and b["net"] == 3 and not b["h264"]:
                undecodable.append(b["src"] or f"video#{ri}")
            else:
                bad.append(f"video#{ri}(paused={b['paused']},Δt={b['t']-a['t']:.2f})")
        else:
            judged += 1
    if undecodable:
        print(f"  [{label}] ⏭  {len(undecodable)} video(s) NOT judgeable — this engine lacks their "
              f"codec (no H.264 in Playwright Chromium): {undecodable}")
    if not reduce_motion:
        res.append(chk(f"[{label}] autoplay videos are playing", not bad and judged >= 0,
                       f"{len(bad)} not playing after 8s: {bad}" if bad
                       else f"{judged} playing" + (f" ({len(undecodable)} codec-skipped)" if undecodable else "")))
    # back to the top — the hero checks below measure the hero as presented
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(400)

    # 3) HERO video plays + covers the screen edge-to-edge. Under Reduce Motion
    # the hero legitimately pauses at the end of the drawing (handled in 4); for
    # normal motion, poll for it to be playing (fair window), then confirm it's
    # not frozen.
    if not reduce_motion:
        try:
            page.wait_for_function("""() => { const v=document.querySelector('#heroVideo');
                return v && !v.paused && v.readyState>=2; }""", timeout=8000)
        except Exception:
            pass
    hero0 = page.evaluate("""() => { const v=document.querySelector('#heroVideo'); if(!v) return null;
        const r=v.getBoundingClientRect();
        // 2026-07-22 perf settle-swap: ~1.4s after the drawing completes the
        // <video> is replaced by the static last-frame <img> (same id/classes).
        // That IS the correct settled end-state — report it as such instead of
        // sampling video-only fields off an image (None-crash).
        if (v.tagName !== 'VIDEO')
            return {poster:true, kb:v.classList.contains('ken-burns'),
                    drawing:(v.tagName === 'CANVAS' && v.dataset.mzArt === '1') || /hero-animation|hero-last-frame|^data:image\\/webp/.test(v.currentSrc || v.src || ''),
                    nw:(v.tagName === 'CANVAS' ? v.width : v.naturalWidth),
                    w:r.width, vw:window.innerWidth, h:r.height, vh:window.innerHeight};
        return {paused:v.paused, t:v.currentTime, ready:v.readyState, dur:v.duration,
                kb:v.classList.contains('ken-burns'), ended:v.ended,
                w:r.width, vw:window.innerWidth, h:r.height, vh:window.innerHeight}; }""")
    page.wait_for_timeout(700)
    hero1 = page.evaluate("""() => { const v=document.querySelector('#heroVideo'); if(!v) return null;
        // the settle-swap (ended +1.4s) can land between the two samples —
        // a poster here means the video played, ended, and settled: correct.
        if (v.tagName !== 'VIDEO')
            return {poster:true, paused:true, t:null, dur:null,
                    kb:v.classList.contains('ken-burns'), ended:true};
        return {paused:v.paused, t:v.currentTime, dur:v.duration,
                kb:v.classList.contains('ken-burns'), ended:v.ended}; }""")
    if hero1 and hero1.get("poster") and hero0 and not hero0.get("poster"):
        hero1 = {**hero1, "t": hero0["t"], "dur": hero0.get("dur")}
    if hero0 is None:
        res.append(chk(f"[{label}] hero video present", False, "#heroVideo not found"))
    elif hero0.get("poster"):
        # IMG hero = either the animated drawing itself (mid-play, src is the
        # hero-animation WebP with real pixels — that IS "playing") or the
        # settled last-frame poster with Ken Burns carried over. Demanding kb
        # on the mid-draw image false-failed any profile that reached this
        # sample inside the ~8s drawing window.
        ok_img = bool(hero0.get("kb")) or (hero0.get("drawing") and (hero0.get("nw") or 0) > 0)
        res.append(chk(f"[{label}] hero video playing", ok_img,
                       f"settled poster (img) kb={hero0.get('kb')}" if not hero0.get("drawing")
                       else f"drawing animation attached (nw={hero0.get('nw')}) kb={hero0.get('kb')}"))
        edge = hero0["w"] >= hero0["vw"] * 0.98
        res.append(chk(f"[{label}] hero video covers screen edge-to-edge", edge,
                       f"poster width {hero0['w']:.0f}px vs viewport {hero0['vw']}px"))
        covh = hero0["h"] >= hero0["vh"] * 0.98
        res.append(chk(f"[{label}] hero video covers screen top-to-bottom", covh,
                       f"poster height {hero0['h']:.0f}px vs viewport {hero0['vh']}px"))
    elif not reduce_motion:
        moved = abs(hero1["t"] - hero0["t"]) >= 0.02
        advancing = (not hero1["paused"]) and moved and hero0["ready"] >= 2
        # The hero is DESIGNED to pause on its final frame once the ~8s drawing
        # completes, so Ken Burns animates a settled frame. On a fast render the
        # animation can finish inside this sample window — a hero that PLAYED and
        # then settled on/near its last frame (ended, near-duration, or with the
        # .ken-burns class applied) is correct, not frozen. Only a hero stuck
        # paused near the START with no Ken Burns is the real "frozen box" defect.
        dur = hero1.get("dur") or 0
        settled = hero1["paused"] and (hero1.get("ended") or hero1.get("kb")
                  or (dur and hero1["t"] >= dur - 0.5))
        playing = advancing or settled
        res.append(chk(f"[{label}] hero video playing", playing,
                       f"paused={hero1['paused']} Δt={hero1['t']-hero0['t']:.2f} "
                       f"ready={hero0['ready']} t={hero1['t']:.1f}/{dur:.1f} "
                       f"{'settled-on-final-frame' if settled and not advancing else 'advancing' if advancing else 'STUCK'}"))
        edge = hero0["w"] >= hero0["vw"] * 0.98
        res.append(chk(f"[{label}] hero video covers screen edge-to-edge", edge,
                       f"video width {hero0['w']:.0f}px vs viewport {hero0['vw']}px"))
        # The drawing must ALSO fill the screen top-to-bottom — a 16:9 source
        # sized width:100%/height:auto letterboxes into a ~33%-height band on a
        # tall phone (user: "opening animation … should fit the entire screen").
        # Require the video box to cover the viewport height too (object-fit:
        # cover then trims the landscape extremities rather than compressing).
        covh = hero0["h"] >= hero0["vh"] * 0.98
        res.append(chk(f"[{label}] hero video covers screen top-to-bottom", covh,
                       f"video height {hero0['h']:.0f}px vs viewport {hero0['vh']}px"))

    # 4) KEN BURNS animating (transform changes) + applied. CALIBRATED: the
    # .ken-burns class is added to #heroVideo only AFTER the ~8s drawing
    # animation, so we POLL for it (up to 14s) rather than check immediately.
    try:
        page.wait_for_selector(".ken-burns", timeout=14000, state="attached")
    except Exception:
        pass
    # 4b) HERO SETTLES — plays ONCE then freezes on the final frame. The
    # "advancing" check in (3) cannot tell a healthy play from an endless
    # replay loop: the 2026-07-22 regression (retryHeroPlay re-entered via the
    # 'canplay' fired by the ended-handler's own seek) wrapped the clip back
    # to 0 forever and still passed this audit. Once .ken-burns is attached
    # (i.e. the drawing finished), the video must be PAUSED at/near its
    # duration with the heroEnded flag — and stay there across a 1.5s window.
    if not reduce_motion:
        settle0 = page.evaluate("""() => { const v=document.querySelector('#heroVideo');
            if(!v || v.tagName!=='VIDEO' || !v.classList.contains('ken-burns')) return null;
            return {t:v.currentTime, dur:v.duration||0, paused:v.paused, flag:v.dataset.heroEnded==='1'}; }""")
        if settle0:
            page.wait_for_timeout(1500)
            settle1 = page.evaluate("""() => { const v=document.querySelector('#heroVideo');
                if (!v) return null;
                // poster swap (ended +1.4s) inside this window = settled, not
                // wrapped — sampling currentTime off the <img> crashed here
                if (v.tagName !== 'VIDEO') return {poster:true, t:-1, paused:true};
                return {t:v.currentTime, paused:v.paused}; }""")
            wrapped = settle1 and not settle1.get("poster") and (
                settle1["t"] < settle0["t"] - 0.5 or not settle1["paused"])
            near_end = settle0["dur"] and settle0["t"] >= settle0["dur"] - 0.6
            res.append(chk(f"[{label}] hero settles on final frame (no replay loop)",
                           bool(settle0["paused"] and settle0["flag"] and near_end and not wrapped),
                           f"t={settle0['t']:.1f}/{settle0['dur']:.1f} paused={settle0['paused']} "
                           f"flag={settle0['flag']} then t={settle1['t']:.1f} paused={settle1['paused']}"
                           if settle1 else "hero vanished mid-check"))

    kb0 = page.evaluate("""() => { const e=document.querySelector('.ken-burns'); if(!e) return null;
        const cs=getComputedStyle(e);
        return {name:cs.animationName, state:cs.animationPlayState, transform:cs.transform}; }""")
    page.wait_for_timeout(1500)
    kb1 = page.evaluate("""() => { const e=document.querySelector('.ken-burns'); if(!e) return null;
        return {transform:getComputedStyle(e).transform}; }""")
    if reduce_motion:
        # Under Reduce Motion, the Ken-Burns zoom is intentionally suppressed —
        # so we DON'T require motion; we require the hero to still PRESENT (the
        # drawing completes and stays visible, not blank).
        vis = page.evaluate("""() => { const v=document.querySelector('#heroVideo'); if(!v) return null;
            const cs=getComputedStyle(v); const r=v.getBoundingClientRect();
            return {opacity:+cs.opacity, display:cs.display, w:r.width, vw:window.innerWidth}; }""")
        ok = vis and vis["display"] != "none" and vis["opacity"] >= 0.95 and vis["w"] >= vis["vw"]*0.98
        res.append(chk(f"[{label}] hero presents under Reduce Motion (graceful deg- not blank)", bool(ok),
                       str(vis)))
    elif kb0 is None:
        res.append(chk(f"[{label}] ken-burns animation present", False,
                       ".ken-burns never applied within 14s (drawing-animation may have stalled)"))
    else:
        # heroCanvasZoom is the canvas hero's settle zoom (2026-08-10f) —
        # same role as the KenBurns keyframes on the img/video hero
        applied = (("kenburns" in kb0["name"].lower() or "canvaszoom" in kb0["name"].lower())
                   and kb0["state"] == "running")
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

    # 6) APPLE 'APPEAR' REVEAL COMPLETENESS — fast-fling the page and assert no
    # reveal-eligible element is left stuck invisible. IntersectionObserver can
    # skip elements scrolled past between sample frames on a fast scroll (user
    # on iPhone: "only some show, some don't"); the page's safety net must still
    # reveal them. We deliberately fling in big jumps with tiny pauses — the
    # adversarial case the slow auto-scroll would mask.
    try:
        sh = page.evaluate("document.documentElement.scrollHeight")
        vh2 = page.evaluate("window.innerHeight") or 700
        y = 0
        while y < sh:
            page.evaluate(f"window.scrollTo(0,{y})")
            page.wait_for_timeout(70)
            y += int(vh2 * 2.5)
            sh = page.evaluate("document.documentElement.scrollHeight")
        # Land at the very bottom (fires the page's atBottom safety sweep) and
        # settle GENEROUSLY: the reveal transition is 900ms + up to ~480ms
        # stagger, so a shorter wait would catch in-flight fades and false-fail.
        # We do NOT scroll back to top — at the bottom every element has been
        # scrolled past, so a still-INVISIBLE one (opacity<0.5) is genuinely
        # stuck, not mid-transition. (Verified: stuck count 67→1→0 across the
        # settle window; permanently-stuck would stay >0.)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        # 2026-08-10 — home.js (which owns the reveal safety nets) now loads
        # on first scroll rather than at parse, so the fling above may START
        # its fetch+eval. 2600ms sometimes sampled mid-init (award tiles WITH
        # .in mid-fade). Wait for the script, then the settle window.
        try:
            page.wait_for_function("() => !!window.__mzHomeLoaded", timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(4000)
        stuck = page.evaluate(r"""() => {
            const sels=['[data-reveal]','.word-reveal','.evidence-card','.surgical-card','.reveal'];
            const set=new Set(); sels.forEach(s=>document.querySelectorAll(s).forEach(e=>set.add(e)));
            let n=0, ex='';
            set.forEach(el=>{ const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
                if(r.width<2||r.height<2) return;
                // The hero title has an INTENTIONAL scroll-parallax fade — its
                // inline opacity is driven to 0 as the user scrolls past it, so
                // at the bottom of the page opacity 0 is CORRECT, not stuck.
                // Judge it by whether it was REVEALED (.in class), which still
                // catches a genuine never-revealed-at-load bug, without
                // false-failing on the deliberate scroll fade.
                if(el.classList.contains('hero-title')){
                    if(!el.classList.contains('in')){ n++; if(!ex) ex='hero-title (never revealed)'; }
                    return;
                }
                // <0.5 = clearly not revealed (a mid-transition fade is >0.5 by now)
                if(parseFloat(cs.opacity)<0.5 || cs.visibility==='hidden'){
                    n++; if(!ex) ex=(''+(el.className.baseVal!==undefined?el.className.baseVal:el.className)).slice(0,40);
                }});
            return {n, ex}; }""")
        res.append(chk(f"[{label}] Apple reveal effect — every element appears after a fast scroll",
                       stuck["n"] == 0,
                       "all reveal elements visible" if stuck["n"] == 0
                       else f"{stuck['n']} stuck invisible (e.g. <{stuck['ex']}>)"))
    except Exception as e:
        res.append(chk(f"[{label}] Apple reveal effect", False, f"probe error: {str(e)[:80]}"))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE)
    a = ap.parse_args()
    all_res = []
    with sync_playwright() as p:
        from _lib_pw_launch import launch_engine
        for label, engine, device, vp, extra in PROFILES:
            try:
                browser, engine_used, note = launch_engine(p, engine)
                if note:
                    print(f"  [{label}] launcher: {note}")
            except Exception as e:
                all_res.append(chk(f"[{label}] engine available", False,
                                   f"{engine} could not launch: {str(e)[:80]}"))
                continue
            # ignore_https_errors: harmless for our own site on the deploy
            # machine; required where the network does TLS interception.
            opts = {"ignore_https_errors": True}
            opts.update(p.devices[device] if device else {"viewport": vp})
            opts.update(extra)
            ctx = browser.new_context(**opts)
            page = ctx.new_page()
            try:
                all_res += audit(page, label, reduce_motion=extra.get("reduced_motion") == "reduce")
            except Exception as e:
                all_res.append(chk(f"[{label}] audit ran", False, f"exception: {e}"))
            ctx.close()
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
