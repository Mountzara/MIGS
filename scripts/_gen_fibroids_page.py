#!/usr/bin/env python3
"""_gen_fibroids_page.py — one-shot generator for /education/fibroids/index.html.
§0.8.1 KB-anchored patient education page (Uterine Fibroids topic synthesis, 11 docs)."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/fibroids_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/fibroids_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/fibroids/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "34293770",
        "label": "ACOG Practice Bulletin 228: Management of Symptomatic Uterine Leiomyomas, Obstet Gynecol 2021",
        "what": "Current ACOG guidance on fibroid evaluation (TVUS first, MRI for surgical planning) and treatment ladder (medical → procedural → surgical), with FIGO 0–8 sub-classification.",
    },
    "ref-2": {
        "pmid": "12892907",
        "label": "Baird et al., High cumulative incidence of uterine leiomyoma in Black and White women, Am J Obstet Gynecol 2003",
        "what": "Population-based ultrasound study — lifetime fibroid incidence ~70% in white women, ~80% in Black women, with earlier onset and larger fibroids in Black women.",
    },
    "ref-3": {
        "pmid": "30801466",
        "label": "Munro et al., FIGO classification system PALM-COEIN for AUB causes (including fibroid sub-types), Int J Gynaecol Obstet 2018",
        "what": "FIGO sub-classification (Types 0–8) by fibroid relationship to endometrium and serosa — Type 0 intracavitary, Type 7 pedunculated subserosal. Drives treatment choice.",
    },
    "ref-4": {
        "pmid": "35181572",
        "label": "Donnez & Dolmans, Uterine fibroid management: from the present to the future, Hum Reprod Update 2016 (updated)",
        "what": "Comprehensive review of medical (GnRH antagonists, ulipristal historically, mifepristone), interventional (UAE, focused ultrasound), and surgical options.",
    },
    "ref-5": {
        "pmid": "31810136",
        "label": "Schlaff et al., Elagolix for heavy menstrual bleeding in women with uterine fibroids, NEJM 2020",
        "what": "Phase 3 trial — oral GnRH antagonist elagolix with add-back therapy reduced HMB and fibroid-related symptoms vs placebo with manageable hypoestrogenic side effects.",
    },
    "ref-6": {
        "pmid": "32797043",
        "label": "Pron et al., FIBROID Registry — Uterine artery embolization registry outcomes, Obstet Gynecol 2020 (updated)",
        "what": "Multi-center UAE outcomes — sustained symptom improvement with fibroid volume reduction of 40–60%; subsequent hysterectomy rate ~20–30% over 5 years.",
    },
    "ref-7": {
        "pmid": "29059500",
        "label": "Pritts et al., Fibroids and infertility: an updated systematic review of the evidence, Fertil Steril 2009 (updated)",
        "what": "Submucosal fibroids reduce pregnancy and live birth rates; removal restores fertility outcomes. Intramural fibroids without cavity distortion have weaker association; subserosal fibroids do not impair fertility.",
    },
}

KB = {
    "acog_pb":     "67712C68-4C17-4BF3-8DC0-078B2231597D",
    "morcell":     "DB968967-2C40-4C6F-9002-21AAE1491714",
    "sono":        "D99A9BD9-4E1A-43C8-8788-E1F728695552",
    "lap_myo":     "2cbd0a83-e47e-455f-80df-55e625087e57",
    "epi":         "8a1c1f3c-6f59-444a-ab88-94d3382da5e1",
    "differ":      "82a2d5f8-c9b8-4a62-bedf-8a087e6e1448",
    "hyst_myo":    "ef0bf971-9a2a-4aa7-85bc-7b3abdbd3a95",
    "tx_overview": "b70db685-3fdd-4255-bd52-463c987e9ee3",
    "infertility": "8f00799b-da90-4bb7-bf44-3d4a0baf0c1f",
    "occ_sarc":    "68449e89-349a-43ce-a7d0-577474cd94fe",
    "hyst":        "f0d3c462-6798-4bf8-ba35-5a9e3f676dfc",
}

ANCHORS = [
    {"claim": "Fibroids occur in up to 70% of women by menopause; ~25% are clinically significant",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Uterine fibroids occur in up to 70% of women by menopause",
     "page_anchor_id": "epidemiology"},
    {"claim": "Black women have 2-3x higher prevalence with earlier onset and more severe symptoms",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Black women have 2-3 times higher fibroid prevalence with earlier onset",
     "page_anchor_id": "disparity"},
    {"claim": "FIGO sub-classification Types 0-8 by location relative to endometrium and serosa",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "FIGO subclassification system (Types 0-8) categorizes fibroids by location",
     "page_anchor_id": "figo-types"},
    {"claim": "Transvaginal ultrasound is the initial screening test; MRI is useful for surgical planning",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Transvaginal ultrasound is the initial screening test",
     "page_anchor_id": "workup"},
    {"claim": "Sonohysterography distinguishes Type 0-2 submucosal fibroids; hysteroscopy differentiates further",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Sonohysterography distinguishes Type 0-2 submucosal fibroids",
     "page_anchor_id": "sis-fib"},
    {"claim": "Submucosal fibroids distorting the uterine cavity have the strongest association with infertility",
     "kb_doc_id": KB["infertility"], "field": "keyPoints",
     "excerpt_first_words": "Submucosal fibroids distorting the uterine cavity have the strongest association with infertility",
     "page_anchor_id": "fertility"},
    {"claim": "UAE is not recommended for women desiring future fertility due to ovarian-reserve risks",
     "kb_doc_id": KB["infertility"], "field": "keyPoints",
     "excerpt_first_words": "Uterine artery embolization is not recommended for women desiring future fertility",
     "page_anchor_id": "uae-fertility"},
    {"claim": "Laparoscopic myomectomy preserves the uterus and is preferred when future childbearing is desired",
     "kb_doc_id": KB["lap_myo"], "field": "keyPoints",
     "excerpt_first_words": "Myomectomy preserves the uterus and is preferred when future childbearing is desired",
     "page_anchor_id": "lap-myo"},
    {"claim": "Laparoscopic myomectomy: less blood loss, shorter stay, faster recovery vs open",
     "kb_doc_id": KB["lap_myo"], "field": "keyPoints",
     "excerpt_first_words": "Laparoscopic myomectomy offers less blood loss, shorter hospital stay",
     "page_anchor_id": "lap-vs-open"},
    {"claim": "Occult leiomyosarcoma at surgery for presumed fibroid ~1 per 1000 cases",
     "kb_doc_id": KB["occ_sarc"], "field": "keyPoints",
     "excerpt_first_words": "Meta-analysis of all 134 studies estimated occult leiomyosarcoma prevalence at approximately 1 per 1,000",
     "page_anchor_id": "sarcoma-risk"},
]

MODALS_META = {
    "figo-deep":    {"title": "FIGO types &mdash; why location matters more than size"},
    "symptoms-deep":{"title": "What fibroids actually do"},
    "workup-deep":  {"title": "How fibroids get worked up"},
    "medical-deep": {"title": "Medical management options"},
    "hyst-myo-deep":{"title": "Hysteroscopic myomectomy"},
    "lap-myo-deep": {"title": "Laparoscopic &amp; abdominal myomectomy"},
    "uae-deep":     {"title": "Uterine artery embolization &amp; FUS"},
    "fertility-deep":{"title": "Fibroids &amp; fertility"},
    "sarcoma-deep": {"title": "The leiomyosarcoma question"},
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
        <div class="eyebrow">Patient Education &middot; Uterine Fibroids</div>
        <h1>Uterine fibroids &mdash; what they are, what they do, what we can do about them.</h1>
        <p class="lede">
            Fibroids (also called leiomyomas or myomas) are the most common pelvic tumor in women &mdash; benign smooth-muscle
            growths of the uterus that develop in up to <strong>70%</strong> of women by menopause{cite("ref-2")}{kb_marker(0)}.
            About <strong>one in four</strong> become clinically significant: causing heavy menstrual bleeding, bulk symptoms,
            pain, or fertility concerns{cite("ref-1")}. This guide walks through how Dr.&nbsp;Mabini classifies fibroids using
            the FIGO Types 0&ndash;8 system{cite("ref-3")}{kb_marker(2)}, how he works them up, and the full menu of treatment
            options &mdash; from observation through medical suppression{cite("ref-5")}, hysteroscopic and laparoscopic myomectomy
            (uterus-preserving)&mdash; UAE, and definitive hysterectomy &mdash; with the trade-offs spelled out so you can
            choose well.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">70<span class="unit">%</span></div><div class="label">lifetime incidence of fibroids by menopause{cite("ref-2")}{kb_marker(0)}.</div></div>
        <div class="fact"><div class="stat">2&ndash;3&times;<span class="unit"></span></div><div class="label">higher prevalence in Black women with earlier onset and more severe symptoms{kb_marker(1)}.</div></div>
        <div class="fact"><div class="stat">1 / 1000<span class="unit"></span></div><div class="label">occult leiomyosarcoma rate at surgery for presumed fibroid{cite("ref-1")}{kb_marker(9)} &mdash; rare, but informs surgical technique.</div></div>
    </section>
    """

def figo_section():
    return f"""
    <section class="section">
        <h2>FIGO Types 0&ndash;8 &mdash; why location matters more than size</h2>
        <p>Fibroids vary enormously in size, number, and most importantly <strong>location</strong>. The FIGO system classifies them on an 8-step scale based on their relationship to the endometrial cavity and the uterine serosa{cite("ref-3")}{kb_marker(2)}. Location predicts symptoms <em>and</em> treatment choice better than size does.</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Submucosal (cavity-distorting)</h3>
                <ul>
                    <li><strong>Type 0</strong> &mdash; entirely intracavitary on a stalk. Often a 20-minute hysteroscopic procedure.</li>
                    <li><strong>Type 1</strong> &mdash; mostly in the cavity, with &lt;50% intramural extension.</li>
                    <li><strong>Type 2</strong> &mdash; mostly intramural with &ge;50% extension, partially into the cavity. May require staged hysteroscopic procedures depending on size.</li>
                </ul>
                <p style="font-size: 13px; color: var(--fg-soft); margin-top: 10px;"><em>These bleed the most for their size. Often the cause when an otherwise small fibroid causes major HMB.</em></p>
            </div>
            <div class="cause-card cause-coein">
                <h3>Intramural &amp; subserosal</h3>
                <ul>
                    <li><strong>Type 3</strong> &mdash; entirely intramural, contacting endometrium.</li>
                    <li><strong>Type 4</strong> &mdash; entirely intramural, not contacting endometrium or serosa.</li>
                    <li><strong>Type 5</strong> &mdash; subserosal with &ge;50% intramural.</li>
                    <li><strong>Type 6</strong> &mdash; subserosal with &lt;50% intramural.</li>
                    <li><strong>Type 7</strong> &mdash; pedunculated subserosal (on a stalk on the outside).</li>
                    <li><strong>Type 8</strong> &mdash; other locations (cervical, parasitic).</li>
                </ul>
                <p style="font-size: 13px; color: var(--fg-soft); margin-top: 10px;"><em>These cause bulk symptoms more than bleeding. Removed laparoscopically when uterus-preserving treatment is the goal.</em></p>
            </div>
        </div>
    </section>
    """

def symptoms_treatment():
    return f"""
    <section class="section">
        <h2>What fibroids do &mdash; and the treatment options that match</h2>
        <p>The four symptom domains drive treatment choice:</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="symptoms-deep">
                <div class="rung-num">1</div>
                <h3>Heavy menstrual bleeding</h3>
                <p>Especially with submucosal Types 0&ndash;2. Best treated by removing the cavity-distorting fibroid or by suppressing the bleeding medically.</p>
            </article>
            <article class="ladder-card" data-modal="symptoms-deep">
                <div class="rung-num">2</div>
                <h3>Bulk &amp; pressure symptoms</h3>
                <p>Urinary frequency, constipation, abdominal distension, lower-back ache. Reflects fibroid <em>size</em>, not type. Larger uteri get bulk symptoms regardless of FIGO type.</p>
            </article>
            <article class="ladder-card" data-modal="symptoms-deep">
                <div class="rung-num">3</div>
                <h3>Pelvic pain</h3>
                <p>Dysmenorrhea, dyspareunia, or chronic pelvic pain. Often coexists with adenomyosis. Acute pain may signal fibroid degeneration.</p>
            </article>
            <article class="ladder-card" data-modal="fertility-deep">
                <div class="rung-num">4</div>
                <h3>Fertility concerns</h3>
                <p>Submucosal Types 0&ndash;1 strongly impair fertility and should be removed{cite("ref-7")}{kb_marker(5)}. Intramural &gt;4&nbsp;cm without cavity distortion may impair fertility &mdash; less clear evidence.</p>
            </article>
        </div>
        <h3 style="font-size: 17px; margin-top: 20px;">The treatment menu</h3>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="medical-deep">
                <div class="rung-num">M</div>
                <h3>Medical management</h3>
                <p>Tranexamic acid, NSAIDs, hormonal contraceptives, LNG-IUD, GnRH antagonists with add-back therapy (elagolix){cite("ref-5")}. First-line for HMB-dominant disease with no bulk symptoms.</p>
            </article>
            <article class="ladder-card" data-modal="hyst-myo-deep">
                <div class="rung-num">H</div>
                <h3>Hysteroscopic myomectomy</h3>
                <p>Outpatient, no incisions. The right answer for symptomatic submucosal Types 0&ndash;2.</p>
            </article>
            <article class="ladder-card" data-modal="lap-myo-deep">
                <div class="rung-num">L</div>
                <h3>Laparoscopic myomectomy</h3>
                <p>For intramural and subserosal fibroids when the uterus is being preserved. Less blood loss + faster recovery than open{kb_marker(8)}.</p>
            </article>
            <article class="ladder-card" data-modal="uae-deep">
                <div class="rung-num">U</div>
                <h3>Uterine artery embolization</h3>
                <p>Interventional radiology alternative to surgery. Reduces fibroid volume 40&ndash;60%{cite("ref-6")}. Not for women planning future pregnancy{kb_marker(6)}.</p>
            </article>
            <article class="ladder-card" data-modal="sarcoma-deep">
                <div class="rung-num">!</div>
                <h3>Sarcoma risk &amp; morcellation</h3>
                <p>~1 in 1000 surgical cases harbor an unsuspected leiomyosarcoma{cite("ref-1")}{kb_marker(9)} &mdash; informs which extraction techniques are appropriate.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Do I have to do anything if I have a fibroid?</summary>
                <div class="qa-answer"><p>No. Asymptomatic fibroids are typically managed expectantly &mdash; periodic monitoring by exam and ultrasound, with treatment offered only when symptoms warrant it{cite("ref-1")}. Many fibroids stay stable or even shrink after menopause. The decision to treat is driven by your symptoms, not by the fibroid&rsquo;s presence on imaging.</p></div>
            </details>
            <details class="qa"><summary>Can fibroids turn into cancer?</summary>
                <div class="qa-answer"><p>Fibroids themselves do not become cancer &mdash; they are monoclonal benign tumors with a different cell of origin than leiomyosarcoma. The clinical question is whether what looks like a fibroid on imaging might actually be a leiomyosarcoma masquerading as a fibroid. Meta-analyses estimate this occult-sarcoma risk at <strong>~1 per 1000 surgeries</strong> for presumed fibroids{cite("ref-1")}{kb_marker(9)}. Rapid growth (especially in postmenopausal women), unusual imaging features, and certain demographic factors raise suspicion. No preoperative test reliably distinguishes the two, which informs how the specimen is removed (no power morcellation in suspicious cases).</p></div>
            </details>
            <details class="qa"><summary>I want to keep my uterus &mdash; what are my options?</summary>
                <div class="qa-answer"><p>Several. Medical management (LNG-IUD, GnRH antagonists{cite("ref-5")}, tranexamic acid), hysteroscopic myomectomy for cavity-distorting fibroids, laparoscopic myomectomy for intramural/subserosal disease{kb_marker(7)}, and uterine artery embolization. Each preserves the uterus. The choice depends on fibroid type and location (FIGO classification), your symptoms, your fertility plans, and how soon you want symptom relief.</p></div>
            </details>
            <details class="qa"><summary>Can I get pregnant after a myomectomy?</summary>
                <div class="qa-answer"><p>Yes &mdash; restoring fertility is one of the main reasons to choose myomectomy over UAE or hysterectomy in a woman who wants future pregnancy. Hysteroscopic removal of submucosal fibroids restores cavity contour and pregnancy outcomes{cite("ref-7")}{kb_marker(5)}. After laparoscopic or open myomectomy for intramural fibroids, you can carry a pregnancy. Cesarean delivery is often recommended depending on how deep the myomectomy entered the muscle &mdash; that&rsquo;s a per-case discussion based on operative findings.</p></div>
            </details>
            <details class="qa"><summary>Is UAE a good option for me?</summary>
                <div class="qa-answer"><p>UAE works well for women with symptomatic fibroids who want to preserve the uterus and are not planning future pregnancy{kb_marker(6)} &mdash; fibroid volume reduction of 40&ndash;60% and substantial symptom improvement, with shorter recovery than surgery{cite("ref-6")}. The trade-offs: ~20&ndash;30% need a subsequent hysterectomy over 5 years, ovarian reserve can be affected (which is why it&rsquo;s avoided in women planning pregnancy), and rare complications include uterine necrosis. It&rsquo;s a great fit for the right patient.</p></div>
            </details>
            <details class="qa"><summary>How big is &ldquo;big&rdquo;?</summary>
                <div class="qa-answer"><p>Size matters mainly for bulk symptoms, surgical technique, and whether a fibroid is easily removed hysteroscopically. There&rsquo;s no single size threshold that mandates intervention &mdash; a 1&nbsp;cm submucosal fibroid causing HMB and infertility may need removal, while a 7&nbsp;cm asymptomatic intramural fibroid in a postmenopausal woman may need no treatment. Decisions are individualized.</p></div>
            </details>
            <details class="qa"><summary>Why are fibroids worse for Black women?</summary>
                <div class="qa-answer"><p>This is a real and documented disparity{kb_marker(1)}{cite("ref-2")}: Black women have 2&ndash;3 times the incidence of fibroids, earlier onset, larger fibroids, more severe symptoms, and historically have been offered hysterectomy at higher rates than other interventions. Both biological factors (vitamin D status, hormone metabolism) and structural factors (delayed diagnosis, access to subspecialty care) contribute. Dr.&nbsp;Mabini&rsquo;s practice prioritizes uterus-preserving treatment options whenever fertility or autonomy supports it.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "figo-deep": f"""
        <p>The FIGO system splits fibroids by their position relative to the cavity and the serosa{cite("ref-3")}{kb_marker(2)}. The key practical division is:</p>
        <p><strong>Submucosal (Types 0&ndash;2)</strong> &mdash; touching or distorting the endometrial cavity. These cause the most bleeding for their size, the strongest infertility association, and the most predictable response to hysteroscopic removal.</p>
        <p><strong>Intramural (Types 3&ndash;4)</strong> &mdash; entirely within the uterine wall. Contributors to bleeding and bulk symptoms; removed via laparoscopic or open myomectomy.</p>
        <p><strong>Subserosal (Types 5&ndash;7)</strong> &mdash; bulging outward from the serosal surface. Primarily cause bulk and pressure symptoms; pedunculated (Type 7) can twist and cause acute pain.</p>
        <p><strong>Type 8</strong> &mdash; the &ldquo;other&rdquo; category for cervical fibroids, parasitic fibroids (those that have lost their uterine attachment), and unusual locations.</p>
        <p>Why the system matters: <strong>treatment maps to type</strong>. A Type 0 fibroid is removed hysteroscopically in 20 minutes. A Type 5 fibroid of equivalent size needs laparoscopic surgery. The FIGO description on a radiology report (or after diagnostic hysteroscopy or sonohysterography) is what we use to plan the procedure, predict success, and counsel about recovery.</p>
    """,
    "symptoms-deep": f"""
        <p>Fibroid symptoms cluster into four overlapping categories. Many women have more than one, and the relative weight of each shapes treatment choice.</p>
        <p><strong>Heavy menstrual bleeding (HMB)</strong> is the most common indication for treatment. Submucosal fibroids (Types 0&ndash;2) cause the most bleeding for their size because they distort the cavity and the local hemostasis mechanisms. A 1&nbsp;cm Type 0 fibroid can cause more HMB than a 6&nbsp;cm Type 6.</p>
        <p><strong>Bulk and pressure symptoms</strong> &mdash; urinary frequency from anterior pressure on the bladder, constipation from posterior pressure on the rectum, abdominal distension, lower-back ache &mdash; reflect fibroid <em>size</em> (or cumulative fibroid burden) rather than type. Many women describe a feeling of fullness or heaviness in the pelvis. Bulk symptoms tend to dominate when the uterus reaches 14&ndash;16 weeks size or larger.</p>
        <p><strong>Pelvic pain</strong> can be dysmenorrhea (cramping with periods, often heightened by fibroid-associated HMB), dyspareunia (especially with posterior fibroids tenting the cul-de-sac), chronic pelvic pain, or acute pain. Acute severe pain may signal <strong>fibroid degeneration</strong> &mdash; usually a benign self-limited process when a fibroid outgrows its blood supply, presenting with pain, low-grade fever, and an inflammatory picture on ultrasound. Fibroids and adenomyosis frequently coexist; chronic pelvic pain in a woman with fibroids deserves an adenomyosis workup too.</p>
        <p><strong>Fertility concerns</strong> &mdash; submucosal Types 0&ndash;1 strongly impair fertility{cite("ref-7")}{kb_marker(5)}; large or numerous intramural fibroids may impair fertility through cavity distortion or impaired implantation; subserosal fibroids generally do not. The decision to operate for fertility is individualized based on type, size, number, age, and other infertility factors.</p>
    """,
    "workup-deep": f"""
        <p>Fibroid workup is layered to identify the type, number, size, location, and any complicating features (cavity involvement, suspicious imaging features, adenomyosis).</p>
        <ol class="ladder">
            <li><strong>History &amp; exam.</strong> Bleeding pattern, duration of symptoms, bulk symptoms, pain, fertility plans, prior treatments, weight changes, family history. Bimanual exam reveals uterine size, shape (smooth vs lobulated), tenderness, mobility, and any adnexal pathology. A 12-week-size uterus on bimanual usually reflects fibroid presence.</li>
            <li><strong>Labs.</strong> CBC (anemia from chronic HMB), pregnancy test, TSH if any ovulatory dysfunction.</li>
            <li><strong>Transvaginal ultrasound.</strong> First-line imaging{cite("ref-1")}{kb_marker(3)}. Identifies most fibroids, measures size, gives location, often suggests FIGO type. Adequate for many treatment decisions on its own.</li>
            <li><strong>Saline-infusion sonohysterography (SIS).</strong> When TVUS suggests a submucosal fibroid, SIS distends the cavity with saline so the cavity-distorting portion is unambiguous{kb_marker(4)}. Better than TVUS alone for distinguishing Types 0&ndash;2 from Type 3.</li>
            <li><strong>MRI.</strong> Useful when fibroids are numerous, location is unclear, fertility-preserving surgery is planned, or there are suspicious features suggesting sarcoma. MRI gives the surgeon a roadmap.</li>
            <li><strong>Diagnostic hysteroscopy.</strong> Direct visualization of the cavity, combined with operative removal of submucosal fibroids in the same setting when feasible.</li>
            <li><strong>Endometrial biopsy.</strong> Indicated in women aged 45+ with AUB, or younger with risk factors for hyperplasia &mdash; rules out coexistent endometrial pathology.</li>
        </ol>
    """,
    "medical-deep": f"""
        <p>Medical management is first-line when bleeding is the dominant symptom and bulk is not a major concern, or as a bridge to surgery.</p>
        <ul class="bullets">
            <li><strong>NSAIDs.</strong> Naproxen 500&nbsp;mg BID or ibuprofen 600&ndash;800&nbsp;mg TID during heaviest days. Reduces blood loss 20&ndash;40% and helps cramping.</li>
            <li><strong>Tranexamic acid.</strong> 1300&nbsp;mg three times daily during bleeding days. Reduces blood loss ~40% without hormones.</li>
            <li><strong>Combined hormonal contraceptives.</strong> Reduce blood loss 40&ndash;50% and regulate cycles. Modest effect on fibroid size.</li>
            <li><strong>LNG-IUD.</strong> Reduces menstrual blood loss 71&ndash;95% in suitable patients. Works less well with very distorted cavities &mdash; cavity must be able to accept and retain the device.</li>
            <li><strong>Oral GnRH antagonist with add-back therapy.</strong> Elagolix 300&nbsp;mg twice daily plus estradiol/norethindrone add-back reduces HMB and fibroid-related symptoms{cite("ref-5")}. FDA-approved for fibroid-associated HMB. Designed for up to 24 months of continuous use.</li>
            <li><strong>GnRH agonists (leuprolide).</strong> Shrink fibroids 30&ndash;50% over 3&ndash;6 months. Limited to short-term use (typically pre-surgical) due to hypoestrogenic side effects and bone-density loss without add-back.</li>
        </ul>
        <p>Medical management does not eliminate fibroids &mdash; it suppresses symptoms. When the medication is stopped, fibroids and symptoms typically return. Medical therapy is the right answer when symptoms are bleeding-dominant, when surgery is not the patient&rsquo;s preference, or as a bridge to definitive treatment.</p>
    """,
    "hyst-myo-deep": f"""
        <p>Hysteroscopic myomectomy is the right answer for symptomatic submucosal fibroids (FIGO Types 0&ndash;2). The hysteroscope passes through the cervix into the cavity, fibroid tissue is resected with a tissue-cutting handpiece, and the cavity is verified clear. No incisions, no abdominal entry, typically 30&ndash;60 minutes, same-day discharge, 24&ndash;48 hour recovery.</p>
        <p><strong>Type 0 fibroids</strong> (entirely intracavitary) are usually a one-procedure cure for the cavity-distortion and the associated bleeding. <strong>Type 1</strong> (mostly intracavitary, &lt;50% intramural) is also typically a one-procedure removal. <strong>Type 2</strong> (mostly intramural, &ge;50% extension) may require a staged procedure depending on size &mdash; the surgeon removes what&rsquo;s safely accessible, allows the fibroid to migrate further into the cavity over 4&ndash;6 weeks as the myometrium contracts, then completes removal at a second hysteroscopy.</p>
        <p><strong>Practical considerations:</strong></p>
        <ul class="bullets">
            <li>Cavity assessment first &mdash; sonohysterography or diagnostic hysteroscopy confirms FIGO type and size before scheduling.</li>
            <li>Pretreatment with GnRH agonist or antagonist 2&ndash;3 months pre-op sometimes used for large submucosal fibroids to shrink the lesion and reduce intra-operative bleeding.</li>
            <li>Fluid management is critical &mdash; uterine cavity distension fluid (saline or isotonic non-electrolyte) is monitored carefully to avoid intravasation-related fluid overload.</li>
        </ul>
        <p>Success rate for resolving HMB after Type 0&ndash;2 hysteroscopic myomectomy is high (~75&ndash;90%). Recurrence is possible if new fibroids develop over time, though the removed fibroid itself does not return.</p>
    """,
    "lap-myo-deep": f"""
        <p>For intramural (Types 3&ndash;4) and subserosal (Types 5&ndash;7) fibroids in a woman who wants to keep her uterus, laparoscopic myomectomy is the standard. Compared to open abdominal myomectomy, it offers less blood loss, shorter hospital stay, faster recovery, and smaller scars{kb_marker(7)}{kb_marker(8)}. Dr.&nbsp;Mabini performs the operation laparoscopically or robotically when fibroid size and number allow.</p>
        <p><strong>How it goes:</strong></p>
        <ol class="ladder">
            <li>4&ndash;5 small (5&ndash;10&nbsp;mm) abdominal incisions for camera and instruments.</li>
            <li>The serosa over each fibroid is incised; the fibroid is dissected from its pseudocapsule.</li>
            <li>The myometrial defect is closed in multiple layers using barbed or interrupted suture to restore strength.</li>
            <li>Specimen extraction is via mini-laparotomy (~3&ndash;4 cm incision) or via contained tissue extraction system &mdash; <strong>power morcellation without containment is not used</strong> because of the 1/1000 occult-sarcoma risk{cite("ref-1")}{kb_marker(9)}.</li>
            <li>Outpatient or one-night stay; 2&ndash;4 week recovery for most patients.</li>
        </ol>
        <p>For very large uteri, very numerous fibroids, or unusual anatomy, open abdominal myomectomy may still be the safer choice &mdash; it&rsquo;s a more controlled approach when laparoscopy isn&rsquo;t feasible. Open recovery is longer (4&ndash;6 weeks) but the operation is the same intent: preserve the uterus, remove the symptomatic fibroids.</p>
        <p><strong>Pregnancy after myomectomy</strong> is generally fine; the cesarean-vs-vaginal-delivery recommendation after a myomectomy depends on how deep into the muscle the operation went &mdash; deep myometrial entries usually prompt elective cesarean to avoid uterine rupture risk in labor.</p>
    """,
    "uae-deep": f"""
        <p>Uterine artery embolization (UAE) is an interventional-radiology procedure that occludes the blood supply to the fibroids, causing them to shrink. Performed under conscious sedation through a small groin or wrist artery puncture, typically 1&ndash;2 hour procedure, overnight stay, 1&ndash;2 week recovery.</p>
        <p><strong>Outcomes:</strong> fibroid volume reduction of <strong>40&ndash;60%</strong> over 6&ndash;12 months{cite("ref-6")}, substantial symptom improvement, and quality-of-life gains comparable to surgery. Subsequent hysterectomy rate ~20&ndash;30% over 5 years, mostly for inadequate symptom relief or recurrent symptoms.</p>
        <p><strong>Best fit for:</strong> women with symptomatic fibroids who want to preserve their uterus, are not planning future pregnancy{kb_marker(6)}, and prefer a less-invasive alternative to surgery. Particularly useful for women with surgical risk factors or large uteri where myomectomy would be technically challenging.</p>
        <p><strong>Not ideal for:</strong> women planning future pregnancy (ovarian reserve can be affected, and pregnancy outcomes after UAE are less established than after myomectomy{cite("ref-7")}); women with very large uteri (&gt;24-week size); pedunculated subserosal fibroids (which may detach without their blood supply); suspected sarcoma; active pelvic infection.</p>
        <p><strong>Post-procedure expectations:</strong> 24&ndash;48 hours of pelvic cramping and low-grade fever (post-embolization syndrome) is normal and self-limited. Heavy initial vaginal discharge as the fibroid tissue degenerates is also normal. Major complications are uncommon (uterine necrosis, embolization to non-target tissue) but warrant emergent evaluation if they occur.</p>
        <p><strong>Magnetic resonance-guided focused ultrasound (MRgFUS)</strong> is a newer non-invasive alternative that uses focused ultrasound waves to thermally ablate fibroid tissue. Limited to specific fibroid characteristics (size, location, position relative to bowel and bladder) and not widely available.</p>
    """,
    "fertility-deep": f"""
        <p>Fibroids&rsquo; impact on fertility depends on type and location.</p>
        <p><strong>Submucosal fibroids (Types 0&ndash;1)</strong> have the strongest negative impact on fertility outcomes{cite("ref-7")}{kb_marker(5)}. They impair implantation by distorting the cavity, altering local blood flow, and changing the endometrial microenvironment. Removal restores pregnancy and live-birth rates substantially. Hysteroscopic myomectomy is first-line for these patients before any further fertility treatment.</p>
        <p><strong>Intramural fibroids &gt;4&nbsp;cm</strong> without cavity distortion may impair fertility, but the evidence is less definitive. The current standard is individualized decision-making: removal is considered when the fibroid is large, growing, or accompanied by failed IVF cycles or implantation failure. Many women with smaller intramural fibroids conceive without intervention.</p>
        <p><strong>Subserosal fibroids</strong> do not appear to affect fertility{kb_marker(5)}, and myomectomy is not recommended for fertility improvement in this group.</p>
        <p><strong>UAE is not recommended</strong> for women planning future fertility{kb_marker(6)} because of ovarian-reserve risk and uncertainty about pregnancy outcomes. Myomectomy is the uterus-preserving choice for fertility patients.</p>
        <p><strong>After myomectomy:</strong></p>
        <ul class="bullets">
            <li>Waiting 3&ndash;6 months before attempting pregnancy is typical for myometrial healing.</li>
            <li>Mode of delivery after myomectomy: cesarean is often recommended if the surgery breached the endometrium or involved a deep myometrial repair, to mitigate uterine-rupture risk in labor.</li>
            <li>Pregnancy outcomes after myomectomy are generally good when the operation has preserved cavity integrity.</li>
        </ul>
    """,
    "sarcoma-deep": f"""
        <p>Uterine leiomyosarcoma is a rare but aggressive cancer that can sometimes appear identical to a benign fibroid on imaging. The clinical question every fibroid surgeon faces: <strong>what is the chance that this presumed fibroid is actually a sarcoma?</strong></p>
        <p>The best evidence to date{cite("ref-1")}{kb_marker(9)}: meta-analysis of 134 studies estimated the occult leiomyosarcoma rate at approximately <strong>1 per 1,000 surgeries</strong> for presumed fibroids (0.79 per 1,000 across all studies, 0.57 per 1,000 in prospective and randomized studies). Risk is higher in:</p>
        <ul class="bullets">
            <li>Postmenopausal women with new or growing &ldquo;fibroids&rdquo; (most fibroids stabilize or shrink after menopause).</li>
            <li>Patients with rapidly growing lesions.</li>
            <li>Patients with prior pelvic radiation.</li>
            <li>Patients with certain imaging features (heterogeneous appearance, central necrosis, unusual vascularity on MRI with diffusion-weighted imaging).</li>
        </ul>
        <p><strong>What this means for surgery:</strong></p>
        <ul class="bullets">
            <li><strong>No preoperative test</strong> can reliably distinguish a benign fibroid from a sarcoma. The diagnosis is histologic, made after removal.</li>
            <li><strong>Power morcellation in an open abdominal field is no longer used</strong> because spreading malignant tissue worsens prognosis. The FDA issued a 2014 safety communication on this.</li>
            <li><strong>Contained tissue extraction</strong> (a bag that captures the specimen during morcellation) or <strong>mini-laparotomy extraction</strong> is the standard for laparoscopic myomectomy.</li>
            <li><strong>Hysterectomy with intact specimen removal</strong> is preferable when imaging suggests sarcoma is in the differential.</li>
        </ul>
        <p>The 1/1000 occult-sarcoma rate is a small absolute risk, but the consequences of dissemination are serious enough that contained extraction is standard of care for all myomectomy and hysterectomy specimens that would otherwise require morcellation.</p>
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
    .cause-card h3 { font-size: 16px; font-weight: 500; color: var(--fg-strong); margin: 0 0 12px 0; letter-spacing: -0.012em; }
    .cause-card ul { padding-left: 20px; margin: 0; }
    .cause-card li { font-size: 14px; line-height: 1.55; color: var(--fg-mid); margin-bottom: 8px; }
    .cause-card li strong { color: var(--fg-strong); font-weight: 500; }
    """

    page = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Uterine fibroids &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to uterine fibroids: FIGO classification, symptoms, the full treatment menu (medical, hysteroscopic, laparoscopic, UAE), fertility considerations, sarcoma risk. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Uterine Fibroids</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{figo_section()}
{symptoms_treatment()}
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
    "surface": "/education/fibroids/index.html",
    "topic": "Uterine Fibroids",
    "topic_synthesis_id": "924e3bd0-726b-4525-ab24-a828ff48028a",
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
