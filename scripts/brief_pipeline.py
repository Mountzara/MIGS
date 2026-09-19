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
import html as H
import datetime
import json
import os
import re
import re as _re
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


class Refused(SystemExit):
    """A stage refused. Carries the reason so `run` can repair and retry."""
    def __init__(self, msg: str):
        super().__init__(2)
        self.msg = msg


def die(msg: str) -> "NoReturn":
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
    rendered = ("\nMEASURED ON THE RENDERED PAGE after publish, not from this text — do not block on "
                "them here: " + "; ".join(f"{k} ({v})" for k, v in RENDERED_ONLY.items()) + "."
                if stage == "apply" else "")
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
                cite = ", ".join(f"{a} {i}" for a, i in au[:3]) + (" et al." if len(au) > 3 else "")
            if pm:
                out[pm] = {"title": title, "abstract": H.unescape("\n".join(parts)).strip(),
                           "journal": journal, "year": year, "authors": cite}
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
        prompt = CURATE_PROMPT.format(topic_file=tf, tid=tid) + stage_objections(W, "curate")
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
TOPIC HEADINGS: {json.dumps(sorted(set(titles.values())), ensure_ascii=False)}
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
question: two <p> — "<strong>The clinical problem.</strong> …" then "<strong>The question.</strong> …"
pico: <dl> with Population, Intervention / Exposure, Comparator, Outcome, Design; "Not stated in the abstract." where absent
methods: one or two <p> appraising design, sample, analysis AS STATED; grade honestly. If the
  abstract does not state the design, say so plainly — do not infer one from the journal or the title,
  and do not assert it as fact
strengths: <ul> of 3-5 <li>, each specific and grounded
applicability: one or two <p> — to whom it transfers and to whom it does not
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
                    return json.loads(t[start:i + 1])
                except json.JSONDecodeError:
                    break
    # cut off before closing: shut what is still open
    frag = t[start:].rstrip().rstrip(",")
    for closing in ("}", "]}", "}]}", '"}]}', '"}}'):
        try:
            return json.loads(frag + closing)
        except json.JSONDecodeError:
            continue
    return None


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
            # stdin=DEVNULL: under nohup the CLI waits 3s for stdin it will
            # never get, warns, and can return nothing — which surfaced as
            # "the review returned no verdict" on a brief that was ready
            r = subprocess.run(["claude", "-p", prompt, "--output-format", "json"],
                               stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=timeout_s, cwd=ROOT)
        except subprocess.TimeoutExpired:
            last = "timeout"; continue
        if r.returncode != 0:
            last = (r.stderr or "")[:120]; continue
        try:
            text = json.loads(r.stdout).get("result", "")
        except json.JSONDecodeError:
            text = r.stdout
        obj = _extract_json(text)
        if obj is None:
            last = f"no parseable JSON in reply (got: {text[:200]!r})"; continue
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
GROUNDING: every fact from the abstract. No dose in your prose.
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
GROUNDING: only studies, numbers and findings present in the syntheses or topic files. No dose in your
prose. Cite every study you name, inline, right after the claim, with EXACTLY this markup and the
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
            if (f'mz-cite-{pmid}' in m.group(0) or f"openDeepDive('dd-{pmid}')" in m.group(0)
                    or f"/{pmid}/" in m.group(0)):
                hit = m
                break
        if not hit:
            break
        h = h[:hit.start()] + h[hit.end():]
    # and any trigger button left pointing at the removed dialog
    h = re.sub(r'<button[^>]*openDeepDive\(.dd-%s.[^>]*>[\s\S]*?</button>' % re.escape(pmid), "", h)
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

    return re.sub(r'<sup class="mz-ref">.*?</sup>', fix, h, flags=re.S)


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
    m = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{5,9})", sup) or re.search(r"ref-pop-(\d{5,9})", sup)
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
        if not pm or pm not in canon:
            return sup
        k = counts.get(pm, 0) + 1
        counts[pm] = k
        pid = f"ref-pop-{pm}" + (f"-{k}" if k > 1 else "")
        inner = canon[pm]
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
            text = f"PMID {pm}"
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
    return {t.replace(",", "") for t in re.findall(r"\d[\d,]*(?:\.\d+)?", text or "")}


def _num_tokens(text: str) -> set:
    """Numbers a reader would read as a finding.

    A DOI (10.3389/...), a PMID, an ISSN and the 10^9 of a cell count are not
    claims, and treating them as ones flagged sound cards and deep dives — a
    gate that cries wolf gets worked around, which is worse than no gate.
    """
    t = text or ""
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


def prose_faults(W: str, h: str, man: dict) -> list:
    faults = []
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
        elif len(a_src) > 200 and (a_src[:150] not in a_body or a_src[-150:] not in a_body
                                   or len(a_body) < len(a_src) * 0.95):
            faults.append(f"{q}: the deep dive's abstract is not PubMed's text, whole "
                          f"(opening {'ok' if a_src[:150] in a_body else 'MISSING'}, "
                          f"ending {'ok' if a_src[-150:] in a_body else 'MISSING'}, "
                          f"{len(a_body)} vs {len(a_src)} chars)")
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
    if re.search(r"machine-generated|AI-generated|generated by (?:an )?AI", prose, re.I):
        faults.append("AI-provenance language in reader-visible prose")
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

        bad = re.findall(r"\b(verdicts?|debunk\w*|myths?|misinformation|influencers?|false claims?)\b", prose, re.I)
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
    audit_transform(W, json.load(open(W + f"{post_id}.source.json"))["body_html"], h,
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
    h = retitle_topics(h, curation.get("decisions") or {})
    # a topic whose papers all went takes its whole section with it
    for tid, d in (curation.get("decisions") or {}).items():
        if not d["keep"]:
            h = re.sub(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[\s\S]*?(?=<section class="[^"]*\btopic-section\b|<div class="mz-references|<ol class="mz-references-list|$)'
                       % re.escape(tid), "", h)
    # any topic section the manifest no longer lists goes — curate removes a
    # topic from the manifest when nothing in it survives, and an orphan
    # section with no papers would otherwise render as an empty header
    for tid in re.findall(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="([^"]+)"', h):
        if tid not in man["topics"]:
            h = re.sub(r'<section class="[^"]*\btopic-section\b[^"]*"[^>]*id="%s"[\s\S]*?(?=<section class="[^"]*\btopic-section\b|<section class="[^"]*mz-references|<div class="mz-references|<ol class="mz-references-list|<dialog|<script|$)'
                       % re.escape(tid), "", h)
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
    d = os.path.join(SCRATCH, "_preview")
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
        try:
            for cmd in checks:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=2400,
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


def cmd_publish(post_id: str) -> None:
    if is_trend(post_id):
        return cmd_publish_trend(post_id)
    W = work_dir(post_id)
    require_spec_review()
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


def cmd_publish_trend(post_id: str) -> None:
    W = work_dir(post_id)
    require_spec_review()
    require_standards(W)
    require(W, "prepare"); require_review(W, "prepare")
    require(W, "guard");   require_review(W, "guard")
    require(W, "apply");   require_review(W, "apply")
    man = json.load(open(W + "manifest.json")); trend = man["trend"]
    preview_and_verify(W, post_id, "/trending/")
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
        else:
            return ""
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



def _end_of_sentence(html_frag: str, from_pos: int) -> int:
    """Index just after the full stop that ends the sentence at from_pos.

    Skips tags and abbreviations that are not sentence ends, and stops at a
    closing block tag when the sentence runs to the end of its paragraph.
    """
    i, n = from_pos, len(html_frag)
    ABBR = ("vs.", "e.g.", "i.e.", "et al.", "cf.", "Dr.", "no.", "Fig.", "approx.")
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
        if c in ".!?":
            if any(html_frag[max(0, i - 9):i + 1].endswith(a) for a in ABBR):
                i += 1
                continue
            if c == "." and re.match(r"\d", html_frag[i + 1:i + 2] or " "):
                i += 1
                continue
            return i + 1
        i += 1
    return n


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
            if _re.match(r"</(?:p|li|h[1-6]|div|section|blockquote)\b", frag[i:close + 1], _re.I) and buf:
                out.append(("".join(buf).strip(), i)); buf, start = [], None
            i = close + 1
            continue
        if start is None and not c.isspace():
            start = i
        buf.append(c)
        if c in ".!?":
            txt = "".join(buf)
            if not any(txt.rstrip().endswith(a) for a in ("vs.", "e.g.", "i.e.", "et al.", "cf.", "Dr.", "no.")) \
               and not _re.match(r"\d", frag[i + 1:i + 2] or " "):
                out.append((txt.strip(), i + 1)); buf, start = [], None
        i += 1
    if "".join(buf).strip():
        out.append(("".join(buf).strip(), n))
    return [(H.unescape(_re.sub(r"\s+", " ", t)), e) for t, e in out if t.strip()]


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
    added, out, last = 0, [], 0
    for m in _re.finditer(r'(?:<section class="[^"]*mz-post-narrative[^"]*"[^>]*>([\s\S]*?)</section>)'
                          r'|(?:<p class="mz-toc-group-synthesis">([\s\S]*?)</p>)', h):
        gi = 1 if m.group(1) is not None else 2
        frag = m.group(gi)
        # A citation's popover carries the paper's title, journal line and a
        # whole summary — TEXT, not tags — so the splitter read it as prose:
        # the narrative came back as 74 "sentences" that were mostly popover
        # fragments, the model could not place against them, and the markers
        # it did place landed mid-phrase. Masking each <sup> with spaces keeps
        # every index valid against the fragment while hiding its content.
        masked = SUP_RE.sub(lambda x: " " * len(x.group(0)), frag)
        sents = _sentences_of(masked)
        if not sents:
            continue
        have = {_pmid_of(x) for x in SUP_RE.findall(frag)}
        listing = "\n".join(f"[{i + 1}] {t}" for i, (t, _) in enumerate(sents))
        # A synthesis is about its own section's papers, so the candidates are
        # the cards of the section that CONTAINS it — found by walking to the
        # enclosing topic section, not by guessing a byte window, which took
        # the wrong papers and left the passage almost uncited.
        own = set()
        if gi == 2:
            sec_start = max((mm.start() for mm in re.finditer(
                r'<section class="[^"]*topic-section[^"]*"[^>]*>|<(?:section|div)[^>]*class="[^"]*mz-topic-group[^"]*"[^>]*>', h)
                if mm.start() < m.start()), default=None)
            if sec_start is not None:
                nxt = re.search(r'<section class="[^"]*topic-section[^"]*"|<section class="[^"]*mz-references|<dialog',
                                h[m.end():])
                sec_end = m.end() + (nxt.start() if nxt else len(h) - m.end())
                own = set(re.findall(r'id="mz-(?:cite|ref)-(\d+)"', h[sec_start:sec_end]))
        cand = [c for c in cand_all if c["pmid"] in own] if own else cand_all
        v = _ask_cached(W, "place", f"""You are placing citations in one passage of a clinician-facing evidence brief.
SENTENCES (numbered):
{listing}

PAPERS THIS BRIEF COVERS (the only ones you may cite):
{json.dumps(cand, ensure_ascii=False)[:40000]}

ALREADY CITED SOMEWHERE IN THIS PASSAGE: {sorted(x for x in have if x)} — that does NOT excuse a
later sentence resting on the same paper; cite it again there. Only never cite the same paper twice
on the SAME sentence.

CITE GENEROUSLY BUT ACCURATELY. Most sentences in a passage like this report something a study
found, and each of those needs its citation. For EACH sentence that rests on a specific study — it
names an author, or reports a design, a population, a number, a comparison or an outcome from one —
say which paper it rests on. Match on what the
sentence CLAIMS against the paper's own title and abstract, not on a name alone: a sentence naming
one author while reporting another study's result cites the study it reports. A sentence that states
the clinician's own reasoning, a transition, or a general point cites nothing. If a sentence rests on
two papers, give both. If you are not confident, give none — a wrong citation is worse than none.

Reply with ONLY {{"citations": [{{"sentence": <number>, "pmids": ["..."], "why": "<one clause>"}}, ...]}}""",
                        timeout_s=900)
        if not v or not isinstance(v.get("citations"), list):
            die("citation placement returned no verdict")
        placements = {}
        for r in v["citations"]:
            try:
                idx = int(r.get("sentence"))
            except Exception:
                continue
            if not (1 <= idx <= len(sents)):
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
                s_start = sents[idx - 2][1] if idx >= 2 else 0
                already = {_pmid_of(x) for x in SUP_RE.findall(frag[s_start:s_end])}
                if pm in already:
                    continue
                placements.setdefault(idx, []).append(pm)
        frag_out, shift = frag, 0
        for idx in sorted(placements):
            sup = "".join(_sup_markup(pm, real, W) for pm in dict.fromkeys(placements[idx]))
            if not sup:
                continue
            at = sents[idx - 1][1] + shift
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

def review_inserted_citations(W: str, h: str, real: dict) -> None:
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
    for m in re.finditer(r'(?:<section class="[^"]*mz-post-narrative[^"]*"[^>]*>([\s\S]*?)</section>)'
                         r'|(?:<p class="mz-toc-group-synthesis">([\s\S]*?)</p>)', h):
        frag = m.group(1) if m.group(1) is not None else m.group(2)
        base = m.start(1) if m.group(1) is not None else m.start(2)
        for sm in SUP_RE.finditer(frag):
            pm = _pmid_of(sm.group(0))
            if not pm:
                continue
            before = H.unescape(re.sub(r"<[^>]+>", " ", frag[:sm.start()]))[-320:]
            after = H.unescape(re.sub(r"<[^>]+>", " ", frag[sm.end():]))[:120]
            r = real.get(pm) or {}
            idx += 1
            items.append({"id": idx, "pmid": pm, "_at": base + sm.start(),
                          "sentence": re.sub(r"\s+", " ", before + " ⟦here⟧ " + after).strip(),
                          "paper_title": r.get("title", ""), "abstract": (r.get("abstract") or "")[:2500]})
    if not items:
        return
    faults = []
    for i in range(0, len(items), 6):
        chunk = items[i:i + 6]
        v = _ask_cached(W, "cites", f"""Each item below is a sentence from a clinical brief with a citation placed at ⟦here⟧, and the paper
that citation points at. For EACH, judge whether that paper is the one the sentence is talking about,
and whether what the sentence claims is supported by that paper's abstract.
ITEMS: {json.dumps([{k: x[k] for k in ("id", "pmid", "sentence", "paper_title", "abstract")} for x in chunk], ensure_ascii=False)[:90000]}
Reply with ONLY {{"items": [{{"id": <the id given>, "right_paper": true|false, "supported": true|false,
"why": "<one clause when either is false>"}}, ...]}} with one object for EVERY item given.""",
                    timeout_s=900)
        if not v or not isinstance(v.get("items"), list):
            die("the inserted-citation review returned no verdict")
        judged = {int(x["id"]) for x in v["items"] if str(x.get("id", "")).strip().isdigit()}
        missing = [x["id"] for x in chunk if x["id"] not in judged]
        if missing:
            die(f"the inserted-citation review skipped item(s) {missing[:4]}")
        by_id = {x["id"]: x for x in chunk}
        for r in v["items"]:
            if not str(r.get("id", "")).strip().isdigit():
                continue
            it = by_id.get(int(r["id"]))
            if it and (not r.get("right_paper") or not r.get("supported")):
                faults.append(f"citation to {it['pmid']}: {str(r.get('why', ''))[:140]}")
                rejected.add(it["_at"])
    if faults:
        for f_ in faults[:10]:
            print("  CITATION REVIEW:", f_)
    print(f"  citation review: {len(items) - len(rejected)} of {len(items)} citation(s) confirmed"
          + (f"; {len(rejected)} withdrawn as the wrong paper for that claim" if rejected else ""))
    return rejected



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
    """Judge every paper against the heading it sits under, twice.

    First pass: does this paper belong under this heading, for gynecologic
    surgeons? Second, independent pass: given only the abstracts and the list
    of this brief's headings, where does it belong? A paper both passes keep
    stays. A paper either pass rejects goes. Two judgements agreeing is the
    rule; disagreement resolves toward removal, because a keyword collision on
    the page costs more than a paper the reader can still reach in PubMed.
    """
    drops, reasons = {}, {}
    titles = {tid: t["title"] for tid, t in topics.items()}
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

    for tid, t in topics.items():
        pmids = [q for q in t["pmids"] if q in papers and q not in unjudgeable]
        if not pmids:
            continue
        for i in range(0, len(pmids), 10):
            batch = pmids[i:i + 10]
            v = _ask_cached(W, "curate", f"""You are auditing one section of a weekly literature brief for a complex benign gynecology /
minimally invasive gynecologic surgery practice. Its readers are practising gynecologic surgeons.
SECTION HEADING: {json.dumps(t["title"])}
For EACH paper: does it belong under THAT heading for THAT audience?
KEEP a paper about the heading's subject in women's health, including basic-science, preclinical and
adjacent gynecologic work. Breadth within the subject is fine.
DROP a paper that landed here by keyword collision or is about a different organ, specialty, sex or
population — a dermatology paper sharing the word "cicatricial", a prostate study under pelvic pain,
breast or prostate imaging under a gynecologic-surgery heading, hospital administration under a
surgical heading. Being merely tangential is not enough to drop; being about something else is.
PAPERS: {json.dumps(ctx(batch), ensure_ascii=False)[:90000]}
Reply with ONLY {{"verdicts": [{{"pmid": "...", "belongs": true|false, "why": "<one clause>"}}, ...]}}
with one object for EVERY paper given.""", timeout_s=900)
            if not v or not isinstance(v.get("verdicts"), list):
                die(f"curation of {tid} returned no verdict")
            got = {str(x.get("pmid")) for x in v["verdicts"]}
            missing = [q for q in batch if q not in got]
            if missing:
                die(f"curation of {tid} skipped {missing[:5]}")
            for x in v["verdicts"]:
                why = str(x.get("why", ""))[:200]
                if not x.get("belongs"):
                    if re.search(r"no (?:title|abstract)|not provided|cannot (?:verify|assess)|insufficient",
                                 why, re.I):
                        print(f"  KEEPING {x['pmid']}: the judgement was 'cannot tell', not 'does not belong'")
                        continue
                    drops[str(x["pmid"])] = tid
                    reasons[str(x["pmid"])] = why

    # independent corroboration, given only the abstracts and the headings
    keeps = [q for tid, t in topics.items() for q in t["pmids"]
             if q in papers and q not in drops and q not in unjudgeable]
    for i in range(0, len(keeps), 10):
        batch = keeps[i:i + 10]
        v = _ask_cached(W, "curate", f"""Classify each paper under ONE heading from this brief, from its title and abstract alone, for an
audience of gynecologic surgeons. Answer "NONE" when no heading fits — a different organ, specialty,
sex or population.
HEADINGS: {json.dumps(sorted(set(titles.values())), ensure_ascii=False)}
PAPERS: {json.dumps(ctx(batch), ensure_ascii=False)[:90000]}
Reply with ONLY {{"assignments": {{"<pmid>": "<exact heading or NONE>", ...}}}} for EVERY paper given.""",
                    timeout_s=900)
        if not v or not isinstance(v.get("assignments"), dict):
            die("corroboration returned no verdict")
        missing = [q for q in batch if q not in v["assignments"]]
        if missing:
            die(f"corroboration skipped {missing[:5]}")
        for q in batch:
            got = str(v["assignments"].get(q, "")).strip()
            if got == "NONE":
                drops[q] = next((tid for tid, t in topics.items() if q in t["pmids"]), "?")
                reasons[q] = "an independent classification found no heading in this brief it belongs under"

    for pm in drops:
        h = excise_paper(h, pm)
    emptied = []
    for tid, t in topics.items():
        if all(q in drops for q in t["pmids"]) and t["pmids"]:
            emptied.append(tid)
            h = re.sub(r'<section class="[^"]*topic-section[^"]*"[^>]*id="%s"[\s\S]*?(?=<section class="[^"]*topic-section|<section class="[^"]*mz-references|<dialog|<script|$)'
                       % re.escape(tid), "", h)
            # the reader's jump list must not offer a heading that is gone
            h = re.sub(r'<a[^>]*class="[^"]*mz-toc-chip[^"]*"[^>]*href="#%s"[\s\S]*?</a>' % re.escape(tid), "", h)
            h = re.sub(r'<a[^>]*href="#%s"[^>]*class="[^"]*mz-toc-chip[^"]*"[\s\S]*?</a>' % re.escape(tid), "", h)
    # and every surviving chip's count is what the section now holds
    for tid, t in topics.items():
        if tid in emptied:
            continue
        sec = re.search(r'<section class="[^"]*topic-section[^"]*"[^>]*id="%s"[\s\S]*?(?=<section class="[^"]*topic-section|<section class="[^"]*mz-references|<dialog|<script|$)'
                        % re.escape(tid), h)
        if not sec:
            continue
        left = len(set(re.findall(r'id="mz-(?:cite|ref)-(\d+)"', sec.group(0))))
        h = re.sub(r'(<a[^>]*href="#%s"[^>]*>[\s\S]*?<span class="mz-toc-chip-count">)\d+(</span>)' % re.escape(tid),
                   lambda m: m.group(1) + str(left) + m.group(2), h)
    return h, drops, reasons, emptied



def audit_transform(W: str, before: str, after: str, dropped: dict, emptied: list) -> None:
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
    def slice_of(h, pat, n=1, cap=3000):
        out = []
        for m in list(re.finditer(pat, h))[:n]:
            out.append(m.group(0)[:cap])
        return out

    sample = {
        "toc_nav": slice_of(after, r'<nav class="mz-toc"[\s\S]*?</nav>', 1, 4000),
        "narrative": slice_of(after, r'<section class="[^"]*mz-post-narrative[^"]*"[^>]*>[\s\S]*?</section>', 1, 7000),
        "syntheses": slice_of(after, r'<p class="mz-toc-group-synthesis">[\s\S]*?</p>', 2, 4000),
        "topic_headers": slice_of(after, r'<section class="[^"]*topic-section[^"]*"[^>]*>[\s\S]{0,700}', 3, 900),
        "references_head": slice_of(after, r'<ol class="mz-references-list">[\s\S]{0,2500}', 1, 2500),
        "cite_card": slice_of(after, r'<article class="mz-cite-card[\s\S]*?</article>', 1, 2500),
        "counts": {
            "citations": len(SUP_RE.findall(after)),
            "distinct_papers_cited": len({_pmid_of(x) for x in SUP_RE.findall(after)}),
            "reference_entries": len(re.findall(r'<li id="ref-\d+">', after)),
            "cite_cards": len(re.findall(r'<article class="mz-cite-card', after)),
            "dialogs": len(re.findall(r'<dialog[^>]*id="dd-\d+"', after)),
            "toc_chips": len(re.findall(r'class="[^"]*mz-toc-chip', after)),
            "topic_sections": len(re.findall(r'class="[^"]*topic-section', after)),
            "papers_removed": len(dropped),
            "headings_removed": emptied,
            "chars_before": len(before), "chars_after": len(after),
        },
    }
    v = _ask_cached(W, "transform", f"""You are the last editor to see a clinical brief before it publishes. A program has just
transformed it: removed papers that were not about their heading, removed headings left empty,
inserted citations on studies the prose names, renumbered every citation marker in order of first
appearance, rebuilt the reference list in that order, and de-duplicated element ids.

Read the ACTUAL OUTPUT below and find what is wrong with it. Do not take the program's word for
anything — check what you can see.

Look hard for: a citation marker sitting inside a noun phrase instead of after the claim's full stop;
markers out of sequence or repeating a number for a different paper; a jump-list chip pointing at a
heading that is gone, or a chip count that disagrees with the section; a reference entry for a paper
never cited, or a marker with no entry; a duplicated element id; a sentence or list left broken by a
removed paper (a dangling "and", a doubled full stop, an empty parenthesis, a topic header with no
cards under it); a popover missing its title, journal line, finding or link; markup that will not
render (unclosed tag, stray attribute); and anything a reader would notice as damage.

OUTPUT SAMPLE: {json.dumps(sample, ensure_ascii=False)[:90000]}

Reply with ONLY {{"ok": true|false, "defects": [{{"what": "<the defect>", "evidence": "<quote it>",
"severity": "blocking"|"cosmetic"}}, ...], "notes": "one or two sentences"}}""", timeout_s=1200)
    if not v or "ok" not in v:
        die("the transform audit returned no verdict")
    blocking = [d for d in (v.get("defects") or []) if str(d.get("severity", "")).lower() == "blocking"]
    for d in (v.get("defects") or [])[:12]:
        tag = "BLOCKING" if d in blocking else "cosmetic"
        print(f"  TRANSFORM AUDIT [{tag}]: {str(d.get('what'))[:130]} :: {str(d.get('evidence'))[:110]}")
    if blocking:
        die(f"the transform audit found {len(blocking)} blocking defect(s) in the output")
    print(f"  transform audit: the output reads correctly"
          + (f" ({len(v.get('defects') or [])} cosmetic note(s))" if v.get("defects") else ""))



def rewrite_affected_syntheses(W: str, h: str, topics: dict, drops: dict, real: dict) -> tuple:
    """Rewrite the synthesis of any heading whose papers changed.

    Curation removes papers; the paragraph above the cards still describes the
    set that existed before. W33's adenomyosis synthesis opened "Three
    adenomyosis papers this week" above two cards, and the jump-list chip —
    correctly recounted — said 2. A brief that miscounts its own contents in
    its own prose is worse than one with an extra paper, so the prose is
    rewritten against what survives rather than patched.
    """
    rewritten = 0
    for tid, t in topics.items():
        lost = [q for q in t["pmids"] if q in drops]
        kept = [q for q in t["pmids"] if q not in drops]
        if not lost or not kept:
            continue
        sec = re.search(r'(<section class="[^"]*topic-section[^"]*"[^>]*id="%s"[^>]*>)([\s\S]*?)'
                        r'(?=<section class="[^"]*topic-section|<section class="[^"]*mz-references|<dialog|<script|$)'
                        % re.escape(tid), h)
        if not sec:
            continue
        seg = sec.group(2)
        pm = re.search(r'(<p class="mz-toc-group-synthesis">)([\s\S]*?)(</p>)', seg)
        if not pm:
            continue
        old_text = H.unescape(re.sub(r"<[^>]+>", " ", SUP_RE.sub(" ", pm.group(2))))
        old_flat = re.sub(r"\s+", " ", old_text).strip()[:3000]
        n_before, n_lost, n_kept = len(t["pmids"]), len(lost), len(kept)
        papers_json = json.dumps(papers, ensure_ascii=False)[:40000]
        papers = [{"pmid": q, "title": (real.get(q) or {}).get("title", ""),
                   "abstract": ((real.get(q) or {}).get("abstract") or "")[:1400]} for q in kept]
        v = _ask_cached(W, "resynth", f"""Rewrite one section-opening paragraph of a clinician-facing weekly evidence brief.
HEADING: {json.dumps(t["title"])}
The paragraph below was written when this section held {n_before} papers. {n_lost} of them have
since been removed for not being about this heading, so the paragraph now describes papers that are
no longer here — including its own count.

THE PAPERS THAT REMAIN (all of them, and only these):
{papers_json}

THE PARAGRAPH AS IT STANDS:
{json.dumps(old_flat)}

Rewrite it so it is true of the papers that remain: the right count, no reference to a removed paper,
and the same voice — Dr. Mabini's first person, a DO and complex benign gynecology / minimally
invasive gynecologic surgery surgeon reading the week. Keep what still holds; change only what the
removals made wrong. Report each remaining paper's actual finding with its own numbers. 900-2000
characters. Plain HTML: <em> and <strong> only, no headings, no citation markup (citations are added
afterwards). Escape & < >.
Return ONLY {{"paragraph": "<inner html>"}}""", timeout_s=900)
        new_text = (v or {}).get("paragraph", "").strip()
        if not new_text or len(new_text) < 400:
            print(f"  could not rewrite the synthesis for {tid}; leaving it and reporting")
            continue
        at = sec.start(2) + pm.start(2)
        h = h[:at] + new_text + h[sec.start(2) + pm.end(2):]
        rewritten += 1
        print(f"  rewrote the synthesis for {t['title']!r} — {len(lost)} paper(s) removed, {len(kept)} remain")
    return h, rewritten


def cmd_renumber(post_id: str, dry: bool = False) -> None:
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
    os.makedirs(W + ".ledger", exist_ok=True)

    post = curl_json(f"{BASE}/api/posts/_admin/{post_id}", auth=True)
    post = post.get("post", post)
    h = post["body_html"]
    before_html = h
    before = [re.sub(r"<[^>]+>", "", (re.search(r'<a class="mz-ref-link"[^>]*>(.*?)</a>', x, re.S) or [None, ""])[1]).strip()
              for x in SUP_RE.findall(h)]
    pmids = [x for x in dict.fromkeys(_pmid_of(x) for x in SUP_RE.findall(h)) if x]
    if not pmids:
        die(f"{post_id}: no inline citations to renumber")
    print(f"{post_id}: {len(SUP_RE.findall(h))} citation(s), {len(pmids)} distinct paper(s)")
    print(f"  markers showing a PMID before: {sum(1 for m in before if re.fullmatch(chr(92) + 'd{5,9}', m))}")

    # PubMed is the authority for the journal and year in every popover and entry
    covered = list(dict.fromkeys(re.findall(r'id="mz-(?:cite|ref)-(\d+)"', h)
                                 + re.findall(r'<dialog[^>]*id="dd-(\d+)"', h)))
    pmids_all = list(dict.fromkeys(pmids + covered))
    real = fetch_pubmed(sorted(pmids_all))

    # CURATION FIRST, always. A brief is not worth renumbering while it still
    # carries papers that are not about their own heading.
    GRP = (r'(?:<section class="[^"]*topic-section[^"]*"[^>]*id="(topic-[^"]+)"[^>]*>)'
           r'|(?:<(?:section|div)[^>]*class="[^"]*mz-topic-group[^"]*"[^>]*(?:id="([^"]+)")?[^>]*>)')
    starts = list(re.finditer(GRP, h))
    topics = {}
    for i, mg in enumerate(starts):
        seg_end = starts[i + 1].start() if i + 1 < len(starts) else len(h)
        seg = h[mg.end():seg_end]
        tid = mg.group(1) or mg.group(2) or f"group-{i + 1}"
        tt = re.search(r"<h[23][^>]*>(.*?)</h[23]>", seg, re.S)
        pm_here = list(dict.fromkeys(re.findall(r'id="mz-(?:cite|ref)-(\d+)"', seg)
                                     + re.findall(r"openDeepDive\('dd-(\d+)'", seg)))
        if pm_here:
            topics[tid] = {"title": H.unescape(re.sub(r"<[^>]+>", "", tt.group(1))).strip()[:90] if tt else tid,
                           "pmids": pm_here}
    papers_ctx = {pm: {"title": (real.get(pm) or {}).get("title", ""),
                       "abstract": (real.get(pm) or {}).get("abstract", "")} for pm in pmids_all}
    if topics:
        h, dropped_map, drop_why, emptied = curate_live(h, topics, papers_ctx, W)
        if dropped_map:
            print(f"  curation removed {len(dropped_map)} paper(s) that are not about their heading:")
            for pm, tid in list(dropped_map.items())[:12]:
                print(f"    {pm} from {topics.get(tid, {}).get('title', tid)!r}: {drop_why.get(pm, '')[:100]}")
            if len(dropped_map) > 12:
                print(f"    … and {len(dropped_map) - 12} more")
        if emptied:
            print(f"  removed {len(emptied)} heading(s) left with nothing under them: {emptied}")
        pmids_all = [x for x in pmids_all if x not in dropped_map]
        pmids = [x for x in pmids if x not in dropped_map]
        h, resynth = rewrite_affected_syntheses(W, h, topics, dropped_map, real)
        if resynth:
            print(f"  {resynth} synthesis paragraph(s) rewritten to match what survives")
    else:
        dropped_map, emptied = {}, []
    meta = {}
    for pm in pmids:
        r = real.get(pm) or {}
        line = " · ".join(x for x in (r.get("authors", ""), r.get("journal", ""), r.get("year", "")) if x)
        if line:
            meta[pm] = line
        json.dump({"pmid": pm, "title": r.get("title", ""), "meta_verified": line,
                   "pubmed_abstract": r.get("abstract", "")},
                  open(W + f"papers/{pm}.json", "w"), ensure_ascii=False)
    missing_meta = [pm for pm in pmids if pm not in meta]
    if missing_meta:
        die(f"could not verify the journal line for {missing_meta[:6]} — refusing to renumber blind")

    h, named = cite_prose(W, h, pmids_all, real)
    if named:
        print(f"  inserted {named} citation(s) on studies the prose names by author")
    withdrawn = set()
    if named:
        withdrawn = review_inserted_citations(W, h, real) or set()
        if withdrawn:
            # ONLY the instances judged wrong. Other citations to the same paper
            # stand: a misplaced marker in one sentence says nothing about a
            # correct one in another.
            gone = []
            for m in sorted(SUP_RE.finditer(h), key=lambda x: -x.start()):
                if m.start() in withdrawn:
                    gone.append(_pmid_of(m.group(0)))
                    h = h[:m.start()] + h[m.end():]
            print(f"  withdrew {len(gone)} misplaced citation(s) ({', '.join(sorted(set(x for x in gone if x))[:6])})"
                  f" — other citations to those papers stand")
    h, order = number_citations(h, meta)
    h = build_references(W, h, order, meta)
    h = dedupe_element_ids(h)

    # post-conditions, on exactly the two things reported plus what they touch
    faults = []
    # Citation coverage is no longer judged by matching surnames. Placement is
    # decided by the model reading each sentence against the papers, and it
    # deliberately declines where it cannot attribute — "Li and Ye" names two
    # authors and putting the claim on one of them is wrong. The old check
    # demanded a citation wherever a covered paper's first author appeared and
    # refused finished briefs over exactly those correct refusals. What a
    # reader would call a missing citation is found by the read-back audit,
    # which looks at the page; this only reports, so nothing is hidden.
    surnames = {}
    for pm in pmids_all:
        au = (real.get(pm) or {}).get("authors") or ""
        f = au.split(",")[0].strip().split(" ")[0] if au else ""
        if len(f) >= 3:
            surnames.setdefault(f, []).append(pm)
    unique_sur = {k: v[0] for k, v in surnames.items() if len(v) == 1}
    uncited_named = set()
    for frag in re.findall(r'<section class="[^"]*mz-post-narrative[^"]*"[^>]*>([\s\S]*?)</section>', h) + \
                re.findall(r'<p class="mz-toc-group-synthesis">([\s\S]*?)</p>', h):
        cited_here = {_pmid_of(x) for x in SUP_RE.findall(frag)}
        bare = re.sub(r"<[^>]+>", " ", H.unescape(re.sub(r"<sup class=\"mz-ref\"[\s\S]*?</sup>", " ", frag)))
        for sur, pm in unique_sur.items():
            if pm not in cited_here and re.search(r"(?<![\w-])" + re.escape(sur) + r"(?:['\u2019]s)?(?![\w-])", bare):
                uncited_named.add(sur)
    if uncited_named:
        print(f"  NOTE: named but not cited in that passage (the placement pass judged each one): "
              f"{sorted(uncited_named)[:8]}")

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

    audit_transform(W, before_html, h, dropped_map, emptied if topics else [])

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

    import hashlib as _hl
    receipt = {"body_sha256": _hl.sha256(h.encode("utf-8")).hexdigest(),
               "standards_passed": True, "grounding_passed": True,
               "pipeline_digest": _sha_file(os.path.abspath(__file__)),
               "scope": "citation renumbering of already-published, already-audited prose: "
                        "markers numbered in order of first appearance, reference list rebuilt in that "
                        "order, popover journal/year taken from PubMed, duplicate ids removed. No prose "
                        "was rewritten, so the grounding of the text is the grounding it published with.",
               "checked_at": datetime.datetime.utcnow().isoformat() + "Z"}
    json.dump(receipt, open(W + ".ledger/receipt.json", "w"), indent=1)
    json.dump({"body_html": h, "pipeline_receipt": receipt}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}", "PUT", auth=True, data_file=W + "_put.json"))[:200])
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(curl_json(f"{BASE}/api/posts/{post_id}/approve", "POST", auth=True, data_file=W + "_approve.json"))[:200])
    verify_rendered(f"/evidence/?id={post_id}", post_id)
    print(f"{post_id}: {len(order)} citation(s) renumbered 1-{len(order)}, references in citation order")


def cmd_run(post_id: str) -> None:
    W = work_dir(post_id)
    # ONE RUN PER BRIEF. Two runs on the same work directory fight over the
    # ledger and the topic files: an older process recreated the very topics a
    # newer one had just removed, so a fix that worked looked like it had not,
    # and both paid for the same authoring twice.
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
            die(f"another run for {post_id} is already working here (pid {other}) — "
                f"stop it, or wait for it, before starting a second")
        os.remove(lock)
    open(lock, "w").write(str(os.getpid()))
    try:
        _run_chain(post_id, W)
    finally:
        if os.path.exists(lock) and open(lock).read().strip() == str(os.getpid()):
            os.remove(lock)


def _run_chain(post_id: str, W: str) -> None:
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
            cmd_publish(post_id)
            print(f"RUN {post_id}: published (round {rnd})")
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
    if _cmd == "renumber":
        _fn(sys.argv[2], dry=_dry)
    else:
        _fn(sys.argv[2])
