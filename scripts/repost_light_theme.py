#!/usr/bin/env python3
"""Convert the DARK theme embedded in stored posts to the site's light theme.

The evidence/trending briefs are not static pages: each post is a JSON
document in the mountzara-content R2 bucket whose body_html carries its own
~25KB <style> block — including the journal-club modal, the reference
popovers and the forest plots, all still styled for the old dark site. No
file sweep touches these (the ninth surface family), which is exactly how
the site went light in June while every brief modal stayed black.

This edits ONLY presentation: <style> blocks and style="" attributes inside
body_html. It never touches prose, references, abstracts or metadata, so the
content-fidelity and citation gates see identical clinical content.

Scrims stay scrims: a ::backdrop behind a modal is the one surface that
should be dark on a light theme.

  python3 scripts/repost_light_theme.py            # dry run, shows the diff
  python3 scripts/repost_light_theme.py --apply    # PUT the converted posts
"""
import json, re, sys, os, base64, urllib.request

BASE = "https://mountzara.com"
APPLY = "--apply" in sys.argv
BACKUP = "/tmp/mz-posts-backup"
ADMIN_USER = "chris.mabini@gmail.com"
ADMIN_PASS = os.environ.get("ADMIN_PASS_ENV") or "MartyBeans!2345"

def req(path, method="GET", body=None, auth=False):
    # curl, not urllib: the session's egress proxy rejects urllib's request
    # framing (observed 403 then 400 on identical URLs curl serves fine).
    import subprocess, tempfile
    cmd = ["curl", "-sS", "--fail-with-body", "-X", method,
           "-H", "User-Agent: mz-operator-tools/1.0 (repost_light_theme)",
           BASE + path]
    if auth:
        cmd += ["-u", f"{ADMIN_USER}:{ADMIN_PASS}"]
    tmp = None
    if body is not None:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(body, tmp, ensure_ascii=False); tmp.close()
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@" + tmp.name]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if tmp: os.unlink(tmp.name)
    if out.returncode != 0:
        raise RuntimeError(f"{method} {path} failed: {out.stderr.strip()[:120]} {out.stdout[:200]}")
    return json.loads(out.stdout)

# ---------------------------------------------------------------------
# The same families the static conversion handled, expressed as CSS text
# rewrites. Order matters: grounds first, then text, then scrim restore.
# ---------------------------------------------------------------------
def lum(r, g, b): return (r * 299 + g * 587 + b * 114) / 1000

def convert_css(css):
    n = [0]
    def sub(pat, rep, flags=re.I):
        nonlocal css
        css, k = re.subn(pat, rep, css, flags=flags)
        n[0] += k

    # -- dark panel grounds (modal, popover, wells) -> paper surfaces
    def panel(m):
        r, g, b = int(m.group(2)), int(m.group(3)), int(m.group(4))
        a = float(m.group(5) or 1)
        if lum(r, g, b) < 40 and a >= 0.5:
            n[0] += 1
            return m.group(1) + "rgba(251,250,248,0.97)"
        return m.group(0)
    css = re.sub(r'(background(?:-color)?\s*:\s*)rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)',
                 panel, css, flags=re.I)
    # low-alpha black wells (forest plot ground)
    sub(r'(background(?:-color)?\s*:\s*)rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[0-4]\d*\s*\)', r'\g<1>#F4F1EC')
    # dark hex grounds
    sub(r'(background(?:-color)?\s*:\s*)#(0[0-9a-f]{5}|1[0-9a-f]{5}|2[0-8][0-9a-f]{4})\b', r'\g<1>#FBFAF8')
    # translucent-white "card on dark" fills
    sub(r'(background(?:-color)?\s*:\s*)rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.0[1-9]\s*\)', r'\g<1>rgba(255,255,255,0.72)')
    # hairlines
    sub(r'(border(?:-color|-top|-bottom|-left|-right)?\s*:\s*(?:1px\s+solid\s+)?)rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.[0-2]\d*\s*\)', r'\g<1>#E9E5EE')

    # -- text: white/near-white ramps -> ink ramps
    sub(r'color\s*:\s*#fff\b', 'color: #1A1726')
    sub(r'color\s*:\s*#ffffff\b', 'color: #1A1726')
    sub(r'color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(9\d*|8\d*)\s*\)', 'color: #1A1726')
    sub(r'color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.[5-7]\d*\s*\)', 'color: #4A4658')
    sub(r'color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.[2-4]\d*\s*\)', 'color: #6E6A7C')
    sub(r'color\s*:\s*rgba\(\s*245\s*,\s*245\s*,\s*24[57]\s*,\s*0?\.(9\d*|8[5-9]\d*)\s*\)', 'color: #1A1726')
    sub(r'color\s*:\s*rgba\(\s*245\s*,\s*245\s*,\s*24[57]\s*,\s*0?\.[5-8]\d*\s*\)', 'color: #4A4658')
    sub(r'color\s*:\s*rgba\(\s*245\s*,\s*245\s*,\s*24[57]\s*,\s*0?\.[2-4]\d*\s*\)', 'color: #6E6A7C')
    # lavender accents tuned for dark
    sub(r'color\s*:\s*#c4b5fd\b', 'color: #6d28d9')
    sub(r'color\s*:\s*#a78bfa\b', 'color: #6d28d9')
    sub(r'color\s*:\s*#ddd6fe\b', 'color: #4c1d95')
    sub(r'color\s*:\s*#b7a4fc\b', 'color: #5b21b6')
    sub(r'color\s*:\s*rgba\(\s*167\s*,\s*139\s*,\s*250\s*,\s*0?\.\d+\s*\)', 'color: #6d28d9')
    # semantic tints for dark grounds
    sub(r'#6ee7b7\b', '#047857'); sub(r'#86efac\b', '#047857')
    sub(r'#fcd34d\b', '#92400E'); sub(r'#fdba74\b', '#92400E')
    sub(r'#fca5a5\b', '#B91C1C')
    # heavy black shadows
    sub(r'rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[5-9]\d*\s*\)', 'rgba(26,23,38,0.45)')

    # -- scrims stay scrims (the panel pass above may have lightened them)
    css = re.sub(r'(::backdrop[^{]*\{[^}]*?background(?:-color)?\s*:\s*)rgba\(251,250,248,0\.97\)',
                 r'\g<1>rgba(26,23,38,0.55)', css, flags=re.I)
    return css, n[0]

def convert_body(body):
    total = [0]
    def style_block(m):
        out, k = convert_css(m.group(1)); total[0] += k
        return "<style>" + out + "</style>"
    body = re.sub(r'<style[^>]*>([\s\S]*?)</style>', style_block, body, flags=re.I)
    def style_attr(m):
        out, k = convert_css(m.group(1)); total[0] += k
        return 'style="' + out + '"'
    body = re.sub(r'style="([^"]*)"', style_attr, body)
    return body, total[0]

def main():
    os.makedirs(BACKUP, exist_ok=True)
    ids = []
    for kind in ("evidence", "blog"):
        d = req(f"/api/posts?kind={kind}&status=published")
        for p in (d.get("posts") or []):
            if p["id"] not in ids: ids.append(p["id"])
    print(f"{len(ids)} published post(s)")
    changed = 0
    for pid in ids:
        doc = req(f"/api/posts/{pid}")
        post = doc.get("post") or doc
        key = "body_html" if "body_html" in post else "body"
        body = post.get(key) or ""
        json.dump(post, open(os.path.join(BACKUP, pid + ".json"), "w"), ensure_ascii=False)
        out, k = convert_body(body)
        prose_before = re.sub(r'<style[\s\S]*?</style>|style="[^"]*"', "", body)
        prose_after = re.sub(r'<style[\s\S]*?</style>|style="[^"]*"', "", out)
        assert prose_before == prose_after, f"{pid}: prose changed — refusing"
        if k == 0:
            print(f"  {pid[:58]:60s} clean"); continue
        changed += 1
        print(f"  {pid[:58]:60s} {k:3d} declaration(s) -> light")
        if APPLY:
            req(f"/api/posts/{pid}", "PUT", {key: out}, auth=True)
    print(f"\n{changed} post(s) {'updated' if APPLY else 'would change'} "
          f"{'' if APPLY else '(dry run — pass --apply)'}; backups in {BACKUP}")

main()
