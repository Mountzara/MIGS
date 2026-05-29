#!/usr/bin/env python3
"""DEPRECATED — DO NOT INVOKE.

This script was a legacy education-page generator from the early-May 2026 / pre-§3.9 codification era of the MountZara content
pipeline. The MountZara codebase audit on 2026-05-26 flagged it as a
fence-off candidate because it could produce content that violates the
latest CLAUDE.md §0.4.1 / §3.7.1 / §3.8 / §3.9 / §3.10 / §3.12 hard rules
if invoked today. Canonical replacement: MIGS/education/_template/index.html (hand-edit the skeleton + run scripts/regression_audit.py --file).

If you have a reason to read this file (e.g. recover a prior render
shape, audit a pre-2026-05-26 intermediate state), open it in an editor
rather than executing it.

To restore execution, remove this guard AND ensure the file's output
passes `scripts/regression_audit.py --body-html` or `--post-json`
against the latest CLAUDE.md hard-rule set before any R2 PUT."""

import sys as _sys
_sys.stderr.write(
    "\n!! DEPRECATED LEGACY SCRIPT — refusing to run.\n"
    "!! See module docstring for the canonical replacement.\n"
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/_gen_menopause_page.py\n\n"
)
_sys.exit(2)


"""_gen_menopause_page.py — one-shot generator for /education/menopause/index.html.
§0.8.1 KB-anchored patient education page (Menopause topic synthesis, 9 ACOG/NAMS docs).
Pattern matches _gen_aub_page.py.
"""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/menopause_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/menopause_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/menopause/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "23435025",
        "label": "ACOG Practice Bulletin 141: Management of Menopausal Symptoms, Obstet Gynecol 2014",
        "what": "ACOG Practice Bulletin — systemic HT is the most effective treatment for vasomotor symptoms (~75% reduction in frequency); risk stratification by age, time since menopause, baseline CVD/breast risk.",
    },
    "ref-2": {
        "pmid": "12117397",
        "label": "Writing Group for the WHI Investigators, Risks and Benefits of Estrogen + Progestin in Healthy Postmenopausal Women, JAMA 2002",
        "what": "Women's Health Initiative (WHI) randomized trial — defined absolute risks of breast cancer, coronary events, stroke, VTE, and fracture reduction in 16,608 postmenopausal women on combined CEE + MPA.",
    },
    "ref-3": {
        "pmid": "28323976",
        "label": "Manson et al., Menopausal Hormone Therapy and Long-term All-Cause and Cause-Specific Mortality, JAMA 2017",
        "what": "WHI 18-year follow-up — no significant difference in all-cause mortality between hormone therapy and placebo for women starting HT under age 60.",
    },
    "ref-4": {
        "pmid": "36083874",
        "label": "The 2022 hormone therapy position statement of The North American Menopause Society, Menopause 2022",
        "what": "NAMS position statement — for symptomatic women under age 60 or within 10 years of menopause onset, the benefits of HT generally outweigh the risks for vasomotor symptoms, GSM, and bone protection.",
    },
    "ref-5": {
        "pmid": "37166324",
        "label": "Lederman et al., Fezolinetant for the treatment of moderate-to-severe vasomotor symptoms (SKYLIGHT 1), Lancet 2023",
        "what": "Phase 3 RCT — fezolinetant 45 mg daily (a non-hormonal NK3-receptor antagonist) reduces vasomotor symptom frequency by ~64% vs ~46% placebo at 12 weeks; FDA-approved 2023.",
    },
    "ref-6": {
        "pmid": "23736866",
        "label": "ACOG Committee Opinion 659: Use of Vaginal Estrogen in Women with Breast Cancer History, Obstet Gynecol 2016",
        "what": "ACOG guidance — low-dose vaginal estrogen for GSM in breast-cancer survivors with persistent symptoms can be considered after non-hormonal options fail, in consultation with oncology.",
    },
    "ref-7": {
        "pmid": "32852864",
        "label": "Cochrane Review: Long-term hormone therapy for perimenopausal and postmenopausal women, 2017",
        "what": "Cochrane systematic review — HT reduces hot flush frequency, GSM symptoms, and improves bone density; risks include VTE, stroke, breast cancer (with combined therapy beyond 5 years).",
    },
}

KB = {
    "ht_mgmt":     "1A3B583C-6ACE-43FE-83AD-C8E8D488D4C1",
    "gsm_brca":    "E90F5C5D-BF09-4CF8-BDF8-9BC3521F3B43",
    "bioident":    "76F293E3-EDEB-4060-8B60-8BE2F098D429",
    "osteo_mgmt":  "09631188-F7F2-42B7-8E25-203E76392742",
    "osteo_prev":  "68E4A65B-D121-4250-A203-76811F2AE5BE",
    "endo_ca":     "3E2E3FE9-BBA3-4A8D-B8D3-4A037AAF23B3",
    "sex_ca":      "B2AE05AE-F849-4339-AEFC-55D8CA9A2D56",
    "diag":        "8f8b9177-1697-4009-bd21-544917e2373d",
    "gsm_tx":      "07caa750-19cd-4fae-b0c7-032dad9f6db6",
}

ANCHORS = [
    {"claim": "Menopause median age 51 in North America; confirmed after 12 mo amenorrhea",
     "kb_doc_id": KB["ht_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Menopause occurs at median age 51 in North America",
     "page_anchor_id": "definition"},
    {"claim": "Vasomotor symptoms affect 50-82% of women; 87% have daily symptoms; 33% >10 hot flushes/day",
     "kb_doc_id": KB["ht_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Vasomotor symptoms affect 50-82% of women",
     "page_anchor_id": "vms"},
    {"claim": "Vasomotor symptom duration median 4-10.2 years",
     "kb_doc_id": KB["ht_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Vasomotor symptom duration varies widely with median 4-10.2 years",
     "page_anchor_id": "vms-duration"},
    {"claim": "Systemic HT reduces hot flush frequency by ~75% (meta-analysis) — most effective Tx",
     "kb_doc_id": KB["ht_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Systemic hormone therapy reduces hot flush frequency by 75% in meta-analysis",
     "page_anchor_id": "ht-vms"},
    {"claim": "Paroxetine 7.5 mg/d is the only FDA-approved non-hormonal SSRI option for VMS",
     "kb_doc_id": KB["ht_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Paroxetine 7.5 mg/d is the only FDA-approved nonhormonal option for vasomotor symptoms",
     "page_anchor_id": "paroxetine"},
    {"claim": "FDA-approved menopausal hormone therapy is recommended over compounded bioidentical",
     "kb_doc_id": KB["bioident"], "field": "keyPoints",
     "excerpt_first_words": "FDA-approved menopausal hormone therapy is recommended over compounded bioidentical preparations",
     "page_anchor_id": "bioidentical"},
    {"claim": "Bisphosphonates are first-line therapy for most postmenopausal patients at increased fracture risk",
     "kb_doc_id": KB["osteo_mgmt"], "field": "keyPoints",
     "excerpt_first_words": "Bisphosphonates are first-line therapy for most postmenopausal patients",
     "page_anchor_id": "bone"},
    {"claim": "GSM in breast-cancer survivors — non-hormonal first; vaginal estrogen requires oncology shared decision-making",
     "kb_doc_id": KB["gsm_brca"], "field": "keyPoints",
     "excerpt_first_words": "GSM in breast cancer survivors causes dryness, burning, irritation",
     "page_anchor_id": "gsm-brca"},
    {"claim": "Natural menopause = permanent cessation of menses, retrospectively defined after 12 mo amenorrhea (median 51.4 yr)",
     "kb_doc_id": KB["diag"], "field": "keyPoints",
     "excerpt_first_words": "Natural menopause is defined as the permanent cessation of menstrual periods",
     "page_anchor_id": "diagnosis"},
    {"claim": "GSM/vulvovaginal atrophy results from estrogen loss and long-term treatment is essential",
     "kb_doc_id": KB["gsm_tx"], "field": "keyPoints",
     "excerpt_first_words": "INTRODUCTION Vulvovaginal atrophy (VVA; also referred to as vaginal atrophy",
     "page_anchor_id": "gsm-general"},
]

MODALS_META = {
    "perimenopause-deep":  {"title": "Perimenopause &mdash; the years before"},
    "vms-deep":            {"title": "Vasomotor symptoms &mdash; the science"},
    "gsm-deep":            {"title": "Genitourinary syndrome of menopause"},
    "ht-deep":             {"title": "Hormone therapy &mdash; risks &amp; benefits in 2026"},
    "nonhormonal-deep":    {"title": "Non-hormonal options &mdash; SSRIs, gabapentin, fezolinetant"},
    "bone-deep":           {"title": "Bone health &mdash; screening + treatment"},
    "cvd-deep":            {"title": "Cardiovascular &amp; cancer risk in menopause"},
}

def fetch_abstracts():
    os.makedirs(os.path.dirname(ABSTRACTS_PATH), exist_ok=True)
    existing = json.load(open(ABSTRACTS_PATH)) if os.path.exists(ABSTRACTS_PATH) else {}
    need = [r["pmid"] for r in PMIDS.values() if r["pmid"] not in existing or len(existing.get(r["pmid"],""))<200]
    if not need:
        return existing
    print(f"Fetching {len(need)} abstracts via NCBI E-Utils...")
    for pmid in need:
        url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&rettype=abstract&retmode=text"
        r = subprocess.run(["curl","-s","-A","MountZaraDigest/1.0","--max-time","20",url], capture_output=True, text=True, timeout=30)
        existing[pmid] = r.stdout.strip()
        print(f"  {pmid}: {len(existing[pmid])} chars")
        time.sleep(0.4)
    json.dump(existing, open(ABSTRACTS_PATH,"w"))
    return existing

def cite(ref_id):
    r = PMIDS[ref_id]
    n = list(PMIDS.keys()).index(ref_id) + 1
    return (f'<sup class="mz-ref" data-r="{ref_id}" tabindex="0">'
            f'<a href="#{ref_id}">[{n}]</a>'
            f'<span class="mz-ref-pop" role="tooltip">{r["label"]} &middot; PMID {r["pmid"]}</span></sup>')

def cite_multi(*ref_ids):
    return "".join(cite(r) for r in ref_ids)

def kb_marker(idx):
    a = ANCHORS[idx]
    return f'<!-- §0.8 anchor: kb_doc_id={a["kb_doc_id"]}; field={a["field"]}; idx={idx} -->'

def hero():
    return f"""
    <header class="hero">
        <div class="eyebrow">Patient Education &middot; Menopause</div>
        <h1>Menopause &mdash; what&rsquo;s happening, what&rsquo;s normal, and what we can do.</h1>
        <p class="lede">
            Menopause is defined as 12 months without a period &mdash; <strong>not</strong> a disease, not a diagnosis to fear,
            and not a window that closes on treatment options{cite("ref-1")}{kb_marker(0)}. The median age in North America is 51,
            but the years on either side (<em>perimenopause</em> before, <em>postmenopause</em> after) carry their own
            symptom patterns and their own decisions about hormone therapy, non-hormonal options, bone health, and
            cardiovascular risk{cite("ref-4")}. This guide walks through how Dr.&nbsp;Mabini frames the conversation,
            what the modern evidence actually says about MHT in 2026 (the answer has changed substantially since the
            original WHI publication{cite("ref-2")}{cite("ref-3")}), and the full menu of treatments &mdash; from
            FDA-approved hormonal options to fezolinetant{cite("ref-5")}, paroxetine, gabapentin, vaginal estrogen,
            and bisphosphonates for bone. Every clinical claim is cited; verbatim PubMed abstracts are at the bottom.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">51<span class="unit">yr</span></div><div class="label">median age at natural menopause in North America{cite("ref-1")}{kb_marker(0)}.</div></div>
        <div class="fact"><div class="stat">50&ndash;82<span class="unit">%</span></div><div class="label">of women experience vasomotor symptoms; one-third have &gt;10 hot flushes per day{cite("ref-1")}{kb_marker(1)}.</div></div>
        <div class="fact"><div class="stat">~75<span class="unit">%</span></div><div class="label">reduction in hot flush frequency with systemic hormone therapy{cite("ref-1")}{kb_marker(3)} &mdash; the most effective treatment.</div></div>
    </section>
    """

def stages_section():
    return f"""
    <section class="section">
        <h2>The stages &mdash; perimenopause, menopause, postmenopause</h2>
        <p>Menopause is a single calendar moment &mdash; <strong>the last menstrual period</strong>. By definition it can only be diagnosed in retrospect, after 12 consecutive months without a period and without another medical cause{cite("ref-1")}{kb_marker(8)}. Everything before is perimenopause; everything after is postmenopause.</p>
        <ul class="bullets">
            <li><strong>Perimenopause</strong> &mdash; the symptomatic window that typically begins 4&ndash;8 years before the final period. Cycles become irregular, hormone levels fluctuate widely day-to-day, vasomotor symptoms begin, mood and sleep shift, and bleeding can become unpredictable in pattern, duration, and volume.</li>
            <li><strong>Menopause</strong> &mdash; the day of the final menstrual period. Median age 51.4 years in North America{cite("ref-1")}{kb_marker(8)}.</li>
            <li><strong>Early postmenopause</strong> &mdash; the first decade after menopause. The window where vasomotor symptoms peak and where the risk-benefit of hormone therapy is most favorable for symptom relief and bone protection{cite("ref-4")}.</li>
            <li><strong>Late postmenopause</strong> &mdash; beyond a decade. GSM (genitourinary syndrome of menopause) tends to worsen rather than improve, and bone and cardiovascular health become the dominant decisions.</li>
            <li><strong>Premature menopause (&lt;40)</strong> and <strong>early menopause (40&ndash;45)</strong> &mdash; uncommon, separate workup, and a stronger indication for systemic hormone therapy until at least the average age of natural menopause to mitigate the bone and cardiovascular consequences of early estrogen loss.</li>
        </ul>
        <p>Labs (FSH, estradiol) are usually <strong>not</strong> needed for diagnosis in a woman in her late 40s or early 50s with classic symptoms &mdash; clinical pattern is enough. Labs are useful when the diagnosis is in question, particularly when symptoms begin under age 45 or when other endocrine causes (thyroid disease, hyperprolactinemia, premature ovarian insufficiency) need to be ruled out.</p>
    </section>
    """

def symptoms_section():
    return f"""
    <section class="section">
        <h2>What you might be feeling</h2>
        <p>Menopause is more than hot flushes &mdash; the symptom map is wide, and not every woman gets every symptom. Some women sail through with almost nothing; others find every domain affected. The patterns that bring most women in are:</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="vms-deep">
                <div class="rung-num">1</div>
                <h3>Vasomotor symptoms</h3>
                <p>Hot flushes and night sweats &mdash; the classic symptom. Median duration <strong>4&ndash;10.2 years</strong>{cite("ref-1")}{kb_marker(2)}. Treatable with hormonal or non-hormonal options.</p>
            </article>
            <article class="ladder-card" data-modal="gsm-deep">
                <div class="rung-num">2</div>
                <h3>Genitourinary symptoms (GSM)</h3>
                <p>Vaginal dryness, painful intercourse, urinary frequency, recurrent UTIs, vulvar irritation. Worsens over time without treatment{kb_marker(9)}.</p>
            </article>
            <article class="ladder-card" data-modal="ht-deep">
                <div class="rung-num">3</div>
                <h3>Sleep &amp; mood</h3>
                <p>Insomnia, early-morning waking, low mood, anxiety, brain fog. Often improves with vasomotor-symptom treatment but sometimes needs targeted therapy.</p>
            </article>
            <article class="ladder-card" data-modal="bone-deep">
                <div class="rung-num">4</div>
                <h3>Bone &amp; body composition</h3>
                <p>Accelerated bone loss in the first 5 years post-menopause. Bisphosphonates are first-line for at-risk patients{kb_marker(6)}.</p>
            </article>
            <article class="ladder-card" data-modal="cvd-deep">
                <div class="rung-num">5</div>
                <h3>Cardiovascular risk</h3>
                <p>Lipid profile shifts, blood pressure tends to rise, and the protective effect of premenopausal estrogen ends. The biggest health driver of late postmenopause.</p>
            </article>
            <article class="ladder-card" data-modal="perimenopause-deep">
                <div class="rung-num">P</div>
                <h3>Perimenopause</h3>
                <p>Irregular cycles, heavy or unpredictable bleeding, breast tenderness, migraine pattern change. The years before the final period have their own playbook.</p>
            </article>
        </div>
    </section>
    """

def treatment_overview():
    return f"""
    <section class="section">
        <h2>The treatment menu &mdash; what actually works</h2>
        <p>Menopausal symptoms have more validated treatment options than at any time in history. The choice depends on which symptoms dominate, your personal medical history (breast, cardiovascular, clotting, bone), and your preference about hormonal vs non-hormonal approaches.</p>
        <h3 style="font-size: 17px; margin-top: 20px;">For vasomotor symptoms (hot flushes &amp; night sweats)</h3>
        <ul class="bullets">
            <li><strong>Systemic estrogen therapy</strong> &mdash; the most effective treatment, reducing hot flush frequency by ~75%{cite("ref-1")}{kb_marker(3)}. Women with a uterus must add a progestogen to protect the endometrium from cancer. For women under 60 or within 10 years of menopause, benefits generally outweigh risks{cite("ref-4")}.</li>
            <li><strong>Fezolinetant (Veozah)</strong> &mdash; a non-hormonal NK3-receptor antagonist FDA-approved in 2023. Reduces VMS frequency by ~64% vs ~46% on placebo at 12 weeks{cite("ref-5")}. A good fit for women who can&rsquo;t or don&rsquo;t want hormones.</li>
            <li><strong>Paroxetine 7.5 mg/d (Brisdelle)</strong> &mdash; the only SSRI specifically FDA-approved for VMS{cite("ref-1")}{kb_marker(4)}. Other SSRIs (escitalopram, venlafaxine) work off-label.</li>
            <li><strong>Gabapentin or pregabalin</strong> &mdash; useful especially when night sweats dominate; helps sleep alongside symptom reduction.</li>
            <li><strong>Cognitive behavioral therapy</strong> &mdash; reduces the bother of hot flushes (perceived severity) even when frequency doesn&rsquo;t change. Underused.</li>
            <li><strong>Compounded bioidentical hormones</strong> are <strong>not</strong> recommended over FDA-approved preparations{kb_marker(5)} &mdash; they lack regulatory oversight and consistent dosing.</li>
        </ul>
        <h3 style="font-size: 17px; margin-top: 20px;">For genitourinary syndrome of menopause</h3>
        <ul class="bullets">
            <li><strong>Vaginal moisturizers and lubricants</strong> &mdash; non-hormonal, first-line for mild symptoms. Use moisturizers regularly (2&ndash;3x/week); lubricants only with intercourse.</li>
            <li><strong>Low-dose vaginal estrogen</strong> &mdash; safe and highly effective for moderate-to-severe GSM. Minimal systemic absorption with vaginal cream, tablet, or ring. Generally does not require progestogen.</li>
            <li><strong>Prasterone (vaginal DHEA, Intrarosa)</strong> &mdash; alternative non-estrogen vaginal hormonal option.</li>
            <li><strong>Ospemifene</strong> &mdash; oral selective estrogen receptor modulator for moderate-to-severe dyspareunia.</li>
            <li><strong>In breast-cancer survivors</strong>{kb_marker(7)} &mdash; non-hormonal options are first-line. Low-dose vaginal estrogen for refractory symptoms is considered case by case with the oncologist&rsquo;s involvement{cite("ref-6")}.</li>
        </ul>
        <h3 style="font-size: 17px; margin-top: 20px;">For bone protection</h3>
        <ul class="bullets">
            <li><strong>Calcium 1200 mg/d + vitamin D 800&ndash;1000 IU/d</strong> &mdash; the baseline for every postmenopausal woman.</li>
            <li><strong>DXA bone density</strong> &mdash; screen all women at age 65, and earlier with risk factors (low BMI, smoking, family history, early menopause, glucocorticoid use).</li>
            <li><strong>Bisphosphonates</strong> are first-line for osteoporosis and high-risk osteopenia{cite("ref-1")}{kb_marker(6)}. Drug holidays after 5 years of oral or 3 years of IV zoledronic acid.</li>
            <li><strong>Denosumab, anabolic agents (teriparatide, abaloparatide), romosozumab</strong> &mdash; reserved for higher-risk patients or treatment failure.</li>
            <li><strong>Systemic hormone therapy</strong> protects bone alongside vasomotor symptom relief &mdash; one of the favorable trade-offs in early postmenopause.</li>
        </ul>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Should I just start hormone therapy?</summary>
                <div class="qa-answer"><p>It depends. For symptomatic women under 60 or within 10 years of menopause, the modern position from NAMS is that the benefits of HT (vasomotor relief, GSM relief, bone protection) generally outweigh the risks for most healthy women{cite("ref-4")}. The original WHI findings{cite("ref-2")} were over-interpreted &mdash; subsequent long-term follow-up{cite("ref-3")} found no difference in all-cause mortality. The decision is individualized based on your symptom burden, baseline breast and cardiovascular risk, and personal preference. There&rsquo;s no &ldquo;always&rdquo; or &ldquo;never&rdquo; answer.</p></div>
            </details>
            <details class="qa"><summary>What about &ldquo;bioidentical&rdquo; hormones from a compounding pharmacy?</summary>
                <div class="qa-answer"><p>Not recommended over FDA-approved preparations{kb_marker(5)}. Compounded bioidentical hormones are unregulated, dosing varies batch-to-batch, and there&rsquo;s no rigorous safety data. Many of the same molecules (estradiol, micronized progesterone) are available in FDA-approved formulations &mdash; those are what the evidence is built on, and what we use.</p></div>
            </details>
            <details class="qa"><summary>I had breast cancer. Can I use anything?</summary>
                <div class="qa-answer"><p>Yes &mdash; the menu is smaller, but it&rsquo;s not empty. Non-hormonal options for vasomotor symptoms (fezolinetant{cite("ref-5")}, paroxetine, gabapentin, CBT) are first-line. For GSM, vaginal moisturizers and lubricants are first; if symptoms persist, low-dose vaginal estrogen can sometimes be considered after non-hormonal options have failed, in shared decision with your oncologist{cite("ref-6")}{kb_marker(7)}. Pelvic-floor physical therapy and laser-based vaginal therapies are also options for some patients.</p></div>
            </details>
            <details class="qa"><summary>I&rsquo;m only 42 and I think I&rsquo;m in menopause &mdash; is that normal?</summary>
                <div class="qa-answer"><p>It&rsquo;s less common but it happens. Menopause under age 45 is called <em>early</em>; under 40 is <em>premature</em>. Both warrant a workup to rule out other causes (premature ovarian insufficiency, autoimmune conditions, prior chemotherapy or pelvic radiation, genetic causes) and both are stronger indications for systemic hormone therapy &mdash; the bone and cardiovascular consequences of estrogen loss in the early 40s are real, so we use HT (when not contraindicated) at least until the typical age of natural menopause.</p></div>
            </details>
            <details class="qa"><summary>How long can I stay on hormone therapy?</summary>
                <div class="qa-answer"><p>There is no fixed limit. The 2022 NAMS position{cite("ref-4")} is that the duration of HT should be individualized &mdash; reassessed periodically (annually is typical), with the lowest effective dose, and continued as long as the benefits for that woman outweigh the risks. Many women who started for vasomotor symptoms in their early 50s feel best continuing through their late 50s or 60s. The categorical &ldquo;5-year limit&rdquo; that came out of the original WHI commentary is no longer the standard.</p></div>
            </details>
            <details class="qa"><summary>What about brain fog and memory issues?</summary>
                <div class="qa-answer"><p>Cognitive complaints in midlife are common and the menopause transition contributes &mdash; sleep disruption from night sweats, mood changes, and direct estrogen effects on the brain are all in play. The good news: cognitive symptoms during perimenopause are usually <strong>transient</strong> and not a marker for dementia. Treating the underlying vasomotor symptoms and sleep often resolves the cognitive complaints. Persistent or progressive memory issues deserve a full workup.</p></div>
            </details>
            <details class="qa"><summary>Will hormone therapy give me cancer?</summary>
                <div class="qa-answer"><p>It depends on which therapy, how long, and your baseline risk. Combined estrogen + progestogen therapy beyond ~5 years has a small increase in breast-cancer risk in the WHI{cite("ref-2")}. Estrogen-only therapy (after hysterectomy) does not show the same increase. Vaginal low-dose estrogen for GSM has minimal systemic absorption and is generally considered safe for breast risk. Endometrial cancer risk is the reason women with an intact uterus must take a progestogen alongside estrogen &mdash; unopposed estrogen raises endometrial-cancer risk substantially{cite("ref-1")}.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "perimenopause-deep": f"""
        <p>Perimenopause begins when the ovaries start to wind down &mdash; usually 4&ndash;8 years before the final period. The hallmark is <strong>variability</strong>: cycles shorten, then lengthen, then skip. Symptoms come and go in clusters. Hormone levels can swing day-to-day in ways that don&rsquo;t happen in either premenopause or postmenopause.</p>
        <p><strong>Bleeding changes</strong> are the most common reason women present in perimenopause. Cycles may become heavier, longer, or unpredictable. <strong>Any bleeding pattern that&rsquo;s heavy, persistent, between cycles, or after intercourse deserves evaluation</strong> &mdash; the AUB workup applies fully (see the AUB guide). Endometrial sampling is standard for women 45+ with AUB.</p>
        <p><strong>Vasomotor symptoms</strong> often start in perimenopause, sometimes years before the final period{cite("ref-1")}{kb_marker(1)}. Treatment options include the full HT and non-hormonal menu &mdash; women in perimenopause with intact ovarian function may still cycle on combined oral contraceptives (if otherwise eligible), which simultaneously regulate cycles, suppress vasomotor symptoms, and provide contraception. The transition to dedicated menopausal HT happens when contraception is no longer needed.</p>
        <p><strong>Mood, sleep, and cognitive symptoms</strong> in perimenopause are often more pronounced than in stable postmenopause &mdash; the hormone fluctuations themselves drive the symptoms. Treating the underlying vasomotor symptoms (or, if contraception is needed, low-dose combined OCP) often resolves the secondary mood and sleep issues. Persistent depression or anxiety deserves dedicated treatment alongside any hormonal approach.</p>
        <p><strong>Contraception in perimenopause</strong> &mdash; remember: fertility persists until 12 months of amenorrhea. Continue effective contraception until that threshold even if cycles have become very irregular.</p>
    """,
    "vms-deep": f"""
        <p>Vasomotor symptoms (VMS) &mdash; hot flushes and night sweats &mdash; are the classic menopause complaint. They affect <strong>50&ndash;82%</strong> of women, with about <strong>33%</strong> reporting more than 10 hot flushes per day{cite("ref-1")}{kb_marker(1)}. Median duration is <strong>4&ndash;10.2 years</strong>{kb_marker(2)}, but some women have them for 20+ years and some have almost none.</p>
        <p>The physiology: declining and fluctuating estrogen narrows the body&rsquo;s thermoregulatory neutral zone in the hypothalamus, so small changes in core temperature trigger an exaggerated heat-dissipating response &mdash; flushing, sweating, sometimes palpitations. Newer mechanistic work has identified KNDy neurons (kisspeptin, neurokinin B, dynorphin) as the relevant hypothalamic circuit, which is why <strong>NK3-receptor antagonists like fezolinetant</strong> work without touching estrogen at all{cite("ref-5")}.</p>
        <p><strong>Treatment options &mdash; in approximate order of efficacy:</strong></p>
        <ol class="ladder">
            <li><strong>Systemic estrogen.</strong> Most effective &mdash; ~75% reduction in frequency{kb_marker(3)}. Add progestogen for women with a uterus. Various routes (oral, transdermal patch, gel, spray). Transdermal route may carry lower VTE risk than oral.</li>
            <li><strong>Fezolinetant 45 mg/d.</strong> Non-hormonal, FDA-approved 2023. ~64% vs ~46% placebo reduction at 12 weeks{cite("ref-5")}. Monitor liver function. Excellent for women who can&rsquo;t take hormones.</li>
            <li><strong>Paroxetine 7.5 mg/d (Brisdelle).</strong> The only FDA-approved SSRI for VMS{kb_marker(4)}. Other SSRIs/SNRIs (escitalopram 10&ndash;20 mg, venlafaxine 37.5&ndash;150 mg, desvenlafaxine 100 mg) work off-label.</li>
            <li><strong>Gabapentin 300&ndash;900 mg at bedtime or pregabalin 75&ndash;150 mg twice daily.</strong> Helpful especially when night sweats dominate &mdash; benefits sleep at the same time.</li>
            <li><strong>Clonidine.</strong> Older agent, modest efficacy. Side-effect profile (dry mouth, dizziness, hypotension) often limits use.</li>
            <li><strong>Cognitive behavioral therapy (CBT-Meno).</strong> Reduces the perceived bother of hot flushes by helping women reframe and manage them. Combines well with any of the above.</li>
        </ol>
    """,
    "gsm-deep": f"""
        <p>Genitourinary syndrome of menopause (GSM) is the modern umbrella term for the vulvar, vaginal, and lower-urinary symptoms caused by estrogen loss{kb_marker(9)}. The old terms &mdash; &ldquo;atrophic vaginitis&rdquo;, &ldquo;vulvovaginal atrophy&rdquo; &mdash; understate the breadth of the condition.</p>
        <p><strong>Symptoms include:</strong> vaginal dryness, burning, itching, irritation; painful intercourse (dyspareunia) and post-coital bleeding from friable tissue; urinary urgency, frequency, dysuria; recurrent urinary tract infections; and atrophic-appearing exam findings (pale, thin vaginal walls, loss of rugae, narrowed introitus, urethral prolapse).</p>
        <p>Unlike vasomotor symptoms, which usually improve with time, <strong>GSM tends to worsen without treatment</strong>. Many women don&rsquo;t bring it up because they think it&rsquo;s a normal part of aging &mdash; it is treatable.</p>
        <p><strong>Treatment ladder:</strong></p>
        <ol class="ladder">
            <li><strong>Vaginal moisturizers</strong> (Replens, Hyalo-Gyn, Revaree) &mdash; non-hormonal, use 2&ndash;3 times per week regardless of intercourse. <strong>Vaginal lubricants</strong> (water-, silicone-, or oil-based) &mdash; for use only at intercourse. Both are first-line for mild symptoms.</li>
            <li><strong>Low-dose vaginal estrogen</strong> &mdash; cream (Estrace, Premarin), tablet (Vagifem, Imvexxy), or ring (Estring). Minimal systemic absorption. Highly effective for moderate-to-severe symptoms. Does not require concomitant progestogen for endometrial protection at standard low doses. Safe for long-term use.</li>
            <li><strong>Vaginal DHEA (prasterone, Intrarosa)</strong> &mdash; once-nightly insert that converts locally to estrogen and androgen. Alternative for women who prefer not to use estrogen directly.</li>
            <li><strong>Ospemifene</strong> &mdash; oral SERM for moderate-to-severe dyspareunia.</li>
            <li><strong>Pelvic-floor physical therapy</strong> &mdash; addresses the muscle component of dyspareunia (high-tone pelvic floor that develops protectively around dryness-related discomfort).</li>
        </ol>
        <p>In <strong>breast-cancer survivors</strong>, non-hormonal options are first-line. For refractory symptoms, low-dose vaginal estrogen may be considered case-by-case in shared decision-making with the oncologist{cite("ref-6")}{kb_marker(7)}.</p>
    """,
    "ht-deep": f"""
        <p>The conversation about menopausal hormone therapy has changed substantially since the original WHI publication in 2002{cite("ref-2")}, which led to a sharp population-level decline in MHT use. Subsequent re-analyses, 18-year follow-up{cite("ref-3")}, and the 2022 NAMS position statement{cite("ref-4")} have reframed the risk-benefit calculus around <strong>timing</strong> and <strong>individual baseline risk</strong>.</p>
        <p><strong>The modern position:</strong> for symptomatic women <strong>under age 60 or within 10 years of menopause onset</strong>, the benefits of hormone therapy generally outweigh the risks for vasomotor symptoms, genitourinary symptoms, and bone protection. Outside that window, the risk-benefit balance shifts unfavorably and the indication is narrower.</p>
        <p><strong>Hormone components:</strong></p>
        <ul class="bullets">
            <li><strong>Estrogen.</strong> Treats vasomotor symptoms, GSM, and protects bone. Available as oral conjugated equine estrogen, oral 17-β-estradiol, transdermal patch, transdermal gel, transdermal spray, vaginal ring (systemic dose), pellet.</li>
            <li><strong>Progestogen.</strong> Required for women with an intact uterus to protect the endometrium from estrogen-driven hyperplasia and cancer. Options include micronized progesterone (oral or vaginal), medroxyprogesterone acetate, norethindrone acetate, dydrogesterone (combined with estradiol in some preparations).</li>
        </ul>
        <p><strong>Route matters:</strong> transdermal estrogen avoids first-pass hepatic metabolism and may carry lower VTE and stroke risk than oral estrogen &mdash; often the preferred route in women with elevated VTE risk, migraine, hypertriglyceridemia, or hepatobiliary issues.</p>
        <p><strong>Risk overview from WHI and follow-up data:</strong></p>
        <ul class="bullets">
            <li><strong>Breast cancer:</strong> small absolute increase with combined estrogen + progestogen beyond ~5 years; estrogen-only after hysterectomy does not show the same increase{cite("ref-2")}.</li>
            <li><strong>VTE:</strong> increased risk with oral but not transdermal estrogen.</li>
            <li><strong>Stroke:</strong> small increase with oral estrogen; less clear with transdermal.</li>
            <li><strong>CHD:</strong> early-postmenopause initiation appears neutral or favorable; late initiation (after age 60 or &gt;10 years post-menopause) may slightly increase risk.</li>
            <li><strong>Bone:</strong> reduces hip and vertebral fracture risk.</li>
            <li><strong>All-cause mortality:</strong> no significant difference at 18 years of follow-up in WHI{cite("ref-3")}.</li>
        </ul>
        <p>The conversation Dr. Mabini has with each patient covers symptom burden, baseline breast risk (family history, prior biopsies, breast density), baseline cardiovascular risk (lipids, blood pressure, smoking, family history), bone density status, VTE history, and personal preference. There is rarely a single right answer.</p>
    """,
    "nonhormonal-deep": f"""
        <p>Non-hormonal options for menopausal symptoms have expanded substantially in the last decade, with one new FDA approval and growing evidence for established medications.</p>
        <p><strong>For vasomotor symptoms:</strong></p>
        <ul class="bullets">
            <li><strong>Fezolinetant (Veozah).</strong> Non-hormonal NK3-receptor antagonist FDA-approved 2023. 45 mg daily. ~64% vs ~46% placebo reduction in VMS frequency at 12 weeks{cite("ref-5")}. Monitor liver function. Most expensive option; coverage varies.</li>
            <li><strong>Paroxetine 7.5 mg/d (Brisdelle).</strong> The only SSRI specifically FDA-approved for VMS{kb_marker(4)}. Sub-antidepressant dose (10x lower than depression dosing). Useful when SSRI is otherwise indicated.</li>
            <li><strong>Other SSRIs/SNRIs (off-label):</strong> escitalopram 10&ndash;20 mg, venlafaxine 37.5&ndash;75 mg (sometimes 150 mg), desvenlafaxine 100 mg. Effective; useful when an antidepressant is co-indicated.</li>
            <li><strong>Gabapentin 300&ndash;900 mg at bedtime / pregabalin 75&ndash;150 mg BID.</strong> Particularly helpful when night sweats dominate &mdash; aids sleep alongside VMS reduction.</li>
            <li><strong>Cognitive behavioral therapy for menopause (CBT-Meno).</strong> Reduces the bother of hot flushes by reframing and management strategies. Combines well with any pharmacologic option. No drug interactions or side effects.</li>
        </ul>
        <p><strong>For mood symptoms:</strong> SSRIs at standard doses if depression or anxiety is present; CBT; treatment of underlying sleep disruption (a major contributor to perimenopausal mood symptoms).</p>
        <p><strong>For sleep:</strong> treat night sweats first (often resolves the sleep disruption); standard sleep hygiene; cognitive behavioral therapy for insomnia (CBT-I); short-term sleep aids when needed (avoid chronic benzodiazepine use).</p>
        <p><strong>For GSM:</strong> vaginal moisturizers, lubricants, pelvic-floor physical therapy &mdash; first-line non-hormonal approaches before considering vaginal estrogen.</p>
        <p><strong>For bone:</strong> calcium 1200 mg/d + vitamin D 800&ndash;1000 IU/d, weight-bearing exercise, strength training, fall prevention. Pharmacotherapy (bisphosphonates first-line) for those at high fracture risk{kb_marker(6)}.</p>
    """,
    "bone-deep": f"""
        <p>Postmenopausal bone loss accelerates sharply in the first 5 years after the final period because of estrogen withdrawal. <strong>Bone-protection conversations should begin in early postmenopause, not when the first fracture happens.</strong></p>
        <p><strong>Screening:</strong></p>
        <ul class="bullets">
            <li>DXA bone density at age 65 for all women.</li>
            <li>Earlier (in postmenopausal women &lt;65) if there are risk factors: BMI &lt;20 kg/m&sup2;, current smoking, family history of hip fracture, prior fragility fracture, chronic glucocorticoid use, early menopause (&lt;45), certain medications (proton pump inhibitors, anticonvulsants, aromatase inhibitors), and certain conditions (rheumatoid arthritis, celiac disease, type 1 diabetes).</li>
            <li>FRAX score &mdash; 10-year probability of major osteoporotic fracture; combines DXA T-score with clinical risk factors.</li>
        </ul>
        <p><strong>Baseline for every postmenopausal patient:</strong></p>
        <ul class="bullets">
            <li>Calcium <strong>1200 mg/day</strong> (food + supplement combined).</li>
            <li>Vitamin D <strong>800&ndash;1000 IU/day</strong>.</li>
            <li>Weight-bearing aerobic exercise + strength training 2&ndash;3x/week.</li>
            <li>Fall-prevention attention (vision check, home safety, balance/strength work).</li>
            <li>Smoking cessation; alcohol moderation.</li>
        </ul>
        <p><strong>Pharmacotherapy for osteoporosis or high-risk osteopenia:</strong></p>
        <ul class="bullets">
            <li><strong>Bisphosphonates</strong> &mdash; first-line for most patients{kb_marker(6)}. Oral alendronate, risedronate, ibandronate; or IV zoledronic acid yearly. Drug holiday after 5 years of oral therapy or 3 years of IV in low-to-moderate-risk patients.</li>
            <li><strong>Denosumab (Prolia)</strong> &mdash; subcutaneous every 6 months. Effective; <strong>requires transition to another antiresorptive if discontinued</strong> to prevent rebound fractures.</li>
            <li><strong>Anabolic agents (teriparatide, abaloparatide)</strong> &mdash; daily injection for up to 2 years for very high-risk patients or treatment failures.</li>
            <li><strong>Romosozumab</strong> &mdash; monthly injection for up to 1 year; contraindicated in patients with high cardiovascular or stroke risk.</li>
            <li><strong>Systemic estrogen / HT</strong> &mdash; protects bone alongside vasomotor symptom relief. A favorable trade-off in symptomatic early-postmenopausal women.</li>
        </ul>
    """,
    "cvd-deep": f"""
        <p>Cardiovascular disease remains the leading cause of death in women, and the menopausal transition is when many of the modifiable risk factors begin to rise.</p>
        <p><strong>What changes at menopause:</strong></p>
        <ul class="bullets">
            <li>Lipid shift &mdash; total cholesterol and LDL tend to rise; HDL may fall.</li>
            <li>Blood pressure tends to rise.</li>
            <li>Visceral adiposity increases even at stable weight.</li>
            <li>Insulin sensitivity decreases.</li>
            <li>The relative cardiovascular protection women enjoy premenopausally narrows.</li>
        </ul>
        <p><strong>The conversation Dr. Mabini has at every menopause visit covers:</strong></p>
        <ul class="bullets">
            <li>Blood pressure measurement and trend.</li>
            <li>Lipid profile (fasting if needed for treatment decisions).</li>
            <li>HbA1c if any risk factors for type 2 diabetes.</li>
            <li>Tobacco use &mdash; the highest-impact modifiable risk.</li>
            <li>Physical activity &mdash; 150+ minutes/week moderate aerobic + 2x/week strength.</li>
            <li>Diet patterns &mdash; Mediterranean-style is the most-evidenced.</li>
            <li>Family history and other cardiovascular risk modifiers.</li>
        </ul>
        <p><strong>Cancer risk in menopause:</strong></p>
        <ul class="bullets">
            <li><strong>Breast cancer:</strong> background risk rises with age. Combined HT beyond ~5 years adds a small absolute risk{cite("ref-2")}. Maintain age-appropriate screening (mammography, with cadence determined in shared decision).</li>
            <li><strong>Endometrial cancer:</strong> any postmenopausal bleeding is evaluated for endometrial pathology. Unopposed estrogen in a woman with a uterus is the major iatrogenic driver &mdash; which is why combined HT (estrogen + progestogen) is mandatory in women with an intact uterus{cite("ref-1")}.</li>
            <li><strong>Ovarian cancer:</strong> no validated routine screening tool. Symptom recognition (bloating, early satiety, pelvic/abdominal pain, urinary urgency for more than a few weeks) is the current best practice.</li>
            <li><strong>Cervical cancer:</strong> continue age-appropriate Pap/HPV screening per ASCCP guidelines unless prior hysterectomy for benign disease with no history of high-grade dysplasia.</li>
            <li><strong>Colorectal cancer:</strong> screening per USPSTF (start age 45 for average-risk).</li>
        </ul>
    """,
}

def references_section(abstracts):
    parts = ['<section class="section references-section" id="references">']
    parts.append('<h2>References</h2>')
    parts.append('<p class="ref-intro">Every clinical claim above ties to one of these peer-reviewed sources. Click any abstract to expand the verbatim PubMed record retrieved via NCBI E-Utilities.</p>')
    parts.append('<ol class="ref-list">')
    for rid, meta in PMIDS.items():
        abs_text = abstracts.get(meta["pmid"],"").strip()
        abs_html = ihtml.escape(abs_text).replace("\n","<br>") if abs_text else "<em>Abstract not retrieved.</em>"
        parts.append(f'<li id="{rid}">')
        parts.append(f'<div class="ref-label"><strong>{meta["label"]}</strong></div>')
        parts.append(f'<div class="ref-what">{meta["what"]}</div>')
        parts.append(f'<div class="ref-meta">PMID&nbsp;<a href="https://pubmed.ncbi.nlm.nih.gov/{meta["pmid"]}/" target="_blank" rel="noopener">{meta["pmid"]}</a></div>')
        if abs_text:
            parts.append(f'<details class="abstract-toggle"><summary>Read the abstract</summary><div class="abstract-body">{abs_html}</div></details>')
        parts.append('</li>')
    parts.append('</ol>')
    parts.append('</section>')
    return "\n".join(parts)

def modals_html():
    parts = ['<div id="modal-root" class="modal-root" aria-hidden="true">']
    parts.append('<div class="modal-backdrop" data-close></div>')
    parts.append('<article class="modal-frame" role="dialog" aria-modal="true" aria-labelledby="modal-title">')
    parts.append('<button class="modal-close" data-close aria-label="Close">&times;</button>')
    parts.append('<h2 id="modal-title" class="modal-title"></h2>')
    parts.append('<div id="modal-body" class="modal-body"></div>')
    parts.append('</article></div>')
    for mid, body in MODALS_CONTENT.items():
        parts.append(f'<template id="tpl-{mid}" data-title="{ihtml.escape(MODALS_META[mid]["title"])}">{body}</template>')
    return "\n".join(parts)

JS = """
<script>
(function(){
  const root = document.getElementById('modal-root');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  function openModal(mid){
    const tpl = document.getElementById('tpl-' + mid);
    if (!tpl) return;
    titleEl.innerHTML = tpl.dataset.title;
    bodyEl.innerHTML = tpl.innerHTML;
    root.classList.add('open');
    root.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(){
    root.classList.remove('open');
    root.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    bodyEl.innerHTML = '';
  }
  document.addEventListener('click', function(e){
    const opener = e.target.closest('[data-modal]');
    if (opener){ e.preventDefault(); openModal(opener.dataset.modal); return; }
    if (e.target.closest('[data-close]')){ e.preventDefault(); closeModal(); return; }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && root.classList.contains('open')) closeModal();
  });
  document.addEventListener('click', function(e){
    const ref = e.target.closest('.mz-ref');
    if (!ref){
      document.querySelectorAll('.mz-ref.mz-open').forEach(r => r.classList.remove('mz-open'));
      return;
    }
    if (e.target.tagName === 'A') return;
    e.preventDefault();
    document.querySelectorAll('.mz-ref.mz-open').forEach(r => { if (r !== ref) r.classList.remove('mz-open'); });
    ref.classList.toggle('mz-open');
  });
})();
</script>
"""

def main():
    corpus = json.load(open(CORPUS_PATH))
    abstracts = fetch_abstracts()
    with open(CSS_SOURCE) as f: endo_html = f.read()
    css_match = re.search(r"<style>(.*?)</style>", endo_html, re.DOTALL)
    css = css_match.group(1) if css_match else ""

    page = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Menopause &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to menopause: stages, symptoms, the modern evidence on hormone therapy, non-hormonal options, GSM, bone health, and cardiovascular risk. KB-anchored, peer-reviewed.">
    <meta name="robots" content="index, follow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>{css}</style>
</head>
<body>
<nav class="site-nav" aria-label="Site navigation">
    <div class="inner">
        <a class="brand" href="/">Mount Zara</a>
        <span class="crumb">&middot;  Patient Education  &middot;  Menopause</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{stages_section()}
{symptoms_section()}
{treatment_overview()}
{faq_section()}
{references_section(abstracts)}
</div>
{modals_html()}
{JS}
</body>
</html>

<!-- §0.8 KB-anchor manifest
{json.dumps({
    "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
    "surface": "/education/menopause/index.html",
    "topic": "Menopause",
    "topic_synthesis_id": "c99267ae-2738-412d-9010-cd05251c5af3",
    "kb_chunks_path": "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/",
    "kb_documents_loaded": list(corpus.keys()),
    "kb_documents_quoted": [
        {
            "kb_doc_id": a["kb_doc_id"],
            "title": next((c.get("title") for k,c in corpus.items() if k.lower()==a["kb_doc_id"].lower()), "?"),
            "field": a["field"],
            "claim": a["claim"],
            "excerpt_first_words": a["excerpt_first_words"],
            "page_anchor_id": a["page_anchor_id"],
        }
        for a in ANCHORS
    ],
    "pmids_efetched_in_session": [r["pmid"] for r in PMIDS.values()],
    "user_docx_sources": [],
    "not_in_kb_claims": [],
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
}, indent=2)}
-->
"""
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH,"w") as f: f.write(page)
    print(f"Wrote {OUT_PATH} ({os.path.getsize(OUT_PATH):,} bytes)")
    print(f"  KB docs: {len(corpus)}  KB anchors: {len(ANCHORS)}  PMIDs: {len(PMIDS)}  Modals: {len(MODALS_CONTENT)}")

if __name__ == "__main__":
    main()
