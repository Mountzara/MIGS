#!/usr/bin/env python3
"""Reconstruct the regenerated lens lines from a workflow's transcripts, apply
them to the live R2 post bodies (matched by pmid + exact frame prefix), verify
each post passes auditPublishable (now incl. the template gate), and — with
--publish — write back to R2. Republish only; these posts are already published,
so no index/status change is needed (a body update is served immediately).
"""
import json, re, os, glob, subprocess, sys, html
WF = sys.argv[sys.argv.index("--wf") + 1] if "--wf" in sys.argv else None
DO_PUBLISH = "--publish" in sys.argv
REPO = "/home/user/MIGS"
ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]; TOK = os.environ["CLOUDFLARE_API_TOKEN"]
R2 = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/r2/buckets/mountzara-content/objects/posts"
WFDIR = f"/root/.claude/projects/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/subagents/workflows/{WF}"

def esc(t): return html.escape(t, quote=False)
def prompt_text(msg):
    if isinstance(msg, str): return msg
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, str): return c
        if isinstance(c, list): return " ".join(x.get("text", "") for x in c if isinstance(x, dict))
    return ""

def reconstruct():
    results = {}
    for l in open(f"{WFDIR}/journal.jsonl"):
        d = json.loads(l)
        if d.get("type") == "result": results[d["agentId"]] = d["result"]
    gen = {}      # (pmid, prefix) -> line
    verify = {}   # (pmid, line) -> {ok, revised}
    for f in glob.glob(f"{WFDIR}/agent-*.jsonl"):
        if f.endswith(".meta.json"): continue
        lines = open(f).read().splitlines()
        if not lines: continue
        first = json.loads(lines[0]); aid = first.get("agentId"); p = prompt_text(first.get("message", ""))
        res = results.get(aid)
        if res is None: continue
        if "Write ONE" in p and "framing prefix" in p:
            pm = re.search(r"PMID (\d+)", p); pf = re.search(r'framing prefix[^"]*"([^"]+)"', p)
            if pm and pf and isinstance(res, dict) and res.get("line"):
                gen[(pm.group(1), pf.group(1).strip())] = res["line"].strip()
        elif "REFUTE" in p or "Adversarially verify" in p:
            pm = re.search(r"PMID (\d+)", p); ln = re.search(r'LINE: "([^"]+)"', p)
            if pm and ln and isinstance(res, dict):
                verify[(pm.group(1), ln.group(1).strip())] = {"ok": res.get("ok"), "revised": res.get("revised_line")}
    # final line per (pmid, prefix): use verifier's revision when it rejected
    final = {}
    by_pmid = {}
    for (pmid, prefix), line in gen.items():
        v = verify.get((pmid, line))
        if v and v.get("ok") is False and v.get("revised"): line = v["revised"].strip()
        final[(pmid, prefix)] = line
        by_pmid.setdefault(pmid, line)   # fallback: a paper cited under 2 frames reuses its own generated line
    return final, by_pmid

def r2_get(id):
    return json.loads(subprocess.check_output(["curl", "-s", f"{R2}/{id}.json", "-H", f"Authorization: Bearer {TOK}"], text=True))
def r2_put(post):
    p = f"/tmp/_put_{post['id']}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
    return subprocess.check_output(["curl", "-s", "-X", "PUT", f"{R2}/{post['id']}.json", "-H", f"Authorization: Bearer {TOK}",
        "-H", "Content-Type: application/json", "--data-binary", f"@{p}", "-w", "%{http_code}", "-o", "/dev/null"], text=True)

def replace_lens(body, pmid, prefix, new_line):
    art_re = re.compile(r'(<article class="mz-cite-card"[^>]*id="mz-cite-' + re.escape(pmid) + r'"[\s\S]*?</article>)')
    fits_re = re.compile(r'(<p class="mz-cite-fits"><strong>' + re.escape(prefix) + r'\s*</strong>)(.*?)(</p>)', re.S)
    count = [0]
    def fix(am):
        art = am.group(1)
        if fits_re.search(art):
            new = fits_re.sub(lambda m: m.group(1) + esc(new_line) + m.group(3), art, count=1)
            if new != art: count[0] += 1
            return new
        return art
    return art_re.sub(fix, body), count[0]

def publishable(post):
    p = f"/tmp/_chk_{post['id']}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
    out = subprocess.run(["node", "--input-type=module", "-e",
        f'import {{ auditPublishable }} from "{REPO}/functions/_lib/post_format.js";'
        f'import {{ readFileSync }} from "fs";'
        f'const a=auditPublishable(JSON.parse(readFileSync("{p}","utf8")));'
        f'console.log(JSON.stringify({{publishable:a.publishable,problems:a.problems}}));'],
        capture_output=True, text=True, cwd=REPO)
    try: return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception: return {"publishable": False, "problems": ["audit failed: " + out.stderr[:200]]}

# Manually authored, abstract-grounded lines for papers whose workflow agent
# produced no result (numbers verified against the real PubMed abstract).
MANUAL = {
    "42181206": "In 1,135 overweight/obese GnRH-antagonist IVF cycles, low trigger-day LH (<1.45 IU/L, n=272) yielded more high-quality embryos, with LH inversely tracking embryo yield — yet clinical-pregnancy and live-birth rates didn't differ (aOR 0.95 & 1.13, NS). Monday: read trigger-day LH for embryo yield, not implantation odds.",
}

def main():
    final, by_pmid = reconstruct()
    by_pmid.update(MANUAL)
    # group by post via the flat regen list
    regen = json.load(open("/tmp/vf/regen_cards.json"))
    by_post = {}
    for c in regen: by_post.setdefault(c["post"], []).append(c)
    print(f"reconstructed {len(final)} (pmid,prefix)->line mappings ({len(by_pmid)} unique pmids)")
    for pid in ["blog-2026-W23", "blog-2026-W24", "blog-2026-W25", "blog-2026-W28", "blog-2026-W29"]:
        post = r2_get(pid); body = post["body_html"]; applied = missed = 0
        for c in by_post.get(pid, []):
            line = final.get((c["pmid"], c["prefix"])) or final.get((c["pmid"], c["prefix"].strip())) or by_pmid.get(c["pmid"])
            if not line: missed += 1; continue
            body, n = replace_lens(body, c["pmid"], c["prefix"], line)
            applied += 1 if n else 0
            missed += 0 if n else 1
        post["body_html"] = body
        chk = publishable(post)
        print(f"\n{pid}: applied={applied} missed={missed} | publishable={chk['publishable']}")
        for pr in chk["problems"][:6]: print(f"     ✗ {pr[:120]}")
        if chk["publishable"] and DO_PUBLISH:
            import datetime
            post["updated_at"] = datetime.datetime(2026, 7, 14, tzinfo=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
            post.pop("format_audit", None)
            print(f"     → republished, HTTP {r2_put(post)}")
        elif not DO_PUBLISH:
            json.dump(post, open(f"/tmp/_regen_{pid}.json", "w"), ensure_ascii=False)
            print("     (dry-run saved)")

if __name__ == "__main__":
    main()
