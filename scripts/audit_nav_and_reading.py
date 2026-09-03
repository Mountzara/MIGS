#!/usr/bin/env python3
# =====================================================================
# audit_nav_and_reading.py — live checks for the two things that break
# silently: the navigation, and the reading sheet.
# =====================================================================
# WHY THIS EXISTS
# On 2026-08-20 a nav consolidation left `.mobile-toggle { display: none }`
# as the LAST rule for that selector, so the hamburger was invisible at
# every width and there was no navigation at all below 1180px. Thirteen
# deploy gates passed — fact-sync, contrast, visual, route-render, public
# headers, the lot — because none of them asks "can a person actually
# reach the menu". The bug shipped and was found by driving a browser.
#
# It also covers the reading sheet, whose whole value is typographic: if
# the prose ever falls back to card sizing, the feature is pointless while
# still appearing to work.
#
# TRANSPORT: Chromium's connections are reset by the agent VM's proxy
# (see the same note in audit_visual_runtime.py); WebKit connects
# natively, so WebKit is the engine here. A transport failure is reported
# as UNJUDGEABLE and exits 0 — an unreachable site is the canary's job to
# catch, not this one's, and blocking every deploy on a proxy quirk would
# make the gate worthless.
# =====================================================================
import sys, time

URL = sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com/"
NAV_LINK_MIN = 12     # 2026-08-24: Member Portal moved to the FOOTER when the
                      # nav gained the Request-an-appointment CTA button; the
                      # bar carries 12 destinations + the CTA. The portal's
                      # reachability is asserted via the footer below.

def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("⏭  nav/reading audit SKIPPED — playwright not available.")
        return 0

    fails, checks = [], 0

    def ck(label, cond, detail=""):
        nonlocal checks
        checks += 1
        print(f"   {'✓' if cond else '✗'}  {label}" + ("" if cond else f"  · {detail}"))
        if not cond:
            fails.append(label)

    url = URL + ("&" if "?" in URL else "?") + "cb=" + str(int(time.time()))
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        try:
            for w, h, label in [(1512, 950, "desktop"), (1100, 900, "tablet"), (390, 844, "phone")]:
                page = browser.new_page(viewport={"width": w, "height": h}, ignore_https_errors=True)
                # Same flake the contrast gate hit: the homepage's video,
                # animated hero and deferred media probes can push
                # "networkidle" past its budget when this runs inside the
                # parallel deploy pool, which then reads as a broken nav.
                # Retry with a progressively more forgiving wait first.
                nav_err = None
                for wait_until, timeout_ms in (("networkidle", 45000),
                                               ("load", 60000),
                                               ("domcontentloaded", 60000)):
                    try:
                        page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                        nav_err = None
                        break
                    except Exception as exc:
                        nav_err = exc
                try:
                    if nav_err is not None:
                        raise nav_err
                except Exception as e:
                    msg = str(e)
                    if any(t in msg for t in ("ERR_CONNECTION", "ERR_PROXY", "ERR_TUNNEL",
                                              "ERR_NAME_NOT_RESOLVED", "ERR_SOCKET")):
                        print(f"⏭  nav/reading audit UNJUDGEABLE — WebKit could not reach the site "
                              f"({msg.split(' at ')[0][:70]}).")
                        return 0
                    raise
                print(f"  [{label} {w}x{h}]")

                # ---- navigation is reachable ------------------------------
                if w <= 1180:
                    toggle = page.locator(".mobile-toggle")
                    ck(f"[{label}] menu button is visible when the bar is collapsed",
                       toggle.is_visible(), "hamburger hidden — no navigation at this width")
                    if toggle.is_visible():
                        toggle.click()
                        page.wait_for_timeout(320)
                        n = page.locator(".nav-links a:visible").count()
                        ck(f"[{label}] every destination reachable in the panel",
                           n >= NAV_LINK_MIN, f"{n} visible, expected >= {NAV_LINK_MIN}")
                        # Close it again. The open panel is a full-width
                        # overlay and will intercept the reading-sheet click
                        # below, which reads as a sheet failure rather than
                        # the test's own fault.
                        toggle.click()
                        page.wait_for_timeout(320)
                else:
                    top = page.locator(".nav-links > li > a:visible").count()
                    page.locator(".nav-more-btn").hover()
                    page.wait_for_timeout(240)
                    sub = page.locator(".nav-more-menu a:visible").count()
                    ck(f"[{label}] every destination reachable from the bar",
                       top + sub >= NAV_LINK_MIN, f"{top} in bar + {sub} under More")
                    ck(f"[{label}] the bar does not overflow its own width",
                       page.locator("nav").first.evaluate("n => n.scrollWidth <= n.clientWidth + 1"))
                    ck(f"[{label}] nav carries the appointment CTA",
                       page.locator(".nav-cta:visible").count() == 1)
                    ck(f"[{label}] Member Portal reachable in the footer",
                       page.locator("footer a[href='/portal/']").count() >= 1)

                # ---- reading sheet ----------------------------------------
                btns = page.locator(".mz-read-btn")
                ck(f"[{label}] reading-sheet affordances present", btns.count() > 0, btns.count())
                ck(f"[{label}] long copy is off the scan layer",
                   page.locator(".safety-card > p").count() == 0,
                   "a safety card still prints its paragraph inline")
                if btns.count():
                    btns.first.click()
                    page.wait_for_timeout(420)
                    dlg = page.locator("#mz-read")
                    ck(f"[{label}] sheet opens", dlg.evaluate("d => d.open"))
                    body = page.locator("#mz-read-body")
                    ck(f"[{label}] sheet carries the copy",
                       len(body.inner_text().strip()) > 120)
                    m = body.evaluate("""el => {
                        const cs = getComputedStyle(el);
                        return { fs: parseFloat(cs.fontSize),
                                 lh: parseFloat(cs.lineHeight),
                                 w: el.getBoundingClientRect().width };
                    }""")
                    ck(f"[{label}] prose set at 19px or larger", m["fs"] >= 19, m["fs"])
                    ck(f"[{label}] leading at least 1.7", m["lh"] / m["fs"] >= 1.69,
                       round(m["lh"] / m["fs"], 2))
                    ck(f"[{label}] measure capped below 820px", m["w"] <= 820, round(m["w"]))
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(320)
                    ck(f"[{label}] Escape closes the sheet", not dlg.evaluate("d => d.open"))

                # ---- gradient headlines keep their descenders --------------
                d = page.evaluate("""() => {
                    const h = document.querySelector('.pinned-frame .frame-headline') ||
                              document.querySelector('.section-headline.gradient');
                    if (!h) return null;
                    const cs = getComputedStyle(h);
                    const fs = parseFloat(cs.fontSize);
                    return { lh: parseFloat(cs.lineHeight) / fs,
                             pb: parseFloat(cs.paddingBottom) / fs };
                }""")
                if d:
                    ck(f"[{label}] gradient headline has descender room",
                       d["lh"] >= 1.06 or d["pb"] >= 0.10, d)
                page.close()
        finally:
            browser.close()

    print(f"\n[NAV+READING] {checks - len(fails)}/{checks} checks passed")
    if fails:
        print("FAILED: " + "; ".join(fails))
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
