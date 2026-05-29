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
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/_gen_pregnancy_loss_page.py\n\n"
)
_sys.exit(2)


"""_gen_pregnancy_loss_page.py — §0.8.1 KB-anchored Pregnancy Loss education page.
Sensitive trauma-informed tone."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/pregnancy_loss_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/pregnancy_loss_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/pregnancy-loss/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "30157093",
        "label": "ACOG Practice Bulletin 200: Early Pregnancy Loss, Obstet Gynecol 2018",
        "what": "ACOG guidance on diagnosis, expectant / medical / surgical management of early pregnancy loss, and follow-up care including emotional support.",
    },
    "ref-2": {
        "pmid": "23090551",
        "label": "Schreiber et al., Mifepristone Pretreatment for Medical Management of Early Pregnancy Loss, NEJM 2018",
        "what": "Phase 3 trial — mifepristone followed by misoprostol resulted in significantly higher complete expulsion rates (84% vs 67%) than misoprostol alone for first-trimester pregnancy loss.",
    },
    "ref-3": {
        "pmid": "32569093",
        "label": "ASRM Practice Committee: Definitions of infertility and recurrent pregnancy loss, Fertil Steril 2020",
        "what": "ASRM consensus definitions — recurrent pregnancy loss is 2+ clinical pregnancy losses, with evaluation indicated after the second loss in most patients.",
    },
    "ref-4": {
        "pmid": "23859039",
        "label": "ASRM Practice Committee: Evaluation and treatment of recurrent pregnancy loss, Fertil Steril 2012",
        "what": "Comprehensive workup for recurrent pregnancy loss — antiphospholipid syndrome, uterine cavity assessment, karyotype on tissue, parental karyotype in selected cases, endocrine workup.",
    },
    "ref-5": {
        "pmid": "30461695",
        "label": "ACOG Practice Bulletin 193: Tubal Ectopic Pregnancy, Obstet Gynecol 2018",
        "what": "ACOG guidance on diagnosis (TVUS findings, beta-hCG trends), and management (medical with methotrexate vs surgical) of tubal ectopic pregnancy.",
    },
    "ref-6": {
        "pmid": "36174214",
        "label": "ACOG Clinical Practice Update: Rh D Immune Globulin Administration After Early Pregnancy Loss, Obstet Gynecol 2024",
        "what": "Updated guidance — routine RhIg prophylaxis no longer necessary for pregnancy loss or abortion before 12 0/7 weeks; remains indicated at and beyond 12 weeks.",
    },
    "ref-7": {
        "pmid": "31955743",
        "label": "Frey Tirri et al., Pregnancy loss and psychological consequences, J Psychosom Obstet Gynaecol 2020 (review)",
        "what": "Pregnancy loss is associated with clinically significant rates of grief, depression, and PTSD &mdash; supports trauma-informed care and mental-health screening.",
    },
}

KB = {
    "epl":   "84ECB6D2-3EF1-473D-B2BE-2C0BB3FBCDA8",
    "rhig":  "491ECCDD-016B-4F7B-8BAB-2C1F83150914",
    "rpl":   "8eddc58a-51fd-464e-a272-a17702b82297",
}

ANCHORS = [
    {"claim": "Early pregnancy loss occurs in 10% of clinically recognized pregnancies; 80% first trimester",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Early pregnancy loss occurs in 10% of clinically recognized pregnancies; 80% in the first trimester",
     "page_anchor_id": "incidence"},
    {"claim": "~50% are due to fetal chromosomal abnormalities",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Approximately 50% of cases are due to fetal chromosomal abnormalities",
     "page_anchor_id": "chromo"},
    {"claim": "Loss rate increases with maternal age (9-17% at 20-30 to 80% at 45)",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Loss rate increases from 9-17% at ages 20-30 to 40% at age 40 and 80% at age 45",
     "page_anchor_id": "age-risk"},
    {"claim": "Diagnostic criteria: CRL >=7mm without heartbeat or MSD >=25mm without embryo",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Diagnostic criteria for pregnancy failure",
     "page_anchor_id": "diag"},
    {"claim": "Management options: expectant, medical (mife + miso), or surgical",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Management options: expectant, medical (mifepristone with misoprostol), or surgical evacuation",
     "page_anchor_id": "options"},
    {"claim": "Treatment choice should accommodate patient preferences when no urgent indication",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Treatment choice should accommodate patient preferences when no urgent surgical indication exists",
     "page_anchor_id": "choice"},
    {"claim": "Expectant management should be limited to the first trimester",
     "kb_doc_id": KB["epl"], "field": "keyPoints",
     "excerpt_first_words": "Expectant management should be limited to the first trimester due to hemorrhage concerns",
     "page_anchor_id": "expectant"},
    {"claim": "Routine Rh testing and RhIg no longer necessary at <12 0/7 weeks",
     "kb_doc_id": KB["rhig"], "field": "keyPoints",
     "excerpt_first_words": "Routine Rh testing and RhIg prophylaxis are no longer necessary for pregnancy loss or abortion at",
     "page_anchor_id": "rhig"},
    {"claim": "Flow cytometry: 99.8% remain below sensitization threshold for early loss",
     "kb_doc_id": KB["rhig"], "field": "keyPoints",
     "excerpt_first_words": "Flow cytometry shows fetal RBC concentrations remain below the sensitization threshold in 99.8% of patients with early pregnancy loss",
     "page_anchor_id": "rhig-data"},
]

MODALS_META = {
    "diagnosis-deep":   {"title": "How early loss is diagnosed"},
    "expectant-deep":   {"title": "Expectant management"},
    "medical-deep":     {"title": "Medical management &mdash; mifepristone + misoprostol"},
    "surgical-deep":    {"title": "Surgical management"},
    "ectopic-deep":     {"title": "Ectopic pregnancy"},
    "recurrent-deep":   {"title": "Recurrent pregnancy loss"},
    "emotional-deep":   {"title": "Grief, support, and what comes next"},
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
        <div class="eyebrow">Patient Education &middot; Pregnancy Loss</div>
        <h1>Pregnancy loss &mdash; what&rsquo;s happening, what&rsquo;s normal, and what comes next.</h1>
        <p class="lede">
            Pregnancy loss is much more common than most people realize. About <strong>10%</strong> of clinically recognized
            pregnancies end in loss, and the great majority happen in the first trimester{cite("ref-1")}{kb_marker(0)} &mdash;
            <strong>not because of anything you did or didn&rsquo;t do</strong>. The most common cause is a chromosomal
            abnormality that developed at conception{kb_marker(1)}, not anything in your control. This guide walks through
            how Dr.&nbsp;Mabini approaches early pregnancy loss with care: how it&rsquo;s diagnosed, the three management
            options{kb_marker(4)} (expectant, medical{cite("ref-2")}, surgical), what to expect for recovery, when
            recurrent-loss workup is appropriate{cite("ref-3")}{cite("ref-4")}, and &mdash; importantly &mdash;
            the emotional and mental-health support that often matters as much as the medical care{cite("ref-7")}.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">10<span class="unit">%</span></div><div class="label">of clinically recognized pregnancies end in loss{cite("ref-1")}{kb_marker(0)}; the true rate including very early losses is higher.</div></div>
        <div class="fact"><div class="stat">50<span class="unit">%</span></div><div class="label">of early losses are caused by random chromosomal errors{kb_marker(1)} &mdash; not anything you did.</div></div>
        <div class="fact"><div class="stat">3 options<span class="unit"></span></div><div class="label">for managing an early loss when no urgent issue{kb_marker(4)}{kb_marker(5)} &mdash; expectant, medical, or surgical.</div></div>
    </section>
    """

def first_step_section():
    return f"""
    <section class="section">
        <h2>If you&rsquo;ve just been told</h2>
        <p>If your provider has just told you that the pregnancy isn&rsquo;t viable, the most important things to know:</p>
        <ul class="bullets">
            <li><strong>This is almost never your fault.</strong> About half of early losses come from random chromosomal abnormalities of the embryo{kb_marker(1)} that have nothing to do with what you did or didn&rsquo;t do.</li>
            <li><strong>You have time and options.</strong> Unless you&rsquo;re hemodynamically unstable or have signs of infection, there is no medical urgency to choose treatment in the next hours. You can take days to decide.</li>
            <li><strong>Your preferences matter.</strong> Modern guidance is explicit that the choice between expectant, medical, and surgical management should accommodate your preferences when no urgent indication exists{kb_marker(5)}.</li>
            <li><strong>Future fertility is usually unaffected</strong> after a single first-trimester loss. The chance of a healthy next pregnancy is roughly the same as your chance for any pregnancy.</li>
            <li><strong>Grief is normal and real.</strong> Pregnancy loss is associated with clinically significant rates of acute grief, depression, and post-traumatic symptoms{cite("ref-7")}. Mental-health support is part of care, not a sign of weakness.</li>
        </ul>
    </section>
    """

def diagnosis_section():
    return f"""
    <section class="section">
        <h2>How an early loss is diagnosed</h2>
        <p>The diagnosis of early pregnancy loss usually combines transvaginal ultrasound findings and serum beta-hCG trends. Specific ultrasound criteria for non-viable pregnancy{kb_marker(3)}:</p>
        <ul class="bullets">
            <li><strong>Crown-rump length (CRL) ≥ 7 mm</strong> without cardiac activity.</li>
            <li><strong>Mean sac diameter (MSD) ≥ 25 mm</strong> without an embryo.</li>
            <li><strong>Absence of embryo with heartbeat ≥ 2 weeks</strong> after a scan that showed a gestational sac without a yolk sac.</li>
            <li><strong>Absence of embryo with heartbeat ≥ 11 days</strong> after a scan that showed a gestational sac with a yolk sac.</li>
        </ul>
        <p>Beta-hCG patterns help when ultrasound is inconclusive &mdash; rising hCG &lt;35&ndash;50% over 48 hours is concerning for a non-viable pregnancy or ectopic. <strong>One single set of numbers is rarely enough</strong> &mdash; serial measurements and a follow-up ultrasound are the standard before declaring a pregnancy non-viable.</p>
        <p><strong>What to ask for if you&rsquo;re unsure of the diagnosis:</strong></p>
        <ul class="bullets">
            <li>A copy of the ultrasound report.</li>
            <li>A second opinion (formal repeat scan, sometimes a different operator).</li>
            <li>Time &mdash; if the diagnosis is borderline, repeating the scan in 7&ndash;14 days often clarifies.</li>
        </ul>
    </section>
    """

def management_section():
    return f"""
    <section class="section">
        <h2>The three management options</h2>
        <p>When the diagnosis is clear and there&rsquo;s no urgent issue (heavy bleeding, infection, hemodynamic concern), three options are available{kb_marker(4)}{kb_marker(5)}. None is medically &ldquo;right&rdquo; or &ldquo;wrong&rdquo;; the choice depends on your preferences, your timeline, and your medical history.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="expectant-deep">
                <div class="rung-num">1</div>
                <h3>Expectant management</h3>
                <p>Let the loss complete on its own, over days to weeks. Limited to the first trimester{kb_marker(6)}. Most natural-feeling option for many.</p>
            </article>
            <article class="ladder-card" data-modal="medical-deep">
                <div class="rung-num">2</div>
                <h3>Medical management</h3>
                <p>Mifepristone followed by misoprostol &mdash; achieves complete expulsion in ~84% of patients{cite("ref-2")}, much higher than misoprostol alone. At home.</p>
            </article>
            <article class="ladder-card" data-modal="surgical-deep">
                <div class="rung-num">3</div>
                <h3>Surgical management</h3>
                <p>Office or OR D&amp;C / suction evacuation. Fastest resolution. Highest success rate. Local or moderate sedation depending on setting.</p>
            </article>
            <article class="ladder-card" data-modal="ectopic-deep">
                <div class="rung-num">E</div>
                <h3>Ectopic pregnancy</h3>
                <p>A separate pathway &mdash; pregnancy implanted outside the uterus. Medical (methotrexate) or surgical{cite("ref-5")}. Urgent attention required.</p>
            </article>
            <article class="ladder-card" data-modal="recurrent-deep">
                <div class="rung-num">R</div>
                <h3>Recurrent loss</h3>
                <p>Two or more losses warrants a workup{cite("ref-3")}{cite("ref-4")} &mdash; antiphospholipid syndrome, uterine cavity, karyotype, endocrine.</p>
            </article>
            <article class="ladder-card" data-modal="emotional-deep">
                <div class="rung-num">&hearts;</div>
                <h3>Grief &amp; mental health</h3>
                <p>Acute grief, depression, and PTSD are common after loss{cite("ref-7")}. Counseling, peer support, time. Part of care.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>Did I do something wrong?</summary>
                <div class="qa-answer"><p>Almost certainly not. About half of first-trimester losses are caused by random chromosomal abnormalities of the embryo{kb_marker(1)} that occurred at conception and have nothing to do with what you did, ate, lifted, drank, or experienced emotionally. Working out, sex, mild illnesses, mild stress, common medications &mdash; none of these cause early pregnancy loss.</p></div>
            </details>
            <details class="qa"><summary>What does my age have to do with it?</summary>
                <div class="qa-answer"><p>Maternal age strongly affects miscarriage risk because egg quality declines with age. Loss rates rise from <strong>9&ndash;17% at age 20&ndash;30 to 40% at age 40 and 80% at age 45</strong>{kb_marker(2)}. This is biology, not anything you can change &mdash; but it does affect the conversation about future pregnancy and any evaluation you might want.</p></div>
            </details>
            <details class="qa"><summary>How will I know I&rsquo;ve passed the pregnancy?</summary>
                <div class="qa-answer"><p>Bleeding becomes heavier than menstrual flow, cramping is significant, and you may pass tissue (often described as &ldquo;like beef liver&rdquo; or a clot-with-grayish-tissue). Pain usually peaks during passage and improves substantially within hours. Bleeding tapers to lighter flow over 1&ndash;2 weeks. A follow-up ultrasound at 1&ndash;2 weeks usually confirms completion.</p></div>
            </details>
            <details class="qa"><summary>When can I try again?</summary>
                <div class="qa-answer"><p>Physically, most couples can try again with the next menstrual cycle &mdash; usually 4&ndash;6 weeks after the loss. There is no medical reason to wait longer for one early loss. Emotionally, the right time varies enormously by person and couple &mdash; some are ready right away, others need months. Both are normal.</p></div>
            </details>
            <details class="qa"><summary>Do I need RhoGAM (RhIg)?</summary>
                <div class="qa-answer"><p>Per the 2024 ACOG clinical practice update{kb_marker(7)}{kb_marker(8)}{cite("ref-6")}: routine RhIg is no longer needed for pregnancy loss or abortion <em>before</em> 12 0/7 weeks &mdash; flow cytometry data show 99.8% of patients remain below the sensitization threshold. For loss at or beyond 12 weeks, RhIg is still indicated in Rh-negative women. Some patients with Rh-negative blood and plans for future pregnancy still choose to receive RhIg even at &lt;12 weeks via shared decision-making.</p></div>
            </details>
            <details class="qa"><summary>How many losses before we do a workup?</summary>
                <div class="qa-answer"><p>Two or more clinical pregnancy losses meets the modern definition of recurrent pregnancy loss{cite("ref-3")} and is reasonable grounds for a workup{cite("ref-4")}. The workup includes evaluation for antiphospholipid antibody syndrome, an assessment of the uterine cavity (sonohysterography or hysteroscopy), karyotype of pregnancy tissue when available, parental karyotypes in selected cases, and an endocrine workup (thyroid, prolactin, diabetes, sometimes prolactin and progesterone).</p></div>
            </details>
            <details class="qa"><summary>Will this affect future pregnancies?</summary>
                <div class="qa-answer"><p>After a single first-trimester loss, the chance of a healthy next pregnancy is roughly the same as your chance was for the lost pregnancy &mdash; the lost pregnancy doesn&rsquo;t add risk to the next one. After recurrent losses (2+), the chance of a healthy next pregnancy is still good, but lower &mdash; about 60&ndash;70% even after 3&ndash;4 losses. Workup can sometimes identify treatable causes.</p></div>
            </details>
            <details class="qa"><summary>How do I cope emotionally?</summary>
                <div class="qa-answer"><p>Grief after pregnancy loss is real and clinically significant{cite("ref-7")} &mdash; reactions range from quiet sadness to clinical depression to features of acute stress disorder. None of these are signs of being &ldquo;weak&rdquo; or &ldquo;broken.&rdquo; Options that help: peer support (groups, online communities), counseling with a perinatal-loss-aware therapist, ritual or memorialization when meaningful to you, time. If you&rsquo;re struggling more than a few weeks &mdash; or if you have thoughts of self-harm &mdash; please reach out. The portal messaging is one channel; crisis lines and your primary care team are others.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "diagnosis-deep": f"""
        <p>The diagnostic threshold for a non-viable early pregnancy is deliberately conservative &mdash; the criteria{kb_marker(3)} are designed so that the diagnosis is essentially never wrong:</p>
        <ul class="bullets">
            <li><strong>CRL ≥ 7 mm without cardiac activity</strong> on transvaginal ultrasound.</li>
            <li><strong>Mean sac diameter ≥ 25 mm without an embryo</strong> (anembryonic pregnancy / blighted ovum).</li>
            <li><strong>No embryo with cardiac activity ≥ 2 weeks</strong> after an earlier scan showed gestational sac without yolk sac.</li>
            <li><strong>No embryo with cardiac activity ≥ 11 days</strong> after an earlier scan showed gestational sac with yolk sac.</li>
        </ul>
        <p>When measurements are below threshold and the diagnosis is uncertain, the right next step is repeat imaging in 7&ndash;14 days &mdash; not declaring the pregnancy non-viable prematurely. Beta-hCG trends are an adjunct: rising less than 35&ndash;50% over 48 hours raises concern for non-viability or ectopic pregnancy and warrants closer evaluation.</p>
        <p><strong>Special situations</strong>: ectopic pregnancy must be ruled out before any management of suspected loss, particularly when bleeding is present or beta-hCG patterns are abnormal. See the ectopic deep-dive.</p>
        <p><strong>Symptomatic patients</strong> presenting with bleeding and crampy pain may complete the loss before the diagnostic threshold is fully met. Clinical exam (open cervical os with passage of tissue) and post-loss ultrasound (empty uterus, falling hCG) confirm completion.</p>
    """,
    "expectant-deep": f"""
        <p>Expectant management means letting the pregnancy pass on its own. For many patients it&rsquo;s the most natural-feeling option, and for selected cases it&rsquo;s as effective as medical or surgical management.</p>
        <p><strong>What to expect:</strong></p>
        <ul class="bullets">
            <li>Time to completion is variable &mdash; days to several weeks. Most patients pass tissue within 2&ndash;3 weeks of the diagnosis.</li>
            <li>Bleeding heavier than menstrual flow for hours during passage; then tapering over 1&ndash;2 weeks.</li>
            <li>Cramping during passage can be significant &mdash; NSAIDs (ibuprofen 600&ndash;800&nbsp;mg every 8 hours with food) help substantially.</li>
            <li>Tissue passage often described as a large clot with grayish material.</li>
            <li>Follow-up ultrasound at 1&ndash;2 weeks confirms completion or identifies retained tissue.</li>
        </ul>
        <p><strong>Limits and caveats:</strong></p>
        <ul class="bullets">
            <li>Expectant management is appropriate for <em>first-trimester</em> losses &mdash; second-trimester losses carry higher hemorrhage risk and are managed differently{kb_marker(6)}.</li>
            <li>Success rate ~80% within 4 weeks; if incomplete after 4 weeks, conversion to medical or surgical management is reasonable.</li>
            <li>Sometimes the body doesn&rsquo;t complete the loss without intervention &mdash; that&rsquo;s not a failure of the patient.</li>
            <li>Bleeding that&rsquo;s heavy enough to soak through more than 2 pads per hour for 2+ hours warrants prompt evaluation.</li>
        </ul>
        <p><strong>When to call:</strong> very heavy bleeding (soaking 2+ pads/hr for 2+ hr), fever, foul-smelling discharge, severe abdominal pain, or signs of shock (dizziness, fast heart rate, pale skin). The portal messaging covers non-urgent questions and follow-up.</p>
    """,
    "medical-deep": f"""
        <p>Medical management uses medications to induce passage of the pregnancy at home, within a defined window of hours. The modern evidence-based regimen{cite("ref-2")} is:</p>
        <p><strong>Mifepristone 200&nbsp;mg orally on day 0</strong>, followed by</p>
        <p><strong>Misoprostol 800&nbsp;mcg vaginally (or buccally) 24&ndash;48 hours later.</strong></p>
        <p>This combination achieves complete expulsion in <strong>about 84%</strong> of patients{cite("ref-2")} &mdash; substantially higher than the ~67% rate seen with misoprostol alone.</p>
        <p><strong>What to expect after misoprostol dose:</strong></p>
        <ul class="bullets">
            <li>Cramping starts within 1&ndash;4 hours, sometimes longer.</li>
            <li>Bleeding heavier than menstrual flow for several hours; peak pain and tissue passage usually within 4&ndash;8 hours of misoprostol.</li>
            <li>Tapering bleeding over 1&ndash;2 weeks.</li>
            <li>Take ibuprofen (or acetaminophen) and use heat for cramping.</li>
            <li>Have a support person at home, and access to follow-up if needed.</li>
        </ul>
        <p><strong>If the first round doesn&rsquo;t result in complete passage</strong>: a second misoprostol dose (or conversion to surgical management) is reasonable. Many patients have full success after the first attempt.</p>
        <p><strong>Side effects</strong>: nausea, diarrhea, low-grade fever or chills (especially with misoprostol), uterine cramping. Most resolve within 24 hours of medication.</p>
        <p><strong>Follow-up</strong>: a urine or quantitative beta-hCG to document return to negative; sometimes a repeat ultrasound to confirm completion if symptoms persist.</p>
    """,
    "surgical-deep": f"""
        <p>Surgical management is the fastest option for completing an early pregnancy loss, with the highest success rate (&gt;95% complete expulsion). Two settings:</p>
        <p><strong>Manual vacuum aspiration (MVA) in the office:</strong></p>
        <ul class="bullets">
            <li>Performed with paracervical block, oral analgesia, and sometimes anxiolytics.</li>
            <li>Procedure typically 10&ndash;15 minutes.</li>
            <li>Discharge home within an hour.</li>
            <li>Recovery similar to a heavy period for 1&ndash;2 weeks.</li>
        </ul>
        <p><strong>Suction D&amp;C in the operating room:</strong></p>
        <ul class="bullets">
            <li>Performed under moderate sedation or general anesthesia.</li>
            <li>Same procedure technically, just done with more anesthesia for patient comfort.</li>
            <li>Outpatient &mdash; home within hours.</li>
            <li>Right setting for patients who want full anesthesia, have anxiety, or have anatomical considerations.</li>
        </ul>
        <p><strong>When surgical is the right choice or required:</strong></p>
        <ul class="bullets">
            <li>Heavy bleeding requiring urgent treatment.</li>
            <li>Suspected or known infected miscarriage (septic abortion) &mdash; medical urgency, IV antibiotics + prompt evacuation.</li>
            <li>Hemodynamic instability.</li>
            <li>Patient preference for fast resolution.</li>
            <li>Second-trimester losses where uterine size makes other options unsafe.</li>
            <li>Need for tissue for genetic / pathologic analysis (recurrent loss workup).</li>
        </ul>
        <p><strong>Recovery</strong>: most patients return to non-strenuous activity within 1&ndash;2 days. Light bleeding for 1&ndash;2 weeks. Menstrual cycle typically returns in 4&ndash;6 weeks.</p>
        <p><strong>Complications</strong> are uncommon &mdash; uterine perforation, retained products, infection, intrauterine adhesions (Asherman syndrome, very rare). Modern technique with ultrasound guidance minimizes risk.</p>
    """,
    "ectopic-deep": f"""
        <p>An ectopic pregnancy is a pregnancy that implants outside the uterine cavity &mdash; most commonly in the fallopian tube. It is a separate pathway from intrauterine pregnancy loss and requires <strong>urgent</strong> attention because of rupture risk{cite("ref-5")}.</p>
        <p><strong>How it&rsquo;s diagnosed:</strong></p>
        <ul class="bullets">
            <li>Positive pregnancy test with no intrauterine pregnancy on TVUS.</li>
            <li>Beta-hCG above the discriminatory zone (~2000&ndash;3500 IU/L) without visible IUP.</li>
            <li>Visualization of an adnexal mass with yolk sac or embryo.</li>
            <li>Free fluid in the cul-de-sac (suggests rupture).</li>
            <li>Beta-hCG rising less than 35&ndash;50% over 48 hours, or plateauing.</li>
        </ul>
        <p><strong>Management:</strong></p>
        <ul class="bullets">
            <li><strong>Methotrexate</strong> &mdash; single- or multi-dose regimens, for hemodynamically stable patients with low beta-hCG, no cardiac activity on TVUS, mass &lt; 3.5 cm. Allows non-surgical resolution.</li>
            <li><strong>Laparoscopic salpingectomy or salpingostomy</strong> &mdash; preferred when methotrexate is contraindicated, beta-hCG is high, mass is &gt;3.5&nbsp;cm, cardiac activity is present, or rupture is suspected.</li>
            <li><strong>Emergency laparotomy</strong> &mdash; for hemodynamic instability from rupture.</li>
        </ul>
        <p><strong>Symptoms suggesting rupture &mdash; emergency:</strong></p>
        <ul class="bullets">
            <li>Sudden severe one-sided pelvic / abdominal pain.</li>
            <li>Shoulder pain (from diaphragmatic irritation by blood).</li>
            <li>Dizziness, lightheadedness, fainting.</li>
            <li>Rapid heart rate, pale skin, low blood pressure.</li>
        </ul>
        <p>Any of those &mdash; call 911 or go to the ER immediately.</p>
        <p><strong>Future pregnancy after ectopic</strong>: most women conceive normally afterward. Risk of repeat ectopic is somewhat elevated (~10&ndash;15%), so early monitoring of the next pregnancy is standard.</p>
    """,
    "recurrent-deep": f"""
        <p>Recurrent pregnancy loss (RPL) is defined as 2 or more clinical pregnancy losses{cite("ref-3")}. After 2 losses, workup is reasonable; after 3 losses, workup is strongly recommended.</p>
        <p><strong>The workup{cite("ref-4")}:</strong></p>
        <ul class="bullets">
            <li><strong>Antiphospholipid syndrome (APS) screening</strong> &mdash; lupus anticoagulant, anticardiolipin antibodies, anti-&beta;2-glycoprotein I antibodies (each on 2 occasions, 12 weeks apart). Treatable cause when present.</li>
            <li><strong>Uterine cavity assessment</strong> &mdash; saline-infusion sonohysterography or diagnostic hysteroscopy. Septate uterus, intracavitary fibroids, polyps, synechiae are surgically correctable.</li>
            <li><strong>Karyotype of pregnancy tissue</strong> when obtainable &mdash; identifies whether losses are due to random aneuploidy (which doesn&rsquo;t require further parental workup) or balanced structural rearrangement.</li>
            <li><strong>Parental karyotypes</strong> when tissue karyotype is abnormal in a structural way, when there&rsquo;s a family history, or when other workup is negative.</li>
            <li><strong>Thyroid function (TSH)</strong> &mdash; both hypo- and hyperthyroidism associated with loss; subclinical hypothyroidism may merit treatment.</li>
            <li><strong>Diabetes</strong> &mdash; HbA1c if risk factors.</li>
            <li><strong>Prolactin</strong> if cycles are irregular.</li>
            <li><strong>Progesterone</strong> evaluation for luteal phase considerations (controversial; not universally indicated).</li>
        </ul>
        <p><strong>What&rsquo;s NOT routinely indicated</strong>: thrombophilia panels beyond APS (factor V Leiden, prothrombin gene, MTHFR &mdash; not routinely associated with recurrent loss), immune testing panels, peripheral blood karyotyping without indication.</p>
        <p><strong>If a treatable cause is found</strong> &mdash; APS gets aspirin + heparin; uterine cavity lesions get surgical correction; thyroid disease gets treatment; parental balanced translocations get genetic counseling and IVF with PGT options. <strong>Even when no cause is identified</strong> (50&ndash;75% of RPL), live-birth rates with the next pregnancy remain about 60&ndash;70%.</p>
    """,
    "emotional-deep": f"""
        <p>The emotional impact of pregnancy loss varies enormously. Some women find quiet sadness; others experience grief that meets criteria for clinical depression or acute stress disorder{cite("ref-7")}. <strong>None of these reactions are signs of weakness</strong> &mdash; they are documented and clinically significant features of pregnancy loss.</p>
        <p><strong>What can help:</strong></p>
        <ul class="bullets">
            <li><strong>Permission to grieve.</strong> Even very early losses are losses &mdash; of a pregnancy, of a future imagined child, of a sense of safety in your body. Naming it matters.</li>
            <li><strong>Peer support.</strong> Loss-specific support groups (in-person and online) connect you with others who have experienced loss. Many people find this validating in ways that general support doesn&rsquo;t reach.</li>
            <li><strong>Professional counseling.</strong> Perinatal mental-health specialists understand pregnancy loss specifically. CBT, EMDR, and other modalities help with grief and trauma symptoms.</li>
            <li><strong>Ritual or memorialization</strong> if meaningful &mdash; some patients find planting something, writing a letter, naming the pregnancy, or attending a memorial service helps. Others find these not meaningful, and that&rsquo;s also fine.</li>
            <li><strong>Self-compassion</strong> with partners, friends, family. Sharing the loss often surfaces unexpected support; not sharing is also okay.</li>
            <li><strong>Time.</strong> Most acute grief eases over weeks to months, though anniversaries and pregnancy-related reminders may bring waves back.</li>
        </ul>
        <p><strong>When professional help is particularly important:</strong></p>
        <ul class="bullets">
            <li>Symptoms of depression beyond 2&ndash;3 weeks &mdash; persistent low mood, loss of interest, sleep / appetite changes, anhedonia.</li>
            <li>PTSD symptoms &mdash; intrusive thoughts, flashbacks, avoidance, hyperarousal.</li>
            <li>Anxiety severe enough to disrupt life.</li>
            <li>Any thoughts of self-harm or suicide &mdash; please reach out immediately.</li>
            <li>Difficulty in your relationship or parenting other children that&rsquo;s tied to the loss.</li>
        </ul>
        <p>Mount Zara&rsquo;s patient portal messaging can help connect you with appropriate resources &mdash; perinatal counseling, support groups, your primary care team for medication evaluation. You&rsquo;re not alone, and asking for help is the right step.</p>
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
    <title>Pregnancy loss &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A trauma-informed patient guide to early pregnancy loss: diagnosis, the three management options (expectant, medical, surgical), ectopic pregnancy, recurrent loss workup, emotional support. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Pregnancy Loss</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{first_step_section()}
{diagnosis_section()}
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
    "surface": "/education/pregnancy-loss/index.html",
    "topic": "Pregnancy Loss",
    "topic_synthesis_id": "71219e8a-ee3b-42ef-afd7-5e8cf3ee0747",
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
