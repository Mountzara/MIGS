#!/usr/bin/env python3
"""Convert the pending trend-brief bodies in R2 from the dark palette to light.

Every row in the peer-review queue predates the site's light conversion:
the stored bodies (R2 mountzara-content trend-briefs-pending/<id>/body.html)
paint white text on near-black grounds, while the admin preview shell is
paper — so the owner's review UI rendered the briefs unreadably, which is
one of the reasons the queue sat unreviewed. This applies the SAME
conversion the published posts got (scripts/repost_light_theme.py's
convert_body — style blocks and style attributes only), asserts the prose
is byte-identical outside styling, and PUTs the body back to the same key.

  python3 scripts/relight_pending_briefs.py            # dry run
  python3 scripts/relight_pending_briefs.py --apply
"""
import json, os, re, subprocess, sys, importlib.util

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "rlt", os.path.join(os.path.dirname(os.path.abspath(__file__)), "repost_light_theme.py"))
rlt = importlib.util.module_from_spec(spec)
# repost_light_theme runs main() only under __main__? It may execute at import.
# Guard: read the source — main() is invoked at the bottom unconditionally in
# some of these operator scripts. Neutralise by executing only up to main.
src = open(spec.origin, encoding="utf-8").read()
# Keep everything up to (but excluding) def main — we only need the pure
# conversion functions; the module's own main() operates on live POSTS and
# must never run from here.
cut = src.index("def main(")
exec(compile(src[:cut], spec.origin, "exec"), rlt.__dict__)

ACCT = "8fbe127f640681ddd813aaf33b95507f"
APPLY = "--apply" in sys.argv

def creds():
    env = {}
    for line in open(os.path.expanduser("~/.config/mountzara/global-api-key.env")):
        line = line.strip()
        if line.startswith("export "):
            k, _, v = line[7:].partition("=")
            env[k] = v.strip().strip('"')
    return env

def r2(path, method="GET", data=None, ctype=None):
    c = creds()
    cmd = ["curl", "-sS", "--fail-with-body", "-X", method,
           "-H", f"X-Auth-Email: {c['CLOUDFLARE_EMAIL']}",
           "-H", f"X-Auth-Key: {c['CLOUDFLARE_API_KEY']}",
           f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/r2/buckets/mountzara-content/{path}"]
    if data is not None:
        cmd += ["-H", f"Content-Type: {ctype or 'text/html'}", "--data-binary", "@" + data]
    out = subprocess.run(cmd, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f"{method} {path}: {out.stderr.decode()[:160]}")
    return out.stdout

def strip_styles(body):
    body = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", body, flags=re.I)
    return re.sub(r'style="[^"]*"', "", body)

def main():
    keys, cursor = [], None
    while True:
        path = "objects?per_page=500&prefix=trend-briefs-pending%2F" + (f"&cursor={cursor}" if cursor else "")
        listing = json.loads(r2(path))
        keys += [o["key"] for o in (listing.get("result") or []) if o["key"].endswith("/body.html")]
        info = listing.get("result_info") or {}
        cursor = info.get("cursor")
        if not cursor or not info.get("is_truncated", False):
            break
    print(f"{len(keys)} pending brief bodies")
    changed = 0
    tmp = "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/_relight_body.html"
    for key in sorted(keys):
        enc = key.replace("/", "%2F")
        body = r2(f"objects/{enc}").decode("utf-8")
        out, n = rlt.convert_body(body)
        if not n:
            print(f"  = {key.split('/')[1][:56]:58s} already light")
            continue
        assert strip_styles(out) == strip_styles(body), f"{key}: prose changed — refusing"
        changed += 1
        print(f"  ✓ {key.split('/')[1][:56]:58s} {n:4d} declaration(s) converted")
        if APPLY:
            open(tmp, "w", encoding="utf-8").write(out)
            r2(f"objects/{enc}", "PUT", data=tmp, ctype="text/html")
    print(f"\n{changed} body(ies) {'converted' if APPLY else 'would convert (dry run — pass --apply)'}")

main()
