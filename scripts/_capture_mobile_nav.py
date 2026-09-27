#!/usr/bin/env python3
"""Capture the mobile nav panel + hero at iPhone size from any base URL."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8099"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/navfix"
TAG = sys.argv[3] if len(sys.argv) > 3 else "local"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser, engine, note = launch_engine(p, "webkit")
    if note:
        print("NOTE:", note)
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=2,
        is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    )
    page = ctx.new_page()
    page.goto(BASE.rstrip("/") + "/?cb=%d" % int(time.time()), wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(11000)   # let the drawing settle onto the last frame
    page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/{TAG}-hero.png")

    # nav panel
    page.click(".mobile-toggle")
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/{TAG}-navopen.png")

    # measured facts, not eyeballs
    info = page.evaluate("""() => {
        const nav=document.querySelector('nav.main-nav');
        const panel=document.getElementById('navLinks');
        const cs=getComputedStyle(panel);
        const nr=nav.getBoundingClientRect(), pr=panel.getBoundingClientRect();
        const a=panel.querySelector('a');
        const acs=a?getComputedStyle(a):null;
        const cta=panel.querySelector('.nav-cta');
        const ctar=cta?cta.getBoundingClientRect():null;
        // every link's tap height
        const short=[...panel.querySelectorAll('a')].map(x=>({t:x.textContent.trim(),h:Math.round(x.getBoundingClientRect().height)})).filter(x=>x.h<44);
        return {
            navBottom: Math.round(nr.bottom),
            panelTop: Math.round(pr.top),
            panelLeft: Math.round(pr.left), panelRight: Math.round(pr.right),
            panelBg: cs.backgroundColor, panelPos: cs.position,
            linkColor: acs?acs.color:null,
            ctaBox: ctar?{l:Math.round(ctar.left),r:Math.round(ctar.right),h:Math.round(ctar.height)}:null,
            shortTaps: short,
            navBg: getComputedStyle(nav).backgroundColor,
        };
    }""")
    for k, v in info.items():
        print(f"  {k}: {v}")

    # tapping a link must close the panel
    page.click("#navLinks a[href='#about']")
    page.wait_for_timeout(500)
    still_open = page.evaluate("document.getElementById('navLinks').classList.contains('open')")
    print("  panel still open after tapping a link:", still_open)
    ctx.close()
    browser.close()
print("->", OUT)
