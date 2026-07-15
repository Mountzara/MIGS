#!/usr/bin/env python3
"""Reconstruct per-topic syntheses from the workflow, insert each as a
<p class="mz-toc-group-synthesis"> after its topic-header (before the papers-
grid), verify auditPostFormat passes, and republish."""
import json, re, os, glob, subprocess, sys, html
WF = sys.argv[sys.argv.index("--wf") + 1] if "--wf" in sys.argv else None
DO = "--publish" in sys.argv
REPO = "/home/user/MIGS"
ACCT = os.environ["CLOUDFLARE_ACCOUNT_ID"]; TOK = os.environ["CLOUDFLARE_API_TOKEN"]
R2 = f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/r2/buckets/mountzara-content/objects/posts"
WFDIR = f"/root/.claude/projects/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/subagents/workflows/{WF}"
WORK = json.load(open("/tmp/topic_work.json"))
# map first-pmid -> (post, slug)  and topic-name -> (post, slug)
pmid2ts = {}; topic2ts = {}
for w in WORK:
    if w["papers"]:
        pmid2ts.setdefault(w["papers"][0]["pmid"], (w["post"], w["slug"]))
    topic2ts[(w["post"], w["topic"])] = w["slug"]

def esc(t): return html.escape(str(t or ""), quote=False)
def ptext(m):
    if isinstance(m, dict):
        c = m.get("content")
        if isinstance(c, list): return " ".join(x.get("text", "") for x in c if isinstance(x, dict))
        return c or ""
    return m or ""

TS_PMIDS = {(w["post"], w["slug"]): set(x["pmid"] for x in w["papers"]) for w in WORK}

def reconstruct():
    res = {}
    for l in open(f"{WFDIR}/journal.jsonl"):
        d = json.loads(l)
        if d.get("type") == "result": res[d["agentId"]] = d["result"]
    syn = {}      # (post,slug) -> synthesis
    verify = {}   # synthesis-text -> {ok, revised}
    for f in glob.glob(f"{WFDIR}/agent-*.jsonl"):
        if f.endswith(".meta.json"): continue
        L = open(f).read().splitlines()
        if not L: continue
        first = json.loads(L[0]); p = ptext(first.get("message", "")); r = res.get(first.get("agentId"))
        if r is None: continue
        if "per-topic SYNTHESIS PARAGRAPH" in p and isinstance(r, dict) and r.get("synthesis"):
            # identify (post,slug): exact TOPIC-name match + PMID overlap to pick the post
            pmids = set(re.findall(r"\b(\d{8})\b", p))
            tname = (re.search(r"TOPIC:\s*(.*?)\s*\(\d+ papers", p) or [None, ""])[1].strip()
            cands = [w for w in WORK if w["topic"] == tname] or WORK
            best, bestscore = None, -1
            for w in cands:
                ts = (w["post"], w["slug"]); wp = TS_PMIDS[ts]
                sc = len(pmids & wp)
                if sc > bestscore and ts not in syn:
                    bestscore, best = sc, ts
            if best and bestscore >= 1: syn[best] = r["synthesis"].strip()
        elif "Adversarially verify a per-topic synthesis" in p and isinstance(r, dict):
            sm = re.search(r'SYNTHESIS: "([\s\S]*?)"\s*\nCheck', p)
            if sm: verify[sm.group(1).strip()] = {"ok": r.get("ok"), "revised": r.get("revised")}
    final = {}
    for ts, s in syn.items():
        v = verify.get(s)
        if v and v.get("ok") is False and v.get("revised"): s = v["revised"].strip()
        final[ts] = s
    return final

def build_references(body):
    """Consolidated references list from the post's cite-cards (dedup by PMID)."""
    seen = {}; order = []
    for m in re.finditer(r'<article class="mz-cite-card"[^>]*id="mz-cite-(\d+)"([\s\S]*?)</article>', body):
        pmid = m.group(1); inner = m.group(2)
        if pmid in seen: continue
        title = (re.search(r'mz-cite-title">(.*?)</h3>', inner) or [None, ""])[1]
        meta = (re.search(r'mz-cite-meta">([\s\S]*?)</p>', inner) or [None, ""])[1]
        jm = re.search(r'<strong>(.*?)</strong>', meta); ym = re.search(r'(\b20\d\d\b)', meta)
        seen[pmid] = {"title": re.sub(r'<[^>]+>', '', title).strip(),
                      "journal": jm.group(1).strip() if jm else "",
                      "year": ym.group(1) if ym else ""}
        order.append(pmid)
    items = []
    for i, pmid in enumerate(order, 1):
        r = seen[pmid]
        j = f"<strong>{esc(r['journal'])}</strong>. " if r["journal"] else ""
        y = f"{r['year']}. " if r["year"] else ""
        items.append(f'<li id="ref-{i}"><em>{esc(r["title"])}</em>. {j}{y}PMID '
                     f'<a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noopener noreferrer">{pmid}</a>.</li>')
    return (f'<section class="mz-post-section mz-references" id="references"><h2>References</h2>'
            f'<ol class="mz-references-list">{"".join(items)}</ol></section>')

def insert_references(body):
    if re.search(r'class="[^"]*\bmz-references-list\b', body):
        return body, 0
    sec = build_references(body)
    # insert after the LAST topic-section's closing </section>
    ends = [m.end() for m in re.finditer(r'<section class="topic-section[\s\S]*?</section>', body)]
    if not ends:
        return body, 0
    i = ends[-1]
    return body[:i] + sec + body[i:], 1

def insert_synth(body, slug, synth):
    pat = re.compile(
        r'(<section class="topic-section[^"]*" id="topic-' + re.escape(slug) +
        r'">\s*<div class="topic-header">[\s\S]*?</div>\s*</div>)(\s*<div class="papers-grid">)')
    block = f'<p class="mz-toc-group-synthesis">{esc(synth)}</p>'
    if 'mz-toc-group-synthesis' in (pat.search(body).group(0) if pat.search(body) else ''):
        return body, 0
    new, n = pat.subn(lambda m: m.group(1) + block + m.group(2), body, count=1)
    return new, n

def publishable(post):
    p = f"/tmp/_pchk_{post['id']}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
    out = subprocess.run(["node", "--input-type=module", "-e",
        f'import {{ auditPublishable, auditPostFormat }} from "{REPO}/functions/_lib/post_format.js";import {{ readFileSync }} from "fs";'
        f'const q=JSON.parse(readFileSync("{p}","utf8"));const a=auditPublishable(q);'
        f'console.log(JSON.stringify({{publishable:a.publishable,canonical:auditPostFormat(q).canonical,problems:a.problems}}));'],
        capture_output=True, text=True, cwd=REPO)
    try: return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception: return {"publishable": False, "problems": ["err: " + out.stderr[:150]]}

def main():
    final = reconstruct()
    print(f"reconstructed {len(final)} syntheses")
    import datetime
    now = datetime.datetime(2026, 7, 15, tzinfo=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    for pid in ["blog-2026-W25", "blog-2026-W28", "blog-2026-W29"]:
        post = json.loads(subprocess.check_output(["curl", "-s", f"{R2}/{pid}.json", "-H", f"Authorization: Bearer {TOK}"], text=True))
        body = post["body_html"]; ins = miss = 0
        slugs = re.findall(r'id="topic-([^"]+)"', body)
        for slug in slugs:
            s = final.get((pid, slug))
            if not s: miss += 1; continue
            body, n = insert_synth(body, slug, s); ins += n
        body, refn = insert_references(body)
        post["body_html"] = body
        chk = publishable(post)
        print(f"\n{pid}: inserted {ins} syntheses (miss {miss}), references={refn} | canonical={chk.get('canonical')} publishable={chk['publishable']}")
        for pr in chk["problems"][:4]: print(f"     ✗ {pr[:110]}")
        if chk["publishable"] and DO:
            post["updated_at"] = now; post.pop("format_audit", None)
            p = f"/tmp/_pub2_{pid}.json"; json.dump(post, open(p, "w"), ensure_ascii=False)
            code = subprocess.check_output(["curl", "-s", "-X", "PUT", f"{R2}/{pid}.json", "-H", f"Authorization: Bearer {TOK}",
                "-H", "Content-Type: application/json", "--data-binary", f"@{p}", "-w", "%{http_code}", "-o", "/dev/null"], text=True)
            print(f"     → republished HTTP {code}")
        elif not DO:
            json.dump(post, open(f"/tmp/_synth_{pid}.json", "w"), ensure_ascii=False); print("     (dry-run saved)")

if __name__ == "__main__":
    main()
