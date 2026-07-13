#!/usr/bin/env python3
# =====================================================================
# apply_lens_summaries.py — replace the duplicated canned "DO + CBG/MIGS
# lens" card blurbs (mz-cite-fits) in W23/W24 with paper-specific,
# abstract-grounded lens lines.
# =====================================================================
# Context (2026-07-06): the regressed pipeline stamped ONE canned essay-
# length per-topic paragraph verbatim onto up to 13 different papers in a
# post. Each affected card was regenerated (fan-out workflow: generate a
# paper-specific line from that paper's own verbatim abstract, then
# adversarially verify grounded + specific). The 69 verified lines live in
# scripts/lens_summaries_w23_w24.json. This script writes them into the
# live R2 post bodies, preserving each card's "Frame: <topic>:" prefix and
# touching nothing else.
#
# Idempotent + safe: only the mz-cite-fits body after </strong> is swapped;
# a card whose PMID isn't in the data file is untouched. Requires Cloudflare
# creds (source ~/.config/mountzara/cf-creds.env). After running, verify:
#   node scripts/audit_numeric_fidelity.mjs
# then deploy so the new content-fidelity gate ships alongside the fix.
# =====================================================================
import json, os, re, sys, subprocess, datetime, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "lens_summaries_w23_w24.json")))
SUMMARIES, POST_OF = DATA["summaries"], DATA["post_of"]

acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
tok = os.environ.get("CLOUDFLARE_API_TOKEN")
if not (acct and tok):
    sys.exit("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set — "
             "source ~/.config/mountzara/cf-creds.env first.")
BASE = f"https://api.cloudflare.com/client/v4/accounts/{acct}/r2/buckets/mountzara-content/objects/posts"
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
FITS_RE = re.compile(r'(<p class="mz-cite-fits"[^>]*><strong>[^<]*</strong>)([\s\S]*?)(</p>)')

def esc(t): return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

from collections import defaultdict
by_post = defaultdict(dict)
for pmid, body in SUMMARIES.items():
    by_post[POST_OF.get(pmid, "blog-2026-W23")][pmid] = body

for post, m in by_post.items():
    req = urllib.request.Request(f"{BASE}/{post}.json", headers={"Authorization": f"Bearer {tok}"})
    p = json.loads(urllib.request.urlopen(req, timeout=60).read())
    b = p["body_html"]; out = []; last = 0; cnt = 0
    for cm in re.finditer(r'<article class="mz-cite-card"[\s\S]*?</article>', b):
        out.append(b[last:cm.start()]); card = cm.group(0)
        idm = re.search(r'id="mz-cite-(\d+)"', card)
        if idm and idm.group(1) in m:
            nb = esc(m[idm.group(1)])
            card, c = FITS_RE.subn(lambda fm: fm.group(1) + nb + fm.group(3), card, count=1); cnt += c
        out.append(card); last = cm.end()
    out.append(b[last:])
    p["body_html"] = "".join(out); p["updated_at"] = NOW
    p["lens_summaries_regenerated_at"] = NOW; p.pop("format_audit", None)
    payload = json.dumps(p, indent=2, ensure_ascii=False).encode()
    put = urllib.request.Request(f"{BASE}/{post}.json", data=payload, method="PUT",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    code = urllib.request.urlopen(put, timeout=60).status
    print(f"{post}: {cnt} card lens lines replaced, upload HTTP {code}")
print("done — now run: node scripts/audit_numeric_fidelity.mjs && ./scripts/deploy-prod.sh 'ship lens fix + gate'")
