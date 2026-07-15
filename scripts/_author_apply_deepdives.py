#!/usr/bin/env python3
"""Reconstruct authored deep-dive sections from the authoring workflow, slot
each into its modal's PENDING sections (W23 house format), verify each post
passes auditPublishable (incl. the placeholder gate), and republish."""
import json, re, os, glob, subprocess, sys, html
WF = sys.argv[sys.argv.index("--wf") + 1] if "--wf" in sys.argv else None
DO = "--publish" in sys.argv
REPO = "/home/user/MIGS"
ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]; TOK = os.environ["CLOUDFLARE_API_TOKEN"]
R2 = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/r2/buckets/mountzara-content/objects/posts"
WFDIR = f"/root/.claude/projects/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/subagents/workflows/{WF}"

def esc(t): return html.escape(str(t or ""), quote=False)
def ptext(m):
    if isinstance(m, dict):
        c = m.get("content")
        if isinstance(c, list): return " ".join(x.get("text", "") for x in c if isinstance(x, dict))
        return c or ""
    return m or ""

def reconstruct():
    res = {}
    for l in open(f"{WFDIR}/journal.jsonl"):
        d = json.loads(l)
        if d.get("type") == "result": res[d["agentId"]] = d["result"]
    sec = {}  # pmid -> authored fields
    for f in glob.glob(f"{WFDIR}/agent-*.jsonl"):
        if f.endswith(".meta.json"): continue
        L = open(f).read().splitlines()
        if not L: continue
        first = json.loads(L[0]); p = ptext(first.get("message", "")); r = res.get(first.get("agentId"))
        if r is None: continue
        if "Author the journal-club" in p:
            pm = re.search(r"PMID (\d+)", p)
            if pm and isinstance(r, dict) and r.get("bottom"): sec[pm.group(1)] = r
    return sec

def build_body(key, s):
    if key == "bottom": return f"<p>{esc(s['bottom'])}</p>"
    if key == "findings": return f"<p>{esc(s['findings'])}</p>"
    if key == "question": return f"<p><strong>The clinical problem.</strong> {esc(s['problem'])}</p><p><strong>The question.</strong> {esc(s['question'])}</p>"
    if key == "pico":
        return ("<dl>"
                f"<dt>Population</dt><dd>{esc(s['population'])}</dd>"
                f"<dt>Intervention / Exposure</dt><dd>{esc(s['intervention'])}</dd>"
                f"<dt>Comparator</dt><dd>{esc(s['comparator'])}</dd>"
                f"<dt>Outcome</dt><dd>{esc(s['outcome'])}</dd>"
                f"<dt>Design</dt><dd>{esc(s['design'])}</dd>"
                f"<dt>Sample</dt><dd>{esc(s['sample'])}</dd></dl>")
    if key == "strengths": return f"<p>{esc(s['strengths'])}</p>"
    if key == "applicability": return f"<p>{esc(s['applicability'])}</p>"
    if key == "equity": return f"<p>{esc(s['equity'])}</p>"
    if key == "prompts":
        items = "".join(f"<li>{esc(x)}</li>" for x in (s.get("prompts") or [])[:3])
        return f"<ol>{items}</ol>"
    return None

SECTION_KEYS = ["bottom", "question", "pico", "findings", "strengths", "applicability", "equity", "prompts"]

def apply_sections(body, pmid, s):
    filled = 0
    for key in SECTION_KEYS:
        # match this modal's section; replace ONLY if it currently holds a Pending placeholder
        pat = re.compile(rf'(<section[^>]*id="dd-{pmid}-{key}"[^>]*>)(<h3>[\s\S]*?</h3>)([\s\S]*?)(</section>)')
        m = pat.search(body)
        if not m or "Pending" not in m.group(3) and "Pending" not in m.group(2):
            continue
        heading = re.sub(r'\s*<span class="mz-jc-pending-tag">[^<]*</span>', "", m.group(2))
        newbody = build_body(key, s)
        if not newbody: continue
        body = body[:m.start()] + m.group(1) + heading + newbody + m.group(4) + body[m.end():]
        filled += 1
    return body, filled

def publishable(post):
    p = f"/tmp/_chk_{post['id']}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
    out = subprocess.run(["node", "--input-type=module", "-e",
        f'import {{ auditPublishable }} from "{REPO}/functions/_lib/post_format.js";import {{ readFileSync }} from "fs";'
        f'const a=auditPublishable(JSON.parse(readFileSync("{p}","utf8")));console.log(JSON.stringify({{publishable:a.publishable,problems:a.problems}}));'],
        capture_output=True, text=True, cwd=REPO)
    try: return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception: return {"publishable": False, "problems": ["audit err: " + out.stderr[:150]]}

def main():
    sec = reconstruct()
    print(f"reconstructed authored sections for {len(sec)} modals")
    import datetime
    now = datetime.datetime(2026, 7, 14, tzinfo=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    for pid in ["blog-2026-W25", "blog-2026-W28", "blog-2026-W29"]:
        post = json.load(open(f"/tmp/author/{pid}.json")); body = post["body_html"]
        pmids = [m.group(1) for m in re.finditer(r'<dialog[^>]*id="dd-(\d+)"', body)]
        total = 0; miss = 0
        for pmid in pmids:
            if pmid in sec:
                body, n = apply_sections(body, pmid, sec[pmid]); total += n
            else:
                miss += 1
        post["body_html"] = body
        pending = len(re.findall(r"[Pp]ending.{0,30}review", body))
        chk = publishable(post)
        print(f"\n{pid}: filled {total} sections, {miss} modals with no authored data | pending left={pending} | publishable={chk['publishable']}")
        for pr in chk["problems"][:5]: print(f"     ✗ {pr[:110]}")
        if chk["publishable"] and DO:
            post["updated_at"] = now; post.pop("format_audit", None)
            p = f"/tmp/_pub_{pid}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
            code = subprocess.check_output(["curl", "-s", "-X", "PUT", f"{R2}/{pid}.json", "-H", f"Authorization: Bearer {TOK}",
                "-H", "Content-Type: application/json", "--data-binary", f"@{p}", "-w", "%{http_code}", "-o", "/dev/null"], text=True)
            print(f"     → republished HTTP {code}")
        elif not DO:
            json.dump(post, open(f"/tmp/_authored_{pid}.json", "w"), ensure_ascii=False); print("     (dry-run saved)")

if __name__ == "__main__":
    main()
