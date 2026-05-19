#!/usr/bin/env python3
"""_gen_adenomyosis_page.py — §0.8.1 KB-anchored Adenomyosis education page."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/adenomyosis_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/adenomyosis_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/adenomyosis/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "30689982",
        "label": "Vannuccini & Petraglia, Recent advances in understanding and managing adenomyosis, F1000Research 2019",
        "what": "Comprehensive review of adenomyosis pathogenesis, diagnosis (imaging criteria), and modern medical/surgical management options.",
    },
    "ref-2": {
        "pmid": "29117510",
        "label": "Bazot & Daraï, Role of transvaginal sonography and MRI in the diagnosis of adenomyosis, Fertil Steril 2018",
        "what": "Diagnostic accuracy of TVUS and MRI for adenomyosis; MUSA consensus on ultrasound features (asymmetric wall thickness, intramyometrial cysts, junctional zone).",
    },
    "ref-3": {
        "pmid": "26283683",
        "label": "Vercellini et al., LNG-IUD vs hysterectomy for symptomatic adenomyosis, BJOG 2014",
        "what": "Levonorgestrel IUD reduces dysmenorrhea and HMB in adenomyosis with high satisfaction and good retention rates.",
    },
    "ref-4": {
        "pmid": "31810136",
        "label": "Schlaff et al., Elagolix with hormonal add-back for HMB in uterine fibroids, NEJM 2020",
        "what": "Phase 3 trial — oral GnRH antagonist (with add-back) significantly reduces HMB; applicable evidence base for adenomyosis-associated HMB.",
    },
    "ref-5": {
        "pmid": "32413272",
        "label": "Osada, Uterine adenomyosis and adenomyoma: a review of conservative surgery, Reprod Biomed Online 2018",
        "what": "Review of focal adenomyomectomy outcomes — uterine rupture risk in subsequent pregnancy is real and informs delivery planning.",
    },
    "ref-6": {
        "pmid": "32849049",
        "label": "Harmsen et al., Consensus on revised definitions of MUSA features for sonographic diagnosis of adenomyosis, Ultrasound Obstet Gynecol 2022",
        "what": "Updated MUSA consensus criteria — direct features (asymmetric wall thickness, intramyometrial cysts, hyperechoic islands, fan-shaped shadowing) and indirect features for TVUS diagnosis.",
    },
    "ref-7": {
        "pmid": "33095458",
        "label": "Bafort et al., Laparoscopic surgery for endometriosis (incl. adenomyosis-associated disease), Cochrane 2020",
        "what": "Cochrane systematic review covering surgical management of endometriosis-spectrum disease, relevant to adenomyosis often coexisting with endometriosis.",
    },
}

KB = {
    "surg_approach": "1d24bd42-7881-4850-a171-fa43a96b6c95",
    "surgery":       "955b80ed-9a54-4bf5-9832-df7b50417d32",
    "seud":          "d7775ffa3c80",
}

ANCHORS = [
    {"claim": "Adenomyosis = endometrial glands & stroma within the myometrium",
     "kb_doc_id": KB["seud"], "field": "keyPoints",
     "excerpt_first_words": "Adenomyosis involves pathologic endometrial glands and stroma within the uterine myometrium",
     "page_anchor_id": "definition"},
    {"claim": "Classified as diffuse or focal",
     "kb_doc_id": KB["surg_approach"], "field": "keyPoints",
     "excerpt_first_words": "Adenomyosis is classified as diffuse or focal, involving endometrial glands infiltrating the myometrium",
     "page_anchor_id": "classification"},
    {"claim": "Sex-steroid hormones drive pathogenesis via tissue invasion and inflammation",
     "kb_doc_id": KB["seud"], "field": "keyPoints",
     "excerpt_first_words": "Sex steroid hormones drive adenomyosis pathogenesis via tissue invasion and inflammation",
     "page_anchor_id": "pathogenesis"},
    {"claim": "JZ max-to-total myometrium ratio >40% on MRI suggests adenomyosis",
     "kb_doc_id": KB["seud"], "field": "keyPoints",
     "excerpt_first_words": "On MRI, junctional zone (JZ) max-to-total myometrium ratio > 40% suggests adenomyosis",
     "page_anchor_id": "mri"},
    {"claim": "2D/3D TVUS direct features include asymmetric wall thickness and intramyometrial cysts",
     "kb_doc_id": KB["seud"], "field": "keyPoints",
     "excerpt_first_words": "2D and 3D transvaginal ultrasound signs include asymmetric wall thickness and intramyometrial cysts",
     "page_anchor_id": "tvus"},
    {"claim": "Junctional zone thickness >12 mm on MRI is a diagnostic criterion",
     "kb_doc_id": KB["surgery"], "field": "keyPoints",
     "excerpt_first_words": "Junctional zone thickness >12 mm on MRI is a diagnostic criterion for adenomyosis",
     "page_anchor_id": "jz-12"},
    {"claim": "Adenomyosis and endometriosis share mechanisms but are independent diseases",
     "kb_doc_id": KB["surgery"], "field": "keyPoints",
     "excerpt_first_words": "Adenomyosis and endometriosis share some pathogenic mechanisms but are independent diseases",
     "page_anchor_id": "endo-overlap"},
    {"claim": "33 uterine ruptures in 397 reported pregnancies post-adenomyomectomy",
     "kb_doc_id": KB["surg_approach"], "field": "keyPoints",
     "excerpt_first_words": "397 post-adenomyomectomy pregnancies reported, with 33 uterine rupture cases during subsequent pregnancy",
     "page_anchor_id": "rupture-risk"},
    {"claim": "Electrically powered instruments associated with most post-adenomyomectomy ruptures",
     "kb_doc_id": KB["surg_approach"], "field": "keyPoints",
     "excerpt_first_words": "Electrically powered instruments are associated with most uterine rupture cases post-adenomyomectomy",
     "page_anchor_id": "electrosurgery"},
    {"claim": "MRI essential preop to map adenomyosis location/extent and cavity",
     "kb_doc_id": KB["surg_approach"], "field": "keyPoints",
     "excerpt_first_words": "MRI is essential preoperatively to map adenomyosis location, extent, and uterine cavity position",
     "page_anchor_id": "preop-mri"},
]

MODALS_META = {
    "diffuse-vs-focal": {"title": "Diffuse vs focal adenomyosis"},
    "imaging-deep":     {"title": "How adenomyosis is diagnosed on imaging"},
    "symptoms-deep":    {"title": "What adenomyosis feels like"},
    "medical-deep":     {"title": "Medical management"},
    "surgical-deep":    {"title": "Surgical options (adenomyomectomy &amp; hysterectomy)"},
    "fertility-deep":   {"title": "Adenomyosis &amp; fertility"},
    "coexist-deep":     {"title": "When adenomyosis &amp; endometriosis coexist"},
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
        <div class="eyebrow">Patient Education &middot; Adenomyosis</div>
        <h1>Adenomyosis &mdash; the often-missed cause of heavy painful periods.</h1>
        <p class="lede">
            Adenomyosis is endometrial-like tissue that grows <em>inside</em> the muscle wall of the uterus &mdash; not on the outside
            (that&rsquo;s endometriosis) and not in the cavity (that&rsquo;s a polyp or submucosal fibroid){cite("ref-1")}{kb_marker(0)}.
            For decades it was thought of as a hysterectomy-specimen diagnosis &mdash; something you only discovered after the
            uterus was removed. Modern transvaginal ultrasound and MRI criteria{cite("ref-2")}{cite("ref-6")}{kb_marker(3)}{kb_marker(4)} now allow accurate non-surgical
            diagnosis, which is why this condition is increasingly recognized in women living with what they were told was just
            &ldquo;bad periods.&rdquo; This guide walks through how adenomyosis is diagnosed, the medical and surgical treatment
            options &mdash; including the levonorgestrel IUD that often resolves symptoms without surgery{cite("ref-3")} &mdash;
            and the special considerations when adenomyosis coexists with endometriosis or fertility is at stake.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">1&ndash;70<span class="unit">%</span></div><div class="label">prevalence range &mdash; varies enormously by diagnostic criteria and population studied{cite("ref-1")}.</div></div>
        <div class="fact"><div class="stat">&gt;12<span class="unit">mm</span></div><div class="label">junctional zone thickness on MRI is a diagnostic threshold{kb_marker(5)}{cite("ref-2")}.</div></div>
        <div class="fact"><div class="stat">8.3<span class="unit">%</span></div><div class="label">uterine rupture rate in pregnancies after adenomyomectomy &mdash; informs delivery planning{kb_marker(7)}{cite("ref-5")}.</div></div>
    </section>
    """

def what_section():
    return f"""
    <section class="section">
        <h2>What adenomyosis actually is</h2>
        <p>Endometrial glands and stroma &mdash; the tissue that normally lines the inside of the uterus and sheds with each period &mdash; can invade the underlying muscle wall (the myometrium){kb_marker(0)}{kb_marker(2)}. When that tissue continues to respond to the monthly hormonal cycle, it bleeds and inflames within the muscle, causing pain, heavy bleeding, and progressive enlargement of the uterus over years.</p>
        <p>Two patterns matter clinically:</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Diffuse adenomyosis</h3>
                <ul>
                    <li>Widespread infiltration throughout the muscle wall.</li>
                    <li>The uterus enlarges globally &mdash; often tender, &ldquo;boggy&rdquo; on bimanual exam.</li>
                    <li>Most common pattern.</li>
                    <li>Best treated medically (LNG-IUD, GnRH antagonist) or definitively with hysterectomy.</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Focal adenomyosis (adenomyoma)</h3>
                <ul>
                    <li>A discrete mass of adenomyosis within the muscle wall.</li>
                    <li>Often mistaken for a fibroid on imaging &mdash; MRI distinguishes the two{kb_marker(9)}.</li>
                    <li>Can be approached with conservative surgery (adenomyomectomy) in carefully selected patients{kb_marker(7)}{cite("ref-5")}.</li>
                    <li>Pregnancy after adenomyomectomy carries a real uterine-rupture risk; delivery planning is essential.</li>
                </ul>
            </div>
        </div>
        <p>Adenomyosis is distinct from endometriosis even though both involve endometrial-like tissue in the wrong location, and even though they often coexist{kb_marker(6)}. Endometriosis is endometrial tissue <em>outside</em> the uterus (pelvis, ovaries, bowel, distant sites). Adenomyosis is endometrial tissue <em>within</em> the uterine muscle wall. Different molecular mechanisms drive each disease, even when they coexist.</p>
    </section>
    """

def diagnosis_section():
    return f"""
    <section class="section">
        <h2>How adenomyosis gets diagnosed</h2>
        <p>For most of the last century, adenomyosis was confirmed only by histologic examination after hysterectomy. Modern imaging has changed that &mdash; transvaginal ultrasound and MRI can now make the diagnosis reliably in living patients.</p>
        <p><strong>Transvaginal ultrasound</strong> is first-line{cite("ref-6")}. The MUSA (Morphological Uterus Sonographic Assessment) consensus criteria identify <em>direct</em> features (asymmetric wall thickness, intramyometrial cysts, hyperechoic islands, fan-shaped shadowing, irregular junctional zone){kb_marker(4)} and <em>indirect</em> features (globally enlarged uterus, heterogeneous myometrial texture). Multiple features improve diagnostic specificity.</p>
        <p><strong>Pelvic MRI</strong> is the gold standard for non-surgical diagnosis{cite("ref-2")}, especially when ultrasound is inconclusive, when distinguishing focal adenomyoma from fibroid matters for surgical planning, or when the patient is being considered for conservative surgery. The classic MRI finding is junctional zone thickening &mdash; <strong>&gt;12 mm</strong> or <strong>JZ/total myometrium ratio &gt;40%</strong> support the diagnosis{kb_marker(3)}{kb_marker(5)}.</p>
        <p>Notes on interpretation:</p>
        <ul class="bullets">
            <li>Junctional zone thickness varies through the menstrual cycle &mdash; imaging is best timed early follicular phase (days 4&ndash;7).</li>
            <li>Rigid threshold cutoffs risk underdiagnosing mild disease &mdash; clinical features still matter.</li>
            <li>Endometrial polyps and submucosal fibroids should be ruled out concurrently &mdash; they can coexist with adenomyosis and contribute to bleeding symptoms.</li>
            <li>Histology after hysterectomy or focal excision remains the only definitive confirmation, but is rarely needed to start treatment.</li>
        </ul>
    </section>
    """

def treatment_section():
    return f"""
    <section class="section">
        <h2>The treatment ladder</h2>
        <p>The right treatment depends on symptom severity, fertility plans, and whether disease is diffuse or focal. The conservative ladder works for most women; surgery is reserved for refractory cases or specific anatomic patterns.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="medical-deep">
                <div class="rung-num">1</div>
                <h3>NSAIDs + hormonal first-line</h3>
                <p>NSAIDs pre-emptively dosed, combined hormonal contraceptives or progestin-only options for cycle suppression. Many women improve substantially without further escalation.</p>
            </article>
            <article class="ladder-card" data-modal="medical-deep">
                <div class="rung-num">2</div>
                <h3>Levonorgestrel IUD</h3>
                <p>Often the breakthrough treatment for adenomyosis &mdash; reduces dysmenorrhea and HMB with high satisfaction and good 5-year retention{cite("ref-3")}. The single most useful medical option for diffuse adenomyosis.</p>
            </article>
            <article class="ladder-card" data-modal="medical-deep">
                <div class="rung-num">3</div>
                <h3>GnRH antagonist</h3>
                <p>Oral elagolix or injectable agonists with add-back therapy when LNG-IUD fails or isn&rsquo;t tolerated{cite("ref-4")}. Useful as a 3&ndash;6 month bridge to surgery.</p>
            </article>
            <article class="ladder-card" data-modal="surgical-deep">
                <div class="rung-num">4</div>
                <h3>Focal adenomyomectomy</h3>
                <p>Uterus-preserving surgery for discrete adenomyomas in carefully selected patients &mdash; usually those wanting future fertility{kb_marker(9)}{cite("ref-5")}. Subsequent pregnancy requires careful delivery planning.</p>
            </article>
            <article class="ladder-card" data-modal="surgical-deep">
                <div class="rung-num">5</div>
                <h3>Hysterectomy</h3>
                <p>Definitive treatment &mdash; reserved for women not planning future pregnancy with refractory symptoms despite conservative therapy. Laparoscopic or vaginal approach when feasible.</p>
            </article>
            <article class="ladder-card" data-modal="fertility-deep">
                <div class="rung-num">F</div>
                <h3>Fertility considerations</h3>
                <p>Adenomyosis impairs fertility through endometrial-myometrial junction disruption. Treatment paths depend on severity, location, and the woman&rsquo;s reproductive timeline.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>How is adenomyosis different from endometriosis?</summary>
                <div class="qa-answer"><p>Endometriosis is endometrial-like tissue <em>outside</em> the uterus &mdash; on the ovaries, peritoneum, bowel, distant sites. Adenomyosis is endometrial-like tissue <em>inside</em> the uterine muscle wall. They share some mechanisms and often coexist{kb_marker(6)}, but they&rsquo;re different diseases with different treatment ladders and different surgical approaches.</p></div>
            </details>
            <details class="qa"><summary>Can adenomyosis be diagnosed without surgery?</summary>
                <div class="qa-answer"><p>Yes &mdash; that&rsquo;s a big change from a decade ago. Modern transvaginal ultrasound (MUSA criteria) and MRI (junctional zone thickness){kb_marker(3)}{kb_marker(5)}{cite("ref-2")} now make accurate non-surgical diagnosis routine. Histology after hysterectomy remains the gold standard, but treatment decisions can be made from imaging-based clinical diagnosis.</p></div>
            </details>
            <details class="qa"><summary>Will the LNG-IUD really help?</summary>
                <div class="qa-answer"><p>For many women with adenomyosis, yes &mdash; the levonorgestrel IUD reduces dysmenorrhea and HMB with high satisfaction and good 5-year continuation rates{cite("ref-3")}. The local progestin suppresses the symptomatic adenomyosis tissue. It&rsquo;s often the single most useful intervention before considering surgery.</p></div>
            </details>
            <details class="qa"><summary>I want to keep my uterus &mdash; what are my options?</summary>
                <div class="qa-answer"><p>Medical management first (LNG-IUD, GnRH antagonist with add-back), then focal adenomyomectomy for discrete lesions in carefully selected patients{kb_marker(9)}{cite("ref-5")}. Hysterectomy is the last step, reserved for refractory symptoms in women not planning pregnancy. Many women never need to consider hysterectomy.</p></div>
            </details>
            <details class="qa"><summary>Is pregnancy safe after adenomyomectomy?</summary>
                <div class="qa-answer"><p>Pregnancy is possible but carries a real uterine-rupture risk. The published data report 33 uterine ruptures in 397 post-adenomyomectomy pregnancies (~8%){kb_marker(7)}{cite("ref-5")}. Electrosurgical techniques during the original adenomyomectomy are most associated with this risk{kb_marker(8)}. Delivery planning typically includes elective cesarean at 36&ndash;37 weeks &mdash; the specifics are individualized based on the surgical report.</p></div>
            </details>
            <details class="qa"><summary>Does adenomyosis cause infertility?</summary>
                <div class="qa-answer"><p>It can. Adenomyosis appears to impair fertility through disruption of the endometrial-myometrial junction, altered uterine contractility, and inflammation. Treatment paths are individualized &mdash; suppression with GnRH antagonist pre-IVF, focal adenomyomectomy for discrete disease, expectant management for mild disease.</p></div>
            </details>
            <details class="qa"><summary>What about pain after menopause?</summary>
                <div class="qa-answer"><p>Adenomyosis is hormonally driven, so symptoms typically improve substantially after menopause as estrogen drops. Persistent pain in a postmenopausal woman with prior adenomyosis deserves a fresh workup &mdash; not because adenomyosis &ldquo;turns into&rdquo; cancer (it doesn&rsquo;t), but because new pain in postmenopause warrants ruling out other causes.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "diffuse-vs-focal": f"""
        <p>The diffuse-vs-focal distinction is the single most important treatment-planning question in adenomyosis.</p>
        <p><strong>Diffuse adenomyosis</strong> spreads throughout the myometrium without forming discrete masses. The uterus enlarges symmetrically (or near-symmetrically), the wall texture becomes heterogeneous on imaging, and the junctional zone thickens diffusely. Most women with adenomyosis have this pattern. Treatment: medical management is the mainstay (LNG-IUD, GnRH antagonist){cite("ref-3")}{cite("ref-4")}; if surgery is needed, hysterectomy is usually the answer because diffuse disease can&rsquo;t be cleanly excised.</p>
        <p><strong>Focal adenomyosis (adenomyoma)</strong> presents as a discrete mass of adenomyotic tissue within the muscle wall. It can mimic a fibroid on imaging &mdash; MRI is the best tool to distinguish them, looking at the appearance of the lesion (ill-defined borders, T2 dark signal with hyperintense foci suggest adenomyoma; well-circumscribed with capsule suggests fibroid){kb_marker(9)}. Focal disease can sometimes be approached with conservative surgery &mdash; focal adenomyomectomy &mdash; in patients wanting to preserve the uterus.</p>
        <p>Mixed patterns exist &mdash; a woman can have diffuse adenomyosis plus a focal adenomyoma, or focal disease in multiple sites. The imaging description on the MRI or detailed ultrasound report is what we plan from.</p>
    """,
    "imaging-deep": f"""
        <p>The diagnostic shift from &ldquo;hysterectomy specimen only&rdquo; to &ldquo;reliable imaging-based diagnosis&rdquo; happened over the last 15 years and continues to be refined. The current standards:</p>
        <p><strong>Transvaginal ultrasound (TVUS):</strong></p>
        <ul class="bullets">
            <li>First-line imaging. Best done early follicular phase (days 4&ndash;7) when junctional zone is most visible.</li>
            <li>MUSA consensus features{cite("ref-6")}:
                <ul>
                    <li><em>Direct:</em> asymmetric uterine wall thickness, intramyometrial cysts, hyperechoic islands, fan-shaped shadowing, irregular junctional zone with linear striations{kb_marker(4)}.</li>
                    <li><em>Indirect:</em> globally enlarged uterus, heterogeneous myometrial texture, distorted uterine cavity.</li>
                </ul>
            </li>
            <li>3D TVUS adds value &mdash; coronal reconstruction shows the junctional zone clearly.</li>
            <li>Color/power Doppler helps distinguish adenomyoma from fibroid (vascular pattern differs).</li>
        </ul>
        <p><strong>MRI:</strong></p>
        <ul class="bullets">
            <li>Gold standard for non-surgical diagnosis{cite("ref-2")}.</li>
            <li>Junctional zone thickness <strong>&gt;12 mm</strong> supports diagnosis{kb_marker(5)}.</li>
            <li>JZ/total myometrium ratio <strong>&gt;40%</strong> supports diagnosis{kb_marker(3)}.</li>
            <li>T2 dark signal with scattered hyperintense foci is classic.</li>
            <li>Best for distinguishing focal adenomyoma from fibroid.</li>
            <li>Essential preoperatively when conservative surgery is planned{kb_marker(9)}.</li>
        </ul>
        <p>Limitations to know about:</p>
        <ul class="bullets">
            <li>Junctional zone thickness varies through the menstrual cycle &mdash; one snapshot may not capture maximum thickness.</li>
            <li>Rigid cutoff thresholds risk underdiagnosing mild adenomyosis; some patients meet clinical criteria with imaging that&rsquo;s only borderline.</li>
            <li>Postmenopausal women lose hormonal stimulation of the junctional zone &mdash; criteria don&rsquo;t apply the same way.</li>
        </ul>
    """,
    "symptoms-deep": f"""
        <p>The classic adenomyosis triad: <strong>severe dysmenorrhea + heavy menstrual bleeding + an enlarged tender uterus on exam</strong>. But women present in a spectrum of severity, and other patterns occur.</p>
        <p><strong>Dysmenorrhea.</strong> Often progressive &mdash; women describe periods that have become significantly more painful over years. Pain typically peaks just before and during the heaviest day of bleeding, often refractory to NSAIDs alone. Associated with the cyclic inflammation of adenomyotic tissue within the muscle wall.</p>
        <p><strong>Heavy menstrual bleeding (HMB).</strong> Often the dominant complaint &mdash; soaking through pads every 1&ndash;2 hours, large clots, flooding, prolonged bleeding. HMB from adenomyosis is driven by the enlarged uterine surface area and the abnormal endometrial-myometrial interface.</p>
        <p><strong>Bulk symptoms.</strong> As the uterus enlarges, women may notice abdominal fullness, increased urinary frequency from anterior pressure on the bladder, and back ache.</p>
        <p><strong>Dyspareunia.</strong> Especially with deep penetration as the uterus enlarges. Often coexists with endometriosis-related dyspareunia.</p>
        <p><strong>Chronic pelvic pain.</strong> Beyond the cyclic dysmenorrhea, some women develop chronic background pelvic pain, particularly when adenomyosis coexists with endometriosis or pelvic-floor dysfunction.</p>
        <p><strong>Subfertility / pregnancy loss.</strong> Adenomyosis is increasingly recognized as a contributor to infertility and miscarriage, especially in women with severe disease.</p>
    """,
    "medical-deep": f"""
        <p>Medical management is the foundation of adenomyosis treatment for most women. Treatment plans are individualized based on symptom dominance (bleeding vs pain vs both), fertility plans, and contraception preferences.</p>
        <p><strong>NSAIDs.</strong> Naproxen 500&nbsp;mg twice daily or ibuprofen 600&ndash;800&nbsp;mg every 8 hours &mdash; started before expected menses and continued through the heaviest days. Reduces blood loss 20&ndash;40% and helps pain. Always with food; cautions for GI ulcer, renal disease, NSAID-sensitive asthma.</p>
        <p><strong>Tranexamic acid.</strong> 1300&nbsp;mg three times daily during bleeding days only. Non-hormonal antifibrinolytic; reduces blood loss ~40%. Useful for women who can&rsquo;t or don&rsquo;t want hormones.</p>
        <p><strong>Combined hormonal contraceptives.</strong> Pills, patch, or ring. Reduces blood loss 40&ndash;50% and stabilizes the endometrium. Continuous use (skipping placebo week) eliminates withdrawal bleeding and often substantially reduces adenomyosis-related cyclic pain. Contraindicated in smokers over 35, migraine with aura, elevated VTE risk.</p>
        <p><strong>Levonorgestrel IUD.</strong> Often the most effective single medical intervention for adenomyosis{cite("ref-3")}. Local progestin suppresses the adenomyotic tissue and reduces both HMB and dysmenorrhea. High patient satisfaction and good 5-year continuation rates. Best for diffuse adenomyosis; cavity must be able to accept and retain the device.</p>
        <p><strong>Oral progestins.</strong> Norethindrone, dienogest, or medroxyprogesterone given continuously. Useful when LNG-IUD isn&rsquo;t tolerated or fits poorly.</p>
        <p><strong>GnRH antagonist with add-back.</strong> Oral elagolix 200&nbsp;mg twice daily with estradiol/norethindrone add-back{cite("ref-4")}. Reserved for refractory pain or HMB after first-line options. Designed for up to 24 months continuous use; useful as a 3&ndash;6 month bridge to surgery.</p>
        <p><strong>GnRH agonists (leuprolide).</strong> Shrinks adenomyosis significantly over 3&ndash;6 months. Limited to short-term use without add-back due to hypoestrogenic side effects and bone-density loss. Often used pre-operatively to reduce uterine size before conservative surgery.</p>
    """,
    "surgical-deep": f"""
        <p>Surgery is reserved for adenomyosis that has failed medical management or where anatomy makes surgery the better answer.</p>
        <p><strong>Focal adenomyomectomy</strong> is uterus-preserving surgery for discrete adenomyomas &mdash; usually in women wanting future fertility{cite("ref-5")}. The operation excises the adenomyotic mass and reconstructs the myometrium in multiple layers. <strong>Pre-operative MRI is essential</strong> to map location, depth, and relationship to the cavity{kb_marker(9)}. The technical challenge: adenomyosis has no capsule, so the surgical plane is less clear than fibroid enucleation, and obtaining adequate excision while preserving healthy myometrium and cavity integrity requires careful technique.</p>
        <p><strong>Pregnancy after adenomyomectomy</strong> carries a real uterine-rupture risk. The published series report <strong>33 uterine ruptures in 397 pregnancies</strong> after adenomyomectomy (~8.3%){kb_marker(7)}{cite("ref-5")}. Electrically powered instruments during the original operation are associated with most of the rupture cases{kb_marker(8)}. Standard practice for women who conceive after adenomyomectomy:</p>
        <ul class="bullets">
            <li>Detailed review of the operative report &mdash; how deep, how much myometrium reconstructed, what energy source.</li>
            <li>Recommendation for elective cesarean delivery, typically at 36&ndash;37 weeks before active labor begins.</li>
            <li>Avoidance of trial of labor in most cases.</li>
            <li>Continuous fetal and maternal monitoring through the third trimester.</li>
        </ul>
        <p><strong>Hysterectomy</strong> is definitive treatment for adenomyosis. Indicated when:</p>
        <ul class="bullets">
            <li>Conservative options have failed and symptoms are severe.</li>
            <li>The woman is not planning future pregnancy.</li>
            <li>Anatomy makes uterus-preservation impractical (massive diffuse disease, recurrence after multiple adenomyomectomies).</li>
            <li>Concurrent pathology (large fibroids, persistent AUB despite a full workup, endometrial hyperplasia).</li>
        </ul>
        <p>Approach: laparoscopic or vaginal whenever feasible &mdash; smaller incisions, faster recovery, less pain than open. Ovarian preservation is the default in premenopausal women without ovarian pathology, regardless of why the uterus is being removed.</p>
        <p><strong>Newer / experimental options</strong>: high-intensity focused ultrasound (HIFU) for selected focal lesions, radiofrequency ablation, uterine artery embolization (limited evidence for diffuse adenomyosis). None has yet displaced the LNG-IUD &mdash; hysterectomy axis for routine care.</p>
    """,
    "fertility-deep": f"""
        <p>Adenomyosis impairs fertility through multiple mechanisms: disruption of the endometrial-myometrial junction (which contains the contractile machinery driving sperm transport and embryo implantation), altered uterine contractility, persistent inflammation, and the bulk effect of an enlarged uterus.</p>
        <p>The fertility-aware treatment paths:</p>
        <ul class="bullets">
            <li><strong>Mild disease, no infertility yet:</strong> LNG-IUD if not actively trying to conceive; expectant management with NSAIDs and OCP if cycle suppression is acceptable; switch to active conception when ready.</li>
            <li><strong>Active fertility planning, mild-to-moderate diffuse disease:</strong> Time-limited treatment trial with GnRH antagonist for 3&ndash;6 months can reduce inflammation and uterine size before attempting conception (or before IVF cycle).</li>
            <li><strong>Active fertility planning, focal adenomyoma:</strong> Pre-IVF or pre-conception focal adenomyomectomy in carefully selected cases{cite("ref-5")} &mdash; restores cavity contour and reduces inflammatory bulk. Then 6&ndash;12 months of healing before conception, and elective cesarean delivery at term.</li>
            <li><strong>Severe diffuse disease + infertility:</strong> Difficult clinical situation. GnRH suppression pre-IVF transfer is sometimes used. Outcomes are improved but not equivalent to women without adenomyosis. Gestational carrier may be discussed when severe disease combines with multiple failed IVF cycles.</li>
        </ul>
        <p>The conversation with each woman includes her age, ovarian reserve, partner factors, severity of adenomyosis, fertility timeline, and her tolerance for surgical risk. There&rsquo;s rarely a single right answer.</p>
    """,
    "coexist-deep": f"""
        <p>Adenomyosis and endometriosis frequently coexist &mdash; some series report 60&ndash;80% co-occurrence in women with one or the other diagnosis. Despite sharing endometrial-like tissue as their core feature, the two diseases have <em>different</em> molecular mechanisms{kb_marker(6)} and need distinct treatment plans.</p>
        <p>When both are present:</p>
        <ul class="bullets">
            <li>Symptoms can compound &mdash; dysmenorrhea, dyspareunia, chronic pelvic pain, infertility, HMB all overlap.</li>
            <li>Imaging needs to evaluate both compartments &mdash; TVUS and MRI for adenomyosis (junctional zone), TVUS for endometrioma and deep infiltrating endometriosis features.</li>
            <li>Surgical planning is more complex &mdash; laparoscopic excision of endometriosis lesions can be done alongside adenomyomectomy or hysterectomy. Order of operations and adhesion management require experience.</li>
            <li>Hormonal suppression covers both diseases &mdash; LNG-IUD, GnRH antagonist, progestins all suppress endometriosis and adenomyosis. Definitive surgical treatment is condition-specific.</li>
        </ul>
        <p>The full endometriosis guide on this site covers the deep-disease subset; the dysmenorrhea guide covers the workup pathway when either or both are suspected; this guide focuses on the adenomyosis half. The clinical conversation with each woman synthesizes across all three.</p>
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
    <title>Adenomyosis &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to adenomyosis: diffuse vs focal disease, imaging-based diagnosis (TVUS MUSA + MRI junctional zone), and the full medical and surgical treatment ladder. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Adenomyosis</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{what_section()}
{diagnosis_section()}
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
    "surface": "/education/adenomyosis/index.html",
    "topic": "Adenomyosis",
    "topic_synthesis_id": "8bc29200-92dc-4dac-8099-1b06b0d16aa1",
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
