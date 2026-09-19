#!/usr/bin/env python3
"""Walk the patient's path end to end and assert the AFFORDANCE at each step.

Why this exists alongside audit_route_render.py: that gate proves a route
LOADS — right title, right selector. It cannot tell you whether a patient can
actually get from one step to the next. A contact modal that opens onto no
email, a portal door that dead-ends instead of offering sign-in, an education
index whose cards link nowhere: every one of those renders perfectly and
passes a render check while the journey is broken.

So each step here asserts the thing a patient must be able to DO, not the
markup that happens to be present. Public surfaces only — no auth, so it runs
on every deploy without credentials.

Usage: audit_patient_journey.py [base_url]
"""
import sys, os, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_pw_launch import launch_engine
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://mountzara.com").rstrip("/")
LOCAL = "localhost" in BASE or "127.0.0.1" in BASE

results = []
def check(step, ok, detail=""):
    results.append((step, bool(ok), detail))
    print(f"  {'✓' if ok else '✗'} {step}" + (f"  — {detail}" if detail and not ok else ""))

def goto(page, path):
    url = BASE + path + ("index.html" if LOCAL and path.endswith("/") else "")
    page.goto(url + f"?cb={int(time.time()*1000)}", wait_until="domcontentloaded", timeout=40000)
    page.wait_for_timeout(1800)
    try:
        page.evaluate("document.querySelectorAll('video').forEach(v=>{try{v.pause();v.preload='none'}catch(e){}})")
    except Exception:
        pass

def main():
    with sync_playwright() as p:
        br, eng, note = launch_engine(p, "webkit")
        if note: print(f"  ({note})")
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.dismiss())

        # ---- 1. the front door offers a way to make contact -------------
        goto(page, "/")
        opened = page.evaluate("""() => {
            try { if (window.openContactModal) { window.openContactModal(); return true; } } catch (e) {}
            return false;
        }""")
        page.wait_for_timeout(900)
        contact = page.evaluate("""() => {
            const vis = el => { const r = el.getBoundingClientRect();
                const c = getComputedStyle(el);
                return r.width > 4 && r.height > 4 && c.visibility !== 'hidden' && c.display !== 'none'; };
            const mail = [...document.querySelectorAll('a[href^="mailto:"], a[href*="mail."], a[href*="outlook"], a[href*="gmail"]')].filter(vis);
            const addr = /[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i.test(document.body.innerText);
            return {routes: mail.length, addressShown: addr};
        }""")
        check("front door — the appointment CTA opens a contact route", opened)
        check("front door — that route actually reaches an inbox",
              contact["routes"] >= 1 or contact["addressShown"],
              f"{contact['routes']} mail link(s), address visible={contact['addressShown']}")

        # ---- 2. "what I treat" leads somewhere real ---------------------
        goto(page, "/education/")
        edu = page.evaluate("""() => {
            const links = [...document.querySelectorAll('a[href*="/education/"]')]
                .map(a => a.getAttribute('href'))
                .filter(h => h && h !== '/education/' && !h.endsWith('#'));
            return {count: new Set(links).size, first: links[0] || null};
        }""")
        check("education index — offers topic guides", edu["count"] >= 5,
              f"{edu['count']} topic link(s)")

        if edu["first"]:
            goto(page, edu["first"] if edu["first"].startswith("/") else "/education/" + edu["first"])
            body = page.evaluate("() => (document.body.innerText||'').trim().length")
            check("education topic — the guide actually has content", body > 800, f"{body} chars")

        # ---- 3. the portal door is a door, not a dead end ---------------
        goto(page, "/portal/")
        door = page.evaluate("""() => {
            const t = (document.body.innerText || '').toLowerCase();
            const cta = [...document.querySelectorAll('a, button')].filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 4 && r.height > 4;
            }).length;
            return {
                says: /sign in|log in|request|coming soon|early access|member/.test(t),
                controls: cta,
                errored: /error|not found|cannot|failed/.test(t.slice(0, 400)),
            };
        }""")
        check("portal door — explains itself rather than dead-ending",
              door["says"] and not door["errored"], f"controls={door['controls']}")

        # ---- 4. a patient who has an account can start signing in ------
        goto(page, "/portal/login/")
        login = page.evaluate("""() => {
            const email = document.querySelector('input[type=email], input[name*=email i], input[id*=email i]');
            const submit = [...document.querySelectorAll('button, input[type=submit]')].find(b => {
                const r = b.getBoundingClientRect(); return r.width > 4 && r.height > 4;
            });
            return {email: !!email, submit: !!submit};
        }""")
        check("sign-in — an email field and a submit control are present",
              login["email"] and login["submit"], str(login))

        # ---- 5. the CV request path works for referring physicians -----
        goto(page, "/cv/")
        cv = page.evaluate("""() => {
            const t = (document.body.innerText || '').toLowerCase();
            const form = document.querySelector('form');
            const email = document.querySelector('input[type=email]');
            return {gated: /request|on request|available/.test(t), form: !!form, email: !!email};
        }""")
        # /cv/ is Function-gated: locally it serves the raw page, so only
        # assert the request path where the gate is actually running.
        if LOCAL:
            check("cv — page renders (gate not active locally)", True)
        else:
            check("cv — by-request page offers a working request form",
                  cv["gated"] and cv["form"] and cv["email"], str(cv))

        # ---- 6. the footer keeps both audiences moving -----------------
        goto(page, "/")
        foot = page.evaluate("""() => {
            const f = document.querySelector('footer');
            if (!f) return {found: false};
            const hrefs = [...f.querySelectorAll('a')].map(a => a.getAttribute('href') || '');
            return {found: true,
                    portal: hrefs.some(h => h.includes('/portal')),
                    treat: hrefs.some(h => h.includes('/education')),
                    contact: hrefs.some(h => h.includes('contact') || h.startsWith('mailto:'))};
        }""")
        check("footer — routes to portal, to what-I-treat, and to contact",
              foot.get("found") and foot.get("portal") and foot.get("treat") and foot.get("contact"),
              str(foot))

        ctx.close(); br.close()

    bad = [r for r in results if not r[1]]
    if bad:
        print(f"\n🛑 PATIENT-JOURNEY GATE FAILED — {len(bad)} of {len(results)} step(s) broken.")
        print("   A patient cannot complete the path the site invites them onto.")
        return 1
    print(f"\npatient-journey gate: CLEAN — all {len(results)} step(s) walkable")
    return 0

if __name__ == "__main__":
    sys.exit(main())
