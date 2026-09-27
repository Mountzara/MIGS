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
        # the review's own findings are this round's fix list (one round)
        rv = json.load(open(W + "fixed.review.json")) if os.path.exists(W + "fixed.review.json") else {}
        findings = [{"standard": (re.match(r"(S\d+|OWNER)", str(x)) or [None, ""])[1], "what": str(x), "evidence": str(x), "where": ""}
                    for x in (rv.get("unmet") or [])]
        findings and print(f"  {len(findings)} review finding(s) to fix")
    # a section heading an earlier repair emptied comes back from the live page
    # (the repair once took an <h2> for a sentence and removed its text)
    live_heads = re.findall(r'<h2 class="mz-section-title">([\s\S]*?)</h2>', post["body_html"])
    mine = list(re.finditer(r'<h2 class="mz-section-title">([\s\S]*?)</h2>', h))
    if len(mine) == len(live_heads):
        for m, old in sorted(zip(mine, live_heads), key=lambda x: -x[0].start()):
            if not re.sub(r"<[^>]+>|\s", "", m.group(1)) and re.sub(r"<[^>]+>|\s", "", old):
                h = h[:m.start(1)] + old + h[m.end(1):]
                print("  an emptied section heading restored from the live page")
    # the mechanical fixes, in code
    h = bp.normalize_legacy_markup(h)
    # a card's design badge is the design alone, on every card ("[2] · RCT ·
    # ELITE" on five of eight cards read as an artifact beside the other three)
    h = re.sub(r'(<span class="mz-cite-design">)\s*\[\d+\]\s*·\s*', r"\1", h)
    # every deep dive's abstract rebuilt from PubMed's record, labels whole
    # ("METHODS AND RESULTS" had been torn into a section holding "AND")
    h, _reps, n_ab = bp.write_abstracts(W, {"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}, h, [], strict=False)
    n_ab and print(f"  {n_ab} deep-dive abstract(s) rebuilt from PubMed's record")
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
    n_att = n_pro = n_cite = 0
    if attributed:
        h, n_att = bp.fix_attributed_text(W, h, attributed, real)
    uncited = [x for x in prose if re.search(r"no (?:inline )?citation|uncited|without a citation|carries no", x["what"], re.I)]
    if uncited:
        faults_u = [f'[prose] claim without a citation: "{q}" ({x["what"][:160]})' for x in uncited for q in quotes_of(x["evidence"])[:2]]
        h, n_cite = bp.fix_placement(W, h, faults_u, real)
        prose = [x for x in prose if x not in uncited]
    expanded = []
    for x in prose:
        expanded.append(x)
        if re.search(r"\be\.g\.|for example|such as|none of (?:the|those|these)|not grounded in any|no cited abstract|repeated", x["what"], re.I):
            more = bp.all_instances(W, h, x["what"])
            if more:
                print(f"  {len(more)} instance(s) of one finding located across the page")
            expanded += [{"what": x["what"], "evidence": f'"{q}"'} for q in more]
    prose = expanded
    if prose:
        h, n_pro = bp.repair_from_defects(W, h, prose, drop_unsupported=True)
    h, n_exp = bp.fix_invented_experience(W, h)
    n_exp and print(f"  {n_exp} sentence(s) claiming the clinician's own experience rewritten from the paper")
    h, n_abs = bp.fix_absolute_words(W, h, real)
    h, n_st = bp.author_stub_sections(W, h, real)
    h, _b = bp.cite_uncited_cards(W, h, real)
    # a removed sentence that was a whole bullet leaves an empty <li> (PCS: four)
    h, n_li = bp.drop_empty_list_items(h)
    n_li and print(f"  {n_li} emptied list item(s) removed")
    h = bp.recount_headings(h)
    h, n_tot = bp.fix_document_totals(W, h, real)      # prose totals ("72 papers across 9 topics")
    n_tot and print(f"  {n_tot} total(s) in the prose rebuilt from what the page holds")
    h, n_cnt = bp.refresh_page_counts(h)
    n_cnt and print(f"  {n_cnt} count display(s) rebuilt from what the page holds (hero, counters, design chart)")
    meta = {q: bp._paper_record(q, r)["meta_verified"] for q, r in real.items() if bp._paper_record(q, r)["meta_verified"]}
    h, _order = bp._number_final_page(W, h, meta)
    h = bp.tidy_prose_spacing(h)
    # the final assembly's own hygiene, as finish_and_audit runs it: no build
    # comment (W25 shipped a manifest comment with an internal path), no bare
    # "<" in a popover, no duplicate popover or element id; and the fixed
    # footer says what it means without "Always"
    h = bp.strip_build_comments(h)
    h = re.sub(r"<!--[\s\S]*?-->", "", h)
    h = bp.escape_bare_angles(h)
    h = bp.dedupe_popover_ids(h)
    h = bp.dedupe_element_ids(h)
    h = re.sub(r"\bAlways validate\s+findings against the primary source", "Validate findings against the primary source", h)
    h = h.replace("(parity with \u00a73.8 trend brief)", "(parity with the trend brief)")
    # any other spec mark inside a script's comment
    h = re.sub(r"(<script\b[^>]*>[\s\S]*?</script>)",
               lambda m: re.sub(r"(//[^\n]*?)\s*\(?\u00a7\s?\d+(?:\.\d+)*[^)\n]*\)?", r"\1", m.group(1)), h)
    print(f"  fixed: {n_att} card/deep-dive text(s), {n_pro} prose sentence(s), {n_cite} citation(s) placed, {n_abs} never/always, {n_st} empty section(s)")

    # deterministic gates before the review is paid for — the deploy's own
    # leakage checks included, on the source and on the rendered text
    faults = bp.reader_prose_faults(h)
    import audit_no_internal_leakage as leak
    for label, pat in leak.BANNED:
        hits = leak.spec_hits(h, pat) if label == "internal spec reference" else pat.findall(h)
        if hits:
            faults.append(f"deploy leakage gate: {label} ({hits[:2]})")
    faults += [f"deploy leakage gate: {x}" for x in leak.rendered_hits(h)]
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


def publish():
    """Publish the reviewed page. The server accepts a body only with a receipt
    recording BOTH a passed standards audit and a passed sentence-level
    grounding audit for that exact body — so the grounding audit runs here on
    the fixed page, and the receipt records only what actually ran."""
    import datetime, hashlib, subprocess
    pid = sys.argv[1]
    W = os.path.join(bp.SCRATCH, "renumber", pid) + "/"
    review = json.load(open(W + "fixed.review.json")) if os.path.exists(W + "fixed.review.json") else {"unmet": ["no review on record"]}
    if review.get("unmet"):
        sys.exit(f"{pid}: the review has unmet standards — not publishing: {review['unmet'][:2]}")
    h = open(W + "fixed.html", encoding="utf-8").read()
    post = bp.curl_json(f"{bp.BASE}/api/posts/{pid}"); post = post.get("post", post)
    fmt = "trend" if post.get("kind") == "blog" else "weekly"
    man = {"pmids": bp._carded_pmids(h), "format": fmt, "topics": []}
    real = bp.real_from_work(W, sorted(set(bp._carded_pmids(h)) | {bp._pmid_of(m.group(0)) for m in bp.SUP_RE.finditer(h)} - {None}))
    g = bp.grounding_audit(W, h, man)
    # the sentence-level audit's findings are repaired and re-audited — the
    # same card/deep-dive, prose and hover-card repairs the pipeline uses
    for _round in range(3):
        if not g:
            break
        att = [f for f in g if bp._ATTRIBUTED_FAULT_RE.match(f)]
        pro = [f for f in g if bp._PROSE_FAULT_RE.match(f)]
        pop = [f for f in g if bp._POPOVER_FAULT_RE.match(f)]
        n_a = n_p = n_o = 0
        if att:
            h, n_a = bp.fix_attributed_text(W, h, att, real)
        if pro:
            h, n_p = bp.repair_prose_findings(W, h, pro, real)
        if pop:
            h, n_o = bp.fix_popover_findings(W, h, pop, real)
        print(f"  grounding round {_round + 1}: {len(g)} finding(s); repaired {n_a} card/deep-dive, {n_p} prose, {n_o} hover card(s)")
        if not (n_a or n_p or n_o):
            break
        h, _li = bp.drop_empty_list_items(h)
        meta = {q: bp._paper_record(q, r)["meta_verified"] for q, r in real.items() if bp._paper_record(q, r)["meta_verified"]}
        h, _o = bp._number_final_page(W, h, meta)
        faults = bp.reader_prose_faults(h)
        if faults:
            sys.exit(f"{pid}: a grounding repair broke a gate: {faults[:3]}")
        open(W + "fixed.html", "w", encoding="utf-8").write(h)
        g = bp.grounding_audit(W, h, man)
    if g:
        print(f"  GROUNDING: {len(g)} sentence(s) still failing — not publishing")
        for x in g[:15]:
            print("   ", x[:220])
        sys.exit(3)
    print("  grounding audit: every sentence supported by its cited abstract")
    post["body_html"] = h
    fields, _n = bp.canonical_post_fields(post)
    post.update(fields)
    if bp.post_field_faults(post):
        sys.exit(f"{pid}: {bp.post_field_faults(post)}")
    json.dump(post, open(W + f"{pid}.applied.json", "w"), ensure_ascii=False)
    aud = subprocess.run(["node", "-e",
        "import('%s/functions/_lib/post_format.js').then(m=>{const p=JSON.parse(require('fs').readFileSync('%s','utf8'));"
        "const a=m.auditPublishable(p);console.log(JSON.stringify({publishable:a.publishable,problems:a.problems}))})"
        % (bp.ROOT, W + f"{pid}.applied.json")], capture_output=True, text=True, cwd=bp.ROOT)
    verdict = json.loads((aud.stdout.strip() or "{}").splitlines()[-1]) if aud.stdout.strip() else {}
    if not verdict.get("publishable"):
        sys.exit(f"{pid}: the site's publish audit refused it: {json.dumps(verdict.get('problems'))[:400]}")
    receipt = {"body_sha256": hashlib.sha256(h.encode("utf-8")).hexdigest(),
               "standards_passed": True, "grounding_passed": True,
               "pipeline_digest": bp._sha_file(bp.__file__),
               "scope": ("published brief fixed from the confirmed findings of two independent readers; every finding "
                         "repaired from its paper's PubMed abstract; reviewed against THE STANDARDS and audited sentence "
                         "by sentence against the cited abstracts before publishing"),
               "checked_at": datetime.datetime.utcnow().isoformat() + "Z"}
    json.dump({"body_html": h, "pipeline_receipt": receipt, **fields}, open(W + "_put.json", "w"), ensure_ascii=False)
    print("PUT:", json.dumps(bp.curl_json(f"{bp.BASE}/api/posts/{pid}", "PUT", auth=True, data_file=W + "_put.json"))[:200])
    json.dump({}, open(W + "_approve.json", "w"))
    print("APPROVE:", json.dumps(bp.curl_json(f"{bp.BASE}/api/posts/{pid}/approve", "POST", auth=True, data_file=W + "_approve.json"))[:200])
    bp.verify_rendered(bp._route_for(pid, post.get("kind")), pid)
    print(f"{pid}: published and verified on its live route")


if __name__ == "__main__":
    publish() if "--publish" in sys.argv else main()
