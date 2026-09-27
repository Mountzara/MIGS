#!/usr/bin/env python3
"""Fix a published brief from a confirmed list of findings — analysis, fix, review.

The owner's shape, after the pipeline was re-run brief by brief and each run
stopped at the next single problem: the analysis is done ONCE (two readers,
every finding quoted and located, the second reader upholding it), every
finding is fixed in one pass from the cited paper's abstract, and the fixed
brief is reviewed once against THE STANDARDS. Nothing is re-run to discover
the next problem.

  python3 scripts/fix_from_findings.py <post-id> [--findings=<confirmed.json>]

Writes <work>/fixed.html and <work>/fixed.review.json. Publishing is a
separate, explicit step (--publish) and happens only when the review passes.
"""
import json, os, re, sys, html as H
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brief_pipeline as bp

FINDINGS = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--findings=")),
                "/tmp/claude-0/-home-user-MIGS/7a2758e6-6b6d-5fff-a789-a9193d8f2863/scratchpad/readers/confirmed.json")


def quotes_of(text: str) -> list:
    """The page text a finding quotes: runs between quote marks, longest first."""
    q = re.findall(r"[\"“‘']([^\"”’']{20,400})[\"”’']", text or "")
    return sorted(dict.fromkeys(x.strip() for x in q), key=len, reverse=True)


def container_of(f: dict) -> tuple:
    """(kind, pmid) when the finding sits in a card or a deep dive."""
    t = f"{f.get('where', '')} {f.get('evidence', '')}"
    m = re.search(r"(?:dialog|deep[- ]dive|dd-)\D{0,30}?(\d{7,9})", t, re.I)
    if m:
        return "dialog", m.group(1)
    m = re.search(r"(?:card|mz-cite-)\D{0,30}?(\d{7,9})", t, re.I)
    if m:
        return "card", m.group(1)
    return None, None


def main():
    pid = sys.argv[1]
    W = os.path.join(bp.SCRATCH, "renumber", pid) + "/"
    post = bp.curl_json(f"{bp.BASE}/api/posts/{pid}"); post = post.get("post", post)
    h = post["body_html"]
    fmt = "trend" if post.get("kind") == "blog" else "weekly"
    findings = json.load(open(FINDINGS)).get(pid) or []
    pmids = sorted(set(bp._carded_pmids(h)) | {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None})
    real = bp.real_from_work(W, pmids)
    missing = [q for q in pmids if q not in real]
    if missing:
        fetched = bp.fetch_pubmed(missing)
        os.makedirs(W + "papers", exist_ok=True)
        for q, r in fetched.items():
            json.dump(bp._paper_record(q, r), open(W + f"papers/{q}.json", "w"), ensure_ascii=False)
        real = bp.real_from_work(W, pmids)
    print(f"{pid}: {len(findings)} confirmed finding(s), {len(real)} paper(s) with abstracts")

    resume = "--resume" in sys.argv and os.path.exists(W + "fixed.html")
    if resume:
        # the fixes already made (and paid for) are on disk: continue from them
        h = open(W + "fixed.html", encoding="utf-8").read()
        print("  resuming from the saved fixed page")
        findings = []
    # the mechanical fixes, in code
    h = bp.normalize_legacy_markup(h)
    h, n = bp.canonical_practice_name(h); n and print(f"  {n} practice name(s) written as CBG/MIGS")
    h, n = bp.drop_bracket_pseudo_citations(h); n and print(f"  {n} bracketed pseudo-citation(s) removed")
    if fmt == "trend" and not resume:
        h, n = bp.retire_verdict_gauge(h); n and print("  verdict gauge retired")
        h, n = bp.rebuild_pyramid_from_papers(h); n and print("  evidence pyramid rebuilt from the brief's papers")
        h, notes = bp.conform_trend_brief(W, h, real)
        for x in notes:
            print(f"  trend: {x[:150]}")

    # a finding about a section in EVERY deep dive (templated, truncated, a
    # pipeline dump) re-authors that section in all of them from the abstract
    names = {k: re.sub(r"&[a-z#0-9]+;", " ", v).split("—")[0].split("  ")[0].strip().lower() for k, v in bp.HEAD.items()}
    names.update({"findings": "key findings", "rob": "risk of bias", "methods": "methodology", "kb": "established literature",
                  "monday": "monday clinic", "equity": "equity", "strengths": "strengths", "applicability": "applicability",
                  "bottom": "bottom line", "prompts": "discussion prompts", "question": "clinical question"})
    systemic, rest = set(), []
    for f in findings:
        t = f"{f.get('what', '')} {f.get('where', '')}"
        if re.search(r"\b(?:every|all|each)\b[^.]{0,40}(?:deep[- ]?dive|dialog)|(?:six|five|four|three|seven|eight|\d+) deep dives|every dialog", t, re.I):
            keys = {k for k, nm in names.items() if nm and nm in t.lower() and k not in bp.NOT_AUTHORABLE}
            if keys:
                systemic |= keys
                continue
        rest.append(f)
    if systemic:
        print(f"  re-authoring in every deep dive: {sorted(systemic)}")
        h, n_sys = bp.author_stub_sections(W, h, real, force_keys=tuple(sorted(systemic)))
        print(f"  {n_sys} deep-dive section(s) written again from their abstracts")
    findings = rest

    # every other confirmed finding, fixed from the abstract
    prose, attributed = [], []
    for f in findings:
        what = f"{f.get('standard', '')}: {f.get('what', '')}"
        ev = f.get("evidence") or ""
        kind, pm = container_of(f)
        if kind:
            for q in quotes_of(ev)[:3]:
                attributed.append(f'[{kind}:{pm}] {what[:200]}: "{q}" ({f.get("what", "")[:200]})')
        else:
            prose.append({"what": what, "evidence": ev})
    n_att = n_pro = 0
    if attributed:
        h, n_att = bp.fix_attributed_text(W, h, attributed, real)
    if prose:
        h, n_pro = bp.repair_from_defects(W, h, prose, drop_unsupported=True)
    h, n_exp = bp.fix_invented_experience(W, h)
    n_exp and print(f"  {n_exp} sentence(s) claiming the clinician's own experience rewritten from the paper")
    h, n_abs = bp.fix_absolute_words(W, h, real)
    h, n_st = bp.author_stub_sections(W, h, real)
    h, _b = bp.cite_uncited_cards(W, h, real)
    h = bp.recount_headings(h)
    h, n_tot = bp.fix_document_totals(W, h, real)      # prose totals ("72 papers across 9 topics")
    n_tot and print(f"  {n_tot} total(s) in the prose rebuilt from what the page holds")
    h, n_cnt = bp.refresh_page_counts(h)
    n_cnt and print(f"  {n_cnt} count display(s) rebuilt from what the page holds (hero, counters, design chart)")
    meta = {q: bp._paper_record(q, r)["meta_verified"] for q, r in real.items() if bp._paper_record(q, r)["meta_verified"]}
    h, _order = bp._number_final_page(W, h, meta)
    h = bp.tidy_prose_spacing(h)
    print(f"  fixed: {n_att} card/deep-dive text(s), {n_pro} prose sentence(s), {n_abs} never/always, {n_st} empty section(s)")

    # deterministic gates before the review is paid for
    faults = bp.reader_prose_faults(h)
    open(W + "fixed.html", "w", encoding="utf-8").write(h)
    if faults:
        print("  GATE FAULTS (not reviewed):")
        for x in faults[:12]:
            print("   ", x[:200])
        sys.exit(1)

    # the review: one reader, THE STANDARDS, the fixed page
    post["body_html"] = h
    open(W + "body.applied.html", "w", encoding="utf-8").write(h)
    json.dump(post, open(W + f"{pid}.applied.json", "w"), ensure_ascii=False)
    json.dump({"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}, open(W + "manifest.json", "w"))
    os.makedirs(W + ".ledger", exist_ok=True)
    unmet = bp.standards_audit(W, pid, fatal=False)
    json.dump({"unmet": unmet}, open(W + "fixed.review.json", "w"), ensure_ascii=False, indent=1)
    if unmet:
        print(f"  REVIEW: {len(unmet)} standard(s) unmet")
        for x in unmet:
            print("   ", str(x)[:300])
        sys.exit(2)
    print("  REVIEW: every applicable standard met — ready to publish")


if __name__ == "__main__":
    main()
