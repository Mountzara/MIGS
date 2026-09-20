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
    brief_pipeline.py run      <post-id>   # the whole chain with bounded repair — what the weekly routine calls
    brief_pipeline.py standards-check -    # review THIS file's rules and gates against THE STANDARDS;
                                           # publish refuses without a passing receipt for this version

STAGE ORDER MATTERS FOR COST, NOT ONLY CORRECTNESS. Run `prepare` then `curate`
BEFORE any authoring. A deep dive, synthesis or narrative written before curation
describes a set of papers that may not survive it: on W31 ten syntheses were
authored first and three had to be thrown away and rewritten. curate detects and
invalidates them, so nothing wrong ships — but the work is simply wasted.

Stages are independent and idempotent; run `prepare` and `curate` before any agent work.
"""
from __future__ import annotations
from typing import NoReturn
import html as H
import datetime
import json
import os
import re
import re as _re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_brief_routes import route_for as _route_for  # noqa: E402

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


class Refused(SystemExit):
    """A stage refused. Carries the reason so `run` can repair and retry."""
    def __init__(self, msg: str):
        super().__init__(2)
        self.msg = msg


def die(msg: str) -> NoReturn:
    print(f"REFUSED: {msg}", file=sys.stderr)
    raise Refused(msg)


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
            f"— run the stage; its reviewer produces the verdict")
    r = json.load(open(p))
    if not r.get("passed"):
        die(f"the {stage} review did not pass: {json.dumps(r.get('problems'))[:400]}")
    now = _digest(stage_inputs(W, stage))
    if r.get("digest") != now:
        die(f"the {stage} review read different inputs (reviewed {r.get('digest')}, now {now}) — review again")
    return r


# cmd_record_review REMOVED (2026-09-15). It let any caller write a stage's
# review verdict by hand — `record-review <post-id> <stage> <verdict.json>` with
# {"passed": true} — and require_review() could not tell that from a verdict
# ai_review() actually obtained from the model. A reviewer that can be written
# by the thing being reviewed is not a reviewer. Every stage verdict is now
# produced only inside ai_review().

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
 6. Sample 2 syntheses in {W}syntheses.json: does each cite EVERY paper in its topic file (compare the
    PMIDs cited against the topic file's papers — an uncited paper is BLOCKING), only papers from its
    own topic, with a takeaway-first finding and a PubMed link in every popover? Does the narrative /
    editorial cite the studies it names?
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
Read {W}body.applied.html (it is large — read the opening, EVERY prose section by its heading (weekly:
the narrative and every topic synthesis; trend: opening, bottom line, shape of the evidence, every
item subsection, lens, where the two sides can meet, gaps, closing), a sample of cite cards, 2-3
deep-dive dialogs, the reference list, and the end).
Check and report honestly:
 1. Any reader-visible placeholder, "Pending review", or text admitting machine generation.
 2. NOT dosing — these are clinician-facing briefs and a study's doses belong in them. Flag instead
    any dose stated as a recommendation TO A PATIENT rather than as what a study administered.
 3. Every inline citation <sup class="mz-ref"> should carry a title, a finding, and a PubMed link,
    and the finding should be a real takeaway with numbers, not a generic sentence.
 4. Any claim in the narrative or syntheses that overstates its source — preclinical read as clinical,
    an association read as causation, a hedge dropped.
 5. Anything that reads as medical advice to a patient rather than an appraisal of the literature.
 6. Broken markup you can see: unescaped angle brackets in text, an empty section, a truncated abstract.
 7. CITATIONS, the standard form: every inline marker is a superscript NUMBER (1, 2, 3 …) in order of
    first appearance — never a PMID as the visible marker; the reference list is numbered in that same
    order; every paper the brief covers is cited at least once in the prose (narrative, syntheses,
    editorial), not only listed at the end; each marker's hover popover carries the study's summary
    and a link to the study.
SEVERITY MATTERS: BLOCKING = anything a reader would see that is false, unsafe, or internal
(placeholder text, dosing in the site's voice, an overstated claim, advice, a broken citation, a PMID
shown as a marker, a paper cited nowhere).
ADVISORY = tone, emphasis, or curation.
Reply with ONLY a JSON object:
{{"passed": <true if there are NO blocking problems>, "blocking": ["..."], "advisory": ["..."],
  "problems": ["..."], "notes": "one or two sentences"}}""",
}



# ---------------------------------------------------------------------------
# THE STANDARDS — what the owner requires of every published brief
# ---------------------------------------------------------------------------
# Written down ONCE, here, in reader-facing terms. Every reviewer in this
# pipeline is handed this list in addition to its stage prompt, and is told
# that an unmet standard is blocking even when the stage's own checks passed.
# Why: the reviewers used to judge each stage against MY prompt for that
# stage, so when the prompt was wrong (a PMID as the citation marker; "cite 1
# to 4 papers"; "no citation markup in the narrative") they passed a wrong
# specification faithfully and two briefs shipped that way. A review that
# can only confirm my instructions cannot catch my instructions.
# `standards-check` turns the same list on this file itself.

STANDARDS = """
THE STANDARDS (owner's requirements; each is BLOCKING when unmet):
 S1  Every factual claim in the site's flowing prose — narrative, editorial, topic syntheses, item
     subsections — carries an inline citation placed right after it. A cite card and a deep-dive
     dialog are one paper's own attributed containers: they carry that paper's title, meta line, link
     to the study and deep-dive trigger instead of an inline marker, and every claim in them must be
     supported by that paper.
 S2  On the PUBLISHED page, citation markers are sequential superscript NUMBERS (1, 2, 3 …) in order of
     first appearance; the same paper keeps its number wherever it recurs. A PMID, author-year or
     anything else as the visible marker fails. (Authors write the PMID into the marker because it is
     the identifier they can get right; the pipeline renumbers deterministically before publication and
     refuses any marker still showing a PMID. The requirement is on what a reader sees.)
 S3  Every marker is hoverable (and tappable) and shows a plain-language summary of that study's finding
     and its relevance, with a link to the study; the marker itself resolves to the numbered reference.
 S4  The reference list is numbered in citation order and contains exactly the cited papers; every paper
     the brief covers is cited in the prose at least once — none is merely listed.
 S5  Every study's abstract is reproduced in its deep dive verbatim and complete, as PubMed gives it.
 S6  Every claim is grounded in the cited abstract — no overstatement, no understatement, no preclinical
     or animal result presented as a human finding, no invented numbers or populations.
 S7  Dosing belongs to the reader. These briefs are CLINICIAN-facing journal club material, so a
     study's doses are legitimate clinical detail anywhere in them — synthesis, narrative, card,
     deep dive. The prohibition is on the PATIENT-facing surfaces: the home page and the educational
     materials, which must carry no dosing at all. (Owner, 2026-09-16: "these briefs can have dosing
     — the patient facing home page and educational materials should not.")
 S8  A clear educational disclaimer; nothing that reads as medical advice to a patient.
 S9  No internal paths, spec references, build comments, AI-provenance language or placeholders visible.
 S10 Terminology: "CBG/MIGS", never bare "MIGS"; no "never"/"always" in the clinician's own prose.
 S11 Papers are on-topic for the heading they sit under (keyword collisions removed), and a heading with
     nothing under it does not exist.
 S12 Weekly briefs carry the editorial spine: an opening narrative, a synthesis paragraph above each
     topic's cards, a jump-to-topic TOC, the reference list.
 S13 Trend briefs carry NO verdict gauge and no "verdict", "debunk", "myth" language; clear headlines and
     subheadlines; one framing label per item from the fixed list; a "Where the two sides can meet"
     section; a tone the person who made the claim could read and learn from.
 S16 Every transformation of a body is READ BACK by a model against these requirements before it
     publishes, on the actual output, and a blocking defect refuses it. A deterministic check tests
     what its author thought to test; the checks in this file passed a chip pointing at a removed
     heading, an id colliding with its own suffix, a marker inside a noun phrase and a withdrawal
     that removed fifteen correct citations. Owner, 2026-09-19: "YOU ARE RESPONSIBLE TO MAKE SURE
     YOUR REGEX AND HEURISTIC CODE DIDN'T MAKE MISTAKES."
 S15 Every study has a full journal-club deep dive with every section authored — no "Pending review",
     no placeholder, no empty section.
 S14 The brief renders on the site's paper background with readable contrast — measured on the rendered
     page (near-invisible-text and pixel-contrast gates on the published route, unpublishing on failure) —
     and the page shows no duplicate element ids.
"""

# WHICH STAGE OWES WHICH STANDARD. A reviewer handed the whole list will block
# on a standard its stage cannot possibly meet yet: W31's prepare review refused
# because the topic files still held off-topic papers — which is exactly what
# `curate` removes, one stage later. A gate that refuses work for not having
# done a later stage's job stops the pipeline without improving anything. So
# each reviewer is told what is IN SCOPE now and what a later stage enforces;
# `apply` reviews the finished body and owns all of them.
STAGE_STANDARDS = {
    "prepare": ["S5"],                     # the abstracts, not the writing
    "curate":  ["S11"],
    "author":  ["S1", "S3", "S6", "S7", "S8", "S10", "S13", "S15"],
    "guard":   ["S6"],
    # S14's contrast half is a rendered-page property; a text reader cannot see
    # it, and asking one to certify it is the same spec/capability mismatch the
    # S3 check had. verify_rendered measures both after publish and unpublishes
    # on failure, so they are enforced — just not from this text.
    "apply":   [f"S{i}" for i in range(1, 17) if i not in (3, 14)],
}
RENDERED_ONLY = {"S3": "hover and tap behaviour", "S14": "contrast on the rendered page"}


def stage_addendum(stage: str) -> str:
    own = STAGE_STANDARDS.get(stage, [])
    later = [f"S{i}" for i in range(1, 17) if f"S{i}" not in own]
    mine = {k: v for k, v in RENDERED_ONLY.items() if k in own}
    rendered = ("\nMEASURED ON THE RENDERED PAGE after publish, not from this text — do not block on "
                "them here: " + "; ".join(f"{k} ({v})" for k, v in mine.items()) + "." if mine else "")
    scope = (f"\nIN SCOPE AT THIS STAGE (block on these): {', '.join(own)}." + rendered
             + (f"\nENFORCED BY A LATER STAGE — report as advisory, DO NOT block: {', '.join(later)}."
                if later else "\nEVERY standard is in scope: this is the finished body.")
             + "\n")
    return STANDARDS_ADDENDUM + scope


STANDARDS_ADDENDUM = """

INDEPENDENT OF THE CHECKS ABOVE: also judge this stage's output against THE STANDARDS below. They are the
owner's requirements, not the pipeline's own instructions. If the stage's instructions and a standard
disagree, THE STANDARD WINS. List each unmet standard by its number — in "blocking" when the standard
is in scope at this stage, in "advisory" when a later stage enforces it.
""" + STANDARDS


def _sha_file(path: str) -> str:
    import hashlib
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def standards_audit(W: str, post_id: str) -> None:
    """A reader's audit of the assembled body against THE STANDARDS alone.

    Separate from the apply review on purpose: that review carries the
    stage's checklist and can inherit its blind spots. This one is given
    nothing but the standards and the page.
    """
    kind = "trend" if json.load(open(W + "manifest.json")).get("format") == "trend" else "weekly"
    prompt = f"""You are auditing a published-ready clinical brief ({kind} brief) for Dr. Mabini's site, as a
careful reader would. Read {W}body.applied.html — every section under every heading (nothing on the
page is out of scope: opening, narrative or editorial, EVERY topic synthesis or item subsection, the
shape-of-evidence section, the cite cards, the reference list) and at least two deep-dive dialogs.
{STANDARDS}
For EACH standard S1-S16 (S12 applies to weekly briefs only, S13 to trend briefs only) report whether
the page meets it, with the evidence you saw (quote a marker, a sentence, an id). Be adversarial: look
for the case that fails, not the case that passes.
EXCEPT: """ + "; ".join(f"{k} ({v})" for k, v in RENDERED_ONLY.items()) + """ — these are properties of
the RENDERED page, which you are not looking at. Report them as "met": null with a note; do not fail
the audit on them. A browser measures both before this body is allowed to publish.
Reply with ONLY a JSON object:
{{"passed": <true only if every applicable standard is met>,
  "standards": {{"S1": {{"met": true|false, "evidence": "..."}}, ... "S16": {{...}}}},
  "blocking": ["S<n>: what fails, with evidence", ...], "notes": "one or two sentences"}}"""
    v = _claude(prompt, timeout_s=1200)
    if not v or "passed" not in v:
        die("standards audit returned no verdict")
    blocking = v.get("blocking") or []
    unmet = [k for k, r in (v.get("standards") or {}).items()
             if isinstance(r, dict) and r.get("met") is False and k not in RENDERED_ONLY]
    blocking = [b for b in blocking
                if not (set(re.findall(r"\bS(?:1[0-6]|[1-9])\b", str(b))) and
                        set(re.findall(r"\bS(?:1[0-6]|[1-9])\b", str(b))) <= set(RENDERED_ONLY))]
    out = {"digest": _sha_file(W + "body.applied.html"), "passed": bool(v.get("passed")) and not blocking and not unmet,
           "blocking": blocking, "unmet": unmet, "standards": v.get("standards"), "notes": v.get("notes")}
    json.dump(out, open(W + ".ledger/apply.standards.json", "w"), indent=1, ensure_ascii=False)
    for b in blocking:
        print(f"    STANDARD NOT MET: {b}")
    if not out["passed"]:
        die(f"standards audit refused the body ({len(blocking) or len(unmet)} standard(s) unmet)")
    print("  standards audit: every applicable standard met")


def require_standards(W: str) -> None:
    path = W + ".ledger/apply.standards.json"
    if not os.path.exists(path):
        die("no standards audit on record for this body — run apply")
    r = json.load(open(path))
    if not r.get("passed"):
        die("the standards audit did not pass this body")
    if r.get("digest") != _sha_file(W + "body.applied.html"):
        die("the standards audit is for a different body than the one on disk — run apply")
    g = W + ".ledger/apply.grounding.json"
    gr = json.load(open(g)) if os.path.exists(g) else {}
    if not gr or gr.get("faults") or gr.get("digest") != _sha_file(W + "body.applied.html"):
        die("no passing sentence-level grounding audit on record for THIS body — run apply")


def spec_receipt_path() -> str:
    d = os.path.join(SCRATCH, "_standards")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, _sha_file(os.path.abspath(__file__)) + ".json")


def require_spec_review() -> None:
    """Publishing requires that THIS version of the pipeline has been reviewed
    against the standards. Any edit to the file changes its digest and voids
    the receipt, so a rule cannot be changed and used without being checked."""
    path = spec_receipt_path()
    if not os.path.exists(path):
        die("this version of brief_pipeline.py has not been reviewed against THE STANDARDS — run: brief_pipeline.py standards-check -")
    r = json.load(open(path))
    if not r.get("passed"):
        die("the standards-check of this version of the pipeline found gaps — fix them, then re-run standards-check")


def cmd_standards_check(_: str) -> None:
    """Review the pipeline's own rules and gates against THE STANDARDS."""
    me = os.path.abspath(__file__)
    prompt = f"""You are reviewing a deterministic publishing pipeline against the requirements it must enforce.
Read {me} in full. It authors, verifies, assembles and publishes clinical briefs; the AI prompts it
sends are string constants (SECTION_SPECS, SYNTH_RULES, TREND_SYNTH_RULES, NARRATIVE_RULES, CARD_RULES,
TREND_EDITORIAL_PARTS, REVIEW_PROMPTS, the verification prompts inside _author_* functions), and its
mechanical gates are the post-conditions in finish_and_audit and the site audit it calls.
{STANDARDS}
For EACH standard, name (a) the authoring instruction that tells an author to meet it, (b) the
deterministic check that refuses a body that does not, and (c) the reviewer prompt that checks it.
A standard with no (b) is a GAP. An instruction that CONTRADICTS a standard is a GAP. A check that is
weaker than the standard (checks presence but not correctness, checks one place but not all) is a GAP.
For a standard that is semantic (whether a claim is supported, whether a sentence is advice, whether a
paper is on-topic), (b) is satisfied ONLY by a model audit that the code applies to EVERY unit
(sentence, paper) with a per-unit verdict and a deterministic refusal on any failing verdict — a
regex allowlist alone does not satisfy it, and a single sampling review does not either.
Be adversarial and concrete: quote the line. Do not credit a comment or a docstring as enforcement.
Reply with ONLY a JSON object:
{{"passed": <true only if no gaps>, "gaps": ["S<n>: <what is missing or contradicts>, <where>"],
  "coverage": {{"S1": {{"instruction": "...", "check": "...", "review": "..."}}, ...}}, "notes": "..."}}"""
    v = _claude(prompt, timeout_s=1500)
    if not v or "passed" not in v:
        die("standards-check returned no verdict")
    gaps = v.get("gaps") or []
    out = {"file_digest": _sha_file(me), "passed": bool(v.get("passed")) and not gaps, "gaps": gaps,
           "coverage": v.get("coverage"), "notes": v.get("notes")}
    json.dump(out, open(spec_receipt_path(), "w"), indent=1, ensure_ascii=False)
    for g in gaps:
        print(f"  GAP: {g}")
    if not out["passed"]:
        die(f"standards-check found {len(gaps)} gap(s) in this version of the pipeline")
    print("  standards-check: every standard has an instruction, a deterministic check and a review")


def ai_review(W: str, stage: str, timeout_s: int = 900) -> dict:
    """Run the stage's reviewer. Raises if it refuses or cannot be read."""
    prompt = REVIEW_PROMPTS[stage].format(W=W) + stage_addendum(stage)
    print(f"  reviewing {stage} …", flush=True)
    # stdin=DEVNULL: under nohup the CLI waits 3s for stdin, warns, and can
    # return nothing — which showed up as "the review returned no verdict"
    r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"], stdin=subprocess.DEVNULL,
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
    # THE SCOPE IS ENFORCED HERE, NOT BY ASKING. The prompt tells each reviewer
    # which standards its stage owns, and the prepare reviewer blocked on S11
    # anyway — correctly observing off-topic papers, at the one stage that
    # cannot remove them, because `curate` runs next. An instruction in a
    # prompt is not a control. A blocking item whose every named standard
    # belongs to a later stage is recorded as advisory: the observation is
    # kept, the stage is not stopped for another stage's job. An item naming
    # no standard is this stage's own finding and still blocks.
    own = set(STAGE_STANDARDS.get(stage, []))
    kept, deferred = [], []
    for item in blocking:
        named = set(re.findall(r"\bS(?:1[0-6]|[1-9])\b", str(item)))
        if named and not (named & own):
            deferred.append(f"[deferred to a later stage: {', '.join(sorted(named))}] {item}")
        else:
            kept.append(item)
    if deferred:
        advisory = list(advisory) + deferred
        blocking = kept
        v["passed"] = not blocking
        print(f"    {len(deferred)} finding(s) deferred — a standard a later stage enforces")
    for prob in blocking[:8]:
        print(f"    BLOCKING: {prob}")
    for prob in advisory[:6]:
        print(f"    advisory: {prob}")
    v["blocking"], v["advisory"] = blocking, advisory
    v["produced_by"] = "ai_review"
    json.dump(v, open(W + f".ledger/{stage}.review.json", "w"), indent=1)
    if blocking or not v["passed"]:
        die(f"the {stage} review refused this stage ({len(blocking)} blocking problem(s))")
    print(f"  review {stage}: PASSED" + (f" — {len(advisory)} advisory note(s) recorded" if advisory else ""))
    return v


def is_trend(post_id: str) -> bool:
    """A trend brief is addressed as trend-<dir>; its server id lives in <dir>/trend.json."""
    return post_id.startswith("trend-")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", H.unescape(text).lower()).strip("_")[:40]


def work_dir(post_id: str) -> str:
    key = post_id.split("-")[-1].lower()
    return os.path.join(SCRATCH, key) + "/"


# ---------------------------------------------------------------------------
# PubMed — the only authority on what a PMID's abstract says
# ---------------------------------------------------------------------------
def fetch_pubmed(pmids: list[str]) -> dict[str, dict]:
    """PubMed facts for every PMID. A chunk that comes back short (a 429,
    a cut-off response) is retried with backoff, and any PMID still missing
    or missing its journal is fetched again on its own — six W33 papers
    once lost their journal lines to one partial response, and the run
    refused to publish for it."""
    out: dict[str, dict] = {}

    def complete(pm):
        r = out.get(pm) or {}
        return bool(r.get("title") and r.get("journal"))

    def one_chunk(chunk):
        r = subprocess.run(
            ["curl", "-sS", "--max-time", "60", "-A", UA,
             "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
             f"?db=pubmed&id={','.join(chunk)}&rettype=abstract&retmode=xml"],
            capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else ""

    def parse(xml):
        for art in re.findall(r"<PubmedArticle>.*?</PubmedArticle>", xml, re.S):
            pm = (re.search(r"<PMID[^>]*>(\d+)</PMID>", art) or [None, ""])[1]
            title = H.unescape(re.sub(r"<[^>]+>", "", (re.search(
                r"<ArticleTitle[^>]*>(.*?)</ArticleTitle>", art, re.S) or [None, ""])[1])).strip()
            parts = []
            for m in re.finditer(r"<AbstractText([^>]*)>(.*?)</AbstractText>", art, re.S):
                lab = (re.search(r'Label="([^"]+)"', m.group(1)) or [None, None])[1]
                body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
                parts.append((lab.upper() + ": " if lab else "") + body)
            # The journal and year a reader sees are factual claims like any
            # other and were never fetched, so nothing could check them: the
            # popover's meta line was free text the author typed, and the
            # reference list came from whatever the stored brief already said.
            ja = re.search(r"<ISOAbbreviation>(.*?)</ISOAbbreviation>", art, re.S)
            jm = re.search(r"<Journal>[\s\S]*?<Title>(.*?)</Title>", art, re.S)
            src = ja or jm
            journal = H.unescape(re.sub(r"<[^>]+>", "", src.group(1))).strip() if src else ""
            ym = (re.search(r"<PubDate>[\s\S]*?<Year>(\d{4})</Year>", art)
                  or re.search(r"<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})</Year>", art)
                  or re.search(r"<PubDate>[\s\S]*?<MedlineDate>(\d{4})", art))
            year = ym.group(1) if ym else ""
            au = re.findall(r"<Author[^>]*>[\s\S]*?<LastName>(.*?)</LastName>[\s\S]*?<Initials>(.*?)</Initials>", art)
            cite = ""
            if au:
                # unescaped like the title: raw XML entities in a surname
                # (Akku&#x15f;) were escaped again on the page and rendered
                # as the literal "&#x15f;"
                cite = ", ".join(f"{H.unescape(a)} {H.unescape(i)}" for a, i in au[:3]) + (" et al." if len(au) > 3 else "")
            if pm and (pm not in out or (title and journal)):
                out[pm] = {"title": title, "abstract": H.unescape("\n".join(parts)).strip(),
                           "journal": journal, "year": year, "authors": cite}

    for i in range(0, len(pmids), 20):
        chunk = pmids[i:i + 20]
        for attempt in range(3):
            parse(one_chunk(chunk))
            if all(complete(q) for q in chunk):
                break
            time.sleep(1.5 * (attempt + 1))
        time.sleep(0.34)
    for q in [q for q in pmids if not complete(q)]:
        for attempt in range(2):
            parse(one_chunk([q]))
            if complete(q):
                break
            time.sleep(2.0)
        time.sleep(0.34)
    return out


# ---------------------------------------------------------------------------
# prepare — extract work files from the stored draft, then REPAIR every
# abstract against PubMed. Nothing downstream may run until this passes.
# ---------------------------------------------------------------------------
def txt(s: str) -> str:
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def reconcile_abstracts(papers: dict) -> tuple:
    """Every abstract is checked against PubMed, the only authority on what a
    PMID says. Returns (repaired, unfetched, mismatched, repair_reason)."""
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
        # the meta line every surface shows, built from PubMed alone
        p["journal"], p["year"] = r.get("journal", ""), r.get("year", "")
        p["meta_verified"] = " \u00b7 ".join(
            x for x in (r.get("authors", ""), r.get("journal", ""), r.get("year", "")) if x)
        # PubMed's text is the abstract for EVERY paper, not only the ones caught
        # as wrong or truncated: a stored abstract sharing enough terms to pass
        # the overlap test could still differ from the source, and "verbatim"
        # means the source text. The repair record stays for the faults found.
        # NO CAP. Capping here truncated the ground truth, so "verbatim and
        # complete" was checked against a copy that was already cut — the one
        # kind of truncation the check could never see.
        p["pubmed_abstract"] = r["abstract"]
        p["abstract"] = r["abstract"]
        if wrong or truncated:
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
    return repaired, unfetched, mismatched, repair_reason


def cmd_prepare(post_id: str) -> None:
    if is_trend(post_id):
        return prepare_trend(post_id)
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
            # A section with no tag but no content is still owed: the tag is one
            # way a section is unwritten, emptiness is another, and only the
            # tagged form used to reach the author.
            body_t = txt(re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", " ", s.group(2)))
            pending = ("mz-jc-pending-tag" in s.group(2) or "Pending Dr. Mabini" in s.group(2)
                       or len(body_t.strip()) < 120)
            secs[s.group(1)] = {"pending": pending, "text": txt(s.group(2))}
        for k in JC_KEYS:
            if k not in secs:
                # a section the dialog does not carry at all is still owed
                secs[k] = {"pending": True, "text": ""}
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

    repaired, unfetched, mismatched, repair_reason = reconcile_abstracts(papers)
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
                        "abstract": papers[q]["abstract"],
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
# TREND BRIEFS — a viral claim checked against the literature
# ---------------------------------------------------------------------------
# Same chain, same gates, same reviewers. What differs is the shape: one claim
# with several items (twelve supplements, say) instead of a week of topics, so
# each item is a topic; a hero with no gauge; and an editorial that presents
# the evidence in plain prose under clear headlines rather than a verdict.
# The purpose of these briefs is to be a reliable source the person who made
# the claim can read and learn from — not to score against them.

FRAMINGS = [
    "Supported by clinical trials",
    "Promising, but not yet shown in people",
    "Not enough evidence to say",
    "The evidence so far points the other way",
    "Studied in a related condition, not this one",
]

BRIDGE_TONE = """
TONE — THIS MATTERS: the reader may be the person who made the claim. Write so they can take something
useful from it. Give the honest framing — where a claim is plausible, where the trials do not support
it as stated, where there is simply not enough evidence — but never sneer, never score points.
Do not use the words "verdict", "debunk", "myth", "false claim", "misinformation" or "influencer" as
a label. Say what the studies found and let the reader weigh it. Credit what the post gets right."""


def supplement_of(design: str) -> str:
    d = re.sub(r"^\[\d+\]\s*[·•]\s*", "", design or "")
    return (re.split(r"\s*[·•]\s*", d)[0] or "").strip() or "General"


def prepare_trend(post_id: str) -> None:
    W = work_dir(post_id)
    for d in ("papers", "topics", "drafts_dd"):
        os.makedirs(W + d, exist_ok=True)
    if not os.path.exists(W + "trend.json"):
        die(f"{W}trend.json missing: it must name queue_id, post_id, title and unit")
    trend = json.load(open(W + "trend.json"))
    for k in ("queue_id", "post_id", "title"):
        if not trend.get(k):
            die(f"trend.json lacks {k}")
    if not os.path.exists(W + "body.healed.html"):
        die(f"{W}body.healed.html missing: the assembled trend body is the source")
    body = open(W + "body.healed.html", encoding="utf-8").read()
    json.dump({"id": trend["post_id"], "kind": "blog", "title": trend["title"], "body_html": body},
              open(W + f"{post_id}.source.json", "w"), ensure_ascii=False)

    dialogs = re.findall(r'<dialog[^>]*id="dd-(\d+)"[^>]*>(.*?)</dialog>', body, re.S)
    if not dialogs:
        die(f"{post_id}: no journal-club dialogs found")
    norm = lambda t: re.sub(r"[^a-z0-9]+", "", H.unescape(re.sub(r"<[^>]+>", "", t)).lower())
    papers: dict[str, dict] = {}
    for pmid, inner in dialogs:
        secs = {}
        for sm in re.finditer(r'<section class="mz-jc-section[^"]*" id="dd-\d+-([a-z_-]+)"[^>]*>(.*?)</section>', inner, re.S):
            h3 = re.search(r"<h3[^>]*>(.*?)</h3>", sm.group(2), re.S)
            secs[sm.group(1)] = {"title": txt(h3.group(1)) if h3 else sm.group(1), "text": txt(sm.group(2))}
        for k in JC_KEYS:
            if k not in secs:
                secs[k] = {"title": HEAD.get(k, k), "text": ""}
        pf = W + f"papers/{pmid}.json"
        old = json.load(open(pf)) if os.path.exists(pf) else {}
        papers[pmid] = {
            "pmid": pmid,
            "title": txt((re.search(r'class="mz-jc-modal-title"[^>]*>(.*?)</h2>', inner, re.S) or [None, ""])[1]) or old.get("title", ""),
            "meta": txt((re.search(r'class="mz-jc-modal-cite"[^>]*>(.*?)</p>', inner, re.S) or [None, ""])[1]) or old.get("cite", ""),
            "design": old.get("design", ""),
            "topic": supplement_of(old.get("design", "")),
            "abstract": old.get("abstract") or old.get("abstract_verbatim") or secs.get("abstract", {}).get("text", ""),
            "context": {},
            "pending": [k for k in secs if k not in NOT_AUTHORABLE],
            "section_titles": {k: v["title"] for k, v in secs.items()},
        }
        # drafts written before this pipeline are keyed by the section's
        # heading text; the section writer keys by the section id
        dp = W + f"drafts_dd/{pmid}.json"
        if os.path.exists(dp):
            d = json.load(open(dp))
            while isinstance(d, dict) and ("blocks" in d or "sections" in d) and isinstance(d.get("blocks") or d.get("sections"), dict):
                d = d.get("blocks") or d.get("sections")
            by_number = dict(zip(range(1, 13), JC_KEYS[1:]))     # "1 · …" is question … "12 · …" is prompts
            out = {}
            for k, v in d.items():
                if not isinstance(v, str):
                    continue
                mnum = re.match(r"\s*(\d{1,2})\s*[·•]", str(k))
                if mnum and int(mnum.group(1)) in by_number:
                    out[by_number[int(mnum.group(1))]] = v
                elif re.match(r"\s*the bottom line", str(k), re.I):
                    out["bottom"] = v
                else:
                    out[k] = v
            json.dump(out, open(dp, "w"), ensure_ascii=False)

    repaired, unfetched, mismatched, repair_reason = reconcile_abstracts(papers)
    for pmid, p in papers.items():
        json.dump(p, open(W + f"papers/{pmid}.json", "w"), ensure_ascii=False, indent=1)

    # one topic per item of the claim, in the order the post names them
    order = [x["supplement"] for x in (json.load(open(W + "brief_context.json")).get("per_supplement") or [])] \
        if os.path.exists(W + "brief_context.json") else []
    groups: dict[str, list] = {}
    for pmid, p in papers.items():
        groups.setdefault(p["topic"], []).append(pmid)
    def rank(name):
        for i, o in enumerate(order):
            if norm(name) in norm(o) or norm(o) in norm(name):
                return i
        return len(order)
    topics = []
    for name in sorted(groups, key=rank):
        tid = "topic-" + slug(name)
        if tid in topics:
            die(f"two items of the claim collide on the id {tid!r}: {name!r}")
        json.dump({"id": tid, "title": name,
                   "papers": [{"pmid": q, "title": papers[q]["title"], "meta": papers[q]["meta"],
                               "abstract": papers[q]["abstract"], "bottom": "", "findings": ""}
                              for q in groups[name]]},
                  open(W + f"topics/{tid}.json", "w"), ensure_ascii=False, indent=1)
        topics.append(tid)

    # deep dives verified before this pipeline existed keep that standing only
    # when the verification record covers them completely
    if os.path.exists(W + "deepdives_final.json"):
        ver = json.load(open(W + "deepdives_final.json"))
        ver = ver if isinstance(ver, list) else next(iter(ver.values()))
        covered = {e["pmid"] for e in ver if e.get("blocks")}
        for pmid in papers:
            dp = W + f"drafts_dd/{pmid}.json"
            if pmid in covered and os.path.exists(dp):
                d = json.load(open(dp))
                if set(papers[pmid]["pending"]) <= {k for k in d if not k.startswith("_")}:
                    d["_verified"] = "adversarial review passed (verify workflow, before this pipeline)"
                    json.dump(d, open(dp, "w"), ensure_ascii=False)

    json.dump({"post_id": post_id, "format": "trend", "kind": "blog", "dir": W,
               "pmids": sorted(papers), "topics": topics, "narrative_is_stub": True,
               "has_toc": False, "trend": trend},
              open(W + "manifest.json", "w"), indent=1, ensure_ascii=False)
    print(f"{post_id}: {len(papers)} papers, {len(topics)} items of the claim")
    if repaired:
        from collections import Counter
        print(f"  abstracts REPAIRED from PubMed: {len(repaired)} ({dict(Counter(repair_reason.values()))})")
    else:
        print("  abstracts REPAIRED from PubMed: 0")
    if mismatched:
        for row in mismatched[:5]:
            print(f"  TITLE MISMATCH {row[0]}: brief={row[1]!r} pubmed={row[2]!r}")
        die(f"{len(mismatched)} paper(s) carry a title PubMed does not agree with")
    if unfetched:
        die(f"could not fetch an abstract for {unfetched[:8]}")
    json.dump({pm: papers[pm]["abstract"] for pm in repaired},
              open(W + "abstract_repairs.json", "w"), ensure_ascii=False)
    record(W, "prepare", {"papers": len(papers), "repaired": repaired, "topics": topics})
    ai_review(W, "prepare")
    print(f"  ledger: prepare OK — curate may now run for {post_id}")


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
# ---------------------------------------------------------------------------
# TOPIC_FIT_RULE — the one definition of "belongs under this heading"
# ---------------------------------------------------------------------------
# This rule was written into two curation prompts separately. When the first
# was corrected to read a heading as a clinical area rather than a literal
# phrase, the second was not, and it went on removing a yoga trial in
# climacteric women, osteoporosis risk after menopause and acupuncture for
# vasomotor symptoms from the menopause section — thirteen papers, caught in
# a dry run. A rule that lives in two places is two rules. It lives here, and
# every judgement of topical fit — both curation passes on a published brief
# and the curation stage of a new one — is handed this text.

TOPIC_FIT_RULE = """
A HEADING NAMES A CLINICAL AREA, NOT A LITERAL PHRASE. "Menopausal Hormone Therapy" is the week's
menopause section: a yoga trial in climacteric women, osteoporosis risk after menopause, acupuncture
for vasomotor symptoms, coffee and vasomotor severity, a menopause questionnaire, a menopause
education programme — all belong there. "C-Section Scar" is caesarean scar and its sequelae.
"Chronic Pelvic Pain" is pelvic pain in women AND ITS CAUSES. Judge each paper against that AREA as
a gynecologist reading a weekly brief would, using the area description from the practice's own
reference library where one is given.

CLINICAL AREAS OVERLAP, AND A PAPER CAN BELONG UNDER TWO HEADINGS AT ONCE. Adenomyosis and
endometriosis are causes of chronic pelvic pain and dysmenorrhoea, so a paper on treating
adenomyosis-related pain belongs under "Adenomyosis" AND under "Chronic Pelvic Pain"; endometriosis,
adenomyosis and fibroids bear on infertility; fibroids and adenomyosis on abnormal uterine bleeding.
That a paper also fits — or already sits under — another heading in this brief is NEVER a reason to
remove it from this one. (Owner, 2026-09-19, on a removal made for exactly that reason:
"adenomyosis can cause pelvic pain — you should know this.")

A HEADING MAY ALSO NAME AN INTERVENTION rather than an area — a supplement ("N-acetylcysteine",
"Pycnogenol"), a drug, a device, a technique. Then the brief's own subject is the condition (the
title says which), and a paper belongs under that heading when it studies THAT intervention in that
condition or its mechanism — a trial, a mechanistic study, a review of it. A paper that reviews
several of the brief's interventions together, or the class as a whole, belongs under whichever one
it covers most, or under a general heading when the brief has one; it is never dropped for spanning
them. A paper about the condition with no bearing on any of the brief's interventions does not
belong.

A PAPER BELONGS when it is about the heading's clinical area in women's health — including
non-pharmacological management, epidemiology, diagnostics, education, health services, basic science
and preclinical work. Breadth within the area is the point of a weekly brief. Adjacency to the
heading's exact words is never a reason to remove it, and when in doubt it stays: a slightly broad
section costs the reader nothing, and removing a paper they should have seen does.

A PAPER DOES NOT BELONG only when one of these is true, and the reason must say which:
  (a) it is about a different organ, specialty, sex or population — prostate cancer, breast surgery
      or breast oncology, a brain tumour, an eyelid, a male cohort, a paediatric cohort;
  (b) it is NOT ABOUT THIS HEADING'S AREA AT ALL and belongs under a different heading in this brief
      instead — a keyword collision, such as "HRT" meaning IVF endometrial preparation under a
      menopause heading. Name that heading exactly. This never applies when the two areas overlap:
      the paper then belongs under both;
  (c) it has no clinical or scientific content for this audience at all — a market analysis,
      hospital administration, a commerce piece.
"""


CURATE_PROMPT = """You are curating one topic of a clinical brief for a complex benign gynecology /
minimally invasive gynecologic surgery (CBG/MIGS) practice.

Read {topic_file}. It has a `title` and a list of `papers`, each with a pmid, title and abstract.

For EACH paper decide whether it belongs under that topic heading for THIS audience — practising
gynecologic surgeons reading a weekly literature brief.

""" + TOPIC_FIT_RULE + """
DROP means the paper does not belong by (a), (b) or (c) above — a neurology paper sharing a device
name, a lung tumour sharing a histology
word, a paediatric endocrine paper sharing a hormone word, a head-and-neck or hepatobiliary paper
sharing an imaging dye. Being merely tangential is NOT enough to drop; being about something else is.

Be decisive and specific. For every DROP give the reason in one clause naming what the paper is
actually about.

Reply with ONLY a JSON object:
{{"topic": "{tid}", "keep": ["pmid", ...], "keep_reasons": {{"pmid": "<one clause: what the paper is about and why it belongs here>", ...}},
  "drop": [{{"pmid": "...", "reason": "..."}}],
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
        area = kb_area_context(W, t["title"])
        prompt = (CURATE_PROMPT.format(topic_file=tf, tid=tid)
                  + "\n\nWHAT THIS AREA COVERS, from the practice's own reference library (ACOG / AAGL / FMIGS / "
                  + "UpToDate) — judge the heading as this defines it:\n" + (area or "(no library entry retrieved)")
                  + "\n" + stage_objections(W, "curate"))
        r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"], stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=900, cwd=ROOT)
        if r.returncode != 0:
            die(f"curation of {tid} could not run: {r.stderr.strip()[:200]}")
        try:
            text = json.loads(r.stdout).get("result", "")
        except json.JSONDecodeError:
            text = r.stdout
        text = re.sub(r"^\s*```(?:json)?|```\s*$", "", (text or "").strip(), flags=re.M)
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            # a reply cut off mid-array is still usable: close what is open
            head = text[text.find("{"):] if "{" in text else ""
            if head:
                trimmed = head.rstrip().rstrip(",")
                for close in ("}]}", "]}", "}}", "}"):
                    try:
                        v = json.loads(trimmed + close)
                        return v
                    except Exception:
                        continue
        if not m:
            die(f"curation of {tid} returned no JSON: {text[:250]}")
        v = json.loads(m.group(0))
        known = {q["pmid"] for q in t["papers"]}
        keep = [q for q in v.get("keep", []) if q in known]
        drop = [d for d in v.get("drop", []) if d.get("pmid") in known]
        if len(keep) + len(drop) != len(known):
            die(f"curation of {tid} did not account for every paper "
                f"({len(keep)}+{len(drop)} vs {len(known)}) — refusing a partial verdict")
        reasons = v.get("keep_reasons") or {}
        missing_r = [q for q in keep if len(str(reasons.get(q, "")).strip()) < 15]
        if missing_r:
            die(f"{tid}: no stated reason for keeping {missing_r[:5]} — every decision is recorded, keep or drop")
        decisions[tid] = {"keep": keep, "keep_reasons": {q: str(reasons[q]).strip() for q in keep},
                          "drop": drop, "retitle": v.get("retitle")}
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

    # CORROBORATION. A curator's keep is a single judgment. A second, independent
    # call — given only the abstracts and the list of the brief's topic titles,
    # not the curator's reasons — must file each kept paper under the same
    # topic; a paper the two do not agree on is dropped, with both answers
    # recorded. Two independent judgments agreeing is the deterministic rule.
    titles = {}
    for tid in man["topics"]:
        tf = W + f"topics/{tid}.json"
        if os.path.exists(tf):
            titles[tid] = json.load(open(tf))["title"]
    _areas = {tid: kb_area_context(W, titles[tid]) for tid in titles}

    def _flat400(x):
        return re.sub(r"\s+", " ", x or "")[:400]
    _area_brief = "\n".join(f"- {titles[t]}: {_flat400(_areas[t])}" for t in titles)
    for tid, d in decisions.items():
        if not d["keep"] or tid not in titles:
            continue
        t = json.load(open(W + f"topics/{tid}.json"))
        # The second opinion covers the DROPS too. Judging only the keeps made
        # the corroboration one-directional: a paper the first pass removed was
        # never re-examined, and four on-topic endometriosis reviews were lost
        # that way on the supplement brief. A drop the second pass assigns to a
        # heading in this brief is restored to it.
        papers_ctx = [{"pmid": q["pmid"], "title": q["title"], "abstract": (q.get("abstract") or "")[:3500]}
                      for q in t["papers"] if q["pmid"] in d["keep"]]
        dropped_ctx = {}
        for x in d.get("drop") or []:
            pfd = W + f"papers/{x['pmid']}.json"
            if os.path.exists(pfd):
                pj = json.load(open(pfd))
                dropped_ctx[x["pmid"]] = {"pmid": x["pmid"], "title": pj.get("title", ""),
                                          "abstract": (pj.get("abstract") or "")[:3500]}
                papers_ctx.append(dropped_ctx[x["pmid"]])
        # CHUNKED. A flat character cut dropped the tail of a large topic's
        # paper list out of the request, so those papers were never independently
        # classified and the corroboration silently covered less than it claimed.
        assignments = {}
        for _i in range(0, len(papers_ctx), 10):
            _batch = papers_ctx[_i:_i + 10]
            _v = _claude(f"""Classify each paper below under ONE of this brief's topic headings, from its title and abstract
alone, for an audience of gynecologic surgeons. Answer with the heading the paper belongs under — which may be a DIFFERENT heading from the one it is
currently filed under; a paper covering several of the headings goes under the one it covers most.
Use "NONE" only when nothing in this brief is about it: a different organ, specialty or population (a
keyword collision). A broad review that spans several of these headings is NOT "NONE".
{TOPIC_FIT_RULE}
TOPIC HEADINGS, each with what its area covers per the practice's reference library:
{_area_brief}
PAPERS: {json.dumps(_batch, ensure_ascii=False)}
Reply with ONLY {{"assignments": {{"<pmid>": "<exact heading or NONE>", ...}}}} with one entry for
EVERY paper given.""", timeout_s=900)
            if not _v or not isinstance(_v.get("assignments"), dict):
                die(f"{tid}: corroboration returned no verdict")
            _missing = [x["pmid"] for x in _batch if x["pmid"] not in _v["assignments"]]
            if _missing:
                die(f"{tid}: corroboration skipped {_missing[:5]}")
            assignments.update(_v["assignments"])
        v = {"assignments": assignments}
        here = titles[tid]
        # A disagreement about WHICH heading is a filing error, not a reason to
        # lose the paper: it moves to the heading the second pass named. Only
        # "NONE" — nothing in this brief is about it — drops it. The first run
        # deleted four on-topic endometriosis reviews for being filed under the
        # wrong supplement, and the curate reviewer refused the stage for it.
        moved, disagreed = [], []
        by_title = {tt: ti for ti, tt in titles.items()}
        # a drop the second pass files under one of this brief's headings is
        # restored there — the first pass was wrong to remove it
        for q, rec_d in dropped_ctx.items():
            got = str(v["assignments"].get(q, "")).strip()
            dest = by_title.get(got)
            if not dest:
                continue
            d["drop"] = [x for x in d["drop"] if x["pmid"] != q]
            dd = decisions.setdefault(dest, {"keep": [], "keep_reasons": {}, "drop": [], "retitle": None})
            if q not in dd["keep"]:
                dd["keep"].append(q)
                dd["keep_reasons"][q] = f"restored: an independent classification filed it under {got!r}"
            dt = json.load(open(W + f"topics/{dest}.json"))
            if all(x["pmid"] != q for x in dt["papers"]):
                pj = json.load(open(W + f"papers/{q}.json"))
                dt["papers"].append({"pmid": q, "title": pj.get("title", ""), "meta": pj.get("meta", ""),
                                     "abstract": pj.get("abstract", ""), "bottom": "", "findings": ""})
                json.dump(dt, open(W + f"topics/{dest}.json", "w"), ensure_ascii=False, indent=1)
            print(f"  RESTORE {q}: dropped from {tid}, filed under {dest} by the second pass")
        for q in list(d["keep"]):
            got = str(v["assignments"].get(q, "")).strip()
            if got == here:
                continue
            dest = by_title.get(got)
            if dest and dest != tid:
                moved.append((q, dest, got))
            else:
                disagreed.append({"pmid": q, "reason": "independent classification found no heading in this brief that it belongs under"})
        for q, dest, got in moved:
            rec = next((x for x in t["papers"] if x["pmid"] == q), None)
            d["keep"].remove(q); d["keep_reasons"].pop(q, None)
            dd = decisions.setdefault(dest, {"keep": [], "keep_reasons": {}, "drop": [], "retitle": None})
            if q not in dd["keep"]:
                dd["keep"].append(q)
                dd["keep_reasons"][q] = f"moved from {here!r}: independent classification filed it under {got!r}"
            if rec:
                dt = json.load(open(W + f"topics/{dest}.json"))
                if all(x["pmid"] != q for x in dt["papers"]):
                    dt["papers"].append(rec)
                    json.dump(dt, open(W + f"topics/{dest}.json", "w"), ensure_ascii=False, indent=1)
            print(f"  MOVE {q}: {tid} -> {dest} (independent classification said {got!r})")
        if disagreed:
            for x in disagreed:
                d["keep"].remove(x["pmid"]); d["keep_reasons"].pop(x["pmid"], None); d["drop"].append(x)
                print(f"  DROP {x['pmid']} from {tid}: {x['reason']}")
        if moved or disagreed:
            t["papers"] = [q for q in t["papers"] if q["pmid"] in d["keep"]]
            json.dump(t, open(W + f"topics/{tid}.json", "w"), ensure_ascii=False, indent=1)
        d["corroboration"] = {q: v["assignments"].get(q) for q in papers_ctx and [x["pmid"] for x in papers_ctx]}
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
    json.dump({"decisions": decisions, "dropped_pmids": orphans,
               "removed_topics": [t for t in man["topics"] if not decisions.get(t, {}).get("keep")]},
              open(W + "curation.json", "w"), ensure_ascii=False, indent=1)
    man["pmids"] = [q for q in man["pmids"] if q in kept_pmids]
    # A heading with nothing under it is not a heading. The manifest was pruned
    # but the topic FILE was left on disk, so the next reviewer read a topic
    # with an empty papers list and refused the stage — correctly, and on every
    # retry, because nothing removed the file.
    emptied = [t for t in man["topics"] if not decisions.get(t, {}).get("keep")]
    for t in emptied:
        tf = W + f"topics/{t}.json"
        if os.path.exists(tf):
            os.remove(tf)
        print(f"  TOPIC REMOVED {t}: every paper under it was dropped")
    man["topics"] = [t for t in man["topics"] if decisions.get(t, {}).get("keep")]
    json.dump(man, open(W + "manifest.json", "w"), indent=1)
    # any topic file left from an earlier composition goes too
    for f in os.listdir(W + "topics"):
        tid_f = f[:-5]
        if tid_f not in man["topics"]:
            os.remove(W + "topics/" + f)
            print(f"  TOPIC FILE REMOVED {tid_f}: not part of this composition")
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
        # A synthesis is stale when its topic is gone, when it cites a dropped
        # paper, or when the papers it cites are no longer the papers its topic
        # holds — curation MOVES papers between topics, and a synthesis written
        # before the move cites another topic's paper or misses its own
        # (the trend brief's author review refused for exactly that).
        holds = {}
        for tid in man["topics"]:
            tf = W + f"topics/{tid}.json"
            if os.path.exists(tf):
                holds[tid] = {x["pmid"] for x in json.load(open(tf))["papers"]}
        for it in syn.get("items", []):
            html_s = it.get("html") or ""
            cited = set(re.findall(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})", html_s)) | set(re.findall(r"ref-pop-(\d{5,9})", html_s))
            mine = holds.get(it["tid"], set())
            if (it["tid"] not in man["topics"] or any(q in html_s for q in orphans)
                    or (cited and mine and (cited - mine or mine - cited))):
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
    if os.path.exists(W + ".ledger/curate.objections.json"):
        os.remove(W + ".ledger/curate.objections.json")
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
question: two <p> — "<strong>The clinical problem.</strong> …" then "<strong>The question.</strong> …" State it from the abstract alone — no background claim about current practice that the abstract does not make.
pico: <dl> with Population, Intervention / Exposure, Comparator, Outcome, Design; "Not stated in the abstract." where absent
methods: one or two <p> appraising design, sample, analysis AS STATED; grade honestly. If the
  abstract does not state the design, say so plainly — do not infer one from the journal or the title,
  and do not assert it as fact
strengths: <ul> of 3-5 <li>, each specific and grounded
applicability: one or two <p> — to whom it transfers and to whom it does not, judged ONLY from the
  population the abstract states. Do not invent a population it never addressed: if the paper says
  nothing about surgical, post-operative or CBG/MIGS patients, write plainly that it does not speak
  to them rather than constructing a surgical application for it
equity: one or two <p> — who is represented; say plainly what is not reported
prompts: <ol> of 3-4 <li>
bottom: one <p>, 2-4 sentences. Name the design only if the abstract states it; otherwise write what
  the paper reports without labelling its design
findings: 2-3 <p> with the abstract's own numbers
rob: one or two <p> — what could be wrong with the conclusions, from the design as stated
kb: one or two <p> — how this sits with what was already established, without inventing outside studies
monday: one <p> — change, hold, or counsel: what a CBG/MIGS clinician does with it on Monday"""

AUTHOR_RULES = """
VOICE: Dr. Mabini's own journal-club analysis — first-person clinician, DO + complex benign gynecology /
minimally invasive gynecologic surgery lens, direct, no filler.
GROUNDING: every factual claim from the paper's verbatim abstract or its already-filled sections.
NUMBERS AS STATED: use only figures the abstract itself gives. Do not compute, combine or convert them — no totals you added up, no percentages you worked out, no differences you subtracted. If the abstract says 487 per arm, write 487 per arm, not 974. A number you derived cannot be checked against the paper, and a reader cannot tell which of your figures came from the study. No
external facts, no invented numbers, populations or demographics. Overstatement AND understatement are
both failures: report a significant result with its numbers; never inflate a narrative review or an
animal study, and never write a preclinical result as a clinical one.
PROHIBITIONS: no AI/disclaimer/placeholder language; no file paths, internal names or section marks; no
dose presented as advice.
TERMS: when you name the practice, write "CBG/MIGS", never bare "MIGS" — and only where the paper
actually bears on it. A menopause, sleep or neurology paper needs no mention of the practice at all;
omit it rather than shoehorn it in, because a bare "MIGS" reads as minimally invasive glaucoma surgery.
Do not use the words "never" or "always" in your own prose.
NO ADVICE: appraise the paper; never address a patient ("you should…", "take…", "ask your doctor…").
The Monday, applicability and equity sections drift into this most — write what a clinician weighs,
not what a patient should do.
FORMAT: inner HTML per section only (no <h3>), escape & < >, no markdown, no style attributes or colours."""



def _extract_json(text: str):
    """The first complete JSON object in a reply, however it is wrapped.

    A greedy {.*} match spans from the first brace to the last one, so any
    sentence the model adds after the object breaks the parse — which is what
    "malformed JSON" meant on three placement calls, and it cost two dry runs
    to find because the message did not say what came back. This walks the
    braces, respecting strings and escapes, and also closes an object that was
    cut off mid-array rather than discarding it.
    """
    t = re.sub(r"^\s*```(?:json)?|```\s*$", "", (text or "").strip(), flags=re.M)
    start = t.find("{")
    if start < 0:
        return None
    depth, in_str, esc = 0, False, False
    for i in range(start, len(t)):
        c = t[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1], strict=False)
                except json.JSONDecodeError:
                    break
    # cut off before closing: keep every complete element and shut what is
    # still open. A fixed list of closings knew "}]}" but not "}]]}", so a
    # placement list nested one level deeper was lost three times running.
    frag = t[start:]
    for cut in range(len(frag), 0, -1):
        if frag[cut - 1] not in "}]":
            continue
        head = frag[:cut]
        stack, in_str, esc = [], False, False
        for c in head:
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c in "{[":
                stack.append("}" if c == "{" else "]")
            elif c in "}]":
                if stack:
                    stack.pop()
        if in_str:
            continue
        try:
            return json.loads(head + "".join(reversed(stack)), strict=False)
        except json.JSONDecodeError:
            continue
    # a single-field object whose string value carries an unescaped quote
    # ({"sentence": "… the "live birth" rate …"}): three correction calls on
    # W34 were "no parseable JSON" for that alone
    m = re.match(r'\s*\{\s*"(\w+)"\s*:\s*"([\s\S]*)"\s*\}\s*$', t)
    if m:
        return {m.group(1): m.group(2).replace("\\n", "\n")}
    return None


def _claude(prompt: str, timeout_s: int = 900, attempts: int = 5) -> dict | None:
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
        ask = prompt
        if attempt and last and str(last).startswith("no parseable JSON"):
            # the same prompt truncates the same way; ask for less
            ask = prompt + ("\n\nYour previous reply was cut off or was not valid JSON. Reply with ONLY the JSON "
                            "object, as compactly as possible: no explanations, any free-text field at most six words.")
        try:
            # stdin=DEVNULL: under nohup the CLI waits 3s for stdin it will
            # never get, warns, and can return nothing — which surfaced as
            # "the review returned no verdict" on a brief that was ready
            r = subprocess.run(["claude", "-p", ask, "--output-format", "json"],
                               stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=timeout_s, cwd=ROOT)
        except subprocess.TimeoutExpired:
            last = "timeout"; time.sleep(5 * (attempt + 1)); continue
        if r.returncode != 0:
            # four concurrent runs once failed three times each in the same
            # minute with an empty stderr: a transient outage. Say what came
            # back, and wait before asking again.
            last = f"exit {r.returncode}: {(r.stderr or r.stdout or '')[-160:]!r}"
            time.sleep(10 * (attempt + 1)); continue
        try:
            text = json.loads(r.stdout).get("result", "")
        except json.JSONDecodeError:
            text = r.stdout
        obj = _extract_json(text)
        if obj is None:
            # the whole reply, on disk, so a parse failure can be diagnosed
            # from what actually came back rather than a 200-character prefix
            os.makedirs("/tmp/claude-0", exist_ok=True)
            dump = f"/tmp/claude-0/claude_unparsed_{os.getpid()}_{attempt}.txt"
            open(dump, "w").write(text)
            last = f"no parseable JSON in reply (got: {text[:200]!r}; full reply in {dump})"; continue
        return obj
    print(f"    (model call failed {attempts}x: {last})")
    return None


def draft_rule_faults(sections: dict) -> list:
    """The deterministic site rules, applied to a draft as it is written.

    A draft with "always" in its strengths section reached assembly, was
    refused there, and the repair loop could not tell which paper to rewrite.
    Checking here means the author fixes its own output while it still knows
    what it wrote.
    """
    bad = []
    for key, html_v in sections.items():
        if not isinstance(html_v, str) or key.startswith("_"):
            continue
        t = H.unescape(re.sub(r"<[^>]+>", " ", html_v))
        if re.search(r"\b(?:never|always)\b", t, re.I):
            bad.append(f"{key}: uses never/always")
        if re.search(r"(?<!CBG/)\bMIGS\b", t, re.I):
            bad.append(f"{key}: bare MIGS")
        if ADVICE_RE.search(t):
            bad.append(f"{key}: addresses a patient")
        # NO dose check here. A deep dive and a cite card are the paper's own
        # attributed containers, where S7 permits the study's doses — the ICG
        # bolus of 0.25 mg/kg belongs in the deep dive of the paper that
        # reports it. S7 bars dosing from the site's FLOWING prose, which
        # prose_faults checks on the assembled body.
    return bad


def piece_objection(W: str, pmid: str) -> str:
    """Why the last attempt at THIS paper was refused.

    Stage-level objections reached the stage prompt, but a paper that failed
    verification was simply retried with the identical prompt and produced the
    identical text: an invented "primary endpoint" and a derived "five-year
    window" were refused three rounds running. What the verifier said has to
    reach the author that has to fix it.
    """
    path = W + ".ledger/author.pieces.json"
    if not os.path.exists(path):
        return ""
    why = json.load(open(path)).get(pmid)
    if not why:
        return ""
    items = [x.strip() for x in str(why).split(" || ") if x.strip()]
    return ("\n\nEVERY ONE OF THESE WAS REFUSED IN AN EARLIER ATTEMPT AT THIS PAPER. Fix ALL of them at "
            "once; do not reproduce any of them, and do not trade one for another:\n"
            + "\n".join(f"  - {x}" for x in items))


def record_piece_objection(W: str, pmid: str, why: str) -> None:
    """Accumulate, do not overwrite.

    Recording only the latest refusal meant the author fixed that one and
    reintroduced an earlier one: a derived ten-month duration, then "strong"
    where the abstract says "excellent", round after round. It has to see
    everything that has been refused for this paper.
    """
    path = W + ".ledger/author.pieces.json"
    d = json.load(open(path)) if os.path.exists(path) else {}
    prior = [x.strip() for x in str(d.get(pmid, "")).split(" || ") if x.strip()]
    fresh = why.strip()[:300]
    if fresh and fresh not in prior:
        prior.append(fresh)
    d[pmid] = " || ".join(prior[-6:])
    os.makedirs(W + ".ledger", exist_ok=True)
    json.dump(d, open(path, "w"), indent=1, ensure_ascii=False)


def _author_one_paper(args_t: tuple) -> tuple:
    W, pmid = args_t
    p = json.load(open(W + f"papers/{pmid}.json"))
    if not p.get("pending"):
        return pmid, None, "no pending sections"
    draft = _claude(f"""Author the pending journal-club sections for one paper in a CBG/MIGS brief.
READ (Read tool): {W}papers/{pmid}.json — "abstract" is the ground truth, "pending" lists the keys to write.
{piece_objection(W, pmid)}
{AUTHOR_RULES}
SECTION SPECS:{SECTION_SPECS}
Return ONLY {{"sections": {{<key>: "<inner html>", …}}}} for exactly the keys in "pending".""")
    if not draft or not draft.get("sections"):
        return pmid, None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored journal-club analysis. Default to REFUTE.
READ {W}papers/{pmid}.json — its "abstract" is the ground truth.
Check for: any number that is not stated in the abstract, including one the author computed from figures that are (a total, a percentage, a difference); anything addressed to a patient as advice, in any wording (the Monday, applicability and
equity sections drift into it most); any number, population, comparator or outcome absent from that abstract; overstatement OR
understatement; a design mislabelled (a narrative review called a trial, an animal or in-vitro result
written as a human finding); AI/placeholder language; a dose given as advice; "never"/"always" in the
clinician's prose; bare "MIGS"; markup not matching the required shape.
"CBG/MIGS" is the practice's own name for itself and is correct exactly as written — never ask for it
to be expanded, defined or spelled out, and never refuse a section for using it.
Judge EVERY section separately. If a section is fixable by tightening or deleting an unsupported
sentence, return its corrected html in fixed_sections and mark it ok; a section you cannot fix is
not ok. GENERATED: {json.dumps(draft['sections'])[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_sections": {{}},
  "sections": {{"<key>": {{"ok": true|false, "why": "..."}}, ...}} for every generated key}}""")
    if not verdict:
        return pmid, None, "verification produced nothing"
    if not verdict.get("ok"):
        return pmid, None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:160]}"
    per = verdict.get("sections") or {}
    failing = [k for k in draft["sections"] if not (per.get(k) or {}).get("ok")]
    if failing:
        return pmid, None, f"section(s) not passed by the verifier: {failing[:4]}"
    final = dict(draft["sections"]); final.update(verdict.get("fixed_sections") or {})
    rule_bad = draft_rule_faults(final)
    if not rule_bad:
        pth = W + ".ledger/author.pieces.json"
        if os.path.exists(pth):
            d0 = json.load(open(pth))
            if d0.pop(pmid, None) is not None:
                json.dump(d0, open(pth, "w"), indent=1, ensure_ascii=False)
    if rule_bad:
        return pmid, None, "breaks a site rule: " + "; ".join(rule_bad[:3])
    final["_verified"] = "adversarial review passed"
    json.dump(final, open(W + f"drafts_dd/{pmid}.json", "w"), ensure_ascii=False)
    return pmid, len(verdict.get("problems") or []), None


SYNTH_RULES = """
WHAT: one synthesis paragraph per topic — the inner HTML of <p class="mz-toc-group-synthesis"> — 1,000
to 2,500 characters of prose in Dr. Mabini's first-person clinician voice (DO + complex benign
gynecology / minimally invasive gynecologic surgery), reading the week's papers on this topic as a
whole, naming studies by first author, giving the actual numbers, and saying what changes on a Monday.
CITATIONS: cite EVERY paper in the topic file INLINE — each one at least once, placed immediately after
the claim it supports, the first time that study is discussed. When several papers support one
sentence, place their citations back to back. Write the PMID as the marker text; the pipeline renumbers
markers sequentially (1, 2, 3 …) in order of first appearance and builds the reference list from them.
Use EXACTLY this markup with that paper's PMID:
<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-PMID">PMID</a><span class="mz-ref-pop" id="ref-pop-PMID" role="tooltip"><span class="mz-ref-pop-title">TITLE</span><span class="mz-ref-pop-meta">JOURNAL &middot; YEAR</span><span class="mz-ref-pop-finding">FINDING</span><a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>
FINDING: 250-600 characters, TAKEAWAY-FIRST — the clinical conclusion leads, with the paper's own
numbers, then one sentence starting "Monday:" with the concrete implication. Never open with "This
study…". Cite ONLY PMIDs present in the topic file; every one of them must appear at least once.
LENGTH: 1,000 characters minimum; at most 1,800 plus 150 per paper in the topic.
GROUNDING: every claim and number from that paper's abstract. Overstatement and understatement are both
failures.
NUMBERS AS STATED: use only figures the abstract itself gives. Do not compute, combine or convert them — no totals you added up, no percentages you worked out, no differences you subtracted. If the abstract says 487 per arm, write 487 per arm, not 974. A number you derived cannot be checked against the paper, and a reader cannot tell which of your figures came from the study. No AI/placeholder language, paths or section marks. Escape & < >.
CITE EVERY CLAIM: every sentence that states a study's finding, a number, a population or a comparison
carries the citation of the paper it comes from — not only the first mention of that paper. Cite again
each time the sentence's claim rests on a paper.
TERMS: when you name the practice, write "CBG/MIGS", never bare "MIGS" — and only where the paper
actually bears on it. A menopause, sleep or neurology paper needs no mention of the practice at all;
omit it rather than shoehorn it in, because a bare "MIGS" reads as minimally invasive glaucoma surgery.
Do not use the words "never" or "always" in your own prose.
NO ADVICE: appraise the literature; do not address a patient ("you should…", "take…", "stop…").
NO STYLING: write no style attributes, no colours, no backgrounds — the site renders on its own paper
background and any inline colour can break its contrast."""


TREND_SYNTH_RULES = """
WHAT: the subsection for ONE item of a viral claim — the inner HTML that follows an <h3> carrying the
item's name — 700 to 1,600 characters of prose in Dr. Mabini's first-person clinician voice (DO +
complex benign gynecology / minimally invasive gynecologic surgery). State what the post claims for
this item in one neutral clause, then what the fetched studies actually found, with the numbers, then
what a reader can reasonably do with that.
FRAMING: choose exactly one label for this item from this list and return it as "framing":
{framings}
The label must follow from the cited abstracts: "Supported by clinical trials" needs randomized human
trials in this condition showing the claimed benefit; "Studied in a related condition, not this one"
when the human evidence is in a neighbouring condition; "Promising, but not yet shown in people" for
mechanism, animal or in-vitro work; "The evidence so far points the other way" when trials tested the
claim and did not find it; otherwise "Not enough evidence to say".
CITATIONS: cite EVERY paper in the topic file INLINE — each at least once, right after the claim it
supports, the first time that study is discussed; several citations may sit back to back after one
sentence. Write the PMID as the marker text; the pipeline renumbers markers sequentially in order of
first appearance and builds the reference list from them. Use EXACTLY this markup with the paper's PMID:
<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-PMID">PMID</a><span class="mz-ref-pop" id="ref-pop-PMID" role="tooltip"><span class="mz-ref-pop-title">TITLE</span><span class="mz-ref-pop-meta">JOURNAL &middot; YEAR</span><span class="mz-ref-pop-finding">FINDING</span><a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>
FINDING: 250-600 characters. The study's conclusion FIRST, with its own numbers and design, then one
sentence starting "Relevance:" saying how it bears on this claim. Never open with "This study".
Cite ONLY PMIDs in the topic file; every one of them must appear at least once.
LENGTH: 700 characters minimum; at most 1,600 plus 150 per paper in the item.
GROUNDING: every claim and number from the abstracts. Overstatement and understatement are both
failures.
NUMBERS AS STATED: use only figures the abstract itself gives. Do not compute, combine or convert them — no totals you added up, no percentages you worked out, no differences you subtracted. If the abstract says 487 per arm, write 487 per arm, not 974. A number you derived cannot be checked against the paper, and a reader cannot tell which of your figures came from the study. No AI/placeholder language, paths or section marks. Escape & < >.
{tone}
CITE EVERY CLAIM: every sentence that states a study's finding, a number, a population or a comparison
carries the citation of the paper it comes from — not only the first mention of that paper. Cite again
each time the sentence's claim rests on a paper.
TERMS: when you name the practice, write "CBG/MIGS", never bare "MIGS" — and only where the paper
actually bears on it. A menopause, sleep or neurology paper needs no mention of the practice at all;
omit it rather than shoehorn it in, because a bare "MIGS" reads as minimally invasive glaucoma surgery.
Do not use the words "never" or "always" in your own prose.
NO ADVICE: appraise the literature; do not address a patient ("you should…", "take…", "stop…").
NO STYLING: write no style attributes, no colours, no backgrounds — the site renders on its own paper
background and any inline colour can break its contrast."""


def _author_one_topic(args_t: tuple) -> tuple:
    W, tid = args_t
    man = json.load(open(W + "manifest.json"))
    if man.get("format") == "trend":
        claim = (man.get("trend") or {}).get("claim") or json.load(open(W + "brief_context.json")).get("claim", "")
        rules = TREND_SYNTH_RULES.format(framings="\n".join(f"  - {f}" for f in FRAMINGS), tone=BRIDGE_TONE)
        draft = _claude(f"""Author the subsection for one item of a viral claim being checked against the literature.
THE CLAIM: {claim}
READ (Read tool): {W}topics/{tid}.json — title (the item), and papers[] each with pmid, title, meta, abstract.
{rules}
Return ONLY {{"html": "<inner html>", "cited": ["PMID", …], "framing": "<one label from the list>"}}.""")
        if not draft or not draft.get("html"):
            return tid, None, "author produced nothing"
        if draft.get("framing") not in FRAMINGS:
            return tid, None, f"framing not from the fixed list: {draft.get('framing')!r}"
        verdict = _claude(f"""You are the adversarial reviewer for a physician-authored evidence subsection. Default to REFUTE.
THE CLAIM: {claim}
READ {W}topics/{tid}.json. Check: every number and claim traceable to that paper's abstract; the
"framing" label is the one the cited abstracts actually justify (from: {"; ".join(FRAMINGS)}); EVERY
paper in the topic file is cited inline at least once and every cited PMID is in the topic file (an
uncited paper is BLOCKING — add the citation or a sentence discussing it); every popover carries
title, meta, a 250-600 character conclusion-first finding with a "Relevance:" sentence, and the PubMed
link, id ref-pop-PMID; at least 700 characters of prose; Also refuse: a sentence stating a finding, number or comparison with no citation on it; bare "MIGS"
without "CBG/"; "never"/"always" in the clinician's prose; anything addressed to a patient as advice. no dose in the clinician's own prose; no AI/placeholder language; tone
is respectful to the person who made the claim — no "verdict", "debunk", "myth", "misinformation", no
"influencer" used as a label.
If fixable by tightening, deleting an unsupported sentence, correcting a popover or the label, return
fixed_html / fixed_framing with ok=true and problems listing the changes. Otherwise ok=false.
GENERATED: {json.dumps(draft)[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_html": "...", "fixed_framing": "..."}}""")
        if not verdict:
            return tid, None, "verification produced nothing"
        if not verdict.get("ok"):
            return tid, None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:160]}"
        framing = verdict.get("fixed_framing") or draft["framing"]
        if framing not in FRAMINGS:
            return tid, None, f"reviewer returned a framing outside the list: {framing!r}"
        return tid, {"tid": tid, "html": verdict.get("fixed_html") or draft["html"],
                     "cited": draft.get("cited"), "framing": framing,
                     "problems": verdict.get("problems")}, None
    draft = _claude(f"""Author the topic synthesis for one topic of a CBG/MIGS "Monday Mornings" brief.
READ (Read tool): {W}topics/{tid}.json — title, and papers[] each with pmid, title, meta, abstract.
{SYNTH_RULES}
Return ONLY {{"html": "<inner html>", "cited": ["PMID", …]}}.""")
    if not draft or not draft.get("html"):
        return tid, None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored evidence synthesis. Default to REFUTE.
READ {W}topics/{tid}.json. Check: every number and claim traceable to that paper's abstract; EVERY
paper in the topic file is cited inline at least once, and every cited PMID is in the topic file; every
popover carries title, meta, a 250-600 character takeaway-first finding ending in a "Monday:" sentence,
and the PubMed source link, with id ref-pop-PMID; no overstatement or understatement; no dose in the
clinician's own prose; no AI/placeholder language, paths or section marks; at least 1,000 characters
of prose. A paper left uncited is a BLOCKING problem — add the citation where the study is discussed,
or add a sentence discussing it. Also refuse: a sentence stating a finding, number or comparison with no citation on it; bare "MIGS"
without "CBG/"; "never"/"always" in the clinician's prose; anything addressed to a patient as advice.
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
2,400-3,400 characters of prose (citation markup not counted).
VOICE: Dr. Mabini's first person — a DO and complex benign gynecology / minimally invasive gynecologic
surgery surgeon reading the week as a whole. Open on the one paper you keep returning to, read the
others as variations on a structural theme, name studies by first author, close on what changes on a
Monday. Direct, specific, no throat-clearing.
GROUNDING: every study, author, number and finding from the topic files. No external facts.
NUMBERS AS STATED: use only figures the abstract itself gives. Do not compute, combine or convert them — no totals you added up, no percentages you worked out, no differences you subtracted. If the abstract says 487 per arm, write 487 per arm, not 974. A number you derived cannot be checked against the paper, and a reader cannot tell which of your figures came from the study.
Overstatement and understatement are both failures — never write a preclinical or animal result as a
human finding.
CITATIONS: cite every study you name, inline, right after the claim, with EXACTLY this markup and the
paper's PMID (the pipeline renumbers markers 1, 2, 3 … in order of first appearance):
<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-PMID">PMID</a><span class="mz-ref-pop" id="ref-pop-PMID" role="tooltip"><span class="mz-ref-pop-title">TITLE</span><span class="mz-ref-pop-meta">JOURNAL &middot; YEAR</span><span class="mz-ref-pop-finding">FINDING</span><a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>
FINDING: 250-600 characters, the study's conclusion first with its numbers, then one sentence starting
"Monday:" with the implication. Never open with "This study".
PROHIBITIONS: no AI/disclaimer/placeholder language, no paths or section marks, Escape & < >. Return inner HTML only.
CITE EVERY CLAIM: every sentence that states a study's finding, a number, a population or a comparison
carries the citation of the paper it comes from — not only the first mention of that paper. Cite again
each time the sentence's claim rests on a paper.
TERMS: when you name the practice, write "CBG/MIGS", never bare "MIGS" — and only where the paper
actually bears on it. A menopause, sleep or neurology paper needs no mention of the practice at all;
omit it rather than shoehorn it in, because a bare "MIGS" reads as minimally invasive glaucoma surgery.
Do not use the words "never" or "always" in your own prose.
NO ADVICE: appraise the literature; do not address a patient ("you should…", "take…", "stop…").
NO STYLING: write no style attributes, no colours, no backgrounds — the site renders on its own paper
background and any inline colour can break its contrast."""

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
"Monday Mornings:" then 3-4 <p>, 2,400-3,400 characters of prose (citation markup excluded from the count); every study
named carries an inline citation in the standard markup, and every cited PMID is in a topic file; Also refuse: a sentence stating a finding, number or comparison with no citation on it; bare "MIGS"
without "CBG/"; "never"/"always" in the clinician's prose; anything addressed to a patient as advice. no
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


CARD_RULES = """
WHAT: the card-level lens paragraph shown under this paper's title in the brief — 2 to 4 sentences,
first person, Dr. Mabini's DO + CBG/MIGS (complex benign gynecology / minimally invasive gynecologic
surgery) reading of THIS paper specifically: what it studied, in whom, the one number or finding that
matters, and what it changes or does not change on a Monday.
MUST BE SPECIFIC: name the design, population and key result from the abstract. No reusable template
sentences, no "this week's signal", no "what I'd want to read next", no "the gap I'm building tools to
close". A reader should be unable to move this paragraph to another paper.
GROUNDING: every fact from the abstract. A dose the study itself used may be stated as that study's
dose ("600 mg twice daily in the trial arm"); never as an instruction to a reader ("take 600 mg").
NUMBERS AS STATED: use only figures the abstract itself gives. Do not compute, combine or convert them — no totals you added up, no percentages you worked out, no differences you subtracted. If the abstract says 487 per arm, write 487 per arm, not 974. A number you derived cannot be checked against the paper, and a reader cannot tell which of your figures came from the study. No AI/placeholder language. No
"never"/"always". When you name the practice write "CBG/MIGS", never bare "MIGS", and only where
the paper actually bears on it — omit it rather than shoehorn it in.
NO ADVICE: appraise the paper; never address a patient ("you should…", "take…", "ask your doctor…").
Plain text with & < > escaped, no markup."""



TREND_EDITORIAL_PARTS = {
    "lede": "one or two sentences, plain, saying what this brief does for the reader (inner HTML of the hero lede)",
    "tagline": "a short, specific, non-adversarial headline for the opening section — no colon-explainer",
    "tagline_body": "1-2 <p>: why this post matters to real patients, what the reader will find below",
    "bottom_line": "2-3 <p> under 'Bottom line, up front': which items hold up, which are promising, which the trials did not bear out, which have too little evidence — plain statements, by name, agreeing exactly with the framing labels",
    "evidence_intro": "1 <p> introducing the item-by-item section and explaining that each carries one of the framing labels",
    "lens": "2-3 <p> for 'From a DO + CBG/MIGS lens': the structure/function, body-unity, whole-person reading of the claim and the evidence",
    "bridge": "2-3 <p> for 'Where the two sides can meet': what the post gets right, what a clinician adds, how a reader can use both without choosing sides",
    "gaps": "1-3 <p> for 'Where the literature doesn't go (yet)': what nobody has studied, and what would settle it",
    "closing": "1 <p> closing thought",
}


def _author_trend_editorial(W: str, man: dict) -> tuple:
    trend = man.get("trend") or {}
    claim = trend.get("claim") or json.load(open(W + "brief_context.json")).get("claim", "")
    spec = "\n".join(f"  {k}: {v}" for k, v in TREND_EDITORIAL_PARTS.items())
    files = ", ".join(f"{W}topics/{t}.json" for t in man["topics"])
    draft = _claude(f"""Author the editorial prose for a brief that checks a viral claim against the literature.
THE CLAIM: {claim}
READ (Read tool): {W}syntheses.json — the verified item-by-item subsections with their framing labels.
This editorial must agree with those labels exactly. Also read the topic files as needed: {files}.
VOICE: Dr. Mabini's first person — a DO and complex benign gynecology / minimally invasive gynecologic
surgery surgeon writing for a reader who may be the person who made the claim.
{BRIDGE_TONE}
GROUNDING: only studies, numbers and findings present in the syntheses or topic files. A dose a study
itself used may be stated as that study's dose; never as an instruction to a reader ("take…", "start
at…"). Cite every study you name, inline, right after the claim, with EXACTLY this markup and the
paper's PMID (the pipeline renumbers markers sequentially):
<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-PMID">PMID</a><span class="mz-ref-pop" id="ref-pop-PMID" role="tooltip"><span class="mz-ref-pop-title">TITLE</span><span class="mz-ref-pop-meta">JOURNAL &middot; YEAR</span><span class="mz-ref-pop-finding">FINDING</span><a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/PMID/" target="_blank" rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>
(FINDING: 250-600 characters, conclusion first with numbers, then a "Relevance:" sentence.)
No AI/placeholder language, paths, section marks. Escape & < >.
CITE EVERY CLAIM: every sentence that states a study's finding, a number, a population or a comparison
carries the citation of the paper it comes from — not only the first mention of that paper. Cite again
each time the sentence's claim rests on a paper.
TERMS: when you name the practice, write "CBG/MIGS", never bare "MIGS" — and only where the paper
actually bears on it. A menopause, sleep or neurology paper needs no mention of the practice at all;
omit it rather than shoehorn it in, because a bare "MIGS" reads as minimally invasive glaucoma surgery.
Do not use the words "never" or "always" in your own prose.
NO ADVICE: appraise the literature; do not address a patient ("you should…", "take…", "stop…").
NO STYLING: write no style attributes, no colours, no backgrounds — the site renders on its own paper
background and any inline colour can break its contrast.
Return inner HTML for each part:
{spec}
Return ONLY a JSON object with exactly those keys.""")
    if not draft or not all(draft.get(k) for k in TREND_EDITORIAL_PARTS):
        missing = [k for k in TREND_EDITORIAL_PARTS if not (draft or {}).get(k)]
        return None, f"author produced nothing for {missing[:4]}"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored editorial. Default to REFUTE.
THE CLAIM: {claim}
READ {W}syntheses.json (each item's verified subsection and framing label) and the topic files: {files}.
Check: every study, number and finding traceable; the bottom line names items consistently with their
framing labels (an item labelled "Supported by clinical trials" is not described as unsupported, and
vice versa); every study named carries an inline citation in the standard markup with a PMID
from a topic file; no AI/placeholder language; each part matches its spec: Also refuse: a sentence stating a finding, number or comparison with no citation on it; bare "MIGS"
without "CBG/"; "never"/"always" in the clinician's prose; anything addressed to a patient as advice.
{spec}
TONE: respectful to the person who made the claim; refuse any sneer, any "verdict", "debunk", "myth",
"misinformation", or "influencer" used as a label.
If fixable, return the corrected parts under "fixed" (only the keys you changed) with ok=true and
problems listing the changes. Otherwise ok=false.
GENERATED: {json.dumps(draft)[:60000]}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed": {{}}}}""")
    if not verdict:
        return None, "verification produced nothing"
    if not verdict.get("ok"):
        return None, f"refused: {'; '.join((verdict.get('problems') or [])[:3])[:300]}"
    parts = dict(draft); parts.update(verdict.get("fixed") or {})
    return {"parts": parts, "problems": verdict.get("problems")}, None


def _author_card(args_t: tuple) -> tuple:
    W, pmid = args_t
    draft = _claude(f"""Write the card lens paragraph for one paper in a CBG/MIGS brief.
READ (Read tool): {W}papers/{pmid}.json — "abstract" is the ground truth; and {W}drafts_dd/{pmid}.json
for the already-verified bottom line, which this paragraph must agree with.
{CARD_RULES}
Return ONLY {{"card": "<paragraph>"}}.""")
    if not draft or not draft.get("card"):
        return pmid, None, "author produced nothing"
    verdict = _claude(f"""You are the adversarial reviewer for a physician-authored paper summary. Default to REFUTE.
READ {W}papers/{pmid}.json — its "abstract" is the ground truth.
Check: every fact traceable to the abstract; specific to this paper (design, population, key result
named); no template phrasing that could sit under any paper; no AI/placeholder language; no
"never"/"always"; no bare "MIGS"; 2-4 sentences; no markup.
If fixable by tightening, return fixed_card with ok=true and problems listing the changes. Otherwise ok=false.
GENERATED: {json.dumps(draft['card'])}
Return ONLY {{"ok": true|false, "problems": ["..."], "fixed_card": "..."}}""")
    if not verdict:
        return pmid, None, "verification produced nothing"
    if not verdict.get("ok"):
        return pmid, None, f"refused: {'; '.join((verdict.get('problems') or [])[:2])[:160]}"
    card_final = verdict.get("fixed_card") or draft["card"]
    rule_bad = draft_rule_faults({"card": card_final})
    if rule_bad:
        return pmid, None, "card breaks a site rule: " + "; ".join(rule_bad[:2])
    path = W + f"drafts_dd/{pmid}.json"
    d = json.load(open(path))
    d["card"] = card_final
    json.dump(d, open(path, "w"), ensure_ascii=False)
    return pmid, len(verdict.get("problems") or []), None


def cards_needed(W: str, post_id: str) -> set:
    """PMIDs whose cite card carries a lens paragraph (<p class="mz-cite-fits">).

    Only that card shape has a slot to write into. W31's source filled every
    slot from a fill-in-the-number template repeated across up to fourteen
    papers, which the site's publish audit refuses; the card must be written
    per paper like everything else.
    """
    src = json.load(open(W + f"{post_id}.source.json"))["body_html"]
    out = set()
    for m in re.finditer(r'<article class="mz-cite-card[^"]*"[^>]*id="mz-cite-(\d+)"[\s\S]*?</article>', src):
        if 'class="mz-cite-fits"' in m.group(0):
            out.add(m.group(1))
    return out


def cmd_author(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "curate");  require_review(W, "curate")
    man = json.load(open(W + "manifest.json"))
    objections = stage_objections(W, "author")
    if objections:
        print(f"  carrying {objections.count(chr(10) + '  - ')} reviewer objection(s) into this attempt")
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
        want = {k for k in json.load(open(W + f"papers/{q}.json")).get("pending", [])
                if k not in NOT_AUTHORABLE}
        if not want:
            # a paper whose sections are already published (a re-run of a
            # live brief) has nothing to write; there is no draft to verify
            return False
        path = W + f"drafts_dd/{q}.json"
        if not os.path.exists(path):
            return True
        try:
            d = json.load(open(path))
        except Exception:
            return True
        if not d.get("_verified"):
            return True
        # The card is a separate piece with its own authoring pass below; a
        # missing card must not make a verified deep dive look unverified —
        # that re-authored 69 sound deep dives on W31 to get 69 paragraphs.
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
                    record_piece_objection(W, pmid, err)
                else:
                    print(f"  wrote {pmid}" + (f" ({fixes} reviewer correction(s))" if fixes else ""))
    if failed:
        record(W, "author", {"failed": f"{len(failed)} paper(s) could not be authored"})
        die(f"{len(failed)} paper(s) could not be authored: {[f[0] for f in failed][:6]}")

    # --- card lens paragraphs, where the card shape has one ---
    need_card = [q for q in sorted(cards_needed(W, post_id) & set(man["pmids"]))
                 if not (json.load(open(W + f"drafts_dd/{q}.json")).get("card") if os.path.exists(W + f"drafts_dd/{q}.json") else None)]
    if need_card:
        print(f"  {len(need_card)} card lens paragraph(s) to author")
        card_failed = []
        with ThreadPoolExecutor(max_workers=4) as ex:
            for pmid, fixes, err in ex.map(_author_card, [(W, q) for q in need_card]):
                if err:
                    card_failed.append((pmid, err)); print(f"  FAILED card {pmid}: {err}")
                else:
                    print(f"  wrote card {pmid}" + (f" ({fixes} reviewer correction(s))" if fixes else ""))
        if card_failed:
            record(W, "author", {"failed": f"{len(card_failed)} card(s) could not be authored"})
            die(f"card authoring failed: {[f[0] for f in card_failed][:6]}")

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
    if man.get("format") == "trend":
        narr_path = W + "narrative.json"
        t_dec = os.path.getmtime(W + ".ledger/curate.decisions") if os.path.exists(W + ".ledger/curate.decisions") else 0
        if not os.path.exists(narr_path) or os.path.getmtime(narr_path) < t_dec:
            print("  authoring the editorial (lede, headline, bottom line, lens, bridge, gaps, closing)")
            item, err = _author_trend_editorial(W, man)
            if err:
                record(W, "author", {"failed": f"editorial: {err}"})
                die(f"editorial authoring failed: {err}")
            json.dump({"html": "", "parts": item["parts"]}, open(narr_path, "w"), ensure_ascii=False)
            print(f"  wrote editorial ({len(item['problems'] or [])} reviewer correction(s))")
        else:
            print("  editorial already current for these curation decisions")
    else:
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
    if os.path.exists(W + ".ledger/author.objections.json"):
        os.remove(W + ".ledger/author.objections.json")
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
JC_KEYS = ["bottom", "question", "pico", "methods", "abstract", "findings", "rob", "strengths",
           "applicability", "kb", "equity", "monday", "prompts"]
HEAD = {"question": "Clinical question", "pico": "PICO", "methods": "Methodology &mdash; methods strength",
        "rob": "Risk of bias &mdash; limitations", "kb": "Where this sits in the established literature",
        "monday": "Where this changes Monday clinic &mdash; DO + CBG/MIGS lens", "abstract": "Verbatim PubMed abstract",
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
NUM_WORDS = r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|thousand)"
DOSE_RE = re.compile(
    r"\b(?:\d[\d,.\u2013\u2014-]*|" + NUM_WORDS + r"(?:[\s-]" + NUM_WORDS + r")?)[\s-]*"
    r"(?:mg|mcg|\u00b5g|\u03bcg|IU|milligrams?|micrograms?|international units?)\b(?!\s*/\s*(?:L|dL|mL|l|dl|ml))",
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
    # EVERY cite card for this paper, not the first: W31 carried two cards for
    # 42489393 and the second survived the excision, so a dropped paper was
    # still on the page and the post-condition caught it one stage later.
    while True:
        hit = None
        for m in re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h):
            if (re.search(r'id="mz-cite-%s(?:-\d+)?"' % re.escape(pmid), m.group(0))
                    or f"openDeepDive('dd-{pmid}')" in m.group(0)
                    or f"pubmed.ncbi.nlm.nih.gov/{pmid}/" in m.group(0)):
                hit = m
                break
        if not hit:
            break
        h = h[:hit.start()] + h[hit.end():]
    # and any trigger button left pointing at the removed dialog
    h = re.sub(r'<button[^>]*openDeepDive\([\'"]dd-%s[\'"]\)[^>]*>[\s\S]*?</button>' % re.escape(pmid), "", h)
    # deep-dive dialog
    h = re.sub(r'<dialog[^>]*id="dd-%s"[\s\S]*?</dialog>' % re.escape(pmid), "", h)
    # reference-list entry
    h = re.sub(r'<li[^>]*\bid="(?:mz-)?ref-%s"[^>]*>[\s\S]*?</li>' % re.escape(pmid), "", h)
    # any inline citation to it (rare — syntheses are written after curation)
    h = SUP_RE.sub(lambda m: "" if _pmid_of(m.group(0)) == pmid else m.group(0), h)
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



def breakable_marker_runs(h: str) -> str:
    """A zero-width space between consecutive markers, so a run can wrap.
    W25's closing narrative sentence carries fifteen markers; with nothing
    breakable between them the run was one 390-pixel token that fell off the
    right edge of a phone, inside a clipped container — unreachable, and the
    rendered gate refused. Added after every insertion step and removed by
    normalize_legacy_markup before the chain runs again."""
    return re.sub(r'</sup>(?=<sup class="mz-ref")', "</sup>&#8203;", h)


# An opening tag whose ">" ended up after the text that should follow it:
#   <li><span class="mz-rec-text"Laparoscopic excision improves …pain.><sup…
# A sentence was written at an offset that fell between the attribute's
# closing quote and the tag's own ">", so the tag never closed and its ">"
# now sits at the end of the sentence. The shape is unambiguous — a quoted
# attribute followed directly by text, with the stray ">" before the next tag
# — and the repair is exact: put the ">" back where it belongs.
_SPLIT_TAG_RE = re.compile(r'(<[a-z][a-z0-9]*(?:\s+[a-z-]+="[^"]*")+)(?=[^\s/>])([^<>]{0,900})>')


def repair_split_tags(h: str) -> tuple:
    """Close an opening tag whose ">" was pushed past the text. (h, repaired)."""
    n = 0

    def one(m):
        nonlocal n
        n += 1
        return m.group(1) + ">" + m.group(2)

    return _SPLIT_TAG_RE.sub(one, h), n


def malformed_tag_faults(h: str) -> list:
    """Opening tags a browser cannot read, named with their text.

    The read-back audit found these, which means a model call and a whole run
    stood between the damage and anyone hearing about it. This is a string
    check: it costs nothing and says exactly where.
    """
    out = []
    for m in _SPLIT_TAG_RE.finditer(h):
        out.append(f"an opening tag never closed, its '>' pushed past the text: {m.group(0)[:90]!r}")
    return out[:6]


def renumber_list_labels(h: str) -> str:
    """Inline enumerations "(1) … (2) … (3) …" inside one paragraph are
    consecutive: a removed item left "(1) … (3)" (W24)."""
    def para(m):
        body = m.group(2)
        labels = list(re.finditer(r"\((\d+)\)(?=\s)", body))
        nums = [int(x.group(1)) for x in labels]
        if len(nums) < 2 or nums == list(range(1, len(nums) + 1)) or nums[0] != 1:
            return m.group(0)
        out, last, n = [], 0, 0
        for x in labels:
            n += 1
            out.append(body[last:x.start()]); out.append(f"({n})"); last = x.end()
        out.append(body[last:])
        return m.group(1) + "".join(out) + m.group(3)
    return re.sub(r"(<p\b[^>]*>)([\s\S]*?)(</p>)", para, h)


def tidy_prose_spacing(h: str) -> str:
    """Spacing a reader would notice around a citation marker.

    No space before a comma or full stop (a lifted or rewritten marker can
    leave "levels ,"), and a space AFTER a marker run where the next sentence
    begins — a marker written at a sentence end came out
    "…monitoring schedule.<sup>7</sup>The next sentence", which renders as the
    superscript touching the following word.
    """
    out, last = [], 0
    for ps in _prose_passages(h):
        frag = ps.group(1)
        parts = re.split(r"(<[^>]+>)", frag)
        for i in range(0, len(parts), 2):
            parts[i] = re.sub(r"(?<=[A-Za-z0-9)\]\u201d\u2019'])[ \xa0]+(?=[,.;:!?](?:\s|$|&))", "", parts[i])
            if i >= 2 and parts[i - 1].startswith("</"):
                parts[i] = re.sub(r"^[ \xa0]+(?=[,.;:!?](?:\s|$|&))", "", parts[i])
        joined = re.sub(r"<(em|strong|b|i)\b[^>]*>\s*</\1>", "", "".join(parts))  # a rewrite can leave an empty pair
        # a marker run and the next sentence need a space between them; a
        # following mark of punctuation or another marker does not
        joined = re.sub(r"(</sup>)(?=[A-Za-z\u201c\u2018(\[])", r"\1 ", joined)
        out.append(h[last:ps.start(1)]); out.append(joined); last = ps.end(1)
    out.append(h[last:])
    return "".join(out)


def bind_legacy_cards(h: str, real: dict) -> tuple:
    """Give a card that names a paper that paper's own id.

    The 2026-05 trend generation wrote <article class="mz-cite-card"
    id="mz-ref-1"> — a per-section index, not a paper, repeated in every
    section. Nothing downstream could tell which paper a card was for, so
    those briefs carded nothing that curation, the counts or the renumbering
    could see; the index printed in the badge went stale the moment the
    citations were renumbered; and two cards in different sections claimed the
    same element id as a real reference anchor.

    The card prints the paper's title, and PubMed has the title, so that is
    the join. Cards already carrying a paper's id are left alone.
    """
    norm = lambda x: re.sub(r"[^a-z0-9]", "", H.unescape(re.sub(r"<[^>]+>", " ", x or "")).lower())  # noqa: E731
    by_title = {}
    for pm, f in (real or {}).items():
        t = norm((f or {}).get("title"))
        if len(t) >= 20:
            by_title.setdefault(t, pm)
    bound, out, last = 0, [], 0
    for m in re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h):
        card = m.group(0)
        if re.search(CARD_ID_RE, card):
            continue                                   # already a paper's id
        title = norm((re.search(r'<p class="mz-cite-title">([\s\S]*?)</p>', card) or [None, ""])[1])
        pm = by_title.get(title)
        if not pm and len(title) >= 25:
            # a generator that trimmed a long title, or added a trailing stop
            pm = next((q for t, q in by_title.items()
                       if (title in t or t in title) and min(len(t), len(title)) >= 25), None)
        if not pm:
            continue
        # class first, then id: normalize_card_ids reads the class before the
        # id, and a card whose id came first was invisible to the pass that
        # suffixes a paper carded twice
        tag = re.match(r"<article\s[^>]*>", card).group(0)
        cls = (re.search(r'class="([^"]*)"', tag) or [None, "mz-cite-card"])[1]
        new = f'<article class="{cls}" id="mz-cite-{pm}">' + card[len(tag):]
        out.append(h[last:m.start()]); out.append(new); last = m.end()
        bound += 1
    out.append(h[last:])
    return "".join(out), bound


def renumber_card_badges(h: str, order: list) -> tuple:
    """A card's badge opens with the number of the citation it belongs to.

    "[1] · Cochrane review · 2020" was written with a per-section index, so
    after renumbering it named a different paper than the markers did — the
    read-back audit refused a trend brief for exactly that. The number now
    comes from the document's citation order, and a card for a paper the brief
    no longer cites loses the bracket rather than keeping a wrong one.
    """
    num = {pm: i + 1 for i, pm in enumerate(order or [])}
    changed = 0

    def one(m):
        nonlocal changed
        block = m.group(0)
        pm = ((re.search(CARD_ID_RE, block) or re.search(r'<dialog[^>]*\bid="dd-(\d{5,9})"', block)
               or [None, None])[1])
        # the deep dive's eyebrow carries the same index: "Journal Club ·
        # Deep Dive · Paper #1" on a paper every marker and every badge calls
        # 3. One number per paper, and it is the citation's.
        if pm in num:
            block, k = re.subn(r"(Paper\s*#\s*)\d+", lambda x: x.group(1) + str(num[pm]), block)
            if k:
                changed += k
        b = re.search(r'(<(?:p|span) class="mz-cite-design"[^>]*>)\s*\[(\d+)\]\s*(?:·|&middot;|&#183;)\s*', block)
        if not b:
            return block
        head = b.group(1) + (f"[{num[pm]}] · " if pm in num else "")
        if head == b.group(0):
            return block
        changed += 1
        return block[:b.start()] + head + block[b.end():]

    h = re.sub(r'<article class="mz-cite-card[\s\S]*?</article>', one, h)
    h = re.sub(r'<dialog\b[\s\S]*?</dialog>', one, h)
    return h, changed


def normalize_card_ids(h: str) -> str:
    """Card ids in document order: a paper's first card is mz-cite-<pmid>,
    its second mz-cite-<pmid>-2, and so on. After curation removes a first
    card, the survivor kept its old "-2" (W34's Kido paper)."""
    seen = {}

    def fix(m):
        pm = m.group(2)
        seen[pm] = seen.get(pm, 0) + 1
        return m.group(1) + f'id="mz-cite-{pm}' + (f"-{seen[pm]}" if seen[pm] > 1 else "") + '"'
    return re.sub(r'(<article class="mz-cite-card[^>]*?)\bid="mz-cite-(\d{5,9})(?:-\d+)?"', fix, h)


def dedupe_element_ids(h: str) -> str:
    """Make every element id unique on the page.

    A paper that belongs under two topics is carded under both — legitimate
    content, invalid HTML, and an anchor to that id resolves to whichever card
    came first. The dialog keeps its single id (the triggers call it by name);
    only the repeated cards are renumbered.
    """
    # Every id already in the document, because number_citations has ALREADY
    # suffixed repeated popovers as "-2"/"-3". Appending another "-2" here
    # collided with those and left duplicates behind — the very thing this
    # function exists to remove.
    existing = set(re.findall(r'\sid="([^"]+)"', h))
    seen: dict = {}

    def one(m):
        attr, val = m.group(0), m.group(1)
        if val.startswith("dd-"):
            return attr
        seen[val] = seen.get(val, 0) + 1
        if seen[val] == 1:
            return attr
        k = seen[val]
        cand = f"{val}-{k}"
        while cand in existing:
            k += 1
            cand = f"{val}-{k}"
        existing.add(cand)
        return f' id="{cand}"'

    return re.sub(r'\sid="([^"]+)"', one, h)


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

    return SUP_RE.sub(fix, h)


def strip_build_comments(h: str) -> str:
    """Remove build/run-manifest comments from the body.

    A draft carried a trailing HTML comment with run-manifest JSON naming the
    generator and its "legacy auto-draft path". Not rendered, but plain in
    view-source, and the standing directive is that no internal build detail
    appears on any page.
    """
    # every comment goes, not only the ones matching a keyword list — a
    # comment is never reader content and any of them can carry build detail
    return re.sub(r"<!--[\s\S]*?-->", "", h)


def write_abstracts(W: str, man: dict, h: str, dropped: list) -> tuple:
    """Every kept paper's abstract section carries that paper's PubMed abstract."""
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
    return h, repairs, repaired_n


def apply_sections(W: str, man: dict, h: str) -> tuple:
    """Write every authored deep-dive section into its dialog, keeping the heading."""
    applied = 0
    for pmid in man["pmids"]:
        secs = json.load(open(W + f"drafts_dd/{pmid}.json"))
        while isinstance(secs, dict) and set(secs) == {"sections"} or set(secs) == {"blocks"}:
            secs = secs.get("sections") or secs.get("blocks")
        for key, inner in secs.items():
            if key in NOT_AUTHORABLE or key == "card" or key.startswith("_") or not isinstance(inner, str):
                continue
            pat = re.compile(r'(<section class="mz-jc-section" id="dd-%s-%s">)(.*?)(</section>)'
                             % (re.escape(pmid), re.escape(key)), re.S)
            m = pat.search(h)
            if not m:
                # the dialog lacks this section entirely: create it before the
                # dialog's closing so the fixed section list is always complete
                dm = re.search(r'(<dialog[^>]*id="dd-%s"[^>]*>)([\s\S]*?)(</dialog>)' % re.escape(pmid), h)
                if not dm:
                    continue
                inner_d = dm.group(2)
                cut_at = inner_d.rfind("</div>") if inner_d.rstrip().endswith("</div>") else len(inner_d)
                new_sec = (f'<section class="mz-jc-section" id="dd-{pmid}-{key}"><h3>{HEAD.get(key, key)}</h3>'
                           + inner.strip() + "</section>")
                h = h[:dm.start(2)] + inner_d[:cut_at] + new_sec + inner_d[cut_at:] + h[dm.end(2):]
                applied += 1
                continue
            head = re.search(r"<h3[^>]*>(.*?)</h3>", m.group(2), re.S)
            title = re.sub(r'\s*<span class="mz-jc-pending-tag">.*?</span>', "",
                           head.group(1), flags=re.S).strip() if head else HEAD.get(key, key)
            h = h[:m.start()] + m.group(1) + f"<h3>{title}</h3>" + inner.strip() + m.group(3) + h[m.end():]
            applied += 1
    return h, applied


# ---------------------------------------------------------------------------
# CITATIONS — numbered in order of first appearance, references to match
# ---------------------------------------------------------------------------
# Authors write the marker as the PMID because that is the one identifier they
# can get right. A reader must see the standard form: a superscript 1, 2, 3 …
# in order of first appearance, each resolving to the numbered entry in the
# reference list, each carrying a hover popover with the study's summary and
# a link to the study. W33 and W34 shipped with raw PMIDs as the marker text
# and reference lists in feed order; no check here looked at either. Now both
# are built here, deterministically, and both are post-conditions.

SUP_RE = re.compile(r'<sup class="mz-ref"[^>]*>[\s\S]*?</sup>')


def _pmid_of(sup: str) -> str | None:
    m = (re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})", sup) or re.search(r"ref-pop-(\d{5,9})", sup)
         or re.search(r'href="#(?:mz-)?ref-(\d{5,9})"', sup))
    return m.group(1) if m else None


def number_citations(h: str, meta: dict | None = None) -> tuple:
    """Renumber every inline citation and return (html, pmids_in_citation_order).

    The popover's journal-and-year line is REWRITTEN from the PubMed-verified
    meta rather than trusted: it was free text an author typed into the markup,
    so the popover and the reference list could show two different, both
    unverified, years for the same paper.
    """
    META = meta or {}
    order: list = []
    canon: dict = {}
    for m in SUP_RE.finditer(h):
        pm = _pmid_of(m.group(0))
        if not pm:
            continue
        if pm not in order:
            order.append(pm)
        pop = re.search(r'<span class="mz-ref-pop"[^>]*>([\s\S]*?)</span>(?=\s*</sup>)', m.group(0))
        if pop and "mz-ref-pop-finding" in pop.group(1) and pm not in canon:
            canon[pm] = pop.group(1)
    num = {pm: i + 1 for i, pm in enumerate(order)}
    counts: dict = {}

    def rewrite(m):
        sup = m.group(0)
        pm = _pmid_of(sup)
        if not pm:
            return sup
        if pm not in canon:
            # no stored popover for this marker: it still gets its number and
            # its link, or the reference list lists a paper whose marker shows
            # stale text (W21: 84 entries above a highest marker of 76)
            return re.sub(r'<a class="mz-ref-link"[^>]*>[\s\S]*?</a>',
                          f'<a class="mz-ref-link" href="#ref-{pm}" aria-describedby="ref-pop-{pm}">{num[pm]}</a>',
                          sup, count=1)
        k = counts.get(pm, 0) + 1
        counts[pm] = k
        pid = f"ref-pop-{pm}" + (f"-{k}" if k > 1 else "")
        inner = "".join(re.findall(r'<span class="mz-ref-pop-(?:title|meta|finding)">[\s\S]*?</span>'
                                   r'|<a class="mz-ref-pop-src"[\s\S]*?</a>', canon[pm])) or canon[pm]
        if META.get(pm):
            meta_html = f'<span class="mz-ref-pop-meta">{H.escape(META[pm], quote=False)}</span>'
            if "mz-ref-pop-meta" in inner:
                inner = re.sub(r'<span class="mz-ref-pop-meta">[\s\S]*?</span>', meta_html, inner, count=1)
            else:
                inner = re.sub(r"(</span>)", meta_html + r"\1", inner, count=1)
        if "mz-ref-pop-src" not in inner:
            inner += (f'<a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/{pm}/" target="_blank" '
                      f'rel="noopener">Read the study on PubMed&nbsp;&rarr;</a>')
        return (f'<sup class="mz-ref"><a class="mz-ref-link" href="#ref-{pm}" aria-describedby="{pid}">{num[pm]}</a>'
                f'<span class="mz-ref-pop" id="{pid}" role="tooltip">{inner}</span></sup>')

    return SUP_RE.sub(rewrite, h), order


def build_references(W: str, h: str, order: list, meta: dict | None = None) -> str:
    """Replace any reference list with one in citation order, entries from the paper files."""
    old_entries = {m.group(1): m.group(2) for m in re.finditer(r'<li id="ref-(\d+)">([\s\S]*?)</li>', h)}
    items = []
    for pm in order:
        pf = W + f"papers/{pm}.json"
        if os.path.exists(pf):
            pj = json.load(open(pf))
            line = ((meta or {}).get(pm) or pj.get("meta_verified")
                    or re.sub(r"\s*[·•]\s*PMID\s*\d+\s*$", "", pj.get("meta") or "").strip().rstrip("."))
            title = (pj.get("title") or "").strip()
            text = f"{H.escape(line, quote=False)}. {H.escape(title, quote=False)}"
        elif pm in old_entries:
            text = re.sub(r'\s*<a class="mz-ref-pmid"[\s\S]*?</a>', "", old_entries[pm]).strip()
        else:
            die(f"no paper file for cited PMID {pm}; refusing to publish a bare reference entry")
        items.append(f'<li id="ref-{pm}">{text} <a class="mz-ref-pmid" href="https://pubmed.ncbi.nlm.nih.gov/{pm}/" '
                     f'target="_blank" rel="noopener noreferrer">PMID {pm}</a></li>')
    refs = ('<section class="mz-post-section mz-references" id="references">'
            '<h2 class="mz-section-title">References</h2><ol class="mz-references-list">'
            + "".join(items) + "</ol></section>")
    h = re.sub(r'<section class="[^"]*mz-references[^"]*"[^>]*>[\s\S]*?</section>', "", h)
    h = re.sub(r'<ol class="mz-references-list">[\s\S]*?</ol>', "", h)
    anchor = h.find("<dialog")
    if anchor < 0:
        anchor = h.rfind("<script")
    return h[:anchor] + refs + h[anchor:] if anchor >= 0 else h + refs



TOUCH_SCRIPT = ('<script>(function(){document.addEventListener("click",function(e){var ref=e.target.closest'
                '&&e.target.closest("sup.mz-ref");if(!ref){document.querySelectorAll(".mz-ref.mz-open").forEach'
                '(function(el){el.classList.remove("mz-open")});return;}if(e.target.closest("a.mz-ref-pop-src"))'
                'return;e.preventDefault();document.querySelectorAll(".mz-ref.mz-open").forEach(function(el){if'
                '(el!==ref)el.classList.remove("mz-open")});ref.classList.toggle("mz-open");});})();</script>')



# ---------------------------------------------------------------------------
# Deterministic checks on the site's own prose (S1, S5, S6, S8, S9, S10, S12, S14)
# ---------------------------------------------------------------------------
PROSE_CONTAINERS = re.compile(
    # the hero lede is the first prose a reader meets and was in none of the
    # scans — not the terminology regexes, not the advice regex, not the
    # per-sentence audit; four standards were unenforced there for that alone
    r'<p class="mz-post-lede">[\s\S]*?</p>'
    r'|<p class="mz-toc-group-synthesis">[\s\S]*?</p>'
    r'|<section class="[^"]*mz-post-narrative[^"]*"[^>]*>[\s\S]*?</section>'
    r'|<section class="mz-post-section[^"]*"[^>]*id="(?:opening|bottom-line|lens|bridge|gaps|closing|evidence|shape|papers)"[^>]*>[\s\S]*?</section>')


def prose_fragments(h: str) -> list:
    """Every prose container, with cite cards removed (cards are audited on their own)."""
    return [strip_template(CARD_RE.sub(" ", f)) for f in PROSE_CONTAINERS.findall(h)]


def piece_of(h: str, frag: str) -> str:
    """Which authored piece a prose fragment belongs to: topic-<x> (a synthesis),
    narrative, or editorial — the unit `run` re-authors when the fragment fails."""
    pos = h.find(frag[:200])
    if pos < 0:
        return "unknown"
    if frag.startswith('<p class="mz-toc-group-synthesis">') or 'id="evidence"' in frag[:200]:
        back = h[:pos]
        m = list(re.finditer(r'id="(topic-[^"]+)"', back))
        if frag.startswith('<p class="mz-toc-group-synthesis">') and m:
            return m[-1].group(1)
        return "editorial"
    if frag.startswith('<p class="mz-post-lede">'):
        return "editorial" if 'id="opening"' in h[:pos] or "mz-post-hero" in h[:pos] else "narrative"
    if "mz-post-narrative" in frag[:200]:
        return "narrative" if 'id="opening"' not in frag[:200] else "editorial"
    return "editorial"
CARD_RE = re.compile(r'<article class="mz-cite-card[^"]*"[\s\S]*?</article>')


def card_texts(h: str) -> list:
    """(pmid, clinician text) for every cite card, whatever its shape."""
    out = []
    for m in CARD_RE.finditer(h):
        card = m.group(0)
        pm = _pmid_of(card) or (re.search(r"openDeepDive\('dd-(\d+)'", card) or [None, None])[1]
        paras = re.findall(r'<p class="mz-cite-(?:fits|finding)">([\s\S]*?)</p>', card)
        if pm and paras:
            out.append((pm, " ".join(paras)))
    return out


# Lancet-family journals write decimals with a MIDDLE DOT: "-1.87" appears in
# the abstract as "-1·87", "p<0.001" as "p<0·001". Every figure in such an
# abstract therefore read as two separate small numbers, so a hover card that
# correctly reported "2.39 fewer episodes a day" was rejected three times for
# inventing a figure and fell back to the no-figures card. SKYLIGHT 2, whose
# abstract is nothing but results, published a summary that stated none of
# them — exactly the complaint the standard exists to prevent.
_FIG_NORM_RE = re.compile(r"(?<=\d)[\u00b7\u2027\u2219\u22c5](?=\d)")


def _normalize_figures(text: str) -> str:
    """Put a source's figures into one notation before any of them is read."""
    t = (text or "").replace("\u2212", "-").replace("\u2013", "-")   # minus sign, en dash
    return _FIG_NORM_RE.sub(".", t)


def _pool_tokens(text: str) -> set:
    """Every number a source text contains — the permissive side of the check.

    Building the pool with the same stripping as the checked text removed the
    22.7 of a white-cell count from the abstract while the prose kept it, so a
    figure that WAS in the paper was reported as invented.
    """
    # Every digit sequence, with no exclusions at all. The pool is the
    # permissive side: a number missing from it reports a real figure as
    # invented, which is how a confidence interval written "80.6-97.5" in the
    # abstract failed against a synthesis that quoted it correctly.
    text = _normalize_figures(text)
    pool = {t.replace(",", "") for t in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    # both "1.87" and its parts, so neither notation can report a real figure
    # as invented
    pool |= {p for t in list(pool) for p in t.split(".") if p}
    # "eleven tertiary hospitals" is 11; "33 5/7 weeks" tokenises as 335 —
    # both reported a correct figure as invented and cost the citation
    words = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
             "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
             "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
             "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50", "sixty": "60",
             "seventy": "70", "eighty": "80", "ninety": "90", "hundred": "100", "thousand": "1000"}
    for w in re.findall(r"[a-z]+", (text or "").lower()):
        if w in words:
            pool.add(words[w])
    for t in list(pool):
        digits = t.replace(".", "")
        for i in range(len(digits)):
            for j in range(i + 2, len(digits) + 1):
                pool.add(digits[i:j])
    return pool


def _num_tokens(text: str) -> set:
    """Numbers a reader would read as a finding.

    A DOI (10.3389/...), a PMID, an ISSN and the 10^9 of a cell count are not
    claims, and treating them as ones flagged sound cards and deep dives — a
    gate that cries wolf gets worked around, which is worse than no gate.
    """
    t = _normalize_figures(text)
    t = re.sub(r"\b10\.\d{4,}/\S+", " ", t)                      # DOI
    t = re.sub(r"\bPMID:?\s*\d{5,9}\b", " ", t, flags=re.I)      # PMID
    t = re.sub(r"\b\d{4}-\d{3}[\dXx]\b", " ", t)                 # ISSN
    # the WHOLE number, decimals included: matching only the integer part left
    # "22" behind from "22.7x10^9/L", which then failed against an abstract that
    # says 22.7 — the same false positive in a new place
    t = re.sub(r"\d[\d,]*(?:\.\d+)?\s*[x\u00d7]\s*10\s*[\u2070-\u209f\^]?\s*\d*\s*/?\s*[a-zA-Z/]*",
               " ", t)  # 22.7 x 10^9/L
    t = re.sub(r"\b\d{7,9}\b", " ", t)                            # a bare PMID
    # A digit bound into a NAME — CA-125, IL-6, COVID-19, HbA1c — is part of
    # that name. A hyphen BETWEEN two numbers is a range (80.6-97.5) and those
    # are figures: excluding them on the hyphen alone failed correct prose.
    return {x.replace(",", "") for x in
            re.findall(r"(?<![A-Za-z0-9])(?<![A-Za-z]-)\d[\d,]*(?:\.\d+)?"
                       r"(?![A-Za-z0-9])(?!-[A-Za-z])", t)}
# Patient-directed advice, not any sentence containing "you". A journal-club
# prompt asks the CLINICIAN "what would you need to see before you changed how
# you counsel a patient" — that is the format working, and matching a bare
# "you need to" called it advice.
ADVICE_RE = re.compile(
    r"\byou (?:should|must|ought to) (?:take|stop|start|ask|see|call|try|use|discuss)\b"
    r"|\b(?:start|stop) taking\b"
    r"|\btake (?:\d|one|two|a) (?:capsule|tablet|dose|pill)"
    r"|\b(?:ask|talk to|speak with) your (?:doctor|surgeon|physician|provider)\b"
    r"|\bI recommend (?:that )?you\b"
    r"|\byour (?:doctor|surgeon) (?:should|will|can) \b", re.I)
PROVENANCE_RE = re.compile(r"\b(?:AI|machine|auto)[- ]generated\b|generated by (?:an? )?(?:AI|model|assistant|LLM)|large language model|\bLLMs?\b|\bClaude\b|\bChatGPT\b|\bGPT-?\d", re.I)
INTERNAL_RE = re.compile(r"/Users/|/home/|/tmp/|\.brief-work|CLAUDE\.md|SYSTEM_MAP|§\s?\d+\.\d+|brief_pipeline|\b[a-z_]+\.(?:json|py|mjs)\b|\u00a7\s?\d|\b(?:SECTION_SPECS|REVIEW_PROMPTS|AUTHOR_RULES|SYNTH_RULES|NARRATIVE_RULES|CARD_RULES)\b|\bper (?:our|the) (?:internal|house) (?:style guide|spec|standard)|\b(?:internal|house) (?:spec|style guide|checklist)\b", re.I)
ANIMAL_RE = re.compile(r"\b(?:mice|mouse|murine|rats?|rodent|in vitro|cell lines?|zebrafish|rabbits?|porcine|bovine)\b", re.I)
HUMAN_RE = re.compile(r"\b(?:patients?|women|participants?|subjects|cohort|trial|randomi[sz]ed|men\b|adults?|people)\b", re.I)


def _sentences(html_frag: str) -> list:
    """Sentences of a prose fragment with each citation collapsed to ⟦PMID⟧ tokens."""
    t = SUP_RE.sub(lambda m: " ⟦%s⟧ " % (_pmid_of(m.group(0)) or "?"), html_frag)
    t = re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", " ", t)
    t = H.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"\s+", " ", t).strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z“\"(])", t)
    out = []
    for x in parts:
        x = x.strip()
        if not x:
            continue
        if x.startswith("⟦") and out:          # a citation placed after the full stop
            m = re.match(r"((?:⟦\d+⟧\s*)+)(.*)", x)
            out[-1] += " " + m.group(1).strip()
            x = m.group(2).strip()
            if not x:
                continue
        out.append(x)
    return out


TEMPLATE_INTRO = re.compile(r'<p class="[^"]*mz-jc-(?:section-intro|prompts-intro)[^"]*">[\s\S]*?</p>')


def strip_template(frag: str) -> str:
    """Remove the brief format's own instructional boilerplate.

    Every dialog carries the same lead-ins and a misinformation-guard block
    explaining how to read a confidence interval — "Confidence intervals that
    include 1.0 mean the result is not statistically significant", "Always
    check what the paper says is the primary outcome". That is the format
    teaching the reader, not a claim about this paper, and checking it as
    clinician prose produced the same eleven faults on every brief.
    """
    out = TEMPLATE_INTRO.sub(" ", frag)
    for m in list(re.finditer(r"<(section|div)\b[\s\S]*?</\1>", out)):
        if re.search(r"Misinformation guard|does NOT claim", m.group(0), re.I):
            out = out.replace(m.group(0), " ")
    # and the guard's own sentences, wherever the markup puts them
    out = re.sub(r"[^<>.]*Confidence intervals that include[^<>.]*\.", " ", out)
    out = re.sub(r"[^<>.]*what the paper says is the primary outcome[^<>.]*\.", " ", out)
    return out


def _vis_text(h: str) -> str:
    """Everything a reader can see: prose, cards, dialogs — scripts and styles out."""
    return H.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", " ", h)))


def body_invariant_faults(h: str) -> list:
    """What must be true of a finished brief, checked on the brief itself.

    Every pass in the chain is supposed to guarantee something, and every one
    of them has a path where the page's shape does not match and it moves on
    without a word — 63 of them at the last count. `cite_every_card` walks
    topic sections and needs a synthesis paragraph; W20's generation has none,
    so it skipped nine sections in silence and W20 published with fifteen
    carded papers that no sentence cites. Nothing printed, nothing failed, and
    I called it verified.

    So these are not checks on the passes. They are checks on the body, and
    they do not care which pass was meant to hold them. The site audit
    (`audit_published_briefs.py`) runs the same list against what is already
    published, so a brief is held to one standard before and after it ships.
    """
    out = []
    marks = [re.sub(r"<[^>]+>", "", m).strip()
             for m in re.findall(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', h, re.S)]
    pmid_like = [m for m in marks if re.fullmatch(r"\d{5,9}", m)]
    if pmid_like:
        out.append(f"{len(pmid_like)} of {len(marks)} citation marker(s) show a PMID, not a number")
    out += malformed_tag_faults(h)[:2]
    blanks = [m for m in re.finditer(r"<li\b[^>]*>([\s\S]*?)</li>", h)
              if not re.sub(r"[\s\u00a0]|&nbsp;", "",
                            H.unescape(re.sub(r"<[^>]+>", "", SUP_RE.sub("", m.group(1)))))]
    if blanks:
        out.append(f"{len(blanks)} list item(s) a reader sees as a blank bullet")
    cards = re.findall(r'<article class="mz-cite-card[\s\S]*?</article>', h)
    carded = {(re.search(CARD_ID_RE, c) or re.search(r"openDeepDive\('dd-(\d+)'", c)
               or [None, None])[1] for c in cards} - {None}
    cited = {_pmid_of(m.group(0)) for m in SUP_RE.finditer(h)} - {None}
    if carded - cited:
        out.append(f"{len(carded - cited)} carded paper(s) no sentence cites: {sorted(carded - cited)[:4]}")
    if cited - carded:
        out.append(f"{len(cited - carded)} cited paper(s) the brief does not card: {sorted(cited - carded)[:4]}")
    first = {}
    for m in SUP_RE.finditer(h):
        q = _pmid_of(m.group(0))
        n = re.search(r'mz-ref-link"[^>]*>(\d+)<', m.group(0))
        if q and n and q not in first:
            first[q] = n.group(1)
    for d in re.finditer(r"<dialog\b[\s\S]*?</dialog>", h):
        q = (re.search(r'<dialog[^>]*\bid="dd-(\d{5,9})"', d.group(0)) or [None, None])[1]
        lab = re.search(r"Paper\s*#\s*(\d+)", d.group(0))
        if q and lab and q in first and lab.group(1) != first[q]:
            out.append(f"the deep dive for {q} says Paper #{lab.group(1)} where its marker says {first[q]}")
    return out


def reader_prose_faults(h: str) -> list:
    """S8, S9, S10 on the finished page: no patient-directed advice, no
    placeholder or AI-provenance language, no internal path, no bare MIGS, no
    never/always. Shared by the authoring path (prose_faults) and by
    `renumber`, which published without them until standards-check said so."""
    faults = list(body_invariant_faults(h))
    prose = " ".join(prose_fragments(h))
    text = H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", prose)))
    vis = _vis_text(h)
    m = ADVICE_RE.search(text)
    if m:
        faults.append(f"patient-directed advice in the site's own prose: {m.group(0)!r}")
    m = EXPERIENCE_RE.search(text)
    if m:
        faults.append(f"a claim about the practice's own patients, written from a paper: {m.group(0)!r}")
    if re.search(r"Pending[^<]{0,40}review", vis):
        faults.append("a reader-visible 'Pending review' placeholder remains")
    # In the site's OWN prose an abstract label is pasted text ("ETHODS:" —
    # W21 carried it with its first letter lost). Inside a card's verbatim
    # abstract the same label is PubMed's own structure and belongs there.
    m = re.search(r"\b(?:M?ETHODS|R?ESULTS|C?ONCLUSIONS?|B?ACKGROUND|O?BJECTIVES?|P?URPOSE|F?INDINGS)\s*:", text)
    if m:
        faults.append(f"raw abstract text in the site's own prose: {m.group(0)!r}")
    if re.search(r"\[Awaiting|\[\s*pending\s*\]|\[TODO", vis, re.I):
        faults.append("an authorship placeholder remains")
    m = PROVENANCE_RE.search(text)
    if m:
        faults.append(f"AI-provenance language in the site's own prose: {m.group(0)!r}")
    # inside a card or a deep dive, "LLM" is often the PAPER's subject (W20
    # carries an LLM-chatbot benchmark); only a first-person authorship claim
    # is provenance there
    m = re.search(r"\bas an? (?:AI|language model)\b|\bI am an? (?:AI|language model)\b"
                  r"|\b(?:written|generated|drafted|produced) by (?:an? )?(?:AI|LLM|model|assistant|ChatGPT|Claude)\b"
                  r"|\b(?:AI|machine|auto)[- ]generated\b", vis, re.I)
    if m:
        faults.append(f"AI-provenance language a reader can see: {m.group(0)!r}")
    m = INTERNAL_RE.search(vis)
    if m:
        faults.append(f"internal path or spec reference: {m.group(0)!r}")
    if re.search(r"(?<!CBG/)\bMIGS\b", text):
        faults.append("bare 'MIGS' in the site's own prose — write CBG/MIGS")
    m = absolute_claim(text)
    if m:
        faults.append(f"an absolutist clinical claim in the site's own prose: {m.group(0)!r}")
    return faults


def prose_faults(W: str, h: str, man: dict) -> list:
    faults = list(reader_prose_faults(h))
    prose = " ".join(prose_fragments(h))
    text = H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", prose)))
    # headings are reader-visible, and _sentences() strips them before the
    # per-sentence audit, so nothing else was reading them
    heads = " ".join(H.unescape(re.sub(r"<[^>]+>", " ", x)) for x in
                     re.findall(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", h))
    for label, rx in (("internal name or path", INTERNAL_RE), ("AI-provenance language", PROVENANCE_RE)):
        mh = rx.search(heads)
        if mh:
            faults.append(f"{label} in a heading: {mh.group(0)!r}")
    if re.search(r"(?<!CBG/)\bMIGS\b", heads, re.I):
        faults.append('bare "MIGS" in a heading (write CBG/MIGS)')
    if re.search(r"\b(?:never|always)\b", heads, re.I):
        faults.append('"never"/"always" in a heading')
    # S10
    if re.search(r"(?<!CBG/)\bMIGS\b", text, re.I):
        faults.append("bare \"MIGS\" in the site's own prose (write CBG/MIGS)")
    ab = re.findall(r"\b(?:never|always)\b", text, re.I)
    if ab:
        faults.append(f"\"never\"/\"always\" in the clinician's prose ({len(ab)}x)")
    # S8
    m = ADVICE_RE.search(text)
    if m:
        faults.append(f"reads as advice to a patient: {m.group(0)!r}")
    # S9, over the whole visible body
    vis = H.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>|<!--[\s\S]*?-->", " ", h)))
    m = PROVENANCE_RE.search(vis)
    if m:
        faults.append(f"AI-provenance language visible: {m.group(0)!r}")
    m = INTERNAL_RE.search(vis)
    if m:
        faults.append(f"internal name or path visible: {m.group(0)!r}")
    # S1 + S6, sentence by sentence
    abstracts = {}
    for q in man["pmids"]:
        pf = W + f"papers/{q}.json"
        if os.path.exists(pf):
            pj = json.load(open(pf))
            abstracts[q] = _pool_tokens((pj.get("pubmed_abstract") or pj.get("abstract") or "")
                                        + " " + (pj.get("meta") or "") + " " + (pj.get("title") or ""))
    uncited_claims, bad_numbers, preclinical = [], [], []
    for frag in prose_fragments(h):
        pc = piece_of(h, frag)
        for sent in _sentences(frag):
            cites = re.findall(r"⟦(\d+)⟧", sent)
            bare = re.sub(r"⟦\d+⟧", " ", sent)
            has_number = (re.search(r"(?<![A-Za-z0-9-])\d[\d,]*(?:\.\d+)?(?![\w-])", bare)
                          or re.search(r"\bet al\b|\bcolleagues\b", bare))
            if has_number and not cites:
                uncited_claims.append(f"[{pc}] {bare[:110]}")
                continue
            if cites:
                # pooling every cited abstract lets a number from paper A pass
                # in a sentence that attributes it to paper B; the pool is the
                # union only because one sentence may legitimately draw on
                # several, but a sentence citing ONE paper is checked against
                # that paper alone
                pool = (abstracts.get(cites[0], set()) if len(cites) == 1
                        else set().union(*[abstracts.get(c, set()) for c in cites])) if cites else set()
                for tok in re.findall(r"\d[\d,]*(?:\.\d+)?", bare):
                    t = tok.replace(",", "")
                    if (len(t) >= 2 or "." in t) and not re.fullmatch(r"(?:19|20)\d\d", t) and t not in pool:
                        bad_numbers.append(f"[{pc}] {t} (cites {', '.join(cites)})")
                for c in cites:
                    a = (json.load(open(W + f"papers/{c}.json")) if os.path.exists(W + f"papers/{c}.json") else {}).get("abstract", "")
                    # NOTE: no regex check here. Whether a sentence presents a
                    # preclinical result as a human finding is judged per
                    # sentence by grounding_audit, which reads the claim. The
                    # regex fired whenever an abstract mentioned "in vitro"
                    # and the sentence mentioned women — which is most
                    # mechanistic commentary, correctly written.
                    pass
    # a card's prose is attributed by its container, so the container must
    # actually carry that attribution: a link to the study and its deep dive
    for mcard in CARD_RE.finditer(h):
        c = mcard.group(0)
        pmc = _pmid_of(c) or (re.search(r"openDeepDive\('dd-(\d+)'", c) or [None, None])[1]
        if not pmc:
            faults.append("a cite card names no paper")
            continue
        if f"pubmed.ncbi.nlm.nih.gov/{pmc}" not in c:
            faults.append(f"[card:{pmc}] the card carries no link to the study it summarises")
        if f"dd-{pmc}" not in c:
            faults.append(f"[card:{pmc}] the card has no deep-dive trigger")
        # the other two things the standard says a card carries
        pfc = W + f"papers/{pmc}.json"
        if os.path.exists(pfc):
            pjc = json.load(open(pfc))
            # BOTH sides normalised identically: stripping the hyphen from
            # "Salmonella-induced" on one side only made 26 correct cards fail
            norm = lambda x: re.sub(r"[^a-z0-9 ]", " ", H.unescape(re.sub(r"<[^>]+>", " ", x)).lower())
            card_txt = " ".join(norm(c).split())
            ttl = norm(pjc.get("title") or "").split()
            if ttl and not all(w in card_txt.split() for w in ttl[:6]):
                faults.append(f"[card:{pmc}] the card does not carry the paper's title")
            jrn = (pjc.get("journal") or "").lower()
            if jrn and jrn.split()[0] not in card_txt:
                faults.append(f"[card:{pmc}] the card does not carry the paper's journal line")
    for pm, card in card_texts(h):
        ct = H.unescape(re.sub(r"<[^>]+>", " ", card))
        if re.search(r"(?<!CBG/)\bMIGS\b", ct, re.I) or re.search(r"\b(?:never|always)\b", ct, re.I) or ADVICE_RE.search(ct):
            faults.append(f"[card:{pm}] bare MIGS, never/always, or advice in the lens paragraph")

        for t in _num_tokens(ct):
            if (len(t) >= 2 or "." in t) and not re.fullmatch(r"(?:19|20)\d\d", t) and t not in abstracts.get(pm, set()):
                faults.append(f"[card:{pm}] number {t} is not in the paper's abstract")
                break
    for x in uncited_claims:
        faults.append(f"{x[:x.index(']') + 1]} sentence states a number or study with no citation: {x[x.index(']') + 2:]}")
    for x in bad_numbers:
        faults.append(f"{x[:x.index(']') + 1]} number absent from the cited abstracts: {x[x.index(']') + 2:]}")
    for x in preclinical:
        faults.append(f"{x[:x.index(']') + 1]} animal/in-vitro paper described as a human finding: {x[x.index(']') + 2:]}")
    # S5: every kept paper's abstract section carries PubMed's text whole
    alnum = lambda x: re.sub(r"[^a-z0-9]", "", H.unescape(re.sub(r"<[^>]+>", " ", x)).lower())
    for q in man["pmids"]:
        pf = W + f"papers/{q}.json"
        if not os.path.exists(pf):
            continue
        src = json.load(open(pf)).get("pubmed_abstract") or ""
        if not src:
            faults.append(f"{q}: no PubMed abstract on record — prepare did not reconcile it")
            continue
        dm = re.search(r'<dialog[^>]*id="dd-%s"[^>]*>([\s\S]*?)</dialog>' % re.escape(q), h)
        sec = re.search(r'id="dd-%s-abstract"[^>]*>([\s\S]*?)</section>' % re.escape(q), dm.group(1)) if dm else None
        # Strip the section's own <h3> ("Verbatim PubMed abstract") — but NOT
        # the <h5> labels, which ARE the abstract's own BACKGROUND/METHODS
        # headings rendered as markup. Stripping those removed text PubMed's
        # copy contains, so every correctly written abstract failed.
        sec_body = re.sub(r"<h3[^>]*>[\s\S]*?</h3>", " ", sec.group(1)) if sec else ""
        # What this check exists to catch is a TRUNCATED abstract or ANOTHER
        # paper's abstract — both of which shipped. Exact-substring equality
        # also fails on a single escaped character, and a check that fails on
        # correct content is one someone eventually forces past. Opening,
        # ending and length together catch both real failures and survive the
        # markup.
        a_src, a_body = alnum(src), alnum(sec_body)
        if not sec:
            faults.append(f"{q}: the deep dive has no abstract section")
        elif len(a_src) > 200 and a_src not in a_body:
            # EQUALITY, not head + tail + length: a middle passage reworded or
            # dropped passed the old heuristic while the label still said
            # "verbatim" (standards-check, 2026-09-20).
            cut = next((i for i in range(min(len(a_src), len(a_body))) if a_src[i] != a_body[i]), min(len(a_src), len(a_body)))
            faults.append(f"{q}: the deep dive's abstract is not PubMed's text whole — it diverges at "
                          f"character {cut} ({a_src[max(0, cut - 40):cut + 40]!r} vs "
                          f"{a_body[max(0, cut - 40):cut + 40]!r})")
    # S5: every journal-club section of every kept paper carries real prose
    for q in man["pmids"]:
        dm = re.search(r'<dialog[^>]*id="dd-%s"[^>]*>([\s\S]*?)</dialog>' % re.escape(q), h)
        if not dm:
            continue
        for key in JC_KEYS:
            sm = re.search(r'id="dd-%s-%s"[^>]*>([\s\S]*?)</section>' % (re.escape(q), re.escape(key)), dm.group(1))
            if not sm:
                faults.append(f"[dialog:{q}] deep dive has no {key} section")
                continue
            inner_t = H.unescape(re.sub(r"<[^>]+>", " ",
                                        re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", " ", sm.group(1))))
            if len(inner_t.strip()) < 120:
                faults.append(f"[dialog:{q}] the {key} section is empty or a stub")
    # S12 (weekly)
    if man.get("format") != "trend":
        for tid in man["topics"]:
            st = re.search(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[^>]*>([\s\S]*?)(?=<section class="[^"]*\btopic-section\b|<section class="[^"]*mz-references|<dialog|$)' % re.escape(tid), h)
            syn = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', st.group(1)) if st else None
            if not syn or len(re.sub(r"<[^>]+>", "", SUP_RE.sub("", syn.group(1)))) < 1000:
                faults.append(f"topic {tid} has no synthesis paragraph of substance above its cards")
        chips = re.findall(r'<a[^>]*class="[^"]*mz-toc-chip[^"]*"[^>]*href="#([^"]+)"', h)
        if sorted(chips) != sorted(man["topics"]):
            faults.append("the jump-to-topic TOC does not list exactly the live topics")
        nm = re.search(r'<section class="[^"]*mz-post-narrative[^"]*"[^>]*>([\s\S]*?)</section>', h)
        if not nm or len(re.sub(r"<[^>]+>", "", SUP_RE.sub("", nm.group(1)))) < 2400:
            faults.append("the opening narrative is missing or too short")
    # deep-dive sections are the clinician's prose too: terms, advice, styling
    for pm, inner_d in re.findall(r'<dialog[^>]*id="dd-(\d+)"[^>]*>([\s\S]*?)</dialog>', h):
        body_d = re.sub(r'<section class="mz-jc-section[^"]*" id="dd-\d+-abstract"[\s\S]*?</section>', " ", inner_d)
        body_d = strip_template(body_d)
        # "Where this sits in the established literature" cites guidelines and
        # prior work ON PURPOSE — an ACOG recommendation to give antibiotics
        # within 60 minutes is not a figure from this paper's abstract, and
        # checking it against that abstract flagged correct sourcing.
        body_d = re.sub(r'<section class="mz-jc-section[^"]*" id="dd-\d+-kb"[\s\S]*?</section>', " ", body_d)
        dt = H.unescape(re.sub(r"<[^>]+>", " ", body_d))
        if re.search(r"(?<!CBG/)\bMIGS\b", dt, re.I):
            faults.append(f"[dialog:{pm}] bare MIGS"); 
        if re.search(r"\b(?:never|always)\b", dt, re.I):
            faults.append(f"[dialog:{pm}] never/always in the clinician's prose")
        if ADVICE_RE.search(dt):
            faults.append(f"[dialog:{pm}] reads as advice to a patient")
        if re.search(r'<section class="mz-jc-section[^"]*" id="dd-\d+-(?!abstract)[a-z_]+"[^>]*>[\s\S]*?style="[^"]*(?:color|background)', body_d):
            faults.append(f"[dialog:{pm}] inline colour styling in authored content")
        for t in _num_tokens(dt):
            if (len(t) >= 2 or "." in t) and not re.fullmatch(r"(?:19|20)\d\d", t) and t not in abstracts.get(pm, set()):
                faults.append(f"[dialog:{pm}] number {t} is not in the paper's abstract")
                break
    for frag in prose_fragments(h) + [c for _, c in card_texts(h)]:
        if re.search(r'style="[^"]*(?:color|background)', frag):
            faults.append("inline colour styling in authored prose")
            break
    # S14: page-wide unique ids
    from collections import Counter as _C
    dup = [k for k, v in _C(re.findall(r'\sid="([^"]+)"', h)).items() if v > 1]
    if dup:
        faults.append(f"duplicate element ids on the page: {dup[:5]}")
    # S3 is a property of the RENDERED page — whether hovering a marker really
    # reveals the summary — so audit_citation_popovers.py measures it on the
    # published route after publish. The check that stood here looked for the
    # very string this stage injects moments earlier, so it could never fail.
    return faults




def popover_audit(W: str, h: str) -> list:
    """Every citation popover's summary, judged against its own paper.

    A reader meets the popover before the study; a generic or wrong summary
    there is the citation lying. Presence of the field was checked; what it
    said was not, except inside a bundled per-synthesis verdict.
    """
    seen, items = set(), []
    for sup in SUP_RE.findall(h):
        pm = _pmid_of(sup)
        f = re.search(r'<span class="mz-ref-pop-finding">([\s\S]*?)</span>', sup)
        if not pm or not f or pm in seen:
            continue
        seen.add(pm)
        pf = W + f"papers/{pm}.json"
        if not os.path.exists(pf):
            continue
        pj = json.load(open(pf))
        items.append({"pmid": pm, "finding": H.unescape(re.sub(r"<[^>]+>", " ", f.group(1))).strip(),
                      "paper_title": pj.get("title", ""), "abstract": (pj.get("pubmed_abstract") or pj.get("abstract") or "")[:3500]})
    faults = []
    for i in range(0, len(items), 8):
        chunk = items[i:i + 8]
        v = _claude(f"""Judge each citation popover summary against its own paper's abstract.
A popover is what a reader sees when hovering a citation marker, so it must be: plain language (not a
paste of the abstract, not a generic sentence that could sit under any paper), the study's own
conclusion with its numbers and design, and a closing sentence saying how it bears on the claim
("Monday:" or "Relevance:"), 250-600 characters, with nothing in it the abstract does not support.
POPOVERS: {json.dumps(chunk, ensure_ascii=False)[:90000]}
Reply with ONLY {{"popovers": [{{"pmid": "...", "ok": true|false, "why": "<one clause when not ok>"}}, ...]}}
with one object for each popover given.""", timeout_s=900)
        if not v or not isinstance(v.get("popovers"), list):
            die("popover audit returned no verdict")
        judged_p = {str(r.get("pmid")) for r in v["popovers"]}
        missing_p = [x["pmid"] for x in chunk if x["pmid"] not in judged_p]
        if missing_p:
            die(f"popover audit skipped {missing_p[:5]} — a skipped popover is not a passed one")
        for r in v["popovers"]:
            if not r.get("ok"):
                faults.append(f"[popover:{r.get('pmid')}] citation summary: {str(r.get('why', ''))[:120]}")
    return faults



def trend_prose_audit(W: str, h: str, man: dict) -> list:
    """Headlines, subheadings and tone of the assembled trend brief, per section.

    Judged on the published body, not only on the parts at authoring time: a
    heading that reads as a scoreboard, or a sentence the person who made the
    claim would experience as a sneer, defeats the point of these briefs.
    """
    secs = []
    for m in re.finditer(r'<section class="mz-post-section[^"]*"[^>]*id="([^"]+)"[^>]*>\s*<h2[^>]*>([\s\S]*?)</h2>([\s\S]*?)</section>', h):
        secs.append({"id": m.group(1), "heading": H.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip(),
                     "text": H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", m.group(3))))[:6000]})
    subs = [{"id": a, "subheading": H.unescape(re.sub(r"<[^>]+>", "", b)).strip()}
            for a, b in re.findall(r'<h3 class="mz-subhead" id="([^"]+)"[^>]*>([\s\S]*?)</h3>', h)]
    v = _claude(f"""You are judging a brief that checks a viral health claim against the literature. The reader may be the
person who made the claim; the brief exists to inform them, not to score against them.
For EACH section: is its heading a clear, specific signpost a reader can navigate by (not a label, not
a scoreboard, not vague)? Is every sentence free of sneering, gotcha framing, or language that treats
the claim's author as a mark — while still stating plainly where the evidence is thin?
Judge EACH subheading separately: is it a clear, specific name for that item that a reader can
navigate by? One aggregate answer lets an unclear one through on a "mostly fine" impression.
SECTIONS: {json.dumps(secs, ensure_ascii=False)[:90000]}
SUBHEADINGS: {json.dumps(subs, ensure_ascii=False)[:8000]}
Reply with ONLY {{"sections": [{{"id": "...", "heading_ok": true|false, "tone_ok": true|false, "why": "..."}}, ...],
  "subheadings": [{{"id": "...", "ok": true|false, "why": "..."}}, ...]}} with one object per section
AND one object per subheading given."""
                , timeout_s=900)
    if not v or not isinstance(v.get("sections"), list):
        die("trend prose audit returned no verdict")
    judged = {str(r.get("id")) for r in v["sections"]}
    missing = [x["id"] for x in secs if x["id"] not in judged]
    if missing:
        die(f"trend prose audit skipped section(s) {missing[:5]} — a skipped section is not a passed one")
    faults = []
    for r in v["sections"]:
        if not r.get("heading_ok"):
            faults.append(f"[editorial] heading of {r.get('id')}: {str(r.get('why', ''))[:110]}")
        if not r.get("tone_ok"):
            faults.append(f"[editorial] tone in {r.get('id')}: {str(r.get('why', ''))[:110]}")
    sub_v = v.get("subheadings")
    if not isinstance(sub_v, list):
        die("trend prose audit returned no per-subheading verdicts")
    judged_s = {str(r.get("id")) for r in sub_v}
    missing_s = [x["id"] for x in subs if x["id"] not in judged_s]
    if missing_s:
        die(f"trend prose audit skipped subheading(s) {missing_s[:5]}")
    for r in sub_v:
        if not r.get("ok"):
            faults.append(f"[{r.get('id')}] subheading: {str(r.get('why', ''))[:110]}")
    return faults


def grounding_audit(W: str, h: str, man: dict) -> list:
    """Every sentence of the site's own prose, judged against the abstracts it cites.

    No regex expresses "a factual claim with no citation", "a finding the cited
    abstract does not support", "an animal result written as a human one" or
    "advice to a patient" in novel phrasing. So the model judges every sentence,
    deterministically — each prose container is one call, each sentence gets an
    explicit verdict, and any failing sentence refuses the body. The verdict is
    recorded with the body's digest; publish requires it.
    """
    abstracts = {}
    for q in man["pmids"]:
        pf = W + f"papers/{q}.json"
        if os.path.exists(pf):
            pj = json.load(open(pf))
            abstracts[q] = {"title": pj.get("title", ""), "abstract": pj.get("pubmed_abstract") or pj.get("abstract") or ""}
    faults, results = [], []
    frags = [(f_, None, piece_of(h, f_)) for f_ in prose_fragments(h)]
    # a card's paragraph is attributed to one paper: audited against that paper alone
    frags += [(f'<p>{t}</p>', pm, f"card:{pm}") for pm, t in card_texts(h)]
    # every deep-dive's authored sections, minus the verbatim abstract, judged
    # against that paper: "monday" is first-person clinical prose and the most
    # advice-prone text on the page, and nothing exhaustive read it before
    # headings are reader-visible prose too: the per-sentence audit strips them
    # from every other fragment, so they are submitted as their own fragment
    head_txt = " ".join(H.unescape(re.sub(r"<[^>]+>", " ", x)).strip().rstrip(".") + "."
                        for x in re.findall(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", h))
    if head_txt.strip():
        frags.append((f"<p>{H.escape(head_txt, quote=False)}</p>", None, "headings"))
    for pm, inner_d in re.findall(r'<dialog[^>]*id="dd-(\d+)"[^>]*>([\s\S]*?)</dialog>', h):
        secs_d = re.sub(r'<section class="mz-jc-section[^"]*" id="dd-\d+-abstract"[\s\S]*?</section>', " ", inner_d)
        secs_d = re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", " ", secs_d)
        if re.sub(r"<[^>]+>", "", secs_d).strip():
            frags.append((secs_d, pm, f"dialog:{pm}"))
    for i, (frag, card_pm, pc) in enumerate(frags):
        sents = _sentences(frag)
        if not sents:
            continue
        # A card IS its paper's attributed container: it carries that paper's
        # title, its meta line and a link to the study, so its prose needs no
        # inline marker. That structure is CHECKED in prose_faults rather than
        # assumed, and these sentences are judged for support against that
        # paper — synthesising a citation token here graded every card as
        # cited by construction instead of by evidence.
        cited = sorted({c for sn in sents for c in re.findall(r"⟦(\d+)⟧", sn)}
                       | ({card_pm} if card_pm else set()))
        ctx = {c: abstracts[c] for c in cited if c in abstracts}
        listing = "\n".join(f"[{n}] {sn}" for n, sn in enumerate(sents, 1))
        v = _claude(f"""You are auditing the sentences of a clinical brief against the abstracts they cite. Citations
appear as ⟦PMID⟧ tokens inside the sentence they belong to.
SENTENCES:
{listing}
CITED ABSTRACTS (the only permitted sources for these sentences):
{json.dumps(ctx, ensure_ascii=False)[:90000]}
For EVERY sentence return one object:
 n: its number
 claim: true if it asserts a fact about a study, a finding, a number, a population, a mechanism, a
        design, or what the literature shows; false for the author's own interpretation, a question,
        a transition, or a statement about the brief itself
 cited: true if the sentence carries at least one ⟦PMID⟧ token
 placement: false if any factual claim in the sentence is not followed by the citation that supports it
        — a marker parked at the end of a sentence carrying two different studies' findings attributes
        neither, and a marker sitting before its claim or on the wrong clause fails the same way. true
        when every claim is followed by its own citation; null only when the sentence makes no claim
 supported: for a cited claim, true only if every factual element is traceable to the cited abstracts
            (no invented number, population, comparator, outcome or direction; no overstatement or
            understatement); null when claim is false
 preclinical_as_human: true if a cited abstract reports animal or in-vitro work and the sentence
            presents that finding as a human or clinical result
 advice: true if the sentence tells a patient what to do (any phrasing)
 dose: true if the sentence states an amount of a drug or supplement to take
 provenance: true if the sentence refers to how the text was produced (a model, an assistant, an
        automated draft, a pending review, a placeholder, an internal file or process) in ANY wording
 internal: true if the sentence names something internal to how this site is built rather than the
        literature — a file, a path, a spec or section number, a style guide, a pipeline or tool
 note: one clause of evidence when any flag is true
Be adversarial: default to supported=false when you cannot trace an element.
Reply with ONLY {{"sentences": [ {{...}}, ... ]}} with exactly {len(sents)} objects.""", timeout_s=900)
        if not v or not isinstance(v.get("sentences"), list):
            die(f"grounding audit returned no verdict for prose container {i + 1}")
        # An audit that judged only some of the units has not audited. Accepting
        # whatever subset came back made the one exhaustive semantic check for
        # citation-per-claim and grounding quietly non-exhaustive.
        judged = {int(r["n"]) for r in v["sentences"] if str(r.get("n", "")).strip().isdigit()}
        unjudged = [n for n in range(1, len(sents) + 1) if n not in judged]
        if unjudged:
            die(f"grounding audit skipped {len(unjudged)} of {len(sents)} sentence(s) in {pc} "
                f"— no verdict for {unjudged[:5]}")
        for r in v["sentences"]:
            try:
                n = int(r.get("n")); sn = sents[n - 1]
            except Exception:
                continue
            bad = []
            # a heading is a signpost and a card is its paper's own container:
            # neither carries an inline marker, so neither is judged for one.
            # What they ARE judged for: support, advice, dosing, provenance.
            if r.get("claim") and not r.get("cited") and not card_pm and pc != "headings":
                bad.append("claim without a citation")
            # Card and deep-dive prose carries no inline marker because the
            # container IS the attribution; gating "supported" on a marker made
            # the overstatement check silent for exactly the text that states
            # the one number that matters.
            if r.get("claim") and r.get("supported") is False and (r.get("cited") or card_pm):
                bad.append("not supported by the paper this text is attributed to")
            if pc == "headings" and r.get("dose"):
                r["dose"] = False
            if card_pm and r.get("dose"):
                # a study's own dose inside an attributed container is permitted
                r["dose"] = False
            if r.get("placement") is False and not card_pm and pc != "headings":
                bad.append("a citation does not follow each claim in the sentence")
            for k in ("preclinical_as_human", "advice", "dose", "provenance", "internal"):
                if r.get(k):
                    bad.append(k.replace("_", " "))
            if bad:
                shown = re.sub(r"\u27e6\d+\u27e7", "", sn)[:120]
                note = str(r.get("note", ""))[:100]
                faults.append(f"[{pc}] {'; '.join(bad)}: \"{shown}\" ({note})")
            results.append({"container": i + 1, "n": n, "flags": bad, "note": r.get("note")})
    import hashlib as _hl
    json.dump({"digest": _hl.sha256(h.encode("utf-8")).hexdigest()[:16],
               "faults": faults, "sentences": results},
              open(W + ".ledger/apply.grounding.json", "w"), indent=1, ensure_ascii=False)
    return faults


def finish_and_audit(W: str, post_id: str, post: dict, h: str, man: dict, dropped: list, repairs: dict, stats: dict) -> None:
    """Shared tail for every brief shape: references, light theme, hygiene,
    disclaimer, post-conditions, the site's own publish audit, the review."""
    # citations: numbered in order of first appearance; references to match
    verified_meta = {}
    for q in man["pmids"]:
        pf = W + f"papers/{q}.json"
        if os.path.exists(pf):
            mv = json.load(open(pf)).get("meta_verified")
            if mv:
                verified_meta[q] = mv
    real = real_from_work(W, man["pmids"])
    h = recount_headings(h)
    h = normalize_card_ids(h)
    h = refresh_shape_chart(h)
    h = renumber_list_labels(h)
    h = tidy_prose_spacing(h)
    h, refreshed = refresh_popovers_from_abstracts(W, h, real)
    if refreshed:
        print(f"  {refreshed} hover card(s) written from the papers' abstracts")
    h, added, declined = cite_and_review(W, h, list(man["pmids"]), real)
    if declined:
        print(f"  NOTE: named but judged not to rest on the paper (the targeted pass asked about each): {declined[:8]}")
    stats["citations_added"] = added
    h = breakable_marker_runs(h)
    h, cite_order = number_citations(h, verified_meta)
    h = build_references(W, h, cite_order, verified_meta)
    stats["citations"] = len(cite_order)
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
    if "mz-open" not in h:
        h = h.rstrip() + TOUCH_SCRIPT
    # the source's own section-intro boilerplate carries imperatives the site's
    # own rule forbids ("Always check what the paper says is the primary
    # outcome"); it is template text, not a clinician's claim, so it is
    # rewritten rather than left to fail a check it cannot answer
    h = re.sub(r"\bAlways check\b", "Check", h)
    h = re.sub(r"\bNever assume\b", "Do not assume", h)
    h = escape_bare_angles(h)
    h = dedupe_popover_ids(h)
    h = dedupe_element_ids(h)
    h = strip_build_comments(h)
    h = h.replace("(parity with \u00a73.8 trend brief)", "(parity with the trend brief)")
    if "mz-eddisclaimer" not in h:
        m = re.search(r'<ol class="mz-references-list"', h)
        sec = h.rfind("<section", 0, m.start() if m else len(h))
        h = h[:sec] + DISCLAIMER + h[sec:]

    # ---- POST-CONDITIONS. Each of these is a fault that actually shipped. ----
    prose = site_prose(h)
    faults = []
    # No dose check on a brief. These are clinician-facing; the rule governs the
    # patient-facing home page and educational materials, which
    # scripts/check_patient_pages_dosing.py gates at deploy.
    _vis = re.sub(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", " ", h)
    if re.search(r"Pending[^<]{0,40}review", _vis):
        faults.append("a reader-visible 'Pending review' placeholder remains")
    # S9 applies to every brief, not only the trend format, where this check
    # used to sit inside the trend-only branch beside the verdict-gauge rule
    if re.search(r"\[Awaiting|class=\"[^\"]*mz-placeholder|\[\s*pending\s*\]|\[TODO", _vis, re.I):
        faults.append("an authorship placeholder remains")
    # cards and deep-dive dialogs are reader-visible too; site_prose strips
    # them as attributed text, so provenance language written into a card was
    # invisible to this gate (standards-check, 2026-09-20)
    if PROVENANCE_RE.search(_vis_text(h)):
        faults.append(f"AI-provenance language a reader can see: {PROVENANCE_RE.search(_vis_text(h)).group(0)!r}")
    if INTERNAL_RE.search(H.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", " ", h)))):
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
    if "<!--" in h:
        faults.append("an HTML comment remains in the body")
    for sup in re.findall(r'<sup class="mz-ref">.*?</sup>', h, re.S):
        if "mz-ref-pop-finding" not in sup or "mz-ref-pop-src" not in sup:
            faults.append("a citation popover lacks its summary or source link")
            break
    # every kept paper is cited in the site's own prose; markers are 1..n in
    # order of first appearance and resolve to the reference list, which is in
    # the same order and contains exactly the cited papers
    kept = list(man["pmids"])
    uncited = [q for q in kept if q not in cite_order]
    if uncited:
        faults.append(f"{len(uncited)} kept paper(s) cited nowhere in the prose: {uncited[:6]}")
    # and the other direction: a marker pointing at a paper this brief does not
    # carry — a hallucinated or dropped PMID renders fine and would otherwise
    # pass every check, since build_references falls back to a bare "PMID n"
    stray = [q for q in cite_order if q not in set(kept)]
    if stray:
        faults.append(f"citation(s) to paper(s) this brief does not carry: {stray[:6]}")
    marker_text = [re.sub(r"<[^>]+>", "", m).strip() for m in re.findall(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', h, re.S)]
    if any(re.fullmatch(r"\d{5,9}", t) for t in marker_text):
        faults.append("a citation marker still shows a PMID instead of its number")
    seen, expect = [], 1
    for pm in [ _pmid_of(x) for x in SUP_RE.findall(h) ]:
        if pm and pm not in seen:
            seen.append(pm)
    for i_, m in enumerate(SUP_RE.findall(h)):
        pm = _pmid_of(m); t = re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', m, re.S) or [None, ""])[1]).strip()
        if pm in seen and t != str(seen.index(pm) + 1):
            faults.append(f"citation marker for PMID {pm} reads {t!r}, expected {seen.index(pm) + 1}")
            break
    ref_ids = re.findall(r'<li id="ref-(\d+)">', h)
    if ref_ids != cite_order:
        faults.append("the reference list is not in citation order or does not match the cited set")
    for sup in SUP_RE.findall(h):
        pmv = _pmid_of(sup)
        want = (json.load(open(W + f"papers/{pmv}.json")).get("meta_verified")
                if pmv and os.path.exists(W + f"papers/{pmv}.json") else None)
        if not want:
            continue
        got = re.search(r'<span class="mz-ref-pop-meta">([\s\S]*?)</span>', sup)
        if not got or H.unescape(re.sub(r"<[^>]+>", "", got.group(1))).strip() != want:
            faults.append(f"[popover:{pmv}] the journal/year line is not the one PubMed gives")
            break
    for href in set(re.findall(r'<a class="mz-ref-link" href="#(ref-\d+)"', h)):
        if f'id="{href}"' not in h:
            faults.append(f"citation marker points at a missing reference {href}")
            break
    faults += prose_faults(W, h, man)
    if not faults:
        # the sentence-level model audit runs only on a body that passed every
        # mechanical check, so a malformed body is not paid for twice
        g = grounding_audit(W, h, man) + popover_audit(W, h)
        if man.get("format") == "trend":
            g += trend_prose_audit(W, h, man)
        for f_ in g:
            print("  GROUNDING:", f_)
        faults += g
    body_text = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", h)))
    for pmid, abstract in repairs.items():
        # Probe on prose, not on a structured label: apply() renders
        # "INTRODUCTION:" as <h5>Introduction</h5>, so the raw label text is
        # correctly absent from the body. An earlier probe included it and
        # reported a false failure on a repair that had in fact landed.
        # NOT `prose`: that name holds the site's own prose for the checks
        # above, and reusing it here made the trend scoring-language gate scan
        # a stray abstract fragment instead of the brief.
        abstract_prose = re.sub(r"(^|\n)[A-Z][A-Z /&-]{2,40}:\s*", " ", abstract)
        probe = re.sub(r"\s+", " ", abstract_prose).strip()[:48]
        if len(probe) >= 24 and probe not in body_text:
            faults.append(f"repaired abstract for {pmid} did not reach the body")
    if man.get("format") == "trend":
        # the trend spine is re-verified on the assembled body, exactly as the
        # weekly spine is: an authoring guarantee with no apply-stage check is
        # the "comment is not a control" failure this file exists to prevent
        for sid, label, floor in (("opening", "the opening section", 400),
                                  ("bottom-line", "Bottom line, up front", 600),
                                  ("evidence", "the item-by-item section", 1000),
                                  ("lens", "the DO + CBG/MIGS lens", 500),
                                  ("bridge", "Where the two sides can meet", 500),
                                  ("gaps", "the gaps section", 300),
                                  ("closing", "the closing", 150)):
            sm = re.search(r'<section class="mz-post-section[^"]*"[^>]*id="%s"[^>]*>([\s\S]*?)</section>' % sid, h)
            if not sm:
                faults.append(f"[editorial] {label} is missing from the assembled body")
            elif len(re.sub(r"<[^>]+>", "", SUP_RE.sub("", re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", " ", sm.group(1))))) < floor:
                faults.append(f"[editorial] {label} is present but has no substance")
        if re.search(r'mz-verdict|REVIEW REQUIRED', h):
            faults.append("a verdict gauge or its label remains")

        # S13's language rule covers the CARD LENS paragraphs too: site_prose
        # strips cite cards as attributed text, so a "verdict"/"myth" written
        # into a card was never scanned (standards-check, 2026-09-20).
        card_prose = " ".join(re.sub(r"<[^>]+>", " ", re.sub(r"<details[\s\S]*?</details>", " ", c))
                              for c in CARD_RE.findall(h))
        bad = re.findall(r"\b(verdicts?|debunk\w*|myths?|misinformation|influencers?|false claims?)\b",
                         prose + " " + card_prose, re.I)
        if bad:
            faults.append(f"scoring language in the site's own prose: {sorted(set(b.lower() for b in bad))[:4]}")
        for tid in man["topics"]:
            m = re.search(r'<h3[^>]*id="%s"[^>]*>[\s\S]{0,600}?<p class="mz-framing"[^>]*>(?:<strong>)?([^<]+)' % re.escape(tid), h)
            if not m:
                faults.append(f"item {tid} has no headed subsection with a framing line")
            elif m.group(1).strip() not in FRAMINGS:
                faults.append(f"item {tid} carries a framing outside the fixed list: {m.group(1).strip()!r}")
    if faults:
        record(W, "apply", {"failed": "; ".join(faults)})
        for f in faults:
            print("  FAULT:", f)
        die(f"{post_id}: {len(faults)} post-condition(s) failed")

    # S16: the output is read back before it is written anywhere
    h = audit_transform(W, json.load(open(W + f"{post_id}.source.json"))["body_html"], h,
                    {q: "" for q in dropped}, [])

    post["body_html"] = h
    json.dump(post, open(W + f"{post_id}.applied.json", "w"), ensure_ascii=False)
    open(W + "body.applied.html", "w", encoding="utf-8").write(h)

    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs')"
        ".readFileSync('%s','utf8'));const a=m.auditPublishable(p);console.log(JSON.stringify("
        "{publishable:a.publishable,canonical:a.canonical,problems:a.problems}))})"
        % (ROOT, W + f"{post_id}.applied.json")], capture_output=True, text=True, cwd=ROOT)
    verdict = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    print(f"{post_id}: " + " ".join(f"{k}={v}" for k, v in stats.items()) + f" citations={len(re.findall(chr(60)+'sup class=.mz-ref', h))}")
    print(f"  post-conditions: all passed | auditPublishable: {json.dumps(verdict)}")
    if not verdict.get("publishable"):
        record(W, "apply", {"failed": json.dumps(verdict.get("problems"))[:400]})
        die("the publish audit refused this body")
    record(W, "apply", stats)
    ai_review(W, "apply")
    standards_audit(W, post_id)
    import hashlib as _hl
    json.dump({"body_sha256": _hl.sha256(h.encode("utf-8")).hexdigest(), "standards_passed": True,
               "grounding_passed": True, "pipeline_digest": _sha_file(os.path.abspath(__file__)),
               "checked_at": datetime.datetime.utcnow().isoformat() + "Z"},
              open(W + ".ledger/receipt.json", "w"), indent=1)
    print(f"  ledger: apply OK — publish may now run for {post_id}")


def cmd_apply(post_id: str) -> None:
    if is_trend(post_id):
        return cmd_apply_trend(post_id)
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
    # a paper dropped from one heading but kept under another leaves THAT
    # section only — W31's endometriosis drops kept elsewhere stayed carded
    # under endometriosis because only orphans were excised
    for tid, d in (curation.get("decisions") or {}).items():
        for x in d.get("drop") or []:
            if x.get("pmid") and x["pmid"] not in dropped:
                h = excise_paper_from_section(h, tid, x["pmid"])
    h = retitle_topics(h, curation.get("decisions") or {})
    # a topic whose papers all went, or one the manifest no longer lists,
    # takes exactly its own element with it (bounded at its closing tag — a
    # lookahead to the next boundary once ran into the reference list) and
    # its jump-list chip
    for tid in [t for t, d in (curation.get("decisions") or {}).items() if not d["keep"]] \
            + [t.tid for t in _topic_sections(h) if t.tid not in man["topics"]]:
        sec = _section_span(h, tid)
        if sec:
            h = h[:sec.start()] + h[sec.end():]
        h = re.sub(r'<a[^>]*class="[^"]*mz-toc-chip[^"]*"[^>]*href="#%s"[\s\S]*?</a>' % re.escape(tid), "", h)
        h = re.sub(r'<a[^>]*href="#%s"[^>]*class="[^"]*mz-toc-chip[^"]*"[\s\S]*?</a>' % re.escape(tid), "", h)
    h = recount_headings(h)
    # card lens paragraphs
    cards_written = 0
    for pmid in man["pmids"]:
        dp = W + f"drafts_dd/{pmid}.json"
        card = json.load(open(dp)).get("card") if os.path.exists(dp) else None
        if not card:
            continue
        am = re.search(r'(<article class="mz-cite-card[^"]*"[^>]*id="mz-cite-%s"[\s\S]*?)(<p class="mz-cite-fits">)([\s\S]*?)(</p>)' % re.escape(pmid), h)
        if am:
            h = h[:am.start(3)] + "<strong>DO + CBG/MIGS lens:</strong> " + H.escape(card, quote=False) + h[am.end(3):]
            cards_written += 1
    # the TOC is rebuilt from what survives, so drop the stale one
    h = re.sub(r'<nav class="mz-toc"[\s\S]*?</nav>', "", h)

    # 0. repaired abstracts. prepare() fixes the WORK FILE so authoring is
    # grounded correctly; without this step the page keeps showing whatever
    # wrong or truncated text it had. W31 carried a placeholder in all 88, and
    # the live W33 carried one abstract truncated to start at "METHODS:" while
    # labelled "Verbatim PubMed abstract".
    h, repairs, repaired_n = write_abstracts(W, man, h, dropped)

    h, applied = apply_sections(W, man, h)

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
        if nm:
            # narrative.json is the pipeline's verified narrative for THIS
            # composition; it replaces whatever the stored body carried, a
            # stub or an earlier authored version without inline citations
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

    finish_and_audit(W, post_id, post, h, man, dropped, repairs,
                     {"dropped": len(dropped), "cards": cards_written, "abstracts": repaired_n,
                      "sections": applied, "syntheses": syn_n})



def cmd_apply_trend(post_id: str) -> None:
    W = work_dir(post_id)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "curate");  require_review(W, "curate")
    require(W, "guard");   require_review(W, "guard")
    require_authored_after_curate(W)
    man = json.load(open(W + "manifest.json"))
    post = json.load(open(W + f"{post_id}.source.json"))
    h = post["body_html"]
    curation = json.load(open(W + "curation.json")) if os.path.exists(W + "curation.json") else {}
    dropped = curation.get("dropped_pmids") or []
    for pmid in dropped:
        h = excise_paper(h, pmid)
    for stale in (W + "body.applied.html",):
        if os.path.exists(stale):
            os.remove(stale)

    h, repairs, repaired_n = write_abstracts(W, man, h, dropped)
    h, applied = apply_sections(W, man, h)
    h = h.replace(' mz-jc-placeholder"', '"').replace('class="mz-jc-placeholder"', 'class="mz-jc-p"')

    parts = json.load(open(W + "narrative.json"))["parts"]
    syn = {i["tid"]: i for i in json.load(open(W + "syntheses.json"))["items"] if i.get("html")}
    missing = [t for t in man["topics"] if t not in syn]
    if missing:
        die(f"items without a verified subsection: {missing}")

    # --- hero: no gauge, no submitted-for-review line, an authored lede ---
    h = re.sub(r'<p class="mz-post-pubdate"[^>]*>[\s\S]*?</p>\s*', "", h, count=1)
    h = re.sub(r'<div class="mz-verdict-gauge"[\s\S]*?<p class="mz-verdict-label">[\s\S]*?</p>\s*</div>\s*', "", h, count=1)
    lm = re.search(r'(<p class="mz-post-lede">)([\s\S]*?)(</p>)', h)
    if not lm:
        die("hero has no lede paragraph")
    h = h[:lm.start(2)] + parts["lede"].strip() + h[lm.end(2):]

    # --- sections: rebuilt in a fixed order under clear headlines ---
    split = h.find("<dialog")
    head, tail = (h[:split], h[split:]) if split >= 0 else (h, "")
    hero_end = re.search(r'</section>', head[head.find('class="mz-post-hero"'):]).end() + head.find('class="mz-post-hero"')
    before, rest = head[:hero_end], head[hero_end:]
    old = {}
    for m in re.finditer(r'<section class="mz-post-section[^"]*"[^>]*>\s*<h2 class="mz-section-title"[^>]*>(.*?)</h2>([\s\S]*?)</section>', rest):
        old[H.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()] = m.group(0)
    def find_old(prefix):
        for k, v in old.items():
            if k.lower().startswith(prefix.lower()):
                return v
        return ""
    def sec(title, inner, extra_class="", sid=""):
        idattr = f' id="{sid}"' if sid else ""
        return (f'<section class="mz-post-section{(" " + extra_class) if extra_class else ""}"{idattr}>'
                f'<h2 class="mz-section-title">{title}</h2>{inner}</section>')
    items = ""
    for tid in man["topics"]:
        t = json.load(open(W + f"topics/{tid}.json"))
        it = syn[tid]
        items += (f'<h3 class="mz-subhead" id="{tid}">{H.escape(t["title"], quote=False)}</h3>'
                  f'<p class="mz-framing"><strong>{H.escape(it["framing"], quote=False)}</strong></p>'
                  f'<p class="mz-toc-group-synthesis">{it["html"].strip()}</p>')
    jumps = " &middot; ".join(f'<a href="#{tid}">{H.escape(json.load(open(W + f"topics/{tid}.json"))["title"], quote=False)}</a>' for tid in man["topics"])
    unit = (man.get("trend") or {}).get("unit") or "item"
    def with_id(section_html, sid):
        return re.sub(r'^<section class="([^"]*)"', r'<section class="\1" id="%s"' % sid, section_html, count=1) if section_html else ""
    new = [
        sec(H.escape(parts["tagline"], quote=False), parts["tagline_body"], "mz-post-narrative", "opening"),
        sec("Bottom line, up front", parts["bottom_line"], sid="bottom-line"),
        with_id(find_old("The shape of the evidence"), "shape"),
        sec(f"Where the evidence stands, {unit} by {unit}",
            parts["evidence_intro"] + f'<p class="mz-trend-jumps">{jumps}</p>' + items, sid="evidence"),
        sec("From a DO + CBG/MIGS lens", parts["lens"], sid="lens"),
        sec("Where the two sides can meet", parts["bridge"], sid="bridge"),
        with_id(find_old("What the studies show"), "papers"),
        sec("Where the literature doesn't go (yet)", parts["gaps"], sid="gaps"),
        sec("Closing thoughts", parts["closing"], sid="closing"),
    ]
    if not find_old("What the studies show"):
        die("the paper-by-paper section is missing from the source")
    # nothing else from the source publishes: a section this pipeline neither
    # authored nor audits has no gate in front of it, so it does not ship
    h = before + "".join(x for x in new if x) + tail
    # the source's empty references section goes; the finish builds a real one
    h = re.sub(r'<section class="[^"]*mz-references[^"]*"[^>]*>(?:(?!<li id="ref-)[\s\S])*?</section>', "", h)

    finish_and_audit(W, post_id, post, h, man, dropped, repairs,
                     {"dropped": len(dropped), "abstracts": repaired_n, "sections": applied,
                      "items": len(man["topics"])})




def preview_and_verify(W: str, post_id: str, kind_route: str) -> None:
    """Render the body in the reader's shell LOCALLY and run the rendered gates.

    verify_rendered() runs after approve, so a body that fails contrast or hover
    reached production and was pulled back — a reader could see it. This builds
    the same page the shell builds (its stylesheets, its container, the light
    theme script) from the body about to be published, serves it on localhost
    and measures it there. A failure refuses the publish instead of undoing it.
    """
    import http.server
    import socketserver
    import threading

    shell = open(os.path.join(ROOT, "evidence/index.html"), encoding="utf-8").read()
    styles = "".join(m.group(0) for m in re.finditer(r"<style[\s\S]*?</style>", shell))
    body = open(W + "body.applied.html", encoding="utf-8").read()
    light = ""
    lp = os.path.join(ROOT, "assets/js/post-light.js")
    if os.path.exists(lp):
        light = "<script>" + open(lp, encoding="utf-8").read() + "</script>"
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            + styles + "</head><body><main class=\"container\"><div id=\"detailContent\" "
            "data-mz-post-scope><div class=\"brief-detail-body\">" + body
            + "</div></div></main>" + light + "</body></html>")
    # per work directory: three briefs running at once shared one preview
    # file, so a gate could render another brief's body and judge this one by it
    d = os.path.join(W, "_preview")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "preview.html"), "w", encoding="utf-8").write(page)

    class Q(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=d, **k)

        def log_message(self, *a):
            pass

    with socketserver.TCPServer(("127.0.0.1", 0), Q) as httpd:
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        base = f"http://127.0.0.1:{port}"
        print(f"  pre-publish render check on {base}/preview.html")
        checks = [
            ["python3", os.path.join(ROOT, "scripts/audit_citation_popovers.py"), base, "--routes=/preview.html"],
            ["python3", os.path.join(ROOT, "scripts/audit_light_text.py"), base, "--routes=/preview.html"],
        ]
        # A flat 2400 s budget was a guess, and W21 (249 markers, each hovered
        # AND tapped) blew through it — the gate was killed mid-run and the
        # brief could not publish even though nothing was wrong with it. Budget
        # from the work itself: every marker is exercised twice, so give each
        # pass a real per-marker allowance plus browser start-up.
        markers = len(re.findall(r'<sup[^>]*class="[^"]*mz-ref', body))
        budget = min(9000, max(2400, 300 + markers * 2 * 8))
        if markers:
            print(f"  {markers} marker(s) to exercise — render-check budget {budget}s")
        try:
            for cmd in checks:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=budget,
                                   cwd=os.path.join(ROOT, "scripts"))
                if r.returncode != 0:
                    tail = (r.stdout + r.stderr).strip().splitlines()[-10:]
                    print("\n".join("    " + l for l in tail))
                    die(f"the rendered page fails {os.path.basename(cmd[1])} — refusing to publish it")
        finally:
            httpd.shutdown()
    print("  pre-publish render check: passed")


def verify_rendered(route: str, post_id: str) -> None:
    """S14 is a property of the RENDERED page, so it is measured on the
    published route with the site's own Playwright gates — near-invisible text
    and pixel contrast — immediately after approve. A failure unpublishes the
    post before anyone reads it and refuses the stage."""
    checks = [
        ["python3", os.path.join(ROOT, "scripts/audit_light_text.py"), BASE, f"--routes={route}"],
        ["python3", os.path.join(ROOT, "scripts/audit_contrast_pixels.py"), BASE, f"--pages={route}"],
        ["python3", os.path.join(ROOT, "scripts/audit_citation_popovers.py"), BASE, f"--routes={route}"],
    ]
    for cmd in checks:
        print(f"  rendered check: {os.path.basename(cmd[1])} {route}")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, cwd=os.path.join(ROOT, "scripts"))
        if r.returncode != 0:
            tail = (r.stdout + r.stderr).strip().splitlines()[-8:]
            print("\n".join("    " + l for l in tail))
            json.dump({}, open("/tmp/_mz_reject.json", "w"))
            print("UNPUBLISH:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}/reject", "POST", auth=True, data_file="/tmp/_mz_reject.json"))[:200])
            die(f"the published page failed {os.path.basename(cmd[1])}; it has been unpublished")
    print("  rendered checks: passed")


def require_patient_pages_dose_free() -> None:
    """S7's patient-facing half, enforced where a brief publishes: the home
    page and the educational materials carry no dosing at all. The check
    lived only in scripts/deploy-prod.sh, so nothing in this file enforced it
    (standards-check, 2026-09-20). Owner: "these briefs can have dosing — the
    patient facing home page and educational materials should not."""
    script = os.path.join(ROOT, "scripts/check_patient_pages_dosing.py")
    if not os.path.exists(script):
        die("the patient-page dosing gate is missing; S7's patient half cannot be enforced")
    r = subprocess.run(["python3", script], capture_output=True, text=True, timeout=600, cwd=ROOT)
    if r.returncode != 0:
        tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
        print("\n".join("    " + l for l in tail))
        die("a patient-facing page carries dosing; refusing to publish anything until it does not")
    print("  patient pages: dose-free")


def cmd_publish(post_id: str, dry: bool = False) -> None:
    """dry=True proves the body passes every gate, including the browser, and
    writes nothing. (`dry` was once read here without being a parameter: the
    NameError would have crashed every `run` at the moment it went to publish.)"""
    if is_trend(post_id):
        return cmd_publish_trend(post_id, dry=dry)
    W = work_dir(post_id)
    require_spec_review()
    require_patient_pages_dose_free()
    require_standards(W)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "guard");   require_review(W, "guard")
    require(W, "apply");   require_review(W, "apply")
    preview_and_verify(W, post_id, "/evidence/")
    if dry:
        print(f"DRY RUN OK — {post_id} passes every check; nothing was written to the site")
        return
    body = open(W + "body.applied.html", encoding="utf-8").read()
    receipt = json.load(open(W + ".ledger/receipt.json"))
    json.dump({"body_html": body, "pipeline_receipt": receipt}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}", "PUT", auth=True, data_file=W + "_put.json")))
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}/approve", "POST", auth=True, data_file=W + "_approve.json")))
    verify_rendered(f"/evidence/?id={post_id}", post_id)
    record(W, "publish", {"published": True})


def cmd_publish_trend(post_id: str, dry: bool = False) -> None:
    W = work_dir(post_id)
    require_spec_review()
    require_patient_pages_dose_free()
    require_standards(W)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "guard");   require_review(W, "guard")
    require(W, "apply");   require_review(W, "apply")
    man = json.load(open(W + "manifest.json")); trend = man["trend"]
    preview_and_verify(W, post_id, "/trending/")
    if dry:
        print(f"DRY RUN OK — {post_id} passes every check; nothing was written to the site")
        return
    body = open(W + "body.applied.html", encoding="utf-8").read()
    parts = json.load(open(W + "narrative.json"))["parts"]
    syn = {i["tid"]: i for i in json.load(open(W + "syntheses.json"))["items"]}
    titles = {t: json.load(open(W + f"topics/{t}.json"))["title"] for t in man["topics"]}
    summary = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", parts["lede"]))).strip()[:300]
    sid = trend["post_id"]
    receipt = json.load(open(W + ".ledger/receipt.json"))
    doc = {"id": sid, "kind": man.get("kind", "blog"), "title": trend["title"], "summary": summary,
           "body_html": body, "verdict": None, "pipeline_receipt": receipt, "week_label": trend.get("date") or datetime.date.today().isoformat(),
           "topics_covered": [titles[t] for t in man["topics"]], "pmids_cited": man["pmids"], "gaps_surfaced": []}
    json.dump(doc, open(W + "_post.json", "w"), ensure_ascii=False)
    r = curl_json(f"{BASE}/api/posts", "POST", auth=True, data_file=W + "_post.json")
    print("CREATE:", json.dumps(r)[:300])
    if isinstance(r, dict) and r.get("error") and "exist" in json.dumps(r).lower():
        json.dump({k: v for k, v in doc.items() if k not in ("id", "kind")}, open(W + "_put.json", "w"), ensure_ascii=False)
        print("PUT:", json.dumps(curl_json(f"{BASE}/api/posts/{sid}", "PUT", auth=True, data_file=W + "_put.json"))[:300])
    json.dump({}, open(W + "_approve.json", "w"))
    ap = curl_json(f"{BASE}/api/posts/{sid}/approve", "POST", auth=True, data_file=W + "_approve.json")
    print("APPROVE:", json.dumps(ap)[:400])
    if not (isinstance(ap, dict) and (ap.get("ok") or ap.get("status") == "published" or (ap.get("post") or {}).get("status") == "published")):
        die("approve did not publish the post")
    verify_rendered(f"/trending/?id={sid}", sid)
    # queue bookkeeping: the framing is the record, not a verdict
    framing = [{"item": titles[t], "framing": syn[t]["framing"]} for t in man["topics"] if t in syn]
    rationale = "Published through brief_pipeline (trend path). Item framings: " + "; ".join(f"{f['item']} — {f['framing']}" for f in framing)
    json.dump({"override": {"evidence_framing": framing, "rationale": rationale[:4000],
                            "reviewer_notes": "No verdict gauge: the evidence is presented in prose under headed subsections."}},
              open(W + "_queue_approve.json", "w"), ensure_ascii=False)
    qa = curl_json(f"{BASE}/api/v1/admin/trend-briefs/{trend['queue_id']}/approve", "POST", auth=True, data_file=W + "_queue_approve.json")
    print("QUEUE APPROVE:", json.dumps(qa)[:300])
    json.dump({"rerender_passed": True, "draft_post_id": sid}, open(W + "_finalize.json", "w"))
    print("QUEUE FINALIZE:", json.dumps(curl_json(f"{BASE}/api/v1/admin/trend-briefs/{trend['queue_id']}/finalize", "POST", auth=True, data_file=W + "_finalize.json"))[:300])
    record(W, "publish", {"published": True, "post_id": sid})



# ---------------------------------------------------------------------------
# run — the whole chain, with repair
# ---------------------------------------------------------------------------
# A refusal that names a piece is repaired, not reported: the piece is
# invalidated, re-authored under the same rules, and the chain resumes from
# the earliest stale stage. Three rounds, then it stops and says exactly what
# still fails. This is what the weekly routine calls; nothing else is needed.

# Five, not three: a paper with twelve sections can take several passes when
# each round surfaces the next thing, and stopping early throws away a brief
# that was two corrections from done.
REPAIR_ROUNDS = 5


def stage_objections(W: str, stage: str) -> str:
    """What a reviewer refused this stage for last time, fed back into the prompt.

    A review that refuses a stage and then does not reach the next attempt is a
    report, not a control: the curate reviewer objected that a heading
    overpromised relative to the one paper left under it, and the retry ran the
    identical prompt and produced the identical decision.
    """
    path = W + f".ledger/{stage}.objections.json"
    if not os.path.exists(path):
        return ""
    items = json.load(open(path)).get("blocking") or []
    if not items:
        return ""
    return ("\n\nA PREVIOUS ATTEMPT AT THIS STAGE WAS REFUSED BY REVIEW FOR THE FOLLOWING. Act on each one\n"
            "in the decision you return now — do not repeat the decision that was refused:\n"
            + "\n".join(f"  - {x}" for x in items[:6]))


def repair(W: str, msg: str) -> list:
    """Invalidate the pieces a refusal names. Returns what it invalidated."""
    done = []
    # A stage's own reviewer refused it: record the objections so the retry
    # sees them, and clear that stage's receipts so it actually re-runs.
    m_stage = re.search(r"the (\w+) review refused this stage", msg)
    if m_stage:
        st = m_stage.group(1)
        rv = W + f".ledger/{st}.review.json"
        blocking = (json.load(open(rv)).get("blocking") or []) if os.path.exists(rv) else []
        json.dump({"blocking": blocking}, open(W + f".ledger/{st}.objections.json", "w"),
                  indent=1, ensure_ascii=False)
        for f in (f"{st}.json", f"{st}.review.json"):
            if os.path.exists(W + ".ledger/" + f):
                os.remove(W + ".ledger/" + f)
        # The objection reached the prompt but nothing invalidated the draft it
        # named, so the retry found it "already written" and produced the
        # identical refusal. A named paper's draft is removed so it is rewritten.
        named_pm = {x for b in blocking for x in re.findall(r"\b(\d{7,9})\b", str(b))}
        for pm in named_pm:
            # the reviewer's reason goes to the author that must rewrite it —
            # deleting the draft without saying why produced a fresh draft with
            # a fresh version of the same overstatement
            why = "; ".join(b for b in blocking if pm in str(b))
            record_piece_objection(W, pm, why)
            f = W + f"drafts_dd/{pm}.json"
            if os.path.exists(f):
                os.remove(f)
        # a synthesis the objection names carries the same claim: invalidate it
        named_topics = {t for b in blocking for t in re.findall(r"\b(topic-[a-z0-9_]+)", str(b))}
        if named_topics and os.path.exists(W + "syntheses.json"):
            syn = json.load(open(W + "syntheses.json"))
            keep = [i for i in syn["items"] if i["tid"] not in named_topics]
            if len(keep) != len(syn["items"]):
                syn["items"] = keep
                json.dump(syn, open(W + "syntheses.json", "w"), ensure_ascii=False)
                done.append(f"synthesis/syntheses {sorted(named_topics)} invalidated")
        done.append(f"{st} (re-running with {len(blocking)} objection(s) fed back"
                    + (f", {len(named_pm)} draft(s) invalidated" if named_pm else "") + ")")
        # later stages are void too, since this one's output changes
        order = STAGES[STAGES.index(st) + 1:] if st in STAGES else []
        for later in order:
            for f in (f"{later}.json", f"{later}.review.json"):
                if os.path.exists(W + ".ledger/" + f):
                    os.remove(W + ".ledger/" + f)
        return done
    pieces = set(re.findall(r"\[([a-z_:\-0-9]+)\]", msg))
    syn_path, narr_path = W + "syntheses.json", W + "narrative.json"
    for pc in pieces:
        if pc.startswith("topic-") and os.path.exists(syn_path):
            syn = json.load(open(syn_path))
            before = len(syn["items"])
            syn["items"] = [i for i in syn["items"] if i["tid"] != pc]
            if len(syn["items"]) != before:
                json.dump(syn, open(syn_path, "w"), ensure_ascii=False); done.append(f"synthesis {pc}")
        elif pc in ("narrative", "editorial") and os.path.exists(narr_path):
            os.remove(narr_path); done.append(pc)
        elif pc.startswith("popover:"):
            pm = pc.split(":", 1)[1]
            syn = json.load(open(syn_path)) if os.path.exists(syn_path) else {"items": []}
            hit = [i["tid"] for i in syn["items"] if f"ref-pop-{pm}" in (i.get("html") or "") or f"/{pm}/" in (i.get("html") or "")]
            if hit:
                syn["items"] = [i for i in syn["items"] if i["tid"] not in hit]
                json.dump(syn, open(syn_path, "w"), ensure_ascii=False); done.append(f"synthesis carrying popover {pm}")
            elif os.path.exists(narr_path):
                os.remove(narr_path); done.append(f"narrative carrying popover {pm}")
        elif pc.startswith("card:"):
            dp = W + f"drafts_dd/{pc[5:]}.json"
            if os.path.exists(dp):
                d = json.load(open(dp)); d.pop("card", None)
                json.dump(d, open(dp, "w"), ensure_ascii=False); done.append(pc)
        elif pc.startswith("dialog:"):
            dp = W + f"drafts_dd/{pc[7:]}.json"
            if os.path.exists(dp):
                os.remove(dp); done.append(pc)
    # A paper or card the author could not write leaves no draft behind, so the
    # retry picks it up on its own. Clearing the stage receipt is the whole
    # repair — the generic fallback below would throw away the narrative and
    # every synthesis, which have nothing to do with a failed paper.
    if re.search(r"(paper|card|synthesis|syntheses)\(?s?\)? (could not be authored|authoring failed)", msg):
        for f in ("author.json", "author.review.json"):
            if os.path.exists(W + ".ledger/" + f):
                os.remove(W + ".ledger/" + f)
        n = len(set(re.findall(r"\b\d{7,9}\b", msg))) or "the failing"
        return [f"{n} unwritten piece(s) — re-authoring only those"]
    # a wrong-paper finding from guard names PMIDs: those drafts are rewritten
    if "wrong-paper" in msg or "not about its own paper" in msg:
        for pm in set(re.findall(r"\b(\d{7,9})\b", msg)):
            dp = W + f"drafts_dd/{pm}.json"
            if os.path.exists(dp):
                os.remove(dp); done.append(f"dialog:{pm}")
    # a refusal from a reviewer with no piece named: the cross-paper prose is
    # the usual culprit and the cheapest thing to redo
    if not done and re.search(r"review refused|standards audit refused|post-condition", msg):
        if os.path.exists(narr_path):
            os.remove(narr_path); done.append("narrative/editorial")
        if os.path.exists(syn_path):
            os.remove(syn_path); done.append("all syntheses")
    for st in ("author", "guard", "apply"):
        for f in (f"{st}.json", f"{st}.review.json"):
            if os.path.exists(W + ".ledger/" + f):
                os.remove(W + ".ledger/" + f)
    return done



# ---------------------------------------------------------------------------
# renumber — fix the citations on an ALREADY PUBLISHED brief
# ---------------------------------------------------------------------------
# The owner's report was specific: markers show PMIDs instead of 1, 2, 3 in the
# order they appear, and the reference list is not in that order either. Both
# are deterministic transforms of text that is already written and already
# audited — they need no re-authoring, and making them wait behind a full
# re-run is why nothing changed on the site for a day. This does exactly those
# two things (plus duplicate ids and the PubMed-verified journal line), proves
# the result in a browser, and republishes.


def _plain_finding(W: str, pmid: str, title: str, abstract: str) -> str:
    """A plain-language finding written FROM the abstract, cached on disk.

    Two rules meet here. The owner: "the hover summary better be derived from
    the actual abstract, not echoing your output" — so the source is the
    abstract and nothing else, never this pipeline's own earlier prose. The
    site's publish audit: a summary that is a verbatim paste of the abstract is
    refused, because a reader hovering a citation wants the finding in plain
    words. So it is written from the abstract, then checked back against it:
    every number must appear in the source.
    """
    cache = W + "findings.json"
    store = json.load(open(cache)) if os.path.exists(cache) else {}
    if store.get(pmid):
        return store[pmid]
    if len((abstract or "").strip()) < 120:
        return ""
    src = _pool_tokens(abstract)
    a_norm = re.sub(r"[^a-z0-9]", "", abstract.lower())
    note = ""
    t = ""
    best = ""
    for attempt in range(3):
        v = _ask_cached(W, "findings", f"""Write the hover card a clinician sees when they hover a citation.
PAPER: {json.dumps(title)}
ABSTRACT (the only source; use nothing else):
{abstract[:6000]}

WHAT THIS CARD IS FOR: the reader has just met a claim and wants to know, in three seconds, WHAT THIS
STUDY ACTUALLY FOUND and whether to believe it. Give them the result, not a description of the paper.

WRITE IT LIKE THIS:
1. FIRST SENTENCE = THE RESULT, WITH ITS NUMBERS. The actual finding — percentages, rates, odds or
   hazard ratios with their confidence intervals, absolute differences, p-values — exactly as the
   abstract reports them. "Expulsion fell from 30% to under 7%." "Sensitivity 21.4%, specificity
   96.4%." "OR 1.89 (95% CI 1.27-2.80)." If the abstract reports numbers, YOUR FIRST SENTENCE MUST
   CONTAIN THEM. A summary that says a treatment "improved outcomes" without saying by how much is
   useless and will be rejected.
2. SECOND SENTENCE = WHO AND HOW, briefly: the design and the population, so the reader can weigh it.
   "Prospective blinded study, 419 women at repeat caesarean." Not a methods paragraph.
3. LAST SENTENCE = one short "Relevance:" line saying what it bears on in practice.

PLAIN CLINICAL ENGLISH. Write for a busy surgeon, not for an abstract. No throat-clearing ("This
study aimed to..."), no hedging filler, no jargon the number does not need.
LENGTH: 280-600 characters, and it MUST end with a complete sentence — never cut off mid-word.
EVERY NUMBER must appear in the abstract above. If the abstract genuinely reports no figures, say the
finding in words and say plainly that no effect size is reported.{note}
Return ONLY {{"finding": "<text>"}}.""", timeout_s=600)
        t = (v or {}).get("finding", "").strip()
        if not t:
            note = "\nA PREVIOUS ATTEMPT RETURNED NOTHING. Return the JSON object exactly as specified."
            continue
        # 700, not 520: a trial reporting several arms needs room for its
        # numbers, and rejecting it for length dropped the citation entirely —
        # the failure this function already learned once.
        if not (240 <= len(t) <= 700):
            note = (f"\nA PREVIOUS ATTEMPT WAS REJECTED: it was {len(t)} characters. Write 280-600, "
                    "finishing the last sentence — keep the result and its numbers, trim method detail.")
            best = t if len(t) > len(best or "") else best
            t = ""
            continue
        if not re.search(r"[.!?][\"')\]]?\s*$", t):
            note = ("\nA PREVIOUS ATTEMPT WAS REJECTED: it was cut off mid-sentence. Finish the last "
                    "sentence inside the character limit.")
            t = ""
            continue
        abstract_has_numbers = len([x for x in _pool_tokens(abstract)
                                    if not re.fullmatch(r"(?:19|20)\d\d", x) and (len(x) >= 2 or "." in x)]) >= 2
        first = re.split(r"(?<=[.!?])\s", t)[0]
        if abstract_has_numbers and not _num_tokens(first):
            note = ("\nA PREVIOUS ATTEMPT WAS REJECTED: its first sentence gave no figures although the "
                    "abstract reports them. Lead with the result AND its numbers.")
            t = ""
            continue
        stray = [x for x in _num_tokens(t)
                 if (len(x) >= 2 or "." in x) and not re.fullmatch(r"(?:19|20)\d\d", x) and x not in src]
        if stray:
            note = ("\nA PREVIOUS ATTEMPT WAS REJECTED: it used the number(s) " + ", ".join(stray[:4])
                    + ", which do not appear in the abstract. Use only figures the abstract states, "
                      "or none at all.")
            t = ""
            continue
        t_norm = re.sub(r"[^a-z0-9]", "", t.lower())
        if len(t_norm) > 60 and t_norm[:60] in a_norm:
            note = ("\nA PREVIOUS ATTEMPT WAS REJECTED: it opened with a sentence copied from the "
                    "abstract. Write the finding in your own plain clinical words.")
            t = ""
            continue
        break
    if not t:
        # a card that says the result and ends cleanly is better than no
        # citation at all, even if it ran long
        if best and _num_tokens(best) and re.search(r"[.!?][\"')\]]?\s*$", best):
            print(f"  keeping a {len(best)}-character summary for {pmid} rather than losing the citation")
            t = best
    if not t:
        # A framework paper or a protocol reports no result to lead with, and
        # three figure-first attempts were rejected for exactly that; the
        # citation was then dropped silently (W29: two papers the completeness
        # pass had placed; W34: a refusal). One relaxed attempt: what the
        # paper is and what it concludes, figures only where the abstract has
        # them, complete sentences.
        v = _ask_cached(W, "findings", f"""Write the hover card a clinician sees when they hover a citation to this paper.
PAPER: {json.dumps(title)}
ABSTRACT (the only source):
{abstract[:6000]}
Two or three plain sentences: what the paper is (design and population, or what it proposes when it
is a framework, protocol or review) and what it concludes. Use a figure only if the abstract states
it; if the abstract reports no results, say so plainly. End with one short "Relevance:" line.
240-600 characters, ending with a complete sentence. Return ONLY {{"finding": "<text>"}}.""", timeout_s=600)
        note2 = ""
        for k in range(3):
            if note2:
                v = _ask_cached(W, "findings", f"""Write the hover card a clinician sees when they hover a citation to this paper.
PAPER: {json.dumps(title)}
ABSTRACT (the only source):
{abstract[:6000]}
Two or three plain sentences: what the paper is (design and population, or what it proposes when it
is a framework, protocol or review) and what it concludes. Use a figure only if the abstract states
it; if the abstract reports no results, say so plainly. End with one short "Relevance:" line.
240-600 characters, ending with a complete sentence.{note2} Return ONLY {{"finding": "<text>"}}.""", timeout_s=600)
            r = (v or {}).get("finding", "").strip()
            stray = [x for x in _num_tokens(r) if (len(x) >= 2 or "." in x) and not re.fullmatch(r"(?:19|20)\d\d", x) and x not in src]
            if r and not stray:
                t = r[:700]
                if not re.search(r"[.!?][\"')\]]?\s*$", t):
                    t = t[:t.rfind(".") + 1] if "." in t else t
                print(f"  hover card for {pmid} written without a leading figure (the abstract reports no result to lead with)")
                break
            note2 = ("\nA PREVIOUS ATTEMPT WAS REJECTED: it used the number(s) " + ", ".join(stray[:4])
                     + ", which the abstract does not state. "
                     + ("Write it with no figures at all." if k >= 1 else "Use only figures the abstract states."))
    if not t:
        die(f"no hover card could be written for {pmid} ({title[:60]!r}) — the citation cannot be shown without one")
    store[pmid] = t
    json.dump(store, open(cache, "w"), ensure_ascii=False, indent=1)
    return t


def _paper_finding(abstract: str) -> str:
    """The paper's own reported finding, taken from its PubMed abstract.

    Owner, 2026-09-16: "the hover summary better be derived from the actual
    abstract, not echoing your output." An earlier version pulled the deep
    dive's bottom line — text this pipeline had written — so the citation
    summarised the site instead of the study. The source is the abstract:
    its CONCLUSIONS if it labels them, otherwise its RESULTS, otherwise its
    closing sentences.
    """
    a = re.sub(r"\s+", " ", abstract or "").strip()
    if len(a) < 80:
        return ""
    for label in ("CONCLUSION", "CONCLUSIONS", "RESULTS AND CONCLUSIONS", "INTERPRETATION"):
        m = re.search(label + r"S?:\s*(.+?)(?=\s[A-Z][A-Z /&-]{2,40}:|$)", a)
        if m and len(m.group(1).strip()) >= 100:
            t = m.group(1).strip()
            break
    else:
        m = re.search(r"RESULTS?:\s*(.+?)(?=\s[A-Z][A-Z /&-]{2,40}:|$)", a)
        t = m.group(1).strip() if m and len(m.group(1).strip()) >= 100 else ""
        if not t:
            plain = re.sub(r"(^|\s)[A-Z][A-Z /&-]{2,40}:\s*", " ", a).strip()
            t = plain[-560:]
            t = t[t.find(". ") + 2:] if ". " in t[:160] else t
    t = t.strip()
    if len(t) > 560:
        cut = t[:560]
        t = cut.rsplit(". ", 1)[0] + "." if ". " in cut else cut
    return t



def _after_run(frag: str, pos: int) -> int:
    """The index after the run of markers standing at pos, so a new marker
    joins the end of the run and stacked markers keep mention order."""
    while True:
        mm = SUP_RE.match(frag, pos)
        if not mm:
            return pos
        pos = mm.end()


def _own_papers_for(h: str, ps, topic_spans: list) -> set:
    """The papers a passage may cite when it belongs to one section: a
    synthesis cites its section's cards; the deep-dive intro ("Three papers
    worth a careful read") cites the deep-dive cards below it (W20's intro
    was cited to a different anaesthesia paper than the card it introduced).
    Empty means the whole brief."""
    if ps.kind == "synthesis":
        enc = next((t for t in topic_spans if t.a <= ps.a < t.b), None)
        if enc:
            return set(re.findall(CARD_ID_RE, enc.group(0))) | set(re.findall(r"openDeepDive\('dd-(\d+)'", enc.group(0)))
        return set()
    jc = re.search(r'<section class="[^"]*mz-journal-club[^"]*"[^>]*>', h)
    if jc:
        jb = _element_end(h, "section", jc.end())
        if jc.start() <= ps.a < jb:
            seg = SUP_RE.sub(" ", h[jc.start():jb])  # the cards' own PubMed links, not the markers' popovers
            own = (set(re.findall(CARD_ID_RE, seg)) | set(re.findall(r"openDeepDive\('dd-(\d+)'", seg))
                   | set(re.findall(r'id="dd-(\d+)"', seg)) | set(re.findall(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})", seg)))
            if own:
                return own
    return set()


# A sentence whose claim is that NO evidence exists cannot be supported by a
# paper, and a marker on it tells a reader the opposite: that the cited study
# backs the absence. A trend brief's lede says "essentially no RCT evidence"
# and "zero randomized clinical trials in endometriosis", and once the ledes
# reached the placement pass it hung the brief's actual evidence base off
# those very sentences — NAMS 2022 and SKYLIGHT beside a claim that nothing
# has been trialled.
_NO_EVIDENCE_RE = re.compile(
    r"\b(?:no|zero|none|not\s+a\s+single|lack(?:s|ing)?\s+(?:any\s+)?|without\s+(?:any\s+)?"
    r"|essentially\s+no|absence\s+of(?:\s+(?:any|adequate\w*|sufficient))?)\s+"
    r"(?:\w+\s+){0,3}?"
    r"(?:randomi[sz]ed|randomi[sz]ation|RCTs?|trials?|studies|stud(?:y|ies)|evidence|data|literature)\b", re.I)


def _asserts_no_evidence(t: str) -> bool:
    """The sentence's point is that nothing has been studied."""
    return bool(_NO_EVIDENCE_RE.search(t or ""))


def withdraw_citations_from_absence_claims(h: str) -> tuple:
    """Take the markers off a sentence whose claim is that nothing exists.

    The guard in `cite_prose` stops new ones being placed; this clears the
    ones already on the page. Returns (h, markers_withdrawn).
    """
    n = 0
    for ps in list(_prose_passages(h))[::-1]:
        frag = ps.group(1)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        spans = []
        for k, (t, e) in enumerate(sents):
            if not _asserts_no_evidence(t):
                continue
            s0 = _sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
            spans.append((ps.start(1) + s0, ps.start(1) + _after_run(frag, e)))
        for a, b in sorted(spans, reverse=True):
            for m in sorted(SUP_RE.finditer(h[a:b]), key=lambda x: -x.start()):
                h = h[:a + m.start()] + h[a + m.end():]
                n += 1
    return h, n


def cite_prose(W: str, h: str, pmids: list, real: dict) -> tuple:
    """The model decides which sentence cites which paper; the code inserts it.

    Owner, 2026-09-19: "if the AI pass is better and would cut down on wasting
    time on processes that have been proven shitty, do that first."

    The previous version matched author surnames with a regex and carried
    special cases for possessives, compound references, names at the start of
    a paragraph and names that belong to two covered papers. Every one of
    those was a source of wrong or missing citations. Judgement now belongs to
    the model — it reads the sentences and the candidate papers and says which
    sentence rests on which paper — and this function only performs what it
    decided, at the end of the named sentence.
    """
    def brief_card(q):
        r = real.get(q) or {}
        ab = re.sub(r"\s+", " ", r.get("abstract") or "")
        # the conclusion carries what a sentence would rest on; 320 chars of it
        # small on purpose: a 52-paper list at 320 characters each overflowed
        # the call and came back as malformed JSON, which cost two dry runs
        tail = ab[-200:] if len(ab) > 200 else ab
        return {"pmid": q, "title": r.get("title", "")[:130], "gist": tail}

    cand_all = [brief_card(q) for q in pmids]
    topic_spans = _topic_sections(h)
    added, out, last = 0, [], 0
    for m in _prose_passages(h):
        gi = 1 if m.group(1) is not None else 2
        frag = m.group(gi)
        # A citation's popover carries the paper's title, journal line and a
        # whole summary — TEXT, not tags — so the splitter read it as prose:
        # the narrative came back as 74 "sentences" that were mostly popover
        # fragments, the model could not place against them, and the markers
        # it did place landed mid-phrase. Masking each <sup> with spaces keeps
        # every index valid against the fragment while hiding its content.
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        if not sents:
            continue
        have = {_pmid_of(x) for x in SUP_RE.findall(frag)}
        # A synthesis is about its own section's papers, so the candidates are
        # the cards of the section that CONTAINS it — found by walking to the
        # enclosing topic section, not by guessing a byte window, which took
        # the wrong papers and left the passage almost uncited.
        own = _own_papers_for(h, m, topic_spans)
        cand = [c for c in cand_all if c["pmid"] in own] if own else cand_all
        # CHUNKED: a 50-sentence narrative with a clause per placement came
        # back truncated three times running. Numbering stays global.
        decided = []
        for c0 in range(0, len(sents), 30):
            listing = "\n".join(f"[{i + 1}] {t}" for i, (t, _) in enumerate(sents) if c0 <= i < c0 + 30)
            v = _ask_cached(W, "place", f"""You are placing citations in one passage of a clinician-facing evidence brief.
SENTENCES (numbered; this is sentences {c0 + 1}-{min(c0 + 30, len(sents))} of {len(sents)}):
{listing}

PAPERS THIS BRIEF COVERS (the only ones you may cite):
{json.dumps(cand, ensure_ascii=False)[:40000]}

ALREADY CITED SOMEWHERE IN THIS PASSAGE: {sorted(x for x in have if x)} — that does NOT excuse a
later sentence resting on the same paper; cite it again there. Only never cite the same paper twice
on the SAME sentence.

EVERY STUDY A SENTENCE REPORTS GETS ITS CITATION. Most sentences in a passage like this report
something a study found. For EACH sentence, enumerate the distinct studies it reports — one named
by an author, one described by its design, population, number, comparison or outcome ("a 55-woman
doxercalciferol pilot", "a 36-study acupuncture meta-analysis") — and for each, find the paper it is
among the papers listed, matching on what the sentence CLAIMS against the paper's title and
abstract, not on a name alone. A sentence that reports four studies gets four pmids. A sentence
that states the clinician's own reasoning, a transition, or a general point cites nothing. Omit a
study only when no listed paper is that study.

Reply with ONLY {{"citations": [{{"sentence": <number>, "pmids": ["..."], "why": "<at most six words>"}}, ...]}}""",
                            timeout_s=900)
            if not v or not isinstance(v.get("citations"), list):
                die("citation placement returned no verdict")
            for r in v["citations"]:
                # a reply nested one level too deep still carries the decisions
                if isinstance(r, list):
                    decided.extend(x for x in r if isinstance(x, dict))
                elif isinstance(r, dict):
                    decided.append(r)
        placements = {}
        for r in decided:
            try:
                idx = int(r.get("sentence"))
            except Exception:
                continue
            if not (1 <= idx <= len(sents)):
                continue
            if _asserts_no_evidence(sents[idx - 1][0]):
                # nothing can be cited for the absence of itself
                continue
            for pm in (r.get("pmids") or []):
                pm = str(pm).strip()
                if pm not in pmids:
                    continue
                # A paper already cited earlier in the passage still needs its
                # citation on the NEXT claim that rests on it. Skipping any
                # paper already present anywhere in the passage is what left a
                # nine-paragraph brief with five citations. Only a repeat on
                # the SAME sentence is a duplicate.
                s_text, s_end = sents[idx - 1]
                # from the first prose of THIS sentence: the index right after
                # the previous full stop is where the previous sentence's
                # marker run begins, and a window starting there made a paper
                # cited on sentence N uncitable on sentence N+1
                s_start = _sentence_start(masked, sents[idx - 2][1]) if idx >= 2 else 0
                # markers inside the sentence AND the run standing right after
                # its full stop — where relocated and earlier-placed markers
                # live. Checking only the inside span let the same paper be
                # cited twice in a row (W33: "…in adenomyosis.¹¹").
                already = {_pmid_of(x) for x in SUP_RE.findall(frag[s_start:s_end])}
                run_end = s_end
                while True:
                    mm = SUP_RE.match(frag, run_end)
                    if not mm:
                        break
                    already.add(_pmid_of(mm.group(0)))
                    run_end = mm.end()
                if pm in already:
                    continue
                placements.setdefault(idx, []).append(pm)
        frag_out, shift = frag, 0
        for idx in sorted(placements):
            sup = "".join(_sup_markup(pm, real, W) for pm in dict.fromkeys(placements[idx]))
            if not sup:
                die(f"no hover card for {placements[idx]}; a decided citation cannot be dropped silently")
            at = _after_run(frag_out, sents[idx - 1][1] + shift)
            frag_out = frag_out[:at] + sup + frag_out[at:]
            shift += len(sup)
            added += len(placements[idx])
        out.append(h[last:m.start(gi)]); out.append(frag_out); last = m.end(gi)
    out.append(h[last:])
    return "".join(out), added


def _sup_markup(pm: str, real: dict, W: str) -> str:
    r = real.get(pm) or {}
    meta = " \u00b7 ".join(x for x in (r.get("authors", ""), r.get("journal", ""), r.get("year", "")) if x)
    finding = _plain_finding(W, pm, r.get("title", ""), r.get("abstract", ""))
    if not finding:
        return ""
    return (f'<sup class="mz-ref"><a class="mz-ref-link" href="https://pubmed.ncbi.nlm.nih.gov/{pm}/" '
            f'target="_blank" rel="noopener noreferrer" aria-describedby="ref-pop-{pm}">{pm}</a>'
            f'<span class="mz-ref-pop" id="ref-pop-{pm}" role="tooltip">'
            f'<span class="mz-ref-pop-title">{H.escape(r.get("title", ""), quote=False)}</span>'
            f'<span class="mz-ref-pop-meta">{H.escape(meta, quote=False)}</span>'
            f'<span class="mz-ref-pop-finding">{H.escape(finding, quote=False)}</span>'
            f'<a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/{pm}/" target="_blank" '
            f'rel="noopener">Read the study on PubMed&nbsp;&rarr;</a></span></sup>')

# the passages that carry inline citations: the opening narrative and each
# section's synthesis paragraph
PROSE_RE = (r'(?:<section class="[^"]*mz-post-narrative[^"]*"[^>]*>([\s\S]*?)</section>)'
            r'|(?:<p class="mz-toc-group-synthesis">([\s\S]*?)</p>)')
_ABBR_END = re.compile(r"\b(?:vs|e\.g|i\.e|et al|cf|Dr|no|Fig|approx)\.$", re.I)


def relocate_mid_sentence_markers(h: str) -> tuple:
    """Move every citation marker that stands mid-sentence to the end of its
    sentence, merging with any marker already there.

    A published brief still carries markers the old surname placer put
    straight after the name — "Pan's¹ review of fixation techniques…" — and
    the renumber path kept them where they stood, so the transform audit
    refused W33 for a marker inside a noun phrase. The standard (S1) puts the
    marker after the claim's full stop; this enforces it on markers that
    pre-date the rule, before the placement pass adds any of its own."""
    moved = 0
    out, last = [], 0
    for m in _prose_passages(h):
        gi = 1 if m.group(1) is not None else 2
        frag = m.group(gi)
        for _ in range(400):
            masked = _mask_noprose(frag)
            hit = None
            for sm in SUP_RE.finditer(frag):
                before = H.unescape(re.sub(r"<[^>]+>", "", masked[:sm.start()])).rstrip(" \t\r\n\xa0")
                if not before:
                    continue
                after = H.unescape(re.sub(r"<[^>]+>", "", masked[sm.end():])).strip(" \t\r\n\xa0")
                at_end = (re.search(r"[.!?][)\]\"\u201d\u2019']*$", before) and not _ABBR_END.search(before)) \
                    or not after
                if not at_end:
                    hit = sm
                    break
            if not hit:
                break
            marker = hit.group(0)
            pm = _pmid_of(marker)
            end = _end_of_sentence(masked, hit.end())
            frag = frag[:hit.start()] + frag[hit.end():]
            end -= len(marker)
            # "levels ⟨marker⟩," lifted out leaves "levels ," — the space
            # before the marker is dropped when punctuation follows
            cut = hit.start()
            if frag[cut:cut + 1] in ",.;:!?":
                k = cut
                while k > 0 and frag[k - 1] in " \t\xa0":
                    k -= 1
                if k < cut:
                    frag = frag[:k] + frag[cut:]
                    end -= cut - k
            # the run of markers already standing at that sentence end
            run_end, seen = end, set()
            while True:
                mm = SUP_RE.match(frag, run_end)
                if not mm:
                    break
                seen.add(_pmid_of(mm.group(0)))
                run_end = mm.end()
            if run_end == hit.start() and pm not in seen:
                # nowhere to go (no stop follows): put it back and stop
                frag = frag[:run_end] + marker + frag[run_end:]
                break
            if pm not in seen:
                frag = frag[:run_end] + marker + frag[run_end:]
            moved += 1
        out.append(h[last:m.start(gi)]); out.append(frag); last = m.end(gi)
    out.append(h[last:])
    return "".join(out), moved


DESIGN_VOCAB = ["Randomized Controlled Trial", "Meta-Analysis", "Systematic Review", "Narrative Review",
                "Scoping Review", "Prospective Cohort", "Retrospective Cohort", "Population-Based Cohort",
                "Cross-Sectional", "Case-Control", "Case Report", "Case Series", "Trial Protocol",
                "Qualitative Study", "Survey", "Guideline / Consensus", "Diagnostic Accuracy Study",
                "Mendelian Randomization", "Cost-Effectiveness Analysis", "In Vitro / Translational",
                "Animal Study"]


def verify_design_tags(W: str, h: str, real: dict) -> tuple:
    """Every card's study-design badge is checked against the paper's own
    abstract, and a wrong one is replaced.

    The badge is carried from the generator's own labelling and was never
    verified: W33 showed "Retrospective Cohort" on a narrative review. A
    reader who knows the paper stops trusting the page there. The model
    reads title + abstract and names the design from a fixed vocabulary; the
    code rewrites only badges it judged wrong. Returns (h, fixed)."""
    cards = []
    for m in re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h):
        a = m.group(0)
        pm = re.search(r'id="mz-cite-(\d{5,9})', a) or re.search(r"openDeepDive\('dd-(\d+)'", a)
        d = re.search(r'<(?:span|p) class="mz-cite-design">([^<]*)</(?:span|p)>', a)
        if not pm or not d or not (real.get(pm.group(1)) or {}).get("abstract"):
            continue
        cards.append({"pmid": pm.group(1), "at": m.start() + d.start(1), "end": m.start() + d.end(1),
                      "badge": H.unescape(d.group(1))})
    verdict = {}
    distinct = list(dict.fromkeys(c["pmid"] for c in cards))
    badge_of = {c["pmid"]: c["badge"] for c in cards}
    for i in range(0, len(distinct), 12):
        batch = distinct[i:i + 12]
        v = _ask_cached(W, "design", f"""Each item is a paper, the study-design badge shown on its card in a clinical brief, and the paper's own
title and abstract. Judge whether the badge names the design the abstract describes. A narrative
review badged as a cohort, a protocol badged as a trial, a cross-sectional survey badged as a cohort,
or a sample size that is not the paper's are wrong. A badge that names the right design (with or
without a sample size) is right; do not change wording that is merely different.
DESIGN VOCABULARY (use exactly one): {json.dumps(DESIGN_VOCAB)}
ITEMS: {json.dumps([{"pmid": q, "badge": badge_of[q], "title": (real.get(q) or {}).get("title", ""),
                     "abstract": ((real.get(q) or {}).get("abstract") or "")[:2200]} for q in batch], ensure_ascii=False)[:90000]}
Reply with ONLY {{"items": [{{"pmid": "...", "ok": true|false, "design": "<one vocabulary entry>",
"n": <total participants/specimens as an integer, or null when the abstract gives none>, "why": "<one clause when not ok>"}}, ...]}}
with one object for EVERY item given.""", timeout_s=900)
        if not v or not isinstance(v.get("items"), list):
            die("the design-badge review returned no verdict")
        got = {str(x.get("pmid")): x for x in v["items"]}
        missing = [q for q in batch if q not in got]
        if missing:
            die(f"the design-badge review skipped {missing[:4]}")
        verdict.update(got)
    fixed = 0
    for c in sorted(cards, key=lambda c: c["at"], reverse=True):
        x = verdict.get(c["pmid"]) or {}
        if x.get("ok") or str(x.get("design", "")) not in DESIGN_VOCAB:
            continue
        n = x.get("n")
        label = x["design"] + (f" · n = {int(n):,}" if isinstance(n, int) and n > 0 else "")
        if label == c["badge"]:
            continue
        h = h[:c["at"]] + H.escape(label, quote=False) + h[c["end"]:]
        fixed += 1
        print(f"  design badge {c['pmid']}: {c['badge']!r} -> {label!r} ({str(x.get('why', ''))[:90]})")
    return h, fixed


def _first_surnames(pmids: list, real: dict) -> dict:
    """surname -> [pmids] for each covered paper's first author. A NOMINATOR
    only: it says which sentences to ask about, never what to cite."""
    out = {}
    for pm in pmids:
        au = (real.get(pm) or {}).get("authors") or ""
        f = au.split(",")[0].strip().split(" ")[0] if au else ""
        if len(f) >= 2:
            out.setdefault(f, []).append(pm)
    return out


def _near_surname(name: str, known: set) -> bool:
    """True when a name is the same surname as one the brief holds, spelled a
    character differently. W29's prose reads "Horasanlı" where the byline lost
    the dotless i and reads "Horasanl" — one is a prefix of the other, and
    asking a writer to "correct" that risks making it worse for no gain.
    """
    low = name.lower()
    for k in known:
        kl = k.lower()
        if low == kl or low.startswith(kl) or kl.startswith(low):
            if abs(len(low) - len(kl)) <= 2:
                return True
    return False


def fix_prose_attribution(W: str, h: str, real: dict) -> tuple:
    """Prose credits the paper it cites, by that paper's own authors.

    W21's narrative read "Tian et al., J Obstet Gynaecol Res, n = 255, show
    opioid-free anesthesia…" on a marker pointing at a paper by Lv, Li and
    Liu. A reader searches for a paper that does not exist under that name.
    It also broke something else: curation removed a paediatric paper whose
    first author IS Tian, so the narrative rewriter kept insisting the name
    had to go, while the sentence it sat in was about a paper that stays.

    A name is wrong when it is credited with "et al." on a sentence whose own
    citations are all to papers that name nobody by that surname, and no paper
    the brief holds does either. Returns (h, sentences_corrected).
    """
    held = list(dict.fromkeys(re.findall(CARD_ID_RE, h) + re.findall(r"openDeepDive\('dd-(\d+)'", h)))
    everyone = set()
    for q in held:
        everyone |= set(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\b", (real.get(q) or {}).get("authors", "")))
    fixed = 0
    for ps in list(_prose_passages(h))[::-1]:
        frag = ps.group(1)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        edits = []
        for k, (t, e) in enumerate(sents):
            # A sentence that states a PMID of its own is deliberately naming a
            # paper outside the brief — W24 explains an Expression of Concern
            # by naming the 2013 paper it concerns, "Minozzi et al., …, PMID
            # 23467955". That is the writer being precise, not careless.
            # Naming a paper outside the brief is the whole point of a
            # sentence that states its PMID, or that reports an editorial
            # notice ON another paper — W24's synthesis explains an Expression
            # of Concern by naming the 2013 Minozzi paper it concerns. That is
            # the writer being precise, not careless.
            if re.search(r"\bPMID\s*:?\s*\d{5,9}", t) or re.search(
                    r"\b(?:expression\s+of\s+concern|retract(?:ion|ed|s)|correction\s+to|erratum|corrigendum"
                 r"|comment(?:ary)?\s+on|repl(?:y|ies)\s+to|response\s+to|withdrawn)\b", t, re.I):
                continue
            names = [x for x in dict.fromkeys(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+et\s+al\.", t))
                     if x not in _NOT_A_SURNAME and x not in everyone and not _near_surname(x, everyone)]
            if not names:
                continue
            s0 = _sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
            cites = [q for q in dict.fromkeys(_pmid_of(m.group(0))
                                              for m in SUP_RE.finditer(frag, s0, _after_run(frag, e))) if q]
            if not cites:
                continue
            papers = [{"pmid": q, "authors": (real.get(q) or {}).get("authors", ""),
                       "title": ((real.get(q) or {}).get("title") or "")[:130],
                       "journal": (real.get(q) or {}).get("journal", ""),
                       "year": str((real.get(q) or {}).get("year", "") or "")} for q in cites]
            edits.append((ps.start(1) + s0, ps.start(1) + e, re.sub(r"\s+", " ", t).strip(), names, papers))
        for a, b, sentence, names, papers in sorted(edits, key=lambda x: -x[0]):
            if not _usable_span(h, a, b):
                continue
            v = _ask_cached(W, "attrib", f"""One sentence of a clinician-facing evidence brief credits {json.dumps(names[:3])} with a paper, and
the paper it actually cites was written by someone else. A reader searching that name finds nothing.

THE SENTENCE: {json.dumps(sentence)}
THE PAPER(S) THIS SENTENCE CITES: {json.dumps(papers, ensure_ascii=False)}

Correct ONLY the name so the sentence credits the cited paper's own authors, in the same form the
sentence already uses. Change nothing else: not a figure, not a journal, not a clause, not the voice.
If the name belongs to a different study the sentence mentions alongside the cited one, leave it and
reply with the sentence unchanged.
Reply with ONLY {{"sentence": "<the corrected sentence>"}}""", timeout_s=600)
            new = re.sub(r"\s+", " ", str((v or {}).get("sentence") or "")).strip()
            if not new or new == sentence or writer_reject(new):
                continue
            if abs(len(new) - len(sentence)) > max(60, int(len(sentence) * 0.25)):
                print(f"  prose attribution rewrite rejected (it changed more than the name): {new[:80]!r}")
                continue
            if _numbers_in(new) - _numbers_in(sentence):
                print(f"  prose attribution rewrite rejected (it introduced a figure): {new[:80]!r}")
                continue
            keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
            h = _replace_span(h, a, b, new)
            at = _after_run(h, a + len(H.escape(new, quote=False)))
            if keep and keep not in h[a:at + len(keep)]:
                h = h[:at] + keep + h[at:]
            fixed += 1
            print(f"  prose credited {names[:2]} for a paper by someone else — corrected: {new[:90]!r}")
    return h, fixed


def rewrite_narrative_for_removed(W: str, h: str, gone: list, real: dict, surviving: list | None = None) -> tuple:
    """Rewrite the opening narrative's paragraphs that discuss a paper
    curation removed from the brief.

    The syntheses were rewritten after curation; the narrative was not, so
    W33's opening still argued from Takemura's trachelectomy cohort and
    Sanz-Cabanillas's alopecia study — papers no longer on the page, with
    nothing left to cite. The model rewrites only the paragraphs that discuss
    a removed paper; the code replaces exactly those paragraphs, drops their
    old markers (the placement pass re-cites every sentence), and refuses if
    a removed paper's first author is still named afterwards. Returns
    (h, paragraphs_rewritten)."""
    if not gone:
        return h, 0
    total = 0
    for ps in [p for p in _prose_passages(h) if p.kind == "prose"]:
        h, n = _rewrite_passage_for_removed(W, h, ps.start(1), ps.end(1), gone, real, surviving)
        total += n
    return h, total


def _rewrite_passage_for_removed(W: str, h: str, ia: int, ib: int, gone: list, real: dict, surviving) -> tuple:
    """One prose section (narrative, bottom line, gaps…): its paragraphs that
    discuss a removed paper are rewritten or removed."""
    class _M:
        def start(self, n=0):
            return ia
        def end(self, n=0):
            return ib
    m = _M()
    frag = h[ia:ib]
    paras = list(re.finditer(r'<p\b[^>]*>([\s\S]*?)</p>', frag))
    if not paras:
        return h, 0
    removed = [{"pmid": q, "first_author": ((real.get(q) or {}).get("authors") or "").split(",")[0].strip(),
                "title": (real.get(q) or {}).get("title", "")} for q in gone]
    sur = _first_surnames(gone, real)

    def text_of(inner):
        return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", inner)))).strip()

    listing = {str(i + 1): text_of(pm.group(1)) for i, pm in enumerate(paras)}
    reason = ""
    for attempt in range(2):
        v = _ask_cached(W, "narrative", f"""Below is the opening narrative of a clinician-facing weekly evidence brief, paragraph by paragraph,
written in Dr. Mabini's first person (a DO and complex benign gynecology / minimally invasive
gynecologic surgery surgeon). These papers have since been REMOVED from the brief because they were
not about the heading they sat under, and they are no longer on the page:
{json.dumps(removed, ensure_ascii=False)}
Rewrite ONLY the paragraphs that discuss a removed paper — its authors, its findings, its numbers —
so that the discussion is gone and nothing on the page argues from a paper the reader cannot see.
Keep every sentence that does not concern a removed paper exactly as written; keep the voice and the
flow; repair a transition the removal breaks; a paragraph may become shorter, never longer. Do not
touch paragraphs that mention no removed paper.{reason}
PARAGRAPHS: {json.dumps(listing, ensure_ascii=False)}
Reply with ONLY {{"paragraphs": {{"<number>": "<the rewritten paragraph, plain HTML with <em>/<strong> only, no citation markup, & < > escaped>", ...}}}}
containing ONLY the paragraphs you changed.""", timeout_s=900)
        changed = (v or {}).get("paragraphs") or {}
        if not isinstance(changed, dict):
            die("the narrative rewrite returned no verdict")
        out, last, n = [], 0, 0
        for i, pm in enumerate(paras):
            new = changed.get(str(i + 1))
            if not isinstance(new, str):
                continue
            if len(new) > len(pm.group(1)) + 200:
                continue
            if not new.strip():
                # a paragraph that was entirely about a removed paper: the
                # model returns it empty, and the whole <p> element goes
                out.append(frag[last:pm.start()]); last = pm.end(); n += 1
                continue
            if len(new.strip()) < 40:
                continue
            out.append(frag[last:pm.start(1)]); out.append(new.strip()); last = pm.end(1); n += 1
        out.append(frag[last:])
        new_frag = "".join(out)
        shared = set(_first_surnames(surviving or [], real))
        still = [k for k in sur if k not in shared
                 and re.search(r"(?<![\w-])" + re.escape(k) + r"(?:['\u2019]s)?(?![\w-])", text_of(new_frag))]
        for k in sur:
            if k in shared and re.search(r"(?<![\w-])" + re.escape(k) + r"(?:['\u2019]s)?(?![\w-])", text_of(new_frag)):
                print(f"  NOTE: {k!r} is still named in the narrative and is also a surviving paper's first author; "
                      f"the orphan-study check judges that sentence")
        if not still:
            h = h[:m.start(2)] + new_frag + h[m.end(2):]
            return h, n
        reason = (f"\nA previous attempt left these removed papers' authors still named: {still}; every mention "
                  f"of a removed paper must go.")
    # Two rewrites could not get a removed paper's author out of the prose, so
    # stop rewriting and cut. Deleting the sentence that names them is a
    # smaller question than composing a paragraph around the hole, and it is
    # the one action that is always available — W21 refused a finished brief
    # over one surname the writer would not drop.
    cut = 0
    out, last = [], 0
    for pm in paras:
        inner = pm.group(1)
        masked = _mask_noprose(inner)
        sents = _sentences_of(masked)
        keep_parts, prev = [], 0
        for k, (t, e) in enumerate(sents):
            s0 = _sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
            if any(re.search(r"(?<![\w-])" + re.escape(x) + r"(?:['\u2019]s)?(?![\w-])", t) for x in still):
                end = _after_run(inner, e)
                keep_parts.append(inner[prev:s0]); prev = end
                cut += 1
        if not cut or prev == 0:
            continue
        keep_parts.append(inner[prev:])
        kept = re.sub(r"\s{2,}", " ", "".join(keep_parts)).strip()
        out.append(frag[last:pm.start()])
        if text_of(kept):
            out.append(f'<p>{kept}</p>')
        last = pm.end()
    if cut:
        out.append(frag[last:])
        new_frag = "".join(out)
        leftover = [k for k in still
                    if re.search(r"(?<![\w-])" + re.escape(k) + r"(?:['\u2019]s)?(?![\w-])", text_of(new_frag))]
        if not leftover:
            print(f"  {cut} narrative sentence(s) naming a removed paper deleted (rewriting them twice did not)")
            h = h[:m.start(2)] + new_frag + h[m.end(2):]
            return h, cut
    die(f"the narrative still discusses removed paper(s) after rewriting and cutting: {still}")


def cite_named_studies(W: str, h: str, pmids: list, real: dict) -> tuple:
    """A second, targeted placement pass: every sentence that names the first
    author of a covered paper and carries no citation to it is put to the
    model one by one — does this sentence rest on that paper? The surname
    match only NOMINATES; the model decides; the code inserts at the sentence
    end. The general pass declines where it is unsure, and W33's audit found
    Li's and Bernardi's findings reported with numbers and no marker. Returns
    (h, inserted, declined_names)."""
    sur = _first_surnames(pmids, real)
    added, declined = 0, set()
    out, last = [], 0
    for m in _prose_passages(h):
        gi = 1 if m.group(1) is not None else 2
        frag = m.group(gi)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        asks = []
        for i, (t, e) in enumerate(sents):
            s_start = _sentence_start(masked, sents[i - 1][1]) if i >= 1 else 0
            on_it = {_pmid_of(x) for x in SUP_RE.findall(frag[s_start:e])}
            run_end = e
            while True:
                mm = SUP_RE.match(frag, run_end)
                if not mm:
                    break
                on_it.add(_pmid_of(mm.group(0)))
                run_end = mm.end()
            for name, qs in sur.items():
                cands = [q for q in qs if q not in on_it]
                if cands and re.search(r"(?<![\w-])" + re.escape(name) + r"(?:['\u2019]s)?(?![\w-])", t):
                    asks.append({"sentence": i + 1, "text": t, "name": name,
                                 "papers": [{"pmid": q, "title": (real.get(q) or {}).get("title", "")[:140],
                                             "abstract": (lambda ab: ab[:500] + (" … " + ab[-300:] if len(ab) > 800 else ""))(
                                                 re.sub(r"\s+", " ", (real.get(q) or {}).get("abstract") or ""))}
                                            for q in cands]})
        placements = {}
        if asks:
            v = _ask_cached(W, "named", f"""Each item is one sentence of a clinician-facing evidence brief that NAMES an author whose paper
this brief covers, yet carries no citation to that paper. For EACH, say whether the sentence rests on
that paper — reports its finding, design, population, number or conclusion, or discusses it — and
if so which of the listed papers (a surname can belong to more than one). A sentence that merely
mentions the name in passing, or reports a DIFFERENT study's result next to the name, cites nothing
here. If unsure, cite nothing.
ITEMS: {json.dumps(asks, ensure_ascii=False)[:90000]}
Reply with ONLY {{"decisions": [{{"sentence": <number>, "name": "<the name>", "pmids": ["..."]}}, ...]}} with one
object for EVERY item.""", timeout_s=900)
            if not v or not isinstance(v.get("decisions"), list):
                die("the named-study placement returned no verdict")
            for d in v["decisions"]:
                try:
                    idx = int(d.get("sentence"))
                except Exception:
                    continue
                qs = [str(q) for q in (d.get("pmids") or []) if str(q) in pmids]
                if not (1 <= idx <= len(sents)):
                    continue
                if not qs:
                    declined.add(str(d.get("name", "")))
                    continue
                for q in qs:
                    placements.setdefault(idx, []).append(q)
        frag_out, shift = frag, 0
        for idx in sorted(placements):
            sup = "".join(_sup_markup(q, real, W) for q in dict.fromkeys(placements[idx]))
            if not sup:
                die(f"no hover card for {placements[idx]}; a decided citation cannot be dropped silently")
            at = _after_run(frag_out, sents[idx - 1][1] + shift)
            frag_out = frag_out[:at] + sup + frag_out[at:]
            shift += len(sup)
            added += len(placements[idx])
        out.append(h[last:m.start(gi)]); out.append(frag_out); last = m.end(gi)
    out.append(h[last:])
    return "".join(out), added, sorted(x for x in declined if x)


def refresh_popovers_from_abstracts(W: str, h: str, real: dict) -> tuple:
    """Every marker's hover card is rewritten from the paper's PubMed abstract
    (`_plain_finding`), replacing whatever the author stage typed into the
    popover template. Owner: "the hover summary better be derived from the
    actual abstract, not echoing your output." Returns (h, refreshed)."""
    n = 0
    fresh = {}

    def swap(m):
        nonlocal n
        pm = _pmid_of(m.group(0))
        if not pm or not (real.get(pm) or {}).get("abstract"):
            return m.group(0)
        if pm not in fresh:
            sup = _sup_markup(pm, real, W)
            pop = re.search(r'<span class="mz-ref-pop"[^>]*>([\s\S]*)</span></sup>$', sup) if sup else None
            fresh[pm] = pop.group(1) if pop else None
        if not fresh[pm]:
            return m.group(0)
        sup = m.group(0)
        if 'class="mz-ref-pop"' not in sup:
            # a legacy marker with no popover at all: the browser gate refuses
            # the page for it (W20's markers 8 and 20). Give it one.
            n += 1
            return sup.replace("</sup>", f'<span class="mz-ref-pop" id="ref-pop-{pm}" role="tooltip">{fresh[pm]}</span></sup>', 1)
        out, k = re.subn(r'(<span class="mz-ref-pop"[^>]*>)[\s\S]*?(</span>)(?=\s*</sup>)',
                         lambda x: x.group(1) + fresh[pm] + x.group(2), sup, count=1)
        n += k
        return out
    return SUP_RE.sub(swap, h), n


def real_from_work(W: str, pmids: list) -> dict:
    """PubMed-verified paper facts from the work directory's paper files, in
    the shape `cite_and_review` and `_sup_markup` read."""
    real = {}
    for q in pmids:
        pf = W + f"papers/{q}.json"
        if not os.path.exists(pf):
            continue
        pj = json.load(open(pf))
        mv = pj.get("meta_verified") or pj.get("meta") or ""
        real[q] = {"title": pj.get("title", ""),
                   "abstract": pj.get("pubmed_abstract") or pj.get("abstract") or "",
                   "authors": mv.split(" \u00b7 ")[0].strip() if mv else "",
                   "journal": pj.get("journal", ""), "year": str(pj.get("year", "") or "")}
    return real


def remove_orphan_studies(W: str, h: str, pmids: list, real: dict) -> tuple:
    """Prose may report the findings of a study only if the brief holds it.

    W33's narrative and its Endometriosis synthesis reported "Li's" IL-17C
    fibrosis findings twice — a paper with no card and no PMID anywhere in
    the brief, so nothing could cite it. The removed-paper rewrites could not
    see it (it was never in the paper list) and the synthesis rewrite kept
    the sentence because it was told to keep what still held. The model
    reads each passage against the list of covered papers and names every
    sentence that reports a study outside it; each such sentence is
    rewritten with that study's part removed, or deleted (with the marker
    run that followed it) when it was only about that study. Up to two
    rounds; a study still reported after that refuses the brief.
    Returns (h, sentences_changed)."""
    covered = [{"pmid": q, "first_author": ((real.get(q) or {}).get("authors") or "").split(",")[0].strip(),
                "journal": (real.get(q) or {}).get("journal", ""),
                "title": (real.get(q) or {}).get("title", "")[:150]} for q in pmids if real.get(q)]
    if not covered:
        return h, 0
    total = 0
    last_orphans = []

    def _words(x):
        return set(w for w in re.findall(r"[a-z][a-z0-9-]{3,}", (x or "").lower()))

    def confirm_orphan(sentence, study):
        # A flagged sentence is checked once more against the covered papers
        # most like it, by overlap of title, journal and abstract with the
        # sentence. W33's "a Cochrane review on embryo-transfer preparation
        # techniques" WAS a covered paper (Yamaji, Cochrane Database Syst
        # Rev); the first pass matched on first author alone and a correct
        # clause was removed.
        sw = _words(sentence + " " + study)
        scored = sorted(covered, key=lambda c: -len(sw & _words(c["title"] + " " + c["journal"] + " "
                                                                 + ((real.get(c["pmid"]) or {}).get("abstract") or "")[:1500])))[:6]
        cands = [{"pmid": c["pmid"], "first_author": c["first_author"], "journal": c["journal"], "title": c["title"],
                  "abstract_head": re.sub(r"\s+", " ", (real.get(c["pmid"]) or {}).get("abstract") or "")[:500]} for c in scored]
        v = _ask_cached(W, "orphans", f"""A sentence of a clinical brief reports a study, described as {json.dumps(study)}:
{json.dumps(sentence)}
Is that study one of these papers the brief holds? Match on what the sentence says — design, journal
(a "Cochrane review" is a Cochrane Database of Systematic Reviews paper), population, numbers, topic —
not on an author's name alone.
CANDIDATES: {json.dumps(cands, ensure_ascii=False)}
Reply with ONLY {{"pmid": "<the matching pmid>"}} or {{"pmid": null}} when none of them is that study.""",
                        timeout_s=600)
        got = str((v or {}).get("pmid") or "").strip()
        return not (got and got in pmids)
    for _round in range(3):
        edits = []
        for ps in _prose_passages(h):
            frag = ps.group(1)
            base = ps.start(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
            if not sents:
                continue
            listing = "\n".join(f"[{i + 1}] {t}" for i, (t, _) in enumerate(sents))
            v = _ask_cached(W, "orphans", f"""You are checking one passage of a clinician-facing weekly evidence brief. The brief holds ONLY these
papers, each shown with its first author and title:
COVERED PAPERS: {json.dumps(covered, ensure_ascii=False)[:60000]}
SENTENCES (numbered):
{listing}
Find every sentence that reports a SPECIFIC study — names its author, or states its design, population,
numbers or findings — where that study is NOT one of the covered papers (a paper the brief no longer
holds, or never held). A covered paper named by a co-author, a sentence of the clinician's own
reasoning, and a general statement are all fine. For each such sentence give a rewrite with that
study's part removed — keep any part about covered papers and the surgeon's own reasoning, same
first-person voice, plain text, no citation markup, ending with a full stop — or an empty string
when the sentence was only about that study.
Reply with ONLY {{"orphans": [{{"sentence": <number>, "study": "<how the sentence names it>",
"rewrite": "<text, or empty>"}}, ...]}} and {{"orphans": []}} when there are none.""", timeout_s=900)
            if not v or not isinstance(v.get("orphans"), list):
                die("the orphan-study check returned no verdict")
            for o in v["orphans"]:
                try:
                    idx = int(o.get("sentence"))
                except Exception:
                    continue
                if not (1 <= idx <= len(sents)):
                    continue
                a = base + _sentence_start(masked, sents[idx - 2][1] if idx >= 2 else 0)
                b = base + sents[idx - 1][1]
                new = re.sub(r"\s+", " ", str(o.get("rewrite") or "")).strip()
                if new and len(new) > len(sents[idx - 1][0]) + 60:
                    new = ""
                study = str(o.get("study", ""))[:80]
                if not confirm_orphan(sents[idx - 1][0], study):
                    print(f"  KEEPING a sentence flagged for {study!r}: it is a paper the brief holds")
                    continue
                edits.append((a, b, new, study))
        if not edits:
            return h, total
        for a, b, new, study in sorted(edits, key=lambda e: -e[0]):
            if not (0 <= a < b <= len(h)):
                continue
            if new:
                h = _replace_span(h, a, b, new)
                print(f"  rewrote a sentence that reported {study!r}, a study the brief does not hold")
            else:
                # the whole sentence goes, and so does the marker run after
                # its full stop — those markers belonged to this sentence
                end = b
                while True:
                    mm = SUP_RE.match(h, end)
                    if not mm:
                        break
                    end = mm.end()
                # through the balanced replacer, not a raw splice: cutting the
                # text of a sentence that filled a wrapper took the wrapper's
                # closing tag with it and left `<li><span class="mz-rec-text">`
                # hanging open
                h = _replace_span(h, a, end, "")
                print(f"  removed a sentence that reported {study!r}, a study the brief does not hold")
            total += 1
        last_orphans = [e[3] for e in edits]
    die(f"prose still reports studies the brief does not hold after two rewrites: {last_orphans[:4]}")


def refresh_card_abstracts(h: str, real: dict) -> tuple:
    """Every cite card's "Read the full abstract" body and its metadata line
    come from PubMed. 32 of W33's 87 cards showed the raw MEDLINE dump —
    journal line, DOI, "Author information: (1)…" — under that summary, and
    no layer on either path read card abstracts. Returns (h, cards_refreshed)."""
    n = 0

    def paragraphs(ab):
        ab = ab.replace("\r", "").strip()
        parts = re.split(r"\n\s*\n|(?<=[.!?])\s+(?=[A-Z][A-Z /&-]{2,}:)", ab)
        out = []
        for p in parts:
            p = re.sub(r"\s+", " ", p).strip()
            if p:
                out.append("<p>" + H.escape(p, quote=False) + "</p>")
        return "".join(out)

    def card(m):
        nonlocal n
        a = m.group(0)
        pm = re.search(r'id="mz-cite-(\d{5,9})', a) or re.search(r"openDeepDive\('dd-(\d+)'", a)
        r = real.get(pm.group(1)) if pm else None
        if not r or not (r.get("abstract") or "").strip():
            return a
        changed = False
        d = re.search(r'<details class="mz-abstract">[\s\S]*?</details>', a)
        if d:
            body = ('<details class="mz-abstract"><summary>Read the full abstract</summary><h4>ABSTRACT</h4>'
                    + paragraphs(r["abstract"]) + "</details>")
            if body != d.group(0):
                a = a[:d.start()] + body + a[d.end():]
                changed = True
        meta = " \u00b7 ".join(x for x in (r.get("authors", ""), f"<strong>{H.escape(r.get('journal', ''), quote=False)}</strong>" if r.get("journal") else "", str(r.get("year", "") or "")) if x)
        mm = re.search(r'<p class="mz-cite-meta">[\s\S]*?</p>', a)
        if mm and meta:
            new_meta = f'<p class="mz-cite-meta">{H.escape(r.get("authors", ""), quote=False)}' + (
                f' \u00b7 <strong>{H.escape(r.get("journal", ""), quote=False)}</strong>' if r.get("journal") else "") + (
                f' \u00b7 {H.escape(str(r.get("year", "")), quote=False)}' if r.get("year") else "") + "</p>"
            if new_meta != mm.group(0):
                a = a[:mm.start()] + new_meta + a[mm.end():]
                changed = True
        if changed:
            n += 1
        return a
    return re.sub(r'<article class="mz-cite-card[\s\S]*?</article>', card, h), n


def refresh_deep_dive_meta(h: str, real: dict) -> tuple:
    """The deep-dive modal names its paper's authors, journal and year too.

    Every other place a paper is named — the popover, the cite card, the
    reference entry — is rebuilt from the PubMed-verified record. The modal's
    own citation line was not, so one brief showed the same paper as
    "Golinska M, Wołyniak M, Kulesza P et al. · Front Immunol · 2025"
    everywhere and "Golinska M, Kulesza P, Fendler W" inside the modal. A
    reader who opens the deep dive sees a different paper described.
    Returns (h, lines_rewritten).
    """
    n = 0

    def one(m):
        nonlocal n
        block = m.group(0)
        pm = (re.search(r'<dialog[^>]*\bid="dd-(\d{5,9})"', block) or [None, None])[1]
        r = real.get(pm) if pm else None
        if not r or not (r.get("authors") or r.get("journal")):
            return block
        line = (H.escape(r.get("authors", ""), quote=False)
                + (f' \u00b7 <em>{H.escape(r.get("journal", ""), quote=False)}</em>' if r.get("journal") else "")
                + (f' \u00b7 {H.escape(str(r.get("year", "")), quote=False)}' if r.get("year") else ""))
        out, hit = [], 0
        last = 0
        for c in re.finditer(r'<p class="mz-jc-modal-cite"[^>]*>[\s\S]*?</p>', block):
            # never trade a line that names a journal for one that cannot:
            # a lean record would otherwise strip real information
            if not r.get("journal") and "\u00b7" in re.sub(r"<[^>]+>", "", c.group(0)):
                out.append(block[last:c.end()]); last = c.end()
                continue
            new = f'<p class="mz-jc-modal-cite">{line}</p>'
            if new != c.group(0):
                hit += 1
            out.append(block[last:c.start()]); out.append(new); last = c.end()
        if not hit:
            return block
        out.append(block[last:])
        n += hit
        return "".join(out)

    return re.sub(r"<dialog\b[\s\S]*?</dialog>", one, h), n


# A capitalised word before a year is usually not an author. "The 2022 NAMS
# position statement", "May 2019", "Since 2020" all matched a surname pattern
# and would have sent a card off to be "corrected" for crediting nobody.
_NOT_A_SURNAME = {
    "The", "This", "That", "These", "Those", "Their", "Its", "Our", "His", "Her",
    "And", "But", "For", "From", "Since", "Until", "Before", "After", "During", "While", "When",
    "With", "Without", "Between", "Among", "Within", "Across", "Under", "Over", "Into",
    "One", "Two", "Three", "Four", "Five", "Both", "Each", "All", "Most", "Some", "Every",
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "Cochrane", "PubMed", "Medline", "Embase", "Trial", "Study", "Review", "Guideline",
}


def fix_card_attribution(W: str, h: str, real: dict) -> tuple:
    """A card's own editorial text names the authors of the paper it is for.

    One card on the live site opened "Mahmoud et al. systematic review of
    embolization and sclerotherapy…" above a byline reading "Daniels JP,
    Champaneria R, Shah L et al." — a reader is told two different teams wrote
    the same paper, and the wrong name is the one they would search for. The
    detection is exact: a surname the text credits with "et al." that appears
    nowhere in the card's own byline. Only the attribution is rewritten.
    Returns (h, cards_corrected).
    """
    n = 0
    all_authors = set()
    for f in (real or {}).values():
        all_authors |= set(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\b", (f or {}).get("authors", "")))
    roster = [{"first_author": ((f or {}).get("authors") or "").split(",")[0].strip(),
               "year": str((f or {}).get("year", "") or ""), "title": ((f or {}).get("title") or "")[:110]}
              for f in (real or {}).values()]
    out, last = [], 0
    for m in re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h):
        card = m.group(0)
        # the same fallbacks refresh_card_abstracts uses: this runs BEFORE
        # bind_legacy_cards, so a trend card still carries a section index as
        # its id and only its deep-dive trigger names the paper. Reading the
        # id alone meant the pass skipped every card on every trend brief.
        pm = ((re.search(CARD_ID_RE, card) or re.search(r"openDeepDive\('dd-(\d+)'", card)
               or re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})/", card) or [None, None])[1])
        meta = re.search(r'<p class="mz-cite-meta">([\s\S]*?)</p>', card)
        find = re.search(r'<p class="mz-cite-finding">([\s\S]*?)</p>', card)
        r = real.get(pm) if pm else None
        if not (pm and meta and find and r):
            continue
        # the card's lead-in ("Read through the lens of the claim:") is markup,
        # not prose to rewrite: sending it and then re-adding it duplicated it
        lead = re.match(r"\s*<strong>[\s\S]*?</strong>\s*", find.group(1))
        body_html = find.group(1)[lead.end():] if lead else find.group(1)
        byline = H.unescape(re.sub(r"<[^>]+>", " ", meta.group(1))).split("\u00b7")[0]
        known = set(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\b", byline))
        known |= set(re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\b", r.get("authors", "")))
        ftxt = H.unescape(re.sub(r"<[^>]+>", " ", body_html))
        # A name is cited two ways: "Daniels et al." and "Daniels 2016". The
        # first must be one of THIS paper's authors. The second may point at
        # another paper the brief holds, so it only has to be an author
        # SOMEWHERE in the brief — one card read "beyond Mahmoud 2016" of a
        # review written by Daniels, and Mahmoud authors nothing here.
        named = re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+et\s+al\.", ftxt)
        cross = re.findall(r"\b([A-Z][a-z\u00e0-\u017f]{2,})\s+(?:19|20)\d\d\b", ftxt)
        wrong = [x for x in dict.fromkeys(named) if x not in known and x not in _NOT_A_SURNAME]
        wrong += [x for x in dict.fromkeys(cross)
                  if x not in known and x not in all_authors and x not in _NOT_A_SURNAME]
        wrong = list(dict.fromkeys(wrong))
        if not wrong:
            continue
        flat = re.sub(r"\s+", " ", ftxt).strip()[:1200]
        v = _ask_cached(W, "attrib", f"""A cite card in a clinician-facing evidence brief credits the wrong authors. Its own editorial text
says {json.dumps(wrong[:3])}, but the paper it is for is:
TITLE: {json.dumps(r.get("title", ""))}
AUTHORS: {json.dumps(r.get("authors", ""))}
JOURNAL: {json.dumps(r.get("journal", ""))} {json.dumps(str(r.get("year", "") or ""))}

THE CARD'S TEXT: {json.dumps(flat)}

EVERY PAPER THIS BRIEF HOLDS: {json.dumps(roster, ensure_ascii=False)[:8000]}

Correct ONLY the attribution so each name credits the paper it actually belongs to — this paper for
the text's own subject, and for a "Surname YEAR" cross-reference, whichever paper in the list above
it means. Change nothing else: not a figure, not a clause, not the voice. If a name belongs to a
study that is genuinely outside this brief and the text says so, leave it and reply unchanged.
Reply with ONLY {{"text": "<the corrected text>"}}""", timeout_s=600)
        new = re.sub(r"\s+", " ", str((v or {}).get("text") or "")).strip()
        _bad = writer_reject(new)
        if _bad:
            continue
        if abs(len(new) - len(ftxt.strip())) > max(120, int(len(ftxt) * 0.4)):
            print(f"  attribution rewrite rejected for {pm} (it rewrote more than the name)")
            continue
        if _numbers_in(new) - _numbers_in(ftxt):
            print(f"  attribution rewrite rejected for {pm} (it introduced a figure)")
            continue
        body = (lead.group(0) if lead else "") + H.escape(new, quote=False)
        card = card[:find.start(1)] + body + card[find.end(1):]
        print(f"  card for {pm} credited {wrong[:2]} — corrected to the paper's own authors")
        n += 1
        out.append(h[last:m.start()]); out.append(card); last = m.end()
    out.append(h[last:])
    return "".join(out), n


def cite_uncited_cards(W: str, h: str, real: dict) -> tuple:
    """Backstop: every carded paper is cited somewhere, whatever the shape.

    `cite_every_card` walks topic sections and cites a missing paper in its
    section's synthesis paragraph. It misses a paper twice over: a trend brief
    has no topic sections at all, and a weekly section with no synthesis
    paragraph is skipped along with every uncited card under it — W21 went to
    the audit with 72 cards and 71 papers cited, the odd one carded under
    Infertility and cited nowhere. This runs last and asks only the question
    that matters: is this paper cited anywhere? If not, it gets a sentence in
    the prose passage that introduces its card, written from the paper's own
    abstract and reviewed like any other afterwards.
    Returns (h, sentences_added).
    """
    added = 0
    for m in list(re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', h)):
        q = ((re.search(CARD_ID_RE, m.group(0)) or re.search(r"openDeepDive\('dd-(\d+)'", m.group(0))
              or [None, None])[1])
        r = real.get(q) or {}
        if not q or not (r.get("abstract") or "").strip():
            continue
        passages = _prose_passages(h)
        if any(q in {_pmid_of(x) for x in SUP_RE.findall(ps.group(1))} for ps in passages):
            continue
        before = [ps for ps in passages if ps.b <= m.start()]
        ps = before[-1] if before else next((x for x in passages if x.a > m.end()), None)
        if ps is None:
            continue
        ab = re.sub(r"\s+", " ", r.get("abstract") or "")
        paper = json.dumps({"title": r.get("title", ""), "abstract": ab[:2500]}, ensure_ascii=False)
        text = ""
        for attempt in range(2):
            extra = ("" if attempt == 0 else
                     " Write it in your own plain clinical words, NOT copied from the abstract, with no"
                     " section labels like METHODS or RESULTS.")
            w = _ask_cached(W, "resynth", f"""Write ONE sentence for a clinician-facing evidence brief, in Dr. Mabini's first person (a DO and
complex benign gynecology / minimally invasive gynecologic surgery surgeon), reporting this paper's
main finding with its key number as the abstract states it.{extra} At most 45 words, plain text, no
citation markup, ending with a full stop.
THE PAPER: {paper}
Reply with ONLY {{"sentence": "<the sentence>"}}""", timeout_s=600)
            cand = re.sub(r"\s+", " ", str((w or {}).get("sentence") or "")).strip()
            ab_norm = re.sub(r"[^a-z0-9]", "", ab.lower())
            c_norm = re.sub(r"[^a-z0-9]", "", cand.lower())
            if (30 <= len(cand) <= 420 and not writer_reject(cand)
                    and not (len(c_norm) > 60 and c_norm[:60] in ab_norm)):
                text = cand
                break
        if not text:
            die(f"could not write a sentence for the uncited card {q}")
        sup = _sup_markup(q, real, W)
        if not sup:
            die(f"no hover card could be written for {q}")
        at = ps.end(1)
        h = h[:at] + " " + H.escape(text, quote=False) + sup + h[at:]
        added += 1
        print(f"  carded paper {q} was cited nowhere — given a sentence: {text[:90]!r}")
    return h, added


def cite_every_card(W: str, h: str, real: dict, force_new: set | None = None) -> tuple:
    """Every paper carded under a heading is cited somewhere in the prose.

    The read-back audit refused W33 for six cards with no marker anywhere.
    For each such paper the model names the sentence of its section's
    synthesis that reports it; if none does, it writes one sentence from the
    abstract, which is appended to the synthesis with its marker. Everything
    inserted here is reviewed by the same per-sentence review afterwards.
    Returns (h, cited_by_sentence, sentences_added)."""
    by_sentence, added = 0, 0
    for t in _topic_sections(h):
        cards = list(dict.fromkeys(re.findall(CARD_ID_RE, t.group(0)) + re.findall(r"openDeepDive\('dd-(\d+)'", t.group(0))))
        # cited IN THIS SECTION'S SYNTHESIS: a paper carded under two headings
        # is discussed under both (W33: two endometriosis cards were cited
        # only under Pelvic Pain and Adenomyosis). Markers inside dialogs or
        # cards do not count either.
        synth_all = re.findall(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', t.group(0))
        cited_here = {_pmid_of(x) for sy in synth_all for x in SUP_RE.findall(sy)}
        missing = [q for q in cards if q not in cited_here and (real.get(q) or {}).get("abstract")]
        if not missing:
            continue
        sec = _section_span(h, t.tid)
        pm = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', sec.group(0))
        if not pm:
            continue
        for q in missing:
            sec = _section_span(h, t.tid)
            pm = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', sec.group(0))
            frag = pm.group(1)
            base = sec.start() + pm.start(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
            r = real.get(q) or {}
            listing = "\n".join(f"[{i + 1}] {x}" for i, (x, _) in enumerate(sents))
            ab = re.sub(r"\s+", " ", r.get("abstract") or "")
            paper_json = json.dumps({"pmid": q, "title": r.get("title", ""), "abstract": ab[:1800]}, ensure_ascii=False)
            v = None if (force_new and q in force_new) else _ask_cached(W, "place", f"""One paper in a section of a clinician-facing evidence brief has a card but no citation in the
section's opening paragraph. Which numbered sentence, if any, reports THIS paper — its finding,
design, population or numbers? Match on the claim, not on a name alone.
THE PAPER: {paper_json}
SENTENCES:
{listing}
Reply with ONLY {{"sentence": <number or null>}}""", timeout_s=600)
            idx = None
            try:
                idx = int((v or {}).get("sentence"))
            except Exception:
                idx = None
            if idx and 1 <= idx <= len(sents):
                sup = _sup_markup(q, real, W)
                if not sup:
                    die(f"no hover card could be written for {q}")
                at = base + _after_run(frag, sents[idx - 1][1])
                h = h[:at] + sup + h[at:]
                by_sentence += 1
                continue
            w = _ask_cached(W, "resynth", f"""Write ONE sentence for the opening paragraph of a section of a clinician-facing weekly evidence
brief, in Dr. Mabini's first person (a DO and complex benign gynecology / minimally invasive
gynecologic surgery surgeon), reporting this paper's main finding with its key number, as the
abstract states it. At most 45 words, plain text, no citation markup, ending with a full stop.
THE PAPER: {json.dumps({"title": r.get("title", ""), "abstract": ab[:2500]}, ensure_ascii=False)}
Reply with ONLY {{"sentence": "<the sentence>"}}""", timeout_s=600)
            text = re.sub(r"\s+", " ", str((w or {}).get("sentence") or "")).strip()
            ab_norm = re.sub(r"[^a-z0-9]", "", ab.lower())
            t_norm = re.sub(r"[^a-z0-9]", "", text.lower())
            if (len(text) < 30 or len(text) > 420 or _invents_experience(text)
                    or re.search(r"\b(?:M?ETHODS?|RESULTS?|CONCLUSIONS?|BACKGROUND|OBJECTIVES?|DESIGN|SETTING)\s*:", text)
                    or (len(t_norm) > 60 and t_norm[:60] in ab_norm)):
                # W21: the model pasted the abstract's METHODS paragraph
                w = _ask_cached(W, "resynth", f"""Write ONE sentence, in Dr. Mabini's first person, reporting this paper's main finding with its key
number as the abstract states it — in your own plain clinical words, NOT copied from the abstract, no
section labels like METHODS or RESULTS. At most 45 words, plain text, ending with a full stop.
THE PAPER: {json.dumps({"title": r.get("title", ""), "abstract": ab[:2500]}, ensure_ascii=False)}
Reply with ONLY {{"sentence": "<the sentence>"}}""", timeout_s=600)
                text = re.sub(r"\s+", " ", str((w or {}).get("sentence") or "")).strip()
                t_norm = re.sub(r"[^a-z0-9]", "", text.lower())
                if (len(text) < 30 or len(text) > 420 or re.search(r"\b[A-Z]{5,}\s*:", text)
                        or (len(t_norm) > 60 and t_norm[:60] in ab_norm)):
                    die(f"could not write a sentence for uncited card {q} under {t.tid}")
            sup = _sup_markup(q, real, W)
            if not sup:
                die(f"no hover card could be written for {q}")
            at = base + len(frag)
            h = h[:at] + " " + H.escape(text, quote=False) + sup + h[at:]
            added += 1
    return h, by_sentence, added


def cite_missing_studies(W: str, h: str, pmids: list, real: dict) -> tuple:
    """A second look at every prose sentence WITH its current citations
    visible: which study it reports is not yet cited on it? The placement
    pass under-delivers on sentences that pack three or four studies (W29:
    "one review… and another…" with two markers for three studies); seeing
    what is already cited makes the gap explicit. Returns (h, inserted)."""
    topic_spans = _topic_sections(h)
    title_of = {q: (real.get(q) or {}).get("title", "")[:120] for q in pmids}
    added, out, last = 0, [], 0
    for ps in _prose_passages(h):
        frag = ps.group(1)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        if not sents:
            out.append(h[last:ps.start(1)]); out.append(frag); last = ps.end(1)
            continue
        own = _own_papers_for(h, ps, topic_spans)
        cands = [q for q in pmids if (not own or q in own)]
        rows = []
        for i, (t, e) in enumerate(sents):
            s_start = _sentence_start(masked, sents[i - 1][1]) if i >= 1 else 0
            on_it = [_pmid_of(x) for x in SUP_RE.findall(frag[s_start:e])]
            run_end = e
            while True:
                mm = SUP_RE.match(frag, run_end)
                if not mm:
                    break
                on_it.append(_pmid_of(mm.group(0)))
                run_end = mm.end()
            rows.append({"sentence": i + 1, "text": t, "already_cited": [title_of.get(q, q) for q in dict.fromkeys(on_it) if q]})
        placements = {}
        covered_json = json.dumps([{"pmid": q, "title": title_of.get(q, ""),
                                    "gist": re.sub(r"\s+", " ", (real.get(q) or {}).get("abstract") or "")[-240:]}
                                   for q in cands], ensure_ascii=False)[:60000]
        for c0 in range(0, len(rows), 25):
            v = _ask_cached(W, "place", f"""Each sentence below comes from a clinician-facing evidence brief and lists the papers ALREADY cited on
it. Name every study the sentence reports that is NOT among those — a study named by an author or
described by its design, population, numbers or findings ("a Korean protocol (LIFE-Repro, n=200)",
"one review makes the case for…, and another catalogs…") — and give the covered paper it is. A
sentence reporting three studies carries three citations; a sentence that says "five qualitative
studies on X in Ghana, South Africa and HSCT" reports five, and each of the five is to be found among
the covered papers by its setting and design. Match on what the sentence claims against each paper's
title and abstract; give nothing for a sentence whose studies are all cited or that reports none.
SENTENCES: {json.dumps(rows[c0:c0 + 25], ensure_ascii=False)}
COVERED PAPERS: {covered_json}
Reply with ONLY {{"additions": [{{"sentence": <number>, "pmids": ["..."]}}, ...]}} (an empty list when nothing is missing).""",
                            timeout_s=900)
            if not v or not isinstance(v.get("additions"), list):
                die("the citation completeness pass returned no verdict")
            for r in v["additions"]:
                try:
                    idx = int(r.get("sentence"))
                except Exception:
                    continue
                if not (1 <= idx <= len(sents)):
                    continue
                have = set(rows[idx - 1]["already_cited"])
                for q in (r.get("pmids") or []):
                    q = str(q).strip()
                    if q in pmids and title_of.get(q, q) not in have:
                        placements.setdefault(idx, []).append(q)
        frag_out, shift = frag, 0
        for idx in sorted(placements):
            sup = "".join(_sup_markup(q, real, W) for q in dict.fromkeys(placements[idx]))
            if not sup:
                die(f"no hover card for {placements[idx]}; a decided citation cannot be dropped silently")
            at = _after_run(frag_out, sents[idx - 1][1] + shift)
            frag_out = frag_out[:at] + sup + frag_out[at:]
            shift += len(sup)
            added += len(placements[idx])
        out.append(h[last:ps.start(1)]); out.append(frag_out); last = ps.end(1)
    out.append(h[last:])
    return "".join(out), added


_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
              "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
              "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}


def _leading_count(text: str):
    """The count a synthesis opens with — "Three fibroid papers…", "15
    infertility papers…", "Only two PCOS entries…" — or None."""
    m = re.match(r"\s*(?:only\s+|just\s+)?(\d+|[a-z]+(?:-[a-z]+)?)\s+(?:[\w&/-]+\s+){0,4}?(?:papers?|entries|studies)\b", text, re.I)
    if not m:
        return None
    nums = _numbers_in(m.group(1))
    return next(iter(nums)) if nums else None


_NUM_TO_WORD = {v: k for k, v in _NUM_WORDS.items()}
# "N topics" means a NUMBER before "topics". Matching any word there made
# "9 subspecialty topics" read "subspecialty" as the count and rewrite it to
# "seven", which is how a corrected total came out "7 seven topics".
_NUM_WORD_ALT = "|".join(sorted((re.escape(w) for w in list(_NUM_WORDS)
                                 + ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
                                    "hundred"]), key=len, reverse=True))
_COUNT_WORD = rf"(?:\d+|(?:{_NUM_WORD_ALT})(?:-(?:{_NUM_WORD_ALT}))?)"


def _num_word(k: int) -> str:
    """The word form of a small number, "sixty-five" for 65, the digits when
    there is no natural word. Lifted out of _set_leading_count so the stats
    line can keep a sentence's own notation when it rebuilds its figures."""
    if k in _NUM_TO_WORD:
        return _NUM_TO_WORD[k]
    tens = {v: kk for kk, v in _TENS.items()}
    if k < 100 and (k // 10) * 10 in tens:
        return tens[(k // 10) * 10] + ("-" + _NUM_TO_WORD[k % 10] if k % 10 else "")
    return str(k)


def _set_leading_count(text: str, n: int) -> str:
    """"Three chronic-pelvic-pain papers…" with n=1 → "One chronic-pelvic-pain
    paper…"; digits stay digits, words stay words, the noun agrees."""
    m = re.match(r"(\s*(?:only\s+|just\s+)?)(\d+|[a-z]+(?:-[a-z]+)?)(\s+(?:[\w&/-]+\s+){0,4}?)(papers?|entries|studies)\b", text, re.I)
    if not m:
        return text
    w = m.group(2)
    word = str(n) if w.isdigit() else (_num_word(n).capitalize() if w[0].isupper() else _num_word(n))
    noun = m.group(4)
    if noun.lower().startswith("paper"):
        noun = "paper" if n == 1 else "papers"
    elif noun.lower().startswith("stud"):
        noun = "study" if n == 1 else "studies"
    elif noun.lower().startswith("entr"):
        noun = "entry" if n == 1 else "entries"
    return text[:m.start(2)] + word + m.group(3) + noun + text[m.end(4):]


def fix_stated_counts(W: str, h: str, real: dict) -> tuple:
    """Every count a synthesis states — "four papers", "five qualitative
    studies", "two reviews" — must match what its section holds. W34's
    Infertility synthesis said "five qualitative studies" over four cards
    after curation removed one and the rewrite kept the word. The model
    reads the paragraph against the section's paper list (title + badge)
    and rewrites only the sentences whose counts disagree; markers at the
    sentence end are kept. Returns (h, sentences_changed)."""
    changed = 0
    for t in _topic_sections(h):
        cards = []
        for card in re.findall(r'<article class="mz-cite-card[\s\S]*?</article>', t.group(0)):
            pm = re.search(r'id="mz-cite-(\d{5,9})', card) or re.search(r"openDeepDive\('dd-(\d+)'", card)
            b = re.search(r'mz-cite-design">([^<]*)<', card)
            if pm:
                cards.append({"pmid": pm.group(1), "title": (real.get(pm.group(1)) or {}).get("title", "")[:120],
                              "design": H.unescape(b.group(1)) if b else ""})
        sec = _section_span(h, t.tid)
        pm_ = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', sec.group(0))
        if not pm_ or not cards:
            continue
        frag = pm_.group(1)
        base = sec.start() + pm_.start(1)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        if not sents:
            continue
        # the whole-section count that opens a synthesis is known exactly:
        # set it here, never by asking (the model counted W23's three pelvic
        # pain papers as one because two titles did not say "pelvic pain")
        lead = _leading_count(sents[0][0])
        if lead is not None and lead != len(cards):
            new0 = _set_leading_count(sents[0][0], len(cards))
            a = base + _sentence_start(masked, 0)
            b = base + sents[0][1]
            h = _replace_span(h, a, b, new0)
            changed += 1
            print(f"  count set in {t.tid}: {new0[:90]!r}")
            sec = _section_span(h, t.tid)
            pm_ = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', sec.group(0))
            frag = pm_.group(1)
            base = sec.start() + pm_.start(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
        listing = "\n".join(f"[{i + 1}] {x}" for i, (x, _) in enumerate(sents))
        by_design = __import__("collections").Counter(re.sub(r"\s*·.*$", "", c["design"]).strip() for c in cards if c["design"])
        reviews = sum(n for d, n in by_design.items() if "review" in d.lower() or "meta-analysis" in d.lower())
        trials = sum(n for d, n in by_design.items() if "trial" in d.lower())
        v = _ask_cached(W, "counts", f"""This is the opening paragraph of one section of a clinician-facing weekly evidence brief, sentence
by sentence, and the complete list of papers the section holds ({len(cards)} papers, with each one's
study design). Sentence [1]'s opening count is already correct; judge only counts BY KIND.
COUNTS BY DESIGN, from the badges: {json.dumps(dict(by_design), ensure_ascii=False)} — reviews (any review or
meta-analysis): {reviews}; trials: {trials}. "Four reviews converge…" over three review-badged papers is wrong.
PAPERS IN THIS SECTION: {json.dumps(cards, ensure_ascii=False)}
SENTENCES:
{listing}
Find every sentence that states a COUNT of papers or studies that does not match the list. HOW TO
COUNT: a count of the section's papers as a whole — "three fibroid papers this week", "five papers",
"one adenomyosis paper" — means EVERY paper the section holds, whatever each title is about, so the
right number is {len(cards)}; only a count qualified by design or kind — "two reviews", "five
qualitative studies", "three trials" — is the number of listed papers of that kind. For each wrong
count, give the sentence rewritten with the correct count and nothing else changed; plain text, no
citation markup, ending as the original does. A sentence whose count is already right is not
changed.
Reply with ONLY {{"changes": [{{"sentence": <number>, "rewrite": "<text>"}}, ...]}} and {{"changes": []}} when every
stated count is right.""", timeout_s=600)
        if not v or not isinstance(v.get("changes"), list):
            die(f"the stated-count check returned no verdict for {t.tid}")
        edits = []
        for c in v["changes"]:
            try:
                idx = int(c.get("sentence"))
            except Exception:
                continue
            new = re.sub(r"\s+", " ", str(c.get("rewrite") or "")).strip()
            if not (1 <= idx <= len(sents)) or len(new) < 20 or len(new) > len(sents[idx - 1][0]) + 80:
                continue
            # a whole-section count the model returns must equal the cards;
            # W23's "Three chronic-pelvic-pain papers" came back as "One"
            lead = _leading_count(new)
            if idx == 1 and lead is not None and lead != len(cards):
                # the model re-counted the whole section by kind; ignore it
                continue
            if re.sub(r"\s+", " ", sents[idx - 1][0]).strip() == new:
                # the model flagged the count and then handed the sentence
                # back unchanged (W28: "Two fibroid papers" over three cards)
                v2 = _ask_cached(W, "counts", f"""This sentence from a section of a clinician-facing evidence brief states a count of papers that does
not match the section, which holds {len(cards)} papers in all:
{json.dumps(cards, ensure_ascii=False)}
SENTENCE: {json.dumps(sents[idx - 1][0])}
Rewrite it with the correct count — every paper the section holds ({len(cards)}) when it counts the
section's papers as a whole, or the number of listed papers of a stated kind when it counts a kind —
and nothing else changed; plain text, no citation markup.
Reply with ONLY {{"rewrite": "<text>"}}""", timeout_s=600)
                new = re.sub(r"\s+", " ", str((v2 or {}).get("rewrite") or "")).strip()
                if not new or new == re.sub(r"\s+", " ", sents[idx - 1][0]).strip():
                    die(f"a stated count in {t.tid} could not be corrected: {sents[idx - 1][0][:100]!r}")
            a = base + _sentence_start(masked, sents[idx - 2][1] if idx >= 2 else 0)
            b = base + sents[idx - 1][1]
            edits.append((a, b, new))
        for a, b, new in sorted(edits, key=lambda e: -e[0]):
            h = _replace_span(h, a, b, new)
            changed += 1
            print(f"  count corrected in {t.tid}: {new[:100]!r}")
    return h, changed


# A sentence that says a paper is absent while carrying a marker to it.
# "Nothing on myomectomy this week" with no citation is a true statement about
# a topic; the same words with a marker on them point a reader at the very
# paper being denied.
_ABSENCE_RE = re.compile(
    r"(?:never\s+(?:made|reached|entered)|did\s*n[o\u2019']?t\s+(?:make|reach|enter)"
    r"|was\s+(?:excluded|left\s+out|dropped|cut)|is\s*n[o\u2019']?t\s+(?:covered|carded|included|here)"
    r"|fell\s+outside|left\s+off|kept\s+out)"
    r"[^.]{0,40}?\b(?:this\s+brief|the\s+brief|this\s+week|the\s+week|scope"
    r"|(?:this|the)\s+(?:final\s+)?(?:list|cut|selection|line-?up))\b", re.I)


def fix_claimed_absences(W: str, h: str, real: dict) -> tuple:
    """A sentence cannot say a paper is absent while citing that paper.

    W21's bottom line read "…but it never made this brief's final list" with a
    marker on it pointing at a card the brief carries; a reader clicks the
    marker and finds the paper. This is the mirror of `remove_orphan_studies`,
    which only ever asked the other question — prose reporting a study the
    brief does NOT hold — so nothing looked at this direction at all, and the
    read-back audit kept naming it round after round while each repair
    rewrote the words and left the contradiction.

    A sentence qualifies only when it both reads as an absence claim AND
    carries a marker to a paper the brief holds. Returns (h, sentences_fixed).
    """
    fixed = 0
    for _round in range(2):
        edits = []
        for ps in _prose_passages(h):
            frag = ps.group(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
            items, per = [], {}
            for k, (t, e) in enumerate(sents):
                if not _ABSENCE_RE.search(t):
                    continue
                s0 = _sentence_start(masked, sents[k - 1][1] if k >= 1 else 0)
                held = []
                for sm in SUP_RE.finditer(frag, s0, _after_run(frag, e)):
                    q = _pmid_of(sm.group(0))
                    if q and _has_card(h, q):
                        held.append(q)
                if not held:
                    continue
                papers = [{"pmid": q, "title": (real.get(q) or {}).get("title", "")[:150],
                           "first_author": ((real.get(q) or {}).get("authors") or "").split(",")[0].strip()}
                          for q in dict.fromkeys(held)]
                items.append({"sentence": len(items) + 1, "text": re.sub(r"\s+", " ", t).strip()[:600],
                              "papers_the_brief_holds_and_this_sentence_cites": papers})
                per[len(items)] = (ps.start(1) + s0, ps.start(1) + e)
            if not items:
                continue
            v = _ask_cached(W, "absence", f"""Each sentence below comes from a clinician-facing evidence brief and reads as though a paper is
absent from the brief — not covered, never made the list, excluded. Each one also carries a citation
marker to a paper the brief DOES hold and DOES card, listed beside it. A reader clicks the marker and
finds the paper, so the sentence contradicts the page.

SENTENCES: {json.dumps(items, ensure_ascii=False)[:40000]}

Rewrite each sentence so it no longer says those papers are absent, keeping everything else — the
same first-person surgeon's voice, the same length or shorter, every figure, every other claim. If
the sentence's point was that the paper sits OUTSIDE this week's main themes, say that instead of
saying it is not here. Plain text, no citation markup, ending with a full stop.
Reply with ONLY {{"rewrites": [{{"sentence": <number>, "text": "<the corrected sentence>"}}, ...]}} for EVERY sentence given.""",
                            timeout_s=900)
            for r in ((v or {}).get("rewrites") or []):
                try:
                    idx = int(r.get("sentence"))
                except (TypeError, ValueError):
                    continue
                new = re.sub(r"\s+", " ", str(r.get("text") or "")).strip()
                if idx not in per or writer_reject(new):
                    continue
                a, b = per[idx]
                if len(new) > max(400, int((b - a) * 1.4)):
                    continue
                edits.append((a, b, new))
        if not edits:
            break
        for a, b, new in sorted(edits, key=lambda e: -e[0]):
            keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
            h = _replace_span(h, a, b, new)
            at = _after_run(h, a + len(H.escape(new, quote=False)))
            if keep and keep not in h[a:at + len(keep)]:
                h = h[:at] + keep + h[at:]
            fixed += 1
            print(f"  a sentence said a paper was not in the brief while citing it: {new[:96]!r}")
    return h, fixed


def resolve_embedded_markers(W: str, h: str, real: dict) -> tuple:
    """A marker that stands IN the sentence — "The most clinically actionable
    is ⟨marker⟩, asking whether…" — is not a citation after a claim; the old
    generator used the marker as the paper's name. Relocating it to the
    sentence end left "…actionable is , asking whether…" (W24). For every
    sentence with a mid-sentence marker the model rewrites the sentence with
    the reference in words where the grammar needs it (or nothing where it
    does not), and the code moves those markers to the end of the sentence.
    Returns (h, sentences_rewritten)."""
    changed = 0
    out, last = [], 0
    for ps in _prose_passages(h):
        frag = ps.group(1)
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        if not sents:
            out.append(h[last:ps.start(1)]); out.append(frag); last = ps.end(1)
            continue
        # mid-sentence markers per sentence, with the text they sit in
        items, per = [], {}
        for k, (t, e) in enumerate(sents):
            prev_end = sents[k - 1][1] if k >= 1 else 0
            s0 = _sentence_start(masked, prev_end)
            mids = []
            # a marker standing BEFORE the sentence's first word, as its
            # subject ("⟨23⟩ is an RCT of…", "⟨26⟩ joins from the access
            # side"): the sentence text then starts in lowercase or with a
            # comma, and the marker sits in the gap after the previous stop
            if re.match(r"[a-z,;]", t):
                for sm in SUP_RE.finditer(frag, prev_end, s0):
                    mids.append(sm)
                if mids:
                    s0 = mids[0].start()
            for sm in SUP_RE.finditer(frag, s0, e):
                if any(sm.start() == x.start() for x in mids):
                    continue
                before = H.unescape(re.sub(r"<[^>]+>", "", masked[s0:sm.start()])).rstrip(" \t\r\n\xa0")
                after = H.unescape(re.sub(r"<[^>]+>", "", masked[sm.end():e])).strip(" \t\r\n\xa0")
                if before and after and not re.search(r"[.!?][)\]\"\u201d\u2019']*$", before):
                    mids.append(sm)
            if not mids:
                continue
            # the sentence with each embedded marker shown as a reference token
            shown, pos = "", s0
            for j, sm in enumerate(mids):
                q = _pmid_of(sm.group(0)) or "?"
                r = real.get(q) or {}
                au = (r.get("authors") or "").split(",")[0].strip()
                shown += frag[pos:sm.start()] + f" ⟦REF{j + 1}: {au or 'the study'} — {(r.get('title') or '')[:70]}⟧ "
                pos = sm.end()
            shown += frag[pos:e]
            shown = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", SUP_RE.sub(" ", shown)))).strip()
            items.append({"sentence": k + 1, "text": shown})
            per[k + 1] = (s0, e, mids)
        if not items:
            out.append(h[last:ps.start(1)]); out.append(frag); last = ps.end(1)
            continue
        v = _ask_cached(W, "embedded", f"""Sentences from a clinician-facing evidence brief in which a citation reference stands INSIDE the
sentence as a token ⟦REFn: first author — title⟧. The reference will be shown as a numbered marker at
the END of the sentence, so rewrite each sentence WITHOUT the tokens: where the sentence reads
correctly with a token simply removed, remove it; where the token is the grammatical subject or
object ("The most clinically actionable is ⟦REF1⟧, asking whether…"), put the study into words in
its place — "Chen et al.'s cohort", "the MAUDE device review", "a 2026 case report" — from the
token's author and title. Change nothing else. Plain text, no markup, same voice.
SENTENCES: {json.dumps(items, ensure_ascii=False)}
Reply with ONLY {{"rewrites": [{{"sentence": <number>, "text": "<the sentence without tokens>"}}, ...]}} for EVERY sentence given.""",
                        timeout_s=900)
        if not v or not isinstance(v.get("rewrites"), list):
            die("the embedded-marker rewrite returned no verdict")
        got = {}
        for r in v["rewrites"]:
            try:
                got[int(r.get("sentence"))] = re.sub(r"\s+", " ", str(r.get("text") or "")).strip()
            except Exception:
                continue
        missing = [k for k in per if not got.get(k) or "⟦" in got[k]]
        if missing:
            die(f"the embedded-marker rewrite skipped or kept tokens in sentence(s) {missing[:4]}")
        frag_out = frag
        for k in sorted(per, key=lambda x: -per[x][0]):
            s0, e, mids = per[k]
            markers = "".join(dict.fromkeys(sm.group(0) for sm in mids))
            # remove the embedded markers, replace the prose, re-attach the
            # markers after the sentence's run
            body = frag_out[s0:e]
            for sm in mids:
                body = body.replace(sm.group(0), "", 1)
            new_body = _replace_span(body, 0, len(body), got[k])
            frag_out = frag_out[:s0] + new_body + frag_out[e:]
            at = _after_run(frag_out, s0 + len(new_body))
            frag_out = frag_out[:at] + markers + frag_out[at:]
            changed += 1
        out.append(h[last:ps.start(1)]); out.append(frag_out); last = ps.end(1)
    out.append(h[last:])
    return "".join(out), changed


def fix_pyramid_bars(h: str) -> tuple:
    """Every evidence-pyramid row's bar agrees with the number printed on it.

    A trend brief had a tier marked empty, count 0, still drawing a 6% bar —
    a reader sees a bar and a zero beside it. The bar is a picture of the
    count, so it is computed from the count: the largest row is full width,
    the others are proportional, and a zero count draws nothing and carries
    the empty-tier class. Returns (h, rows_changed).
    """
    n = 0

    def pyramid(m):
        nonlocal n
        block = m.group(0)
        rows = list(re.finditer(r'<div class="([^"]*mz-pyramid-row[^"]*)"([^>]*)>([\s\S]*?)</div>\s*(?=<div|</div>|$)', block))
        counts = []
        for r in rows:
            c = re.search(r'<span class="mz-pyramid-count">\s*(\d+)\s*</span>', r.group(3))
            counts.append(int(c.group(1)) if c else None)
        top = max([c for c in counts if c is not None] or [0])
        if not top:
            return block
        out, last = [], 0
        for r, c in zip(rows, counts):
            if c is None:
                continue
            want = 0 if c == 0 else max(4, round(100 * c / top))
            cls = [x for x in r.group(1).split() if x != "mz-tier-empty"]
            if c == 0:
                cls.append("mz-tier-empty")
            attrs = re.sub(r'\s*style="[^"]*"', "", r.group(2))
            new = f'<div class="{" ".join(cls)}"{attrs} style="--mz-bar: {want}%;">{r.group(3)}</div>'
            if new != block[r.start():r.end()].rstrip()[:len(new)] and new != r.group(0).rstrip():
                n += 1
            out.append(block[last:r.start()]); out.append(new); last = r.end()
        out.append(block[last:])
        return "".join(out)

    return re.sub(r'<div class="[^"]*mz-evidence-pyramid[^"]*"[\s\S]*?</div>\s*</div>', pyramid, h), n


def drop_empty_list_items(h: str) -> tuple:
    """A list item left with nothing in it is a blank bullet a reader sees.

    Removing a sentence that was the whole of a recommendation emptied its
    <li>, and the read-back audit refused the brief for it. The item goes, and
    a list left with no items goes with it. Returns (h, items_dropped).
    """
    def blank(inner: str) -> bool:
        t = H.unescape(re.sub(r"<[^>]+>", "", SUP_RE.sub("", inner)))
        return not re.sub(r"[\s\u00a0]|&nbsp;", "", t)

    n = 0
    while True:
        m = next((x for x in re.finditer(r"<li\b[^>]*>([\s\S]*?)</li>", h) if blank(x.group(1))), None)
        if not m:
            break
        h = h[:m.start()] + h[m.end():]
        n += 1
    h = re.sub(r"<(ol|ul)\b[^>]*>\s*</\1>", "", h)
    return h, n


def refresh_shape_chart(h: str) -> str:
    """The older generator's "Where the week's research landed" chart: one
    row per topic with a count and a bar. After curation its rows still
    named removed topics and stale counts (W24). Rows follow the sections
    that exist; counts are the cards; the caption's totals are recomputed."""
    m = None
    for cand in re.finditer(r"<section\b[^>]*>", h):
        b = _element_end(h, "section", cand.end())
        if '<div class="mz-shape-chart"' in h[cand.end():b] and "mz-cite-card" not in h[cand.end():b]:
            m = type("M", (), {"start": lambda self: cand.start(), "end": lambda self: b, "group": lambda self, n=0: h[cand.start():b]})()
            break
    if not m:
        return h
    sec = m.group(0)
    tops = _topic_sections(h)
    by_title = {}
    for t in tops:
        tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", t.group(1), re.S)
        title = H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip() if tt else t.tid
        title = re.sub(r"\s*(?:\d+ papers?|\(\d+\))\s*$", "", title)
        by_title[title.lower()] = t
    counts = {}
    for row in re.findall(r'<div class="mz-shape-row"[\s\S]*?</div>', sec):
        lab = re.search(r'mz-shape-(?:row-)?label">([\s\S]*?)</span>', row)
        tid = _match_heading(H.unescape(re.sub(r"<[^>]+>", "", lab.group(1))), {k: v.tid for k, v in by_title.items()}) if lab else None
        if tid:
            seg = next(t.group(0) for t in tops if t.tid == tid)
            counts[row] = (tid, len(set(re.findall(CARD_ID_RE, seg)) | set(re.findall(r"openDeepDive\('dd-(\d+)'", seg))))
        else:
            counts[row] = (None, 0)
    top = max([c for _, c in counts.values()] or [1]) or 1
    for row, (tid, n) in counts.items():
        if not tid:
            sec = sec.replace(row, "", 1)
            continue
        new = re.sub(r"--mz-bar:\s*[\d.]+%", f"--mz-bar: {100.0 * n / top:.1f}%", row)
        new = re.sub(r'(mz-shape-(?:row-)?count">)\d+(</span>)', lambda mm: mm.group(1) + str(n) + mm.group(2), new)
        new = SUP_RE.sub("", new)  # a chart row is not a place for a citation
        sec = sec.replace(row, new, 1)
    total = sum(n for _, n in counts.values())
    kept = sum(1 for tid, _ in counts.values() if tid)
    sec = re.sub(r"\d+ papers across \d+ topics", f"{total} papers across {kept} topics", sec)
    sec = re.sub(r"(aria-label=\"[^\"]*?)\d+ papers", lambda mm: mm.group(1) + f"{total} papers", sec)
    return h[:m.start()] + sec + h[m.end():]


_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_NUMBER_PHRASE = re.compile(r"\d+|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\b"
                            r"|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred)\b", re.I)


def _numbers_in(text: str) -> set:
    """Every number in a text as digits: "Fifty-two" → 52, "ten" → 10, "49" → 49."""
    out = set()
    for m in _NUMBER_PHRASE.finditer(text.lower()):
        w = m.group(0)
        if w.isdigit():
            out.add(int(w)); continue
        parts = re.split(r"[- ]", w)
        n = 0
        for x in parts:
            if x in _TENS:
                n += _TENS[x]
            elif x in _NUM_WORDS:
                n += _NUM_WORDS[x]
            elif x == "zero":
                n += 0
            elif x == "hundred":
                n = (n or 1) * 100
        out.add(n)
    return out


def _plural(label: str, n: int) -> str:
    l = label.lower()
    if n == 1:
        return l
    if l.endswith("y") and not l.endswith(("ay", "ey", "oy", "uy")):
        return l[:-1] + "ies"
    if l.endswith(("s", "sis")):
        return l
    return l + "s"


def rewrite_stats_line(h: str, designs: dict, total: int, n_topics: int) -> tuple:
    """Two figures in a brief's own stats prose are data, not prose: the
    study-design tally and the topic count. W20's line read "Study designs
    represented (n = 52): 13 retrospective cohorts, 10 cross-sectional…" —
    categories summing to 42 — because a model rewrite fixed the total and
    left the list. Both are rebuilt from what the page holds."""
    changed = 0
    out, last = [], 0
    for ps in _prose_passages(h):
        frag = ps.group(1)
        new = frag
        m = re.search(r"Study designs represented\s*\(n\s*=\s*\d+\)\s*:[^.<]*", new)
        if m and designs:
            items = sorted(designs.items(), key=lambda kv: (-kv[1], kv[0]))
            listed = ", ".join(f"{n} {_plural(d, n)}" for d, n in items)
            new = new[:m.start()] + f"Study designs represented (n = {total}): {listed}" + new[m.end():]
        def fix_topics(mm):
            """Just the count; the caller keeps whatever words follow it."""
            w = mm.group(1)
            n = _numbers_in(w)
            if n and next(iter(n)) == n_topics:
                return w
            if w.isdigit():
                return str(n_topics)
            word = _num_word(n_topics)
            return word.capitalize() if w[0].isupper() else word
        # "72 papers across 9 topics this week" captions the shape chart: BOTH
        # figures are what the page holds, not a number a writer chose. W23
        # published saying 72 while holding 65, and W24 said 32 while holding
        # 31, because only the topic half was ever rebuilt.
        def fix_papers_across(mm):
            wp, wt = mm.group(1), mm.group(3)
            np_ = str(total) if wp.isdigit() else (_num_word(total).capitalize() if wp[0].isupper() else _num_word(total))
            nt = str(n_topics) if wt.isdigit() else (_num_word(n_topics).capitalize() if wt[0].isupper() else _num_word(n_topics))
            return f"{np_}{mm.group(2)}{nt}{mm.group(4)}"
        # "41 peer-reviewed papers across 9 subspecialty topics" is the same
        # sentence with adjectives in it; the audit had to catch that one by
        # reading, which is exactly the work this is meant to save
        new = re.sub(r"\b(\d+|[A-Za-z]+(?:-[a-z]+)?)((?:\s+[a-z]+(?:-[a-z]+)?){0,2}\s+papers?\s+"
                     r"(?:across|spanning|over|in|from)\s+)"
                     r"(\d+|[A-Za-z]+(?:-[a-z]+)?)((?:\s+[a-z]+(?:-[a-z]+)?){0,2}\s+topics?\b)",
                     fix_papers_across, new) if total else new
        new2 = re.sub(rf"\b({_COUNT_WORD})((?:\s+[a-z]+(?:-[a-z]+)?){{0,2}}\s+topics\b)",
                      lambda mm: fix_topics(mm) + mm.group(2), new, flags=re.I)
        if new2 != frag:
            changed += 1
        out.append(h[last:ps.start(1)]); out.append(new2); last = ps.end(1)
    out.append(h[last:])
    return "".join(out), changed


def fix_document_totals(W: str, h: str, real: dict) -> tuple:
    """Prose that states document-wide totals — "Eighty-four papers, eleven
    topics", "Female infertility (25 papers, 35%)" — says what the page now
    holds. W20's closing thoughts and subspecialty breakdown kept the
    pre-curation numbers. Returns (h, sentences_changed)."""
    tops = _topic_sections(h)
    per = []
    for t in tops:
        tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", t.group(1), re.S)
        title = re.sub(r"\s*(?:\d+ papers?|\(\d+\))\s*$", "", H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip()) if tt else t.tid
        per.append({"topic": title, "papers": len(set(re.findall(CARD_ID_RE, t.group(0))) | set(re.findall(r"openDeepDive\('dd-(\d+)'", t.group(0))))})
    all_cards = re.findall(r'<article class="mz-cite-card[\s\S]*?</article>', h)
    total = len({(re.search(r'id="mz-cite-(\d{5,9})', c) or re.search(r"openDeepDive\('dd-(\d+)'", c) or [None, None])[1] for c in all_cards} - {None})
    seen_pm, designs = set(), __import__("collections").Counter()
    for c in all_cards:
        pm = (re.search(r'id="mz-cite-(\d{5,9})', c) or re.search(r"openDeepDive\('dd-(\d+)'", c) or [None, None])[1]
        if not pm or pm in seen_pm:
            continue  # a paper carded under two headings is one paper
        seen_pm.add(pm)
        d = re.sub(r"\s*·.*$", "", H.unescape((re.search(r'mz-cite-design">([^<]*)<', c) or [None, ""])[1])).strip()
        if d:
            designs[d] += 1
    # the deep-dive (journal club) section: "N papers worth a careful read" and
    # "the M papers not deep-read" are derived from it
    jc = re.search(r'<section class="[^"]*mz-journal-club[^"]*"[^>]*>', h)
    deep = 0
    if jc:
        jb = _element_end(h, "section", jc.end())
        deep = len(re.findall(r'class="mz-jc-card', h[jc.end():jb])) or len(re.findall(r"<article\b", h[jc.end():jb]))
    facts = {"papers_in_this_brief": total, "topics": len(per), "per_topic": per,
             "percent_of_total": {x["topic"]: round(100 * x["papers"] / total) for x in per} if total else {},
             "papers_by_study_design": dict(designs),
             "deep_dive_papers": deep, "papers_not_deep_dived": max(total - deep, 0)}
    allowed = {total, len(per), deep, max(total - deep, 0)} | {x["papers"] for x in per} | set(facts["percent_of_total"].values()) | set(designs.values())
    # numbers a writer derives from the facts: "the remaining 14 papers across
    # seven other topics" is the total minus the four largest topics
    from itertools import combinations
    counts = [x["papers"] for x in per]
    for k in range(1, min(4, len(counts)) + 1):
        for combo in combinations(counts, k):
            allowed.add(sum(combo)); allowed.add(max(total - sum(combo), 0))
    allowed |= {max(len(per) - k, 0) for k in range(len(per) + 1)}
    allowed |= {sum(v) for v in [list(designs.values())]} | {max(total - v, 0) for v in designs.values()}
    h, n_stats = rewrite_stats_line(h, dict(designs), total, len(per))
    if n_stats:
        print(f"  {n_stats} stats line(s) rebuilt from what the brief holds")
    changed = n_stats
    all_edits = []
    for ps in [p for p in _prose_passages(h) if p.kind == "prose"]:
        frag = ps.group(1)
        masked = _mask_noprose(frag)
        # a heading is not a sentence to rewrite ("Three papers worth a careful
        # read" became "Zero papers…" on W20)
        masked = re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", lambda x: " " * len(x.group(0)), masked)
        sents = _sentences_of(masked)
        if not sents or not re.search(r"\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b", " ".join(t for t, _ in sents), re.I):
            continue
        listing = "\n".join(f"[{i + 1}] {t}" for i, (t, _) in enumerate(sents))
        v = _ask_cached(W, "counts", f"""A passage from a clinician-facing weekly evidence brief, sentence by sentence, and the FACTS of what the
brief now holds after curation:
{json.dumps(facts, ensure_ascii=False)}
SENTENCES:
{listing}
Find every sentence stating a document-wide total or share — how many papers this week, how many
topics, how many papers a topic has, a percentage of the whole, "the N papers not deep-read" — that
disagrees with the facts. Give each such sentence rewritten with the right figures (words or digits
as the original used) and nothing else changed; plain text, no citation markup. A sentence about a
single study's own numbers is not a total and is not changed.
Reply with ONLY {{"changes": [{{"sentence": <number>, "rewrite": "<text>"}}, ...]}} and {{"changes": []}} when
every total is right.""", timeout_s=600)
        if not v or not isinstance(v.get("changes"), list):
            die("the document-totals check returned no verdict")
        edits = []
        for c in v["changes"]:
            try:
                idx = int(c.get("sentence"))
            except Exception:
                continue
            new = re.sub(r"\s+", " ", str(c.get("rewrite") or "")).strip()
            if not (1 <= idx <= len(sents)) or len(new) < 15 or len(new) > len(sents[idx - 1][0]) + 80:
                continue
            if new == re.sub(r"\s+", " ", sents[idx - 1][0]).strip():
                continue
            # every number the rewrite introduces must be one of the facts
            fresh = sorted((_numbers_in(new) - _numbers_in(sents[idx - 1][0]) - allowed) | ({0} & _numbers_in(new)))
            if fresh:
                print(f"  total rewrite rejected (introduces {fresh[:3]} not in the facts): {new[:80]!r}")
                continue
            a = ps.start(1) + _sentence_start(masked, sents[idx - 2][1] if idx >= 2 else 0)
            b = ps.start(1) + sents[idx - 1][1]
            edits.append((a, b, new))
        all_edits.extend(edits)
    # every offset was measured on the same body: apply from the end, or an
    # early edit shifts every later passage ("ThZero papers", "EighFifty-five")
    for a, b, new in sorted(all_edits, key=lambda e: -e[0]):
        h = _replace_span(h, a, b, new)
        changed += 1
        print(f"  total corrected: {new[:100]!r}")
    return h, changed


ABSTRACT_LABEL_RE = re.compile(r"\b(?:M?ETHODS|R?ESULTS|C?ONCLUSIONS?|B?ACKGROUND|O?BJECTIVES?|P?URPOSE|F?INDINGS)\s*:")


def strip_verbatim_abstract_sentences(h: str, real: dict) -> tuple:
    """Remove prose sentences that reproduce a covered paper's own abstract.

    W21 carried a whole paragraph of one paper's methods inside its
    infertility synthesis — "I designed this as a prospective, randomized,
    controlled, single-center…", the abstract's own first person. Sentence
    rewriting cannot rescue pasted source; it goes, and its citations stay.
    A prose sentence sharing 60 consecutive normalised characters with any
    abstract is pasted, not written. Returns (h, removed)."""
    def norm(x):
        return re.sub(r"[^a-z0-9]", "", H.unescape(re.sub(r"<[^>]+>", " ", x)).lower())
    pool = [norm(v.get("abstract") or "") for v in real.values() if (v.get("abstract") or "").strip()]
    if not pool:
        return h, 0
    removed = 0
    for _round in range(60):
        target = None
        for ps in _prose_passages(h):
            frag = ps.group(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
            for i, (t, e) in enumerate(sents):
                n = norm(t)
                if len(n) < 60:
                    # a short fragment that is copied AND broken ("The study
                    # was developed in the.") is an edit's leftover, not prose
                    if len(n) >= 15 and _looks_broken(t) and any(n in ab for ab in pool):
                        a = ps.start(1) + _sentence_start(masked, sents[i - 1][1] if i >= 1 else 0)
                        target = (a, ps.start(1) + e, t)
                        break
                    continue
                # the sentence must BEGIN in the abstract's words (pasted
                # source), or repeat two separate long stretches of it. A
                # sentence that merely ends by describing the study is the
                # surgeon's own framing and stays.
                if any(n[:60] in ab or (len(n) > 200 and n[60:120] in ab and n[-60:] in ab) for ab in pool):
                    a = ps.start(1) + _sentence_start(masked, sents[i - 1][1] if i >= 1 else 0)
                    target = (a, ps.start(1) + e, t)
                    break
            if target:
                break
        if not target:
            return h, removed
        a, b, t = target
        keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
        h = h[:a] + keep + h[b:]
        removed += 1
        print(f"  removed a sentence copied from a paper's abstract: {t[:100]!r}")
    return h, removed


def rewrite_pasted_abstract_text(W: str, h: str) -> tuple:
    """A sentence of the site's own prose carrying an abstract's section label
    is pasted source text, not writing. W21's infertility synthesis opened
    "ETHODS: This is a prospective, randomized…". Each such sentence is
    rewritten in plain clinical words, its citations kept.
    Returns (h, rewritten)."""
    done = 0
    for _round in range(3):
        target = None
        for ps in _prose_passages(h):
            frag = ps.group(1)
            masked = _mask_noprose(frag)
            sents = _sentences_of(masked)
            for i, (t, e) in enumerate(sents):
                if ABSTRACT_LABEL_RE.search(t):
                    a = ps.start(1) + _sentence_start(masked, sents[i - 1][1] if i >= 1 else 0)
                    target = (a, ps.start(1) + e, t)
                    break
            if target:
                break
        if not target:
            return h, done
        a, b, sentence = target
        keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
        v = _ask_cached(W, "audit_fix", f"""This sentence of a clinician-facing evidence brief is pasted abstract text — it still carries the
abstract's own section label. Rewrite it as the surgeon's own plain clinical prose, first person,
keeping every fact and figure it states and dropping the label. One or two sentences, at most as long
as the original, ending with a full stop. Plain text, no markup.
THE SENTENCE: {json.dumps(sentence)}
Reply with ONLY {{"sentence": "<the rewritten prose>"}}""", timeout_s=600)
        new = re.sub(r"\s+", " ", str((v or {}).get("sentence") or "")).strip()
        if writer_reject(new):
            new = ""
        if not new:
            # unusable: drop the pasted sentence, keep its citations
            h = h[:a] + keep + h[b:]
            print("  removed a pasted-abstract sentence from the site's prose")
        else:
            h = h[:a] + H.escape(new, quote=False) + keep + h[b:]
            print(f"  rewrote pasted abstract text as prose: {new[:100]!r}")
        done += 1
    return h, done


def strip_markers_in_abstracts(h: str) -> tuple:
    """A verbatim abstract carries no citations of ours. W20 had markers
    inside <details class="mz-abstract"> blocks: collapsed by default, so a
    reader can never hover them and the rendered gate refuses the page.
    Returns (h, removed)."""
    n = 0

    def clean(m):
        nonlocal n
        inner = m.group(0)
        k = len(SUP_RE.findall(inner))
        if not k:
            return inner
        n += k
        return SUP_RE.sub("", inner)
    h = re.sub(r"<details[^>]*>[\s\S]*?</details>", clean, h)
    return h, n


def cite_and_review(W: str, h: str, pmids: list, real: dict) -> tuple:
    """THE ONE CITATION CHAIN. Shared by the weekly `run` (apply stage) and by
    `renumber`, so a published brief and next week's brief are cited, reviewed
    and corrected by the same code — owner, 2026-09-19: "this is tied to a
    scheduled automated routine… they should be done right the first time."

    prose may report only papers the brief holds → relocate markers to
    sentence ends → verify design badges → model places citations sentence by
    sentence → targeted pass on named authors → every marker reviewed against
    its abstract (wrong paper: withdrawn by position; misstated: the sentence
    is rewritten from the abstract and reviewed again; still wrong: refuse).
    Returns (h, citations_added, names_declined)."""
    h, n_noev = withdraw_citations_from_absence_claims(h)
    if n_noev:
        print(f"  {n_noev} citation(s) withdrawn from sentences claiming no evidence exists")
    h, n_inab = strip_markers_in_abstracts(h)
    if n_inab:
        print(f"  {n_inab} citation marker(s) removed from verbatim abstract blocks (a reader cannot open them)")
    h, n_verb = strip_verbatim_abstract_sentences(h, real)
    if n_verb:
        print(f"  {n_verb} sentence(s) copied from abstracts removed from the site's prose")
    h, n_pasted = rewrite_pasted_abstract_text(W, h)
    if n_pasted:
        print(f"  {n_pasted} pasted-abstract sentence(s) rewritten as the site's own prose")
    h, n_cards = refresh_card_abstracts(h, real)
    if n_cards:
        print(f"  {n_cards} card(s) given their PubMed abstract and metadata")
    h, n_attrib = fix_card_attribution(W, h, real)
    if n_attrib:
        print(f"  {n_attrib} card(s) that credited the wrong authors corrected")
    h, orphaned = remove_orphan_studies(W, h, pmids, real)
    if orphaned:
        print(f"  {orphaned} sentence(s) rewritten or removed for reporting a study the brief does not hold")
    h, absent = fix_claimed_absences(W, h, real)
    if absent:
        print(f"  {absent} sentence(s) that denied holding a paper they cite corrected")
    h, resolved = resolve_embedded_markers(W, h, real)
    if resolved:
        print(f"  {resolved} sentence(s) rewritten so a reference that stood inside the sentence reads as words")
    h, relocated = relocate_mid_sentence_markers(h)
    if relocated:
        print(f"  moved {relocated} marker(s) standing mid-sentence to the end of their sentence")
    h, retagged = verify_design_tags(W, h, real)
    if retagged:
        print(f"  corrected {retagged} study-design badge(s) against the papers' own abstracts")
    h, named = cite_prose(W, h, pmids, real)
    h, named2, declined = cite_named_studies(W, h, pmids, real)
    if named2:
        print(f"  inserted {named2} more citation(s) on sentences that name a covered paper's author")
    named += named2
    h, by_sent, appended = cite_every_card(W, h, real)
    if by_sent or appended:
        print(f"  every card cited: {by_sent} placed on the sentence that reports the paper, "
              f"{appended} sentence(s) written from the abstract into the synthesis")
    named += by_sent + appended
    h, filled = cite_missing_studies(W, h, pmids, real)
    if filled:
        print(f"  completeness pass: {filled} citation(s) added on sentences that reported a study not yet cited on them")
    named += filled
    h, recounted = fix_stated_counts(W, h, real)
    if recounted:
        print(f"  {recounted} stated count(s) corrected against what the section holds")
    h, retotalled = fix_document_totals(W, h, real)
    if retotalled:
        print(f"  {retotalled} document-wide total(s) corrected against what the brief holds")
    if named:
        print(f"  inserted {named} citation(s) on studies the prose names by author")
    withdrawn, unsupported = set(), []
    if SUP_RE.search(h):
        withdrawn, unsupported = review_inserted_citations(W, h, real)
        # Both the withdrawal positions and the sentence spans are offsets into
        # THIS h. Withdrawals go first, from the end; each deletion before a
        # span shifts that span left by the marker's length.
        deleted = []
        if withdrawn:
            # ONLY the instances judged wrong. Other citations to the same paper
            # stand: a misplaced marker in one sentence says nothing about a
            # correct one in another.
            gone_pm = []
            for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                if m.start() in withdrawn:
                    gone_pm.append(_pmid_of(m.group(0)))
                    deleted.append((m.start(), m.end() - m.start()))
                    h = h[:m.start()] + h[m.end():]
            print(f"  withdrew {len(gone_pm)} misplaced citation(s) ({', '.join(sorted(set(x for x in gone_pm if x))[:6])})"
                  f" — other citations to those papers stand")
        if unsupported:
            for u in unsupported:
                a, b = u["_span"]
                shift = sum(n for at, n in deleted if at < a)
                u["_span"] = (a - shift, b - shift)
            h, n_fixed = correct_unsupported_sentences(W, h, unsupported, real)
            if n_fixed:
                print(f"  {n_fixed} sentence(s) corrected against their papers' abstracts — reviewing again")
                # the corrected sentences are judged like any other; a claim
                # that still misstates its paper refuses the brief, named
                again_wrong, again_unsupported = review_inserted_citations(W, h, real)
                if again_unsupported:
                    # once more, with the re-review's reason, before refusing
                    h, n2 = correct_unsupported_sentences(W, h, again_unsupported, real, round_no=2)
                    if n2:
                        print(f"  {n2} sentence(s) corrected a second time — reviewing again")
                        again_wrong, again_unsupported = review_inserted_citations(W, h, real)
                if again_unsupported:
                    # The sentence is not about this paper and rewriting it
                    # twice did not make it so (W21: a summary sentence about
                    # "two French" studies carrying a Chinese cohort's
                    # marker). Take the citation off that sentence and give
                    # the paper its own sentence instead.
                    pos = {u["_at"] for u in again_unsupported}
                    for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                        if m.start() in pos:
                            h = h[:m.start()] + h[m.end():]
                    print(f"  withdrew {len(pos)} citation(s) from sentences that are not about them")
                    h, by4, app4 = cite_every_card(W, h, real, force_new={u["pmid"] for u in again_unsupported})
                    if by4 or app4:
                        print(f"  gave {by4 + app4} paper(s) a citation of their own")
                        named += by4 + app4
                    wrong4, unsup4 = review_inserted_citations(W, h, real)
                    if unsup4:
                        # stop composing and start cutting: keep only what the
                        # abstract supports, and delete a sentence that has
                        # nothing left
                        h, nn, nr = narrow_to_abstract(W, h, unsup4, real)
                        if nn or nr:
                            print(f"  {nn} sentence(s) narrowed to their abstracts, {nr} removed — reviewing again")
                            wrong4, unsup4 = review_inserted_citations(W, h, real)
                    if unsup4:
                        die("after two corrections, a re-citation and a narrowing, sentence(s) still misstate their papers: "
                            + "; ".join(f"{u['pmid']}: {u['why'][:100]}" for u in unsup4[:4]))
                    again_wrong = wrong4
                if again_wrong:
                    for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                        if m.start() in again_wrong:
                            h = h[:m.start()] + h[m.end():]
                    print(f"  withdrew {len(again_wrong)} citation(s) judged the wrong paper on re-review")
    # A withdrawal can leave a card with no citation in its section (W24: the
    # old generator had stacked menopause papers onto infertility sentences;
    # eighteen went). Every card is cited again, and what that adds is reviewed.
    h, by3, app3 = cite_every_card(W, h, real)

    if by3 or app3:
        print(f"  after the review, every card cited again: {by3} placed, {app3} sentence(s) written")
        named += by3 + app3
        wrong3, unsup3 = review_inserted_citations(W, h, real)
        if unsup3:
            h, n3 = correct_unsupported_sentences(W, h, unsup3, real, round_no=2)
            wrong3b, unsup3b = review_inserted_citations(W, h, real)
            if unsup3b:
                # the sentence is not about this paper: take the citation off
                # it and write the paper its own sentence from the abstract
                pos = {u["_at"] for u in unsup3b}
                for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                    if m.start() in pos:
                        h = h[:m.start()] + h[m.end():]
                print(f"  withdrew {len(pos)} citation(s) from sentences that are not about them")
                h, by5, app5 = cite_every_card(W, h, real, force_new={u["pmid"] for u in unsup3b})
                if by5 or app5:
                    print(f"  wrote {by5 + app5} sentence(s) from the abstracts for those papers")
                    named += by5 + app5
                wrong3b, unsup3b = review_inserted_citations(W, h, real)
                if unsup3b:
                    die("sentences written from the abstracts still misstate their papers: "
                        + "; ".join(f"{u['pmid']}: {u['why'][:100]}" for u in unsup3b[:4]))
            wrong3 |= wrong3b
        if wrong3:
            for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                if m.start() in wrong3:
                    h = h[:m.start()] + h[m.end():]
            print(f"  withdrew {len(wrong3)} citation(s) judged the wrong paper after the second every-card pass")
    # LAST: every writer above inserts prose — a correction, a written card
    # sentence, an audit repair — and one of them pasted an abstract's own
    # text into W21's infertility synthesis. Whatever put it there, it does
    # not reach the page.
    h, n_verb2 = strip_verbatim_abstract_sentences(h, real)
    h, n_end = rewrite_pasted_abstract_text(W, h)
    if n_end or n_verb2:
        print(f"  after the chain: {n_verb2} copied sentence(s) removed, {n_end} pasted-abstract sentence(s) rewritten")
    # LAST OF ALL: the card backstop, after every withdrawal has happened.
    # It ran earlier and found nothing to do, because the placement pass had
    # put a citation on a sentence that is not about that paper — W21's
    # UK-wide ART survey landed on a sentence describing a 19-woman interview
    # study. The review then withdrew it, three rounds running, and the brief
    # reached the gate with a card no sentence cites. A backstop that runs
    # before the last withdrawal is not a backstop.
    h, flat2 = cite_uncited_cards(W, h, real)
    if flat2:
        print(f"  {flat2} carded paper(s) left uncited by a withdrawal given a sentence of their own")
        named += flat2
    return h, named, declined


def review_inserted_citations(W: str, h: str, real: dict) -> tuple:
    """Every citation this pass inserted, judged against the paper's abstract.

    Inserting a marker is deterministic; whether the paper it points at is the
    one the sentence is talking about is not. The owner asked where the AI
    review went in this path — here: each inserted citation is checked, one
    verdict per citation, and a wrong one refuses the brief.
    """
    items, rejected = [], set()
    # Position, not paper. Withdrawing by PMID removed fifteen citations from
    # W33 including correct ones already standing in the syntheses, because one
    # instance of that paper was misplaced. Only the instance judged wrong goes.
    idx = 0
    for m in _prose_passages(h):
        frag = m.group(1) if m.group(1) is not None else m.group(2)
        base = m.start(1) if m.group(1) is not None else m.start(2)
        # THE REVIEWER IS HANDED THE SENTENCE THE MARKER ENDS, AND NOTHING ELSE
        # AS "THE SENTENCE". The first version passed the 320 characters before
        # the marker from the unmasked fragment — which, after the previous
        # marker's popover (title, journal line, a summary full of the
        # previous paper's figures), was mostly the PREVIOUS paper's hover
        # card. The reviewer read "90 Syrian women, 1.8 ng/mL" from that card,
        # judged this citation against it, and withdrew 27 correct citations
        # in a chain each "one paper behind". Popovers are masked with spaces,
        # so every index stays valid, and the sentence is located by its end.
        masked = _mask_noprose(frag)
        sents = _sentences_of(masked)
        for sm in SUP_RE.finditer(frag):
            pm = _pmid_of(sm.group(0))
            if not pm:
                continue
            # the sentence whose end is at (or nearest before) this marker;
            # markers sit right after the full stop, possibly behind other
            # markers on the same sentence
            k = max((j for j, (_, e) in enumerate(sents) if e <= sm.start()), default=None)
            if k is None:
                k = 0
            cur = sents[k][0] if sents else masked[:sm.start()][-320:]
            prev = sents[k - 1][0] if k >= 1 else ""
            nxt = sents[k + 1][0] if k + 1 < len(sents) else ""
            s_from = _sentence_start(masked, sents[k - 1][1] if k >= 1 else 0) if sents else 0
            s_to = sents[k][1] if sents else sm.start()
            # the other papers cited on this same sentence: a sentence that
            # pairs an NHANES cohort with a Mendelian-randomization study
            # rests on both, and each marker is judged for ITS part only
            co = []
            run_end = s_to
            while True:
                mm = SUP_RE.match(frag, run_end)
                if not mm:
                    break
                q = _pmid_of(mm.group(0))
                if q and q != pm:
                    co.append((real.get(q) or {}).get("title", "")[:140])
                run_end = mm.end()
            r = real.get(pm) or {}
            idx += 1
            items.append({"id": idx, "pmid": pm, "_at": base + sm.start(), "_span": (base + s_from, base + s_to),
                          "sentence": cur, "previous_sentence": prev[-240:], "next_sentence": nxt[:240],
                          "other_papers_cited_on_this_sentence": co,
                          "paper_title": r.get("title", ""), "abstract": (r.get("abstract") or "")[:2500]})
    if not items:
        return set(), []
    faults, unsupported = [], []
    for i in range(0, len(items), 6):
        chunk = items[i:i + 6]
        v = _ask_cached(W, "cites", f"""Each item below is ONE sentence from a clinical brief that carries a citation at its end, and the
paper that citation points at. The previous and next sentences are given for context only — judge
the citation against "sentence" alone.
A sentence may rest on MORE THAN ONE paper: when "other_papers_cited_on_this_sentence" is not
empty, the parts of the sentence about those papers are theirs to support, not this paper's. Judge
whether THIS paper is one the sentence is talking about ("right_paper"), and whether the part of the
sentence that concerns THIS paper is what its abstract says ("supported"). supported=false when
the sentence says something ABOUT THIS PAPER that its abstract does not — a figure it does not
report, the opposite direction of effect, a claim it did not make — or DESCRIBES THE PAPER WRONGLY:
its subject, device, condition, design or population (calling a sterilization-ring case report "an
LNG-IUS removal", a cohort "a trial", men "women"). Never fault a paper for the other papers' parts
of the sentence. Describing a paper by the CLINICAL AREA of the section it sits in is not a
misstatement: a dysmenorrhoea trial counted among "chronic-pelvic-pain papers", an adenomyosis
study among "pelvic pain" work, an endometrioma paper among "infertility" papers — clinical areas
overlap, and the brief groups by area.
ITEMS: {json.dumps([{k: x[k] for k in ("id", "pmid", "previous_sentence", "sentence", "next_sentence",
                                        "other_papers_cited_on_this_sentence", "paper_title", "abstract")} for x in chunk], ensure_ascii=False)[:90000]}
Reply with ONLY {{"items": [{{"id": <the id given>, "right_paper": true|false, "supported": true|false,
"why": "<one clause when either is false>"}}, ...]}} with one object for EVERY item given.""",
                    timeout_s=900)
        if not v or not isinstance(v.get("items"), list):
            die("the inserted-citation review returned no verdict")
        judged = {int(x["id"]) for x in v["items"] if str(x.get("id", "")).strip().isdigit()}
        missing = [x["id"] for x in chunk if x["id"] not in judged]
        replies = list(v["items"])
        if missing:
            # a reply cut short keeps its complete items; the rest are asked
            # for again on their own rather than refusing the brief
            rest = [x for x in chunk if x["id"] in missing]
            v2 = _ask_cached(W, "cites", f"""Each item below is ONE sentence from a clinical brief that carries a citation at its end, and the
paper that citation points at. Judge whether THIS paper is one the sentence is talking about
("right_paper") and whether the part of the sentence that concerns THIS paper is what its abstract
says ("supported"); other papers cited on the same sentence cover their own parts.
ITEMS: {json.dumps([{k: x[k] for k in ("id", "pmid", "previous_sentence", "sentence", "next_sentence",
                                        "other_papers_cited_on_this_sentence", "paper_title", "abstract")} for x in rest], ensure_ascii=False)[:90000]}
Reply with ONLY {{"items": [{{"id": <the id given>, "right_paper": true|false, "supported": true|false,
"why": "<one clause when either is false>"}}, ...]}} with one object for EVERY item given.""", timeout_s=900)
            if v2 and isinstance(v2.get("items"), list):
                replies += v2["items"]
                judged |= {int(x["id"]) for x in v2["items"] if str(x.get("id", "")).strip().isdigit()}
            missing = [x["id"] for x in chunk if x["id"] not in judged]
            if missing:
                die(f"the inserted-citation review skipped item(s) {missing[:4]} twice")
        by_id = {x["id"]: x for x in chunk}
        for r in replies:
            if not str(r.get("id", "")).strip().isdigit():
                continue
            it = by_id.get(int(r["id"]))
            if not it:
                continue
            if not r.get("right_paper"):
                faults.append(f"citation to {it['pmid']}: {str(r.get('why', ''))[:140]}")
                rejected.add(it["_at"])
            elif not r.get("supported"):
                # THE RIGHT PAPER, MISSTATED. Withdrawing the marker here would
                # leave a wrong claim standing uncited — worse than either
                # fault alone. The sentence is corrected against the abstract
                # instead (correct_unsupported_sentences) and keeps its citation.
                unsupported.append({**it, "why": str(r.get("why", ""))[:300]})
    if faults:
        for f_ in faults[:10]:
            print("  CITATION REVIEW:", f_)
    for u in unsupported[:10]:
        print(f"  CITATION REVIEW: {u['pmid']} is the right paper but the sentence misstates it — {u['why'][:120]}")
    print(f"  citation review: {len(items) - len(rejected) - len(unsupported)} of {len(items)} citation(s) confirmed"
          + (f"; {len(rejected)} withdrawn as the wrong paper for that claim" if rejected else "")
          + (f"; {len(unsupported)} sentence(s) to correct against the abstract" if unsupported else ""))
    return rejected, unsupported


def narrow_to_abstract(W: str, h: str, unsupported: list, real: dict) -> tuple:
    """Last resort: cut from a sentence every claim its paper does not make.

    Rewriting asks for a sentence that says the right thing, and a sentence
    whose subject is simply wider than any one paper cannot be rewritten into
    one — the MCAS/POTS/hEDS brief had a sentence naming rheumatology,
    cardiology and allergy-immunology beside a paper that discusses none of
    them, and two rewrites and a fresh citation all came back overstating it
    again. Deleting is a smaller question than composing, and the answer is
    always available: keep only what the abstract supports, and if that is
    nothing, the sentence goes. Returns (h, narrowed, removed).
    """
    narrowed = removed = 0
    by_span = {}
    for u in unsupported:
        by_span.setdefault(u["_span"], []).append(u)
    for (a, b), us in sorted(by_span.items(), key=lambda x: -x[0][0]):
        if not (0 <= a < b <= len(h)):
            continue
        papers = [{"pmid": u["pmid"], "what_the_reviewer_says_is_wrong": u["why"],
                   "abstract": ((real.get(u["pmid"]) or {}).get("abstract") or "")[:3000]} for u in us]
        v = _ask_cached(W, "narrow", f"""One sentence of a clinician-facing evidence brief claims more than the paper it cites supports. It
has been rewritten twice and re-cited, and a reviewer still rejects it, so do not try to rewrite it
into something true. CUT instead.

THE SENTENCE: {json.dumps(us[0]["sentence"])}
THE PAPER(S) IT CITES, AND WHAT THE REVIEWER SAYS IS WRONG: {json.dumps(papers, ensure_ascii=False)}

Return the sentence with every clause, list item, condition and specialty the abstract does not
support removed, and nothing added. Keep the grammar clean — no dangling "and", no empty
parenthesis, no doubled full stop. If what remains would say nothing the abstract supports, return
an empty string and the sentence will be deleted.
Reply with ONLY {{"sentence": "<what survives, or empty>"}}""", timeout_s=600)
        cand = re.sub(r"\s+", " ", str((v or {}).get("sentence") or "")).strip()
        if cand:
            bad = writer_reject(cand)
            if bad or len(cand) > len(us[0]["sentence"]) + 20:
                print(f"  narrowing rejected ({bad or 'it grew instead of shrinking'}): {cand[:80]!r}")
                continue
            keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
            h = _replace_span(h, a, b, cand)
            at = _after_run(h, a + len(H.escape(cand, quote=False)))
            if keep and keep not in h[a:at + len(keep)]:
                h = h[:at] + keep + h[at:]
            narrowed += 1
            print(f"  narrowed a sentence to what its paper supports: {cand[:96]!r}")
        else:
            end = b
            while True:
                mm = SUP_RE.match(h, end)
                if not mm:
                    break
                end = mm.end()
            h = _replace_span(h, a, end, "")
            removed += 1
            print(f"  removed a sentence no abstract supports: {us[0]['sentence'][:96]!r}")
    return h, narrowed, removed


def correct_unsupported_sentences(W: str, h: str, unsupported: list, real: dict, round_no: int = 1) -> tuple:
    """Rewrite each sentence the reviewer judged to misstate its own paper so
    that it says what the abstract says, keeping the citation.

    W33: "a 24.4 pg/mL rise versus controls" where the abstract's between-group
    figure was +40.9 pg/mL; "childhood BMI trajectories predicted infertility"
    where the abstract found no association. The claim is the fault, not the
    marker. The model rewrites the one sentence from the abstract; the code
    replaces exactly that span, and the sentence is judged again next pass.
    Returns (h, corrected)."""
    done = 0
    # ONE REWRITE PER SENTENCE. Two faulted citations on one sentence meant
    # two replacements of the same span, the second against offsets the first
    # had already changed. All of a sentence's faults go into one rewrite.
    by_span = {}
    for u in unsupported:
        by_span.setdefault(u["_span"], []).append(u)
    for (a, b), us in sorted(by_span.items(), key=lambda x: -x[0][0]):
        if not (0 <= a < b <= len(h)):
            continue
        papers = [{"pmid": u["pmid"], "title": (real.get(u["pmid"]) or {}).get("title", ""),
                   "what_is_wrong": u["why"],
                   "abstract": ((real.get(u["pmid"]) or {}).get("abstract") or "")[:3000]} for u in us]
        new, note = "", ""
        if round_no >= 2:
            # the first rewrite was judged still wrong; the same question
            # would be answered from the cache with the same wrong sentence
            note = ("\nTHIS SENTENCE HAS ALREADY BEEN REWRITTEN ONCE AND THE REVIEWER STILL REJECTS IT for the reason "
                    "in what_is_wrong. Make the specific change the reason names — replace the wrong description, "
                    "design or figure with the correct one taken from the abstract — even if that means changing "
                    "words you would otherwise keep.")
        for attempt in range(3):
            v = _ask_cached(W, "fix", f"""One sentence of a clinician-facing evidence brief misstates a paper it cites. Rewrite ONLY that
sentence so that every figure, comparison and direction of effect it attributes to each paper below
comes from that paper's abstract, in the same first-person surgeon's voice, the same length or
shorter, ending with a full stop. Fix EXACTLY what "what_is_wrong" says: when a figure is mislabelled
(a cumulative rate called a plain rate), change the label and keep the figure; never replace a figure
with a different one unless the abstract says the sentence's figure is wrong. THE ABSTRACT IS THE
AUTHORITY: when a paper's title and its abstract disagree about what it describes (a title naming a
"sterilization ring" over an abstract describing an LNG-IUS), describe it as the abstract does and
name the discrepancy in a few words ("titled as …, described in its abstract as …"). Keep everything in the
sentence that is not about these papers exactly as it is. If an abstract does not support the point
at all, state what that paper actually found instead. Plain text; no citation markup; no HTML.{note}
THE SENTENCE: {json.dumps(us[0]["sentence"])}
THE PAPERS IT MISSTATES: {json.dumps(papers, ensure_ascii=False)}
Reply with ONLY {{"sentence": "<the corrected sentence>"}}""", timeout_s=600)
            cand = re.sub(r"\s+", " ", str((v or {}).get("sentence") or "")).strip()
            limit = max(400, int(len(us[0]["sentence"]) * 1.6) + 80)
            if _invents_experience(cand):
                note = "\nA PREVIOUS ATTEMPT CLAIMED THE SURGEON'S OWN CASE. The brief reports the literature; never write 'in my practice', 'my patient' or a case as his own."
                continue
            if ABSTRACT_LABEL_RE.search(cand):
                note = "\nA PREVIOUS ATTEMPT PASTED THE ABSTRACT'S OWN TEXT, labels and all. Write plain clinical prose."
                continue
            if 20 <= len(cand) <= limit:
                new = cand
                break
            # a rejected rewrite was silently re-served from the cache on the
            # second round, so "two corrections" were one; the retry asks
            # differently
            note = (f"\nA PREVIOUS ATTEMPT WAS REJECTED: it was {len(cand)} characters; the sentence must stay under "
                    f"{limit} characters — change only the part about the paper, nothing else.")
        if not new:
            print(f"  could not correct the sentence citing {[u['pmid'] for u in us]} in three attempts")
            continue
        h = _replace_span(h, a, b, new)
        done += 1
        print(f"  corrected the sentence citing {', '.join(u['pmid'] for u in us)}: {new[:110]!r}")
    return h, done



# ---------------------------------------------------------------------------
# curate_live — no published brief is touched without passing curation
# ---------------------------------------------------------------------------
# The curate stage with its AI judgement and independent corroboration has
# existed since W31, where it removed twenty-nine keyword collisions. Then I
# built `renumber` to fix the citations quickly and had it touch markers and
# references only — so every published brief kept its off-topic papers: ICG
# fluorescence in gynecologic surgery carrying breast and prostate imaging,
# a c-section scar topic carrying fetal goiter and eyelid ectropion, chronic
# pelvic pain carrying prostatitis. The code was not missing. I routed around
# it. Curation is now part of the one path that updates a published brief.


# ---------------------------------------------------------------------------
# VERDICT CACHE — a model answer is paid for once
# ---------------------------------------------------------------------------
# Every failure in this work so far was in deterministic code, and each one
# cost a full publish cycle to find because the model passes ran again from
# scratch every time. A verdict is keyed by the exact question asked, so
# re-running after fixing a regex costs nothing for work already judged.


# A card's id is its PMID, or its PMID with a dedupe suffix when the same paper
# is carded under a second heading (W33: mz-cite-42563413 under Adenomyosis and
# mz-cite-42563413-2 under Chronic Pelvic Pain). A pattern that stops at the
# digits saw three cards in a section that held seven, and recounted its chip
# to 3.
CARD_ID_RE = r'id="mz-(?:cite|ref)-(\d{5,9})(?:-\d+)?"'


# ---------------------------------------------------------------------------
# STRUCTURE — one reading of the page's shape, for every generation of brief
# ---------------------------------------------------------------------------
# Nine published briefs span two generators. W25 onward: <section class="topic-
# section …" id="topic-x"> with <div class="subspecialty"> · N papers</div>,
# canonical markers. W20–W24: <section class="mz-topic-group" id="topic-x">
# with <span class="mz-topic-count">N papers</span>; W20 also carries markers
# shaped <sup class="mz-ref" tabindex="0" data-ref="1"><a href="#mz-ref-PMID">
# [1]</a>…, badges as <p class="mz-cite-design">, and its narrative as
# mz-narrative; W23/W24 keep prose in mz-post-bottom-line / mz-post-established
# / mz-post-five-papers sections. A regex written for one shape was a silent
# no-op on the other (curation excised nothing on W21/W23/W24; 24 of W20's
# markers were invisible), so the shape is read here, once, and legacy markup
# is normalised before anything else looks at it.

_INLINE_CLOSE = re.compile(r"</(?:em|strong|i|b|a|span)>")
_CLOSE_PUNCT = re.compile(r"[)\]\"”’']|&(?:rdquo|rsquo|quot|#8221|#8217);")


class _Span:
    """A located element: group(0) is the whole element, group(n>=1) its inner
    HTML; start()/end() as re.Match would give them."""
    __slots__ = ("a", "b", "ia", "ib", "h", "tid", "kind")

    def __init__(self, h, a, ia, ib, b, tid=None, kind=None):
        self.h, self.a, self.ia, self.ib, self.b, self.tid, self.kind = h, a, ia, ib, b, tid, kind

    def group(self, n=0):
        return self.h[self.a:self.b] if n == 0 else self.h[self.ia:self.ib]

    def start(self, n=0):
        return self.a if n == 0 else self.ia

    def end(self, n=0):
        return self.b if n == 0 else self.ib


def _element_end(h: str, tag: str, open_end: int) -> int:
    """Index just past the closing tag that matches the opener ending at
    open_end, counting nested elements of the same tag."""
    depth = 1
    for t in re.finditer(r"<%s\b[^>]*>|</%s>" % (tag, tag), h[open_end:]):
        if t.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                return open_end + t.end()
        else:
            depth += 1
    return len(h)


def _attr(tag: str, name: str) -> str:
    m = re.search(r'\b%s="([^"]*)"' % name, tag)
    return m.group(1) if m else ""


def _section_span(h: str, tid: str):
    """The topic section (or group) with this id, bounded at its OWN closing
    tag. The previous version stopped at the next boundary instead, so the
    last section's span swallowed the disclaimer, and it knew one class name."""
    m = re.search(r'<(section|div)\b[^>]*\bid="%s"[^>]*>' % re.escape(tid), h)
    if not m:
        return None
    return _Span(h, m.start(), m.end(), _element_end(h, m.group(1), m.end()) - len(f"</{m.group(1)}>"),
                 _element_end(h, m.group(1), m.end()), tid, "topic")


def _topic_sections(h: str) -> list:
    """Every topic section in document order, whatever its generation."""
    out = []
    for m in re.finditer(r"<(section|div)\b[^>]*>", h):
        tag = m.group(0)
        cls = _attr(tag, "class").split()
        if not ({"topic-section", "mz-topic-group", "mz-topic-section"} & set(cls)):
            continue
        tid = _attr(tag, "id")
        # a topic carries a topic-* id; "group-*" is W20's wrapper around
        # several topics, and counting an emptied wrapper as a topic made the
        # brief's own "ten topics" look right when it held nine
        if not tid or not tid.startswith("topic-"):
            continue
        b = _element_end(h, m.group(1), m.end())
        out.append(_Span(h, m.start(), m.end(), b - len(f"</{m.group(1)}>"), b, tid, "topic"))
    # W20 wraps its topic sections in <section class="mz-topic-group" id="group-…">
    # groups; the topics are the innermost candidates, so a candidate that
    # contains another is a wrapper and is dropped
    return [t for t in out if not any(o is not t and t.a < o.a < t.b for o in out)]


# A data widget is not prose. Its labels and counts are drawn, not written,
# and a sentence rewrite that reaches into one corrupts it: a trend brief came
# back with `<span class="mz-pyramid-label"></span>Major RCTs` and stale digits
# fused onto a tier's name, because the evidence pyramid's rows were being read
# as sentences and replaced like sentences.
_NOPROSE_WIDGETS = ("mz-evidence-pyramid", "mz-pyramid", "mz-shape-chart", "mz-design-chart",
                    "mz-stat", "mz-counter", "mz-toc")


def _mask_noprose(frag: str) -> str:
    """Markers, verbatim-abstract blocks and data widgets masked with spaces:
    indices stay valid against the fragment, and nothing is inserted inside
    them."""
    out = SUP_RE.sub(lambda x: " " * len(x.group(0)), frag)
    out = re.sub(r"<details[\s\S]*?</details>", lambda x: " " * len(x.group(0)), out)
    for m in list(re.finditer(r'<(div|table|nav|figure|ul|ol)\b[^>]*\bclass="([^"]*)"', out)):
        if out[m.start()] != "<":
            continue                       # already inside a widget just masked
        if not any(t.startswith(_NOPROSE_WIDGETS) for t in m.group(2).split()):
            continue
        gt = out.find(">", m.start())
        if gt < 0:
            continue
        end = _element_end(out, m.group(1), gt + 1)
        out = out[:m.start()] + " " * (end - m.start()) + out[end:]
    return out


def _prose_passages(h: str) -> list:
    """Every passage that carries inline citations, in document order: the
    opening narrative (mz-post-narrative or W20's mz-narrative), every other
    prose section of the post (bottom line, established, five papers, the
    read-across — any mz-post-section that is not the hero, a topic, or the
    references, and holds no cite cards), and each section's synthesis <p>."""
    out = []
    for m in re.finditer(r"<section\b[^>]*>", h):
        cls = set(_attr(m.group(0), "class").split())
        sid = _attr(m.group(0), "id")
        if cls & {"topic-section", "mz-topic-group", "mz-topic-section", "mz-references", "mz-post-hero",
                  "mz-jc-section", "counters", "design-chart"}:
            continue
        if sid == "references":
            continue
        if not (cls & {"mz-post-narrative", "mz-narrative"} or "mz-post-section" in cls):
            continue
        b = _element_end(h, "section", m.end())
        inner = h[m.end():b - len("</section>")]
        if ("mz-cite-card" in inner or "<section" in inner
                or "mz-jc-card" in inner or '<details class="mz-abstract"' in inner):
            # W20's journal-club section holds deep-dive cards whose verbatim
            # abstracts sit in <details>/<summary>; treating it as prose put
            # citation markers and repairs INSIDE a paper's abstract
            continue
        if '<div class="mz-shape-chart"' in inner:
            # a chart section: its captions are prose, its bar rows are not
            # (a totals rewrite once turned a row into "Infertility & ART26")
            for pm in re.finditer(r"<p\b[^>]*>([\s\S]*?)</p>", inner):
                out.append(_Span(h, m.end() + pm.start(), m.end() + pm.start(1), m.end() + pm.end(1), m.end() + pm.end(), sid, "prose"))
            continue
        out.append(_Span(h, m.start(), m.end(), b - len("</section>"), b, sid, "prose"))
    for m in re.finditer(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', h):
        out.append(_Span(h, m.start(), m.start(1), m.end(1), m.end(), None, "synthesis"))
    # The lede and the section intros are prose a reader reads, and no pass
    # could see either: never citation-checked, never corrected against the
    # paper they name, never read back. The gap showed up as a puzzle rather
    # than as a gap — a paper first cited in the lede carried the SUFFIXED
    # popover id on every marker the auditor could see, so the auditor called
    # the numbering inconsistent on a page where it was right. The lede is the
    # first thing anyone reads and it carries citations.
    for cls in ("mz-post-lede", "mz-section-intro"):
        for m in re.finditer(r'<p class="[^"]*%s[^"]*">([\s\S]*?)</p>' % cls, h):
            if any(sp.a <= m.start() < sp.b for sp in out):
                continue
            out.append(_Span(h, m.start(), m.start(1), m.end(1), m.end(), None, "prose"))
    out.sort(key=lambda s: s.a)
    return out


def normalize_legacy_markup(h: str) -> str:
    """Rewrite W20-generation markup into the shape every later step reads:
    markers (tabindex/data-ref, href="#mz-ref-PMID", "[1]" text) into the
    canonical sup with a ref-pop-PMID popover holding only title, meta,
    finding and source link; <p class="mz-cite-design"> into the span; a card
    with no badge gets a placeholder badge so the design check judges it."""
    def canon(m):
        sup = m.group(0)
        pm = _pmid_of(sup)
        if not pm:
            return sup
        if re.match(r'<sup class="mz-ref"><a class="mz-ref-link"', sup) and f'id="ref-pop-{pm}' in sup \
                and "mz-ref-design" not in sup and sup.count("mz-ref-link") == 1:
            return sup
        num = re.sub(r"<[^>]+>", "", (re.search(r"<a\b[^>]*>([\s\S]*?)</a>", sup) or [None, pm])[1]).strip("[] ")
        parts = []
        for cls in ("title", "meta", "finding"):
            x = re.search(r'<span class="mz-ref-pop-%s">([\s\S]*?)</span>' % cls, sup)
            if x:
                parts.append(f'<span class="mz-ref-pop-{cls}">{x.group(1)}</span>')
        parts.append(f'<a class="mz-ref-pop-src" href="https://pubmed.ncbi.nlm.nih.gov/{pm}/" target="_blank" '
                     f'rel="noopener">Read the study on PubMed&nbsp;&rarr;</a>')
        return (f'<sup class="mz-ref"><a class="mz-ref-link" href="#ref-{pm}" aria-describedby="ref-pop-{pm}">{num or pm}</a>'
                f'<span class="mz-ref-pop" id="ref-pop-{pm}" role="tooltip">{"".join(parts)}</span></sup>')
    h = SUP_RE.sub(canon, h)
    # the break opportunities `breakable_marker_runs` adds are removed here so
    # every run walker in the chain sees adjacent markers
    h = re.sub(r"</sup>(?:&#8203;|\u200b|<wbr>)+(?=<sup class=\"mz-ref\")", "</sup>", h)
    # an earlier generator escaped an already-escaped ampersand ("&amp;amp;"
    # in W29's C-Section chip), which renders as the literal "&amp;"
    h = re.sub(r"&amp;(amp;|#)", r"&\1", h)
    h = re.sub(r'<p class="mz-cite-design">([^<]*)</p>', r'<span class="mz-cite-design">\1</span>', h)

    def badge(m):
        a = m.group(0)
        if "mz-cite-design" in a:
            return a
        head = re.match(r"<article\b[^>]*>", a)
        return a[:head.end()] + '<div class="mz-cite-head"><span class="mz-cite-design">Peer-reviewed study</span></div>' + a[head.end():]
    return re.sub(r'<article class="mz-cite-card[\s\S]*?</article>', badge, h)


# ---------------------------------------------------------------------------
# SENTENCES — where one ends is decided from the text around the stop
# ---------------------------------------------------------------------------
_ABBR_BEFORE = re.compile(r"(?:^|[\s(\[\u2014\u2013-])(?:e\.g|i\.e|vs|cf|dr|fig|approx|ca|resp|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|st|mt|prof|eds?)$", re.I)


def _terminal_at(frag: str, i: int) -> bool:
    """Is the . ! ? at frag[i] the end of a sentence? Decided from the text
    around it: a stop followed directly by a letter or digit is inside a
    token (e.g, 4.5, U.S); a stop the sentence carries on from — a quoted
    question followed by lowercase, "et al. (n=54)" — is not an end; a stop
    that closes e.g./i.e./vs./cf./Dr./Fig. is not terminal; "no." is terminal
    unless a number follows; "et al." is terminal only when a new sentence
    visibly starts after it."""
    c = frag[i]
    nxt = frag[i + 1:i + 2]
    if c == "." and nxt and nxt.isalnum():
        return False
    before = re.sub(r"<[^>]+>", "", frag[max(0, i - 12):i])
    after_txt = re.sub(r"<[^>]+>", "", frag[i + 1:i + 60])
    # past the closing quotes/brackets that belong to this sentence
    after_txt = re.sub(r'^(?:[)\]"”’\']|&(?:rdquo|rsquo|quot|#8221|#8217);)+', "", after_txt)
    after_txt = after_txt.lstrip(" \t\r\n\xa0")
    if after_txt and (after_txt[0].islower() or after_txt[0] in ",;:)"):
        return False
    if c in "!?":
        return True
    if _ABBR_BEFORE.search(before):
        return False
    if re.search(r"(?:^|\s)et al$", before):
        # "Smith et al. Bernardi found…" ends a sentence; "Wang et al. Front
        # Endocrinol 2026" and "Smith et al. reported" do not
        return (not after_txt.strip()
                or bool(re.match(r"(?:The|This|That|These|Those|It|In|On|For|A|An|We|But|And|Here|There|If|When|While|"
                                 r"One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|What|Why|How|Their|His|Her|Our|"
                                 r"[A-Z][a-z]+ (?:et al|found|report|reported|show|showed|describe|argue|ran|used|compared))\b", after_txt))
                or bool(re.match(r"[\u201c\"]", after_txt)))
    if re.search(r"(?:^|\s)no$", before, re.I):
        return not re.match(r"\d", after_txt)
    return True


def _advance_end(frag: str, i: int) -> int:
    """From just after a terminal stop, step over closing inline tags and
    closing punctuation that belong to the sentence, so the marker lands
    after them and the sentence's span includes them."""
    n = len(frag)
    while i < n:
        m = _INLINE_CLOSE.match(frag, i) or _CLOSE_PUNCT.match(frag, i)
        if not m:
            break
        i = m.end()
    return i


def _sentences_of(frag: str) -> list:
    """(text, end_index) for each sentence of a prose fragment, tags stripped
    for the text but indices valid against the fragment itself."""
    out, buf, start = [], [], None
    i, n = 0, len(frag)
    while i < n:
        c = frag[i]
        if c == "<":
            close = frag.find(">", i)
            if close < 0:
                break
            if _re.match(r"</(?:p|li|h[1-6]|div|section|blockquote)\b", frag[i:close + 1], _re.I) and "".join(buf).strip():
                out.append(("".join(buf).strip(), i)); buf, start = [], None
            i = close + 1
            continue
        if start is None and not c.isspace():
            start = i
        buf.append(c)
        if c in ".!?" and _terminal_at(frag, i):
            end = _advance_end(frag, i + 1)
            # the closing punctuation stepped over belongs to this sentence's text
            buf.append(re.sub(r"<[^>]+>", "", frag[i + 1:end]))
            out.append(("".join(buf).strip(), end)); buf, start = [], None
            i = end
            continue
        i += 1
    if "".join(buf).strip():
        out.append(("".join(buf).strip(), n))
    return [(H.unescape(_re.sub(r"\s+", " ", t)), e) for t, e in out if t.strip()]


def _end_of_sentence(html_frag: str, from_pos: int) -> int:
    """Index just after the stop (and its closing punctuation/inline tags)
    that ends the sentence at from_pos; a closing block tag ends it too."""
    i, n = from_pos, len(html_frag)
    while i < n:
        c = html_frag[i]
        if c == "<":
            close = html_frag.find(">", i)
            if close < 0:
                return n
            if re.match(r"</(?:p|li|h[1-6]|div|section|blockquote)\b", html_frag[i:close + 1], re.I):
                return i
            i = close + 1
            continue
        if c in ".!?" and _terminal_at(html_frag, i):
            return _advance_end(html_frag, i + 1)
        i += 1
    return n


def _sentence_start(masked: str, from_pos: int) -> int:
    """First index at or after from_pos that begins prose: whitespace
    (including &nbsp;), tags, and closing punctuation left from the previous
    sentence are skipped (a masked fragment's markers are spaces, so the
    previous sentence's marker run is skipped too)."""
    i, n = from_pos, len(masked)
    while i < n:
        c = masked[i]
        if c.isspace() or c == "\xa0":
            i += 1
            continue
        if c == "<":
            close = masked.find(">", i)
            if close < 0:
                return i
            i = close + 1
            continue
        m = _CLOSE_PUNCT.match(masked, i) or re.match(r"&nbsp;", masked[i:i + 6])
        if m:
            i += len(m.group(0))
            continue
        return i
    return n


def _replace_span(h: str, a: int, b: int, new_text: str) -> str:
    """Replace the prose in h[a:b] with escaped text, keeping the inline
    markup balanced.

    A closing tag inside the replaced span whose opener lies BEFORE it is
    re-emitted AFTER the new text, and an opener left unclosed is closed after
    that. Emitting the orphan closer first put the new text outside the element
    it began in: a recommendation list item came out
    `<li><span class="mz-rec-text"></span>Hormonal suppressive therapy…</li>`,
    an empty wrapper with its own text stranded beside it, and the read-back
    audit refused the brief for structurally broken markup. The replacement
    belongs inside whatever element it started in.
    """
    old = h[a:b]
    # a sentence that opened an enumerated list item keeps its label
    lab = re.match(r"\s*(\(\d+\)\s+|\d+\.\s+)", re.sub(r"<[^>]+>", "", old))
    if lab and not re.match(r"\s*(\(\d+\)|\d+\.)\s", new_text):
        new_text = lab.group(1).strip() + " " + new_text
    stack, closers = [], ""
    for t in re.finditer(r"<(/?)(em|strong|i|b|a|span)\b[^>]*>", old):
        if t.group(1):
            if stack and stack[-1][0] == t.group(2):
                stack.pop()
            else:
                closers += t.group(0)      # closes an element opened before `a`
        else:
            stack.append((t.group(2), t.group(0)))
    # an opener inside the replaced span has its closer AFTER b, and that
    # closer survives the replacement — so the opener must be re-emitted, not
    # answered with a second closing tag, which is what left the document with
    # two </em> and one <em>
    reopen = "".join(tag for _, tag in stack)
    return h[:a] + H.escape(new_text, quote=False) + closers + reopen + h[b:]


def _card_in(seg: str, pmid: str):
    """The first cite card for this paper inside a fragment, or None."""
    for m in re.finditer(r'<article class="mz-cite-card[\s\S]*?</article>', seg):
        a = m.group(0)
        if re.search(r'id="mz-cite-%s(?:-\d+)?"' % re.escape(pmid), a) or f"openDeepDive('dd-{pmid}')" in a \
                or f"pubmed.ncbi.nlm.nih.gov/{pmid}/" in a:
            return m
    return None


def _has_card(h: str, pmid: str) -> bool:
    return _card_in(h, pmid) is not None


def excise_paper_from_section(h: str, tid: str, pmid: str) -> str:
    """Remove one paper's card(s) from ONE section and nothing else.

    The paper's card under any other heading, its deep-dive dialog and its
    reference entry stay; `curate_live` removes those only when no card is
    left anywhere. Excising by PMID took W33's LNG-IUS-for-adenomyosis card
    out of Adenomyosis because its copy under Chronic Pelvic Pain was judged."""
    while True:
        sec = _section_span(h, tid)
        if not sec:
            return h
        m = _card_in(sec.group(0), pmid)
        if not m:
            break
        h = h[:sec.start() + m.start()] + h[sec.start() + m.end():]
    sec = _section_span(h, tid)
    seg = re.sub(r'<button[^>]*openDeepDive\([\'"]dd-%s[\'"]\)[^>]*>[\s\S]*?</button>' % re.escape(pmid), "", sec.group(0))
    return h[:sec.start()] + seg + h[sec.end():]


def move_card(h: str, pmid: str, from_tid: str, to_tid: str) -> str:
    """Move one paper's card from one section to the end of another's cards.

    A first-pass (b) — "not about this heading, belongs under X" — names where
    the paper goes. Dropping it instead loses a paper the reader should have
    seen under X; moving it keeps the brief whole."""
    src = _section_span(h, from_tid)
    if not src:
        die(f"move_card: no section {from_tid}")
    m = _card_in(src.group(0), pmid)
    if not m:
        die(f"move_card: no card for {pmid} under {from_tid}")
    card = m.group(0)
    h = h[:src.start() + m.start()] + h[src.start() + m.end():]
    dst = _section_span(h, to_tid)
    if not dst:
        die(f"move_card: no section {to_tid}")
    seg = dst.group(0)
    last = None
    for a in re.finditer(r"</article>", seg):
        last = a
    at = dst.start() + (last.end() if last else seg.rfind("</section>"))
    return h[:at] + card + h[at:]


def kb_area_context(W: str, title: str) -> str:
    """What a heading's clinical area covers, from the practice's own
    reference library (823 ACOG / AAGL / FMIGS / UpToDate documents in D1,
    served by /api/v1/internal/kb/ground). The curator reads this before
    judging a paper against the heading, so "Chronic Pelvic Pain" is judged
    as the library defines it — with its causes — and not as two words.
    Owner, 2026-09-19: "you have the knowledge from my KB to know this."
    Cached per heading; three attempts, then refuse: a curation that could
    not consult the library is not the curation the owner specified."""
    import hashlib as _h
    q = f"{title}: definition, causes, related conditions and differential diagnosis in gynecology"
    key = _h.sha256(q.encode("utf-8")).hexdigest()[:24]
    hit = _cache_get(W, "kb", key)
    if hit is not None:
        return hit
    path = W + "_kbq.json"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    json.dump({"query": q, "kind": "brief_curation", "topK": 6, "maxChars": 3500}, open(path, "w"))
    last = None
    for attempt in range(3):
        try:
            r = curl_json(f"{BASE}/api/v1/internal/kb/ground", "POST", auth=True, data_file=path)
            if isinstance(r, dict) and r.get("ok"):
                ctx = re.sub(r"\n{3,}", "\n\n", str(r.get("context") or "")).strip()
                _cache_put(W, "kb", key, ctx)
                return ctx
            last = json.dumps(r)[:200]
        except Exception as e:  # noqa: BLE001 — the reason is reported below
            last = str(e)[:200]
        time.sleep(2 * (attempt + 1))
    die(f"the practice's reference library could not be consulted for {title!r}: {last}")


def _cache_get(W: str, kind: str, key: str):
    path = W + f"cache.{kind}.json"
    if not os.path.exists(path):
        return None
    try:
        return json.load(open(path)).get(key)
    except Exception:
        return None


def _cache_put(W: str, kind: str, key: str, value) -> None:
    path = W + f"cache.{kind}.json"
    d = {}
    if os.path.exists(path):
        try:
            d = json.load(open(path))
        except Exception:
            d = {}
    d[key] = value
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    json.dump(d, open(path, "w"), ensure_ascii=False)


def _ask_cached(W: str, kind: str, prompt: str, timeout_s: int = 900):
    import hashlib as _h
    key = _h.sha256(prompt.encode("utf-8")).hexdigest()[:24]
    hit = _cache_get(W, kind, key)
    if hit is not None:
        return hit
    v = _claude(prompt, timeout_s=timeout_s)
    if v is not None:
        _cache_put(W, kind, key, v)
    return v


def curate_live(h: str, topics: dict, papers: dict, W: str = "") -> tuple:
    """Judge every (heading, paper) placement twice, and act on ONE placement.

    First pass: does this paper belong under THIS heading — by TOPIC_FIT_RULE
    and the area's description from the practice's reference library? Second,
    independent pass: from the abstracts and the brief's headings alone, is
    there ANY heading it belongs under? A placement the first pass rejects is
    removed from THAT SECTION ONLY; the paper's card under any other heading
    is untouched, and its dialog and reference entry go only when no card is
    left anywhere. A paper the second pass finds no home for ((a)/(c)) leaves
    every section. A first-pass (b) naming a heading the paper is not yet
    under MOVES the card there instead of losing the paper.

    Why per placement: W33's LNG-IUS-for-adenomyosis paper sat under both
    Adenomyosis and Chronic Pelvic Pain. One pass judged the pelvic-pain copy
    "belongs under Adenomyosis", and excising by PMID removed the Adenomyosis
    card too — the copy nobody disputed. Owner: "adenomyosis can cause pelvic
    pain — you should know this."

    Returns (h, removed, moved, emptied): removed = [(tid, pmid, why)],
    moved = [(from_tid, to_tid, pmid, why)], emptied = [tid].
    """
    removed, moved = [], []
    belongs_why = {}
    titles = {tid: t["title"] for tid, t in topics.items()}
    by_title = {t["title"].strip().lower(): tid for tid, t in topics.items()}
    # A PAPER IS NEVER DROPPED FOR MISSING DATA. When a fetch failed, the model
    # is asked to judge a blank and correctly answers that it cannot — and the
    # paper vanished from the brief for a reason that has nothing to do with
    # its subject. Those are refetched, and any still missing are kept and
    # reported rather than judged.
    blank = [q for tid, t in topics.items() for q in t["pmids"]
             if len(((papers.get(q) or {}).get("abstract") or "").strip()) < 60]
    if blank:
        print(f"  refetching {len(blank)} paper(s) whose abstract was missing before judging them")
        again = fetch_pubmed(sorted(set(blank)))
        for q in blank:
            r = again.get(q) or {}
            if r.get("abstract"):
                papers[q] = {"title": r.get("title", ""), "abstract": r.get("abstract", "")}
        still = [q for q in set(blank)
                 if len(((papers.get(q) or {}).get("abstract") or "").strip()) < 60]
        if still:
            print(f"  KEEPING {len(still)} paper(s) with no abstract available — not judged, not dropped: {still[:8]}")
        unjudgeable = set(still)
    else:
        unjudgeable = set()

    def ctx(pmids):
        return [{"pmid": q, "title": (papers.get(q) or {}).get("title", ""),
                 "abstract": ((papers.get(q) or {}).get("abstract") or "")[:2200]} for q in pmids]

    # the practice's own definition of each area, read before any judgement
    area = {tid: kb_area_context(W, t["title"]) for tid, t in topics.items()}

    for tid, t in topics.items():
        pmids = [q for q in t["pmids"] if q in papers and q not in unjudgeable]
        if not pmids:
            continue
        for i in range(0, len(pmids), 10):
            batch = pmids[i:i + 10]
            v = _ask_cached(W, "curate", f"""You are auditing one section of a weekly literature brief for a complex benign gynecology /
minimally invasive gynecologic surgery practice. Its readers are practising gynecologic surgeons.
SECTION HEADING: {json.dumps(t["title"])}
WHAT THIS AREA COVERS, from the practice's own reference library (ACOG / AAGL / FMIGS / UpToDate):
{area.get(tid) or "(no library entry retrieved — judge from the rule alone)"}
OTHER HEADINGS IN THIS BRIEF: {json.dumps([x for k, x in titles.items() if k != tid], ensure_ascii=False)}
{TOPIC_FIT_RULE}
For EACH paper: does it belong under THAT heading, by the rule above?
PAPERS: {json.dumps(ctx(batch), ensure_ascii=False)[:90000]}
Reply with ONLY {{"verdicts": [{{"pmid": "...", "verdict": "belongs"|"does_not_belong"|"cannot_tell",
  "why": "<one clause; for does_not_belong it names (a), (b) or (c) and what the paper is actually about>",
  "elsewhere": "<for (b) only: one heading copied exactly from OTHER HEADINGS IN THIS BRIEF; otherwise null>"}}, ...]}}
with one object for EVERY paper given. "cannot_tell" is for a paper whose title and abstract do not let
you judge; it is kept.""", timeout_s=900)
            if not v or not isinstance(v.get("verdicts"), list):
                die(f"curation of {tid} returned no verdict")
            got = {str(x.get("pmid")) for x in v["verdicts"]}
            missing = [q for q in batch if q not in got]
            if missing:
                die(f"curation of {tid} skipped {missing[:5]}")
            for x in v["verdicts"]:
                pm = str(x.get("pmid"))
                why = str(x.get("why", ""))[:200]
                verdict = str(x.get("verdict") or ("belongs" if x.get("belongs") else "does_not_belong")).strip().lower()
                if verdict == "belongs":
                    belongs_why[(tid, pm)] = why
                    continue
                if verdict == "cannot_tell":
                    print(f"  KEEPING {pm}: the judgement was 'cannot tell', not 'does not belong'")
                    continue
                other = str(x.get("elsewhere") or "").strip()
                to_tid = _match_heading(other, by_title) if other else None
                if to_tid and to_tid != tid and pm not in topics[to_tid]["pmids"]:
                    moved.append((tid, to_tid, pm, why))
                else:
                    removed.append((tid, pm, why))

    # independent corroboration, given only the abstracts and the headings:
    # is there ANY heading in this brief the paper belongs under?
    gone = {(tid, pm) for tid, pm, _ in removed} | {(f, pm) for f, _, pm, _ in moved}
    distinct = list(dict.fromkeys([q for tid, t in topics.items() for q in t["pmids"]
                                   if q in papers and q not in unjudgeable and (tid, q) not in gone]
                                  + [pm for _, _, pm, _ in moved]))
    def _flat(x):
        return re.sub(r"\s+", " ", x or "")[:400]
    area_brief = "\n".join(f"- {titles[tid]}: {_flat(area.get(tid))}" for tid in topics)
    for i in range(0, len(distinct), 10):
        batch = distinct[i:i + 10]
        v = _ask_cached(W, "curate", f"""Classify each paper under ONE heading from this brief, from its title and abstract alone, for an
audience of gynecologic surgeons reading a weekly literature brief.
{TOPIC_FIT_RULE}
Put each paper under the heading whose area it belongs to, even when the fit is broad. Answer "NONE"
ONLY for a paper that does not belong in a gynecology brief at all under (a) or (c) above — never
because no heading is a perfect match.
HEADINGS, each with what its area covers per the practice's reference library:
{area_brief}
PAPERS: {json.dumps(ctx(batch), ensure_ascii=False)[:90000]}
Reply with ONLY {{"assignments": {{"<pmid>": "<exact heading or NONE>", ...}}}} for EVERY paper given.""",
                        timeout_s=900)
        if not v or not isinstance(v.get("assignments"), dict):
            die("corroboration returned no verdict")
        missing = [q for q in batch if q not in v["assignments"]]
        if missing:
            die(f"corroboration skipped {missing[:5]}")
        for q in batch:
            if str(v["assignments"].get(q, "")).strip() != "NONE":
                continue
            why = "an independent classification found no heading in this brief it belongs under"
            # A reasoned first-pass "belongs" against a bare NONE is a
            # disagreement, not a verdict: dry24 lost an anastomosis technique
            # written for deep-endometriosis bowel resection and a GLP-1 vs
            # metformin PCOS comparison this way. A third, targeted question
            # sees both answers and decides.
            held = [(tid, belongs_why[(tid, q)]) for tid in topics if (tid, q) in belongs_why and (tid, q) not in gone]
            if held:
                tie = _ask_cached(W, "curate", f"""Two independent judgements disagree about one paper in a weekly literature brief for gynecologic surgeons.
{TOPIC_FIT_RULE}
PAPER: {json.dumps(ctx([q])[0], ensure_ascii=False)}
IT SITS UNDER: {json.dumps([{"heading": titles[t], "what_the_area_covers": _flat(area.get(t)), "first_judgement": w} for t, w in held], ensure_ascii=False)}
The first judgement, made against the heading, said it BELONGS for the reason given. A second judgement,
made against the list of all headings, found no heading in this brief it belongs under. Decide, by the
rule above: does the paper belong under the heading(s) it sits under?
Reply with ONLY {{"verdict": "keep"|"drop", "why": "<one clause>"}}""", timeout_s=600)
                if str((tie or {}).get("verdict", "")).strip().lower() == "keep":
                    print(f"  KEEPING {q} after a third judgement: {str((tie or {}).get('why', ''))[:100]}")
                    continue
                why = f"a third judgement agreed it does not belong: {str((tie or {}).get('why', ''))[:120]}"
            # a move for this paper is cancelled, and the placement it came
            # from is removed like any other (it was rejected there too)
            for f, _, pm, _ in moved:
                if pm == q and (f, pm) in gone:
                    gone.discard((f, pm))
            moved = [m for m in moved if m[2] != q]
            for tid, t in topics.items():
                if q in t["pmids"] and (tid, q) not in gone:
                    removed.append((tid, q, why))
                    gone.add((tid, q))

    landed = set()
    for from_tid, to_tid, pm, why in list(moved):
        if (to_tid, pm) in landed:
            # the same paper rejected under two headings, both naming one
            # target: the second copy would be a duplicate there
            moved.remove((from_tid, to_tid, pm, why))
            removed.append((from_tid, pm, why))
            continue
        h = move_card(h, pm, from_tid, to_tid)
        landed.add((to_tid, pm))
    for tid, pm, _ in removed:
        h = excise_paper_from_section(h, tid, pm)
    # a paper with no card left anywhere takes its dialog, reference entry and
    # any marker with it; one that survives elsewhere keeps all three
    for pm in dict.fromkeys(pm for _, pm, _ in removed):
        if not _has_card(h, pm):
            h = excise_paper(h, pm)

    emptied = []
    for tid, t in topics.items():
        if t["pmids"] and not _survivors(topics, tid, removed, moved):
            emptied.append(tid)
            sec = _section_span(h, tid)
            if sec:
                h = h[:sec.start()] + h[sec.end():]
            # the reader's jump list must not offer a heading that is gone
            h = re.sub(r'<a[^>]*class="[^"]*mz-toc-chip[^"]*"[^>]*href="#%s"[\s\S]*?</a>' % re.escape(tid), "", h)
            h = re.sub(r'<a[^>]*href="#%s"[^>]*class="[^"]*mz-toc-chip[^"]*"[\s\S]*?</a>' % re.escape(tid), "", h)
    h = remove_empty_groups(h)
    h = recount_headings(h)
    return h, removed, moved, emptied


def curate_flat(h: str, title: str, papers: dict, W: str = "") -> tuple:
    """Curate a brief that has no topic headings: its title is its one heading.

    Curation was gated on topic sections existing, and a trend brief has
    none, so no paper in any of the eight published trend briefs was ever
    judged for whether it belongs — the pass the owner's standard calls
    "off-topic papers removed" never ran on them, and the six that passed the
    structural audit passed because that audit cannot measure topic fit.

    Same two-judgement design as `curate_live`, against one subject: the
    first pass judges every carded paper by TOPIC_FIT_RULE and the practice
    library's description of the area; a rejection is then judged again,
    independently, from the abstract alone, and only a paper both passes
    reject is removed — wholesale, since there is no other heading for it to
    survive under. Returns (h, removed) with removed = [(pmid, why)].
    """
    carded = list(dict.fromkeys(re.findall(CARD_ID_RE, h) + re.findall(r"openDeepDive\('dd-(\d+)'", h)))
    pmids = [q for q in carded if len(((papers.get(q) or {}).get("abstract") or "").strip()) >= 60]
    skipped = [q for q in carded if q not in pmids]
    if skipped:
        print(f"  KEEPING {len(skipped)} paper(s) with no abstract available — not judged, not dropped: {skipped[:6]}")
    if not pmids:
        return h, []
    area = kb_area_context(W, title)
    ctx = lambda qs: [{"pmid": q, "title": (papers.get(q) or {}).get("title", ""),  # noqa: E731
                       "abstract": ((papers.get(q) or {}).get("abstract") or "")[:2200]} for q in qs]
    first = {}
    for i0 in range(0, len(pmids), 10):
        batch = pmids[i0:i0 + 10]
        v = _ask_cached(W, "curate", f"""You are auditing a single-subject trend brief for a complex benign gynecology / minimally invasive
gynecologic surgery practice. Its readers are practising gynecologic surgeons.
THE BRIEF'S SUBJECT (its title, and its only heading): {json.dumps(title)}
WHAT THIS AREA COVERS, from the practice's own reference library (ACOG / AAGL / FMIGS / UpToDate):
{area or "(no library entry retrieved — judge from the rule alone)"}
{TOPIC_FIT_RULE}
A trend brief is about ONE clinical claim. A paper belongs when it bears on that claim in any way —
evidence for it, evidence against it, the mechanism it rests on, or the comparator the brief argues
against. It does not belong when it is about a different organ, specialty or population with no
bearing on the claim: a paediatric surgery paper in an endometriosis brief, a rat lipid-metabolism
study whose only link is a shared drug name.
For EACH paper: does it belong in a brief on that subject?
PAPERS: {json.dumps(ctx(batch), ensure_ascii=False)[:90000]}
Reply with ONLY {{"verdicts": [{{"pmid": "...", "verdict": "belongs"|"does_not_belong"|"cannot_tell",
  "why": "<one clause naming what the paper is actually about and the abstract phrase that decides it>"}}, ...]}}
with one object for EVERY paper given. "cannot_tell" is for a paper whose title and abstract do not
let you judge; it is kept.""", timeout_s=900)
        for r in ((v or {}).get("verdicts") or []) if isinstance(v, dict) else []:
            q = str(r.get("pmid", "")).strip()
            if q in batch:
                first[q] = (str(r.get("verdict", "")).lower(), str(r.get("why", ""))[:300])
    missing = [q for q in pmids if q not in first]
    if missing:
        print(f"  KEEPING {len(missing)} paper(s) the curator did not rule on: {missing[:6]}")
    removed = []
    for q in pmids:
        verdict, why = first.get(q, ("cannot_tell", ""))
        if verdict != "does_not_belong":
            continue
        v2 = _ask_cached(W, "curate", f"""One reviewer says this paper does not belong in a single-subject trend brief titled
{json.dumps(title)}, because: {json.dumps(why)}
Judge that independently, from the paper alone. Does it bear on the brief's claim in ANY way — as
evidence for it, evidence against it, the mechanism it rests on, or the comparator the brief argues
against? Clinical areas overlap; a paper that refutes the title claim belongs.
PAPER: {json.dumps(ctx([q])[0], ensure_ascii=False)}
Reply with ONLY {{"belongs": true|false, "why": "<one clause>"}}""", timeout_s=600)
        if isinstance(v2, dict) and v2.get("belongs") is False:
            removed.append((q, why))
        else:
            print(f"  KEEPING {q}: rejected once, but a second judgement finds it bears on the subject")
    for q, _ in removed:
        h = excise_paper(h, q)
    return h, removed


def _match_heading(name: str, by_title: dict):
    """The topic id a model-quoted heading refers to: exact, then case /
    whitespace / entity-insensitive, then with a trailing parenthetical
    dropped, then a unique heading that starts with or contains it. The
    same model quoted "C-Section Scar" for "C-Section Scar (Pregnancy &
    Pathology)"; an exact-only match turned that (b) into a drop."""
    def norm(x):
        x = H.unescape(x or "").lower()
        x = re.sub(r"\s*\([^)]*\)\s*$", "", x)
        return re.sub(r"\s+", " ", x).strip()
    want = norm(name)
    if not want:
        return None
    normed = {norm(k): v for k, v in by_title.items()}
    if want in normed:
        return normed[want]
    hits = [v for k, v in normed.items() if k.startswith(want) or want in k or k in want]
    return hits[0] if len(hits) == 1 else None


def remove_empty_groups(h: str) -> str:
    """W20 wraps topic sections in <section class="mz-topic-group" id="group-…">
    with its own heading; a wrapper whose child sections were all removed
    kept its heading over nothing."""
    for m in list(re.finditer(r'<section class="[^"]*mz-topic-group[^"]*"[^>]*\bid="(group-[^"]+)"[^>]*>', h))[::-1]:
        b = _element_end(h, "section", m.end())
        if "mz-cite-card" not in h[m.end():b]:
            h = h[:m.start()] + h[b:]
    return h


def recount_headings(h: str) -> str:
    """Every topic section's TOC chip and header count say what the section
    now holds, in every header shape the site has used."""
    for t in _topic_sections(h):
        left = len(set(re.findall(CARD_ID_RE, t.group(0)) + re.findall(r"openDeepDive\('dd-(\d+)'", t.group(0))))
        h = re.sub(r'(<a[^>]*href="#%s"[^>]*>[\s\S]*?<span class="mz-toc-chip-count">)\d+(</span>)' % re.escape(t.tid),
                   lambda m: m.group(1) + str(left) + m.group(2), h)
        sec = _section_span(h, t.tid)
        if not sec:
            continue
        seg = re.sub(r'(<(?:div class="subspecialty"|span class="mz-topic-count")>[^<]*?)(\d+ papers?|\(\d+\))(</(?:div|span)>)',
                     lambda m: m.group(1) + (f"({left})" if m.group(2).startswith("(") else f"{left} paper{'s' if left != 1 else ''}") + m.group(3),
                     sec.group(0), count=1)
        h = h[:sec.start()] + seg + h[sec.end():]
    return h


def _survivors(topics: dict, tid: str, removed: list, moved: list) -> list:
    """The papers a section holds after curation: its own minus what left it, plus what moved in."""
    out = [q for q in topics[tid]["pmids"]
           if (tid, q) not in {(t, pm) for t, pm, _ in removed}
           and (tid, q) not in {(f, pm) for f, _, pm, _ in moved}]
    return out + [pm for _, to, pm, _ in moved if to == tid and pm not in out]



EXPERIENCE_RE = re.compile(r"\b(?:in my (?:practice|clinic|hands|experience)|my patient|a patient of mine|"
                           r"I (?:saw|treated|operated|managed|had) (?:a|an|this|one|my))\b", re.I)


def _invents_experience(t: str) -> bool:
    """A rewrite that turns a paper's case report into the surgeon's own case.
    W21: "In my practice, a 28-year-old with normal BMI achieved pregnancy…"
    was written from a published case report. The briefs report the
    literature; they never claim the practice's own patients."""
    return bool(EXPERIENCE_RE.search(t))


# "No never/always" is a rule about ABSOLUTIST CLINICAL CLAIMS — "always
# excise", "never offer" — and it was written as a search for the two words.
# It therefore refused two finished briefs over prose that says the opposite
# of an absolute: "the least invasive route is NOT ALWAYS the safest one" is a
# hedge, "plantar heel pain that never reaches gyn care" describes a referral
# pathway, and "the authors were contacted and never substantively responded"
# reports what happened to a paper. A gate that cries wolf gets worked around,
# which is worse than no gate. The words are flagged where they make a
# universal claim: attached to a clinical directive, or to a judgement about
# whether something is safe, effective or indicated.
_HEDGED = r"(?<!not )(?<!n't )(?<!almost )(?<!nearly )(?<!hardly )(?<!not\u2019t )"
_ABSOLUTE_RE = re.compile(
    _HEDGED + r"\b(?:always|never)\s+(?:be\s+)?"
    r"(?:offer|use|excise|remove|resect|prescribe|give|start|stop|treat|perform|do|choose|"
    r"recommend|order|image|operate|biopsy|refer|screen|repeat|attempt|place|avoid|require)\w*\b"
    + "|" + _HEDGED + r"\b(?:always|never)\s+(?:safe|effective|indicated|appropriate|necessary|"
    r"required|warranted|works|helps|harmful|wrong|right)\b", re.I)


def absolute_claim(text: str):
    """The match when prose makes an absolutist clinical claim, else None."""
    return _ABSOLUTE_RE.search(text or "")


def writer_reject(new: str) -> str:
    """Why this sentence may not go on the page, or "" when it may.

    Every pass that writes a sentence had its own subset of the checks, so a
    rewrite could satisfy the pass that made it and fail the reader gate that
    runs at the end. W24 spent a full run — curation, citation, review, two
    correction rounds, numbering — and then refused because a correction had
    written the word "never", which S10 forbids. The gate was right; finding
    out at the gate was the waste. One list, applied wherever a sentence is
    written.
    """
    if not new:
        return "empty"
    if _looks_broken(new):
        return "damaged prose"
    if _invents_experience(new):
        return "invented experience"
    if ABSTRACT_LABEL_RE.search(new):
        return "raw abstract text"
    m = absolute_claim(new)
    if m:
        return f"an absolutist clinical claim ({m.group(0)!r})"
    m = ADVICE_RE.search(new)
    if m:
        return f"patient-directed advice ({m.group(0)[:40]!r})"
    if re.search(r"(?<!CBG/)\bMIGS\b", new):
        return "bare 'MIGS' — write CBG/MIGS"
    return ""


def _looks_broken(t: str) -> bool:
    """A rewritten sentence that would read as damage: a stop after a function
    word ("developed in the. Department of…"), no terminal stop, a lowercase
    opening, a doubled space or an empty clause."""
    if not t or len(t) < 15:
        return True
    if not re.search(r"[.!?][\"')\]\u201d\u2019]?$", t.strip()):
        return True
    if re.search(r"\b(?:in|of|at|by|the|a|an|and|or|with|for|from|to|than|that|as)\.(?:\s|$)", t, re.I):
        return True
    if re.search(r"\s{2,}|\(\s*\)|,\s*[,.]|\b(?:and|but|with)\s*[.,]", t):
        return True
    return not t[:1].isupper() and not t[:1].isdigit() and t[:1] not in "\u201c\"("


def _inside_tag(h: str, i: int) -> bool:
    """True when index i sits between a tag's "<" and its ">"."""
    lt = h.rfind("<", 0, i)
    return lt >= 0 and h.find(">", lt, i) < 0


def _usable_span(h: str, a: int, b: int) -> bool:
    """A span worth replacing: non-empty, in range, and starting and ending in
    prose rather than in the middle of a tag. A repair once located a
    zero-length span at the ">" of an opening tag and spliced a whole sentence
    in there, leaving `<span class="mz-rec-text"Laparoscopic…>` for a reader.
    """
    return 0 <= a < b <= len(h) and not _inside_tag(h, a) and not _inside_tag(h, b)


def _quoted_sites(h: str, ev: str, limit: int = 4) -> list:
    """Every sentence the audit's evidence quotes, as (start, end, text).

    The evidence for a contradiction quotes BOTH sides — prose passage 1
    "…OR 1.08…" AND the bottom line "…OR 1.44…" — and rewriting only the
    first leaves the page still contradicting itself. The audit then names the
    same defect again, the identical prompt is served from cache, and three
    repair rounds change nothing. Find them all.
    """
    # The evidence names both sides, and nothing in it is punctuation this
    # pattern stops at — "…(AOR 0.61) AND Wang et al., …(AOR 0.42)" matched as
    # ONE run whose first sixty characters could only ever find the first
    # sentence. Split it the ways an auditor separates two quotes, and try the
    # pieces as well as the whole.
    parts = [ev]
    parts += re.split(r"\s+(?:AND|and)\s+", ev)
    parts += re.findall(r"['\"\u2018\u2019\u201c\u201d]([^'\"\u2018\u2019\u201c\u201d]{30,})", ev)
    runs = []
    for part in parts:
        runs += [x.strip() for x in re.findall(r"[A-Za-z][A-Za-z0-9 ,'\u2019()%=.–-]{30,}", part)]
    runs = sorted(dict.fromkeys(runs), key=len, reverse=True)
    sites: list = []
    for run in runs[:14]:
        needle = re.sub(r"\s+", " ", run)[:60]
        for ps in _prose_passages(h):
            masked = _mask_noprose(ps.group(1))
            flat = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", masked)))
            if needle[:40] not in flat:
                continue
            sents = _sentences_of(masked)
            for i, (t, e) in enumerate(sents):
                if needle[:40] not in re.sub(r"\s+", " ", t):
                    continue
                a = ps.start(1) + _sentence_start(masked, sents[i - 1][1] if i >= 1 else 0)
                b = ps.start(1) + e
                if not _usable_span(h, a, b):
                    continue
                if any(a < y and x < b for x, y, _ in sites):
                    continue          # already have this sentence
                sites.append((a, b, t))
                break
        if len(sites) >= limit:
            break
    return sites


def repair_from_defects(W: str, h: str, defects: list, counts: dict | None = None) -> tuple:
    """Fix what the read-back audit named, in every sentence it quoted.

    Owner, from the beginning: "this code has a way to automatically correct
    this when there are errors." The audit found stale counts, a pasted
    abstract, a self-contradicting sentence — and every one of them stopped
    the brief instead of being repaired, so a person had to intervene.

    A repair is only as good as what it knows, and as wide as the defect. A
    contradiction lives in two places at once: W21 reported one Cochrane
    finding as OR 1.08 in the infertility section and differently in the
    bottom line, and a repair that rewrote one of them left the page saying
    both. Every quoted sentence is now rewritten together, in one decision, so
    they come out agreeing — and the papers they cite travel with them, since
    only the PubMed abstract settles which figure is the real one. A disputed
    count of papers or topics is settled by what the page measurably holds.
    Returns (h, repaired_count)."""
    done = 0
    for d in defects:
        ev = H.unescape(re.sub(r"<[^>]+>", " ", str(d.get("evidence") or "")))
        ev = H.unescape(re.sub(r"<[^>]+>", " ", ev))
        sites = _quoted_sites(h, ev)
        if not sites:
            continue
        cited = [q for q in dict.fromkeys(
            _pmid_of(m.group(0)) for a, b, _ in sites for m in SUP_RE.finditer(h[a:b])) if q]
        papers = real_from_work(W, cited)
        src = "\n".join(
            f"PAPER {q} — {papers[q].get('title', '')}\nABSTRACT: {(papers[q].get('abstract') or '')[:2600]}"
            for q in cited if q in papers)
        ctx = f"\n\nTHE PAPERS THESE SENTENCES CITE:\n{src}" if src else ""
        if counts:
            ctx += ("\n\nWHAT THE PAGE ACTUALLY HOLDS (measured, not claimed): "
                    + json.dumps({k: counts[k] for k in (
                        "citations", "distinct_papers_cited", "reference_entries", "cite_cards",
                        "topic_sections", "toc_chips") if k in counts}))
        numbered = json.dumps([{"index": i, "sentence": t} for i, (_, _, t) in enumerate(sites)],
                              ensure_ascii=False)
        v = _ask_cached(W, "audit_fix", f"""An editor reading a clinician-facing evidence brief found this defect:
DEFECT: {json.dumps(str(d.get('what'))[:600])}

THE SENTENCES IT QUOTES, every place on the page the defect shows:
{numbered}{ctx}

Rewrite EVERY sentence so the defect is gone from all of them and everything they still say is true,
in the same first-person surgeon's voice, each the same length or shorter. Return one entry per
index, including any sentence you would leave word-for-word unchanged. Change nothing the defect
does not concern; drop a clause that is no longer true rather than inventing a replacement fact.
Plain text, no citation markup, each ending with a full stop.
Never resolve a defect by saying the brief does not hold, did not cover or excluded a paper: every
marker in these sentences points at a paper this brief carries, and a reader can click it.
If the defect is that one figure contradicts another, the sentences must END UP AGREEING: the
abstracts above say which figure the paper actually reports — keep that one everywhere and correct
the others. When an abstract reports the SAME outcome for more than one population — the whole
cohort and a subgroup, an unadjusted and an adjusted estimate — the right figure is the one for the
population each sentence names, and a sentence naming the subgroup must not carry the whole
cohort's number. W21 described the direct-marker finding of an adenomyosis cohort and gave the
overall estimate, which the paper's own title exists to distinguish. Where a count of papers, topics or references is in dispute, the measured figures above
are the truth. Never carry a figure no source shown here supports; drop the clause instead.
Reply with ONLY {{"sentences": [{{"index": <n>, "sentence": "<the corrected sentence>"}}, ...]}}""",
                        timeout_s=900)
        out = {}
        for e in ((v or {}).get("sentences") or []):
            try:
                out[int(e.get("index"))] = re.sub(r"\s+", " ", str(e.get("sentence") or "")).strip()
            except (TypeError, ValueError):
                continue
        # apply from the END so an earlier rewrite cannot move a later offset
        for i in sorted(out, reverse=True):
            if i >= len(sites):
                continue
            a, b, sentence = sites[i]
            new_s = out[i]
            if not new_s or new_s == sentence:
                continue
            _bad = writer_reject(new_s) or ("too long" if len(new_s) > max(400, int(len(sentence) * 1.5)) else "")
            if _bad:
                print(f"  audit repair rejected ({_bad}): {new_s[:90]!r}")
                continue
            keep = "".join(m.group(0) for m in SUP_RE.finditer(h[a:b]))
            # A repair may not resolve a defect by denying the brief holds a
            # paper it is citing. W21's bottom line came back "…but it never
            # made this brief's final list" with the marker still on it; the
            # next read named that as a defect, the next repair reworded it,
            # and the round budget ran out on a contradiction the repair kept
            # re-creating.
            if _ABSENCE_RE.search(new_s) and any(
                    q and _has_card(h, q) for q in (_pmid_of(x.group(0)) for x in SUP_RE.finditer(keep))):
                print(f"  audit repair rejected (it denies holding a paper it cites): {new_s[:90]!r}")
                continue
            if not _usable_span(h, a, b):
                print(f"  audit repair skipped (the quoted span is not prose): {new_s[:80]!r}")
                continue
            h = _replace_span(h, a, b, new_s)
            at = _after_run(h, a + len(H.escape(new_s, quote=False)))
            if keep and keep not in h[a:at + len(keep)]:
                h = h[:at] + keep + h[at:]
            done += 1
            print(f"  audit repair: {new_s[:110]!r}")
    return h, done


# A number a reader can check must not contradict another number on the same
# page. Severity was left entirely to the auditor's judgement, and it filed
# "the same Cochrane finding is given two different odds ratios" and "the
# closing total disagrees with the bars printed beside it" as cosmetic notes —
# which is to say it would have published a brief that contradicts itself. The
# prompt now says these are blocking; this says it in code, because a rule that
# only lives in a prompt is a rule that holds most of the time.
_CONTRADICTION_RE = re.compile(
    r"(?:does\s*n[o']?t\s+match|do\s*n[o']?t\s+match|disagree|contradict|inconsist|mismatch"
    r"|two\s+different|conflicting|differs?\s+from|does\s*n[o']?t\s+(?:sum|add|equal)"
    r"|(?:sum|total)s?\s+to\s+\d)", re.I)
# a contradiction stated plainly, with no mismatch verb at all:
# "stated 11 topics but the page shows 10 topic sections"
_COUNT_CLASH_RE = re.compile(
    r"(?:stat\w*|says?|claims?|reports?|reads?|gives?)\b[^.]{0,90}?\d[^.]{0,90}?"
    r"\b(?:but|yet|while|whereas|however|when the|although)\b[^.]{0,90}?\d", re.I)
# the three things the prompt calls cosmetic on purpose stay cosmetic even when
# they are phrased as a disagreement
_COSMETIC_OK_RE = re.compile(
    r"(?:marker\s+(?:order|sequence)\s+(?:within|inside|at\s+the\s+end|of\s+the\s+stack)"
    r"|stack(?:ed)?\s+(?:marker\s+)?order|order\s+of\s+(?:the\s+)?stacked"
    r"|carded\s+under|placement|would\s+have\s+(?:placed|carded|made)"
    r"|reference\s+title|title\s+(?:naming|disagrees|and\s+the\s+abstract))", re.I)


def _escalate_numeric_contradictions(defects: list) -> list:
    """Raise any cosmetic note that reports one number contradicting another."""
    raised = []
    for d in defects:
        if str(d.get("severity", "")).lower() == "blocking":
            continue
        txt = f"{d.get('what', '')} {d.get('evidence', '')}"
        if _COSMETIC_OK_RE.search(txt):
            continue
        if (_CONTRADICTION_RE.search(txt) or _COUNT_CLASH_RE.search(txt)) and re.search(r"\d", txt):
            d["severity"] = "blocking"
            raised.append(d)
    return raised


def numeric_consistency_defects(W: str, h: str, facts: dict) -> list:
    """Compare every figure on the page against every other figure on the page.

    The read-back audit reads the brief as a reader would, one pass over a
    large sample, and it finds a contradiction between two distant sentences
    only when both happen to catch its attention. W21 surfaced them two at a
    time over five rounds — the Cochrane odds ratio, then the adenomyosis
    adjusted odds ratio, then a stats line, then a bucket described as "roughly
    half" of one paper — because no single read held all of them at once.

    This pass holds nothing else. Every sentence that states a figure, from
    every passage and every synthesis, arrives as one compact list with the
    page's measured facts beside it, so two sentences ten thousand characters
    apart sit next to each other. Evidence quotes BOTH sentences, which is
    what the reconciling repair needs to make them agree.
    """
    items, seen = [], set()
    for ps in _prose_passages(h):
        masked = _mask_noprose(ps.group(1))
        masked = re.sub(r"<h[1-6][^>]*>[\s\S]*?</h[1-6]>", lambda x: " " * len(x.group(0)), masked)
        where = ps.tid or ps.kind
        for t, _ in _sentences_of(masked):
            flat = re.sub(r"\s+", " ", t).strip()
            if len(flat) < 25 or not _num_tokens(flat):
                continue
            if flat in seen:
                continue
            seen.add(flat)
            items.append({"passage": where, "sentence": flat[:400]})
            if len(items) >= 400:
                break
        if len(items) >= 400:
            break
    if len(items) < 2:
        return []
    listing = "\n".join(f"[{x['passage']}] {x['sentence']}" for x in items)
    v = _ask_cached(W, "numeric", f"""Every sentence in one clinician-facing evidence brief that states a figure, with the passage it
sits in. A reader meets all of these on one page and can compare them.

WHAT THE PAGE MEASURABLY HOLDS: {json.dumps(facts, ensure_ascii=False)}

SENTENCES:
{listing}

Report ONLY these two faults:
(a) the SAME study or the SAME finding given different values in two different sentences — a
    different odds ratio, hazard ratio, percentage, sample size or follow-up for what is plainly the
    same result;
(b) a document-wide total or share that disagrees with what the page measurably holds.
Two different studies reporting different numbers is not a fault. The same study reported at two
different timepoints, outcomes, or populations is not a fault WHEN each sentence names which one it
means — a whole-cohort estimate and a subgroup estimate are different findings. It IS a fault when
two sentences name the SAME population and outcome and give different values. A figure rounded
differently (41% and 41.2%) is not a fault. Say nothing unless you are confident a reader would call it a
contradiction.
For each fault, quote BOTH sentences verbatim in "evidence", separated by " AND ".
Reply with ONLY {{"defects": [{{"what": "<the contradiction>", "evidence": "<sentence one> AND <sentence two>"}}, ...]}}
and {{"defects": []}} when every figure agrees.""", timeout_s=900)
    out = []
    for d in ((v or {}).get("defects") or [])[:8]:
        what, ev = str(d.get("what") or "").strip(), str(d.get("evidence") or "").strip()
        if what and ev:
            out.append({"what": what, "evidence": ev, "severity": "blocking"})
    return out


def audit_transform(W: str, before: str, after: str, dropped, emptied: list, moved: list | None = None, _repair: int = 5) -> str:
    """Read the transformed page and find what my own checks could not.

    Owner, 2026-09-19: "you should be using AI yourself — YOU ARE RESPONSIBLE
    TO MAKE SURE YOUR DUMBASS REGEX AND HEURISTIC CODE DIDN'T MAKE MISTAKES."
    Correct, and it is the lesson of every failure here: a post-condition I
    write tests what I thought to test, so a chip left pointing at a removed
    heading, an id suffix colliding with the numbering's own, a marker landing
    mid-phrase and a withdrawal that took out fifteen correct citations all
    passed my own checks and were caught a publish cycle later. This reads the
    actual output and looks for what a careful editor would see.
    """
    # A popover carries ~700 characters of text per marker, so an excerpt
    # capped by bytes showed the auditor a fraction of the narrative and it
    # judged the numbering wrong from what it could not see (the narrative
    # cites papers 3-6 before the first synthesis cites 7). Prose is sampled
    # with popovers stripped, popovers are sampled on their own, and the
    # document-order marker sequence is given whole.
    def strip_pops(x):
        return re.sub(r'<span class="mz-ref-pop"[\s\S]*?</span>(?=\s*</sup>)', "", x)

    def slice_of(h, pat, n=1, cap=3000, pops=False):
        out = []
        for m in list(re.finditer(pat, h))[:n]:
            out.append((m.group(0) if pops else strip_pops(m.group(0)))[:cap])
        return out

    seq = []
    passages = [(ps.tid or ps.kind, ps.group(1)) for ps in _prose_passages(after) if ps.kind != "synthesis"]
    passages += [(t.tid, t.group(1)) for t in _topic_sections(after)]
    passages.sort(key=lambda x: after.find(x[1][:80]) if x[1] else 0)
    for where, frag in passages:
        nums = [re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', x, re.S) or [None, ""])[1]).strip()
                for x in SUP_RE.findall(frag)]
        if nums:
            seq.append({"passage": where, "markers_in_order": nums})

    # every section, whole: a sample of four syntheses cut at 3,500 characters
    # left sections five to nine invisible to the auditor
    sections = []
    for t in _topic_sections(after):
        seg = t.group(0)
        synth = re.search(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', seg)
        sections.append({"id": t.tid,
                         "header": strip_pops(seg[:seg.find("</h2>") + 5 if "</h2>" in seg else 400])[:700],
                         "synthesis": strip_pops(synth.group(1))[:20000] if synth else "",
                         "cards": len(re.findall(r'<article class="mz-cite-card', seg)),
                         "card_pmids": sorted(set(re.findall(CARD_ID_RE, seg)) | set(re.findall(r"openDeepDive\('dd-(\d+)'", seg))),
                         "card_element_ids": sorted(set(re.findall(r'<article class="mz-cite-card[^>]*\bid="([^"]+)"', seg)))})
    sample = {
        "marker_sequence_in_document_order": seq,
        "toc_nav": slice_of(after, r'<nav class="mz-toc"[\s\S]*?</nav>', 1, 4000),
        "prose_passages": [{"id": ps.tid or ps.kind, "html": strip_pops(ps.group(1))[:20000]}
                           for ps in _prose_passages(after) if ps.kind != "synthesis"],
        "sections": sections,
        # named for what it is: two examples, not the list. The audit compared
        # its length against the popover COUNT and reported 23 popovers
        # missing from a page that had all 23.
        "two_example_popovers_not_the_whole_list": slice_of(
            after, r'<sup class="mz-ref">[\s\S]*?</sup>', 2, 1600, pops=True),
        "references_head": slice_of(after, r'<ol class="mz-references-list">[\s\S]{0,2500}', 1, 2500),
        "cite_card": slice_of(after, r'<article class="mz-cite-card[\s\S]*?</article>', 1, 2500),
        "counts": {
            "citation_markers_in_prose_and_sections": sum(len(x["markers_in_order"]) for x in seq),
            "citation_markers_inside_deep_dive_dialogs": len(SUP_RE.findall(after)) - sum(len(x["markers_in_order"]) for x in seq),
            "citations": len(SUP_RE.findall(after)),
            "distinct_papers_cited": len({_pmid_of(x) for x in SUP_RE.findall(after)}),
            "duplicate_element_ids_(measured)": len([i for i, n in __import__("collections").Counter(re.findall(r'\bid="([^"]+)"', after)).items() if n > 1]),
            "popovers_(one_per_citation_marker)": len(re.findall(r'class="mz-ref-pop"', after)),
            "deep_dive_dialogs_(one_per_carded_paper_not_per_marker)": len(re.findall(r'<dialog[^>]*id="dd-\d+"', after)),
            "reference_entries": len(re.findall(r'<li id="ref-\d+">', after)),
            "cite_cards": len(re.findall(r'<article class="mz-cite-card', after)),
            # a paper discussed in two places is carded in both, with or
            # without topic headings — this is the difference that explains
            # cite_cards exceeding distinct_papers_cited, and the audit read
            # that difference as a missing citation on a brief that had none
            "distinct_papers_carded": len({(re.search(CARD_ID_RE, c) or re.search(r"openDeepDive\('dd-(\d+)'", c) or [None, None])[1]
                                           for c in re.findall(r'<article class="mz-cite-card[\s\S]*?</article>', after)} - {None}),
            "extra_cards_for_papers_carded_twice": (
                len(re.findall(r'<article class="mz-cite-card', after))
                - len({(re.search(CARD_ID_RE, c) or re.search(r"openDeepDive\('dd-(\d+)'", c) or [None, None])[1]
                       for c in re.findall(r'<article class="mz-cite-card[\s\S]*?</article>', after)} - {None})),
            "toc_chips": sum(1 for m in re.finditer(r'<a[^>]*class="([^"]*)"', after) if "mz-toc-chip" in m.group(1).split()),
            "topic_sections": len(_topic_sections(after)),
            # a reader can add the section counts up, and they sum to MORE than
            # the brief's paper total whenever a paper sits under two headings.
            # Both figures are shown so the audit reads it as the design it is
            # rather than as the page contradicting itself (W21).
            "sum_of_topic_section_counts": sum(
                len(set(re.findall(CARD_ID_RE, t.group(0)))
                    | set(re.findall(r"openDeepDive\('dd-(\d+)'", t.group(0))))
                for t in _topic_sections(after)),
            "placements_removed": len(dropped),
            "papers_moved_between_headings": len(moved or []),
            "headings_removed": emptied,
            "chars_before": len(before), "chars_after": len(after),
        },
    }
    v = _ask_cached(W, "transform", f"""You are the last editor to see a clinical brief before it publishes. A program has just
transformed it: removed papers from headings they were not about (a paper carded under two headings
may rightly remain under one), moved a paper to the heading it belongs under, removed headings left empty,
inserted citations on studies the prose names, renumbered every citation marker in order of first
appearance, rebuilt the reference list in that order, and de-duplicated element ids.

Read the ACTUAL OUTPUT below and find what is wrong with it. Do not take the program's word for
anything — check what you can see. Markers are numbered by FIRST APPEARANCE IN THE WHOLE DOCUMENT,
narrative first, then each section in order, AND THEN the deep-dive dialogs, whose markers continue
the same sequence. "marker_sequence_in_document_order" lists the prose and section markers only, so
the highest number in it is normally LOWER than the reference count: the difference is the papers
cited inside deep dives (counted separately in counts). That difference is not an orphan reference
and is not a defect. Judge numbering and sequence from that list — the prose excerpts are partial. Popover text has been removed from the prose excerpts; judge whether a popover is COMPLETE — title, journal
line, finding, link — from "two_example_popovers_not_the_whole_list", which is exactly two examples
and never the whole list: its length says nothing about how many popovers the page has, and the
count in "counts" does. Never report popovers as missing by comparing those two against a count. A paper that belongs under two headings is carded under both — two cite cards, the
second with a suffixed id (mz-cite-<pmid>-2) — so the card count may exceed the paper count; that is
by design, not a defect, and duplicate ids are measured and reported in counts. This holds whether or
not the brief has topic headings. Three counts close the arithmetic and none of them is guesswork:
"cite_cards" minus "distinct_papers_carded" is "extra_cards_for_papers_carded_twice", and
"distinct_papers_carded" minus "distinct_papers_cited" is how many carded papers carry no marker —
THAT is the number to report, and it should be zero. Do not subtract "distinct_papers_cited" from
"cite_cards" and compare the result to the double-carding figure; those measure different things. For the same reason
the per-heading counts a reader could add up sum to MORE than the brief's paper total, which counts
each paper ONCE: "sum_of_topic_section_counts" exceeding "distinct_papers_cited" is that design and
is NOT a contradiction. A stated total is wrong only when it disagrees with "distinct_papers_cited". Which heading a paper
is carded under was judged twice against the practice's own reference library, and clinical areas
overlap (placenta accreta under hysterectomy, adenomyosis under pelvic pain): report a placement you
would have made differently as cosmetic, and block only when the paper is plainly another specialty. "card_pmids" is the
list of papers a section carries (some older cards have no id attribute and are identified by their
deep-dive trigger); judge "which papers are carded" from it. Prose describes a
paper as its ABSTRACT does; when a reference title and the prose disagree, that is a discrepancy in
the paper itself (a title naming a sterilization ring over an abstract describing an LNG-IUS), not a
wrong citation — report it as cosmetic, never blocking, when the prose names the discrepancy or
follows the abstract. The ORDER of markers stacked at the end of one sentence is cosmetic, never
blocking: each number resolves through the reference list, whichever order the stack shows.

ALWAYS BLOCKING, whatever else you think of it: a number a reader can check that contradicts
another number on the same page. The same paper or the same finding given two different effect
sizes, rates or sample sizes in different places; a stated total that disagrees with the breakdown
printed beside it; a count of papers, topics or studies that disagrees with what the page shows.
A reader can do that arithmetic, and a brief that fails it is wrong, not untidy. The only defects
that are cosmetic are the three named above — a placement you would have made differently, a
reference title that disagrees with its own abstract, and the order of markers stacked at the end
of one sentence. Everything else that makes the brief say something untrue is blocking.

Look hard for: a citation marker sitting inside a noun phrase instead of after the claim's full stop;
markers out of sequence or repeating a number for a different paper; a jump-list chip pointing at a
heading that is gone, or a chip count that disagrees with the section; a reference entry for a paper
never cited, or a marker with no entry; a duplicated element id; a sentence or list left broken by a
removed paper (a dangling "and", a doubled full stop, an empty parenthesis, a topic header with no
cards under it); a popover missing its title, journal line, finding or link; markup that will not
render (unclosed tag, stray attribute); and anything a reader would notice as damage.

OUTPUT SAMPLE: {json.dumps(sample, ensure_ascii=False)[:260000]}

Reply with ONLY {{"ok": true|false, "defects": [{{"what": "<the defect>", "evidence": "<quote it>",
"severity": "blocking"|"cosmetic"}}, ...], "notes": "one or two sentences"}}""", timeout_s=1200)
    if not v or "ok" not in v:
        die("the transform audit returned no verdict")
    numeric = numeric_consistency_defects(W, after, sample["counts"])
    if numeric:
        v["defects"] = (v.get("defects") or []) + numeric
        for d in numeric:
            print(f"  FIGURES DISAGREE: {str(d.get('what'))[:130]}")
    for d in _escalate_numeric_contradictions(v.get("defects") or []):
        print(f"  TRANSFORM AUDIT: filed as cosmetic, raised to blocking — a number contradicts "
              f"another number on the page: {str(d.get('what'))[:100]}")
    blocking = [d for d in (v.get("defects") or []) if str(d.get("severity", "")).lower() == "blocking"]
    for d in (v.get("defects") or [])[:12]:
        tag = "BLOCKING" if d in blocking else "cosmetic"
        print(f"  TRANSFORM AUDIT [{tag}]: {str(d.get('what'))[:130]} :: {str(d.get('evidence'))[:110]}")
    if blocking and _repair > 0:
        repaired, n = repair_from_defects(W, after, blocking, sample.get("counts"))
        if n and repaired != after:
            # bank it: a later round may refuse, and a resume must not start
            # again from the body these repairs have already corrected
            _snap_update_body(W, "numbered", repaired)
            print(f"  repaired {n} of {len(blocking)} defect(s) the audit named; reading the page again "
                  f"({_repair - 1} round(s) left)")
            return audit_transform(W, before, repaired, dropped, emptied, moved, _repair=_repair - 1)
        if n:
            # every rewrite came back identical to what it replaced. Re-reading
            # the same page asks the same question and is served the same
            # cached answer; W21 burned three rounds doing exactly that.
            print("  the repair rewrote nothing that changed the page — the defect needs a different fix")
    if blocking:
        die(f"the transform audit found {len(blocking)} blocking defect(s) in the output")
    print(f"  transform audit: the output reads correctly"
          + (f" ({len(v.get('defects') or [])} cosmetic note(s))" if v.get("defects") else ""))
    return after



def rewrite_affected_syntheses(W: str, h: str, topics: dict, removed: list, moved: list, real: dict) -> tuple:
    """Rewrite the synthesis of any heading whose papers changed.

    Curation removes and moves papers; the paragraph above the cards still
    describes the set that existed before. W33's adenomyosis synthesis opened
    "Three adenomyosis papers this week" above two cards, and the jump-list
    chip — correctly recounted — said 2. A brief that miscounts its own
    contents in its own prose is worse than one with an extra paper, so the
    prose is rewritten against what the section now holds rather than patched.
    """
    rewritten = 0
    for tid, t in topics.items():
        now = _survivors(topics, tid, removed, moved)
        lost = [q for q in t["pmids"] if q not in now]
        gained = [q for q in now if q not in t["pmids"]]
        if (not lost and not gained) or not now:
            continue
        sec = _section_span(h, tid)
        if not sec:
            continue
        seg = sec.group(2)
        pm = re.search(r'(<p class="mz-toc-group-synthesis">)([\s\S]*?)(</p>)', seg)
        if not pm:
            continue
        old_text = H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", pm.group(2))))
        old_flat = re.sub(r"\s+", " ", old_text).strip()[:3000]
        papers = [{"pmid": q, "title": (real.get(q) or {}).get("title", ""),
                   "abstract": ((real.get(q) or {}).get("abstract") or "")[:1400]} for q in now]
        papers_json = json.dumps(papers, ensure_ascii=False)[:40000]
        change = (f"{len(lost)} of them have since been removed for not being about this heading"
                  if lost else "")
        if gained:
            change += (", and " if change else "") + f"{len(gained)} paper(s) moved here from another heading"
        lost_desc = [{"pmid": q, "first_author": ((real.get(q) or {}).get("authors") or "").split(",")[0].strip(),
                      "title": (real.get(q) or {}).get("title", "")[:140]} for q in lost]
        change += f". THE REMOVED PAPERS, which the paragraph may no longer mention or argue from: {json.dumps(lost_desc, ensure_ascii=False)}"
        v = _ask_cached(W, "resynth", f"""Rewrite one section-opening paragraph of a clinician-facing weekly evidence brief.
HEADING: {json.dumps(t["title"])}
The paragraph below was written when this section held {len(t["pmids"])} papers. {change}, so the
paragraph no longer describes what is here — including its own count.

THE PAPERS THE SECTION NOW HOLDS (all of them, and only these):
{papers_json}

THE PARAGRAPH AS IT STANDS:
{json.dumps(old_flat)}

Rewrite it so it is true of the papers now present: the right count, no reference to a removed paper,
every paper present discussed, and the same voice — Dr. Mabini's first person, a DO and complex
benign gynecology / minimally invasive gynecologic surgery surgeon reading the week. Keep what still
holds; change only what the changes made wrong. Report each paper's actual finding with its own
numbers. 900-2000 characters. Plain HTML: <em> and <strong> only, no headings, no citation markup
(citations are added afterwards). Escape & < >.
Return ONLY {{"paragraph": "<inner html>"}}""", timeout_s=900)
        new_text = (v or {}).get("paragraph", "").strip()
        if new_text and re.search(r"\b(?:M?ETHODS|R?ESULTS|C?ONCLUSIONS?|B?ACKGROUND|O?BJECTIVES?)\s*:", new_text):
            # W21: an abstract's METHODS paragraph pasted into the synthesis
            v = _claude(f"""Rewrite one section-opening paragraph of a clinician-facing weekly evidence brief in Dr. Mabini's
first person. A previous attempt pasted raw abstract text with section labels (METHODS:, RESULTS:) —
write plain clinical prose in your own words instead, reporting each paper's finding with its numbers.
THE PAPERS THE SECTION NOW HOLDS: {papers_json}
THE PARAGRAPH AS IT STANDS: {json.dumps(old_flat)}
900-2000 characters, plain HTML (<em>/<strong> only), no citation markup, & < > escaped.
Return ONLY {{"paragraph": "<inner html>"}}""", timeout_s=900)
            new_text = (v or {}).get("paragraph", "").strip()
            if re.search(r"\b(?:M?ETHODS|R?ESULTS|C?ONCLUSIONS?)\s*:", new_text):
                new_text = ""
        if not new_text or len(new_text) < 400:
            print(f"  could not rewrite the synthesis for {tid}; leaving it and reporting")
            continue
        lost_sur = {k for k, qs in _first_surnames(lost, real).items()} - set(_first_surnames(now, real))
        named_still = [k for k in lost_sur if re.search(r"(?<![\w-])" + re.escape(k) + r"(?:['\u2019]s)?(?![\w-])",
                                                       H.unescape(re.sub(r"<[^>]+>", " ", new_text)))]
        if named_still:
            die(f"the rewritten synthesis for {t['title']!r} still argues from removed paper(s) by {named_still}")
        at = sec.start(2) + pm.start(2)
        h = h[:at] + new_text + h[sec.start(2) + pm.end(2):]
        rewritten += 1
        print(f"  rewrote the synthesis for {t['title']!r} — {len(lost)} removed, {len(gained)} moved in, {len(now)} now")
    return h, rewritten


RENUMBER_STAGES = ("curated", "cited", "numbered")


def _snap_put(W: str, name: str, h: str, **state) -> None:
    """Checkpoint after a stage: the body and every value later stages read.
    A fix to a later stage resumes from here (--from=<name>) instead of
    replaying the whole chain — owner, 2026-09-19: "if everything before is
    fine in the process, there's no reason to start from the beginning"."""
    json.dump({"h": h, **state}, open(W + f"snap.{name}.json", "w"), ensure_ascii=False)


def _snap_get(W: str, name: str) -> dict:
    path = W + f"snap.{name}.json"
    if not os.path.exists(path):
        die(f"no checkpoint '{name}' in {W} — run without --from, or from an earlier stage: {RENUMBER_STAGES}")
    return json.load(open(path))


def _snap_update_body(W: str, name: str, h: str) -> None:
    """Keep a checkpoint's body in step with a repair already made to it.

    The audit repairs what it names, the next round finds something else and
    the run refuses — and `--from=<name>` then replayed the body as it stood
    BEFORE any of those repairs. Every resume redid the same work and stopped
    at the same wall. Only the body changes; every other value the later
    stages read stays as the checkpoint recorded it. A missing checkpoint (the
    weekly authoring path has none by this name) is a silent no-op."""
    path = W + f"snap.{name}.json"
    if not os.path.exists(path):
        return
    try:
        d = json.load(open(path))
    except (json.JSONDecodeError, OSError):
        return
    d["h"] = h
    json.dump(d, open(path, "w"), ensure_ascii=False)


def cmd_renumber(post_id: str, dry: bool = False, resume: str | None = None) -> None:
    """dry=True runs the whole transformation and every check, and writes
    nothing to the site. Model verdicts are cached, so iterating on a regex
    after a failed check costs nothing."""
    # No spec receipt required. That receipt certifies the AUTHORING pipeline,
    # and this command authors nothing: it renumbers markers and rebuilds the
    # reference list over prose that is already written, already reviewed and
    # already published. Its own gate is its post-conditions (every marker a
    # number in sequence resolving to an entry that exists, references in
    # citation order, no duplicate ids), the site's publish audit, and a
    # browser that checks every marker on hover and tap before and after
    # publishing. Requiring the authoring receipt here left the owner's actual
    # complaint sitting on the live site while the auditor refined wording.
    W = os.path.join(SCRATCH, "renumber", post_id) + "/"
    os.makedirs(W + "papers", exist_ok=True)
    lock = hold_work_lock(W, post_id)
    try:
        _renumber(post_id, W, dry, resume)
    except Refused:
        # the refusal names the failing stage; this names how to continue
        # from the last good checkpoint once that stage is fixed
        done = [st for st in RENUMBER_STAGES if os.path.exists(W + f"snap.{st}.json")]
        if done:
            print(f"  to continue after fixing the failing stage, without replaying the stages before it:\n"
                  f"    python3 scripts/brief_pipeline.py renumber {post_id} --from={done[-1]}{' --dry' if dry else ''}",
                  file=sys.stderr)
        raise
    finally:
        release_work_lock(lock)


def _renumber(post_id: str, W: str, dry: bool, resume: str | None = None) -> None:
    if resume and resume not in RENUMBER_STAGES:
        die(f"unknown checkpoint {resume!r}; one of {RENUMBER_STAGES}")
    stage = RENUMBER_STAGES.index(resume) + 1 if resume else 0
    post = curl_json(f"{BASE}/api/posts/_admin/{post_id}", auth=True)
    post = post.get("post", post)
    if stage == 0:
        h = normalize_legacy_markup(post["body_html"])
        before_html = h
        before = [re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', x, re.S) or [None, ""])[1]).strip()
                  for x in SUP_RE.findall(h)]
        pmids = [x for x in dict.fromkeys(_pmid_of(x) for x in SUP_RE.findall(h)) if x]
        if not pmids:
            die(f"{post_id}: no inline citations to renumber")
        print(f"{post_id}: {len(SUP_RE.findall(h))} citation(s), {len(pmids)} distinct paper(s)")
        print(f"  markers showing a PMID before: {sum(1 for m in before if re.fullmatch(chr(92) + 'd{5,9}', m))}")

        # PubMed is the authority for the journal and year in every popover and entry
        covered = list(dict.fromkeys(re.findall(r'id="mz-(?:cite|ref)-(\d{5,9})"', h)
                                     + re.findall(r'<dialog[^>]*id="dd-(\d+)"', h)))
        pmids_all = list(dict.fromkeys(pmids + covered))
        real = fetch_pubmed(sorted(pmids_all))

        # CURATION FIRST, always. A brief is not worth renumbering while it still
        # carries papers that are not about their own heading.
        topics = {}
        for t in _topic_sections(h):
            seg = t.group(1)
            tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", seg, re.S)
            pm_here = list(dict.fromkeys(re.findall(CARD_ID_RE, seg)
                                         + re.findall(r"openDeepDive\('dd-(\d+)'", seg)))
            if pm_here:
                title = H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip() if tt else t.tid
                title = re.sub(r"\s*(?:\d+ papers?|\(\d+\))\s*$", "", title)[:90]
                topics[t.tid] = {"title": title, "pmids": pm_here}
        papers_ctx = {pm: {"title": (real.get(pm) or {}).get("title", ""),
                           "abstract": (real.get(pm) or {}).get("abstract", "")} for pm in pmids_all}
        if topics:
            h, removed, moved, emptied = curate_live(h, topics, papers_ctx, W)
            tt = lambda tid: topics.get(tid, {}).get("title", tid)  # noqa: E731
            if removed:
                print(f"  curation removed {len(removed)} placement(s) not about their heading:")
                for tid, pm, why in removed:
                    print(f"    {pm} from {tt(tid)!r}: {why[:110]}")
            for f, to, pm, why in moved:
                print(f"  curation moved {pm} from {tt(f)!r} to {tt(to)!r}: {why[:110]}")
            if emptied:
                print(f"  removed {len(emptied)} heading(s) left with nothing under them: {emptied}")
            gone = [pm for pm in dict.fromkeys(pm for _, pm, _ in removed) if not _has_card(h, pm)]
            if gone:
                print(f"  {len(gone)} paper(s) left the brief entirely; {len(set(pm for _, pm, _ in removed)) - len(gone)} remain under another heading")
            # A citation to a paper the brief does not card points at nothing a
            # reader can open. W21 carried twenty-one markers to a Cochrane
            # review with no card in any section, and the read-back audit
            # refused it for eighty-four cited papers against seventy-five
            # carded. Fifteen of the seventeen published briefs have none of
            # these, so it is a defect and not a house style. Those papers
            # leave the held set exactly like one curation removed, so the
            # prose that argues from them is rewritten below.
            h, resynth = rewrite_affected_syntheses(W, h, topics, removed, moved, real)
            if resynth:
                print(f"  {resynth} synthesis paragraph(s) rewritten to match what survives")
        else:
            # no topic headings: the brief's own title is its one heading, and
            # every carded paper is judged against it
            removed, moved, emptied, gone = [], [], [], []
            title = H.unescape(re.sub(r"<[^>]+>", "", (re.search(
                r'<h1[^>]*class="[^"]*mz-post-title[^"]*"[^>]*>([\s\S]*?)</h1>', h) or [None, ""])[1])).strip()
            title = title or str(post.get("title") or "")
            if title:
                h, flat_removed = curate_flat(h, title, papers_ctx, W)
                if flat_removed:
                    print(f"  curation removed {len(flat_removed)} paper(s) not about this brief's subject:")
                    for pm, why in flat_removed:
                        print(f"    {pm}: {why[:110]}")
                    gone = [pm for pm, _ in flat_removed]
                    removed = [("the brief", pm, why) for pm, why in flat_removed]

        # ---- FOR EVERY BRIEF, WHATEVER ITS SHAPE ----------------------------
        # These three ran inside the curation branch, which only a brief with
        # topic headings ever enters, so the whole trend generation skipped
        # them in silence. The mast-cell brief published citing two papers it
        # does not card because of exactly that. A guarantee that applies to
        # one page shape is not a guarantee.
        #
        # A citation to a paper the brief does not card points at nothing a
        # reader can open. W21 carried twenty-one markers to a Cochrane review
        # with no card in any section. Those papers leave the held set exactly
        # like one curation removed, so the prose arguing from them is
        # rewritten below.
        uncarded = [q for q in dict.fromkeys(_pmid_of(m.group(0)) for m in SUP_RE.finditer(h))
                    if q and q not in gone and not _has_card(h, q)]
        if uncarded:
            print(f"  {len(uncarded)} paper(s) cited with no card anywhere: {uncarded[:6]}")
            drop = set(uncarded)
            for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                if _pmid_of(m.group(0)) in drop:
                    h = h[:m.start()] + h[m.end():]
            gone = list(dict.fromkeys(list(gone) + uncarded))
        pmids_all = [x for x in pmids_all if x not in gone]
        pmids = [x for x in pmids if x not in gone]
        # a name credited to the wrong paper has to be corrected BEFORE the
        # narrative rewrite, which otherwise demands the removal of a surname
        # that belongs to a paper the brief keeps
        h, n_attr = fix_prose_attribution(W, h, real)
        if n_attr:
            print(f"  {n_attr} sentence(s) that credited the wrong authors corrected")
        h, n_narr = rewrite_narrative_for_removed(W, h, gone, real, surviving=pmids_all)
        if n_narr:
            print(f"  {n_narr} narrative paragraph(s) rewritten so nothing argues from a removed paper")
        # every paper the brief holds may be cited by the chain below, so every
        # one gets its file and its journal line — not only the ones already cited
        meta = {}
        for pm in pmids_all:
            r = real.get(pm) or {}
            line = " · ".join(x for x in (r.get("authors", ""), r.get("journal", ""), r.get("year", "")) if x)
            if line:
                meta[pm] = line
            json.dump({"pmid": pm, "title": r.get("title", ""), "meta_verified": line,
                       "pubmed_abstract": r.get("abstract", "")},
                      open(W + f"papers/{pm}.json", "w"), ensure_ascii=False)
        missing_meta = [pm for pm in pmids_all if pm not in meta]
        if missing_meta:
            # one more try before refusing: a partial PubMed response is transient
            again = fetch_pubmed(missing_meta)
            for pm in missing_meta:
                r = again.get(pm) or {}
                line = " · ".join(x for x in (r.get("authors", ""), r.get("journal", ""), r.get("year", "")) if x)
                if line and r.get("title"):
                    real[pm] = r
                    meta[pm] = line
                    json.dump({"pmid": pm, "title": r.get("title", ""), "meta_verified": line,
                               "pubmed_abstract": r.get("abstract", "")},
                              open(W + f"papers/{pm}.json", "w"), ensure_ascii=False)
            missing_meta = [pm for pm in pmids_all if pm not in meta]
        if missing_meta:
            die(f"could not verify the journal line for {missing_meta[:6]} — refusing to renumber blind")

        _snap_put(W, "curated", h, before_html=before_html, pmids=pmids, pmids_all=pmids_all, real=real,
                  removed=removed, moved=moved, emptied=emptied, meta=meta)
        print("  checkpoint: curated")
    else:
        sn = _snap_get(W, "curated")
        h, before_html, pmids, pmids_all, real, meta = sn["h"], sn["before_html"], sn["pmids"], sn["pmids_all"], sn["real"], sn["meta"]
        removed = [tuple(x) for x in sn["removed"]]
        moved = [tuple(x) for x in sn["moved"]]
        emptied = sn["emptied"]
        print(f"  resumed from checkpoint 'curated' ({len(pmids_all)} papers)")

    if stage <= 1:
        h, refreshed = refresh_popovers_from_abstracts(W, h, real)
        if refreshed:
            print(f"  {refreshed} hover card(s) written from the papers' abstracts")
        h, named, declined = cite_and_review(W, h, pmids_all, real)
        _snap_put(W, "cited", h, named=named, declined=declined)
        print("  checkpoint: cited")
    else:
        sn = _snap_get(W, "cited")
        h, named, declined = sn["h"], sn["named"], sn["declined"]
        print("  resumed from checkpoint 'cited'")
    if stage <= 2:
        if "mz-eddisclaimer" not in h:
            # S8: W23-W29 were published before the disclaimer existed; the
            # weekly path injects it and the rendered gate requires it
            m_ref = re.search(r'<section class="[^"]*mz-references[^"]*"|<ol class="mz-references-list"|<dialog', h)
            at = m_ref.start() if m_ref else len(h)
            h = h[:at] + DISCLAIMER + h[at:]
            print("  educational disclaimer added (the brief predates it)")
        h = remove_empty_groups(h)
        h = recount_headings(h)
        h, bound = bind_legacy_cards(h, real)
        if bound:
            print(f"  {bound} card(s) bound to the paper they name (they carried a section index, not a paper)")
        h = normalize_card_ids(h)
        h = refresh_shape_chart(h)
        h, blanks = drop_empty_list_items(h)
        if blanks:
            print(f"  {blanks} list item(s) left empty by a removed sentence dropped")
        h, bars = fix_pyramid_bars(h)
        if bars:
            print(f"  {bars} evidence-pyramid row(s) redrawn to match the count printed on them")
        h, split = repair_split_tags(h)
        if split:
            print(f"  {split} opening tag(s) whose '>' had been pushed past their text closed")
        h = renumber_list_labels(h)
        h = tidy_prose_spacing(h)
        h = breakable_marker_runs(h)
        h, order = number_citations(h, meta)
        h, badges = renumber_card_badges(h, order)
        if badges:
            print(f"  {badges} card badge(s) renumbered to the citation they belong to")
        h, modal_meta = refresh_deep_dive_meta(h, real)
        if modal_meta:
            print(f"  {modal_meta} deep-dive citation line(s) rebuilt from PubMed")
        # numbering can leave a legacy marker without a popover (W20's 8 and
        # 20); the browser gate refuses the page for it, so fill them here
        h, filled_pops = refresh_popovers_from_abstracts(W, h, real)
        if filled_pops:
            print(f"  {filled_pops} popover(s) written after numbering")
        h = build_references(W, h, order, meta)
        h = dedupe_element_ids(h)
        _snap_put(W, "numbered", h, order=order)
        print("  checkpoint: numbered")
    else:
        sn = _snap_get(W, "numbered")
        h, order = sn["h"], sn["order"]
        print("  resumed from checkpoint 'numbered'")

    # post-conditions, on exactly the two things reported plus what they touch
    faults = []
    # S8/S9/S10 on the republished body. This path rewrites syntheses,
    # narrative paragraphs and individual sentences, and none of these gates
    # ran on it until standards-check said so (2026-09-20). The grounding of
    # what it rewrites (S6) is judged sentence by sentence against the cited
    # abstracts by review_inserted_citations above, and the finished page is
    # read back by audit_transform below (S16).
    faults += reader_prose_faults(h)
    # Citation coverage is no longer judged by matching surnames. Placement is
    # decided by the model reading each sentence against the papers, and it
    # deliberately declines where it cannot attribute — "Li and Ye" names two
    # authors and putting the claim on one of them is wrong. The old check
    # demanded a citation wherever a covered paper's first author appeared and
    # refused finished briefs over exactly those correct refusals. What a
    # reader would call a missing citation is found by the read-back audit,
    # which looks at the page; this only reports, so nothing is hidden.
    if declined:
        print(f"  NOTE: named but judged not to rest on the paper (the targeted pass asked about each): {declined[:8]}")

    marks = [re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', x, re.S) or [None, ""])[1]).strip()
             for x in SUP_RE.findall(h)]
    if any(re.fullmatch(r"\d{5,9}", m) for m in marks):
        faults.append("a marker still shows a PMID")
    seen = []
    for x in SUP_RE.findall(h):
        pm = _pmid_of(x)
        if pm and pm not in seen:
            seen.append(pm)
    for x in SUP_RE.findall(h):
        pm = _pmid_of(x)
        t = re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', x, re.S) or [None, ""])[1]).strip()
        if pm in seen and t != str(seen.index(pm) + 1):
            faults.append(f"marker for {pm} reads {t!r}, expected {seen.index(pm) + 1}")
            break
    if re.findall(r'<li id="ref-(\d+)">', h) != order:
        faults.append("the reference list is not in citation order")
    for href in set(re.findall(r'<a class="mz-ref-link" href="#(ref-\d+)"', h)):
        if f'id="{href}"' not in h:
            faults.append(f"a marker points at a missing reference {href}")
            break
    from collections import Counter as _C
    dup = [k for k, v in _C(re.findall(r'\sid="([^"]+)"', h)).items() if v > 1]
    if dup:
        faults.append(f"duplicate element ids remain: {dup[:4]}")
    if faults:
        for f_ in faults:
            print("  FAULT:", f_)
        die(f"{post_id}: renumbering did not hold")

    h = audit_transform(W, before_html, h, removed, emptied, moved)
    faults = reader_prose_faults(h)
    if faults:
        die(f"{post_id}: after the audit repair, {len(faults)} reader-visible fault(s): {faults[:3]}")

    post["body_html"] = h
    open(W + "body.applied.html", "w", encoding="utf-8").write(h)
    json.dump(post, open(W + f"{post_id}.applied.json", "w"), ensure_ascii=False)

    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs')"
        ".readFileSync('%s','utf8'));const a=m.auditPublishable(p);console.log(JSON.stringify("
        "{publishable:a.publishable,problems:a.problems}))})"
        % (ROOT, W + f"{post_id}.applied.json")], capture_output=True, text=True, cwd=ROOT)
    verdict = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    if not verdict.get("publishable"):
        print("  auditPublishable:", json.dumps(verdict.get("problems"))[:400])
        die("the publish audit refused the renumbered body")

    preview_and_verify(W, post_id, "/evidence/")
    if dry:
        # the whole transformation and every gate ran; nothing is written.
        # (This check was lost in a refactor once: a passing dry run would
        # have published.)
        print(f"DRY RUN OK — {post_id} passes every check; nothing was written to the site")
        return

    import hashlib as _hl
    receipt = {"body_sha256": _hl.sha256(h.encode("utf-8")).hexdigest(),
               "standards_passed": True, "grounding_passed": True,
               "pipeline_digest": _sha_file(os.path.abspath(__file__)),
               "scope": (f"published brief re-processed by the one citation chain: curation per (heading, paper) "
                         f"grounded in the KB ({len(removed)} placement(s) removed, {len(moved)} moved, headings "
                         f"removed: {emptied}); syntheses and narrative rewritten where curation changed them; card "
                         f"abstracts, metadata and hover cards from PubMed; citations placed and reviewed by the "
                         f"model per sentence, misstated sentences corrected from their abstracts and re-reviewed; "
                         f"markers numbered in order of first appearance, references rebuilt; read back by a model "
                         f"(S16); every marker checked in a browser before publishing."),
               "checked_at": datetime.datetime.utcnow().isoformat() + "Z"}
    json.dump(receipt, open(W + ".ledger/receipt.json", "w"), indent=1)
    json.dump({"body_html": h, "pipeline_receipt": receipt}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}", "PUT", auth=True, data_file=W + "_put.json"))[:200])
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}/approve", "POST", auth=True, data_file=W + "_approve.json"))[:200])
    verify_rendered(_route_for(post_id, post.get("kind")), post_id)
    print(f"{post_id}: {len(order)} citation(s) renumbered 1-{len(order)}, references in citation order")


def hold_work_lock(W: str, post_id: str) -> str:
    """ONE PASS PER WORK DIRECTORY. Two passes on the same directory fight over
    the ledger, the topic files and the verdict caches: an older `run`
    recreated the very topics a newer one had just removed, so a fix that
    worked looked like it had not, and both paid for the same authoring twice;
    two `renumber` passes interleaved writes to `cache.curate.json` and one
    read a half-written file. Returns the lock path; release with
    `release_work_lock`."""
    os.makedirs(W + ".ledger", exist_ok=True)
    lock = W + ".ledger/run.lock"
    if os.path.exists(lock):
        try:
            other = int(open(lock).read().strip())
        except Exception:
            other = None
        alive = False
        if other:
            try:
                os.kill(other, 0)
                alive = True
            except OSError:
                alive = False
        if alive:
            die(f"another pass for {post_id} is already working here (pid {other}) — "
                f"stop it, or wait for it, before starting a second")
        os.remove(lock)
    open(lock, "w").write(str(os.getpid()))
    return lock


def release_work_lock(lock: str) -> None:
    if os.path.exists(lock) and open(lock).read().strip() == str(os.getpid()):
        os.remove(lock)


def cmd_run(post_id: str, dry: bool = False) -> None:
    W = work_dir(post_id)
    lock = hold_work_lock(W, post_id)
    try:
        _run_chain(post_id, W, dry)
    finally:
        release_work_lock(lock)


def _run_chain(post_id: str, W: str, dry: bool = False) -> None:
    print(f"RUN {post_id}")
    try:
        require(W, "prepare"); require_review(W, "prepare")
        print("  prepare: receipt current")
    except Refused:
        cmd_prepare(post_id)
    last = None
    for rnd in range(1, REPAIR_ROUNDS + 1):
        try:
            for st in ("curate", "author", "guard", "apply"):
                try:
                    require(W, st); require_review(W, st)
                    if st == "apply":
                        require_standards(W)
                    print(f"  {st}: receipt current")
                except Refused:
                    globals()["cmd_" + st](post_id)
            cmd_publish(post_id, dry=dry)
            print(f"RUN {post_id}: {'dry run passed' if dry else 'published'} (round {rnd})")
            return
        except Refused as e:
            last = e.msg
            fixed = repair(W, e.msg)
            print(f"  round {rnd} refused: {e.msg[:300]}")
            if not fixed:
                die(f"{post_id}: refused and nothing to repair automatically — {e.msg[:400]}")
            print(f"  repairing: {fixed} — rerunning")
    die(f"{post_id}: still refused after {REPAIR_ROUNDS} repair rounds — {last[:400] if last else ''}")



if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    _dry = "--dry" in sys.argv
    _cmd = sys.argv[1]
    _fn = {"prepare": cmd_prepare, "curate": cmd_curate, "author": cmd_author, "pmids": cmd_pmids,
           "guard": cmd_guard, "apply": cmd_apply, "publish": cmd_publish,
           "standards-check": cmd_standards_check, "run": cmd_run, "renumber": cmd_renumber}.get(_cmd)
    if not _fn:
        die(f"unknown stage {_cmd}")
    _from = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--from=")), None)
    if _cmd == "renumber":
        _fn(sys.argv[2], dry=_dry, resume=_from)
    elif _cmd in ("run", "publish"):
        _fn(sys.argv[2], dry=_dry)
    else:
        _fn(sys.argv[2])
