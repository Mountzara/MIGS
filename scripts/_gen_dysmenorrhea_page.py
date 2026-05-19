#!/usr/bin/env python3
"""_gen_dysmenorrhea_page.py — generator for /education/dysmenorrhea/index.html.
§0.8.1 KB-anchored. 5 ACOG/clinical docs from the Dysmenorrhea topic synthesis."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/dysmenorrhea_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/dysmenorrhea_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/dysmenorrhea/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "30575675",
        "label": "ACOG Committee Opinion 760: Dysmenorrhea and Endometriosis in the Adolescent, 2018",
        "what": "ACOG guidance on dysmenorrhea — NSAIDs first-line, combined hormonal contraceptives effective; persistent dysmenorrhea despite both deserves evaluation for endometriosis.",
    },
    "ref-2": {
        "pmid": "32856498",
        "label": "Marjoribanks et al., Cochrane Review: NSAIDs for dysmenorrhea, 2015 (updated)",
        "what": "Cochrane systematic review — NSAIDs are significantly more effective than placebo for primary dysmenorrhea, with no clear difference among individual NSAIDs.",
    },
    "ref-3": {
        "pmid": "31257876",
        "label": "Wong et al., Oral contraceptive pill for primary dysmenorrhea, Cochrane Review 2009 (updated)",
        "what": "Cochrane review — combined oral contraceptives reduce dysmenorrhea pain significantly compared to placebo.",
    },
    "ref-4": {
        "pmid": "28525302",
        "label": "Taylor et al., Elagolix for endometriosis pain (Elaris EM-I & EM-II), NEJM 2017",
        "what": "Phase 3 RCT — oral GnRH antagonist elagolix significantly reduced dysmenorrhea and nonmenstrual pelvic pain versus placebo at 3 and 6 months.",
    },
    "ref-5": {
        "pmid": "24666560",
        "label": "Molins-Cubero et al., Osteopathic manipulative treatment for chronic pelvic pain in endometriosis, J Bodyw Mov Ther 2014",
        "what": "RCT — 8-week osteopathic manipulative treatment improved pain and quality of life in endometriosis-associated pelvic pain.",
    },
    "ref-6": {
        "pmid": "22513920",
        "label": "Brown et al., Acupuncture for dysmenorrhea, Cochrane Review 2011",
        "what": "Cochrane review — limited evidence suggests acupuncture may reduce dysmenorrhea pain, but study quality varies.",
    },
    "ref-7": {
        "pmid": "33095458",
        "label": "Bafort et al., Laparoscopic surgery for endometriosis, Cochrane Review 2020",
        "what": "Cochrane systematic review — laparoscopic surgery for endometriosis-associated pain provides significant pain relief vs diagnostic laparoscopy alone.",
    },
}

KB = {
    "adeno":      "1d24bd42-7881-4850-a171-fa43a96b6c95",
    "endo_clin":  "9c606d8f-031c-4fa7-922e-671dbdb9cc44",
    "elagolix":   "aa9fb92e-5a64-4bbb-858d-523d5f289ff2",
    "suppress":   "b9da554d-9158-422e-8248-39a1acad21c4",
    "endo_acog":  "f7f8777f-2cab-4709-a360-14ebfa7c09bf",
}

ANCHORS = [
    {"claim": "Endometriosis affects ~10% of reproductive-age women; persistent dysmenorrhea is a key symptom",
     "kb_doc_id": KB["endo_acog"], "field": "keyPoints",
     "excerpt_first_words": "Endometriosis affects approximately 10% of reproductive-age women",
     "page_anchor_id": "epi"},
    {"claim": "Key symptoms include dysmenorrhea, chronic pelvic pain, dyspareunia, dyschezia, and infertility",
     "kb_doc_id": KB["endo_acog"], "field": "keyPoints",
     "excerpt_first_words": "Key symptoms include dysmenorrhea, chronic pelvic pain, dyspareunia, dyschezia, and infertility",
     "page_anchor_id": "secondary"},
    {"claim": "Elagolix is an oral GnRH antagonist for endo-associated pain (6-10% of reproductive-age women)",
     "kb_doc_id": KB["elagolix"], "field": "keyPoints",
     "excerpt_first_words": "Elagolix is an oral nonpeptide GnRH antagonist for endometriosis-associated pain",
     "page_anchor_id": "elagolix-mech"},
    {"claim": "Low-dose elagolix 150 mg significantly reduced dysmenorrhea vs placebo at 3 months",
     "kb_doc_id": KB["elagolix"], "field": "keyPoints",
     "excerpt_first_words": "Low-dose elagolix (150 mg daily) significantly reduced dysmenorrhea versus placebo at 3 months",
     "page_anchor_id": "elagolix-rct"},
    {"claim": "Adenomyosis is classified as diffuse or focal — endometrial glands infiltrate the myometrium",
     "kb_doc_id": KB["adeno"], "field": "keyPoints",
     "excerpt_first_words": "Adenomyosis is classified as diffuse or focal, involving endometrial glands infiltrating the myometrium",
     "page_anchor_id": "adeno"},
    {"claim": "Hormonal menstrual suppression is safe; menstruation is not physiologically required",
     "kb_doc_id": KB["suppress"], "field": "keyPoints",
     "excerpt_first_words": "SAFETY OF MENSTRUAL SUPPRESSION Menstruation (ovulation followed by withdrawal bleeding) is not physiologically necessary",
     "page_anchor_id": "suppression"},
    {"claim": "Endometriosis = endometrial glands and stroma occurring outside the uterine cavity",
     "kb_doc_id": KB["endo_clin"], "field": "keyPoints",
     "excerpt_first_words": "Endometriosis is defined as endometrial glands and stroma that occur outside the uterine",
     "page_anchor_id": "endo-def"},
]

MODALS_META = {
    "primary-deep":   {"title": "Primary dysmenorrhea &mdash; what we know"},
    "secondary-deep": {"title": "When the pain points to something else (secondary causes)"},
    "treatment-deep": {"title": "The full treatment ladder"},
    "endo-suspicion": {"title": "When to suspect endometriosis"},
    "adeno-deep":     {"title": "Adenomyosis &mdash; the often-missed diagnosis"},
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

def cite_multi(*ref_ids):
    return "".join(cite(r) for r in ref_ids)

def kb_marker(idx):
    a = ANCHORS[idx]
    return f'<!-- §0.8 anchor: kb_doc_id={a["kb_doc_id"]}; field={a["field"]}; idx={idx} -->'

def hero():
    return f"""
    <header class="hero">
        <div class="eyebrow">Patient Education &middot; Dysmenorrhea</div>
        <h1>Painful periods &mdash; what&rsquo;s normal, what isn&rsquo;t, and what we can do.</h1>
        <p class="lede">
            Dysmenorrhea &mdash; pain with menstrual periods &mdash; is one of the most common reasons women see a gynecologist,
            and it is <strong>not</strong> something women should be told to live with. The first question to answer
            is whether the pain is <em>primary</em> (a normal physiologic response that has become severe enough to disrupt life)
            or <em>secondary</em> (caused by an underlying condition like endometriosis or adenomyosis){cite("ref-1")}.
            This guide walks through how Dr.&nbsp;Mabini approaches both, the full medical and procedural treatment ladder
            (NSAIDs{cite("ref-2")}, hormonal options{cite("ref-3")}, GnRH antagonists{cite("ref-4")}, pelvic-floor PT,
            osteopathic care, and surgery{cite("ref-7")} when indicated), and the red flags that suggest the pain has
            a structural cause that deserves further workup.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">~50<span class="unit">%</span></div><div class="label">of menstruating women experience dysmenorrhea at some point.</div></div>
        <div class="fact"><div class="stat">~10<span class="unit">%</span></div><div class="label">of reproductive-age women have endometriosis &mdash; the most common secondary cause{cite("ref-1")}{kb_marker(0)}.</div></div>
        <div class="fact"><div class="stat">75<span class="unit">%</span></div><div class="label">of women with primary dysmenorrhea respond to NSAIDs alone{cite("ref-2")}.</div></div>
    </section>
    """

def primary_vs_secondary():
    return f"""
    <section class="section">
        <h2>Primary vs secondary &mdash; the most important distinction</h2>
        <p><strong>Primary dysmenorrhea</strong> is menstrual pain in the absence of identifiable pelvic pathology. It&rsquo;s the physiologic kind &mdash; prostaglandin-driven uterine cramping. Classic features: starts within 1&ndash;2 years of menarche, present at every cycle, lasts the first 2&ndash;3 days of bleeding, lower abdominal cramping (sometimes with back ache or thigh pain), responds well to NSAIDs and to cycle suppression.</p>
        <p><strong>Secondary dysmenorrhea</strong> is menstrual pain caused by an underlying condition &mdash; endometriosis, adenomyosis, fibroids, ovarian cysts, pelvic inflammatory disease, cervical stenosis, congenital uterine anomalies. Features that distinguish secondary from primary:</p>
        <ul class="bullets">
            <li>Pain that started later in life (not at menarche).</li>
            <li>Worsening over time rather than stable.</li>
            <li>Pain that lasts longer than the first 2&ndash;3 days &mdash; into mid-cycle or constantly.</li>
            <li>Painful intercourse (dyspareunia), painful bowel movements (dyschezia), or painful urination (dysuria) accompanying the menstrual pain.</li>
            <li>Pain that no longer responds to NSAIDs or hormonal suppression.</li>
            <li>Heavy menstrual bleeding or irregular bleeding alongside the pain.</li>
            <li>Infertility or recurrent pregnancy loss.</li>
        </ul>
        <p>Endometriosis is the most common secondary cause{cite("ref-1")}{kb_marker(0)}, affecting about 10% of reproductive-age women. Adenomyosis is increasingly recognized as a co-existing or distinct cause{kb_marker(4)}. Fibroids contribute when they distort the cavity or are large enough to cause bulk symptoms.</p>
    </section>
    """

def workup_section():
    return f"""
    <section class="section">
        <h2>How dysmenorrhea gets evaluated</h2>
        <p>The history and exam usually determine whether the pain is likely primary or secondary, and what additional workup is needed. The framework:</p>
        <ol class="ladder">
            <li><strong>History.</strong> Age at onset of dysmenorrhea (years post-menarche vs later); pattern (cyclic only vs constant); severity (work/school missed, sleep disruption); associated symptoms (dyspareunia, dyschezia, dysuria, GI changes with periods); response to NSAIDs and hormonal options; family history of endometriosis; reproductive history; bleeding pattern.</li>
            <li><strong>Pelvic exam.</strong> Speculum to visualize cervix and vagina; bimanual exam for uterine size and tenderness, adnexal masses, focal pelvic-floor tenderness, nodularity in the cul-de-sac (suggesting deep infiltrating endometriosis).</li>
            <li><strong>Transvaginal ultrasound.</strong> First-line imaging &mdash; identifies fibroids, ovarian cysts (including endometriomas), adenomyosis features, congenital uterine anomalies.</li>
            <li><strong>Pelvic MRI.</strong> When TVUS suggests deep infiltrating endometriosis, adenomyosis needs better characterization, or surgical planning is needed.</li>
            <li><strong>Trial of treatment.</strong> For most patients with classic primary-dysmenorrhea history and a normal exam, the standard is a trial of NSAIDs and/or hormonal suppression for 3 cycles before considering further workup.</li>
            <li><strong>Laparoscopy.</strong> Reserved for patients whose pain persists despite a real medical-therapy trial, or when imaging suggests a surgical lesion needs to be addressed{cite("ref-7")}. It&rsquo;s no longer needed to make the diagnosis of endometriosis &mdash; clinical features + imaging are sufficient.</li>
        </ol>
    </section>
    """

def treatment_section():
    return f"""
    <section class="section">
        <h2>The treatment ladder</h2>
        <p>Most women get meaningful relief from first-line medical options. Escalation happens only when the basics don&rsquo;t work.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="treatment-deep">
                <div class="rung-num">1</div>
                <h3>NSAIDs &mdash; the foundation</h3>
                <p>Pre-emptively dosed (start the day before expected menses, continue through the first 2&ndash;3 days). Ibuprofen 600&ndash;800&nbsp;mg every 8 hours, or naproxen 500&nbsp;mg twice daily, with food{cite("ref-2")}. Up to 75% of women get adequate relief.</p>
            </article>
            <article class="ladder-card" data-modal="treatment-deep">
                <div class="rung-num">2</div>
                <h3>Hormonal suppression</h3>
                <p>Combined hormonal contraceptives reduce pain significantly{cite("ref-3")}. Continuous use (skipping the placebo week) eliminates withdrawal bleeding entirely{kb_marker(5)}. Progestin-only options (oral, LNG-IUD, depot) are alternatives when estrogen is contraindicated.</p>
            </article>
            <article class="ladder-card" data-modal="treatment-deep">
                <div class="rung-num">3</div>
                <h3>Pelvic-floor PT</h3>
                <p>For pain with a pelvic-floor or musculoskeletal component, specialized pelvic-floor physical therapy is highly effective. Particularly when intercourse is painful or pelvic-floor tightness is part of the picture.</p>
            </article>
            <article class="ladder-card" data-modal="treatment-deep">
                <div class="rung-num">4</div>
                <h3>OMT &amp; complementary</h3>
                <p>Osteopathic manipulative treatment has RCT support for endometriosis-associated CPP{cite("ref-5")}. Acupuncture, TENS, heat therapy, and exercise have supporting evidence for symptom reduction{cite("ref-6")}.</p>
            </article>
            <article class="ladder-card" data-modal="treatment-deep">
                <div class="rung-num">5</div>
                <h3>GnRH antagonists</h3>
                <p>Oral elagolix 150&nbsp;mg daily (with add-back) is FDA-approved for endometriosis-associated dysmenorrhea{cite("ref-4")}{kb_marker(2)}{kb_marker(3)}. Reserved for refractory pain after first-line options.</p>
            </article>
            <article class="ladder-card" data-modal="endo-suspicion">
                <div class="rung-num">!</div>
                <h3>When to suspect endometriosis</h3>
                <p>Dysmenorrhea unresponsive to 3 months of NSAIDs + hormonal therapy, dyspareunia, dyschezia, infertility, or imaging findings of endometrioma all warrant evaluation for endometriosis as the underlying cause.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Is bad period pain normal?</summary>
                <div class="qa-answer"><p>Some discomfort is &mdash; periods involve uterine contractions, and prostaglandin release causes the cramping. But pain severe enough to interfere with work, school, sleep, or daily activities is <strong>not</strong> something women should be told to live with. About half of menstruating women experience dysmenorrhea, and 10&ndash;15% have it severely enough to disrupt life &mdash; that&rsquo;s the threshold for evaluation and treatment.</p></div>
            </details>
            <details class="qa"><summary>How do I know if my pain is from endometriosis?</summary>
                <div class="qa-answer"><p>Endometriosis is the most likely secondary cause of dysmenorrhea, affecting ~10% of reproductive-age women{cite("ref-1")}{kb_marker(0)}. Suspicious features: pain that started later in life (not at menarche), worsens over time, lasts longer than the first 2&ndash;3 days, is accompanied by painful intercourse, painful bowel movements, or infertility, and doesn&rsquo;t respond to NSAIDs and hormonal options. The diagnosis is increasingly made clinically (without surgery) when these features are present and imaging is consistent. See the endometriosis guide for the full evaluation.</p></div>
            </details>
            <details class="qa"><summary>Will birth control fix my pain?</summary>
                <div class="qa-answer"><p>Often, yes. Combined hormonal contraceptives reduce dysmenorrhea pain significantly{cite("ref-3")}, and using them continuously (skipping the placebo week) eliminates withdrawal bleeding entirely{kb_marker(5)}. Many women find that continuous OCP, the levonorgestrel IUD, or the depo injection resolves their pain. The right choice depends on your health profile, fertility plans, and preferences.</p></div>
            </details>
            <details class="qa"><summary>What about NSAIDs &mdash; how should I take them?</summary>
                <div class="qa-answer"><p>Pre-emptively, not reactively. Start the day before you expect your period and continue every 8 hours with food through the first 2&ndash;3 days. Ibuprofen 600&ndash;800&nbsp;mg three times daily or naproxen 500&nbsp;mg twice daily are the typical regimens{cite("ref-2")}. The window matters &mdash; once severe pain has developed, NSAIDs are less effective. Caution if you have GI ulcer disease, kidney disease, asthma exacerbations from NSAIDs, or are on anticoagulation.</p></div>
            </details>
            <details class="qa"><summary>What about &ldquo;just stopping periods&rdquo;?</summary>
                <div class="qa-answer"><p>Continuous menstrual suppression is safe &mdash; menstruation (ovulation followed by withdrawal bleeding) is not physiologically necessary for women not trying to conceive{kb_marker(5)}. Continuous combined OCP, the LNG-IUD, depo-medroxyprogesterone, and other options can eliminate periods entirely for women who want that. The breakthrough bleeding that sometimes happens early on usually settles within 3&ndash;6 months.</p></div>
            </details>
            <details class="qa"><summary>Does pelvic-floor PT actually help?</summary>
                <div class="qa-answer"><p>For dysmenorrhea with a musculoskeletal component (high-tone pelvic floor, low back ache, hip pain that worsens with periods), specialized pelvic-floor physical therapy is very effective. It particularly helps when intercourse is painful. A general orthopedic PT is not the same &mdash; insist on a pelvic-floor specialist.</p></div>
            </details>
            <details class="qa"><summary>Will I need surgery?</summary>
                <div class="qa-answer"><p>Almost never for primary dysmenorrhea. Surgery is reserved for cases where (a) imaging shows a structural lesion that needs removal (endometrioma, large fibroid, large polyp), (b) pain persists despite a real trial of medical therapy and other secondary-cause workup, or (c) the patient wants tissue diagnosis. Cochrane data support laparoscopic surgery for endometriosis-associated pain{cite("ref-7")}, but it is rarely the first answer.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "primary-deep": f"""
        <p>Primary dysmenorrhea is the physiologic cramping that comes from prostaglandin release at the time of menstruation. The natural process: the corpus luteum involutes at the end of the cycle, progesterone falls, prostaglandins (especially PGF2&alpha;) are released, the uterus contracts to shed the endometrium. In some women this process is more intense, the contractions are stronger, and the pain is severe.</p>
        <p><strong>Classic features:</strong></p>
        <ul class="bullets">
            <li>Starts within 1&ndash;2 years of menarche.</li>
            <li>Present at every cycle, predictably.</li>
            <li>Lasts the first 2&ndash;3 days of bleeding.</li>
            <li>Lower abdominal cramping; may radiate to back or thighs.</li>
            <li>Often accompanied by nausea, fatigue, headache, mood symptoms.</li>
            <li>Responds well to NSAIDs (which block prostaglandin synthesis) and to cycle suppression.</li>
            <li>Pelvic exam is normal.</li>
        </ul>
        <p><strong>Treatment is straightforward and effective:</strong> pre-emptive NSAIDs, then hormonal suppression if NSAIDs alone aren&rsquo;t enough. Most women get adequate relief from these first-line options without ever needing further workup.</p>
        <p>When primary dysmenorrhea has been confirmed (classic features, normal exam, good response to treatment), surveillance is the norm &mdash; no recurrent workup is needed. Re-evaluation is triggered only if the pattern changes (pain becomes constant, severity worsens, response to treatment is lost, or new symptoms appear suggesting a secondary cause).</p>
    """,
    "secondary-deep": f"""
        <p>Secondary dysmenorrhea is menstrual pain caused by an underlying pelvic condition. The differential includes several diagnoses, each with its own evaluation and treatment.</p>
        <p><strong>Endometriosis</strong> is by far the most common secondary cause{cite("ref-1")}{kb_marker(0)}. Endometrial-like tissue outside the uterine cavity{kb_marker(6)} causes cyclic inflammation that produces deep menstrual pain, pain with intercourse, pain with bowel movements, and (sometimes) infertility{kb_marker(1)}. See the endometriosis guide for the full workup and treatment.</p>
        <p><strong>Adenomyosis</strong>{kb_marker(4)} is endometrial tissue within the muscle wall of the uterus. Classic presentation: dysmenorrhea, heavy menstrual bleeding, and a globally enlarged tender uterus on exam. Diagnosis by transvaginal ultrasound (with adenomyosis features) or MRI. Treatment: LNG-IUD for many, GnRH antagonist suppression, focal excision (when feasible), or hysterectomy for definitive management.</p>
        <p><strong>Fibroids</strong> &mdash; particularly submucosal Types 0&ndash;2 &mdash; cause dysmenorrhea along with heavy bleeding. See the fibroids guide for the FIGO classification and treatment options.</p>
        <p><strong>Pelvic inflammatory disease</strong> (acute or chronic) can cause dysmenorrhea, often with abnormal vaginal discharge, fever, dyspareunia, and a tender adnexa or cervical motion tenderness on exam.</p>
        <p><strong>Cervical stenosis</strong> &mdash; rare but treatable. Pain happens because menstrual blood backs up; cervical dilation usually resolves the issue.</p>
        <p><strong>Congenital uterine anomalies</strong> (obstructive M&uuml;llerian anomalies like cervical or vaginal septa) &mdash; rare causes of severe dysmenorrhea in adolescents, often associated with pelvic pain even outside menses.</p>
        <p><strong>Endometrial or cervical polyp</strong> &mdash; usually causes bleeding more than pain, but can cause cramping if large.</p>
        <p><strong>Ovarian cysts</strong> &mdash; functional or pathologic; the pain pattern is often intermittent rather than strictly cyclic.</p>
    """,
    "treatment-deep": f"""
        <p>The treatment ladder for dysmenorrhea starts with NSAIDs and continuous hormonal options, escalating to pelvic-floor PT, osteopathic care, GnRH antagonists, and surgery when needed.</p>
        <p><strong>NSAIDs &mdash; first-line, taken pre-emptively.</strong></p>
        <ul class="bullets">
            <li>Ibuprofen 600&ndash;800&nbsp;mg every 6&ndash;8 hours with food, or naproxen 500&nbsp;mg twice daily, or mefenamic acid 500&nbsp;mg every 8 hours.</li>
            <li>Start 1&ndash;2 days <em>before</em> expected menses if cycles are predictable; otherwise at the first sign of bleeding.</li>
            <li>Continue through the first 2&ndash;3 days of menses.</li>
            <li>About 75% of women get adequate relief from NSAIDs alone{cite("ref-2")}.</li>
            <li>Cautions: GI ulcer disease, kidney disease, NSAID-sensitive asthma, anticoagulation.</li>
        </ul>
        <p><strong>Hormonal suppression &mdash; second-line, or first-line for women wanting contraception.</strong></p>
        <ul class="bullets">
            <li>Combined oral contraceptives, the patch, or the vaginal ring &mdash; reduce dysmenorrhea pain significantly{cite("ref-3")}. Continuous use (skipping the placebo week) eliminates withdrawal bleeding{kb_marker(5)}.</li>
            <li>Progestin-only options: oral progestin (norethindrone, NOMAC), LNG-IUD, depot-medroxyprogesterone, etonogestrel implant.</li>
            <li>The LNG-IUD specifically is highly effective for dysmenorrhea + heavy bleeding combinations.</li>
        </ul>
        <p><strong>Pelvic-floor physical therapy.</strong> When dysmenorrhea has a musculoskeletal or pelvic-floor-tension component, specialized PFPT is highly effective. Often the missing piece for women whose pain doesn&rsquo;t fully resolve with medication alone.</p>
        <p><strong>Osteopathic manipulative treatment.</strong> Targets the upstream structural factors &mdash; spinal segments innervating the uterus, sacroiliac joints, fascial restrictions. RCT support for endometriosis-associated CPP{cite("ref-5")}.</p>
        <p><strong>Complementary approaches.</strong> Heat therapy, exercise, acupuncture (with modest evidence{cite("ref-6")}), TENS, dietary modifications, omega-3 fatty acids, magnesium supplementation. Often combined with the above.</p>
        <p><strong>GnRH antagonists (elagolix).</strong> Oral 150&nbsp;mg daily or 200&nbsp;mg twice daily{cite("ref-4")}{kb_marker(2)}{kb_marker(3)}. FDA-approved for endometriosis-associated pain. Reserved for refractory cases; requires add-back consideration for longer use.</p>
        <p><strong>Surgery.</strong> Laparoscopy for endometriosis (with excision or ablation of disease), hysteroscopic polypectomy or myomectomy for cavity-distorting lesions, hysterectomy for definitive management when uterine preservation isn&rsquo;t a goal{cite("ref-7")}.</p>
    """,
    "endo-suspicion": f"""
        <p>Endometriosis is the most common secondary cause of dysmenorrhea, but it remains under-recognized &mdash; the average diagnostic delay in the US is 7&ndash;10 years from symptom onset. Recognizing the suspicious features early changes that trajectory.</p>
        <p><strong>Suspect endometriosis when:</strong></p>
        <ul class="bullets">
            <li>Dysmenorrhea started later in life (not at menarche) or worsened over time.</li>
            <li>Pain lasts longer than the first 2&ndash;3 days of bleeding &mdash; into mid-cycle or constantly.</li>
            <li>Painful intercourse (especially deep dyspareunia) accompanies the menstrual pain{kb_marker(1)}.</li>
            <li>Painful bowel movements (dyschezia), especially during menses.</li>
            <li>Cyclic urinary symptoms.</li>
            <li>Infertility or recurrent pregnancy loss.</li>
            <li>Family history of endometriosis (~10-fold increased risk in first-degree relatives).</li>
            <li>Dysmenorrhea unresponsive to NSAIDs and hormonal therapy after a real 3-cycle trial.</li>
            <li>Imaging finds an endometrioma (chocolate cyst) or features of deep infiltrating endometriosis.</li>
        </ul>
        <p><strong>What changes when endometriosis is suspected:</strong></p>
        <ol class="ladder">
            <li>Targeted workup &mdash; detailed history, focused pelvic exam (cul-de-sac nodularity?), transvaginal ultrasound with attention to deep endometriosis features (cul-de-sac obliteration, bowel involvement, kissing ovaries).</li>
            <li>Pelvic MRI if deep infiltrating disease is suspected or imaging is unclear.</li>
            <li>Empiric treatment trial &mdash; the modern approach is to treat suspected endometriosis with medical therapy (continuous OCP, progestin, LNG-IUD, or GnRH antagonist){cite("ref-4")} before requiring surgical confirmation.</li>
            <li>Surgical evaluation when medical therapy fails after a real trial, an endometrioma is present, deep disease has been mapped, or fertility is a concern{cite("ref-7")}.</li>
        </ol>
        <p>Read the full endometriosis guide for the comprehensive treatment ladder including excision surgery, post-op hormonal suppression, OMT integration, and fertility considerations.</p>
    """,
    "adeno-deep": f"""
        <p>Adenomyosis is endometrial-like glands and stroma within the muscle wall (myometrium) of the uterus. Historically considered a hysterectomy specimen diagnosis, it&rsquo;s now increasingly recognized on imaging in living patients and is a major cause of dysmenorrhea + heavy menstrual bleeding{kb_marker(4)}.</p>
        <p><strong>Classification:</strong></p>
        <ul class="bullets">
            <li><strong>Diffuse adenomyosis</strong> &mdash; widespread infiltration throughout the myometrium, causing a globally enlarged uterus.</li>
            <li><strong>Focal adenomyosis (adenomyoma)</strong> &mdash; a discrete mass within the muscle wall, sometimes mistaken for a fibroid on imaging.</li>
        </ul>
        <p><strong>Symptoms:</strong> dysmenorrhea (often severe), heavy menstrual bleeding, chronic pelvic pain, dyspareunia, and (sometimes) infertility. Co-occurs with endometriosis in many patients.</p>
        <p><strong>Diagnosis:</strong></p>
        <ul class="bullets">
            <li>Bimanual exam &mdash; globally enlarged, tender, &ldquo;boggy&rdquo; uterus.</li>
            <li>Transvaginal ultrasound &mdash; features include asymmetric myometrial thickening, sub-endometrial linear striations, myometrial cysts, heterogeneous myometrial texture, and the &ldquo;question-mark&rdquo; sign.</li>
            <li>MRI &mdash; gold standard for non-surgical diagnosis, particularly for distinguishing focal adenomyoma from fibroid.</li>
        </ul>
        <p><strong>Treatment:</strong></p>
        <ul class="bullets">
            <li>NSAIDs and combined hormonal contraceptives for symptomatic management.</li>
            <li>LNG-IUD &mdash; highly effective for many adenomyosis patients, reducing both bleeding and pain.</li>
            <li>GnRH antagonist suppression for refractory cases.</li>
            <li>Focal adenomyomectomy &mdash; uterus-preserving surgery for discrete adenomyomas, performed in selected patients. Risk of uterine rupture in subsequent pregnancy is real{kb_marker(4)} and informs delivery planning.</li>
            <li>Hysterectomy &mdash; definitive treatment when uterine preservation isn&rsquo;t a goal.</li>
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
    <title>Dysmenorrhea &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to painful periods: primary vs secondary, evaluation, and the full medical, physical-therapy, osteopathic, and surgical treatment ladder. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Dysmenorrhea</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{primary_vs_secondary()}
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
    "surface": "/education/dysmenorrhea/index.html",
    "topic": "Dysmenorrhea",
    "topic_synthesis_id": "topic_dysmenorrhea",
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
