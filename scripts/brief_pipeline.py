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
    brief_pipeline.py curate   <post-id>   # remove papers not about their topic
    brief_pipeline.py author   <post-id>   # write + adversarially verify every missing piece
    brief_pipeline.py pmids    <post-id>   # the authoritative list, never typed by hand
    brief_pipeline.py guard    <post-id>   # lexical wrong-paper screen over drafts
    brief_pipeline.py apply    <post-id>   # assemble + enforce site rules + audit
    brief_pipeline.py publish  <post-id>   # PUT + approve (refuses unless apply passed)

STAGE ORDER MATTERS FOR COST, NOT ONLY CORRECTNESS. Run `prepare` then `curate`
BEFORE any authoring. A deep dive, synthesis or narrative written before curation
describes a set of papers that may not survive it: on W31 ten syntheses were
authored first and three had to be thrown away and rewritten. curate detects and
invalidates them, so nothing wrong ships — but the work is simply wasted.

Stages are independent and idempotent; run `prepare` and `curate` before any agent work.
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
# Work files live INSIDE the repo, gitignored. They were under /tmp, and the
# stage reviewers could not read them — a sandboxed reviewer only sees the
# project. A review that cannot open what it is reviewing is not a review, and
# the first run of this file proved it by refusing outright, which is the
# behaviour to keep.
SCRATCH = os.environ.get("MZ_BRIEF_SCRATCH") or os.path.join(ROOT, ".brief-work")
UA = "mz-operator-tools/1.0 (brief-pipeline)"
ADMIN = os.environ.get("MZ_ADMIN_AUTH", "chris.mabini@gmail.com:MartyBeans!2345")
BASE = "https://www.mountzara.com"

# Lexical wrong-paper screen. Calibrated on 12 known-bad drafts (share
# 0.025-0.25) against 89 sound ones (0.375-0.95): a clean gap, no overlap.
OVERLAP_BLOCK = 0.30
# An abstract in a work file must look like the PMID's real abstract.
ABSTRACT_MATCH_MIN = 0.35
# Sections no author may write: they are the paper's own words or metadata.
NOT_AUTHORABLE = {"abstract", "title"}

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
STAGES = ["prepare", "curate", "author", "guard", "apply", "publish"]

# Every mechanical stage must be READ by an intelligent reviewer before the
# next one runs. This is not belt-and-braces; it is the half of the job the
# checks cannot do. Owner directive 2026-09-15, verbatim: "YOU ARE TO NEVER
# NOT REVIEW AND ASSESS EACH STEP WITH ASSISTANCE — THAT'S HOW STUPID SHIT
# ENDS UP GETTING THROUGH WHEN YOU DON'T ACTUALLY READ AND ANALYZE EVERY STEP."
#
# Everything serious found in the session that produced this file was found by
# reading, not by a rule: four papers written up as a different study, an
# abstract truncated mid-sentence under a "verbatim" label, mouse and in-vitro
# results presented as human findings, a narrative that still said "Pending
# review". No regex expresses any of those. A reviewer does.
#
# The mechanical stage records `<stage>.json`; the reviewer records
# `<stage>.review.json` with a verdict. require() demands BOTH.
REVIEWED_STAGES = ["prepare", "curate", "author", "guard", "apply"]


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
        "curate": [W + "papers", W + "topics"],
        "author": [W + "papers", W + "topics", W + "curation.json"],
        "guard": [W + "papers", W + "drafts_dd", W + "curation.json"],
        "apply": [W + "papers", W + "drafts_dd", W + "manifest.json"],
        "publish": [W + "body.applied.html"] if os.path.exists(W + "body.applied.html") else [W + "manifest.json"],
    }[stage]


def record(W: str, stage: str, extra: dict | None = None) -> None:
    json.dump({"stage": stage, "digest": _digest(stage_inputs(W, stage)),
               "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **(extra or {})},
              open(_receipt_path(W, stage), "w"), indent=1)


def require_review(W: str, stage: str) -> dict:
    """Refuse to proceed unless a reviewer READ this stage's output and passed it."""
    p = W + f".ledger/{stage}.review.json"
    if not os.path.exists(p):
        die(f"stage '{stage}' ran but was never reviewed. Run the {stage} review and record it "
            f"with: brief_pipeline.py record-review <post-id> {stage} <verdict.json>")
    r = json.load(open(p))
    if not r.get("passed"):
        die(f"the {stage} review did not pass: {json.dumps(r.get('problems'))[:400]}")
    now = _digest(stage_inputs(W, stage))
    if r.get("digest") != now:
        die(f"the {stage} review read different inputs (reviewed {r.get('digest')}, now {now}) — review again")
    return r


def cmd_record_review(post_id: str) -> None:
    """Record a reviewer's verdict over a stage. Called after the AI review runs."""
    W = work_dir(post_id)
    stage, path = sys.argv[3], sys.argv[4]
    if stage not in REVIEWED_STAGES:
        die(f"'{stage}' is not a reviewed stage; reviewed stages are {REVIEWED_STAGES}")
    require(W, stage)                      # cannot review a stage that did not run
    v = json.load(open(path))
    if "passed" not in v:
        die("a review verdict must carry an explicit boolean 'passed'")
    v["digest"] = _digest(stage_inputs(W, stage))
    v["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json.dump(v, open(W + f".ledger/{stage}.review.json", "w"), indent=1)
    print(f"  ledger: {stage} review recorded — passed={v['passed']}"
          + (f" | {len(v.get('problems') or [])} problem(s)" if v.get("problems") else ""))


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


# ---------------------------------------------------------------------------
# AI REVIEW — a step of the pipeline, not a thing to remember
# ---------------------------------------------------------------------------
# The mechanical checks catch what could be anticipated and nothing else.
# Everything serious in the session that produced this file was found by
# READING: four papers written up as a different study, an abstract truncated
# mid-sentence under a "verbatim" label, mouse and in-vitro results presented
# as human findings, a narrative still reading "Pending review". No regex
# expresses any of those.
#
# So each stage ends by handing its own output to a reviewer and refusing to
# pass if the reviewer refuses. Making this a step I invoke by hand would be
# the same failure the ledger exists to prevent — the pipeline runs it.
REVIEW_PROMPTS = {
    "prepare": """You are reviewing the PREPARE stage of a clinical brief pipeline for Dr. Mabini's site.
Read {W}manifest.json, then sample AT LEAST 8 files across {W}papers/ (pick a spread, not the first 8)
and 3 across {W}topics/.
Check and report honestly:
 1. Does each paper file's `abstract` actually belong to its `title`/`pmid`? Name any that look like a
    different study, a placeholder, a truncated fragment, or another paper's text.
 2. Is any abstract suspiciously short, or starting mid-way (e.g. at "METHODS:") as if truncated?
 3. Do the topic files group papers coherently under their titles?
 4. Does `pending` list plausible section keys, and is `context` non-empty where it should be?
Do NOT check formatting or style. You are checking whether the GROUND TRUTH the authors will rely on
is sound.
SEVERITY MATTERS. Classify each finding:
 * BLOCKING — the ground truth itself is wrong: an abstract belonging to a different paper, a
   placeholder, a truncated abstract, a title PubMed would not recognise. Authors would write
   falsehoods from it.
 * ADVISORY — the ground truth is correct but the CURATION is loose: an off-topic paper grouped under
   a topic, an over-broad topic. The upstream feed selects papers by keyword, so a brief legitimately
   contains papers that are noise for this practice, and the authored syntheses name that explicitly
   ("most of these are noise for our lane"). Report it; do not block on it.
Reply with ONLY a JSON object:
{{"passed": <true if there are NO blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",

    "author": """You are reviewing the AUTHOR stage of a clinical brief pipeline for Dr. Mabini's site.
Every kept paper should now have a verified journal-club deep dive in {W}drafts_dd/.
Read {W}manifest.json, then sample AT LEAST 6 drafts across {W}drafts_dd/ against their paper files.
Check and report honestly:
 1. Is each draft about the paper in its matching paper file?
 2. Does any draft state a number, population, comparator or outcome absent from that abstract?
 3. Is any design mislabelled — a narrative review called a trial, an animal or in-vitro result written
    as a human/clinical finding?
 4. Any AI/placeholder language, a dose given as advice, "never"/"always" in the clinician's prose?
 5. Does every kept paper in the manifest have a draft, and every live topic a synthesis?
 6. Sample 2 syntheses in {W}syntheses.json: does each cite only papers from its own topic, with a
    takeaway-first finding and a PubMed link in every popover?
SEVERITY: BLOCKING = a draft misrepresents its paper or is missing. ADVISORY = style.
Reply with ONLY a JSON object:
{{"passed": <true if no blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",

    "guard": """You are reviewing the GUARD stage of a clinical brief pipeline for Dr. Mabini's site.
The guard screened each authored draft for lexical overlap with its own paper's abstract.
Read {W}manifest.json and {W}guard_failed.json, then pick AT LEAST 6 drafts from {W}drafts_dd/ (a spread)
and compare each against its paper file in {W}papers/.
Check and report honestly:
 1. Is each draft genuinely ABOUT the paper in its matching paper file? Name any mismatch.
 2. Does any draft state numbers, populations, comparators or outcomes absent from that abstract?
 3. Does any draft mislabel the design — a narrative review called a trial, an animal or in-vitro
    result written as a human/clinical finding?
 4. Does any draft carry AI/placeholder language, a dose given as advice, or "never"/"always" in the
    clinician's own prose?
SEVERITY MATTERS: BLOCKING = the draft misrepresents its own paper (wrong study, invented number,
design mislabelled, preclinical written as clinical, dose as advice, placeholder language).
ADVISORY = stylistic or curation observations.
Reply with ONLY a JSON object:
{{"passed": <true if there are NO blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",

    "curate": """You are reviewing the CURATION decisions for a clinical brief aimed at a complex benign
gynecology / minimally invasive gynecologic surgery practice.
Read {W}curation.json (what was kept and dropped, with reasons) and spot-check against {W}topics/.
Review ONLY those two things. Do NOT read or judge body.applied.html — it is the PREVIOUS assembly and
is rebuilt from these decisions by a later stage, so a mismatch there is expected at this point and is
that stage's post-condition to enforce, not yours.
Check and report honestly:
 1. Was anything DROPPED that a gynecologic surgeon would actually want — an adjacent women's-health
    paper, a basic-science paper genuinely about the topic? A wrong drop silently removes real content.
 2. Was anything KEPT that is plainly about another organ, specialty or population?
 3. Do the stated drop reasons match what those papers are actually about?
 4. Did any topic lose so much that its title now misdescribes what remains?
SEVERITY: BLOCKING = a paper wrongly dropped, or an obviously off-topic paper still kept.
ADVISORY = borderline judgement calls.
Reply with ONLY a JSON object:
{{"passed": <true if no blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",

    "apply": """You are reviewing the ASSEMBLED BODY of a clinical brief before it publishes on Dr. Mabini's site.
Read {W}body.applied.html (it is large — read the opening, the narrative section, 2-3 topic syntheses,
2-3 deep-dive dialogs, and the end).
Check and report honestly:
 1. Any reader-visible placeholder, "Pending review", or text admitting machine generation.
 2. Any dose (mg/mcg/IU) in the SITE'S OWN prose — narrative, synthesis, section intros. Doses are
    allowed ONLY inside a paper's attributed containers (verbatim abstract, deep-dive, cite card).
 3. Every inline citation <sup class="mz-ref"> should carry a title, a finding, and a PubMed link,
    and the finding should be a real takeaway with numbers, not a generic sentence.
 4. Any claim in the narrative or syntheses that overstates its source — preclinical read as clinical,
    an association read as causation, a hedge dropped.
 5. Anything that reads as medical advice to a patient rather than an appraisal of the literature.
 6. Broken markup you can see: unescaped angle brackets in text, an empty section, a truncated abstract.
SEVERITY MATTERS: BLOCKING = anything a reader would see that is false, unsafe, or internal
(placeholder text, dosing in the site's voice, an overstated claim, advice, a broken citation).
ADVISORY = tone, emphasis, or curation.
Reply with ONLY a JSON object:
{{"passed": <true if there are NO blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",
}


def ai_review(W: str, stage: str, timeout_s: int = 900) -> dict:
    """Run the stage's reviewer. Raises if it refuses or cannot be read."""
    prompt = REVIEW_PROMPTS[stage].format(W=W)
    print(f"  reviewing {stage} …", flush=True)
    r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"],
                       capture_output=True, text=True, timeout=timeout_s, cwd=ROOT)
    if r.returncode != 0:
        die(f"{stage} review could not run: {r.stderr.strip()[:200]}")
    try:
        envelope = json.loads(r.stdout)
        text = envelope.get("result") or envelope.get("text") or ""
    except json.JSONDecodeError:
        text = r.stdout
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        die(f"{stage} review returned no JSON verdict: {text[:300]}")
    v = json.loads(m.group(0))
    if "passed" not in v:
        die(f"{stage} review returned no explicit 'passed': {text[:300]}")
    v["digest"] = _digest(stage_inputs(W, stage))
    v["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    os.makedirs(W + ".ledger", exist_ok=True)
    json.dump(v, open(W + f".ledger/{stage}.review.json", "w"), indent=1)
    blocking = v.get("blocking") or ([] if v.get("passed") else (v.get("problems") or []))
    advisory = v.get("advisory") or []
    for prob in blocking[:8]:
        print(f"    BLOCKING: {prob}")
    for prob in advisory[:6]:
        print(f"    advisory: {prob}")
    v["blocking"], v["advisory"] = blocking, advisory
    json.dump(v, open(W + f".ledger/{stage}.review.json", "w"), indent=1)
    if blocking or not v["passed"]:
        die(f"the {stage} review refused this stage ({len(blocking)} blocking problem(s))")
    print(f"  review {stage}: PASSED" + (f" — {len(advisory)} advisory note(s) recorded" if advisory else ""))
    return v


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
            # NEVER authorable: the abstract is the paper's own verbatim text,
            # filled from PubMed by the repair step, and the title is the
            # paper's title. Leaving them in `pending` let an author write a
            # section headed "Verbatim PubMed abstract" — a machine-written
            # abstract presented as the source — and apply then overwrote the
            # real PubMed text with it.
            "pending": [k for k, v in secs.items() if v["pending"] and k not in NOT_AUTHORABLE],
        }

    # --- the check that would have saved 176 agents on W31 ---
    real = fetch_pubmed(sorted(papers))
    repaired, unfetched, mismatched = [], [], []
    repair_reason: dict[str, str] = {}
    for pmid, p in papers.items():
        r = real.get(pmid)
        if not r or len(r["abstract"]) < 80:
            unfetched.append(pmid)
            continue
        # Two distinct faults, and term-overlap only catches the first.
        #  (a) WRONG paper's abstract  -> overlap collapses.
        #  (b) TRUNCATED abstract      -> overlap stays high, because it is the
        #      right paper; only a section is missing. The live W33 shipped one
        #      starting mid-way at "METHODS:" under a "Verbatim PubMed
        #      abstract" heading, and W34 carried another. Length catches it.
        mine_n = re.sub(r"\s+", " ", re.sub(r"^\s*(Verbatim PubMed abstract|Abstract)\s*", "", p["abstract"], flags=re.I)).strip()
        real_n = re.sub(r"\s+", " ", r["abstract"]).strip()
        wrong = share(terms(real_n + " " + r["title"], 30), mine_n) < ABSTRACT_MATCH_MIN
        # compare on the SECTION LABELS PubMed publishes: a missing PURPOSE or
        # BACKGROUND is the exact shape of the truncation seen in production.
        real_labels = {m.group(2).upper() for m in re.finditer(r"(^|\n)([A-Z][A-Z /&-]{2,40}):", real_n)}
        mine_upper = mine_n.upper()
        truncated = bool(real_labels) and any(lab + ":" not in mine_upper for lab in real_labels)
        if wrong or truncated:
            p["abstract"] = r["abstract"][:6000]
            if wrong:
                why = ("the stored brief carried placeholder text in place of an abstract"
                       if re.search(r"pending\s+review|verbatim pubmed abstract\s*$", mine_n, re.I) or len(mine_n) < 200
                       else "the stored brief carried a different paper's abstract")
            else:
                missing = sorted(lab for lab in real_labels if lab + ":" not in mine_upper)
                why = f"the stored brief's abstract was missing its {', '.join(missing[:3])} section"
            p["_abstract_source"] = f"PubMed efetch — {why}"
            repaired.append(pmid)
            repair_reason[pmid] = "wrong paper" if wrong else "truncated"
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
    if repaired:
        from collections import Counter
        why = Counter(repair_reason.values())
        print(f"  abstracts REPAIRED from PubMed: {len(repaired)} ({dict(why)}) e.g. {repaired[:5]}")
    else:
        print("  abstracts REPAIRED from PubMed: 0")
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
    ai_review(W, "prepare")
    print(f"  ledger: prepare OK — authoring may now run for {post_id}")


# ---------------------------------------------------------------------------
# curate — remove papers that are not about the topic they were filed under
# ---------------------------------------------------------------------------
# The upstream feed selects by keyword, so roughly a third of any topic is not
# about that topic: MRgFUS for Parkinson's TREMOR filed under Uterine Fibroids
# because both mention MRgFUS; an endobronchial leiomyoma under the same
# because both say leiomyoma; pediatric congenital adrenal hyperplasia under
# Menopausal Hormone Therapy; six of seven "ICG Fluorescence in Gynecologic
# Surgery" papers that are head-and-neck, glioblastoma, thyroid, liver.
#
# Recording that as an advisory and publishing anyway is the "check that warns"
# this file exists to forbid. A paper that is not about the topic does not
# belong in the topic, so this stage decides, per paper, and the decision is
# executed: the card, the deep dive, the reference entry and the TOC count all
# go. A topic left with nothing goes too.
CURATE_PROMPT = """You are curating one topic of a clinical brief for a complex benign gynecology /
minimally invasive gynecologic surgery (CBG/MIGS) practice.

Read {topic_file}. It has a `title` and a list of `papers`, each with a pmid, title and abstract.

For EACH paper decide whether it belongs under that topic heading for THIS audience — practising
gynecologic surgeons reading a weekly literature brief.

KEEP a paper when it is about the topic in women's health, even if the study is basic science,
preclinical, or an adjacent gynecologic condition. Breadth within the topic is fine.

DROP a paper when it landed here by keyword collision or is about a different organ, specialty or
population entirely — a neurology paper sharing a device name, a lung tumour sharing a histology
word, a paediatric endocrine paper sharing a hormone word, a head-and-neck or hepatobiliary paper
sharing an imaging dye. Being merely tangential is NOT enough to drop; being about something else is.

Be decisive and specific. For every DROP give the reason in one clause naming what the paper is
actually about.

Reply with ONLY a JSON object:
{{"topic": "{tid}", "keep": ["pmid", ...], "drop": [{{"pmid": "...", "reason": "..."}}],
  "retitle": "<a better topic title, ONLY if the kept set no longer matches the current one, else null>"}}"""


def cmd_curate(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    man = json.load(open(W + "manifest.json"))
    decisions, dropped_total, kept_total = {}, 0, 0
    for tid in man["topics"]:
        tf = W + f"topics/{tid}.json"
        t = json.load(open(tf))
        if not t["papers"]:
            decisions[tid] = {"keep": [], "drop": [], "retitle": None}
            continue
        prompt = CURATE_PROMPT.format(topic_file=tf, tid=tid)
        r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"],
                           capture_output=True, text=True, timeout=900, cwd=ROOT)
        if r.returncode != 0:
            die(f"curation of {tid} could not run: {r.stderr.strip()[:200]}")
        try:
            text = json.loads(r.stdout).get("result", "")
        except json.JSONDecodeError:
            text = r.stdout
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            die(f"curation of {tid} returned no JSON: {text[:250]}")
        v = json.loads(m.group(0))
        known = {q["pmid"] for q in t["papers"]}
        keep = [q for q in v.get("keep", []) if q in known]
        drop = [d for d in v.get("drop", []) if d.get("pmid") in known]
        if len(keep) + len(drop) != len(known):
            die(f"curation of {tid} did not account for every paper "
                f"({len(keep)}+{len(drop)} vs {len(known)}) — refusing a partial verdict")
        decisions[tid] = {"keep": keep, "drop": drop, "retitle": v.get("retitle")}
        dropped_total += len(drop); kept_total += len(keep)
        for d in drop:
            print(f"  DROP {d['pmid']} from {tid}: {d['reason'][:88]}")
        # the topic file must reflect the decision, so authors never see a dropped paper
        t["papers"] = [q for q in t["papers"] if q["pmid"] in keep]
        if v.get("retitle"):
            t["retitled_from"], t["title"] = t["title"], v["retitle"]
        json.dump(t, open(tf, "w"), ensure_ascii=False, indent=1)

    # a previous assembly predates these decisions; delete it so nothing —
    # a reviewer, a later stage, or a person — can read it as current
    for stale in (W + "body.applied.html", W + f"{post_id}.applied.json"):
        if os.path.exists(stale):
            os.remove(stale)
    # WHAT WAS DROPPED IS MEASURED AGAINST THE SOURCE POST, NOT AGAINST THE
    # CURRENT TOPIC FILES. curate mutates the topic files, so a second run sees
    # an already-clean set, decides to drop nothing, and — if the drop list
    # were derived from those files — would overwrite curation.json with an
    # empty list and silently un-curate the brief. The stored post is the only
    # stable authority for what the brief started with.
    source = json.load(open(W + f"{post_id}.source.json"))
    source_pmids = list(dict.fromkeys(re.findall(r'<dialog[^>]*id="dd-(\d+)"', source["body_html"])))
    kept_pmids = {q for d in decisions.values() for q in d["keep"]}
    orphans = [q for q in source_pmids if q not in kept_pmids]
    # merge this run's reasons with any recorded earlier, so re-running keeps
    # the explanation for a paper dropped in a previous pass
    prior = json.load(open(W + "curation.json")) if os.path.exists(W + "curation.json") else {}
    for tid, d in (prior.get("decisions") or {}).items():
        merged = {x["pmid"]: x for x in (decisions.get(tid, {}).get("drop") or [])}
        for x in d.get("drop") or []:
            merged.setdefault(x["pmid"], x)
        if tid in decisions:
            decisions[tid]["drop"] = list(merged.values())
    json.dump({"decisions": decisions, "dropped_pmids": orphans},
              open(W + "curation.json", "w"), ensure_ascii=False, indent=1)
    man["pmids"] = [q for q in man["pmids"] if q in kept_pmids]
    man["topics"] = [t for t in man["topics"] if decisions[t]["keep"]]
    json.dump(man, open(W + "manifest.json", "w"), indent=1)
    for q in orphans:
        for f in (W + f"papers/{q}.json", W + f"drafts_dd/{q}.json"):
            if os.path.exists(f):
                os.remove(f)
    # A synthesis written before curation describes a set of papers that no
    # longer exists — it may cite a dropped paper, or belong to a topic that is
    # gone entirely. That is wrong CONTENT, not stale markup, so it is removed
    # here and must be re-authored. Leaving it for apply's post-condition to
    # trip over is how a stage ends up reporting a markup fault for what is
    # really a factual one.
    if os.path.exists(W + "syntheses.json"):
        syn = json.load(open(W + "syntheses.json"))
        live, stale_tids = [], []
        for it in syn.get("items", []):
            html_s = it.get("html") or ""
            if it["tid"] not in man["topics"] or any(q in html_s for q in orphans):
                stale_tids.append(it["tid"])
            else:
                live.append(it)
        if stale_tids:
            syn["items"] = live
            json.dump(syn, open(W + "syntheses.json", "w"), ensure_ascii=False)
            print(f"  invalidated {len(stale_tids)} synthesis/syntheses written pre-curation: {stale_tids}")
    if os.path.exists(W + "narrative.json"):
        narr = json.load(open(W + "narrative.json")).get("html", "")
        if any(q in narr for q in orphans):
            os.rename(W + "narrative.json", W + "narrative.stale.json")
            print("  invalidated the narrative: it cites a paper curation dropped")
    print(f"{post_id}: source had {len(source_pmids)} papers; keeping {len(kept_pmids)}, "
          f"dropping {len(orphans)} off-topic; {len(man['topics'])} topic(s) remain")
    # Content is invalidated by a change of DECISION, not by curate merely
    # running again. Re-running with an identical verdict must not force the
    # re-authoring of work that already matches it — a gate that cries wolf
    # gets worked around, which is worse than no gate.
    import hashlib as _hl
    fingerprint = _hl.sha256(json.dumps(
        {"dropped": sorted(orphans), "topics": sorted(man["topics"])}, sort_keys=True).encode()).hexdigest()[:16]
    marker = W + ".ledger/curate.decisions"
    prior_fp = open(marker).read().strip() if os.path.exists(marker) else None
    if prior_fp != fingerprint:
        open(marker, "w").write(fingerprint)
        print(f"  curation DECISIONS changed ({prior_fp} -> {fingerprint}); content authored earlier is now stale")
    else:
        print(f"  curation decisions unchanged ({fingerprint}); previously authored content stays valid")
    record(W, "curate", {"kept": len(kept_pmids), "dropped": len(orphans), "fingerprint": fingerprint})
    ai_review(W, "curate")
    print(f"  ledger: curate OK — authoring may now run for {post_id}")


# ---------------------------------------------------------------------------
# author — the AI writing, run BY the pipeline
# ---------------------------------------------------------------------------
# Review was already inside every stage. The writing was not: deep dives,
# syntheses and the narrative were produced by launching agents by hand, which
# meant the one part of the process most likely to go wrong was the one part
# with no gate in front of it. That is how W31's syntheses came to be written
# before its paper set was settled, and how two briefs were authored against
# abstracts nobody had checked.
#
# Every piece is now written by this stage and adversarially verified by this
# stage, both through `claude -p`, both required before the next stage runs.
# Nothing is authored outside the chain.

SECTION_SPECS = """
question: two <p> — "<strong>The clinical problem.</strong> …" then "<strong>The question.</strong> …"
pico: <dl> with Population, Intervention / Exposure, Comparator, Outcome, Design; "Not stated in the abstract." where absent
methods: one or two <p> appraising design, sample, analysis AS STATED; grade honestly
strengths: <ul> of 3-5 <li>, each specific and grounded
applicability: one or two <p> — to whom it transfers and to whom it does not
equity: one or two <p> — who is represented; say plainly what is not reported
prompts: <ol> of 3-4 <li>
bottom: one <p>, 2-4 sentences
findings: 2-3 <p> with the abstract's own numbers"""

AUTHOR_RULES = """
VOICE: Dr. Mabini's own journal-club analysis — first-person clinician, DO + complex benign gynecology /
minimally invasive gynecologic surgery lens, direct, no filler.
GROUNDING: every factual claim from the paper's verbatim abstract or its already-filled sections. No
external facts, no invented numbers, populations or demographics. Overstatement AND understatement are
both failures: report a significant result with its numbers; never inflate a narrative review or an
animal study, and never write a preclinical result as a clinical one.
PROHIBITIONS: no AI/disclaimer/placeholder language; no file paths, internal names or section marks; no
dose presented as advice; never the words "never" or "always" in your own prose; write CBG/MIGS, never
bare MIGS.
FORMAT: inner HTML per section only (no <h3>), escape & < >, no markdown."""


def _claude(prompt: str, timeout_s: int = 900, attempts: int = 3) -> dict | None:
    """One model call returning parsed JSON, retried on a transient failure.

    A single unparseable reply used to kill the whole stage: W31's
    topic-pelvic_pain synthesis failed on "verification produced nothing" after
    the other nine had succeeded, discarding the run. Authoring is the expensive
    half of this pipeline; it should not be thrown away because one call came
    back malformed. Genuine refusals are still refusals — this retries only the
    failure to get a usable answer at all.
    """
    last = None
    for attempt in range(attempts):
        try:
            r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"],
                               capture_output=True, text=True, timeout=timeout_s, cwd=ROOT)
        except subprocess.TimeoutExpired:
            last = "timeout"; continue
        if r.returncode != 0:
            last = (r.stderr or "")[:120]; continue
        try:
            text = json.loads(r.stdout).get("result", "")
        except json.JSONDecodeError:
            text = r.stdout
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            last = "no JSON object in reply"; continue
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            last = "malformed JSON"; continue
    print(f"    (model call failed {attempts}x: {last})")
    return None


def _author_one_paper(args_t: tuple) -> tuple:
    W, pmid = args_t
    p = json.load(open(W + f"papers/{pmid}.json"))
    if not p.get("pending"):
        return pmid, None, "no pending sections"
    draft = _claude(f"""Author the pending journal-club sections for one paper in a CBG/MIGS brief.
READ (Read tool): {W}papers/{pmid}.json — "abstract" is the ground truth, "pending" lists the keys to write.
{AUTHOR_RULES}
SECTION SPECS:{SECTION_SPECS}
Return ONLY {{"sections": {{<key>: "<inner html>", …}}}} for exactly the keys in "pending".""")
    if not draft or not draft.get("sections"):
        return pmid, None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored journal-club analysis. Default to REFUTE.
READ {W}papers/{pmid}.json — its "abstract" is the ground truth.
Check for: any number, population, comparator or outcome absent from that abstract; overstatement OR
understatement; a design mislabelled (a narrative review called a trial, an animal or in-vitro result
written as a human finding); AI/placeholder language; a dose given as advice; "never"/"always" in the
clinician's prose; bare "MIGS"; markup not matching the required shape.
If fixable by tightening or deleting an unsupported sentence, return the corrected sections in
fixed_sections with ok=true and problems listing the changes. Otherwise ok=false with problems.
GENERATED: {json.dumps(draft['sections'])[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_sections": {{}}}}""")
    if not verdict:
        return pmid, None, "verification produced nothing"
    if not verdict.get("ok"):
        return pmid, None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:160]}"
    final = dict(draft["sections"]); final.update(verdict.get("fixed_sections") or {})
    final["_verified"] = "adversarial review passed"
    json.dump(final, open(W + f"drafts_dd/{pmid}.json", "w"), ensure_ascii=False)
    return pmid, len(verdict.get("problems") or []), None


SYNTH_RULES = """
WHAT: one synthesis paragraph per topic — the inner HTML of <p class="mz-toc-group-synthesis"> — 1,000
to 2,500 characters of prose in Dr. Mabini's first-person clinician voice (DO + complex benign
gynecology / minimally invasive gynecologic surgery), reading the week's papers on this topic as a
whole, naming studies by first author, giving the actual numbers, and saying what changes on a Monday.
CITATIONS: cite 1 to 4 of the topic's papers INLINE, immediately after the claim each supports, using
EXACTLY this markup with that paper's PMID:
<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-PMID">PMID</a><span class="mz-ref-pop" id="ref-pop-PMID" role="tooltip"><span class="mz-ref-pop-title">TITLE</span><span class="mz-ref-pop-meta">JOURNAL &middot; YEAR</span><span class="mz-ref-pop-finding">FINDING</span><a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>
FINDING: 250-600 characters, TAKEAWAY-FIRST — the clinical conclusion leads, with the paper's own
numbers, then one sentence starting "Monday:" with the concrete implication. Never open with "This
study…". Cite ONLY PMIDs present in the topic file, each at most once.
GROUNDING: every claim and number from that paper's abstract. Overstatement and understatement are both
failures. No dose in your own prose. No AI/placeholder language, paths or section marks. Escape & < >."""


def _author_one_topic(args_t: tuple) -> tuple:
    W, tid = args_t
    draft = _claude(f"""Author the topic synthesis for one topic of a CBG/MIGS "Monday Mornings" brief.
READ (Read tool): {W}topics/{tid}.json — title, and papers[] each with pmid, title, meta, abstract.
{SYNTH_RULES}
Return ONLY {{"html": "<inner html>", "cited": ["PMID", …]}}.""")
    if not draft or not draft.get("html"):
        return tid, None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored evidence synthesis. Default to REFUTE.
READ {W}topics/{tid}.json. Check: every number and claim traceable to that paper's abstract; every cited
PMID present in the topic file and cited at most once; every popover carrying title, meta, a 250-600
character takeaway-first finding ending in a "Monday:" sentence, and the PubMed source link, with
id ref-pop-PMID; no overstatement or understatement; no dose in the clinician's own prose; no
AI/placeholder language, paths or section marks; 1,000-2,500 characters of prose.
If fixable by tightening, deleting an unsupported sentence, or correcting a popover, return fixed_html
with ok=true and problems listing the changes. Otherwise ok=false.
GENERATED: {json.dumps(draft)[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_html": "..."}}""")
    if not verdict:
        return tid, None, "verification produced nothing"
    if not verdict.get("ok"):
        return tid, None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:160]}"
    return tid, {"tid": tid, "html": verdict.get("fixed_html") or draft["html"],
                 "cited": draft.get("cited"), "problems": verdict.get("problems")}, None


NARRATIVE_RULES = """
WHAT: the editorial narrative that opens the brief — the inner HTML of
<section class="mz-post-section mz-post-narrative">: one <h2> titled
"Monday Mornings: <a specific phrase drawn from this week's papers>" followed by 3-4 <p> totalling
2,400-3,400 characters of prose.
VOICE: Dr. Mabini's first person — a DO and complex benign gynecology / minimally invasive gynecologic
surgery surgeon reading the week as a whole. Open on the one paper you keep returning to, read the
others as variations on a structural theme, name studies by first author, close on what changes on a
Monday. Direct, specific, no throat-clearing.
GROUNDING: every study, author, number and finding from the topic files. No external facts.
Overstatement and understatement are both failures — never write a preclinical or animal result as a
human finding. Do NOT use citation markup; the syntheses below carry the citations.
PROHIBITIONS: no AI/disclaimer/placeholder language, no paths or section marks, no dose beyond what an
abstract states. Escape & < >. Return inner HTML only."""


def _author_narrative(W: str, topics: list) -> tuple:
    files = ", ".join(f"{W}topics/{t}.json" for t in topics)
    draft = _claude(f"""Author the cross-topic editorial narrative for one week's CBG/MIGS "Monday Mornings" brief.
READ (Read tool) every one of these topic files: {files}
{NARRATIVE_RULES}
Return ONLY {{"html": "<inner html>"}}.""")
    if not draft or not draft.get("html"):
        return None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored editorial. Default to REFUTE.
READ every topic file: {files}
Check: every study, author, number and finding traceable to a topic file; no overstatement or
understatement; no preclinical or animal result written as a human finding; one <h2> starting
"Monday Mornings:" then 3-4 <p>, 2,400-3,400 characters of prose; no citation markup; no
AI/placeholder language, paths or section marks; no dose beyond the abstracts.
If fixable by tightening or deleting an unsupported sentence, return fixed_html with ok=true and
problems listing the changes. Otherwise ok=false with problems.
NARRATIVE: {json.dumps(draft)[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_html": "..."}}""")
    if not verdict:
        return None, "verification produced nothing"
    if not verdict.get("ok"):
        return None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:200]}"
    return {"html": verdict.get("fixed_html") or draft["html"],
            "problems": verdict.get("problems")}, None


def cmd_author(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "curate");  require_review(W, "curate")
    man = json.load(open(W + "manifest.json"))
    from concurrent.futures import ThreadPoolExecutor

    # A draft file's EXISTENCE is not evidence it was verified. W31's drafts
    # were produced by an earlier, verification-free path; this stage saw the
    # files, skipped them, and reported "all papers have a verified deep dive"
    # when none of them had been through a reviewer. Only a draft this stage
    # stamped counts as verified.
    def _unverified(q: str) -> bool:
        """Incomplete counts as unverified.

        A stamp says a reviewer passed what it was shown; it says nothing about
        whether every section was written. W31 carried a draft stamped verified
        while missing its `methods` and `question` sections entirely, and the
        stage skipped it — leaving two "Pending review" placeholders that only
        apply's post-condition caught, one stage too late.
        """
        path = W + f"drafts_dd/{q}.json"
        if not os.path.exists(path):
            return True
        try:
            d = json.load(open(path))
        except Exception:
            return True
        if not d.get("_verified"):
            return True
        want = {k for k in json.load(open(W + f"papers/{q}.json")).get("pending", [])
                if k not in NOT_AUTHORABLE}
        return bool(want - {k for k in d if not k.startswith("_")})

    todo = [q for q in man["pmids"] if _unverified(q)]
    print(f"{post_id}: {len(todo)} paper(s) to author, {len(man['pmids']) - len(todo)} already written")
    failed = []
    if todo:
        with ThreadPoolExecutor(max_workers=4) as ex:
            for pmid, fixes, err in ex.map(_author_one_paper, [(W, q) for q in todo]):
                if err:
                    failed.append((pmid, err)); print(f"  FAILED {pmid}: {err}")
                else:
                    print(f"  wrote {pmid}" + (f" ({fixes} reviewer correction(s))" if fixes else ""))
    if failed:
        record(W, "author", {"failed": f"{len(failed)} paper(s) could not be authored"})
        die(f"{len(failed)} paper(s) could not be authored: {[f[0] for f in failed][:6]}")

    missing = [q for q in man["pmids"] if _unverified(q)]
    if missing:
        record(W, "author", {"failed": f"missing drafts: {missing[:6]}"})
        die(f"every kept paper needs a VERIFIED deep dive; {len(missing)} unverified or missing")
    print(f"  all {len(man['pmids'])} paper(s) have a verified deep dive")

    # --- syntheses: one per surviving topic ---
    syn_path = W + "syntheses.json"
    syn = json.load(open(syn_path)) if os.path.exists(syn_path) else {"items": []}
    have = {i["tid"] for i in syn["items"] if i.get("html")}
    need = [t for t in man["topics"] if t not in have]
    print(f"  {len(need)} synthesis/syntheses to author, {len(have)} already written")
    syn_failed = []
    if need:
        with ThreadPoolExecutor(max_workers=3) as ex:
            for tid, item, err in ex.map(_author_one_topic, [(W, t) for t in need]):
                if err:
                    syn_failed.append((tid, err)); print(f"  FAILED {tid}: {err}")
                else:
                    syn["items"].append(item)
                    print(f"  wrote {tid}" + (f" ({len(item['problems'] or [])} reviewer correction(s))" if item.get("problems") else ""))
        json.dump(syn, open(syn_path, "w"), ensure_ascii=False)
    if syn_failed:
        record(W, "author", {"failed": f"{len(syn_failed)} synthesis/syntheses failed"})
        die(f"synthesis authoring failed: {[f[0] for f in syn_failed][:6]}")
    still = [t for t in man["topics"] if t not in {i["tid"] for i in syn["items"] if i.get("html")}]
    if still:
        record(W, "author", {"failed": f"topics without a synthesis: {still[:6]}"})
        die(f"every live topic needs a synthesis; missing {still}")
    print(f"  all {len(man['topics'])} topic(s) have a verified synthesis")

    # --- narrative: required when the stored brief carries a stub, and
    # re-authored whenever curation changed what the week actually contains ---
    narr_path = W + "narrative.json"
    t_dec = os.path.getmtime(W + ".ledger/curate.decisions") if os.path.exists(W + ".ledger/curate.decisions") else 0
    # Every Monday-Mornings brief carries a narrative. W31's source had no
    # narrative SECTION at all, so "is it a stub?" answered False and the stage
    # skipped authoring one — the absence of a placeholder is not the presence
    # of an editorial.
    needs_narr = not os.path.exists(narr_path) or os.path.getmtime(narr_path) < t_dec
    if needs_narr:
        print("  authoring the cross-topic narrative")
        item, err = _author_narrative(W, man["topics"])
        if err:
            record(W, "author", {"failed": f"narrative: {err}"})
            die(f"narrative authoring failed: {err}")
        json.dump({"html": item["html"]}, open(narr_path, "w"), ensure_ascii=False)
        print(f"  wrote narrative ({len(item['problems'] or [])} reviewer correction(s))")
    else:
        print("  narrative already current for these curation decisions")
    record(W, "author", {"papers": len(man["pmids"]), "authored_now": len(todo),
                         "topics": len(man["topics"]), "syntheses_now": len(need)})
    ai_review(W, "author")
    print(f"  ledger: author OK — guard may now run for {post_id}")


def require_authored_after_curate(W: str) -> None:
    """Refuse authored content that predates curation.

    Authoring happens outside this file — agents write drafts_dd/, syntheses
    and the narrative — so the ledger cannot gate what it does not run. What it
    CAN do is refuse to consume anything written before the paper set was
    settled. A draft, synthesis or narrative authored earlier may describe a
    paper curation removed, or a topic that no longer exists.

    Documenting the order in a docstring did not stop me getting it wrong on
    W31, where ten syntheses were authored before curation and three had to be
    thrown away. A comment is not a control.
    """
    receipt = _receipt_path(W, "curate")
    if not os.path.exists(receipt):
        die("curate has not run; author nothing until the paper set is settled")
    # Compare against when the DECISIONS last changed, not when curate last ran.
    marker = W + ".ledger/curate.decisions"
    t_curate = os.path.getmtime(marker) if os.path.exists(marker) else os.path.getmtime(receipt)
    stale = []
    for path in [W + "syntheses.json", W + "narrative.json"]:
        if os.path.exists(path) and os.path.getmtime(path) < t_curate:
            stale.append(os.path.basename(path))
    # Deep dives are deliberately NOT time-checked. A deep dive is grounded in
    # one paper's own abstract and says nothing about which other papers share
    # its topic, so curation cannot invalidate it — and curate deletes the
    # drafts of papers it dropped, so what remains is by construction a draft
    # of a surviving paper. What IS checked is that correspondence.
    dd = W + "drafts_dd"
    if os.path.isdir(dd):
        kept = set(json.load(open(W + "manifest.json"))["pmids"])
        orphaned = sorted({f[:-5] for f in os.listdir(dd)} - kept)
        if orphaned:
            stale.append(f"draft(s) for paper(s) curation dropped: {orphaned[:5]}")
    if stale:
        die("authored BEFORE curation, so it may describe papers that did not survive: "
            + "; ".join(stale)
            + ". Re-author it, or re-run curate if the paper set is unchanged and you have "
              "confirmed the content matches it.")


def cmd_pmids(post_id: str) -> None:
    """The authoritative list. Never retype one of these by hand."""
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")   # authoritative only once validated AND read
    man = json.load(open(W + "manifest.json"))
    done = {f[:-5] for f in os.listdir(W + "drafts_dd")}
    todo = [p for p in man["pmids"] if p not in done]
    print(json.dumps(todo if "--todo" in sys.argv else man["pmids"]))


def cmd_guard(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "curate");  require_review(W, "curate")
    require(W, "author");  require_review(W, "author")
    require_authored_after_curate(W)
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
    ai_review(W, "guard")
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

# A DOSE is an amount administered. A CONCENTRATION is a measurement — CRP at
# 185.9 mg/L and AMH at 1.98 ng/mL are lab results a brief must be free to
# report. The first version of this rule matched "185.9 mg" inside "185.9 mg/L"
# and flagged a C-reactive protein as dosing. Per-volume units are excluded;
# per-weight and per-time (mg/kg, mg/day) are dosing and stay in.
DOSE_RE = re.compile(
    r"\b\d[\d,.\u2013\u2014-]*\s?(?:mg|mcg|\u00b5g|\u03bcg|IU)\b(?!\s*/\s*(?:L|dL|mL|l|dl|ml))",
    re.I)
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


def excise_paper(h: str, pmid: str) -> str:
    """Remove every trace of one paper from a brief body.

    A paper dropped in curation must leave nothing behind: a lingering deep-dive
    dialog is dead weight in the DOM, a lingering reference is a citation to
    something the brief no longer discusses, and a lingering trigger button is a
    dead click. Order matters — remove the card before the dialog, or the card's
    trigger keeps a dangling aria-controls.
    """
    # cite card (article keyed by id or containing the PMID's trigger)
    for m in list(re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h)):
        if f'mz-cite-{pmid}' in m.group(0) or f"openDeepDive('dd-{pmid}')" in m.group(0) \
           or f"/{pmid}/" in m.group(0):
            h = h[:m.start()] + h[m.end():]
            break
    # deep-dive dialog
    h = re.sub(r'<dialog[^>]*id="dd-%s"[\s\S]*?</dialog>' % re.escape(pmid), "", h)
    # reference-list entry
    h = re.sub(r'<li>(?:(?!</li>)[\s\S])*?%s(?:(?!</li>)[\s\S])*?</li>' % re.escape(pmid), "", h)
    # any inline citation to it (rare — syntheses are written after curation)
    h = re.sub(r'<sup class="mz-ref">(?:(?!</sup>)[\s\S])*?ref-pop-%s(?:(?!</sup>)[\s\S])*?</sup>'
               % re.escape(pmid), "", h)
    return h


def retitle_topics(h: str, decisions: dict) -> str:
    for tid, d in decisions.items():
        if not d.get("retitle"):
            continue
        m = re.search(r'(<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[^>]*>[\s\S]{0,400}?<h2[^>]*>)([\s\S]*?)(</h2>)'
                      % re.escape(tid), h)
        if m:
            h = h[:m.start(2)] + H.escape(d["retitle"], quote=False) + h[m.end(2):]
    return h


def dedupe_popover_ids(h: str) -> str:
    """One PMID cited twice produces two elements with the same id.

    Invalid HTML, and `aria-describedby` resolves to the first match only, so a
    screen reader reading the second citation is handed the wrong paper's
    summary — or the right one by luck. Live W33/W29/W20 each carried several.
    Each <sup> keeps its own id; repeats get a suffix, and the matching
    aria-describedby inside that same <sup> is updated with it.
    """
    seen: dict[str, int] = {}

    def fix(m: re.Match) -> str:
        sup = m.group(0)
        pid = re.search(r'id="(ref-pop-[^"]+)"', sup)
        if not pid:
            return sup
        base = pid.group(1)
        seen[base] = seen.get(base, 0) + 1
        if seen[base] == 1:
            return sup
        uniq = f"{base}-{seen[base]}"
        return sup.replace(f'id="{base}"', f'id="{uniq}"').replace(
            f'aria-describedby="{base}"', f'aria-describedby="{uniq}"')

    return re.sub(r'<sup class="mz-ref">.*?</sup>', fix, h, flags=re.S)


def strip_build_comments(h: str) -> str:
    """Remove build/run-manifest comments from the body.

    A draft carried a trailing HTML comment with run-manifest JSON naming the
    generator and its "legacy auto-draft path". Not rendered, but plain in
    view-source, and the standing directive is that no internal build detail
    appears on any page.
    """
    return re.sub(r"<!--(?:(?!-->)[\s\S])*?"
                  r"(?:run_manifest|blog_generator|auto-draft|generator\"?\s*:|kb_entries_retrieved)"
                  r"(?:(?!-->)[\s\S])*?-->", "", h)


def cmd_apply(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "curate");  require_review(W, "curate")
    require(W, "guard");   require_review(W, "guard")
    require_authored_after_curate(W)
    man = json.load(open(W + "manifest.json"))
    post = json.load(open(W + f"{post_id}.source.json"))
    h = post["body_html"]

    # 0a. excise the papers curation dropped, before anything else touches the body
    curation = json.load(open(W + "curation.json")) if os.path.exists(W + "curation.json") else {}
    dropped = curation.get("dropped_pmids") or []
    for pmid in dropped:
        h = excise_paper(h, pmid)
    h = retitle_topics(h, curation.get("decisions") or {})
    # a topic whose papers all went takes its whole section with it
    for tid, d in (curation.get("decisions") or {}).items():
        if not d["keep"]:
            h = re.sub(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[\s\S]*?(?=<section class="[^"]*\btopic-section\b|<div class="mz-references|<ol class="mz-references-list|$)'
                       % re.escape(tid), "", h)
    # the TOC is rebuilt from what survives, so drop the stale one
    h = re.sub(r'<nav class="mz-toc"[\s\S]*?</nav>', "", h)

    # 0. repaired abstracts. prepare() fixes the WORK FILE so authoring is
    # grounded correctly; without this step the page keeps showing whatever
    # wrong or truncated text it had. W31 carried a placeholder in all 88, and
    # the live W33 carried one abstract truncated to start at "METHODS:" while
    # labelled "Verbatim PubMed abstract".
    repairs = {}
    if os.path.exists(W + "abstract_repairs.json"):
        repairs = json.load(open(W + "abstract_repairs.json"))
    # a paper curation removed has no dialog to repair into — and must not be
    # re-checked for a landing that is correctly impossible
    repairs = {k: v for k, v in repairs.items() if k not in set(dropped)}
    # Every kept paper's abstract section must carry that paper's real
    # abstract. A brief whose stored abstract was a placeholder has no repair
    # recorded unless prepare replaced it, so fill from the work file, which
    # prepare has already reconciled against PubMed.
    for q in man["pmids"]:
        if q not in repairs:
            pf = W + f"papers/{q}.json"
            if os.path.exists(pf):
                a = json.load(open(pf)).get("abstract") or ""
                if len(a) > 120 and not re.search(r"pending\s+review", a, re.I):
                    repairs[q] = a
    repaired_n = 0
    for pmid, abstract in repairs.items():
        dm = re.search(r'(<dialog[^>]*id="dd-%s"[^>]*>)(.*?)(</dialog>)' % re.escape(pmid), h, re.S)
        if not dm:
            die(f"cannot write the repaired abstract for {pmid}: no dialog")
        am = re.search(r'(<div class="mz-jc-abstract-body">)(.*?)(</div>)', dm.group(2), re.S)
        fallback = None
        if not am:
            # Two brief shapes exist. W33/W34 wrap the abstract in
            # <div class="mz-jc-abstract-body">; W31 has no wrapper at all —
            # the abstract section holds a heading and the "Pending review"
            # placeholder directly. Write into the section body in that case
            # rather than refusing a brief for being the other shape.
            fallback = re.search(
                r'(<section class="mz-jc-section" id="dd-%s-abstract">)(.*?)(</section>)' % re.escape(pmid),
                dm.group(2), re.S)
            if not fallback:
                die(f"cannot write the repaired abstract for {pmid}: no abstract container or section")
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
        if am:
            inner = dm.group(2)[:am.start(2)] + "".join(blocks) + dm.group(2)[am.end(2):]
        else:
            # keep the section's own heading, minus its pending tag
            head = re.search(r"<h3[^>]*>(.*?)</h3>", fallback.group(2), re.S)
            title = re.sub(r'\s*<span class="mz-jc-pending-tag">.*?</span>', "",
                           head.group(1), flags=re.S).strip() if head else "Verbatim PubMed abstract"
            body_new = f"<h3>{title}</h3>" + '<div class="mz-jc-abstract-body">' + "".join(blocks) + "</div>"
            inner = dm.group(2)[:fallback.start(2)] + body_new + dm.group(2)[fallback.end(2):]
        h = h[:dm.start(2)] + inner + h[dm.end(2):]
        repaired_n += 1

    # 1. deep-dive sections
    applied = 0
    for pmid in man["pmids"]:
        secs = json.load(open(W + f"drafts_dd/{pmid}.json"))
        while isinstance(secs, dict) and set(secs) == {"sections"} or set(secs) == {"blocks"}:
            secs = secs.get("sections") or secs.get("blocks")
        for key, inner in secs.items():
            if key in NOT_AUTHORABLE:
                continue
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
    h = dedupe_popover_ids(h)
    h = strip_build_comments(h)
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
    for pmid in dropped:
        if re.search(r'(dd-%s|mz-cite-%s|ref-pop-%s|pubmed\.ncbi\.nlm\.nih\.gov/%s)'
                     % ((re.escape(pmid),) * 4), h):
            faults.append(f"dropped paper {pmid} still appears in the body")
    from collections import Counter as _C
    _dupes = {k: v for k, v in _C(re.findall(r'id="(ref-pop-[^"]+)"', h)).items() if v > 1}
    if _dupes:
        faults.append(f"duplicate popover ids remain: {list(_dupes)[:4]}")
    if re.search(r"<!--(?:(?!-->)[\s\S])*?(?:run_manifest|blog_generator|auto-draft)", h):
        faults.append("a build/run-manifest comment remains in the body")
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
    print(f"{post_id}: dropped={len(dropped)} abstracts-repaired={repaired_n} sections={applied} syntheses={syn_n} citations={len(re.findall(chr(60)+'sup class=.mz-ref', h))}")
    print(f"  post-conditions: all passed | auditPublishable: {json.dumps(verdict)}")
    if not verdict.get("publishable"):
        record(W, "apply", {"failed": json.dumps(verdict.get("problems"))[:400]})
        die("the publish audit refused this body")
    record(W, "apply", {"sections": applied, "syntheses": syn_n})
    ai_review(W, "apply")
    print(f"  ledger: apply OK — publish may now run for {post_id}")


def cmd_publish(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "guard");   require_review(W, "guard")
    require(W, "apply");   require_review(W, "apply")
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
    {"prepare": cmd_prepare, "curate": cmd_curate, "author": cmd_author, "pmids": cmd_pmids, "guard": cmd_guard, "apply": cmd_apply, "publish": cmd_publish, "record-review": cmd_record_review}.get(sys.argv[1], lambda *_: die(f"unknown stage {sys.argv[1]}"))(sys.argv[2])
