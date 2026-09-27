#!/usr/bin/env python3
"""Capture production mountzara.com at iPhone viewports.

Usage: python3 scripts/_capture_mobile.py [outdir] [url]
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/mobile"
BASE = sys.argv[2] if len(sys.argv) > 2 else "https://mountzara.com"
os.makedirs(OUT, exist_ok=True)

DEVICES = [
    ("iphone13", 390, 844),
    ("iphone14pm", 430, 932),
]
PAGES = [
    ("home", "/"),
    ("about", "/about/"),
    ("evidence", "/evidence/"),
]

with sync_playwright() as p:
    browser, engine, note = launch_engine(p, "webkit")
    if note:
        print("NOTE:", note)
    print("engine:", engine)
    for dname, w, h in DEVICES:
        ctx = browser.new_context(
            viewport={"width": w, "height": h},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        )
        page = ctx.new_page()
        for pname, path in PAGES:
            url = BASE.rstrip("/") + path + ("?cb=%d" % int(time.time()))
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                print(f"FAIL {dname}/{pname}: {e}")
                continue
            page.wait_for_timeout(4500)
            # freeze videos so screenshots are stable
            page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
            page.wait_for_timeout(300)
            page.screenshot(path=f"{OUT}/{dname}-{pname}-top.png")
            # full page
            try:
                page.screenshot(path=f"{OUT}/{dname}-{pname}-full.png", full_page=True)
            except Exception as e:
                print(f"  full-page failed {dname}/{pname}: {e}")
            # scroll captures
            hgt = page.evaluate("document.body.scrollHeight")
            print(f"{dname}/{pname}: scrollHeight={hgt}")
            for i, frac in enumerate([0.25, 0.5, 0.75, 0.95]):
                page.evaluate(f"window.scrollTo(0, {hgt}*{frac})")
                page.wait_for_timeout(700)
                page.screenshot(path=f"{OUT}/{dname}-{pname}-s{i}.png")
            # horizontal overflow check
            ov = page.evaluate("""() => {
                const de=document.documentElement;
                const bad=[];
                document.querySelectorAll('*').forEach(el=>{
                    const r=el.getBoundingClientRect();
                    if(r.width>0 && (r.right > de.clientWidth+2 || r.left < -2)){
                        bad.push({tag:el.tagName, cls:(el.className&&el.className.toString?el.className.toString():'').slice(0,80), left:Math.round(r.left), right:Math.round(r.right)});
                    }
                });
                return {clientWidth:de.clientWidth, scrollWidth:de.scrollWidth, overflow:bad.slice(0,25)};
            }""")
            print("  overflow:", ov["clientWidth"], ov["scrollWidth"])
            for b in ov["overflow"]:
                print("   ", b)
        # nav panel open on home
        page.goto(BASE.rstrip("/") + "/?cb=%d" % int(time.time()), wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(3500)
        try:
            page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause()}catch(e){}})")
            btn = page.query_selector(".nav-toggle, .hamburger, [aria-label*='menu' i], button[class*='burger']")
            if btn:
                btn.click()
                page.wait_for_timeout(900)
                page.screenshot(path=f"{OUT}/{dname}-navopen.png")
                print(f"{dname}: nav panel captured")
            else:
                print(f"{dname}: NO NAV TOGGLE FOUND")
        except Exception as e:
            print(f"{dname}: nav open failed {e}")
        ctx.close()
    browser.close()
print("done ->", OUT)
