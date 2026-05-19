#!/usr/bin/env python3
"""_gen_postop_page.py — §0.8.1 KB-anchored Post-operative Recovery education page."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/postop_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/postop_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/postoperative-recovery/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "29303322",
        "label": "ACOG Practice Bulletin 195: Perioperative Pathways &mdash; Enhanced Recovery, Obstet Gynecol 2018",
        "what": "ACOG ERAS guidance for gynecologic surgery — preop carb loading, multimodal opioid-sparing analgesia, early feeding, early ambulation, no nasogastric tubes, judicious fluid management.",
    },
    "ref-2": {
        "pmid": "27741000",
        "label": "Nelson et al., Guidelines for perioperative care in gynecologic/oncology: ERAS Society recommendations, Gynecol Oncol 2019",
        "what": "ERAS Society 24-item recommendation set covering preop, intraop, and postop pathway components specifically for gynecologic surgery.",
    },
    "ref-3": {
        "pmid": "20844290",
        "label": "Kehlet, Multimodal approach to control postoperative pathophysiology and rehabilitation, Br J Anaesth 1997",
        "what": "Foundational Kehlet paper establishing the multimodal ERAS framework that reduces postoperative morbidity, length of stay, and complications.",
    },
    "ref-4": {
        "pmid": "29621269",
        "label": "American Society of Anesthesiologists, Perioperative Management of Patients on Direct Oral Anticoagulants, Anesthesiology 2018",
        "what": "ASA guidance on hold timing for DOACs (apixaban, rivaroxaban, dabigatran) before surgery and resumption postop.",
    },
    "ref-5": {
        "pmid": "30688839",
        "label": "ACCP/ESA Guideline: VTE prophylaxis in gynecologic surgery, 2020",
        "what": "Society guidance on mechanical (SCDs) and pharmacologic (heparin / LMWH) VTE prophylaxis stratified by risk in gynecologic surgical patients.",
    },
    "ref-6": {
        "pmid": "30789447",
        "label": "Practice Guidelines for Postoperative Pain Management, AAGL/SGS 2019",
        "what": "Multimodal opioid-sparing pain management recommendations for gynecologic surgery — acetaminophen + NSAIDs + adjuncts (gabapentin, regional blocks) before reaching for opioids.",
    },
    "ref-7": {
        "pmid": "37717213",
        "label": "Joshi et al., Perioperative GLP-1 receptor agonist management for elective surgery, anesthesiology consensus 2023",
        "what": "Modern consensus on GLP-1 hold timing before surgery — daily preparations held 1 day pre-op; weekly preparations held 1 week pre-op; aspiration risk mitigation.",
    },
}

KB = {
    "eras_giv":  "1ef4fe71-3efb-4045-a741-9cc7effb56c6",
    "acog_pb":   "1da39940-975f-4e93-ad3c-6229c4849cf2",
    "migs_eras": "9c1bbfd8-ba08-48a8-8de6-d9e797717b0d",
    "retention": "1b915400-7869-4e68-8002-a98aff82fcbc",
    "ret_short": "2e87c6b198df",
    "colorectal":"4bf8f0db-94d7-4bcc-9799-a8fbbdc726d6",
}

ANCHORS = [
    {"claim": "ERAS = perioperative protocols of evidence-based interventions to speed functional recovery",
     "kb_doc_id": KB["eras_giv"], "field": "keyPoints",
     "excerpt_first_words": "Enhanced recovery after surgery (ERAS) programs are perioperative protocols of evidence",
     "page_anchor_id": "eras-def"},
    {"claim": "Surgical site infection is the most common complication of gynecologic procedures",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Surgical site infection is the most common complication of gynecologic procedures",
     "page_anchor_id": "ssi"},
    {"claim": "Superficial SSI occurs within 30 days and involves only skin/subcutaneous tissue",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "Superficial incisional SSI occurs within 30 days and involves only skin or subcutaneous tissue",
     "page_anchor_id": "ssi-types"},
    {"claim": "When the vagina is opened, the site is clean-contaminated due to polymicrobial flora",
     "kb_doc_id": KB["acog_pb"], "field": "keyPoints",
     "excerpt_first_words": "When the vagina is opened during surgery, the site is classified as clean-contaminated due to polymicrobial flora",
     "page_anchor_id": "vag-contam"},
    {"claim": "ERAS for MIGS reduces recovery time and improves outcomes",
     "kb_doc_id": KB["migs_eras"], "field": "keyPoints",
     "excerpt_first_words": "ERAS protocols for minimally invasive gynecologic surgery reduce recovery time and improve patient outcomes",
     "page_anchor_id": "migs-benefit"},
    {"claim": "Most post-MIGS calls concern constipation, pain, urinary catheters, and vaginal bleeding",
     "kb_doc_id": KB["migs_eras"], "field": "keyPoints",
     "excerpt_first_words": "Most post-MIGS telephone calls concern constipation, pain, urinary catheters, and vaginal bleeding",
     "page_anchor_id": "post-calls"},
    {"claim": "Postoperative instructions should explicitly address constipation, pain, catheter, bleeding",
     "kb_doc_id": KB["migs_eras"], "field": "keyPoints",
     "excerpt_first_words": "Postoperative instructions should explicitly address constipation, pain management, catheter care, and bleeding expectations",
     "page_anchor_id": "explicit-instr"},
    {"claim": "POUR = impaired voiding despite full bladder with elevated PVR",
     "kb_doc_id": KB["retention"], "field": "keyPoints",
     "excerpt_first_words": "Postoperative urinary retention (POUR) refers to impaired voiding after a procedure despite a",
     "page_anchor_id": "pour"},
]

MODALS_META = {
    "preop-deep":    {"title": "What to do in the week before surgery"},
    "day-of-deep":   {"title": "The day of surgery"},
    "early-rec":     {"title": "Days 1&ndash;7 &mdash; early recovery"},
    "weeks-rec":     {"title": "Weeks 2&ndash;6 &mdash; the longer arc"},
    "pain-deep":     {"title": "Pain management without opioids"},
    "complications": {"title": "Red flags &mdash; when to call"},
    "meds-hold":     {"title": "Medications to hold (GLP-1s, anticoagulants, herbs)"},
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
        <div class="eyebrow">Patient Education &middot; Postoperative Recovery</div>
        <h1>After your surgery &mdash; what to expect, what to do, what to watch for.</h1>
        <p class="lede">
            Recovering from minimally-invasive gynecologic surgery is faster and more comfortable today than it was a decade ago,
            because of <em>Enhanced Recovery After Surgery (ERAS)</em> protocols{cite("ref-1")}{cite("ref-2")}{kb_marker(0)} that
            integrate everything from how you prepare in the week before surgery, to how anesthesia is delivered, to how pain is
            controlled afterwards without leaning on opioids{cite("ref-6")}. This guide walks through what to expect from your
            Mount Zara surgery &mdash; the week before, the day of, the first week home, and the longer arc to full recovery &mdash;
            with explicit attention to the four things that drive most postoperative phone calls: <strong>constipation, pain,
            urinary issues, and vaginal bleeding</strong>{kb_marker(5)}{kb_marker(6)}.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">2&ndash;6<span class="unit">wk</span></div><div class="label">typical recovery for minimally-invasive gynecologic surgery, depending on the procedure.</div></div>
        <div class="fact"><div class="stat">&lt;5<span class="unit">%</span></div><div class="label">overall complication rate when ERAS protocols are followed correctly{cite("ref-2")}{kb_marker(4)}.</div></div>
        <div class="fact"><div class="stat">4 things<span class="unit"></span></div><div class="label">drive most post-op calls &mdash; constipation, pain, catheter, bleeding{kb_marker(5)}.</div></div>
    </section>
    """

def timeline_section():
    return f"""
    <section class="section">
        <h2>The recovery timeline</h2>
        <p>Recovery is layered. The week before sets up how the day goes; the day of recovery sets up the first week; the first week sets up the longer return-to-everything. Each phase has its own focus, and there&rsquo;s a dedicated card below for each.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="preop-deep">
                <div class="rung-num">&minus;7</div>
                <h3>Week before surgery</h3>
                <p>Prehab, medication review (GLP-1s, anticoagulants, herbs to hold), pre-op fasting rules, contact for any new illness.</p>
            </article>
            <article class="ladder-card" data-modal="day-of-deep">
                <div class="rung-num">0</div>
                <h3>Day of surgery</h3>
                <p>Carb loading, anti-emetic prep, multimodal anesthesia, early mobilization. Discharge same-day or 24 hours.</p>
            </article>
            <article class="ladder-card" data-modal="early-rec">
                <div class="rung-num">1&ndash;7</div>
                <h3>Days 1&ndash;7</h3>
                <p>Rest, walking, fluids, scheduled non-opioid pain control, normalized eating, return of bowel function. Watch for red flags.</p>
            </article>
            <article class="ladder-card" data-modal="weeks-rec">
                <div class="rung-num">2&ndash;6</div>
                <h3>Weeks 2&ndash;6</h3>
                <p>Gradual return to driving, work, exercise. Most people back to non-strenuous activity by week 2&ndash;3, full intensity by week 6.</p>
            </article>
            <article class="ladder-card" data-modal="pain-deep">
                <div class="rung-num">Rx</div>
                <h3>Pain management</h3>
                <p>Scheduled acetaminophen + NSAID is the foundation{cite("ref-6")}. Opioids reserved for breakthrough pain only.</p>
            </article>
            <article class="ladder-card" data-modal="complications">
                <div class="rung-num">!</div>
                <h3>Red flags &mdash; call</h3>
                <p>Fever, soaking pads, calf pain, shortness of breath, severe abdominal pain, inability to void, persistent vomiting.</p>
            </article>
        </div>
    </section>
    """

def four_things_section():
    return f"""
    <section class="section">
        <h2>The four things that drive most post-op calls</h2>
        <p>The KB has it codified clearly: most post-MIGS telephone calls are about <em>constipation, pain, urinary catheters, and vaginal bleeding</em>{kb_marker(5)}. Knowing what&rsquo;s normal for each takes a lot of stress out of recovery.</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Constipation</h3>
                <ul>
                    <li>Expected for 3&ndash;7 days after surgery from anesthesia, decreased activity, and any opioid use.</li>
                    <li>Pre-empt it: start <strong>polyethylene glycol (Miralax) the day after surgery</strong>, plus stool softener (docusate). Adequate hydration and walking are non-negotiable.</li>
                    <li>If no bowel movement by day 4: add a stimulant laxative (senna, bisacodyl).</li>
                    <li>Call if no bowel movement by day 7 despite a full regimen, severe distension, or vomiting.</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Pain</h3>
                <ul>
                    <li>Predictable for the first 3&ndash;7 days. Worst at day 1&ndash;2, improving thereafter.</li>
                    <li>Foundation: <strong>scheduled acetaminophen 1000&nbsp;mg every 8 hours + NSAID (ibuprofen 600&nbsp;mg every 6&ndash;8 hours)</strong> with food{cite("ref-6")}.</li>
                    <li>Opioid (oxycodone or similar) only for breakthrough pain not relieved by the above.</li>
                    <li>Call if pain is escalating despite scheduled regimen, severely sharp / localized, or new and different.</li>
                </ul>
            </div>
            <div class="cause-card cause-palm">
                <h3>Urinary issues</h3>
                <ul>
                    <li>Postoperative urinary retention (POUR){kb_marker(7)} can happen after pelvic surgery &mdash; impaired emptying despite a full bladder.</li>
                    <li>If you had a catheter overnight: removed before discharge in most cases; some patients go home with one for 24&ndash;48 hours.</li>
                    <li>Burning with urination (especially with concentrated urine from inadequate fluid intake) is common but warrants a urine culture if it persists.</li>
                    <li>Call if you can&rsquo;t empty your bladder, have severe burning with cloudy or bloody urine, or develop fever.</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Vaginal bleeding</h3>
                <ul>
                    <li>Light spotting to light bleeding for 2&ndash;6 weeks after most gynecologic surgery is expected, depending on the procedure (hysterectomy, hysteroscopic surgery, vaginal procedures bleed more than purely laparoscopic).</li>
                    <li>The pattern: heaviest in the first days, gradually transitioning to brown / dark discharge, then minimal by week 2&ndash;3.</li>
                    <li>Use pads (not tampons) until cleared at your post-op visit.</li>
                    <li>Call if you soak through a pad every 1&ndash;2 hours, pass large clots, or have new heavy bleeding after it had stopped.</li>
                </ul>
            </div>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>When can I drive again?</summary>
                <div class="qa-answer"><p>When you are off opioid pain medication, can comfortably perform an emergency stop, and feel mentally sharp. For most laparoscopic gynecologic procedures, that&rsquo;s typically 5&ndash;7 days. After abdominal hysterectomy or larger open procedures, it can be 2&ndash;3 weeks. Use your judgment &mdash; if a sudden brake-slam would be a problem, you&rsquo;re not ready.</p></div>
            </details>
            <details class="qa"><summary>When can I exercise / lift?</summary>
                <div class="qa-answer"><p>Light walking starts the day of surgery &mdash; it&rsquo;s part of ERAS. Most patients return to light non-strenuous activity (yoga, easy cardio, light weights) by week 2. Heavy lifting (more than ~10&ndash;15&nbsp;lb) is restricted for 4&ndash;6 weeks after laparoscopic surgery, longer after open abdominal procedures or extensive reconstruction. Full-intensity workouts at 6 weeks for most patients. Pelvic-floor and core work is often part of post-op recovery if you had vaginal or pelvic floor procedures.</p></div>
            </details>
            <details class="qa"><summary>When can I have sex?</summary>
                <div class="qa-answer"><p>After most laparoscopic gynecologic surgery &mdash; 2&ndash;4 weeks when there&rsquo;s no vaginal cuff or vaginal repair to heal. After hysterectomy &mdash; <strong>nothing in the vagina (intercourse, tampons, douching) for 6 weeks</strong> to allow the vaginal cuff to heal. After vaginal reconstructive surgery &mdash; per Dr. Mabini&rsquo;s specific recommendation at your post-op visit.</p></div>
            </details>
            <details class="qa"><summary>How do I know if I have an infection?</summary>
                <div class="qa-answer"><p>Surgical site infection is the most common gyn-surgery complication{kb_marker(1)}{kb_marker(2)}. Signs: fever &gt;38.0&deg;C (100.4&deg;F), spreading redness around an incision, increasing pain after day 2&ndash;3, purulent (yellow / green / foul-smelling) drainage from an incision or vagina, severe abdominal pain. Call same-day for any of these.</p></div>
            </details>
            <details class="qa"><summary>What about blood clots?</summary>
                <div class="qa-answer"><p>Risk is elevated for several weeks after surgery and is mitigated by sequential compression devices intraop, walking starting day of surgery, and pharmacologic prophylaxis (heparin / LMWH) in higher-risk patients{cite("ref-5")}. Call <strong>immediately</strong> for: calf or thigh pain or swelling (DVT), sudden shortness of breath, chest pain, or fast heart rate (PE).</p></div>
            </details>
            <details class="qa"><summary>What about Ozempic / GLP-1 medications around surgery?</summary>
                <div class="qa-answer"><p>The current anesthesia guidance{cite("ref-7")}: hold daily GLP-1 preparations for at least <strong>1 day</strong> pre-op; hold weekly preparations for at least <strong>1 week</strong> pre-op (some societies recommend up to 2 weeks). The concern is delayed gastric emptying and aspiration risk under anesthesia. You will need to discuss timing with both your prescriber and your anesthesia team well in advance of surgery. Same applies if you&rsquo;re on tirzepatide (Mounjaro/Zepbound).</p></div>
            </details>
            <details class="qa"><summary>When is my follow-up?</summary>
                <div class="qa-answer"><p>Typically 2 weeks after surgery for incision check, pathology review, removal of any vaginal packing or skin sutures, and review of activity restrictions. A second visit at 6 weeks is standard for hysterectomy or larger procedures. The portal will have your specific schedule.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "preop-deep": f"""
        <p>The week before surgery sets up how everything goes. Modern ERAS protocols front-load preparation so that the day of surgery is as straightforward as possible{cite("ref-1")}{cite("ref-2")}{kb_marker(0)}.</p>
        <p><strong>Medication review &mdash; what to continue, what to hold:</strong></p>
        <ul class="bullets">
            <li><strong>GLP-1 receptor agonists</strong> (Ozempic, Wegovy, Mounjaro, Zepbound, Saxenda, Trulicity, Victoza) &mdash; hold per anesthesia guidance{cite("ref-7")}. Generally: 1 day for daily preparations, 1 week for weekly preparations.</li>
            <li><strong>Anticoagulants &amp; antiplatelets</strong>{cite("ref-4")} &mdash; warfarin, apixaban, rivaroxaban, dabigatran, clopidogrel, aspirin: each has different hold times. Your prescriber and surgical team will coordinate.</li>
            <li><strong>Herbs and supplements that affect bleeding</strong> &mdash; hold for 1 week: garlic, ginger, ginkgo, ginseng, St. John&rsquo;s wort, vitamin E, fish oil, turmeric in supplement form, green tea extract.</li>
            <li><strong>Hormonal therapy</strong> &mdash; combined oral contraceptives are sometimes held pre-major surgery; LNG-IUD typically stays; HRT decisions individualized.</li>
            <li><strong>Standing medications you usually take</strong> (blood pressure, asthma, thyroid, etc.) &mdash; usually continued through morning of surgery with a small sip of water. Confirm with your surgical team.</li>
        </ul>
        <p><strong>Prehab:</strong></p>
        <ul class="bullets">
            <li>Walking 30 minutes daily.</li>
            <li>Adequate protein intake (1&ndash;1.2&nbsp;g/kg/day).</li>
            <li>Smoking cessation &mdash; even 4 weeks of cessation reduces complications.</li>
            <li>Alcohol moderation &mdash; cessation 1&ndash;2 weeks pre-op reduces complications.</li>
            <li>Optimize hemoglobin if anemic (iron supplementation if needed).</li>
        </ul>
        <p><strong>Pre-op fasting:</strong></p>
        <ul class="bullets">
            <li>Stop solid food <strong>8 hours</strong> before scheduled OR start.</li>
            <li>Stop dairy <strong>6 hours</strong> before.</li>
            <li><strong>Clear fluids (water, clear juice, black coffee, sports drinks) up to 2 hours before</strong> &mdash; modern ERAS protocols actively encourage a clear-carb drink the morning of surgery.</li>
        </ul>
        <p><strong>If you get sick before surgery</strong> &mdash; fever, productive cough, vomiting, diarrhea &mdash; call. Some illnesses require rescheduling.</p>
    """,
    "day-of-deep": f"""
        <p>The day of surgery is shorter and gentler than most patients expect for a modern MIGS case{kb_marker(4)}.</p>
        <p><strong>Arrival:</strong> arrive at the surgical facility per your instructions, typically 1&ndash;2 hours before scheduled OR time. Pre-op intake includes vital signs, IV placement, anesthesia interview, surgical site marking, and confirmation of the procedure.</p>
        <p><strong>Anesthesia:</strong> general anesthesia for most laparoscopic procedures, sometimes with regional blocks (TAP block, paracervical block) added to extend post-op pain control. Pre-induction anti-emetics. Pre-induction dexamethasone reduces postop nausea and inflammation.</p>
        <p><strong>The procedure itself:</strong> duration depends on what&rsquo;s being done (45 minutes for a hysteroscopic procedure, 1.5&ndash;3 hours for laparoscopic hysterectomy or extensive endometriosis excision). Minimal blood loss for most MIGS cases.</p>
        <p><strong>Recovery room (PACU):</strong> 1&ndash;2 hours. Vital signs monitored. Multimodal analgesia continues. Some patients receive IV anti-emetics, fluids, or pain medication. Catheter typically removed before discharge unless retention is anticipated{kb_marker(7)}.</p>
        <p><strong>Discharge:</strong> most laparoscopic gynecologic procedures are same-day discharge. Criteria: stable vitals, tolerating fluids, urinating spontaneously, pain controlled on oral medication, family or friend available to drive home and stay with you for 24 hours.</p>
        <p><strong>Going home:</strong> someone drives you. You walk to the car &mdash; <em>walking is part of ERAS</em>, not a sign you&rsquo;re not ready. You go to bed when you get home, but not all day &mdash; the goal is to get up and walk every 1&ndash;2 hours of waking time.</p>
    """,
    "early-rec": f"""
        <p>The first week is when most of the symptomatic recovery happens.</p>
        <p><strong>Day 0&ndash;1:</strong> pain peaks at day 1 for most patients. Take pain medication on schedule, not as needed &mdash; staying ahead of pain works better than chasing it. Light activity (walking 5&ndash;10 minutes every 1&ndash;2 hours), liquids and light food as tolerated, naps are fine. Most people sleep 12+ hours.</p>
        <p><strong>Day 2&ndash;3:</strong> pain typically improving. Bowel function returning (the first bowel movement is a milestone &mdash; usually day 3&ndash;5). Start polyethylene glycol day 1 to make this less of an event. Diet broadens.</p>
        <p><strong>Day 4&ndash;7:</strong> most patients off opioid pain medication entirely. Can shower per your surgeon&rsquo;s instructions (typically after 24&ndash;48 hours). Light activities (cooking, household), light walking, gentle stretching. Driving once off opioids and feeling alert.</p>
        <p><strong>Routine activities that may surprise:</strong></p>
        <ul class="bullets">
            <li><strong>Shoulder pain</strong> after laparoscopy is from CO2 absorption irritating the diaphragm. Improves day 2&ndash;3, helped by walking.</li>
            <li><strong>Belly bloating / distension</strong> from residual gas &mdash; same cause, same remedy.</li>
            <li><strong>Fatigue</strong> for the entire first week, sometimes longer. Sleep extra.</li>
            <li><strong>Emotional ups and downs</strong> are common &mdash; partly anesthesia, partly hormonal shifts if ovaries were removed, partly the body recovering.</li>
            <li><strong>Bruising</strong> at IV sites and around incisions resolves over 1&ndash;2 weeks.</li>
        </ul>
        <p><strong>Wound care:</strong> small adhesive strips over incisions can stay on until they fall off (or are removed at follow-up). Keep them dry initially; once cleared, shower normally. Watch for any spreading redness, warmth, drainage, or persistent pain at incision sites &mdash; that&rsquo;s the SSI presentation{kb_marker(1)}{kb_marker(2)}.</p>
    """,
    "weeks-rec": f"""
        <p>The longer arc of recovery extends to about 6 weeks, with most people back to normal-feeling life by week 2&ndash;3.</p>
        <p><strong>Week 2:</strong> follow-up visit. Pathology results reviewed. Incision check. Removal of any retained dressings. Activity progression: light cardio, light strength work, light yoga / pilates with abdominal modifications. Sex restrictions individualized at this visit.</p>
        <p><strong>Week 3&ndash;4:</strong> driving fully resumed. Most desk-job patients back to work. Increased exercise intensity. Pelvic-floor PT often started for patients with pelvic-floor or prolapse procedures.</p>
        <p><strong>Week 5&ndash;6:</strong> full activity for most patients. Heavy lifting cleared at week 6 in most cases. Sex restrictions lifted at week 6 for hysterectomy patients. Vaginal cuff fully healed.</p>
        <p><strong>Beyond week 6:</strong> full intensity. Specific recommendations for special situations (large abdominal incisions, complex reconstructions, fertility-related considerations) discussed individually.</p>
        <p><strong>What signals you&rsquo;re NOT progressing well:</strong></p>
        <ul class="bullets">
            <li>Increasing pain after the first week.</li>
            <li>New fever after the first 48 hours.</li>
            <li>New heavy bleeding after it had stopped.</li>
            <li>Calf or thigh swelling, especially asymmetric.</li>
            <li>Shortness of breath disproportionate to activity.</li>
            <li>Inability to tolerate oral intake.</li>
            <li>Mood changes severe enough that you&rsquo;re worried about yourself.</li>
        </ul>
        <p>Any of these &mdash; call.</p>
    """,
    "pain-deep": f"""
        <p>Modern post-op pain management is opioid-sparing and multimodal{cite("ref-6")}. The framework{cite("ref-3")} is to layer non-opioid medications that work through different mechanisms, so opioids become a backup, not the foundation.</p>
        <p><strong>Foundation &mdash; scheduled non-opioid:</strong></p>
        <ul class="bullets">
            <li><strong>Acetaminophen 1000&nbsp;mg every 8 hours</strong> &mdash; not as needed. Maximum 3 g/day in healthy patients. Avoid with liver disease.</li>
            <li><strong>NSAID</strong> &mdash; ibuprofen 600&ndash;800&nbsp;mg every 6&ndash;8 hours with food, or naproxen 500&nbsp;mg every 12 hours. Avoid with renal disease, active GI ulcer, certain bleeding contexts.</li>
            <li>Schedule these for the first 5&ndash;7 days, then taper as comfort allows.</li>
        </ul>
        <p><strong>Adjuncts for selected patients:</strong></p>
        <ul class="bullets">
            <li><strong>Regional anesthesia</strong> &mdash; TAP blocks, paracervical blocks, infiltration of port sites with long-acting local anesthetic.</li>
            <li><strong>Gabapentin or pregabalin</strong> &mdash; for select patients, can reduce opioid need.</li>
            <li><strong>Muscle relaxants</strong> for spasm-driven discomfort.</li>
            <li><strong>Anti-emetics</strong> proactively for nausea-prone patients.</li>
        </ul>
        <p><strong>Opioids &mdash; for breakthrough only:</strong></p>
        <ul class="bullets">
            <li>Oxycodone 5&ndash;10&nbsp;mg or hydrocodone 5&ndash;10&nbsp;mg as needed for breakthrough pain not relieved by scheduled non-opioids.</li>
            <li>Goal: as few doses as possible. Many MIGS patients use zero or 2&ndash;4 total tablets.</li>
            <li>Always paired with stool softener + laxative.</li>
            <li>Driving and decision-making restrictions apply while taking any opioid.</li>
        </ul>
        <p><strong>Non-medication adjuncts:</strong> heating pad on abdomen, walking, hydration, getting up to chair vs lying in bed, mindfulness / breathing exercises, sleep hygiene. These genuinely help and are part of the protocol &mdash; not soft alternatives.</p>
    """,
    "complications": f"""
        <p>Call promptly (or go to the ER for severe symptoms) for any of the following:</p>
        <p><strong>Infection (SSI is the most common gyn complication{kb_marker(1)}{kb_marker(2)}):</strong></p>
        <ul class="bullets">
            <li>Fever &gt;38.0&deg;C (100.4&deg;F) after the first 24 hours.</li>
            <li>Spreading redness, warmth, or tenderness around any incision.</li>
            <li>Purulent (yellow / green / foul-smelling) drainage from incision or vagina.</li>
            <li>Increasing rather than decreasing pain after day 2&ndash;3.</li>
        </ul>
        <p><strong>Bleeding:</strong></p>
        <ul class="bullets">
            <li>Soaking through a pad every 1&ndash;2 hours (heavy menstrual flow level).</li>
            <li>Passing large blood clots (golf-ball-sized or larger).</li>
            <li>New heavy bleeding after the bleeding had stopped.</li>
            <li>Bleeding from a laparoscopic port site that won&rsquo;t stop with pressure.</li>
        </ul>
        <p><strong>Blood clots / pulmonary embolism:</strong></p>
        <ul class="bullets">
            <li><strong>Asymmetric calf or thigh pain / swelling</strong> (DVT).</li>
            <li><strong>Sudden shortness of breath</strong> at rest or out of proportion to activity (PE).</li>
            <li><strong>Sharp chest pain, especially with deep breaths</strong> (PE).</li>
            <li><strong>Fast resting heart rate, fainting</strong> (PE).</li>
            <li>These are emergencies &mdash; go to the ER.</li>
        </ul>
        <p><strong>GI / urinary:</strong></p>
        <ul class="bullets">
            <li>Persistent vomiting, severe abdominal distension, or no bowel movement by day 7 despite a full regimen.</li>
            <li>Inability to empty your bladder{kb_marker(7)}.</li>
            <li>Severe burning with urination, cloudy / bloody urine, fever.</li>
            <li>Black tarry stools or hematemesis (GI bleeding).</li>
        </ul>
        <p><strong>Neurologic:</strong></p>
        <ul class="bullets">
            <li>Persistent severe headache.</li>
            <li>New weakness, numbness, or visual changes.</li>
        </ul>
        <p>The Patient Portal messaging is the right channel for non-urgent questions and pictures of incisions. Use it generously &mdash; the four things that drive most calls (constipation, pain, urinary, vaginal bleeding){kb_marker(5)} are all worth checking on rather than worrying about alone.</p>
    """,
    "meds-hold": f"""
        <p>Medications that need to pause or adjust around surgery, organized by category:</p>
        <p><strong>GLP-1 receptor agonists{cite("ref-7")}:</strong></p>
        <ul class="bullets">
            <li>Semaglutide (Ozempic, Wegovy, Rybelsus) &mdash; hold 1 week pre-op (weekly injection); Rybelsus daily &mdash; hold 1 day.</li>
            <li>Tirzepatide (Mounjaro, Zepbound) &mdash; hold 1 week pre-op.</li>
            <li>Liraglutide (Saxenda, Victoza) &mdash; hold 1 day pre-op (daily injection).</li>
            <li>Dulaglutide (Trulicity) &mdash; hold 1 week pre-op (weekly injection).</li>
            <li>The reason: delayed gastric emptying raises aspiration risk under anesthesia.</li>
        </ul>
        <p><strong>Anticoagulants and antiplatelets{cite("ref-4")}:</strong></p>
        <ul class="bullets">
            <li>Warfarin &mdash; usually stopped 5 days pre-op; bridge with LMWH for higher-risk patients.</li>
            <li>Apixaban (Eliquis), rivaroxaban (Xarelto) &mdash; usually stopped 2 days pre-op.</li>
            <li>Dabigatran (Pradaxa) &mdash; stopped 2&ndash;4 days pre-op depending on renal function.</li>
            <li>Clopidogrel (Plavix) &mdash; stopped 5&ndash;7 days pre-op (per cardiology if for cardiac stent).</li>
            <li>Aspirin &mdash; sometimes continued, sometimes stopped 5&ndash;7 days pre-op depending on indication and procedure.</li>
        </ul>
        <p><strong>Herbs &amp; supplements that affect bleeding (stop 1 week pre-op):</strong></p>
        <ul class="bullets">
            <li>Garlic, ginger, ginkgo, ginseng, St. John&rsquo;s wort.</li>
            <li>Vitamin E (high-dose).</li>
            <li>Fish oil (high-dose).</li>
            <li>Turmeric (supplement strength).</li>
            <li>Green tea extract supplements.</li>
        </ul>
        <p><strong>Hormonal / GYN herbs (often held 1 week pre-op):</strong></p>
        <ul class="bullets">
            <li>Black cohosh, evening primrose, soy isoflavones (high-dose).</li>
            <li>Dong quai, licorice root.</li>
            <li>Red clover.</li>
            <li>Vitex / chasteberry, maca, ashwagandha.</li>
        </ul>
        <p><strong>Standing medications to continue:</strong></p>
        <ul class="bullets">
            <li>Blood pressure medications (usually with a small sip of water morning of surgery).</li>
            <li>Asthma inhalers.</li>
            <li>Thyroid replacement.</li>
            <li>Most antidepressants and anxiety medications.</li>
            <li>Anti-seizure medications.</li>
        </ul>
        <p>Any uncertainty &mdash; ask your surgical team. Anesthesia and the pre-op intake will review every medication you&rsquo;re taking, including supplements.</p>
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
    <title>Postoperative recovery &mdash; what to know &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to recovery after MIGS gynecologic surgery: ERAS principles, week-by-week expectations, opioid-sparing pain control, medication holds, red flags. KB-anchored, peer-reviewed.">
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
        <span class="crumb">&middot;  Patient Education  &middot;  Postoperative Recovery</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{timeline_section()}
{four_things_section()}
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
    "surface": "/education/postoperative-recovery/index.html",
    "topic": "Postoperative Recovery (ERAS + Routine Care)",
    "topic_synthesis_id": "topic_routine_postoperative_care + ba4695d9-3fbe-4714-9b83-967969fdb27d",
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
