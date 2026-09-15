#!/usr/bin/env python3
"""
brief_pipeline.py — the ONE deterministic path a Monday-Mornings or trend
brief takes from stored draft to published post.

WHY THIS EXISTS (2026-09-15)
============================
Four briefs were prepared by hand in one session and every one of them hit a
different instance of the same few faults, because every stage was retyped:

  * W31   — all 88 "abstracts" were the placeholder string "Verbatim PubMed
            abstract Pending review…". 176 agents would have written analyses
            of nothing. Cost to detect mechanically: ten HTTP calls.
  * supp  — 12 of 32 papers displayed ANOTHER paper's abstract as their own
            "Verbatim PubMed abstract", because the assembler substituted the
            abstract only `if ab` and silently kept the template's otherwise.
  * W33   — 4 papers, W34 — 8 papers, written up as an entirely different
            study; caught only by an expensive adversarial reader.
  * W33   — dosing reached the site's own prose; a narrative section shipped
            reading "Pending review"; a literal "<" truncated a popover.
  * and   — a PMID list typed from memory launched a run against files that
            did not exist.

None of that is a judgement call. All of it is deterministic and belongs in
code that runs the same way every time. The rule this file enforces:

    A brief is never "probably fine". Every stage either proves its
    post-condition or raises. There is no silent fallback, anywhere.

USAGE
=====
    brief_pipeline.py prepare  <post-id>   # extract work files + repair abstracts
    brief_pipeline.py pmids    <post-id>   # the authoritative list, never typed by hand
    brief_pipeline.py guard    <post-id>   # lexical wrong-paper screen over drafts
    brief_pipeline.py apply    <post-id>   # assemble + enforce site rules + audit
    brief_pipeline.py publish  <post-id>   # PUT + approve (refuses unless apply passed)

Stages are independent and idempotent; run `prepare` before any agent work.
"""
from __future__ import annotations
import html as H
import json
import os
import re
import subprocess
import sys
import time

ROOT = "/home/user/MIGS"
SCRATCH = os.environ.get("MZ_BRIEF_SCRATCH") or "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad"
UA = "mz-operator-tools/1.0 (brief-pipeline)"
ADMIN = os.environ.get("MZ_ADMIN_AUTH", "chris.mabini@gmail.com:MartyBeans!2345")
BASE = "https://www.mountzara.com"

# Lexical wrong-paper screen. Calibrated on 12 known-bad drafts (share
# 0.025-0.25) against 89 sound ones (0.375-0.95): a clean gap, no overlap.
OVERLAP_BLOCK = 0.30
# An abstract in a work file must look like the PMID's real abstract.
ABSTRACT_MATCH_MIN = 0.35

STOP = set("""about above after again against because before being below between both during each further having
into itself more most other over same some such than that their them then there these they this those through
under until very were what when where which while with would could should among across also been have has had
are is be by of to in on for and the a an as at it its from or not no we our study patient patients results
result method methods conclusion conclusions background objective purpose aim aims group groups""".split())


def die(msg: str) -> "NoReturn":
    print(f"REFUSED: {msg}", file=sys.stderr)
    sys.exit(2)


def terms(text: str, n: int = 40) -> list[str]:
    freq: dict[str, int] = {}
    for w in re.findall(r"[a-z][a-z-]{5,}", (text or "").lower()):
        if w not in STOP:
            freq[w] = freq.get(w, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda kv: -kv[1])[:n]]


def share(needle_terms: list[str], haystack: str) -> float:
    if not needle_terms:
        return 1.0
    hay = (haystack or "").lower()
    return sum(1 for t in needle_terms if t in hay) / len(needle_terms)


def flat(x) -> str:
    if isinstance(x, dict):
        return " ".join(flat(v) for v in x.values())
    if isinstance(x, list):
        return " ".join(flat(v) for v in x)
    return str(x)


def curl_json(url: str, method: str = "GET", auth: bool = False, data_file: str | None = None):
    cmd = ["curl", "-sS", "--fail-with-body", "-X", method, "-A", UA]
    if auth:
        cmd += ["-u", ADMIN]
    if data_file:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@" + data_file]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        die(f"{method} {url} failed: {r.stderr.strip()[:160]} {r.stdout[:200]}")
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        die(f"{method} {url} did not return JSON: {r.stdout[:200]}")


# ---------------------------------------------------------------------------
# STAGE LEDGER — the part that makes this a pipeline and not a toolbox.
# ---------------------------------------------------------------------------
# Having the right functions available did not stop any of the faults above,
# because nothing forced them to run, in order, on current inputs. Each stage
# now writes a receipt containing a hash of what it consumed; the next stage
# recomputes that hash and REFUSES if the receipt is missing or stale.
#
# The practical effect: you cannot author against unvalidated abstracts, you
# cannot verify a draft the guard has not screened, you cannot apply without
# a clean guard, and you cannot publish a body that apply did not bless. The
# order is not a convention to remember; it is a precondition to execute.
STAGES = ["prepare", "guard", "apply", "publish"]


def _digest(paths: list[str]) -> str:
    import hashlib
    h = hashlib.sha256()
    for path in sorted(paths):
        if os.path.isdir(path):
            for f in sorted(os.listdir(path)):
                h.update(f.encode())
                h.update(open(os.path.join(path, f), "rb").read())
        elif os.path.exists(path):
            h.update(path.encode())
            h.update(open(path, "rb").read())
    return h.hexdigest()[:16]


def _receipt_path(W: str, stage: str) -> str:
    os.makedirs(W + ".ledger", exist_ok=True)
    return W + f".ledger/{stage}.json"


def stage_inputs(W: str, stage: str) -> list[str]:
    return {
        "prepare": [],
        "guard": [W + "papers", W + "drafts_dd"],
        "apply": [W + "papers", W + "drafts_dd", W + "manifest.json"],
        "publish": [W + "body.applied.html"] if os.path.exists(W + "body.applied.html") else [W + "manifest.json"],
    }[stage]


def record(W: str, stage: str, extra: dict | None = None) -> None:
    json.dump({"stage": stage, "digest": _digest(stage_inputs(W, stage)),
               "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **(extra or {})},
              open(_receipt_path(W, stage), "w"), indent=1)


def require(W: str, stage: str) -> dict:
    """Refuse to proceed unless `stage` passed on the inputs that exist now."""
    p = _receipt_path(W, stage)
    if not os.path.exists(p):
        die(f"stage '{stage}' has not run. The order is: {' -> '.join(STAGES)}")
    r = json.load(open(p))
    if r.get("failed"):
        die(f"stage '{stage}' recorded a failure: {r.get('failed')}")
    now = _digest(stage_inputs(W, stage))
    if r.get("digest") != now:
        die(f"stage '{stage}' ran against different inputs (receipt {r.get('digest')}, now {now}) — re-run it")
    return r


def work_dir(post_id: str) -> str:
    key = post_id.split("-")[-1].lower()
    return os.path.join(SCRATCH, key) + "/"


# ---------------------------------------------------------------------------
# PubMed — the only authority on what a PMID's abstract says
# ---------------------------------------------------------------------------
def fetch_pubmed(pmids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(pmids), 20):
        chunk = pmids[i:i + 20]
        r = subprocess.run(
            ["curl", "-sS", "-A", UA,
             "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
             f"?db=pubmed&id={','.join(chunk)}&rettype=abstract&retmode=xml"],
            capture_output=True, text=True)
        for art in re.findall(r"<PubmedArticle>.*?</PubmedArticle>", r.stdout, re.S):
            pm = (re.search(r"<PMID[^>]*>(\d+)</PMID>", art) or [None, ""])[1]
            title = H.unescape(re.sub(r"<[^>]+>", "", (re.search(
                r"<ArticleTitle[^>]*>(.*?)</ArticleTitle>", art, re.S) or [None, ""])[1])).strip()
            parts = []
            for m in re.finditer(r"<AbstractText([^>]*)>(.*?)</AbstractText>", art, re.S):
                lab = (re.search(r'Label="([^"]+)"', m.group(1)) or [None, None])[1]
                body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
                parts.append((lab.upper() + ": " if lab else "") + body)
            if pm:
                out[pm] = {"title": title, "abstract": H.unescape("\n".join(parts)).strip()}
        time.sleep(0.34)
    return out


# ---------------------------------------------------------------------------
# prepare — extract work files from the stored draft, then REPAIR every
# abstract against PubMed. Nothing downstream may run until this passes.
# ---------------------------------------------------------------------------
def txt(s: str) -> str:
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def cmd_prepare(post_id: str) -> None:
    W = work_dir(post_id)
    os.makedirs(W + "papers", exist_ok=True)
    os.makedirs(W + "topics", exist_ok=True)
    os.makedirs(W + "drafts_dd", exist_ok=True)

    post = curl_json(f"{BASE}/api/posts/_admin/{post_id}", auth=True)
    post = post.get("post", post)
    body = post["body_html"]
    json.dump(post, open(W + f"{post_id}.source.json", "w"), ensure_ascii=False)

    dialogs = re.findall(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', body, re.S)
    if not dialogs:
        die(f"{post_id}: no journal-club dialogs found — wrong post shape")

    papers: dict[str, dict] = {}
    for pmid, inner in dialogs:
        secs = {}
        for s in re.finditer(r'<section class="mz-jc-section" id="dd-\d+-([a-z_-]+)">(.*?)</section>', inner, re.S):
            pending = "mz-jc-pending-tag" in s.group(2) or "Pending Dr. Mabini" in s.group(2)
            secs[s.group(1)] = {"pending": pending, "text": txt(s.group(2))}
        papers[pmid] = {
            "pmid": pmid,
            "title": txt((re.search(r'class="mz-jc-modal-title"[^>]*>(.*?)</h2>', inner, re.S) or [None, ""])[1]),
            "meta": txt((re.search(r'class="mz-jc-modal-meta"[^>]*>(.*?)</p>', inner, re.S) or [None, ""])[1]),
            "abstract": (secs.get("abstract", {}) or {}).get("text", ""),
            "context": {k: v["text"][:1200] for k, v in secs.items() if not v["pending"] and k != "abstract"},
            "pending": [k for k, v in secs.items() if v["pending"]],
        }

    # --- the check that would have saved 176 agents on W31 ---
    real = fetch_pubmed(sorted(papers))
    repaired, unfetched, mismatched = [], [], []
    for pmid, p in papers.items():
        r = real.get(pmid)
        if not r or len(r["abstract"]) < 80:
            unfetched.append(pmid)
            continue
        if share(terms(r["abstract"] + " " + r["title"], 30), p["abstract"]) < ABSTRACT_MATCH_MIN:
            p["abstract"] = r["abstract"][:6000]
            p["_abstract_source"] = "PubMed efetch — the stored brief did not carry this paper's own abstract"
            repaired.append(pmid)
        if r["title"] and share(terms(r["title"], 8), p["title"]) < 0.4:
            mismatched.append((pmid, p["title"][:50], r["title"][:50]))
    for pmid, p in papers.items():
        json.dump(p, open(W + f"papers/{pmid}.json", "w"), ensure_ascii=False, indent=1)

    # topics, built from the repaired papers so a synthesis can never be
    # written against an abstract the brief no longer shows
    starts = list(re.finditer(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="(topic-[^"]+)"[^>]*>', body))
    topics = []
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(body)
        seg = body[m.end():end]
        tid = m.group(1)
        pmids = list(dict.fromkeys(re.findall(r'id="mz-cite-(\d+)"', seg)))
        json.dump({
            "id": tid,
            "title": txt((re.search(r"<h2[^>]*>(.*?)</h2>", seg, re.S) or [None, ""])[1]),
            "papers": [{"pmid": q, "title": papers[q]["title"], "meta": papers[q]["meta"],
                        "abstract": papers[q]["abstract"][:4500],
                        "bottom": papers[q]["context"].get("bottom", ""),
                        "findings": papers[q]["context"].get("findings", "")}
                       for q in pmids if q in papers],
        }, open(W + f"topics/{tid}.json", "w"), ensure_ascii=False, indent=1)
        topics.append(tid)

    narrative_stub = bool(re.search(
        r'<section class="[^"]*mz-post-narrative[^"]*"[^>]*>(?:(?!</section>).)*?mz-jc-pending-tag', body, re.S))
    json.dump({"post_id": post_id, "dir": W, "pmids": sorted(papers), "topics": topics,
               "narrative_is_stub": narrative_stub, "has_toc": 'class="mz-toc"' in body},
              open(W + "manifest.json", "w"), indent=1)

    print(f"{post_id}: {len(papers)} papers, {len(topics)} topics")
    print(f"  abstracts REPAIRED from PubMed: {len(repaired)}" + (f" {repaired[:6]}" if repaired else ""))
    has_toc = 'class="mz-toc"' in body
    print(f"  narrative is a stub: {narrative_stub} | TOC present: {has_toc}")
    if mismatched:
        for row in mismatched[:5]:
            print(f"  TITLE MISMATCH {row[0]}: brief={row[1]!r} pubmed={row[2]!r}")
        die(f"{len(mismatched)} paper(s) carry a title PubMed does not agree with — fix upstream")
    if unfetched:
        die(f"could not fetch an abstract for {unfetched[:8]} — resolve before authoring")
    json.dump({pm: papers[pm]["abstract"] for pm in repaired},
              open(W + "abstract_repairs.json", "w"), ensure_ascii=False)
    record(W, "prepare", {"papers": len(papers), "repaired": repaired, "topics": topics})
    print(f"  ledger: prepare OK — authoring may now run for {post_id}")


def cmd_pmids(post_id: str) -> None:
    """The authoritative list. Never retype one of these by hand."""
    W = work_dir(post_id)
    require(W, "prepare")          # a PMID list is only authoritative post-validation
    man = json.load(open(W + "manifest.json"))
    done = {f[:-5] for f in os.listdir(W + "drafts_dd")}
    todo = [p for p in man["pmids"] if p not in done]
    print(json.dumps(todo if "--todo" in sys.argv else man["pmids"]))


def cmd_guard(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare")
    rows = []
    for f in sorted(os.listdir(W + "drafts_dd")):
        pm = f[:-5]
        pp = W + f"papers/{pm}.json"
        if not os.path.exists(pp):
            die(f"draft {pm} has no matching paper file")
        p = json.load(open(pp))
        body = re.sub(r"<[^>]+>", " ", flat(json.load(open(W + "drafts_dd/" + f)))).lower()
        rows.append((share(terms(p.get("abstract", "") + " " + p.get("title", "")), body), pm))
    rows.sort()
    bad = [pm for s, pm in rows if s < OVERLAP_BLOCK]
    for s, pm in rows[:6]:
        print(f"  {pm} share={s:.3f}" + ("  <-- WRONG PAPER" if s < OVERLAP_BLOCK else ""))
    print(f"  {len(rows)} drafts | median {rows[len(rows)//2][0]:.3f} | wrong-paper: {len(bad)}")
    json.dump(bad, open(W + "guard_failed.json", "w"))
    man = json.load(open(W + "manifest.json"))
    missing = [p for p in man["pmids"] if not os.path.exists(W + f"drafts_dd/{p}.json")]
    if bad or missing:
        record(W, "guard", {"failed": f"wrong-paper={bad[:8]} missing={missing[:8]}"})
        if bad:
            print("WRONG PAPER — re-author: " + json.dumps(bad))
        if missing:
            print(f"NOT YET AUTHORED ({len(missing)}): " + json.dumps(missing[:12]))
        die("guard did not pass; apply is blocked until every paper is authored and about its own study")
    record(W, "guard", {"drafts": len(rows), "median": rows[len(rows) // 2][0]})
    print(f"  ledger: guard OK — apply may now run for {post_id}")


# ---------------------------------------------------------------------------
# apply — assemble the body and enforce every standing site rule in one place
# ---------------------------------------------------------------------------
HEAD = {"question": "Clinical question", "pico": "PICO", "methods": "Methodology &mdash; methods strength",
        "strengths": "Strengths", "applicability": "External validity &amp; applicability",
        "equity": "Equity &amp; population considerations", "prompts": "Discussion prompts for journal club",
        "bottom": "Bottom line &mdash; author&#39;s own interpretation",
        "findings": "Key findings &mdash; author&#39;s own words"}

DISCLAIMER = ('<div class="mz-eddisclaimer" role="note" style="margin:28px 0 8px;padding:14px 18px;'
              'background:#F4F0FB;border:1px solid #E9E5EE;border-radius:12px;color:#4A4658;font-size:13.5px;'
              'line-height:1.6;"><strong style="color:#1A1726;">Educational information &mdash; not medical '
              'advice.</strong> This is general education drawn from the published literature. It is not a '
              'diagnosis, a treatment recommendation, or a substitute for care from your own clinician, and '
              'reading it does not create a physician&ndash;patient relationship. Decisions about testing, '
              'medications or surgery belong in a private conversation between you and your doctor.</div>')

DOSE_RE = re.compile(r"\b\d[\d,.\u2013\u2014-]*\s?(?:mg|mcg|\u00b5g|\u03bcg|IU)\b", re.I)
# Containers that may carry a study's own reported dose, because the dose is
# attributed to the paper there. Everything outside them is the site's voice.
ATTRIBUTED = re.compile(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>|<dialog[\s\S]*?</dialog>"
                        r"|<details[\s\S]*?</details>|<article class=\"mz-cite-card[\s\S]*?</article>")


def site_prose(h: str) -> str:
    return re.sub(r"<[^>]+>", " ", ATTRIBUTED.sub(" ", h))


def escape_bare_angles(h: str) -> str:
    """A literal < inside popover text is invalid HTML and truncates the span
    for every parser, the publish audit included (caught on W33: 'p < 0.047')."""
    def fix(m):
        inner = re.sub(r"<(?![a-zA-Z/!])", "&lt;", m.group(2))
        return f'<span class="{m.group(1)}">{inner}</span>'
    return re.sub(r'<span class="(mz-ref-pop-finding|mz-ref-pop-title|mz-ref-pop-meta)">(.*?)</span>',
                  fix, h, flags=re.S)


def cmd_apply(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare")
    require(W, "guard")
    man = json.load(open(W + "manifest.json"))
    post = json.load(open(W + f"{post_id}.source.json"))
    h = post["body_html"]

    # 0. repaired abstracts. prepare() fixes the WORK FILE so authoring is
    # grounded correctly; without this step the page keeps showing whatever
    # wrong or truncated text it had. W31 carried a placeholder in all 88, and
    # the live W33 carried one abstract truncated to start at "METHODS:" while
    # labelled "Verbatim PubMed abstract".
    repairs = {}
    if os.path.exists(W + "abstract_repairs.json"):
        repairs = json.load(open(W + "abstract_repairs.json"))
    repaired_n = 0
    for pmid, abstract in repairs.items():
        dm = re.search(r'(<dialog[^>]*id="dd-%s"[^>]*>)(.*?)(</dialog>)' % re.escape(pmid), h, re.S)
        if not dm:
            die(f"cannot write the repaired abstract for {pmid}: no dialog")
        am = re.search(r'(<div class="mz-jc-abstract-body">)(.*?)(</div>)', dm.group(2), re.S)
        if not am:
            die(f"cannot write the repaired abstract for {pmid}: no abstract container")
        blocks = []
        for part in re.split(r"\n(?=[A-Z][A-Z /&-]{2,40}:)", "\n" + abstract.strip()):
            part = part.strip()
            if not part:
                continue
            lm = re.match(r"([A-Z][A-Z /&-]{2,40}):\s*([\s\S]*)", part)
            if lm:
                blocks.append(f'<h5 class="mz-jc-abstract-label">{H.escape(lm.group(1).title(), quote=False)}</h5>'
                              f"<p>{H.escape(lm.group(2).strip(), quote=False)}</p>")
            else:
                blocks.append(f"<p>{H.escape(part, quote=False)}</p>")
        if not any("mz-jc-abstract-label" in b for b in blocks):
            blocks.insert(0, '<h5 class="mz-jc-abstract-label">Abstract</h5>')
        inner = dm.group(2)[:am.start(2)] + "".join(blocks) + dm.group(2)[am.end(2):]
        h = h[:dm.start(2)] + inner + h[dm.end(2):]
        repaired_n += 1

    # 1. deep-dive sections
    applied = 0
    for pmid in man["pmids"]:
        secs = json.load(open(W + f"drafts_dd/{pmid}.json"))
        while isinstance(secs, dict) and set(secs) == {"sections"} or set(secs) == {"blocks"}:
            secs = secs.get("sections") or secs.get("blocks")
        for key, inner in secs.items():
            pat = re.compile(r'(<section class="mz-jc-section" id="dd-%s-%s">)(.*?)(</section>)'
                             % (re.escape(pmid), re.escape(key)), re.S)
            m = pat.search(h)
            if not m:
                continue
            head = re.search(r"<h3[^>]*>(.*?)</h3>", m.group(2), re.S)
            title = re.sub(r'\s*<span class="mz-jc-pending-tag">.*?</span>', "",
                           head.group(1), flags=re.S).strip() if head else HEAD.get(key, key)
            h = h[:m.start()] + m.group(1) + f"<h3>{title}</h3>" + inner.strip() + m.group(3) + h[m.end():]
            applied += 1

    # 2. syntheses and 3. narrative, when present
    syn_n = 0
    if os.path.exists(W + "syntheses.json"):
        for it in json.load(open(W + "syntheses.json"))["items"]:
            if not it.get("html"):
                continue
            st = re.search(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[^>]*>' % re.escape(it["tid"]), h)
            if not st:
                continue
            nxt = re.search(r'<section class="[^"]*\btopic-section\b', h[st.end():])
            seg_end = st.end() + (nxt.start() if nxt else len(h) - st.end())
            m = re.compile(r'<p class="mz-toc-group-synthesis">(.*?)</p>', re.S).search(h, st.end(), seg_end)
            if m:
                h = h[:m.start(1)] + it["html"].strip() + h[m.end(1):]
            else:
                hdr = re.compile(r'<div class="topic-header">.*?</div>\s*</div>', re.S).search(h, st.end(), seg_end)
                if not hdr:
                    continue
                h = h[:hdr.end()] + '<p class="mz-toc-group-synthesis">' + it["html"].strip() + "</p>" + h[hdr.end():]
            syn_n += 1
    if os.path.exists(W + "narrative.json"):
        narr = json.load(open(W + "narrative.json"))["html"].strip()
        nm = re.search(r'(<section class="[^"]*mz-post-narrative[^"]*"[^>]*>)(.*?)(</section>)', h, re.S)
        if nm and ("mz-jc-pending-tag" in nm.group(2) or len(re.sub(r"<[^>]+>", "", nm.group(2)).strip()) < 600):
            h = h[:nm.start(2)] + narr + h[nm.end(2):]
        elif not nm:
            first = re.search(r'<nav class="mz-toc"|<section class="[^"]*\btopic-section\b', h)
            h = h[:first.start()] + '<section class="mz-post-section mz-post-narrative">' + narr + "</section>" + h[first.start():]

    # 4. TOC
    if 'class="mz-toc"' not in h:
        chips = ""
        for m in re.finditer(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="(topic-[^"]+)"[^>]*>(.*?)'
                             r'(?=<section class="[^"]*\btopic-section\b|$)', h, re.S):
            t = re.search(r"<h2[^>]*>(.*?)</h2>", m.group(2), re.S)
            n = len(set(re.findall(r'id="mz-cite-(\d+)"', m.group(2))))
            chips += (f'<a class="mz-toc-chip" href="#{m.group(1)}">'
                      f'{t.group(1).strip() if t else m.group(1)} <span class="mz-toc-chip-count">{n}</span></a>')
        first = re.search(r'<section class="[^"]*\btopic-section\b', h)
        if first and chips:
            h = (h[:first.start()] + '<nav class="mz-toc" aria-label="Jump to a topic">'
                 '<p class="mz-toc-label">Jump to a topic</p>'
                 f'<div class="mz-toc-chips">{chips}</div></nav>' + h[first.start():])

    # 5. light theme at rest, 6. markup hygiene, 7. disclaimer
    src = open(os.path.join(ROOT, "scripts/repost_light_theme.py")).read().rsplit("\nmain()", 1)[0]
    ns: dict = {}
    exec(compile(src, "repost_light_theme", "exec"), ns)
    cv = ns["convert_body"](h)
    h = cv[0] if isinstance(cv, tuple) else cv
    for dark, light in (("rgba(18, 18, 24, 0.97)", "rgba(251,250,248,0.97)"),
                        ("rgba(12, 12, 16, 0.985)", "rgba(251,250,248,0.97)"),
                        ("rgba(8, 8, 12, 0.99)", "rgba(251,250,248,0.99)")):
        h = h.replace(dark, light)
    h = escape_bare_angles(h)
    h = h.replace("(parity with \u00a73.8 trend brief)", "(parity with the trend brief)")
    if "mz-eddisclaimer" not in h:
        m = re.search(r'<ol class="mz-references-list"', h)
        sec = h.rfind("<section", 0, m.start() if m else len(h))
        h = h[:sec] + DISCLAIMER + h[sec:]

    # ---- POST-CONDITIONS. Each of these is a fault that actually shipped. ----
    prose = site_prose(h)
    faults = []
    doses = DOSE_RE.findall(prose)
    if doses:
        faults.append(f"dosing in the site's own prose: {doses[:5]}")
    if re.search(r"Pending[^<]{0,40}review", re.sub(r"<style[\s\S]*?</style>", " ", h)):
        faults.append("a reader-visible 'Pending review' placeholder remains")
    if re.search(r"machine-generated|AI-generated|generated by (?:an )?AI", prose, re.I):
        faults.append("AI-provenance language in reader-visible prose")
    if re.search(r"/Users/beans|CLAUDE\.md|SYSTEM_MAP|\u00a7\s?\d+\.\d+", h):
        faults.append("internal path or spec reference")
    if "mz-eddisclaimer" not in h:
        faults.append("educational disclaimer missing")
    # NOTE: no dark-stylesheet check here. auditPublishable() below already
    # tests this correctly — dark colours inside BACKGROUND declarations. An
    # earlier version of this file flagged any :root block containing
    # `--bg-base: #07070a`, which is a custom-property DEFINITION the light
    # conversion overrides at every use; that rule refused the live, correctly
    # rendering W33. Duplicating a repo check with different semantics is how
    # a pipeline starts blocking good work, so this defers to the one audit.
    for sup in re.findall(r'<sup class="mz-ref">.*?</sup>', h, re.S):
        if "mz-ref-pop-finding" not in sup or "mz-ref-pop-src" not in sup:
            faults.append("a citation popover lacks its summary or source link")
            break
    body_text = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", h)))
    for pmid, abstract in repairs.items():
        # Probe on prose, not on a structured label: apply() renders
        # "INTRODUCTION:" as <h5>Introduction</h5>, so the raw label text is
        # correctly absent from the body. An earlier probe included it and
        # reported a false failure on a repair that had in fact landed.
        prose = re.sub(r"(^|\n)[A-Z][A-Z /&-]{2,40}:\s*", " ", abstract)
        probe = re.sub(r"\s+", " ", prose).strip()[:48]
        if len(probe) >= 24 and probe not in body_text:
            faults.append(f"repaired abstract for {pmid} did not reach the body")
    if faults:
        record(W, "apply", {"failed": "; ".join(faults)})
        for f in faults:
            print("  FAULT:", f)
        die(f"{post_id}: {len(faults)} post-condition(s) failed")

    post["body_html"] = h
    json.dump(post, open(W + f"{post_id}.applied.json", "w"), ensure_ascii=False)
    open(W + "body.applied.html", "w", encoding="utf-8").write(h)

    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs')"
        ".readFileSync('%s','utf8'));const a=m.auditPublishable(p);console.log(JSON.stringify("
        "{publishable:a.publishable,canonical:a.canonical,problems:a.problems}))})"
        % (ROOT, W + f"{post_id}.applied.json")], capture_output=True, text=True, cwd=ROOT)
    verdict = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    print(f"{post_id}: abstracts-repaired={repaired_n} sections={applied} syntheses={syn_n} citations={len(re.findall(chr(60)+'sup class=.mz-ref', h))}")
    print(f"  post-conditions: all passed | auditPublishable: {json.dumps(verdict)}")
    if not verdict.get("publishable"):
        record(W, "apply", {"failed": json.dumps(verdict.get("problems"))[:400]})
        die("the publish audit refused this body")
    record(W, "apply", {"sections": applied, "syntheses": syn_n})
    print(f"  ledger: apply OK — publish may now run for {post_id}")


def cmd_publish(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require(W, "guard"); require(W, "apply")
    body = open(W + "body.applied.html", encoding="utf-8").read()
    json.dump({"body_html": body}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}", "PUT", auth=True, data_file=W + "_put.json")))
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}/approve", "POST", auth=True, data_file=W + "_approve.json")))
    record(W, "publish", {"published": True})


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    {"prepare": cmd_prepare, "pmids": cmd_pmids, "guard": cmd_guard, "apply": cmd_apply, "publish": cmd_publish}.get(sys.argv[1], lambda *_: die(f"unknown stage {sys.argv[1]}"))(sys.argv[2])
