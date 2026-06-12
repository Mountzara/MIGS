# -*- coding: utf-8 -*-
"""tb_mcas_pots_eds.py — deep-dives for the trend brief
"MCAS, POTS, and Ehlers-Danlos hypermobility as a triad in chronic pelvic pain".
Verdict: Partially supported · pairwise associations documented · triad-as-formal-syndrome contested.
Patient+provider voice per §3.9."""

AUTHORED = {

# 31267471 — review questioning the validity of the hEDS/POTS/MCAS triad
"31267471": {
    "bottom": "A <strong>measured review of the proposed triad</strong>. People increasingly ask about a unified hEDS + POTS + MCAS 'triad' — joint hypermobility, a racing-heart-on-standing syndrome, and a mast-cell/allergy syndrome. This review finds all three conditions are real and do co-occur, but the evidence that they form one validated, single disease is weak. In plain terms: your symptoms are real and the overlap is recognized, yet calling it one proven disease overstates the science — and the soundest approach is to evaluate and treat each part on its own evidence rather than as a single bundle.",
    "question": "<strong>The problem.</strong> A 'triad' of hypermobile Ehlers-Danlos syndrome (hEDS), postural orthostatic tachycardia syndrome (POTS), and mast cell activation syndrome (MCAS) has become a popular explanatory label, especially online, but it's unclear whether the science supports treating it as one entity. <strong>The question:</strong> is there scientific validity to the hEDS-POTS-MCAS triad as a unified syndrome?",
    "pico": {"P": "Patients with hypermobility, orthostatic intolerance, and/or mast-cell-type symptoms.",
             "I": "Critical review of the proposed triad construct.",
             "C": "Each condition considered separately vs as a unified triad.",
             "O": "Strength of evidence for a real, unified relationship.",
             "D": "Narrative review.",
             "S": "Not applicable."},
    "methods": "An extensive review of the literature on whether hEDS, POTS, and MCAS are genuinely linked as one syndrome. <strong>Keep in mind:</strong> it weighs existing evidence rather than generating new data, and much of that evidence is associational and from selected clinic populations.",
    "findings": "The conditions co-occur more than chance in some clinic populations, but the review finds <strong>insufficient scientific validity</strong> to treat the triad as a single, mechanistically unified disease — diagnostic criteria (especially for MCAS) are contested, and selection/referral patterns can manufacture apparent associations. The honest read: real symptoms and real overlap, contested unifying label.",
    "rob": "Narrative review limits apply; underlying studies are largely from specialty clinics (selection bias toward co-diagnosis) and MCAS itself lacks agreed objective criteria, so 'associations' may be partly artifacts of how patients are labeled and referred.",
    "strengths": "A needed, sober counterweight to a fast-spreading clinical narrative — it validates patient symptoms while protecting against over-diagnosis and unproven bundled treatment.",
    "applicability": "This helps set expectations: a clinician may not endorse 'the triad' as one disease, and that isn't dismissal — each piece still gets taken seriously and evaluated. Hypermobility, orthostatic intolerance, and mast-cell symptoms are each assessed and managed on their own merits, rather than under a single bundled label or with one bundled, unproven treatment.",
    "kb": "This is the brief's critical anchor and the reason for 'triad-as-formal-syndrome contested'. The other three papers document the real pairwise pieces (hypermobility↔pelvic pain, hEDS gynecologic burden, hEDS autonomic dysfunction).",
    "equity": "These conditions disproportionately affect women, whose multisystem symptoms are historically under-believed. The balance to strike: take the symptoms seriously without locking patients into an unvalidated mega-diagnosis that can itself cause harm (over-testing, fatalism).",
    "monday": "<strong>Counsel / hold the label.</strong> Validate symptoms, evaluate each component on its own evidence, and avoid endorsing 'the triad' as a proven unified disease or a reason for bundled unproven treatments. Treat what's treatable (e.g., POTS measures, pelvic-floor therapy) on its own merits.",
    "prompts": "<ol><li>How do you validate a patient's symptoms while declining an unvalidated unifying diagnosis?</li><li>How much of the triad's apparent co-occurrence is referral/selection bias?</li><li>What objective criteria would MCAS need before the triad could be tested as a real entity?</li></ol>",
},

# 30729750 — joint hypermobility prevalence in chronic myofascial pelvic pain
"30729750": {
    "bottom": "A <strong>prevalence study</strong> measuring how common generalized joint hypermobility is among women with chronic myofascial (muscle/connective-tissue) pelvic pain. It supplies one real, measurable link behind the idea: hypermobility and pelvic pain do travel together more than expected. So if you're hypermobile and have pelvic-floor pain, you're not imagining the connection — it's a recognized reason to check for hypermobility in this kind of pain, keeping in mind that an association isn't the same as one thing causing the other.",
    "question": "<strong>The problem.</strong> Chronic pelvic pain affects up to ~1 in 4 women, often with a myofascial (muscle/connective-tissue) component, and clinicians had hypothesized a link with joint hypermobility without good prevalence data. <strong>The question:</strong> how common is generalized joint hypermobility in women with chronic myofascial pelvic pain?",
    "pico": {"P": "Women presenting with chronic myofascial pelvic pain.",
             "I": "Standardized assessment of generalized joint hypermobility (e.g., Beighton scoring).",
             "C": "Expected/general-population hypermobility prevalence.",
             "O": "Prevalence of joint hypermobility in this population.",
             "D": "Cross-sectional prevalence study.",
             "S": "Clinic cohort (study-defined)."},
    "methods": "Women with chronic myofascial pelvic pain were assessed for generalized joint hypermobility using a standardized measure, and prevalence was estimated. <strong>Keep in mind:</strong> a single-clinic cross-section captures association at one point, not whether hypermobility causes the pain.",
    "findings": "Joint hypermobility was notably prevalent in the chronic-myofascial-pelvic-pain group, supporting a real association between connective-tissue laxity and pelvic-floor pain. It quantifies one leg of the 'triad' story with actual data rather than anecdote.",
    "rob": "Cross-sectional and clinic-based: selection bias (referral centers attract complex cases), no causal direction, and assessment of both hypermobility and 'myofascial' pain involves some subjectivity.",
    "strengths": "Puts numbers to a previously hypothesized link, in a common and under-studied condition — directly useful for deciding whom to screen.",
    "applicability": "It validates the hypermobility–pelvic-pain connection and supports care that's aware of both the pelvic floor and connective-tissue laxity — which can shape the physical-therapy approach. It remains an association, not proof of cause.",
    "kb": "One of the documented pairwise associations underpinning the brief (hypermobility↔pelvic pain), counterbalancing the validity-skeptical triad review.",
    "equity": "Chronic pelvic pain in women is under-researched; quantifying real associations helps legitimize care for a frequently dismissed problem.",
    "monday": "<strong>Counsel / consider screening.</strong> Reasonable to assess hypermobility in chronic myofascial pelvic pain and tailor pelvic-floor physical therapy accordingly. Don't extend a single association into the full unvalidated triad.",
    "prompts": "<ol><li>Does identifying hypermobility change your pelvic-floor PT or pain plan?</li><li>Is the association causal, or do both share an upstream connective-tissue/central-sensitization driver?</li><li>How do referral patterns inflate the apparent prevalence?</li></ol>",
},

# 27619482 — gynecologic symptoms in 386 women with hEDS
"27619482": {
    "bottom": "A <strong>study of 386 women with hypermobile Ehlers-Danlos syndrome</strong> documenting their gynecologic and obstetric symptoms — chronic pain, abnormal bleeding, and effects on reproductive life. It shows hEDS carries a real, heavy gynecologic burden, so if you have hEDS these symptoms are common and recognized rather than coincidental — and it's a good reason for hEDS and gynecologic symptoms to be asked about together.",
    "question": "<strong>The problem.</strong> hEDS is a common heritable connective-tissue disorder affecting women more than men and causing multi-organ symptoms, but its gynecologic and obstetric impact was under-characterized. <strong>The question:</strong> what gynecologic symptoms do women with hEDS experience, and how do these affect reproductive life?",
    "pico": {"P": "386 women with hypermobile Ehlers-Danlos syndrome.",
             "I": "Structured assessment of gynecologic/obstetric symptoms.",
             "C": "General expectations / within-cohort patterns.",
             "O": "Prevalence and impact of gynecologic symptoms (pain, bleeding, reproductive effects).",
             "D": "Observational survey/cohort study.",
             "S": "n = 386."},
    "methods": "A sizeable cohort of women with hEDS was surveyed/assessed for gynecologic and obstetric symptoms and their effect on reproductive life. <strong>Keep in mind:</strong> self-reported symptom surveys in a diagnosed cohort capture burden well but can't establish mechanism or causation.",
    "findings": "Women with hEDS reported high rates of chronic pain, abnormal/heavy bleeding, and other gynecologic symptoms that meaningfully affected reproductive life — documenting a substantial, often-overlooked gynecologic dimension of the connective-tissue disorder.",
    "rob": "Observational and largely self-reported, with possible recall and selection bias (engaged, diagnosed patients). It establishes burden and association, not causal mechanism.",
    "strengths": "A relatively large, focused dataset on a real but neglected intersection (connective-tissue disease and gynecologic health), directly useful for anticipating and addressing symptoms.",
    "applicability": "It validates that gynecologic symptoms are part of the hEDS picture and worth raising — and worth screening for — with attention to how connective-tissue laxity can affect things like bleeding and prolapse risk.",
    "kb": "Documents the hEDS↔gynecologic-burden leg of the brief's pairwise associations — real and substantial — while the triad-as-syndrome remains contested.",
    "equity": "A women-predominant, under-recognized condition; quantifying the gynecologic burden helps ensure these symptoms are taken seriously and managed.",
    "monday": "<strong>Counsel / screen.</strong> Ask hEDS patients about pelvic pain and bleeding, and consider hEDS in women with multisystem symptoms plus gynecologic complaints. Manage symptoms on their own merits.",
    "prompts": "<ol><li>Should hEDS prompt specific gynecologic surveillance (bleeding, prolapse)?</li><li>How does connective-tissue laxity influence surgical and obstetric decisions in these patients?</li><li>Where does this burden intersect with the hypermobility–pelvic-pain association?</li></ol>",
},

# 28160388 — cardiovascular autonomic dysfunction in hEDS
"28160388": {
    "bottom": "A <strong>study of autonomic (automatic nervous system) dysfunction in hypermobile Ehlers-Danlos syndrome</strong> — the POTS/orthostatic-intolerance part of the proposed triad. It documents that many people with hEDS have real cardiovascular-autonomic problems: a racing heart and lightheadedness on standing, blood-pressure swings, and gut and bladder dysmotility. So the dizziness-on-standing and related symptoms in hEDS are a recognized physiological phenomenon worth evaluating — and treatable on their own terms.",
    "question": "<strong>The problem.</strong> Autonomic symptoms (orthostatic intolerance, POTS-type tachycardia, GI and bladder dysfunction) impair quality of life in hEDS, but their nature and frequency needed clearer documentation. <strong>The question:</strong> what cardiovascular autonomic dysfunction occurs in hypermobile-type Ehlers-Danlos syndrome?",
    "pico": {"P": "Patients with hypermobile-type Ehlers-Danlos syndrome.",
             "I": "Assessment of cardiovascular autonomic function (orthostatic testing, symptom evaluation).",
             "C": "Normal autonomic function / expected ranges.",
             "O": "Types and frequency of autonomic dysfunction (orthostatic intolerance/hypotension, POTS).",
             "D": "Observational clinical study.",
             "S": "hEDS cohort (study-defined)."},
    "methods": "hEDS patients were evaluated for cardiovascular autonomic dysfunction, characterizing orthostatic intolerance, orthostatic hypotension, and postural tachycardia along with associated GI/bladder/sweating symptoms. <strong>Keep in mind:</strong> clinic-based autonomic assessment documents the phenomenon but doesn't prove hEDS causes it versus shared mechanisms.",
    "findings": "Cardiovascular autonomic dysfunction — including orthostatic intolerance, orthostatic hypotension, and postural tachycardia (POTS-spectrum) — was common in hEDS and contributed to impaired quality of life, with associated dysmotility and bladder/sweating disturbance. This documents the POTS leg of the triad with objective autonomic findings.",
    "rob": "Observational, clinic-based; selection bias and lack of a matched control group limit causal claims. It shows the association is real and physiologically grounded, not that hEDS uniquely causes POTS.",
    "strengths": "Grounds the 'POTS' part of the popular triad in measurable cardiovascular-autonomic physiology, supporting real evaluation and management rather than dismissal.",
    "applicability": "Standing-related symptoms in hEDS are real, and there are concrete management steps — fluids, salt, compression, gradual conditioning, and sometimes medication. Screening for and managing orthostatic intolerance/POTS directly is worthwhile, since it intersects with pelvic pain and fatigue.",
    "kb": "Supplies the hEDS↔autonomic-dysfunction (POTS) leg of the brief's documented pairwise associations — again real, while the unified triad remains contested.",
    "equity": "Autonomic symptoms in young women are frequently misattributed to anxiety; objective documentation helps secure legitimate evaluation and care.",
    "monday": "<strong>Counsel / evaluate and treat the component.</strong> Screen for and manage orthostatic intolerance/POTS in hEDS on its own evidence (non-pharmacologic measures first). Don't bundle it into an unvalidated unified-triad treatment plan.",
    "prompts": "<ol><li>What's your first-line approach to orthostatic intolerance in an hEDS patient with pelvic pain and fatigue?</li><li>Is the hEDS–POTS link causal or a shared connective-tissue/autonomic mechanism?</li><li>How do autonomic symptoms color the pelvic-pain picture?</li></ol>",
},

}
