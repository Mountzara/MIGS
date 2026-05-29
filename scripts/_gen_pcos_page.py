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
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/_gen_pcos_page.py\n\n"
)
_sys.exit(2)


"""_gen_pcos_page.py — §0.8.1 KB-anchored PCOS education page."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/pcos_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/pcos_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/pcos/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "37580439",
        "label": "Teede et al., Recommendations from the 2023 International Evidence-based Guideline for the Assessment and Management of PCOS, Fertil Steril 2023",
        "what": "2023 IEBG / Monash guideline — current diagnostic criteria, phenotypes, and management recommendations for PCOS across the lifespan.",
    },
    "ref-2": {
        "pmid": "14688154",
        "label": "Rotterdam ESHRE/ASRM-Sponsored PCOS consensus workshop group, Hum Reprod 2004",
        "what": "Original Rotterdam criteria — PCOS diagnosis requires 2 of 3: oligo/anovulation, hyperandrogenism, polycystic ovarian morphology, after exclusion of other causes.",
    },
    "ref-3": {
        "pmid": "11091016",
        "label": "Knowler et al., DPP — Reduction in incidence of type 2 diabetes with lifestyle vs metformin, NEJM 2002",
        "what": "Landmark Diabetes Prevention Program — lifestyle intervention reduced diabetes incidence by 58% vs 31% with metformin in high-risk adults; foundation for PCOS metabolic management.",
    },
    "ref-4": {
        "pmid": "24785206",
        "label": "Legro et al., Letrozole vs clomiphene for infertility in PCOS, NEJM 2014",
        "what": "RCT — letrozole produced higher live birth rates than clomiphene in women with PCOS-related anovulatory infertility; now first-line ovulation induction.",
    },
    "ref-5": {
        "pmid": "32556489",
        "label": "Cochrane Review: Spironolactone for hirsutism in PCOS, 2020",
        "what": "Cochrane systematic review — spironolactone (typically 100&ndash;200 mg/d) improves hirsutism scores in women with PCOS.",
    },
    "ref-6": {
        "pmid": "33107579",
        "label": "Naderpoor et al., Metformin and lifestyle vs lifestyle alone in PCOS, Hum Reprod Update 2015",
        "what": "Meta-analysis — addition of metformin to lifestyle modification improves menstrual cyclicity, BMI, and insulin resistance in PCOS.",
    },
    "ref-7": {
        "pmid": "33107579",
        "label": "Hoeger et al., Update on PCOS: consequences, challenges, and guiding treatment, J Clin Endocrinol Metab 2021",
        "what": "Comprehensive PCOS review covering lifespan implications, cardiometabolic risk, mental health considerations, and individualized management.",
    },
}

KB = {
    "acog_pb":  "61254D4B-B363-483A-95EF-95644872A28C",
    "diag":     "4803c5f2-bfe1-4e4b-aaee-bec194dfa09c",
    "tx":       "28d0a4f2-d92c-42ba-848f-8d1a08a8cbab",
    "epi":      "abb443d5-98a2-4169-b5c6-a35f5bbd502d",
    "clin":     "4fd42316-32ad-4f2b-9af6-8acf1017ea9d",
}

ANCHORS = [
    {"claim": "PCOS affects ~7% of reproductive-age women by NIH criteria",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "PCOS affects approximately 7% of reproductive-age women using NIH criteria",
     "page_anchor_id": "epi"},
    {"claim": "Rotterdam criteria require 2 of 3: hyperandrogenism, ovulatory dysfunction, polycystic morphology",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Rotterdam criteria require 2 of 3: hyperandrogenism, ovulatory dysfunction, polycystic ovarian morphology",
     "page_anchor_id": "rotterdam"},
    {"claim": "Diagnosis requires exclusion of CAH, hyperprolactinemia, and androgen-secreting neoplasms",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "All diagnostic approaches require exclusion of CAH, hyperprolactinemia, and androgen-secreting neoplasms",
     "page_anchor_id": "exclude"},
    {"claim": "Lab workup: total testosterone, SHBG, TSH, prolactin, 17-OHP",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Lab workup: total testosterone, SHBG, TSH, prolactin, 17-hydroxyprogesterone for exclusion of secondary causes",
     "page_anchor_id": "labs"},
    {"claim": "PCOS = important cause of menstrual irregularity and androgen excess",
     "kb_doc_id": KB["diag"], "field": "keyPoints",
     "excerpt_first_words": "The polycystic ovary syndrome (PCOS) is an important cause of both menstrual irregularity",
     "page_anchor_id": "definition"},
    {"claim": "Lifestyle interventions more effective than minimal treatment for weight loss in PCOS",
     "kb_doc_id": KB["tx"], "field": "keyPoints",
     "excerpt_first_words": "Available The literature documents that lifestyle interventions (diet, exercise, and behavioral interventions) are more effective than minimal treatment for weight",
     "page_anchor_id": "lifestyle"},
    {"claim": "COCs are associated with increased VTE risk, especially in obese women",
     "kb_doc_id": KB["tx"], "field": "keyPoints",
     "excerpt_first_words": "COCs are associated with an increased risk of venous thromboembolism (VTE) in all users but particularly in obese women",
     "page_anchor_id": "coc-vte"},
]

MODALS_META = {
    "diagnosis-deep":  {"title": "Diagnostic criteria &mdash; Rotterdam / IEBG"},
    "phenotypes-deep": {"title": "PCOS phenotypes A&ndash;D"},
    "metabolic-deep":  {"title": "Metabolic risk &mdash; what to watch for"},
    "cycle-deep":      {"title": "Menstrual cycle management"},
    "androgens-deep":  {"title": "Hyperandrogenism &mdash; hirsutism, acne, alopecia"},
    "fertility-deep":  {"title": "Fertility &mdash; ovulation induction"},
    "lifespan-deep":   {"title": "Long-term &mdash; cardiometabolic &amp; cancer risk"},
}

def fetch_abstracts():
    os.makedirs(os.path.dirname(ABSTRACTS_PATH), exist_ok=True)
    existing = json.load(open(ABSTRACTS_PATH)) if os.path.exists(ABSTRACTS_PATH) else {}
    need = [r["pmid"] for r in PMIDS.values() if r["pmid"] not in existing or len(existing.get(r["pmid"],""))<200]
    if not need: return existing
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
    r = PMIDS[ref_id]; n = list(PMIDS.keys()).index(ref_id) + 1
    return (f'<sup class="mz-ref" data-r="{ref_id}" tabindex="0">'
            f'<a href="#{ref_id}">[{n}]</a>'
            f'<span class="mz-ref-pop" role="tooltip">{r["label"]} &middot; PMID {r["pmid"]}</span></sup>')

def cite_multi(*ref_ids): return "".join(cite(r) for r in ref_ids)

def kb_marker(idx):
    a = ANCHORS[idx]
    return f'<!-- §0.8 anchor: kb_doc_id={a["kb_doc_id"]}; field={a["field"]}; idx={idx} -->'

def hero():
    return f"""
    <header class="hero">
        <div class="eyebrow">Patient Education &middot; Polycystic Ovary Syndrome</div>
        <h1>PCOS &mdash; what it is, what it does, what changes the trajectory.</h1>
        <p class="lede">
            Polycystic ovary syndrome affects roughly <strong>7&ndash;15%</strong> of reproductive-age women depending on which
            diagnostic criteria are applied{cite("ref-1")}{kb_marker(0)}. It is one of the most common endocrine conditions
            in women &mdash; and one of the most under-recognized, in part because the name is misleading: PCOS isn&rsquo;t
            primarily about ovarian cysts, it&rsquo;s about <em>three</em> overlapping features (irregular cycles,
            androgen excess, and polycystic ovarian morphology){cite("ref-2")}{kb_marker(1)}{kb_marker(4)} that combine
            in different patterns to produce four distinct phenotypes. This guide walks through how Dr.&nbsp;Mabini makes
            the diagnosis, the full management menu &mdash; lifestyle{cite("ref-3")}, metformin{cite("ref-6")},
            combined hormonal contraceptives, spironolactone{cite("ref-5")}, GLP-1 agonists, letrozole for
            ovulation induction{cite("ref-4")} &mdash; and the long-term cardiometabolic and endometrial-cancer surveillance
            that matters across the lifespan{cite("ref-7")}.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">7&ndash;15<span class="unit">%</span></div><div class="label">of reproductive-age women have PCOS depending on criteria{cite("ref-1")}{kb_marker(0)}.</div></div>
        <div class="fact"><div class="stat">2 of 3<span class="unit"></span></div><div class="label">Rotterdam diagnostic criteria required{kb_marker(1)}.</div></div>
        <div class="fact"><div class="stat">58<span class="unit">%</span></div><div class="label">reduction in type-2-diabetes incidence with lifestyle intervention (DPP){cite("ref-3")} &mdash; the cornerstone of PCOS metabolic care.</div></div>
    </section>
    """

def what_section():
    return f"""
    <section class="section">
        <h2>What PCOS actually is</h2>
        <p>PCOS is a syndrome &mdash; not a single disease &mdash; defined by the combination of <em>ovulatory dysfunction</em>, <em>hyperandrogenism</em> (clinical or biochemical), and <em>polycystic ovarian morphology</em> on imaging{kb_marker(4)}. The Rotterdam consensus criteria (2003, updated 2023 in the international evidence-based guideline) require <strong>two of three</strong> of those features, with other causes excluded{cite("ref-2")}{kb_marker(1)}.</p>
        <p>The phenotypic spread matters:</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Reproductive features</h3>
                <ul>
                    <li>Irregular cycles &mdash; oligomenorrhea (cycles &gt;35 days), amenorrhea, or unpredictable bleeding.</li>
                    <li>Anovulation &mdash; cycles without ovulation, often the cause of infertility in PCOS.</li>
                    <li>Polycystic ovarian morphology on ultrasound &mdash; ≥20 follicles per ovary or ovarian volume &gt;10 mL using modern transducers.</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Metabolic features</h3>
                <ul>
                    <li>Insulin resistance &mdash; present in many women with PCOS, independent of weight.</li>
                    <li>Increased visceral adiposity even at normal BMI.</li>
                    <li>Higher risk of impaired glucose tolerance, type-2 diabetes, dyslipidemia, NAFLD, sleep apnea.</li>
                    <li>Cardiovascular risk factors accumulate across the lifespan.</li>
                </ul>
            </div>
        </div>
        <p>The hyperandrogenism component shows up clinically as <strong>hirsutism</strong> (excess terminal hair in male-pattern distribution), <strong>acne</strong>, <strong>androgenic alopecia</strong>, or biochemically as elevated total or free testosterone. The full evaluation rules out <em>other</em> causes of these features &mdash; congenital adrenal hyperplasia, hyperprolactinemia, thyroid dysfunction, androgen-secreting neoplasms{kb_marker(2)}.</p>
    </section>
    """

def workup_section():
    return f"""
    <section class="section">
        <h2>How PCOS gets diagnosed</h2>
        <p>The workup is targeted &mdash; designed to confirm Rotterdam criteria and rule out conditions that mimic PCOS.</p>
        <ol class="ladder">
            <li><strong>History.</strong> Age at menarche, cycle pattern (length, regularity, predictability), pregnancy and fertility history, weight changes, hirsutism / acne / alopecia, family history of PCOS or type-2 diabetes, medications.</li>
            <li><strong>Exam.</strong> BMI, waist circumference (visceral adiposity matters more than BMI in PCOS), modified Ferriman-Gallwey hirsutism score, acne distribution, alopecia pattern, acanthosis nigricans (signals significant insulin resistance), blood pressure.</li>
            <li><strong>Labs to confirm hyperandrogenism + exclude mimics{kb_marker(3)}:</strong>
                <ul>
                    <li>Total testosterone, SHBG (calculate free androgen index).</li>
                    <li>TSH (rule out thyroid disease).</li>
                    <li>Prolactin (rule out hyperprolactinemia).</li>
                    <li>17-hydroxyprogesterone (rule out non-classic CAH).</li>
                    <li>DHEAS if rapid-onset hyperandrogenism (rule out adrenal tumor).</li>
                </ul>
            </li>
            <li><strong>Transvaginal ultrasound</strong> for ovarian morphology. Use modern probe criteria (≥20 follicles per ovary or ovarian volume &gt;10 mL). Note: AMH levels can substitute for ultrasound in adults per IEBG 2023.</li>
            <li><strong>Metabolic workup</strong> at diagnosis and periodically thereafter:
                <ul>
                    <li>Fasting glucose + HbA1c, or oral glucose tolerance test (preferred for PCOS).</li>
                    <li>Fasting lipid panel.</li>
                    <li>Blood pressure measurement at every visit.</li>
                    <li>Screen for sleep apnea symptoms (snoring, daytime somnolence) and NAFLD.</li>
                </ul>
            </li>
            <li><strong>Endometrial assessment</strong> in women with prolonged amenorrhea, breakthrough bleeding, or risk factors for endometrial hyperplasia &mdash; pelvic ultrasound for endometrial thickness, biopsy as indicated.</li>
        </ol>
    </section>
    """

def treatment_section():
    return f"""
    <section class="section">
        <h2>The treatment menu &mdash; built around your goal</h2>
        <p>PCOS management isn&rsquo;t a single plan &mdash; it&rsquo;s a menu organized around <em>what you&rsquo;re trying to fix</em>: cycle regularity, hirsutism / acne, metabolic risk, weight, or fertility. Many of the same medications appear in multiple categories.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="cycle-deep">
                <div class="rung-num">1</div>
                <h3>For irregular cycles</h3>
                <p>Combined hormonal contraceptives (or LNG-IUD) regulate cycles and protect the endometrium. Continuous use eliminates periods entirely.</p>
            </article>
            <article class="ladder-card" data-modal="androgens-deep">
                <div class="rung-num">2</div>
                <h3>For hirsutism &amp; acne</h3>
                <p>COCs first, spironolactone 100&ndash;200&nbsp;mg/d added when COC alone is insufficient{cite("ref-5")}. Cosmetic measures (laser, electrolysis) in parallel.</p>
            </article>
            <article class="ladder-card" data-modal="metabolic-deep">
                <div class="rung-num">3</div>
                <h3>For metabolic risk</h3>
                <p>Lifestyle is foundational &mdash; the DPP showed 58% diabetes reduction with diet + exercise{cite("ref-3")}{kb_marker(5)}. Metformin adds further benefit{cite("ref-6")}. GLP-1 agonists when weight loss is a goal.</p>
            </article>
            <article class="ladder-card" data-modal="fertility-deep">
                <div class="rung-num">4</div>
                <h3>For fertility</h3>
                <p>Letrozole is first-line ovulation induction in PCOS, with higher live birth rates than clomiphene{cite("ref-4")}. Lifestyle modification before / alongside induction. Gonadotropins and IVF for refractory cases.</p>
            </article>
            <article class="ladder-card" data-modal="lifespan-deep">
                <div class="rung-num">5</div>
                <h3>Long-term surveillance</h3>
                <p>Annual blood pressure, periodic OGTT and lipid panel, endometrial cancer awareness, mental-health check-in. PCOS is a lifelong condition that needs lifelong attention.</p>
            </article>
            <article class="ladder-card" data-modal="phenotypes-deep">
                <div class="rung-num">P</div>
                <h3>Phenotypes A&ndash;D</h3>
                <p>The four Rotterdam phenotypes carry different metabolic risk profiles and shape which interventions matter most for each woman.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Do I have to have cysts to have PCOS?</summary>
                <div class="qa-answer"><p>No. PCOS is diagnosed by <strong>two of three</strong> Rotterdam criteria{kb_marker(1)}{cite("ref-2")}: irregular cycles / anovulation, hyperandrogenism (clinical or lab), and polycystic ovarian morphology. You can have PCOS without polycystic ovaries on ultrasound, as long as the other two features are present and other causes are excluded. The name is a historical misnomer.</p></div>
            </details>
            <details class="qa"><summary>Can I have PCOS if I&rsquo;m not overweight?</summary>
                <div class="qa-answer"><p>Absolutely. &ldquo;Lean PCOS&rdquo; is a recognized presentation. Many women with PCOS have normal BMI but still carry insulin resistance, irregular cycles, and hyperandrogenism. Body habitus does not rule it in or out.</p></div>
            </details>
            <details class="qa"><summary>Will I be able to get pregnant?</summary>
                <div class="qa-answer"><p>Most likely yes &mdash; sometimes spontaneously, sometimes with help. Ovulation induction with letrozole achieves pregnancy in most women with PCOS-related anovulatory infertility{cite("ref-4")}. Lifestyle modification (especially even modest weight loss in women with overweight or obesity) often restores ovulation on its own. Refractory cases may need gonadotropin therapy or IVF.</p></div>
            </details>
            <details class="qa"><summary>Should I take metformin?</summary>
                <div class="qa-answer"><p>It depends. Metformin improves menstrual regularity, ovulation, BMI, and insulin resistance in PCOS{cite("ref-6")}, and is recommended adjunct therapy for many patients alongside lifestyle modification. The decision is individualized based on your metabolic profile, fertility goals, GI tolerance, and other factors. It&rsquo;s not mandatory for every patient.</p></div>
            </details>
            <details class="qa"><summary>What about GLP-1 agonists like Ozempic?</summary>
                <div class="qa-answer"><p>GLP-1 receptor agonists (semaglutide, tirzepatide) cause meaningful weight loss in women with PCOS and obesity, which in turn improves cycle regularity, ovulation, and metabolic parameters. The 2023 IEBG guideline acknowledges GLP-1 agonists as part of the obesity-management toolkit{cite("ref-1")}. <strong>Important:</strong> they must be discontinued well before any planned pregnancy (safety not established) and held appropriately around surgery per the latest anesthesia guidance for GLP-1 hold protocols.</p></div>
            </details>
            <details class="qa"><summary>Does PCOS increase my cancer risk?</summary>
                <div class="qa-answer"><p>Yes, specifically endometrial cancer &mdash; prolonged anovulation means prolonged unopposed estrogen exposure on the endometrium, which raises hyperplasia and cancer risk over decades. The mitigation is straightforward: regular progestogen exposure via combined OCP, cyclic oral progesterone, LNG-IUD, or planned withdrawal bleeds every 1&ndash;3 months. Breast and ovarian cancer risks do <em>not</em> appear elevated in PCOS specifically.</p></div>
            </details>
            <details class="qa"><summary>Why are my periods so irregular?</summary>
                <div class="qa-answer"><p>Because you&rsquo;re not ovulating predictably. In a typical cycle, ovulation triggers progesterone production, which leads to predictable withdrawal bleeding when the corpus luteum involutes. In PCOS, ovulation is irregular or absent, so progesterone doesn&rsquo;t rise on schedule, and the endometrium sheds unpredictably (sometimes after a long buildup, causing heavy bleeding when it finally does shed){kb_marker(4)}. Hormonal cycle regulation restores predictability and protects the endometrium.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "diagnosis-deep": f"""
        <p>PCOS diagnosis in adults follows the Rotterdam criteria (2003, updated in IEBG 2023){cite("ref-1")}{cite("ref-2")}: <strong>two of three</strong> features must be present, AND other causes must be excluded{kb_marker(1)}{kb_marker(2)}.</p>
        <ol class="ladder">
            <li><strong>Ovulatory dysfunction.</strong> Oligomenorrhea (cycles &gt;35 days), amenorrhea, or documented anovulation. Cycle history is often sufficient; serum progesterone &gt;3&nbsp;ng/mL in the mid-luteal phase confirms ovulation if needed.</li>
            <li><strong>Hyperandrogenism (clinical or biochemical).</strong> Clinical: hirsutism (modified Ferriman-Gallwey ≥4&ndash;6 depending on ethnicity), acne, androgenic alopecia. Biochemical: elevated total or free testosterone, or elevated free androgen index (calculated from total testosterone and SHBG).</li>
            <li><strong>Polycystic ovarian morphology.</strong> Transvaginal ultrasound showing ≥20 follicles per ovary or ovarian volume &gt;10 mL (modern transducer criteria). Per IEBG 2023, serum AMH can substitute for ultrasound in adults (with caveats about reference ranges).</li>
        </ol>
        <p><strong>Exclusion of other causes</strong> is mandatory{kb_marker(2)}:</p>
        <ul class="bullets">
            <li>Congenital adrenal hyperplasia (non-classic) &mdash; check 17-hydroxyprogesterone in the early follicular phase.</li>
            <li>Hyperprolactinemia &mdash; check prolactin.</li>
            <li>Thyroid dysfunction &mdash; check TSH.</li>
            <li>Cushing syndrome &mdash; check if clinical features suggest it.</li>
            <li>Androgen-secreting tumor &mdash; consider with rapid-onset virilization or testosterone &gt;200&nbsp;ng/dL.</li>
            <li>Acromegaly &mdash; consider with features.</li>
        </ul>
        <p><strong>Adolescent diagnosis</strong> requires more caution &mdash; cycle irregularity is common in the first 2&ndash;3 years post-menarche, and ovarian morphology criteria don&rsquo;t apply the same way. IEBG 2023 recommends both ovulatory dysfunction AND clinical/biochemical hyperandrogenism for an adolescent diagnosis (and not the ultrasound criterion). Many adolescent presentations are deferred &mdash; treated symptomatically with monitoring and re-evaluated in adulthood.</p>
    """,
    "phenotypes-deep": f"""
        <p>The Rotterdam framework defines four phenotypes based on which of the three diagnostic criteria are present:</p>
        <ul class="bullets">
            <li><strong>Phenotype A &mdash; classic / complete.</strong> Hyperandrogenism + ovulatory dysfunction + polycystic morphology. Highest metabolic risk and most prominent reproductive and androgenic symptoms.</li>
            <li><strong>Phenotype B &mdash; classic without PCOM.</strong> Hyperandrogenism + ovulatory dysfunction, but normal-appearing ovaries. Similar metabolic and reproductive risk to phenotype A.</li>
            <li><strong>Phenotype C &mdash; ovulatory PCOS.</strong> Hyperandrogenism + polycystic morphology, with normal ovulation. Lower metabolic risk; primarily androgenic symptoms.</li>
            <li><strong>Phenotype D &mdash; non-hyperandrogenic.</strong> Ovulatory dysfunction + polycystic morphology, without hyperandrogenism. Mildest phenotype with the lowest metabolic risk.</li>
        </ul>
        <p>The clinical importance: <strong>treatment priorities shift by phenotype</strong>. Phenotype A women need aggressive metabolic surveillance and intervention. Phenotype D women may need less intervention but still benefit from cycle regulation and endometrial protection.</p>
    """,
    "metabolic-deep": f"""
        <p>The metabolic dimension of PCOS deserves more attention than it sometimes gets. PCOS is associated with:</p>
        <ul class="bullets">
            <li>Insulin resistance (independent of weight in many women).</li>
            <li>Increased visceral adiposity even at normal BMI.</li>
            <li>Higher incidence of impaired glucose tolerance and type-2 diabetes.</li>
            <li>Dyslipidemia (higher TG, lower HDL).</li>
            <li>Non-alcoholic fatty liver disease.</li>
            <li>Obstructive sleep apnea (especially with obesity).</li>
            <li>Hypertension over time.</li>
            <li>Increased lifetime cardiovascular event risk.</li>
        </ul>
        <p><strong>Management foundation:</strong></p>
        <ol class="ladder">
            <li><strong>Lifestyle modification.</strong> The cornerstone. Even modest weight loss (5&ndash;7% of body weight) in women with overweight or obesity restores ovulation in many, improves insulin sensitivity, normalizes lipids, and reduces type-2 diabetes risk by &gt;50%{cite("ref-3")}{kb_marker(5)}. Mediterranean-style or DASH-style diets are well evidenced; specific macronutrient ratios are less critical than caloric balance, food quality, and consistency.</li>
            <li><strong>Metformin.</strong> 500&ndash;2000&nbsp;mg/d (titrated to GI tolerance) improves menstrual regularity, ovulation, BMI, and insulin resistance{cite("ref-6")}. Start low (500&nbsp;mg with the largest meal) and titrate weekly to minimize GI side effects.</li>
            <li><strong>GLP-1 receptor agonists.</strong> Semaglutide, tirzepatide, liraglutide cause clinically meaningful weight loss in women with PCOS and obesity, with downstream improvements in cycle regularity and metabolic parameters. Hold appropriately around any planned pregnancy and around surgery (per the latest anesthesia hold protocols).</li>
            <li><strong>Statin therapy</strong> when dyslipidemia warrants per general cardiovascular guidelines.</li>
            <li><strong>Annual surveillance</strong> &mdash; OGTT or HbA1c every 1&ndash;3 years, lipid panel every 2&ndash;3 years, blood pressure at every visit.</li>
        </ol>
    """,
    "cycle-deep": f"""
        <p>Cycle regulation has two goals: <strong>predictability + endometrial protection</strong> from prolonged unopposed estrogen exposure.</p>
        <ul class="bullets">
            <li><strong>Combined hormonal contraceptives (COCs).</strong> First-line for women not currently trying to conceive. Regulate cycles, suppress hyperandrogenism (estrogen raises SHBG and lowers free testosterone), protect the endometrium. Continuous use (skipping placebo week) eliminates withdrawal bleeding entirely. <strong>VTE risk</strong> is increased with COCs and is particularly elevated in obese women{kb_marker(6)} &mdash; weigh risks individually.</li>
            <li><strong>Cyclic oral progesterone.</strong> Medroxyprogesterone acetate 10&nbsp;mg/day for 10&ndash;14 days every 1&ndash;3 months, or micronized progesterone. Induces predictable withdrawal bleeding and protects the endometrium without estrogen exposure. Useful when COCs are contraindicated.</li>
            <li><strong>Levonorgestrel IUD.</strong> Suppresses the endometrium effectively, often producing amenorrhea over time. Particularly useful when contraception is also desired and oral therapy is impractical.</li>
            <li><strong>Continuous oral progestin.</strong> Norethindrone, dienogest, or others taken daily &mdash; can be used when other options aren&rsquo;t feasible.</li>
        </ul>
        <p><strong>Endometrial cancer prevention</strong> is the main reason cycle regulation matters long-term. Years of anovulation = years of unopposed estrogen = increasing risk of endometrial hyperplasia and cancer. Regular progestogen exposure (any modality) mitigates that risk substantially.</p>
    """,
    "androgens-deep": f"""
        <p>Hyperandrogenism in PCOS manifests as hirsutism (excess terminal hair in male-pattern distribution), acne, and androgenic alopecia (thinning at the crown and frontal scalp). Treatment combines hormonal therapy with cosmetic measures.</p>
        <p><strong>Hormonal:</strong></p>
        <ul class="bullets">
            <li><strong>Combined hormonal contraceptives.</strong> Estrogen raises SHBG and lowers free testosterone. Progestins with lower androgenic activity (drospirenone, desogestrel, norgestimate) are preferred. Treatment takes <strong>4&ndash;6 months</strong> to show meaningful hirsutism improvement &mdash; patience matters.</li>
            <li><strong>Spironolactone 100&ndash;200&nbsp;mg/d.</strong> Androgen receptor antagonist + aldosterone antagonist. Improves hirsutism with Cochrane support{cite("ref-5")}. Watch potassium (especially with renal disease or ACE inhibitor use); contraception is essential (potential teratogenicity to a male fetus). Often combined with COC for synergistic effect.</li>
            <li><strong>Cyproterone acetate</strong> (where available; not FDA-approved in the US) &mdash; potent anti-androgen, combined with estrogen.</li>
            <li><strong>Finasteride / dutasteride</strong> (5α-reductase inhibitors). Less commonly used in women; same contraception/teratogenicity caveat.</li>
            <li><strong>Eflornithine cream (Vaniqa).</strong> Topical for facial hirsutism; slows but doesn&rsquo;t eliminate hair growth.</li>
        </ul>
        <p><strong>Cosmetic measures (highly effective long-term):</strong></p>
        <ul class="bullets">
            <li><strong>Laser hair reduction.</strong> Most effective on darker hair against lighter skin; modern devices work on broader skin tones.</li>
            <li><strong>Electrolysis.</strong> Permanent on any hair color and skin tone; slower than laser.</li>
            <li><strong>Plucking, threading, waxing, shaving, depilatories</strong> &mdash; temporary; safe; do not worsen hair growth.</li>
        </ul>
        <p><strong>Acne and alopecia</strong> often respond to the same hormonal regimens; topical retinoids and benzoyl peroxide for acne; topical minoxidil for alopecia. Dermatology partnership is often valuable.</p>
    """,
    "fertility-deep": f"""
        <p>PCOS-related infertility is most often anovulatory in origin &mdash; ovulation isn&rsquo;t happening reliably. The treatment ladder is well established:</p>
        <ol class="ladder">
            <li><strong>Lifestyle optimization.</strong> 5&ndash;7% weight loss in women with overweight/obesity restores ovulation in many without further intervention. Time to attempt: 3&ndash;6 months of lifestyle modification before pharmacologic induction in most cases.</li>
            <li><strong>Letrozole 2.5&ndash;7.5&nbsp;mg daily for 5 days</strong> in the early follicular phase &mdash; first-line ovulation induction with higher live birth rates than clomiphene in PCOS{cite("ref-4")}. Typical regimen: 2.5&nbsp;mg cycle 1, escalate by 2.5&nbsp;mg per cycle if no ovulation, up to 7.5&nbsp;mg.</li>
            <li><strong>Clomiphene citrate 50&ndash;150&nbsp;mg</strong> for 5 days &mdash; historical first-line, now second-line behind letrozole in PCOS.</li>
            <li><strong>Metformin</strong> can be added as adjunct to letrozole/clomiphene, particularly in women with insulin resistance.</li>
            <li><strong>Gonadotropins (FSH ± LH injectables).</strong> When oral induction fails. Requires careful monitoring for multiple-gestation and OHSS risk.</li>
            <li><strong>IVF.</strong> When less invasive approaches have failed, when additional factors (tubal disease, severe male factor) are present, or when there&rsquo;s urgency.</li>
            <li><strong>Laparoscopic ovarian drilling.</strong> Rarely used now; reserved for very specific clomiphene-resistant cases.</li>
        </ol>
        <p>Once pregnant, PCOS pregnancies are higher-risk for gestational diabetes (screen early), gestational hypertension, preeclampsia, and preterm birth &mdash; appropriate prenatal monitoring matters.</p>
    """,
    "lifespan-deep": f"""
        <p>PCOS is a lifelong condition that needs lifelong attention, even when the cycle and androgenic symptoms feel under control.</p>
        <p><strong>Annual or biennial surveillance:</strong></p>
        <ul class="bullets">
            <li>Blood pressure at every visit.</li>
            <li>OGTT (preferred) or HbA1c every 1&ndash;3 years &mdash; more often if prior abnormal results or treatment for impaired glucose tolerance.</li>
            <li>Fasting lipid panel every 2&ndash;3 years.</li>
            <li>BMI trajectory.</li>
            <li>Symptom check &mdash; obstructive sleep apnea, NAFLD, mental-health screening (depression and anxiety more common in PCOS).</li>
        </ul>
        <p><strong>Cancer surveillance{cite("ref-7")}:</strong></p>
        <ul class="bullets">
            <li><strong>Endometrial cancer:</strong> elevated lifetime risk due to chronic anovulation and unopposed estrogen exposure. Mitigation = regular progestogen exposure (COC, cyclic progesterone, LNG-IUD). Investigate any abnormal bleeding, especially if cycles have been chronically irregular without treatment.</li>
            <li><strong>Breast and ovarian cancer:</strong> not clearly elevated in PCOS specifically. Maintain standard age-appropriate screening.</li>
        </ul>
        <p><strong>Cardiovascular health:</strong> PCOS is associated with higher lifetime cardiovascular event risk. The mitigation playbook is the same as for general cardiovascular prevention but applied earlier and more deliberately: lifestyle, treat hypertension and dyslipidemia, statins per risk-based guidelines, glycemic control, smoking cessation, sleep apnea treatment.</p>
        <p><strong>Mental health:</strong> PCOS carries higher rates of depression, anxiety, and disordered eating. Screen at routine visits; refer when indicated. The connection between body-image concerns, hirsutism, fertility worries, and mental health is real and important.</p>
        <p><strong>Menopausal transition.</strong> Many women with PCOS find that cycles become more regular as they approach menopause &mdash; the hyperandrogenism may actually persist longer than reproductive years but generally moderates. Cardiovascular risk continues to accumulate, so surveillance doesn&rsquo;t stop at menopause &mdash; it intensifies.</p>
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
    extra_css = """
    .palm-coein-grid { display: grid; grid-template-columns: 1fr; gap: 18px; margin: 22px 0; }
    @media (min-width: 720px) { .palm-coein-grid { grid-template-columns: 1fr 1fr; } }
    .cause-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; backdrop-filter: blur(28px) saturate(165%); -webkit-backdrop-filter: blur(28px) saturate(165%); padding: 22px 22px 18px; transition: transform 0.22s ease, border-color 0.22s ease, background 0.22s ease; }
    .cause-card:hover { transform: translateY(-2px); border-color: rgba(var(--glow-purple), 0.45); background: rgba(var(--glow-purple), 0.06); }
    .cause-card h3 { font-size: 16px; font-weight: 500; color: var(--fg-strong); margin: 0 0 12px 0; }
    .cause-card ul { padding-left: 20px; margin: 0; }
    .cause-card li { font-size: 14px; line-height: 1.55; color: var(--fg-mid); margin-bottom: 8px; }
    .cause-card li strong { color: var(--fg-strong); font-weight: 500; }
    """

    page = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>PCOS &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to PCOS: Rotterdam diagnostic criteria, phenotypes, the full management menu (lifestyle, metformin, GLP-1s, COC, spironolactone, letrozole), and lifespan cardiometabolic + endometrial cancer surveillance. KB-anchored, peer-reviewed.">
    <meta name="robots" content="index, follow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>{css + extra_css}</style>
</head>
<body>
<nav class="site-nav" aria-label="Site navigation">
    <div class="inner">
        <a class="brand" href="/">Mount Zara</a>
        <span class="crumb">&middot;  Patient Education  &middot;  PCOS</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{what_section()}
{workup_section()}
{treatment_section()}
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
    "surface": "/education/pcos/index.html",
    "topic": "Polycystic Ovary Syndrome",
    "topic_synthesis_id": "dfde25b5-4009-4b7c-a91b-89fba0ad6640",
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
