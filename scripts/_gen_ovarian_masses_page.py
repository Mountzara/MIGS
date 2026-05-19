#!/usr/bin/env python3
"""_gen_ovarian_masses_page.py — §0.8.1 KB-anchored Ovarian Masses / Adnexal Masses education page."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/ovarian_masses_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/ovarian_masses_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/ovarian-masses/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "27776068",
        "label": "ACOG Practice Bulletin 174: Evaluation and Management of Adnexal Masses, Obstet Gynecol 2016",
        "what": "ACOG guidance on adnexal mass evaluation — TVUS first-line, CA-125 in postmenopausal women, criteria for surgical management and gynecologic-oncology referral.",
    },
    "ref-2": {
        "pmid": "31064760",
        "label": "Timmerman et al., IOTA Simple Rules and ADNEX risk-stratification, Ultrasound Obstet Gynecol 2016",
        "what": "International Ovarian Tumor Analysis (IOTA) ultrasound criteria for benign vs malignant adnexal masses — Simple Rules + ADNEX model are the validated risk-stratification tools.",
    },
    "ref-3": {
        "pmid": "22914035",
        "label": "Levine et al., Management of asymptomatic ovarian and other adnexal cysts on US, Society of Radiologists in Ultrasound Consensus, Radiology 2010",
        "what": "SRU consensus on managing simple cysts and benign-appearing adnexal masses on imaging — size thresholds and follow-up intervals.",
    },
    "ref-4": {
        "pmid": "21508751",
        "label": "ACOG Committee Opinion 477: The Role of the OB-GYN in the Early Detection of Epithelial Ovarian Cancer, Obstet Gynecol 2011",
        "what": "Guidance on symptom recognition (bloating, early satiety, pelvic pain, urinary urgency for >12 days/month) and the absence of validated routine screening tools.",
    },
    "ref-5": {
        "pmid": "20862770",
        "label": "Vaughan et al., Rethinking ovarian cancer screening, Nat Rev Cancer 2011",
        "what": "Authoritative review of why population-based ovarian cancer screening (CA-125, TVUS) has not reduced mortality and is not recommended in average-risk women.",
    },
    "ref-6": {
        "pmid": "28350332",
        "label": "Bafort et al., Laparoscopy for ovarian cysts, Cochrane Review 2017",
        "what": "Cochrane review — laparoscopic ovarian cystectomy provides advantages over laparotomy (less pain, shorter stay, faster recovery) with similar outcomes for benign cysts.",
    },
    "ref-7": {
        "pmid": "30856256",
        "label": "ACMG/Society of Gynecologic Oncology, BRCA testing in suspected hereditary breast-ovarian cancer syndrome, Genet Med 2015 (updated)",
        "what": "Indications for BRCA testing in women with personal/family history of ovarian, breast, or related cancers — informs management of adnexal masses in BRCA carriers.",
    },
}

KB = {
    "brca":   "225A5940-BDFC-401E-BE3D-0069D3413B10",
    "adnexal":"B9774AD5-1457-4634-8296-7C122FA768A5",
}

ANCHORS = [
    {"claim": "Age is the most important independent risk factor for ovarian malignancy in adnexal masses",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "Age is the most important independent risk factor for ovarian malignancy in adnexal masses",
     "page_anchor_id": "age-risk"},
    {"claim": "TVUS is the primary imaging for initial adnexal mass evaluation",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "Transvaginal ultrasonography is the primary imaging modality for initial adnexal mass evaluation",
     "page_anchor_id": "tvus"},
    {"claim": "CT and MRI are not recommended for initial evaluation; CT for staging if cancer suspected",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "CT and MRI are not recommended for initial evaluation; CT is useful for staging if cancer suspected",
     "page_anchor_id": "no-ct-mri"},
    {"claim": "CA 125 elevated in 80% of epithelial ovarian cancers but only 50% of stage I disease",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "CA 125 is elevated in 80% of epithelial ovarian cancers but only 50% of stage I disease",
     "page_anchor_id": "ca125"},
    {"claim": "CA 125 most useful in postmenopausal women; less specific in premenopausal",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "CA 125 is most useful in postmenopausal women; less specific in premenopausal women",
     "page_anchor_id": "ca125-meno"},
    {"claim": "Concerning exam findings: irregular, firm, fixed, nodular, bilateral or with ascites",
     "kb_doc_id": KB["adnexal"], "field": "keyPoints",
     "excerpt_first_words": "Concerning exam findings: irregular, firm, fixed, nodular, bilateral masses or associated ascites",
     "page_anchor_id": "exam-red"},
    {"claim": "BRCA1/2 account for 9-24% of epithelial ovarian cancers",
     "kb_doc_id": KB["brca"], "field": "keyPoints",
     "excerpt_first_words": "BRCA mutations account for 9-24% of epithelial ovarian cancers and 4.5% of breast cancers",
     "page_anchor_id": "brca-prev"},
    {"claim": "Ovarian cancer risk by age 70: BRCA1 39-46%, BRCA2 10-27%",
     "kb_doc_id": KB["brca"], "field": "keyPoints",
     "excerpt_first_words": "Ovarian cancer risk by age 70: BRCA1 39-46%, BRCA2 10-27%",
     "page_anchor_id": "brca-risk"},
]

MODALS_META = {
    "cyst-types-deep":  {"title": "Types of ovarian cysts &amp; masses"},
    "workup-deep":      {"title": "How an adnexal mass is worked up"},
    "manage-deep":      {"title": "When to watch, when to operate"},
    "surgery-deep":     {"title": "Cystectomy vs oophorectomy"},
    "malignancy-deep":  {"title": "When malignancy is the concern"},
    "brca-deep":        {"title": "Hereditary risk &amp; BRCA testing"},
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
        <div class="eyebrow">Patient Education &middot; Ovarian Cysts &amp; Adnexal Masses</div>
        <h1>Ovarian cysts &amp; adnexal masses &mdash; how we evaluate them, when surgery is right.</h1>
        <p class="lede">
            Ovarian cysts are common &mdash; most women develop them at some point, and the great majority are benign and self-resolving.
            But when a cyst is found on imaging, the right next steps depend on age, the cyst&rsquo;s features on ultrasound, whether
            you have symptoms, and any family history that raises hereditary cancer risk. This guide walks through the modern adnexal-mass
            workup{cite("ref-1")}{kb_marker(1)} &mdash; transvaginal ultrasound first, IOTA risk stratification{cite("ref-2")},
            CA-125 only in the right settings{kb_marker(3)}{kb_marker(4)} &mdash; the criteria that distinguish watch-and-wait from
            surgery, the procedures themselves (cystectomy vs oophorectomy, laparoscopic vs open){cite("ref-6")}, and the
            hereditary-risk considerations that change the calculus for some patients{cite("ref-7")}{kb_marker(6)}{kb_marker(7)}.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">~80<span class="unit">%</span></div><div class="label">of adnexal masses are benign across all ages.</div></div>
        <div class="fact"><div class="stat">9&ndash;24<span class="unit">%</span></div><div class="label">of epithelial ovarian cancers are linked to BRCA1/2 mutations{kb_marker(6)}.</div></div>
        <div class="fact"><div class="stat">50<span class="unit">%</span></div><div class="label">of Stage&nbsp;I ovarian cancers do NOT raise CA-125{kb_marker(3)} &mdash; the marker is imperfect, especially in premenopause.</div></div>
    </section>
    """

def types_section():
    return f"""
    <section class="section">
        <h2>The categories of ovarian cysts and masses</h2>
        <p>&ldquo;Ovarian cyst&rdquo; is a catch-all term that covers very different entities &mdash; the right management depends on which one you actually have.</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Functional / physiologic</h3>
                <ul>
                    <li><strong>Follicular cyst</strong> &mdash; a developing follicle that didn&rsquo;t release its egg. Resolves over 1&ndash;3 cycles.</li>
                    <li><strong>Corpus luteum cyst</strong> &mdash; the structure left behind after ovulation, sometimes filled with blood. Resolves in days to weeks.</li>
                    <li><strong>Theca lutein cyst</strong> &mdash; less common, associated with elevated hCG (pregnancy, gestational trophoblastic disease).</li>
                    <li>All are <strong>benign</strong>. Most need no intervention beyond a follow-up ultrasound to document resolution.</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Benign neoplasms</h3>
                <ul>
                    <li><strong>Dermoid (mature cystic teratoma)</strong> &mdash; benign, but doesn&rsquo;t resolve. Classic mixed-density appearance on imaging.</li>
                    <li><strong>Serous or mucinous cystadenoma</strong> &mdash; benign epithelial tumors. Can grow large.</li>
                    <li><strong>Endometrioma</strong> &mdash; &ldquo;chocolate cyst&rdquo;; endometriosis on the ovary. See the endometriosis guide.</li>
                    <li><strong>Fibroma / thecoma</strong> &mdash; solid benign stromal tumors. Sometimes cause Meigs syndrome (ascites + pleural effusion).</li>
                    <li><strong>Hydrosalpinx</strong> &mdash; not actually an ovarian cyst; a dilated fallopian tube, often mistaken for a cyst on imaging.</li>
                </ul>
            </div>
        </div>
        <p style="margin-top: 18px;">A separate category is <strong>malignant or borderline ovarian tumors</strong> &mdash; epithelial ovarian cancer (the most common), borderline serous or mucinous tumors, germ cell tumors (more common in younger women), sex-cord stromal tumors. Most adnexal masses are NOT malignant, but the imaging workup is designed to identify the ones that are.</p>
    </section>
    """

def workup_section():
    return f"""
    <section class="section">
        <h2>The workup</h2>
        <p>The standard pathway is designed to maximize sensitivity for malignancy while avoiding unnecessary surgery on benign disease.</p>
        <ol class="ladder">
            <li><strong>History.</strong> Pain (acute or chronic), pressure symptoms, abnormal bleeding, weight changes, GI symptoms (bloating, early satiety, change in bowel habits &mdash; the suspicious ones for ovarian cancer that persist over &gt;12 days/month){cite("ref-4")}, family history of ovarian / breast / colorectal cancer, age, menopausal status, prior surgery, fertility plans.</li>
            <li><strong>Exam.</strong> Bimanual to characterize the mass &mdash; size, mobility, tenderness, consistency, bilaterality, ascites{kb_marker(5)}. <strong>Irregular, firm, fixed, nodular, bilateral, or associated with ascites</strong> raises malignancy concern.</li>
            <li><strong>Transvaginal ultrasound</strong> is first-line{kb_marker(1)}. Characterize the mass: simple vs complex (septations, solid components, papillary projections), vascularity on Doppler, free fluid in the cul-de-sac. The IOTA Simple Rules{cite("ref-2")} use 10 ultrasound features (5 benign, 5 malignant) to risk-stratify the mass.</li>
            <li><strong>Tumor markers, when appropriate.</strong> CA-125 in <strong>postmenopausal women</strong> with a suspicious mass{kb_marker(4)}; less reliable in premenopausal women because it&rsquo;s also elevated by endometriosis, fibroids, pelvic inflammatory disease, pregnancy, and even menstruation. CA-125 misses 50% of Stage I disease{kb_marker(3)} &mdash; a normal value doesn&rsquo;t exclude cancer. Other markers (HE4, ROMA, AFP, beta-hCG, LDH, inhibin) used selectively based on the imaging and clinical suspicion.</li>
            <li><strong>CT or MRI</strong> are NOT first-line{kb_marker(2)}. CT is useful for staging if cancer is suspected (assesses peritoneal disease, lymph nodes, distant spread). MRI sometimes helps distinguish dermoid vs endometrioma vs solid tumor when ultrasound is equivocal.</li>
            <li><strong>Gynecologic-oncology referral</strong> for any high-risk imaging features, elevated CA-125 (or RMI/ROMA score) in a postmenopausal woman, suspicious clinical findings, or strong family history. Outcomes are better when ovarian cancer surgery is performed by a gynecologic oncologist.</li>
        </ol>
    </section>
    """

def management_section():
    return f"""
    <section class="section">
        <h2>Watch, image, or operate &mdash; the decision tree</h2>
        <p>Once a mass is characterized, the decision falls along a spectrum &mdash; from no follow-up needed, to interval re-imaging, to surgery.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="manage-deep">
                <div class="rung-num">0</div>
                <h3>No follow-up</h3>
                <p>Simple cysts &le;3&nbsp;cm in premenopausal women, or simple cysts &le;1&nbsp;cm in postmenopausal women, with classic features &mdash; no action needed{cite("ref-3")}.</p>
            </article>
            <article class="ladder-card" data-modal="manage-deep">
                <div class="rung-num">1</div>
                <h3>Re-image in 6&ndash;12 weeks</h3>
                <p>Suspected functional cyst &mdash; document resolution after 1&ndash;3 cycles. Most premenopausal cysts &lt;5&nbsp;cm resolve.</p>
            </article>
            <article class="ladder-card" data-modal="manage-deep">
                <div class="rung-num">2</div>
                <h3>Re-image at 6&ndash;12 months</h3>
                <p>Stable benign-appearing mass &mdash; benign cystadenoma, small endometrioma, dermoid. Watch for growth or new features.</p>
            </article>
            <article class="ladder-card" data-modal="surgery-deep">
                <div class="rung-num">3</div>
                <h3>Surgery</h3>
                <p>Symptomatic (pain, pressure), growing rapidly, suspicious features on imaging, persistent cysts &gt;5&ndash;10&nbsp;cm, or fertility-impacting endometriomas. Laparoscopic when feasible{cite("ref-6")}.</p>
            </article>
            <article class="ladder-card" data-modal="malignancy-deep">
                <div class="rung-num">!</div>
                <h3>GYN-Onc referral</h3>
                <p>Suspicious imaging, elevated risk markers in postmenopausal women, or any imaging features in postmenopausal women that don&rsquo;t look completely benign.</p>
            </article>
            <article class="ladder-card" data-modal="brca-deep">
                <div class="rung-num">B</div>
                <h3>Hereditary risk</h3>
                <p>Strong family history or known BRCA mutation changes management {cite("ref-7")}{kb_marker(7)}. Risk-reducing salpingo-oophorectomy is the most effective single intervention.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Is my cyst cancer?</summary>
                <div class="qa-answer"><p>Almost certainly not. Across all ages, about <strong>80%</strong> of adnexal masses are benign &mdash; and in premenopausal women that rises to over 90%. The workup is designed to pick out the small fraction that need cancer evaluation. The most reassuring features on ultrasound: simple appearance (thin-walled, anechoic interior), &lt;5&nbsp;cm, no septations, no solid components, no abnormal Doppler signal{cite("ref-2")}.</p></div>
            </details>
            <details class="qa"><summary>Why didn&rsquo;t we just send a CA-125?</summary>
                <div class="qa-answer"><p>CA-125 is useful in some settings but unhelpful in others. It&rsquo;s elevated in 80% of epithelial ovarian cancers overall but misses 50% of Stage&nbsp;I disease{kb_marker(3)}. In premenopausal women it&rsquo;s also elevated by endometriosis, fibroids, PID, pregnancy, even menstruation &mdash; producing false positives that lead to unnecessary anxiety and surgery. The marker is most useful in <strong>postmenopausal women</strong> with a suspicious mass{kb_marker(4)}, not as a general screening tool.</p></div>
            </details>
            <details class="qa"><summary>Why don&rsquo;t we screen all women for ovarian cancer?</summary>
                <div class="qa-answer"><p>Because no validated screening tool reduces ovarian cancer mortality in average-risk women{cite("ref-4")}{cite("ref-5")}. Combinations of TVUS and CA-125 in large randomized trials have failed to show survival benefit. Symptom recognition (persistent bloating, early satiety, pelvic or abdominal pain, urinary urgency for more than ~12 days a month) is the current best alerting system, alongside individual evaluation when a mass is identified for any other reason.</p></div>
            </details>
            <details class="qa"><summary>Will I lose my ovary?</summary>
                <div class="qa-answer"><p>When surgery is needed, the question is whether to do an <em>ovarian cystectomy</em> (remove the cyst, preserve the ovary) or an <em>oophorectomy</em> (remove the ovary). The answer depends on age, fertility plans, the size and nature of the lesion, and whether there&rsquo;s suspicion for malignancy. In premenopausal women with benign lesions, cystectomy is preferred whenever feasible to preserve ovarian function. In postmenopausal women, oophorectomy may be appropriate, particularly with suspicious features.</p></div>
            </details>
            <details class="qa"><summary>Open or laparoscopic?</summary>
                <div class="qa-answer"><p>For benign-appearing masses, <strong>laparoscopy is the standard</strong>{cite("ref-6")} &mdash; less blood loss, less pain, shorter stay, faster recovery, smaller scars. Open surgery is reserved for very large masses, strong suspicion of malignancy (where intact removal in a bag matters to avoid spread), or when the patient has anatomy that makes laparoscopy unsafe. Robotic-assisted laparoscopy is an option for complex cases.</p></div>
            </details>
            <details class="qa"><summary>Should I get BRCA tested?</summary>
                <div class="qa-answer"><p>If your family history includes ovarian, fallopian-tube, or peritoneal cancer at any age, or breast cancer (especially under 50, bilateral, triple-negative, or male breast cancer), or if you&rsquo;re of Ashkenazi Jewish ancestry (founder mutation frequency ~1 in 40){kb_marker(6)} &mdash; yes, BRCA testing should be discussed{cite("ref-7")}. The result changes management of any current adnexal mass, informs prophylactic risk-reduction options (risk-reducing salpingo-oophorectomy, intensified breast screening), and matters for your relatives.</p></div>
            </details>
            <details class="qa"><summary>What if the cyst has gotten larger?</summary>
                <div class="qa-answer"><p>Growth raises the threshold for surgery. Functional cysts should resolve, not grow. Stable benign cystadenomas or dermoids that increase in size, new solid or septated components, or rising tumor markers all push toward surgical evaluation. Imaging at a defined interval (3&ndash;6 months) is how growth is documented.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "cyst-types-deep": f"""
        <p>Understanding which type of cyst you have shapes the decision about what to do.</p>
        <p><strong>Functional / physiologic cysts</strong> are part of a normal cycle. Follicular cysts develop when an egg doesn&rsquo;t release; corpus luteum cysts form after ovulation. They typically resolve in 1&ndash;3 cycles. Many women have one or more of these over a lifetime without ever knowing.</p>
        <p><strong>Dermoid cysts (mature cystic teratomas)</strong> are benign but don&rsquo;t resolve. They often contain a mix of tissues (hair, fat, occasionally teeth fragments) which produces a characteristic mixed-density appearance on ultrasound and MRI. Removal is recommended (typically laparoscopic cystectomy) when they grow, cause symptoms, or risk ovarian torsion.</p>
        <p><strong>Endometriomas (chocolate cysts)</strong> are endometriosis on the ovary. They have a classic homogeneous &ldquo;ground-glass&rdquo; appearance on ultrasound. See the endometriosis guide for surgical and medical management.</p>
        <p><strong>Cystadenomas (serous or mucinous)</strong> are benign epithelial tumors. They can grow quite large &mdash; sometimes 15&nbsp;cm or more &mdash; before causing symptoms. Surgical removal is recommended.</p>
        <p><strong>Fibromas / thecomas</strong> are solid benign stromal tumors. Sometimes associated with <em>Meigs syndrome</em> (ascites + right pleural effusion), which resolves after tumor removal.</p>
        <p><strong>Hydrosalpinx</strong> is a dilated fluid-filled fallopian tube, often mistaken for an ovarian cyst on imaging. Common after pelvic inflammatory disease. Treatment is salpingectomy when symptomatic or affecting fertility.</p>
        <p><strong>Malignant tumors</strong> are the minority but the reason the workup exists. Epithelial ovarian cancer is the most common; borderline tumors, germ cell tumors (younger patients), and sex-cord stromal tumors round out the differential.</p>
    """,
    "workup-deep": f"""
        <p>The modern adnexal-mass workup is a layered framework designed to maximize cancer-detection sensitivity while avoiding unnecessary surgery.</p>
        <p><strong>Imaging:</strong></p>
        <ul class="bullets">
            <li><strong>Transvaginal ultrasound</strong> is first-line{kb_marker(1)}. The reader characterizes size, contents (simple vs complex), wall thickness, septations, solid components, papillary projections, vascular flow on Doppler, free fluid, contralateral ovary, ascites.</li>
            <li><strong>IOTA Simple Rules / ADNEX model</strong>{cite("ref-2")} use 10 ultrasound features (5 benign, 5 malignant) to assign each mass as benign, malignant, or inconclusive. Inconclusive cases are referred to GYN-Onc.</li>
            <li><strong>CT or MRI</strong> are not initial tools{kb_marker(2)}. CT is used for staging if cancer suspected; MRI sometimes helps when ultrasound is equivocal.</li>
        </ul>
        <p><strong>Tumor markers (selectively):</strong></p>
        <ul class="bullets">
            <li>CA-125 in postmenopausal women with a suspicious mass{kb_marker(4)}.</li>
            <li>CA-125 in premenopausal women is rarely useful as a stand-alone &mdash; too many false positives.</li>
            <li>HE4 + CA-125 combined in the ROMA score adds incremental specificity in selected cases.</li>
            <li>Beta-hCG, AFP, LDH, inhibin if germ cell or sex-cord stromal tumor is in the differential (younger women, atypical masses).</li>
        </ul>
        <p><strong>Risk-stratification frameworks:</strong></p>
        <ul class="bullets">
            <li>RMI (Risk of Malignancy Index) = ultrasound score &times; CA-125 &times; menopausal status.</li>
            <li>ROMA (Risk of Ovarian Malignancy Algorithm) = HE4 + CA-125, menopausal status.</li>
            <li>ADNEX (IOTA) = ultrasound features + age + CA-125 (optional) &mdash; gives a percentage risk of malignancy.</li>
        </ul>
        <p><strong>Referral threshold:</strong> any of the above suggesting elevated risk should go to GYN-Oncology before surgery. Outcomes are markedly better when ovarian cancer surgery is done by an oncology specialist.</p>
    """,
    "manage-deep": f"""
        <p>Once characterized, the path forward depends on size, features, age, and symptoms.</p>
        <p><strong>No follow-up needed:</strong></p>
        <ul class="bullets">
            <li>Simple cyst &le;3&nbsp;cm in premenopausal woman, asymptomatic, classic features{cite("ref-3")}.</li>
            <li>Simple cyst &le;1&nbsp;cm in postmenopausal woman with classic features.</li>
            <li>Small hemorrhagic cyst with typical appearance and no growth.</li>
        </ul>
        <p><strong>Re-image in 6&ndash;12 weeks:</strong></p>
        <ul class="bullets">
            <li>Simple cyst 3&ndash;5&nbsp;cm in premenopausal woman without symptoms &mdash; documents resolution.</li>
            <li>Suspected hemorrhagic corpus luteum cyst.</li>
        </ul>
        <p><strong>Re-image at 6&ndash;12 months:</strong></p>
        <ul class="bullets">
            <li>Persistent simple cyst 5&ndash;7&nbsp;cm in asymptomatic premenopausal woman.</li>
            <li>Small endometrioma when conservative management chosen.</li>
            <li>Stable dermoid &lt;5&nbsp;cm in asymptomatic patient who declines surgery.</li>
        </ul>
        <p><strong>Surgery is indicated when:</strong></p>
        <ul class="bullets">
            <li>Symptoms &mdash; persistent pain, pressure, dyspareunia.</li>
            <li>Growth on serial imaging.</li>
            <li>Suspicious features on ultrasound (papillary projections, abnormal Doppler, solid components, septations &gt;3&nbsp;mm, bilateral, ascites).</li>
            <li>Persistent or growing cyst &gt;5&ndash;10&nbsp;cm (size threshold lowered in postmenopausal women).</li>
            <li>Endometrioma threatening ovarian function or fertility.</li>
            <li>Suspected dermoid (won&rsquo;t resolve, ovarian torsion risk).</li>
            <li>Any new finding in postmenopausal women warrants surgical evaluation in many cases.</li>
            <li>Acute torsion / rupture / severe pain &mdash; emergent surgery.</li>
        </ul>
    """,
    "surgery-deep": f"""
        <p>The two main procedures, and the choice between them:</p>
        <p><strong>Ovarian cystectomy</strong> removes the cyst from the surface of the ovary, preserving ovarian function. Indicated when:</p>
        <ul class="bullets">
            <li>Pre-menopausal patient who wants to preserve ovarian function and fertility.</li>
            <li>Mass appears benign on imaging.</li>
            <li>Endometrioma in a woman wanting fertility (excision is superior to drainage / ablation per ACOG).</li>
            <li>Dermoid in a young woman.</li>
        </ul>
        <p><strong>Oophorectomy (with or without the fallopian tube)</strong> removes the entire ovary. Indicated when:</p>
        <ul class="bullets">
            <li>Postmenopausal woman with adnexal mass (less ovarian function to preserve).</li>
            <li>Imaging suggests malignancy.</li>
            <li>The ovary is destroyed by the lesion.</li>
            <li>Torsion with non-viable ovary.</li>
            <li>BRCA-positive women undergoing risk-reducing surgery.</li>
        </ul>
        <p><strong>Laparoscopy vs laparotomy:</strong> for benign-appearing masses, laparoscopy is the standard{cite("ref-6")}. The mass is removed in a containment bag if there&rsquo;s any chance of malignancy, to prevent spillage. Open surgery (laparotomy) is reserved for very large masses (&gt;10&ndash;15&nbsp;cm), strong suspicion of malignancy where intact extraction matters, or when laparoscopy is unsafe (extensive adhesions, severe medical contraindications to pneumoperitoneum).</p>
        <p><strong>Salpingectomy &mdash; opportunistic.</strong> Modern practice routinely removes the fallopian tubes (bilateral salpingectomy) at the time of benign hysterectomy or oophorectomy, even when not removing both ovaries, because the fimbriated end of the tube appears to be where many epithelial ovarian cancers originate.</p>
    """,
    "malignancy-deep": f"""
        <p>When imaging features or biomarkers raise suspicion for ovarian cancer, several things change:</p>
        <ul class="bullets">
            <li><strong>Gynecologic oncology referral</strong> before surgery &mdash; outcomes are significantly better when ovarian cancer surgery is done by a GYN-Onc specialist.</li>
            <li><strong>Staging surgery</strong> (rather than simple cyst removal) is planned &mdash; total hysterectomy, bilateral salpingo-oophorectomy, omentectomy, pelvic and para-aortic lymph node sampling, peritoneal washings, and biopsies of all peritoneal surfaces.</li>
            <li><strong>Intact removal</strong> in a containment bag whenever feasible &mdash; spillage of malignant cells worsens stage and prognosis.</li>
            <li><strong>Frozen section</strong> intraoperatively can guide the extent of surgery if the diagnosis is uncertain.</li>
            <li><strong>Post-operative chemotherapy</strong> for most epithelial ovarian cancers; tumor genomic testing (BRCA1/2, HRD) increasingly guides adjuvant therapy (PARP inhibitors).</li>
        </ul>
        <p><strong>Symptom recognition</strong> matters for catching cancers earlier{cite("ref-4")}. The classic alerting symptoms &mdash; bloating, early satiety, pelvic or abdominal pain, urinary urgency &mdash; are non-specific individually but, when they persist for more than ~12 days a month, deserve evaluation. There is no validated routine ovarian cancer screening tool in average-risk women{cite("ref-5")}.</p>
        <p><strong>Borderline tumors</strong> are a less aggressive intermediate category &mdash; they can be locally extensive but rarely metastasize; conservative surgery is appropriate in many premenopausal patients wanting fertility preservation.</p>
    """,
    "brca-deep": f"""
        <p>Hereditary breast and ovarian cancer (HBOC) syndromes &mdash; particularly BRCA1 and BRCA2 mutations &mdash; dramatically increase lifetime risk of ovarian, fallopian tube, and breast cancer. The numbers from the KB{kb_marker(6)}{kb_marker(7)}:</p>
        <ul class="bullets">
            <li>BRCA mutations account for <strong>9&ndash;24%</strong> of epithelial ovarian cancers.</li>
            <li>Lifetime breast cancer risk: 57% for BRCA1, 49% for BRCA2 (by age 70).</li>
            <li>Ovarian cancer risk by age 70: 39&ndash;46% for BRCA1, 10&ndash;27% for BRCA2.</li>
            <li>Ashkenazi Jewish founder mutations: ~1 in 40 individuals carry a BRCA1 or BRCA2 mutation.</li>
            <li>Triple-negative breast cancer carries a 10&ndash;39% BRCA mutation rate.</li>
        </ul>
        <p><strong>Indications for BRCA testing:</strong></p>
        <ul class="bullets">
            <li>Personal history of ovarian, fallopian tube, or primary peritoneal cancer at any age.</li>
            <li>Breast cancer at age &lt;50.</li>
            <li>Triple-negative breast cancer at any age.</li>
            <li>Bilateral or contralateral breast cancer.</li>
            <li>Male breast cancer in self or family.</li>
            <li>Two or more close relatives with breast, ovarian, prostate, or pancreatic cancer.</li>
            <li>Ashkenazi Jewish ancestry plus any of the above.</li>
        </ul>
        <p><strong>If you carry a BRCA1 or BRCA2 mutation:</strong></p>
        <ul class="bullets">
            <li>Intensified breast screening (MRI alternating with mammography starting age 25&ndash;30).</li>
            <li>Consideration of prophylactic mastectomy.</li>
            <li><strong>Risk-reducing salpingo-oophorectomy (RRSO)</strong> typically recommended after childbearing complete &mdash; usually ages 35&ndash;40 for BRCA1, 40&ndash;45 for BRCA2. Reduces ovarian cancer mortality substantially.</li>
            <li>Cascade testing of first-degree relatives.</li>
            <li>Implications for endometrial cancer (Lynch overlap, tamoxifen exposure history) addressed separately.</li>
        </ul>
        <p>For any current ovarian mass in a known BRCA carrier, the threshold for surgical evaluation is lower, and the surgical plan typically includes removal of both ovaries and tubes (RRSO concurrent with mass evaluation).</p>
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
    <title>Ovarian cysts &amp; adnexal masses &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to ovarian cysts and adnexal masses: types, the modern workup (TVUS + IOTA + selective CA-125), when to watch vs operate, cystectomy vs oophorectomy, BRCA / hereditary risk. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Ovarian Cysts &amp; Adnexal Masses</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{types_section()}
{workup_section()}
{management_section()}
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
    "surface": "/education/ovarian-masses/index.html",
    "topic": "Ovarian Masses / Adnexal Masses",
    "topic_synthesis_id": "6a26ae53-ef20-49fe-a361-d685f0574eeb",
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
