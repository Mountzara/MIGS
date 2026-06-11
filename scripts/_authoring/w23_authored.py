# -*- coding: utf-8 -*-
"""
w23_authored.py — Hand-authored journal-club content for blog-2026-W23
(CBG/MIGS Monday Mornings, 2026-W23).

Per CLAUDE.md §3.9: clinical content authored by reading each paper's verbatim
PubMed abstract individually — NOT heuristically generated. Each entry is a
per-paper clinical assessment keyed by PMID, framed against the topic group's
DO + CBG/MIGS systems thesis, with honest appraisal of how directly each cross-
disciplinary mechanism / technology-transfer paper supports that thesis.

Sections authored (§3.9 judgment set): bottom, question, pico (dict), findings,
strengths, applicability, equity, prompts (<ol>). methods/rob/kb/monday are
pipeline-auto-filled; abstract is mirrored verbatim separately.

Author: Christopher Z. Mabini, DO — journal-club review for W23.
"""

AUTHORED = {

# ===================== C-SECTION SCAR (fascial continuity + somatic dysfunction) =====================

"42219838": {  # Intrathecal dexmedetomidine vs fentanyl, caesarean — meta-analysis
    "bottom": "Meta-analysis directly relevant to cesarean practice: intrathecal dexmedetomidine vs fentanyl as a spinal-block adjuvant for lower-segment cesarean. Dexmedetomidine prolonged sensory/motor block and analgesia versus fentanyl, with a different (mostly favorable) maternal/neonatal side-effect profile. A real data point for the anesthesia conversation around your cesareans.",
    "question": "<p><strong>The clinical problem.</strong> Intrathecal opioids are the default spinal adjuvant for cesarean but carry pruritus, nausea, and neonatal concerns; the optimal adjuvant balancing block quality against side effects is unsettled.</p><p><strong>The question.</strong> In lower-segment cesarean, does intrathecal dexmedetomidine improve spinal-block quality versus fentanyl?</p>",
    "pico": {"P": "Women undergoing lower-segment cesarean under spinal anesthesia.", "I": "Intrathecal dexmedetomidine.", "C": "Intrathecal fentanyl.", "O": "Block onset/duration, analgesia duration, maternal/neonatal side effects.", "D": "Systematic review/meta-analysis of RCTs.", "S": "Pooled RCT participants."},
    "findings": "<p>Pooled data favored dexmedetomidine for longer sensory/motor block and prolonged analgesia, with side-effect trade-offs (less pruritus than fentanyl; watch bradycardia/sedation).</p>",
    "strengths": "<p>Directly clinical, RCT-based, with maternal and neonatal endpoints rather than a surrogate.</p>",
    "applicability": "<p>Applicable to the anesthesia plan for your cesarean patients — a point to raise with anesthesiology. Adoption is governed by local neuraxial-adjuvant protocols; the surgeon's role is awareness and recovery-quality counseling.</p>",
    "equity": "<p>Pooled trials span varied resource settings; check individual-trial populations before generalizing dosing.</p>",
    "prompts": "<ol><li>Does longer analgesia translate into less systemic opioid and faster maternal mobilization in your unit?</li><li>How do bradycardia/sedation signals weigh against reduced pruritus/nausea?</li><li>Is trial heterogeneity tight enough to trust the pooled estimate?</li></ol>",
},

"42216386": {  # Amniotic membrane transplant for fat adherence syndrome (strabismus) — ophthalmology
    "bottom": "Ophthalmology series (amniotic membrane transplantation for fat-adherence syndrome, a restrictive strabismus after eye-muscle surgery). Out-of-field, included under the cesarean-scar thesis only as <em>adhesion/scar-barrier biology</em>: amniotic membrane is an anti-adhesion/anti-fibrotic interface, and adhesion prevention is a genuine post-cesarean concern. Support is indirect — no gynecologic tissue here.",
    "question": "<p><strong>The clinical problem.</strong> Post-surgical adhesions and pathologic scar tethering degrade function across surgical fields; the cesarean analogue is intra-abdominal and uterine-scar adhesion. Anti-adhesion interface materials (amniotic membrane) are one mechanistic approach.</p><p><strong>The question.</strong> Does adjunctive amniotic membrane transplantation improve outcomes in surgical management of fat-adherence syndrome?</p>",
    "pico": {"P": "Patients with fat-adherence syndrome (restrictive strabismus after inferior oblique surgery).", "I": "Adjunctive amniotic membrane transplantation.", "C": "Surgery without AMT (historical/within-series).", "O": "Restriction/motility outcomes.", "D": "Retrospective clinical series (ophthalmology).", "S": "Small case series."},
    "findings": "<p>The series reported outcomes of AMT as an anti-adhesion adjunct in a rare restrictive-strabismus condition, illustrating membrane-interface adhesion control.</p>",
    "strengths": "<p>Concrete clinical use of an anti-adhesion biologic interface — the transferable concept for adhesion-prone surgery.</p>",
    "applicability": "<p>Indirect. Nothing changes cesarean practice; value is conceptual (adhesion-barrier strategies). Do not extrapolate an ophthalmic membrane technique to the abdomen.</p>",
    "equity": "<p>Tiny ophthalmology series; no gynecologic-population relevance for generalization.</p>",
    "prompts": "<ol><li>Do anti-adhesion barrier concepts from other fields inform cesarean/abdominal adhesion prevention?</li><li>Is 'shared adhesion biology' a strong enough thread to include an ophthalmology series?</li><li>What is your actual evidence base for adhesion barriers at cesarean?</li></ol>",
},

"42213622": {  # PAS detection US/MRI in placenta previa — retrospective cohort
    "bottom": "Directly obstetric and surgically consequential: how well ultrasound and MRI detect placenta accreta spectrum AND predict adverse perinatal outcomes in placenta-previa pregnancies. PAS drives the most morbid cesarean-hysterectomies; better preoperative prediction changes surgical planning, blood-product readiness, and team assembly.",
    "question": "<p><strong>The clinical problem.</strong> PAS turns a cesarean into a potential massive-hemorrhage, cesarean-hysterectomy event; imaging must both detect invasion and forecast morbidity to enable planning.</p><p><strong>The question.</strong> How effective are US and MRI at detecting PAS and predicting adverse maternal/neonatal outcomes in placenta previa?</p>",
    "pico": {"P": "Pregnant women with placenta previa.", "I": "Ultrasonography and MRI assessment.", "C": "Imaging findings vs actual PAS/outcomes.", "O": "PAS detection accuracy; prediction of adverse perinatal outcomes.", "D": "Retrospective cohort.", "S": "Previa cohort (study-defined)."},
    "findings": "<p>The study characterized US and MRI performance for PAS detection and, notably, for predicting maternal/neonatal morbidity — extending imaging value from diagnosis to outcome forecasting.</p>",
    "strengths": "<p>Goes beyond detection to morbidity prediction — the clinically actionable endpoint for surgical planning.</p>",
    "applicability": "<p>Highly applicable to preoperative PAS planning: imaging informs the surgical approach, blood readiness, and multidisciplinary mobilization. Single-cohort accuracy figures need triangulation before fixed thresholds.</p>",
    "equity": "<p>Single-center; MRI access varies widely, an equity factor in PAS planning across settings.</p>",
    "prompts": "<ol><li>Does adding MRI to US change your PAS surgical plan, or just confirm it?</li><li>How do you operationalize imaging-predicted morbidity into team/blood readiness?</li><li>What is your threshold for referral to a PAS center?</li></ol>",
},

"42213020": {  # Unilateral spinal anesthesia in repeat cesarean — case report
    "bottom": "Anesthesia case report of a rare true one-sided spinal block during elective repeat cesarean — a failed/asymmetric block that risks precipitous conversion to general anesthesia (with its maternal/neonatal morbidity). A cautionary case on neuraxial failure modes relevant to anyone doing cesareans.",
    "question": "<p><strong>The clinical problem.</strong> Asymmetric or failed spinal blocks can force emergent general anesthesia mid-cesarean, raising maternal and neonatal risk; the true unilateral block is poorly characterized.</p><p><strong>The question.</strong> How does a true one-sided spinal block present and get managed in repeat cesarean?</p>",
    "pico": {"P": "A 32-year-old multiparous woman, elective repeat cesarean.", "I": "Spinal anesthesia (resulting in unilateral block).", "C": "Not applicable (case).", "O": "Block failure pattern and management.", "D": "Case report.", "S": "n = 1."},
    "findings": "<p>The report documents complete one-sided absence of anesthesia despite correct subarachnoid technique, and the management pathway to avoid/precipitate general anesthesia.</p>",
    "strengths": "<p>Characterizes a rare, under-described neuraxial failure mode with practical management lessons.</p>",
    "applicability": "<p>Awareness-level for the cesarean team: recognize asymmetric block early and have a rescue plan short of immediate GA. Single case — illustrative, not statistical.</p>",
    "equity": "<p>n=1; no generalizable population data.</p>",
    "prompts": "<ol><li>What's your escalation pathway for an asymmetric spinal at cesarean before defaulting to GA?</li><li>How do you counsel patients on block-failure risk?</li><li>Do unilateral positioning techniques help or hurt here?</li></ol>",
},

"42212370": {  # Epigenetics of cutaneous-fibrosis scar formation — review (dermatology)
    "bottom": "Dermatology mechanism review: cutaneous fibrosis is sustained by epigenetic 'memory' (DNA hypermethylation, repressive histone marks, ncRNA networks locking fibroblasts into a collagen-producing state) rather than ongoing inflammation. Out-of-field, but a genuinely relevant <em>fibrosis-mechanism</em> support for the cesarean-scar/niche thesis — the same epigenetic fibroblast programming plausibly underlies pathologic uterine-scar healing. Mechanistic, not clinical.",
    "question": "<p><strong>The clinical problem.</strong> Pathologic scarring — keloid, hypertrophic, and arguably the dysfunctional cesarean niche — behaves as a self-sustaining fibrotic program; if epigenetic memory drives it, that reframes prevention and reversal targets.</p><p><strong>The question.</strong> What epigenetic mechanisms (DNA methylation, ncRNAs) sustain cutaneous fibrosis, and are they therapeutic targets?</p>",
    "pico": {"P": "Dermal fibroblasts / cutaneous-fibrosis models.", "I": "Review of epigenetic regulation (methylation, histone marks, ncRNAs).", "C": "Normal vs fibrotic epigenetic states.", "O": "Mechanistic targets for fibrosis modulation.", "D": "Narrative mechanistic review (dermatology).", "S": "Not applicable."},
    "findings": "<p>The review argues fibrosis is locked in by epigenetic memory rather than chronic inflammation, nominating DNA-methylation and ncRNA nodes as reversal targets.</p>",
    "strengths": "<p>Coherent mechanistic model with druggable nodes; the 'memory not inflammation' framing is conceptually portable to uterine scar biology.</p>",
    "applicability": "<p>Indirect — no uterine data and nothing to prescribe. Its value is conceptual scaffolding for how we think about cesarean-niche fibrosis and future scar-modulation. Don't extrapolate dermatology therapeutics to the uterus.</p>",
    "equity": "<p>Mechanistic review — no population; translational equity unaddressed.</p>",
    "prompts": "<ol><li>Is 'epigenetic memory' a credible model for the dysfunctional cesarean niche?</li><li>What would link this skin-fibrosis biology to uterine-scar healing experimentally?</li><li>How should a journal club weight a high-mechanism, zero-clinical out-of-field review?</li></ol>",
},

"42210897": {  # Polyglactin 910 vs fast-absorbing gut for facial-scar cosmesis — blinded RCT
    "bottom": "Blinded RCT (dermatologic surgery) comparing absorbable suture types for epidermal closure and resulting facial-scar cosmesis — rapidly absorbable polyglactin 910 favored over fast-absorbing gut. Out-of-field, but a real <em>wound-closure/scar-cosmesis</em> data point: suture choice affects scar quality, and cesarean skin closure is the gynecologic analogue. Indirect but practically resonant.",
    "question": "<p><strong>The clinical problem.</strong> Suture material for skin closure influences final scar appearance, yet adequately powered head-to-head cosmesis RCTs are scarce — relevant wherever we close skin, including cesarean.</p><p><strong>The question.</strong> Does rapidly absorbable polyglactin 910 yield better epidermal-closure scar cosmesis than fast-absorbing gut?</p>",
    "pico": {"P": "Patients with postsurgical facial wounds (epidermal closure).", "I": "Rapidly absorbable polyglactin 910 sutures.", "C": "Fast-absorbing gut sutures.", "O": "Blinded photographic cosmetic-outcome assessment.", "D": "Blinded randomized clinical trial.", "S": "RCT cohort."},
    "findings": "<p>Blinded photographic assessment favored polyglactin 910 over fast-absorbing gut for facial-scar cosmesis.</p>",
    "strengths": "<p>Blinded, randomized, with objective photographic outcomes — strong internal validity for a cosmesis question.</p>",
    "applicability": "<p>Indirect: facial skin ≠ a Pfannenstiel incision, and cosmesis priorities differ. The transferable idea is that suture choice measurably affects scar quality; don't directly port a facial-suture conclusion to cesarean closure.</p>",
    "equity": "<p>Facial-surgery population; skin type/ancestry strongly affects scarring and isn't necessarily represented.</p>",
    "prompts": "<ol><li>Does suture-material evidence from facial surgery inform your cesarean skin closure at all?</li><li>What would a cesarean-specific closure-cosmesis trial need to measure?</li><li>How do skin-type differences limit transfer of cosmesis findings?</li></ol>",
},

"42209040": {  # Anesthetic mgmt of pregnant RVOT-VT for cesarean — case
    "bottom": "Obstetric-anesthesia/cardiac case: managing a pregnant patient with catecholamine-sensitive right-ventricular-outflow-tract VT for cesarean, where sympathetic stimulation can trigger arrhythmia. A high-acuity, multidisciplinary cesarean-planning vignette — relevant to the cardio-obstetric corner of your practice.",
    "question": "<p><strong>The clinical problem.</strong> Catecholamine-sensitive RVOT-VT in pregnancy makes the adrenergic surges of labor/delivery dangerous; anesthetic and delivery planning must minimize sympathetic triggers.</p><p><strong>The question.</strong> How is anesthesia managed for cesarean in a pregnant patient with RVOT-VT?</p>",
    "pico": {"P": "Pregnant patient with RVOT-VT undergoing cesarean.", "I": "Tailored anesthetic management minimizing sympathetic stimulation.", "C": "Not applicable (case).", "O": "Arrhythmia control and maternal/fetal safety.", "D": "Case report.", "S": "n = 1."},
    "findings": "<p>The report details an anesthetic strategy to blunt sympathetic stimulation and manage arrhythmia risk through cesarean delivery.</p>",
    "strengths": "<p>Concrete management of a rare, dangerous cardio-obstetric scenario; multidisciplinary lessons.</p>",
    "applicability": "<p>Awareness-level for cardio-obstetric cesarean planning; reinforces multidisciplinary preparation. Single case — not a protocol.</p>",
    "equity": "<p>n=1; no population generalization.</p>",
    "prompts": "<ol><li>Is your cardio-obstetric cesarean pathway ready for catecholamine-sensitive arrhythmias?</li><li>How does delivery-mode choice interact with arrhythmia risk here?</li><li>Who is on the room team for such a case?</li></ol>",
},

"42203290": {  # OdonAssist device for assisted vaginal birth, Ethiopia — protocol
    "bottom": "Study protocol for feasibility of the OdonAssist device for assisted vaginal birth in a low-resource setting. Not results — a design for testing a novel assisted-delivery tool aimed at reducing cesarean/operative-delivery morbidity where resources are scarce. Squarely the access/structure thesis; track for outcomes.",
    "question": "<p><strong>The clinical problem.</strong> Safe assisted vaginal birth reduces cesarean and its downstream scar morbidity, but conventional instruments require skill/resources unavailable in many settings; novel devices aim to lower that barrier.</p><p><strong>The question.</strong> Is the OdonAssist device feasible for assisted vaginal birth in a low-resource setting? (Protocol.)</p>",
    "pico": {"P": "Laboring women needing assisted vaginal birth in a low-resource setting (Ethiopia).", "I": "OdonAssist device-assisted vaginal birth.", "C": "Standard care (per protocol).", "O": "Feasibility/safety outcomes (to be measured).", "D": "Feasibility study protocol.", "S": "Planned cohort."},
    "findings": "<p>No results yet — the paper publishes the feasibility-study design for the OdonAssist device in a low-resource context.</p>",
    "strengths": "<p>Targets a real global access gap with a pragmatic feasibility design; equity-forward.</p>",
    "applicability": "<p>Not yet actionable; track for feasibility/safety results. Relevant to the broader effort to safely reduce cesarean reliance.</p>",
    "equity": "<p>Explicitly low-resource-setting focused — an equity-centered study; generalizability awaits results.</p>",
    "prompts": "<ol><li>Could a simplified assist device safely expand assisted vaginal birth in your setting?</li><li>What feasibility/safety thresholds would justify adoption?</li><li>How does reducing cesarean rate map to long-term scar-morbidity reduction?</li></ol>",
},

"42195251": {  # Contrast-media timing in small-bowel obstruction — RCT pilot (general surgery)
    "bottom": "General-surgery pilot RCT on timing of water-soluble contrast in small-bowel obstruction (adhesive vs virgin abdomen). Out-of-field, included under the scar/adhesion thesis as <em>adhesive-disease</em> content — and adhesive SBO is a genuine downstream complication of prior cesarean/pelvic surgery, so the adhesion thread is real. The paper itself is about contrast-protocol timing, not gynecology.",
    "question": "<p><strong>The clinical problem.</strong> Adhesive SBO is a common late consequence of abdominopelvic surgery (including cesarean); water-soluble contrast both predicts resolution and may be therapeutic, but optimal timing is debated.</p><p><strong>The question.</strong> Does the timing of contrast-media administration affect outcomes in adhesive vs virgin-abdomen SBO?</p>",
    "pico": {"P": "Patients with small-bowel obstruction (adhesive and virgin abdomen).", "I": "Earlier contrast-media administration.", "C": "Later/standard timing.", "O": "SBO resolution / management outcomes.", "D": "Prospective randomized pilot.", "S": "Pilot cohort."},
    "findings": "<p>The pilot examined how contrast timing influences SBO management, distinguishing adhesive from virgin-abdomen presentations.</p>",
    "strengths": "<p>Randomized, addresses a protocol gap; the adhesive-disease angle connects to post-surgical (incl. post-cesarean) morbidity.</p>",
    "applicability": "<p>Indirect for gynecology — it's a surgical-protocol study. The relevant reminder: prior cesarean/pelvic surgery raises adhesive-SBO risk, a counseling and long-term-morbidity point. Don't read it as gyn management.</p>",
    "equity": "<p>Single-center surgical pilot; not gynecologic-population specific.</p>",
    "prompts": "<ol><li>Do we adequately counsel cesarean patients on long-term adhesive-SBO risk?</li><li>Does the adhesion thread justify including a contrast-timing surgery pilot?</li><li>How does prior-surgery status change SBO management thinking?</li></ol>",
},

"42195184": {  # Placenta previa vs breech cesarean controls — case-control (Lithuania)
    "bottom": "Retrospective case-control comparing maternal/neonatal outcomes in placenta previa versus breech-cesarean controls. Directly obstetric — quantifies the excess maternal/neonatal morbidity previa adds over a routine (breech) cesarean, useful for risk stratification and counseling.",
    "question": "<p><strong>The clinical problem.</strong> Placenta previa raises cesarean hemorrhage and neonatal risk, but quantifying that excess against a standard cesarean indication sharpens counseling and resource planning.</p><p><strong>The question.</strong> How do maternal and neonatal outcomes in placenta previa compare with breech-cesarean controls?</p>",
    "pico": {"P": "Women with placenta previa vs breech-cesarean controls (single tertiary center).", "I": "Placenta previa (exposure).", "C": "Breech cesarean.", "O": "Maternal/neonatal outcomes.", "D": "Retrospective case-control.", "S": "Single-center cohort."},
    "findings": "<p>The study characterized the excess maternal and neonatal morbidity associated with previa relative to a routine cesarean indication.</p>",
    "strengths": "<p>Sensible comparator (breech cesarean) isolates previa-specific risk; clinically framed.</p>",
    "applicability": "<p>Applicable to previa counseling and planning. Single-center retrospective — confirm magnitudes before quoting fixed risks.</p>",
    "equity": "<p>Single Lithuanian center; generalize cautiously across systems.</p>",
    "prompts": "<ol><li>How does the previa-specific excess risk change your delivery planning?</li><li>Is breech cesarean the right comparator for isolating previa risk?</li><li>What resources does this justify mobilizing for previa deliveries?</li></ol>",
},

"42195168": {  # Keloid surgical excision + adjuvant therapies — systematic review (plastics)
    "bottom": "Plastic-surgery systematic review of surgical excision plus adjuvant therapy for keloids (fibroproliferative disorders of excess fibroblast activity). Out-of-field, included under the cesarean-scar thesis as <em>pathologic-scar biology and management</em> — keloid is the archetype of dysregulated fibroproliferation, and cesarean scars can keloid. Treatment specifics are dermatologic; the mechanistic and management framing is transferable.",
    "question": "<p><strong>The clinical problem.</strong> Keloids exemplify pathologic fibroproliferation and recur after excision alone; multimodal (excision + adjuvant) approaches aim to break the cycle — directly relevant to keloid-prone cesarean scars.</p><p><strong>The question.</strong> What is the evidence for surgical excision combined with adjuvant therapies in keloid management?</p>",
    "pico": {"P": "Patients with keloids.", "I": "Surgical excision + adjuvant therapy (e.g., radiation, steroid, pressure).", "C": "Excision alone / other modalities.", "O": "Recurrence and outcome measures.", "D": "Systematic review.", "S": "Included keloid studies."},
    "findings": "<p>The review synthesized recurrence and outcome data for excision-plus-adjuvant strategies, supporting multimodal management over excision alone for this high-recurrence lesion.</p>",
    "strengths": "<p>Systematic synthesis of a high-recurrence problem; the multimodal principle transfers to keloid-prone surgical scars generally.</p>",
    "applicability": "<p>Useful when counseling keloid-prone patients about cesarean/skin scarring and referral for multimodal management. Specific protocols are dermatologic/plastics — co-manage rather than self-treat complex keloids.</p>",
    "equity": "<p>Keloids disproportionately affect darker skin types; representation in the included studies should be checked before generalizing.</p>",
    "prompts": "<ol><li>Do you identify keloid-prone patients before elective skin incisions?</li><li>What's your referral/co-management pathway for keloid-prone cesarean scars?</li><li>Does the multimodal principle change your counseling?</li></ol>",
},

"42195064": {  # Biomarkers & kidney scarring after febrile UTI/VUR — pediatric nephro/uro
    "bottom": "Pediatric nephrology/urology study of biomarkers predicting renal scarring after a first febrile UTI or with vesicoureteral reflux. Out-of-field, included under the scar thesis as <em>organ-fibrosis/scarring biology</em>. The thread (post-inflammatory scarring, biomarkers of fibrosis) is conceptual; there is no gynecologic content. Indirect support at best.",
    "question": "<p><strong>The clinical problem.</strong> Post-infectious/inflammatory organ scarring is a shared biology across systems; predicting who scars (here, kidneys after febrile UTI) is the renal analogue of predicting pathologic scar elsewhere.</p><p><strong>The question.</strong> Which biomarkers associate with renal scarring after a first febrile UTI or with VUR in children?</p>",
    "pico": {"P": "Pediatric patients after first febrile UTI or with VUR.", "I": "Candidate biomarker measurement.", "C": "Scarring vs no scarring.", "O": "Association of biomarkers with renal scarring.", "D": "Pediatric biomarker study.", "S": "Pediatric cohort."},
    "findings": "<p>The study identified biomarkers associated with renal scarring, contributing to risk stratification for post-infectious organ fibrosis.</p>",
    "strengths": "<p>Biomarker-driven scarring prediction — a model of how fibrosis risk might be forecast.</p>",
    "applicability": "<p>Indirect; no gynecologic application. Included only as scarring-biology context. Do not transfer pediatric renal biomarkers to uterine scar.</p>",
    "equity": "<p>Pediatric renal cohort; no gynecologic-population relevance.</p>",
    "prompts": "<ol><li>Is cross-organ 'scarring biology' a meaningful unifying thesis or too loose?</li><li>Could biomarker-based fibrosis prediction ever apply to cesarean-niche risk?</li><li>Where do you draw the line on out-of-field inclusion?</li></ol>",
},

"42187001": {  # Supraumbilical skin retraction after laser-assisted liposuction — plastics
    "bottom": "Plastic-surgery paper on supraumbilical skin laxity/retraction after laser-assisted liposuction (skin-tightening vs visible scar trade-offs). Out-of-field; under the cesarean-scar thesis it touches <em>abdominal-wall skin behavior and scar trade-offs</em>, loosely relevant to the abdominal-wall context cesarean surgeons work in. Cosmetic-surgery specifics don't transfer; weakest fit of this batch's scar papers.",
    "question": "<p><strong>The clinical problem.</strong> Abdominal-wall skin laxity and the scar-vs-tightening trade-off are real considerations in body-contouring and, loosely, in how abdominal incisions heal and retract.</p><p><strong>The question.</strong> Does laser-assisted liposuction/lipolysis achieve supraumbilical skin tightening, and how does it compare with scar-producing alternatives?</p>",
    "pico": {"P": "Patients with supraumbilical skin laxity.", "I": "Laser-assisted liposuction/lipolysis.", "C": "Excisional (scar-producing) methods.", "O": "Skin tightening vs scar trade-off.", "D": "Clinical review/series (plastic surgery).", "S": "Procedure cohort."},
    "findings": "<p>The literature reviewed favored laser-assisted lipolysis for skin tightening relative to scar-producing alternatives in the supraumbilical region.</p>",
    "strengths": "<p>Addresses an abdominal-wall skin-behavior question with a clear trade-off framing.</p>",
    "applicability": "<p>Indirect and cosmetic; nothing changes gynecologic-surgical practice. Loosest fit — reasonable to consider dropping if tightening the feed.</p>",
    "equity": "<p>Elective cosmetic population; not gynecologic-population relevant.</p>",
    "prompts": "<ol><li>Does abdominal-wall skin behavior from cosmetic surgery inform cesarean incision healing at all?</li><li>Is this paper's fit too loose for the digest?</li><li>Keep as abdominal-wall context, or cut?</li></ol>",
},

"42185847": {  # Fetal lung volume + PA Doppler predicting RDS after elective cesarean in diabetics
    "bottom": "Strong obstetric prediction study: combined fetal lung volume (FLV) and pulmonary-artery Doppler resistance index predicted neonatal respiratory distress syndrome after elective cesarean in diabetic pregnancies, with excellent test performance (combined AUC ~0.96; PA-RI >0.75 gave 100% sensitivity). A potentially practice-relevant tool for timing/counseling elective cesarean in diabetics.",
    "question": "<p><strong>The clinical problem.</strong> Elective cesarean (especially in diabetic pregnancies) risks neonatal RDS from delayed lung maturity; antenatal prediction could refine timing and antenatal-steroid decisions.</p><p><strong>The question.</strong> Do combined fetal lung volume and pulmonary-artery Doppler predict RDS after elective cesarean in diabetic pregnancies?</p>",
    "pico": {"P": "Diabetic pregnancies undergoing elective cesarean.", "I": "Fetal lung volume + pulmonary-artery Doppler (PA-RI).", "C": "Against actual RDS occurrence.", "O": "RDS prediction (sensitivity/specificity/AUC).", "D": "Diagnostic-accuracy cohort.", "S": "Cohort with 13% RDS incidence."},
    "findings": "<p>RDS occurred in 13%; affected neonates had lower FLV and higher PA-RI. FLV ≤33.5 cm³ (AUC 0.941) and PA-RI >0.75 (AUC 0.963, 100% sensitivity) predicted RDS; the combined model performed best (AUC ~0.96).</p>",
    "strengths": "<p>Strong diagnostic metrics with a combined model and high negative predictive value — clinically actionable for timing decisions.</p>",
    "applicability": "<p>Potentially useful for timing/steroid decisions in diabetic elective cesarean if reproducible. Single-cohort diagnostic study with modest event count (n=16 RDS) — validate before adopting thresholds.</p>",
    "equity": "<p>Single-cohort; ultrasound technique-dependent. Validate across operators and populations.</p>",
    "prompts": "<ol><li>Would FLV/PA-RI prediction change your elective-cesarean timing in diabetics?</li><li>Is n=16 events enough to trust the thresholds?</li><li>How does this interact with antenatal-steroid decisions?</li></ol>",
},

"42183685": {  # Fluid silicone gels for hypertrophic scars — SR/MA of RCTs (dermatology)
    "bottom": "Dermatology systematic review/meta-analysis of RCTs on fluid silicone gels for preventing/treating hypertrophic scars. Out-of-field by authorship but the <em>most directly transferable</em> scar paper in this group: silicone-gel scar therapy is exactly what we counsel for cesarean and other surgical scars. The evidence quality and effect size here informs that real counseling.",
    "question": "<p><strong>The clinical problem.</strong> Patients ask how to minimize cesarean and surgical-scar hypertrophy; silicone gel is the most-recommended OTC option, and its actual RCT-grade benefit should drive honest counseling.</p><p><strong>The question.</strong> Do fluid silicone gels prevent/treat hypertrophic scars in RCTs?</p>",
    "pico": {"P": "Patients at risk of / with hypertrophic scars.", "I": "Fluid silicone gels.", "C": "No treatment / comparator.", "O": "Scar prevention and treatment outcomes.", "D": "Systematic review/meta-analysis of RCTs.", "S": "Pooled RCTs."},
    "findings": "<p>The meta-analysis synthesized RCT evidence on silicone-gel efficacy for hypertrophic-scar prevention and treatment, clarifying the effect size and certainty behind a commonly recommended intervention.</p>",
    "strengths": "<p>RCT-based synthesis of a therapy we already recommend — directly improves the evidence behind everyday scar counseling.</p>",
    "applicability": "<p>Directly applicable to cesarean/surgical-scar counseling: it grounds what to tell patients about silicone gel's real (often modest) benefit. Confirm the pooled certainty before over-promising.</p>",
    "equity": "<p>Scar response varies by skin type; check trial representation before generalizing efficacy.</p>",
    "prompts": "<ol><li>Does this change how confidently you recommend silicone gel for cesarean scars?</li><li>Prevention vs treatment — where is the evidence strongest?</li><li>How do skin-type differences affect your counseling?</li></ol>",
},

"42181659": {  # Vulval edema as rare complication of preeclampsia — case
    "bottom": "Obstetric case report: massive vulval (and lower-body) edema as a rare presentation/complication of preeclampsia in a primigravida, prompting expedited delivery. A reminder that severe preeclamptic edema can localize dramatically to the vulva and drive management; directly within obstetric/vulvar care.",
    "question": "<p><strong>The clinical problem.</strong> Preeclampsia causes capillary leak and edema; rarely this localizes severely to the vulva, causing functional impairment and complicating delivery planning.</p><p><strong>The question.</strong> How does severe vulval edema present and get managed as a preeclampsia complication?</p>",
    "pico": {"P": "A 29-year-old primigravida with preeclampsia and severe vulval edema.", "I": "Antihypertensive escalation and expedited delivery.", "C": "Not applicable (case).", "O": "Resolution of edema and maternal/fetal outcome.", "D": "Case report.", "S": "n = 1."},
    "findings": "<p>Worsening vulval edema with functional impairment, alongside confirmed preeclampsia (elevated PCR, uric acid, thrombocytosis), prompted antihypertensive escalation and elective delivery.</p>",
    "strengths": "<p>Documents a rare but striking preeclampsia manifestation with practical management implications.</p>",
    "applicability": "<p>Awareness-level: recognize severe vulval edema as a possible preeclampsia sign warranting full PET workup. Single case.</p>",
    "equity": "<p>n=1; no generalization.</p>",
    "prompts": "<ol><li>Would severe isolated vulval edema trigger a preeclampsia workup in your practice?</li><li>How does functional impairment factor into delivery-timing decisions?</li><li>What other diagnoses must be excluded?</li></ol>",
},

"42178205": {  # Peripartum cardiac/HF biomarkers by delivery mode
    "bottom": "Translational obstetric study on peripartum dynamics of ischemia/heart-failure biomarkers by delivery mode — grounded in the elegant observation that the myometrium (contracting in labor, incised at cesarean) can itself produce 'cardiac' injury/strain markers. Reframes how we interpret peripartum troponin/BNP-type signals and ties directly to the cesarean-incision biology of the scar thesis.",
    "question": "<p><strong>The clinical problem.</strong> Peripartum elevations in cardiac biomarkers can prompt cardiac workups, but labor and cesarean incision themselves stress/injure the myometrium, which may release overlapping markers — confounding interpretation.</p><p><strong>The question.</strong> How do ischemia and heart-failure biomarkers change peripartum, and does delivery mode (labor vs cesarean incision) drive those dynamics?</p>",
    "pico": {"P": "Peripartum women by delivery mode (vaginal/labor vs cesarean).", "I": "Serial ischemia/HF biomarker measurement.", "C": "Vaginal/labor vs cesarean incision.", "O": "Biomarker dynamics and delivery-mode effect.", "D": "Prospective biomarker cohort.", "S": "Peripartum cohort (study-defined)."},
    "findings": "<p>The study characterized how cardiac-injury/strain biomarkers move peripartum and differ by delivery mode, supporting a myometrial (not solely cardiac) source for some peripartum elevations.</p>",
    "strengths": "<p>Mechanistically clever and clinically useful — recalibrates interpretation of peripartum cardiac biomarkers; the myometrium-as-muscle framing fits the scar/incision thesis.</p>",
    "applicability": "<p>Useful for interpreting peripartum biomarker elevations without over-calling cardiac pathology, especially after cesarean incision. Confirm reference ranges before clinical thresholds.</p>",
    "equity": "<p>Single-cohort; validate biomarker dynamics across populations and assays.</p>",
    "prompts": "<ol><li>Do you over-interpret peripartum cardiac biomarkers without accounting for myometrial source?</li><li>Does delivery mode change your threshold for cardiac workup?</li><li>How might incised vs laboring myometrium differ in marker release?</li></ol>",
},

# ===================== ENDOMETRIOSIS (body unity + neuro-immuno-endocrine systems) =====================

"42212658": {  # Th9 cells in endometriosis-associated inflammation
    "bottom": "Mechanism paper: T-helper-9 (Th9) cells, known drivers of chronic inflammatory disease, are implicated in endometriosis-associated inflammation and lesion growth. Directly supports the neuro-immuno-endocrine thesis — endometriosis as an immune-inflammatory condition. Hypothesis-strengthening immunology, not a clinical intervention.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis is increasingly read as a systemic immune-inflammatory disease; identifying the specific T-cell subsets that sustain lesion growth could nominate immunomodulatory targets.</p><p><strong>The question.</strong> Do Th9 cells contribute to endometriosis-associated inflammation and lesion growth?</p>",
    "pico": {"P": "Endometriosis tissue/immune models.", "I": "Characterization of Th9-cell contribution.", "C": "Non-endometriosis/control immune context.", "O": "Inflammation and lesion-growth association.", "D": "Translational immunology study.", "S": "Experimental (not patient-level)."},
    "findings": "<p>The work implicates Th9 cells in the inflammatory milieu and growth of endometriotic lesions, extending the immune-driver model beyond the usual macrophage/NK focus.</p>",
    "strengths": "<p>Specific immune-subset focus tied to a recognized inflammatory-disease pathway; coherent with the systems thesis.</p>",
    "applicability": "<p>Conceptual — no test or therapy to deploy. Reinforces the immune-inflammatory frame for counseling and for following immunomodulation research. Pre-clinical; no causal clinical claim.</p>",
    "equity": "<p>Mechanistic study; no human population for generalization.</p>",
    "prompts": "<ol><li>Does the Th9 signal converge with the mast-cell/MCAS endometriosis literature?</li><li>How far are immune subsets from being actionable targets?</li><li>What would move this from mechanism to trial?</li></ol>",
},

"42201748": {  # EndoConnect digital endometriosis care, Brazil — equity/usability
    "bottom": "Implementation/equity study of a digital endometriosis tool (EndoConnect) in Brazil's public system, where diagnostic delays of 7–10 years fall hardest on rural, low-income, Black, and Indigenous women. Health-systems content squarely in the body-unity/access thesis — scalable digital care aimed at the diagnostic-delay equity gap.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis diagnosis is delayed by years, disproportionately in vulnerable populations; digital tools promise scale but often fail usability/equity in exactly those groups.</p><p><strong>The question.</strong> Is EndoConnect usable, engaging, and equitable when implemented in Brazilian primary care?</p>",
    "pico": {"P": "Patients and clinicians in Brazil's public primary care (SUS).", "I": "EndoConnect digital endometriosis tool.", "C": "Usual care / baseline.", "O": "Usability, engagement, and equity of access.", "D": "Formative implementation study.", "S": "Primary-care users (study-defined)."},
    "findings": "<p>The study assessed usability, engagement, and equity, surfacing where a digital endometriosis tool helps or risks widening gaps among vulnerable populations.</p>",
    "strengths": "<p>Centers equity and real-world implementation rather than efficacy in isolation; addresses a documented diagnostic-delay disparity.</p>",
    "applicability": "<p>Relevant to anyone building endometriosis care pathways — digital tools must be designed for the most-delayed populations, not the easiest. Setting-specific (SUS); transfer principles, not specifics.</p>",
    "equity": "<p>This is an equity-centered study by design — rural, low-income, Black, and Indigenous women are the explicit focus.</p>",
    "prompts": "<ol><li>Do your digital tools reduce or widen diagnostic-delay disparities?</li><li>What usability features matter most for the most-delayed patients?</li><li>How do you measure equity, not just engagement?</li></ol>",
},

"42199791": {  # Endometrioma fluid impairs preantral follicle development
    "bottom": "Mechanism study tying endometriomas to infertility: endometrioma fluid compromised preantral-follicle development via oxidative stress and tissue fibrosis. Gives a biological account for the diminished ovarian function around endometriomas — directly relevant to the surgery-vs-conservative-management and ovarian-reserve counseling debate.",
    "question": "<p><strong>The clinical problem.</strong> Endometriomas associate with reduced ovarian reserve and function, but it's unclear how much is the cyst's local toxic/fibrotic milieu versus surgery — central to whether and when to operate.</p><p><strong>The question.</strong> Does endometrioma fluid impair preantral-follicle development through oxidative stress and fibrosis?</p>",
    "pico": {"P": "Preantral follicles exposed to endometrioma fluid (experimental).", "I": "Endometrioma-fluid exposure.", "C": "Control fluid/unexposed follicles.", "O": "Follicle development, oxidative-stress and fibrosis markers.", "D": "Experimental ovarian-biology study.", "S": "Follicle/tissue experiments."},
    "findings": "<p>Endometrioma fluid impaired preantral-follicle development with evidence of oxidative stress and tissue fibrosis, supporting an intrinsic cyst-driven mechanism of ovarian dysfunction.</p>",
    "strengths": "<p>Mechanistic account for a clinically important association (endometrioma → reduced reserve), with named pathways.</p>",
    "applicability": "<p>Informs counseling: the cyst itself may harm the ovary, not just surgery — relevant to timing and reserve discussions. Experimental; don't over-translate to specific surgical thresholds.</p>",
    "equity": "<p>Bench model; no population data.</p>",
    "prompts": "<ol><li>Does intrinsic cyst toxicity change your operate-vs-observe calculus for endometriomas?</li><li>How do you weigh surgical reserve loss against ongoing cyst-driven damage?</li><li>Could antioxidant/anti-fibrotic strategies ever protect reserve?</li></ol>",
},

"42196764": {  # Telemedicine (telePROM) for outpatient endometriosis — qualitative
    "bottom": "Qualitative study of clinicians' experience with tele-patient-reported-outcome-measure (telePROM) follow-up for endometriosis — questionnaire + phone/video + chat with a multidisciplinary team. Supports the systems/whole-person model of chronic endometriosis care delivered longitudinally and remotely. Service-design evidence, not outcomes.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis is chronic and benefits from continuity, but outpatient follow-up is fragmented; PRO-driven telemedicine could structure longitudinal, multidisciplinary care.</p><p><strong>The question.</strong> How do healthcare professionals experience telePROM and its integration into endometriosis follow-up?</p>",
    "pico": {"P": "Healthcare professionals delivering outpatient endometriosis care.", "I": "telePROM (PRO questionnaire + phone/video + chat).", "C": "Conventional follow-up.", "O": "Professionals' experience and integration themes.", "D": "Qualitative study.", "S": "Clinician participants."},
    "findings": "<p>Clinicians described how telePROM reshaped follow-up workflow and multidisciplinary coordination, with facilitators and barriers to integration.</p>",
    "strengths": "<p>Addresses care-model design for a chronic condition; multidisciplinary, PRO-anchored.</p>",
    "applicability": "<p>Useful if you're designing endometriosis follow-up pathways — PRO-driven telemedicine is a credible structure. Qualitative/clinician-side; pair with patient-outcome data before scaling.</p>",
    "equity": "<p>Telemedicine can extend or restrict access depending on the digital divide — an equity caveat for any telePROM rollout.</p>",
    "prompts": "<ol><li>Could PRO-driven telemedicine structure your endometriosis follow-up?</li><li>What barriers (reimbursement, digital access) would you hit?</li><li>How do you keep telecare equitable?</li></ol>",
},

"42196574": {  # Molecular characterization of ovarian endometriosis, Saudi women
    "bottom": "Molecular study of ovarian endometriosis in Saudi Arabian women, mapping inflammatory, autophagic, and epigenetic dysregulation. Adds population-specific molecular characterization to the neuro-immuno-endocrine thesis and helps diversify a literature dominated by a few populations. Mechanistic/descriptive.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis molecular biology (inflammation, autophagy, epigenetics) is mostly characterized in limited populations; broader characterization is needed for generalizable mechanisms and biomarkers.</p><p><strong>The question.</strong> What inflammatory, autophagic, and epigenetic dysregulation characterizes ovarian endometriosis in Saudi Arabian women?</p>",
    "pico": {"P": "Saudi Arabian women with ovarian endometriosis.", "I": "Molecular profiling (inflammatory/autophagic/epigenetic).", "C": "Normal/control tissue.", "O": "Dysregulated molecular signatures.", "D": "Molecular case-control study.", "S": "Patient tissue samples."},
    "findings": "<p>The study characterized inflammatory, autophagic, and epigenetic dysregulation in ovarian endometriosis in an under-represented population, reinforcing multi-pathway pathogenesis.</p>",
    "strengths": "<p>Population diversification of endometriosis molecular data; multi-pathway scope.</p>",
    "applicability": "<p>Background mechanism — no immediate clinical action. Supports the multi-pathway disease model. Descriptive; biomarker translation is future work.</p>",
    "equity": "<p>Strengthens representation by studying Saudi women — a positive equity contribution to a skewed literature.</p>",
    "prompts": "<ol><li>How much do endometriosis molecular signatures vary by population?</li><li>Which dysregulated pathway is closest to a usable biomarker?</li><li>Does population-specific biology change anything clinically yet?</li></ol>",
},

"42196513": {  # NESCO (sodium-overload necrosis) + NK signatures in endometriosis
    "bottom": "Bioinformatic/mechanistic paper proposing 'necrosis by sodium overload' (NESCO), an immunogenic programmed-cell-death pattern, and natural-killer-cell signatures as diagnostic and therapeutic angles in endometriosis. Speculative immunology supporting the immune thesis; very early, with a traditional-medicine therapeutic framing. Treat as hypothesis-generating.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis lacks reliable non-invasive diagnostics and disease-modifying medical therapy; novel immunogenic cell-death and immune-signature concepts are being mined for both.</p><p><strong>The question.</strong> Do NESCO and NK-cell signatures carry diagnostic and therapeutic implications in endometriosis?</p>",
    "pico": {"P": "Endometriosis datasets/patients (in-silico + tissue).", "I": "Analysis of NESCO and NK signatures.", "C": "Non-endometriosis controls.", "O": "Diagnostic signatures and candidate therapeutic targets.", "D": "Bioinformatic/mechanistic analysis.", "S": "Public/clinical datasets."},
    "findings": "<p>The analysis nominated NESCO and NK-cell signatures as diagnostic and natural-therapeutic candidates, integrating an immunogenic cell-death concept into endometriosis immunology.</p>",
    "strengths": "<p>Creative integration of a novel cell-death pathway with immune signatures; diagnostic ambition.</p>",
    "applicability": "<p>Hypothesis-generating only — nothing to order or prescribe. Watch for validation. The 'natural therapeutic' framing needs rigorous testing before any clinical weight.</p>",
    "equity": "<p>In-silico/tissue work; no population generalization.</p>",
    "prompts": "<ol><li>Is a novel cell-death signature a plausible route to a non-invasive endometriosis test?</li><li>How much skepticism do bioinformatic 'natural therapeutic' claims warrant?</li><li>What validation would make NK signatures clinically credible?</li></ol>",
},

"42196487": {  # Cancer-like hallmarks of endometriosis (estrogen + stem-cell plasticity)
    "bottom": "Review arguing endometriosis shares cancer-like hallmarks — estrogen-driven signaling and stem-cell plasticity — despite being benign. Reinforces why endometriosis invades, persists, and recurs, supporting the systems/biology thesis and the malignant-transformation vigilance conversation. Conceptual synthesis.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis behaves more aggressively (invasion, recurrence, occasional malignant transformation) than 'benign' implies; understanding its cancer-like biology informs surveillance and target thinking.</p><p><strong>The question.</strong> What cancer-like hallmarks (estrogen signaling, stem-cell plasticity) characterize endometriosis?</p>",
    "pico": {"P": "Endometriosis (conceptual/biological scope).", "I": "Review of cancer-like molecular/cellular hallmarks.", "C": "Benign vs malignant behavior framing.", "O": "Mechanistic hallmark synthesis.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review maps estrogen-signaling and stem-cell-plasticity hallmarks onto endometriosis, explaining its invasive, recurrent behavior within a cancer-biology frame.</p>",
    "strengths": "<p>Coherent biological framing that connects recurrence/invasion to mechanism; useful conceptual scaffolding.</p>",
    "applicability": "<p>Reinforces estrogen-suppression rationale and malignant-transformation vigilance in counseling. Conceptual — not a management change.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>Does the cancer-hallmark framing change how you counsel on recurrence/transformation risk?</li><li>Which hallmark is most therapeutically tractable?</li><li>Does 'benign' undersell endometriosis to patients?</li></ol>",
},

"42195254": {  # Developmental vs chromosomal competence in endometriosis — stepwise IVF
    "bottom": "Stepwise IVF-outcome analysis dissecting whether endometriosis impairs embryo developmental competence versus chromosomal (euploidy) competence. Helps localize where endometriosis hurts ART — oocyte/embryo developmental quality vs aneuploidy — which guides counseling and lab strategy.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis lowers ART success, but whether the defect is chromosomal (more aneuploidy) or developmental (poorer embryo progression at normal ploidy) changes prognosis and strategy.</p><p><strong>The question.</strong> Does endometriosis impair developmental competence, chromosomal competence, or both across IVF steps?</p>",
    "pico": {"P": "Endometriosis patients undergoing IVF.", "I": "Stepwise analysis of developmental vs chromosomal competence.", "C": "Non-endometriosis IVF patients.", "O": "Embryo development metrics and euploidy rates.", "D": "Retrospective stepwise IVF-outcome study.", "S": "IVF cohort (study-defined)."},
    "findings": "<p>The stepwise analysis separated developmental from chromosomal competence, clarifying which is more affected by endometriosis and where in the IVF pathway losses occur.</p>",
    "strengths": "<p>Decomposes a vague 'worse outcomes' signal into mechanistically distinct, counseling-relevant components.</p>",
    "applicability": "<p>Useful for prognostic counseling and deciding whether PGT-A adds value in endometriosis cycles. Retrospective; confirm before firm protocol changes.</p>",
    "equity": "<p>Single-center cohort; generalize cautiously.</p>",
    "prompts": "<ol><li>If the defect is developmental not chromosomal, does PGT-A help your endometriosis patients?</li><li>How do you counsel prognosis differently based on this distinction?</li><li>Where in the IVF pathway would you intervene?</li></ol>",
},

"42195138": {  # Endometriosis: chronic inflammation → reproductive dysfunction → impaired ART (review)
    "bottom": "Review tracing the chain from chronic inflammation to reproductive dysfunction and impaired ART outcomes in endometriosis. A clean systems-thesis synthesis useful as a teaching/counseling backbone, connecting the inflammatory biology to the fertility consequences patients care about. Narrative, not new data.",
    "question": "<p><strong>The clinical problem.</strong> Patients want to know <em>why</em> endometriosis hurts fertility; a mechanistic chain from inflammation to ART impairment supports honest, biology-grounded counseling.</p><p><strong>The question.</strong> How does chronic inflammation in endometriosis translate into reproductive dysfunction and worse ART outcomes?</p>",
    "pico": {"P": "Women with endometriosis and infertility (conceptual).", "I": "Review of inflammation→dysfunction→ART pathway.", "C": "Normal reproductive physiology.", "O": "Mechanistic synthesis of fertility impairment.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesizes how inflammatory and endocrine dysregulation impairs oocyte/embryo quality, receptivity, and ART success in endometriosis.</p>",
    "strengths": "<p>Coherent, teachable synthesis linking mechanism to the outcomes patients ask about.</p>",
    "applicability": "<p>Strong counseling/teaching value; no management change. Narrative synthesis — weight individual claims by their primary evidence.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>Which step in the inflammation→ART chain is most modifiable?</li><li>How do you translate this mechanism into patient counseling?</li><li>Does it support earlier ART referral in endometriosis?</li></ol>",
},

"42193961": {  # Recurrent endometriosis as a reprogrammed disease — molecular persistence
    "bottom": "Conceptual/molecular paper challenging the lesion-based paradigm: high recurrence after apparently complete excision suggests endometriosis persists as a 'reprogrammed' molecular state beyond the visible lesion. Important framing for why surgery isn't curative and why medical suppression matters — central to the systems thesis and to honest surgical counseling.",
    "question": "<p><strong>The clinical problem.</strong> Endometriosis recurs even after complete excision, undermining a purely lesion-based model and frustrating patients who expect surgery to cure.</p><p><strong>The question.</strong> Is recurrent endometriosis driven by molecular persistence/reprogramming beyond the surgically visible lesion?</p>",
    "pico": {"P": "Endometriosis (recurrence-focused, molecular scope).", "I": "Review of molecular-persistence/reprogramming evidence.", "C": "Lesion-based paradigm.", "O": "Conceptual model of recurrence.", "D": "Narrative/mechanistic review.", "S": "Not applicable."},
    "findings": "<p>The paper argues recurrence reflects a persistent reprogrammed molecular state (eutopic endometrium/peritoneal microenvironment) rather than incomplete excision alone.</p>",
    "strengths": "<p>Reframes recurrence in a way that aligns surgical expectations with biology; supports adjuvant suppression.</p>",
    "applicability": "<p>Directly shapes surgical counseling — set realistic expectations about recurrence and the role of post-op suppression. Conceptual; not a new procedure.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>How do you counsel patients that excision isn't curative because of molecular persistence?</li><li>Does this strengthen your case for post-op medical suppression?</li><li>What would 'treating the reprogrammed state' even look like?</li></ol>",
},

"42191188": {  # Anti-inflammatory diet + CBT in endometriosis — RCT protocol
    "bottom": "RCT protocol (EUmetriosis) testing an anti-inflammatory diet plus CBT in endometriosis — a rigorous trial of the exact non-pharmacologic, systems-level levers (inflammation, central pain processing) the thesis emphasizes. Protocol only; track for results, don't act yet.",
    "question": "<p><strong>The clinical problem.</strong> Patients want non-drug options targeting endometriosis inflammation and pain; diet and CBT are plausible systems-level levers but lack high-quality RCT evidence.</p><p><strong>The question.</strong> Do an anti-inflammatory diet and CBT improve endometriosis outcomes? (Protocol.)</p>",
    "pico": {"P": "Women with endometriosis.", "I": "Anti-inflammatory diet + cognitive behavioural therapy.", "C": "Control (per protocol).", "O": "Pain/quality-of-life outcomes (to be measured).", "D": "Randomized controlled trial — protocol.", "S": "Planned cohort."},
    "findings": "<p>No results yet — the paper publishes a rigorous design pairing dietary and psychological interventions for endometriosis.</p>",
    "strengths": "<p>Tests credible, low-risk systems-level interventions with RCT rigor; multidisciplinary working group.</p>",
    "applicability": "<p>Not yet actionable; supports offering diet/CBT as reasonable adjuncts while awaiting evidence. Don't over-promise pending results.</p>",
    "equity": "<p>Protocol; recruitment breadth to be assessed on completion.</p>",
    "prompts": "<ol><li>Do you already recommend anti-inflammatory diet/CBT, and on what basis?</li><li>What effect size would make these first-line adjuncts?</li><li>How do you frame low-risk adjuncts honestly before trial data?</li></ol>",
},

"42187006": {  # Garcinol inhibits endometriosis-cell proliferation
    "bottom": "Pre-clinical study: garcinol (a natural polyisoprenylated benzophenone) inhibited endometriosis-cell proliferation by modulating cell-cycle genes and signaling. Adds one more candidate natural compound to the endometriosis pipeline. Bench-level; no clinical translation.",
    "question": "<p><strong>The clinical problem.</strong> Medical endometriosis therapy is dominated by hormonal suppression with side effects; non-hormonal anti-proliferative candidates are sought.</p><p><strong>The question.</strong> Does garcinol inhibit endometriosis-cell proliferation, and through what pathways?</p>",
    "pico": {"P": "Endometriosis cell models.", "I": "Garcinol exposure.", "C": "Untreated cells.", "O": "Proliferation; cell-cycle gene/pathway changes.", "D": "In-vitro pharmacology study.", "S": "Cell experiments."},
    "findings": "<p>Garcinol suppressed endometriosis-cell proliferation by regulating cell-cycle-related genes and signaling pathways.</p>",
    "strengths": "<p>Mechanistically specific candidate with pathway data.</p>",
    "applicability": "<p>Pre-clinical only — nothing to prescribe. One of many natural-compound candidates to track. Avoid patient over-extrapolation to supplements.</p>",
    "equity": "<p>Bench study; no population.</p>",
    "prompts": "<ol><li>How do you handle patient interest in 'natural' endometriosis compounds with only bench data?</li><li>What's the path from cell-line signal to a usable therapy?</li><li>Is non-hormonal anti-proliferation a realistic near-term goal?</li></ol>",
},

"42186752": {  # Placental EVs inhibit endometriosis via ferroptosis
    "bottom": "Mechanism study: placental extracellular vesicles inhibited endometriosis progression by inducing ferroptosis in lesion cells. Intriguing biology connecting placental invasion-control machinery to a potential endometriosis-suppressing strategy. Early-stage; supports the systems/biology thesis, not clinical practice.",
    "question": "<p><strong>The clinical problem.</strong> The placenta tightly controls invasion despite tumor-like behavior; harnessing its regulatory EVs might suppress the invasive endometriotic lesion.</p><p><strong>The question.</strong> Do placental extracellular vesicles inhibit endometriosis progression, and via ferroptosis?</p>",
    "pico": {"P": "Endometriosis models (cells/animal).", "I": "Placental extracellular vesicles.", "C": "Control vesicles/untreated.", "O": "Lesion progression; ferroptosis induction.", "D": "Translational mechanistic study.", "S": "Experimental."},
    "findings": "<p>Placental EVs inhibited endometriosis progression by inducing ferroptosis, nominating an EV-based regulatory strategy.</p>",
    "strengths": "<p>Creative source (placental invasion-control biology) and a specific death pathway (ferroptosis).</p>",
    "applicability": "<p>Pre-clinical; conceptual only. Watch the EV-therapeutics space. No clinical action.</p>",
    "equity": "<p>Bench/animal; no population.</p>",
    "prompts": "<ol><li>Is EV-based therapy a realistic endometriosis modality, or far off?</li><li>Why might ferroptosis be a useful death pathway to exploit here?</li><li>What safety questions surround EV therapeutics?</li></ol>",
},

"42183899": {  # O-GlcNAc modification regulates autophagy/apoptosis in endometriosis
    "bottom": "Mechanism paper: O-GlcNAc post-translational modification regulates autophagy and apoptosis in endometriosis — another nutrient-sensing/metabolic node in lesion survival. Supports the metabolic-immune systems view; bench-level, no clinical handle yet.",
    "question": "<p><strong>The clinical problem.</strong> Endometriotic lesions resist cell death; the metabolic/post-translational controls (like O-GlcNAcylation, a nutrient-sensing modification) on autophagy and apoptosis could reveal vulnerabilities.</p><p><strong>The question.</strong> How does O-GlcNAc modification regulate autophagy and apoptosis in endometriosis?</p>",
    "pico": {"P": "Endometriosis cell/tissue models.", "I": "Modulation of O-GlcNAc modification.", "C": "Baseline/control.", "O": "Autophagy and apoptosis changes.", "D": "Molecular mechanistic study.", "S": "Experimental."},
    "findings": "<p>O-GlcNAcylation modulated autophagy and apoptosis in endometriosis, linking nutrient-sensing metabolism to lesion-cell survival.</p>",
    "strengths": "<p>Connects metabolism (nutrient sensing) to cell-death control — fits the systems-metabolic thesis.</p>",
    "applicability": "<p>Conceptual; no clinical action. Adds a metabolic node to the disease model. Pre-clinical.</p>",
    "equity": "<p>Bench study; no population.</p>",
    "prompts": "<ol><li>Does a nutrient-sensing pathway in lesion survival lend any credence to dietary/metabolic interventions?</li><li>How far is O-GlcNAc biology from a target?</li><li>Where does this fit the broader metabolic-endometriosis picture?</li></ol>",
},

"42178652": {  # Laparoscopic discoid resection for rectal DIE — "when less is more"
    "bottom": "Core complex-CBG/MIGS: laparoscopic discoid resection as a rectum-preserving alternative to segmental resection for rectal deep infiltrating endometriosis — excising the infiltrative lesion while keeping rectal continuity and lowering morbidity. Directly relevant technique paper for the bowel-endometriosis surgeon; 'less is more' when the lesion permits.",
    "question": "<p><strong>The clinical problem.</strong> Rectal DIE forces a choice between morbid segmental resection and more conservative discoid/shaving approaches; discoid resection preserves continuity but has technical and selection challenges limiting adoption.</p><p><strong>The question.</strong> What is the role, technique, and benefit of laparoscopic discoid resection in rectal DIE?</p>",
    "pico": {"P": "Patients with rectal deep infiltrating endometriosis.", "I": "Laparoscopic discoid resection.", "C": "Segmental resection.", "O": "Lesion clearance, rectal preservation, morbidity.", "D": "Technique/clinical review.", "S": "DIE surgical context."},
    "findings": "<p>The paper positions discoid resection as a conservative, continuity-preserving option that reduces morbidity versus segmental resection in appropriately selected rectal DIE, while acknowledging technical demands and selection limits.</p>",
    "strengths": "<p>Practice-relevant technique guidance for a high-stakes decision in bowel-endometriosis surgery.</p>",
    "applicability": "<p>Directly applicable to your DIE operative decision-making — supports discoid resection in selected lesions to spare segmental morbidity. Selection is everything; not all rectal DIE qualifies.</p>",
    "equity": "<p>Technique-focused; outcomes depend on surgeon volume and case selection.</p>",
    "prompts": "<ol><li>What lesion characteristics make you choose discoid over segmental resection?</li><li>How do you counsel on the morbidity trade-off of 'less is more'?</li><li>What's your threshold to convert to segmental intraoperatively?</li></ol>",
},

# ===================== FIBROIDS / STRUCTURE GOVERNS FUNCTION =====================

"42199809": {  # Low-dose dexmedetomidine nasal spray for pre-op anxiety in gyn surgery — RCT
    "bottom": "RCT: low-dose intranasal dexmedetomidine reduced day-of-surgery anxiety in gynaecological patients and stabilized intraoperative hemodynamics (lower MAP/HR variability), with fewer postoperative adverse reactions and less anesthetic consumption. A practical perioperative-anxiety and autonomic-stability tool — fits the structure/autonomic framing of preparing patients for gyn surgery.",
    "question": "<p><strong>The clinical problem.</strong> Preoperative anxiety worsens hemodynamic lability and recovery in gynaecological surgery; a simple, non-sedating anxiolytic could smooth induction and reduce anesthetic needs.</p><p><strong>The question.</strong> Does low-dose intranasal dexmedetomidine reduce preoperative anxiety and improve perioperative stability in gynaecological surgery?</p>",
    "pico": {"P": "Gynaecological surgical patients (day of surgery).", "I": "Low-dose dexmedetomidine nasal spray.", "C": "Control (placebo/usual care).", "O": "Anxiety (VAS-A), intraoperative MAP/HR variability, adverse reactions, anesthetic consumption.", "D": "Randomized controlled study.", "S": "Two-group RCT."},
    "findings": "<p>Intranasal dexmedetomidine lowered morning VAS-A (4.77 vs 5.92), halved intraoperative MAP/HR coefficient of variation, reduced postoperative adverse-reaction rate (60% vs 80%), and cut anesthetic (ciprofol) consumption.</p>",
    "strengths": "<p>RCT with both patient-reported (anxiety) and objective (hemodynamic, drug-sparing) endpoints; simple, scalable intervention.</p>",
    "applicability": "<p>Applicable to perioperative optimization for gyn surgery in concert with anesthesia. Single-center; confirm dosing/safety (bradycardia/sedation) before routine use.</p>",
    "equity": "<p>Single-center RCT; generalize dosing cautiously.</p>",
    "prompts": "<ol><li>Would a non-sedating preoperative anxiolytic change your patients' day-of-surgery experience?</li><li>How do the anesthetic-sparing and hemodynamic benefits weigh for your practice?</li><li>What safety monitoring would you require?</li></ol>",
},

"42196565": {  # Quercetin suppresses uterine leiomyoma via METTL3/MAPK
    "bottom": "Pre-clinical fibroid biology: quercetin suppressed uterine-leiomyoma progression by modulating METTL3-mediated (m6A RNA-methylation) MAPK signaling — hitting the proliferation/ECM-accumulation/inflammation triad that defines fibroids ('structure governs function'). Mechanism paper; a candidate non-surgical lever, not yet clinical.",
    "question": "<p><strong>The clinical problem.</strong> Fibroids are driven by excess proliferation, ECM accumulation, and inflammation, but upstream regulators (and non-hormonal medical options) are incompletely defined.</p><p><strong>The question.</strong> Does quercetin suppress leiomyoma progression via METTL3-mediated MAPK signaling?</p>",
    "pico": {"P": "Uterine-leiomyoma cell/tissue models.", "I": "Quercetin.", "C": "Untreated controls.", "O": "Proliferation, ECM, and MAPK/METTL3 signaling.", "D": "In-vitro/mechanistic study.", "S": "Experimental."},
    "findings": "<p>Quercetin suppressed leiomyoma proliferation and progression by modulating METTL3-mediated MAPK signaling, implicating m6A RNA methylation in fibroid growth.</p>",
    "strengths": "<p>Identifies an upstream epitranscriptomic regulator (METTL3) and a candidate natural modulator; mechanistically specific.</p>",
    "applicability": "<p>Pre-clinical — no clinical use. Adds METTL3/m6A as a fibroid target and one more 'natural compound' to track. Don't endorse quercetin supplements off bench data.</p>",
    "equity": "<p>Bench study; no population.</p>",
    "prompts": "<ol><li>Is the m6A/METTL3 axis a credible future fibroid target?</li><li>How do you respond to patients asking about quercetin for fibroids?</li><li>What would move this toward a trial?</li></ol>",
},

# ===================== HYSTERECTOMY (preserve structure + autonomic relay) =====================

"42216742": {  # Cervical cancer survival: abdominal vs laparoscopic radical hysterectomy (Indonesia)
    "bottom": "Survival study (Jakarta) comparing abdominal vs laparoscopic radical hysterectomy for cervical cancer: 5-year survival favored open (83.5% ARH vs 75.0% LRH), and laparoscopic approach was an independent adverse factor (HR 2.3). Consistent with the LACC-trial signal that minimally invasive radical hysterectomy worsens oncologic outcomes in cervical cancer — an important preservation-vs-oncology caution.",
    "question": "<p><strong>The clinical problem.</strong> Minimally invasive radical hysterectomy for cervical cancer was standard until LACC showed worse survival; real-world corroboration matters for counseling and approach selection.</p><p><strong>The question.</strong> Does surgical approach (abdominal vs laparoscopic radical hysterectomy) affect cervical-cancer survival?</p>",
    "pico": {"P": "Cervical-cancer patients (236 ARH, 39 LRH).", "I": "Laparoscopic radical hysterectomy.", "C": "Abdominal radical hysterectomy.", "O": "Median and 5-year survival; hazard ratios.", "D": "Retrospective cohort, two government hospitals.", "S": "275 patients."},
    "findings": "<p>5-year survival was 83.5% (ARH) vs 75.0% (LRH); multivariate analysis found laparoscopic approach (HR 2.3) and advanced stage (HR 1.9) significantly worsened survival.</p>",
    "strengths": "<p>Real-world corroboration of the LACC oncologic-safety signal in a different health system.</p>",
    "applicability": "<p>Reinforces favoring open radical hysterectomy for cervical cancer — directly relevant to oncologic approach counseling. Imbalanced groups (236 vs 39) and retrospective design temper certainty, but the direction aligns with RCT evidence.</p>",
    "equity": "<p>Two-hospital Indonesian cohort; resource/stage-distribution context matters, but the oncologic principle is broadly applicable.</p>",
    "prompts": "<ol><li>Does this real-world data reinforce open radical hysterectomy in your cervical-cancer practice?</li><li>How do you reconcile MIS benefits elsewhere with the radical-hysterectomy exception?</li><li>How does the group imbalance affect your confidence?</li></ol>",
},

"42216335": {  # Oxycodone vs sufentanil, recovery quality after laparoscopic total hysterectomy — RCT
    "bottom": "RCT comparing oxycodone vs sufentanil for quality of recovery after laparoscopic total hysterectomy. Practical perioperative-analgesia optimization for one of the commonest CBG/MIGS procedures — recovery-quality endpoints that matter to patients and throughput.",
    "question": "<p><strong>The clinical problem.</strong> Opioid choice after laparoscopic hysterectomy affects pain, nausea, and functional recovery; the optimal agent for quality of recovery is debated.</p><p><strong>The question.</strong> Do oxycodone and sufentanil differ in quality of recovery after laparoscopic total hysterectomy?</p>",
    "pico": {"P": "Patients undergoing laparoscopic total hysterectomy.", "I": "Oxycodone.", "C": "Sufentanil.", "O": "Quality of recovery (and related analgesia/PONV endpoints).", "D": "Randomized controlled trial.", "S": "RCT cohort."},
    "findings": "<p>The trial compared the two opioids on validated quality-of-recovery measures after laparoscopic hysterectomy, informing perioperative analgesic selection.</p>",
    "strengths": "<p>RCT on a common CBG/MIGS procedure with a patient-centered recovery endpoint.</p>",
    "applicability": "<p>Relevant to your hysterectomy ERAS/analgesia pathway, with anesthesia. Confirm the direction/magnitude and local drug availability before changing protocol.</p>",
    "equity": "<p>Single-trial; generalize cautiously.</p>",
    "prompts": "<ol><li>Does opioid choice meaningfully change recovery quality in your hysterectomy ERAS pathway?</li><li>How do PONV and analgesia trade off between agents?</li><li>Where does this sit against opioid-sparing strategies?</li></ol>",
},

"42215058": {  # Synchronous endometrial and ovarian cancers — case series
    "bottom": "Case series on synchronous endometrial and ovarian cancers — the crucial distinction between two independent primaries (better prognosis, different treatment) versus one cancer metastatic to the other. Directly relevant to intraoperative decision-making and staging when you encounter dual-site disease at hysterectomy/adnexal surgery.",
    "question": "<p><strong>The clinical problem.</strong> Simultaneous endometrial and ovarian tumors must be classified as synchronous primaries vs metastatic spread because treatment and prognosis differ markedly.</p><p><strong>The question.</strong> How do synchronous endometrial-ovarian primaries present and get distinguished from metastatic disease?</p>",
    "pico": {"P": "Patients with simultaneous endometrial and ovarian tumors (three cases).", "I": "Clinicopathologic characterization/distinction.", "C": "Synchronous primaries vs metastatic disease.", "O": "Diagnosis, treatment approach, prognosis.", "D": "Case series.", "S": "n = 3."},
    "findings": "<p>The series illustrates features distinguishing synchronous primaries (better prognosis) from metastatic disease and the consequent treatment divergence.</p>",
    "strengths": "<p>Highlights a high-stakes diagnostic distinction with direct management implications.</p>",
    "applicability": "<p>Relevant to intraoperative and pathologic decision-making when dual-site disease is found; supports appropriate staging/referral. Small series — illustrative.</p>",
    "equity": "<p>n=3; no generalization.</p>",
    "prompts": "<ol><li>How do you approach intraoperative findings of synchronous endometrial/ovarian tumors?</li><li>What pathologic features drive the primary-vs-metastatic call?</li><li>How does the distinction change your staging/referral?</li></ol>",
},

"42199806": {  # Tegileridine vs oxycodone for analgesia/PONV after TLH — RCT
    "bottom": "Double-blind RCT comparing tegileridine (a biased μ-opioid agonist designed to preserve analgesia with fewer opioid side effects) vs oxycodone after total laparoscopic hysterectomy — postoperative pain and PONV. Tests a next-generation opioid in a core CBG/MIGS procedure; relevant to opioid-side-effect reduction in hysterectomy recovery.",
    "question": "<p><strong>The clinical problem.</strong> Post-hysterectomy pain control with conventional opioids brings PONV and other opioid harms; biased μ-agonists promise analgesia with fewer adverse effects, but need head-to-head data.</p><p><strong>The question.</strong> Does tegileridine improve postoperative analgesia and reduce PONV versus oxycodone after TLH?</p>",
    "pico": {"P": "Patients undergoing total laparoscopic hysterectomy.", "I": "Tegileridine (biased μ-opioid agonist).", "C": "Oxycodone.", "O": "Postoperative analgesia and PONV.", "D": "Randomized, double-blind, single-center controlled trial.", "S": "RCT cohort."},
    "findings": "<p>The trial compared tegileridine and oxycodone on analgesia and PONV after TLH, evaluating whether the biased agonist preserves pain control with fewer opioid-related effects.</p>",
    "strengths": "<p>Double-blind RCT testing a mechanistically novel opioid on a common CBG/MIGS procedure with patient-relevant endpoints.</p>",
    "applicability": "<p>Relevant to hysterectomy analgesia if tegileridine becomes available; supports the broader opioid-side-effect-reduction goal. Single-center, novel-drug availability limits immediate use.</p>",
    "equity": "<p>Single-center; new-drug access constraints affect generalizability.</p>",
    "prompts": "<ol><li>Do biased μ-agonists deliver on the 'analgesia minus side-effects' promise here?</li><li>Where would tegileridine fit your hysterectomy ERAS pathway?</li><li>How does it compare with multimodal opioid-sparing?</li></ol>",
},

"42185628": {  # da Vinci 5 vs Xi surgical efficiency in TLH — retrospective cohort
    "bottom": "Retrospective gyn cohort (OB/GYN dept) comparing surgical efficiency of the da Vinci 5 (force feedback, improved ergonomics) vs da Vinci Xi in total laparoscopic hysterectomy. Direct robotic-CBG/MIGS technology-evaluation data — does the newest platform actually improve operative efficiency for your bread-and-butter case?",
    "question": "<p><strong>The clinical problem.</strong> Robotic platform upgrades are costly; whether the da Vinci 5's force feedback and ergonomics translate into real surgical-efficiency gains over the Xi in hysterectomy is the practical purchasing/practice question.</p><p><strong>The question.</strong> Does the da Vinci 5 improve surgical efficiency versus da Vinci Xi in total laparoscopic hysterectomy?</p>",
    "pico": {"P": "Patients undergoing robotic total laparoscopic hysterectomy.", "I": "da Vinci 5 system.", "C": "da Vinci Xi system.", "O": "Surgical-efficiency metrics (e.g., operative/console time).", "D": "Retrospective cohort.", "S": "Hysterectomy cohort (gyn)."},
    "findings": "<p>The cohort compared operative-efficiency metrics between platform generations, quantifying whether DV5 features yield measurable workflow gains in hysterectomy.</p>",
    "strengths": "<p>Gynecology-specific, real-world platform comparison on a common procedure — directly relevant to robotic-CBG/MIGS practice and procurement.</p>",
    "applicability": "<p>Applicable to robotic-program decisions; tempers or supports upgrade arguments with efficiency data. Retrospective and single-center — confounded by learning curve and case mix.</p>",
    "equity": "<p>Robotic access is itself unequal; platform-upgrade data sits atop that disparity.</p>",
    "prompts": "<ol><li>Do the DV5 efficiency gains justify the upgrade cost in your setting?</li><li>How much of any difference is platform vs surgeon learning curve?</li><li>Does force feedback change your technique in hysterectomy?</li></ol>",
},

# ===================== ICG FLUORESCENCE (make structure visible to preserve function) =====================

"42216342": {  # ICG angiography of free ALT flap perfusion — plastic/hand surgery
    "bottom": "Plastic/hand-surgery series quantifying free anterolateral-thigh-flap perfusion with ICG angiography to prevent flap necrosis. Out-of-field by authorship, but pure <em>ICG perfusion-assessment technology transfer</em> — the identical principle (objective intraoperative perfusion mapping) we use in gynecologic surgery for bowel anastomoses, flaps, and tissue viability. The technique, not the anatomy, is the point.",
    "question": "<p><strong>The clinical problem.</strong> Intraoperative perfusion is judged subjectively, and ischemic tissue (flap, anastomosis, conduit) fails; objective ICG angiography quantifies perfusion to pre-empt necrosis — a technology directly used in gyn/bowel-endometriosis surgery.</p><p><strong>The question.</strong> Can quantitative ICG angiography reliably assess free-flap perfusion and predict viability?</p>",
    "pico": {"P": "13 consecutive free anterolateral-thigh-flap reconstructions.", "I": "Quantitative ICG angiography of flap perfusion.", "C": "Clinical perfusion assessment.", "O": "Perfusion quantification and necrosis prediction.", "D": "Retrospective case series.", "S": "n = 13."},
    "findings": "<p>Quantitative ICG angiography provided reliable intraoperative perfusion assessment of ALT flaps, supporting objective viability prediction over subjective judgment.</p>",
    "strengths": "<p>Quantitative (not just qualitative) ICG perfusion methodology — the transferable advance for any perfusion-critical gyn/bowel surgery.</p>",
    "applicability": "<p>Technology transfer: the quantitative ICG-perfusion approach maps directly onto bowel-anastomosis and tissue-viability assessment in complex CBG/MIGS. Flap anatomy is irrelevant; the method is the value.</p>",
    "equity": "<p>Small single-center series; ICG/quantification availability varies, an access factor.</p>",
    "prompts": "<ol><li>Do you quantify ICG perfusion or eyeball it in your bowel-endometriosis anastomoses?</li><li>Would quantitative thresholds improve your anastomotic-leak prevention?</li><li>What equipment is needed to move from qualitative to quantitative ICG?</li></ol>",
},

"42204046": {  # Eye-hand coordination in robotic prostate surgery — surgical vision/kinematics
    "bottom": "Surgical-science study (robotic prostatectomy) on how surgical vision and instrument kinematics interrelate — eye-hand coordination and how fluorescence/imaging guidance reshapes it. Out-of-field (urology), included as <em>surgical-vision/technology</em> transfer: how image guidance changes operative motor behavior is directly relevant to robotic gyn surgery and fluorescence-guided technique. Indirect but conceptually on-thesis.",
    "question": "<p><strong>The clinical problem.</strong> Image-guided and fluorescence-guided robotic surgery changes how surgeons see and move; understanding the vision–kinematics loop informs training and how guidance tech should be deployed — across robotic specialties including gyn.</p><p><strong>The question.</strong> How do surgical vision and instrument kinematics reflect each other during robotic surgery?</p>",
    "pico": {"P": "Robotic prostatectomy procedures (surgeon-performance focus).", "I": "Analysis of eye-hand coordination / vision-kinematics coupling.", "C": "Across guidance/vision conditions.", "O": "Vision–instrument-kinematics relationships.", "D": "Surgical-performance/imaging study.", "S": "Procedure dataset."},
    "findings": "<p>The study characterized how surgical vision and instrument kinematics co-vary, illuminating how image/fluorescence guidance shapes operative motor behavior.</p>",
    "strengths": "<p>Rare quantitative look at the vision–motor loop in robotic surgery — transferable to training and guidance-tech deployment in gyn robotics.</p>",
    "applicability": "<p>Indirect: urologic procedure, but the vision-kinematics insights inform robotic-CBG/MIGS training and how we integrate fluorescence guidance. Not a gyn clinical study.</p>",
    "equity": "<p>Performance study; no patient-population generalization.</p>",
    "prompts": "<ol><li>How does fluorescence/image guidance change your own eye-hand behavior in robotic gyn surgery?</li><li>Could vision-kinematics metrics improve robotic-CBG/MIGS training?</li><li>Is cross-specialty surgical-science transfer valid here?</li></ol>",
},

"42203323": {  # Dual-modality sentinel node mapping in vulvar cancer (radio + ICG)
    "bottom": "Directly gynecologic ICG application: dual-modality (radiotracer + ICG) site-differentiated sentinel-node mapping in vulvar cancer. SLNs were retrieved from all groins; all radio-labeled nodes were also ICG-positive, and ICG added no extra nodes beyond the radio-labeled ones. Practical data on whether ICG complements or merely duplicates radiotracer mapping in vulvar SLN biopsy.",
    "question": "<p><strong>The clinical problem.</strong> Sentinel-node mapping spares morbid groin dissection in vulvar cancer; whether ICG adds value over (or can replace) radiotracer mapping affects logistics, cost, and accuracy.</p><p><strong>The question.</strong> Does dual-modality (radiotracer + ICG) sentinel-node mapping improve detection in vulvar cancer, and does ICG add nodes beyond the radiotracer?</p>",
    "pico": {"P": "Vulvar-cancer patients undergoing sentinel-node mapping.", "I": "ICG fluorescence mapping (with radiotracer).", "C": "Radiotracer mapping.", "O": "SLN detection; concordance; additional nodes; tumor involvement.", "D": "Clinical mapping study.", "S": "Multiple groins across patients."},
    "findings": "<p>SLNs were harvested from all groins; every radio-labeled SLN was also ICG-positive, and after removing radio-labeled nodes no additional ICG-only nodes were found — i.e., ICG mirrored, but did not extend, radiotracer mapping. Tumor-infiltrated nodes were found in three groins (two patients).</p>",
    "strengths": "<p>Directly answers the complement-vs-duplicate question for ICG in vulvar SLN mapping with clear concordance data.</p>",
    "applicability": "<p>Directly applicable to vulvar-cancer SLN technique: ICG concordant with radiotracer suggests it can substitute (logistical/radiation-free advantage) rather than add nodes. Small series; confirm before abandoning radiotracer.</p>",
    "equity": "<p>Radiotracer requires nuclear-medicine infrastructure; ICG-only mapping could widen access where that's unavailable — an equity upside.</p>",
    "prompts": "<ol><li>If ICG mirrors radiotracer, could you move to ICG-only vulvar SLN mapping?</li><li>What detection-failure rate would you accept to drop the radiotracer?</li><li>Does ICG-only help centers without nuclear medicine?</li></ol>",
},

"42196473": {  # Fluorescent probes for glioblastoma/brain tumors — biomechanical comparison
    "bottom": "Neurosurgery study comparing fluorescent probes for intraoperative margin delineation in brain tumors (glioblastoma, metastases, PCNSL). Out-of-field, included as <em>fluorescence-guided-surgery technology</em> transfer — the same core challenge (real-time tumor-margin visualization to guide resection) we pursue with ICG/fluorescence in gyn oncology. Probe specifics are neuro; the margin-delineation principle transfers.",
    "question": "<p><strong>The clinical problem.</strong> Achieving tumor-free margins intraoperatively is universal across surgical oncology; fluorescence probes that distinguish tumor from normal tissue address it — a technology directly relevant to fluorescence-guided gyn-cancer surgery.</p><p><strong>The question.</strong> How do fluorescent probes compare for delineating IDH-wildtype glioblastoma, brain metastases, and PCNSL?</p>",
    "pico": {"P": "Brain-tumor resections (GBM, metastases, PCNSL).", "I": "Comparison of fluorescent probes for margin delineation.", "C": "Across probe types/tumor classes.", "O": "Delineation performance (biomechanical/optical perspective).", "D": "Comparative fluorescence study (neurosurgery).", "S": "Tumor-class comparison."},
    "findings": "<p>The study compared fluorescent-probe performance for intraoperative tumor delineation across brain-tumor types, informing probe selection for margin-guided resection.</p>",
    "strengths": "<p>Rigorous probe comparison advancing fluorescence-guided-surgery technology — the transferable frontier for gyn-onc margins.</p>",
    "applicability": "<p>Indirect: brain tumors, but the fluorescence-margin-delineation science informs where gyn-onc fluorescence guidance is heading. No gyn clinical action.</p>",
    "equity": "<p>Neurosurgical study; no gyn-population generalization.</p>",
    "prompts": "<ol><li>Where could tumor-targeted fluorescence probes help gyn-onc margins beyond ICG?</li><li>What would it take to validate such probes for gyn tumors?</li><li>Is cross-specialty FGS technology transfer a reasonable inclusion?</li></ol>",
},

"42192608": {  # UWF-ICG angiography after eplerenone in central serous chorioretinopathy — ophthalmology
    "bottom": "Ophthalmology study using ultrawide-field ICG angiography to track choroidal changes after eplerenone in central serous chorioretinopathy. Out-of-field, included as <em>ICG-angiography imaging technology</em> — advanced ICG-angiographic quantification of vascular/perfusion patterns. The imaging methodology is the thread; the disease (retinal) is unrelated to gynecology. Indirect, technology-only.",
    "question": "<p><strong>The clinical problem.</strong> ICG angiography quantifies microvascular/choroidal perfusion patterns; advances in ICG-angiographic imaging and analysis are technology that other ICG-using fields (including gyn surgery) can learn from.</p><p><strong>The question.</strong> What UWF-ICG-angiography changes follow eplerenone in central serous chorioretinopathy?</p>",
    "pico": {"P": "Patients with central serous chorioretinopathy.", "I": "Eplerenone (mineralocorticoid-receptor antagonist) over 12 weeks.", "C": "Pre- vs post-treatment imaging.", "O": "UWF-ICG-angiography changes; functional/anatomical correlation.", "D": "Prospective imaging study (ophthalmology).", "S": "CSCR cohort."},
    "findings": "<p>The study quantified choroidal-vascular changes on UWF-ICG angiography after eplerenone, correlating imaging with functional/anatomical outcomes.</p>",
    "strengths": "<p>Advanced ICG-angiographic quantification methodology.</p>",
    "applicability": "<p>Indirect/technology-only — the ICG-imaging analytics, not the retinal disease, are the (loose) point. No gyn clinical relevance. Weak fit; reasonable to drop if tightening the ICG group.</p>",
    "equity": "<p>Ophthalmology cohort; no gyn-population relevance.</p>",
    "prompts": "<ol><li>Do advanced ICG-angiography analytics from ophthalmology offer anything to surgical ICG use?</li><li>Is imaging-methodology overlap a strong enough thread to include?</li><li>Keep for ICG-tech breadth, or cut?</li></ol>",
},

"42192607": {  # Anti-VEGF response by ICG-angiographic staining in CSCR — ophthalmology
    "bottom": "Companion ophthalmology study using ICG-angiographic staining patterns (texture metrics like entropy) to predict anti-VEGF response in central serous chorioretinopathy. Out-of-field; the transferable element is <em>quantitative ICG-image texture analysis</em> as a predictive biomarker — a methodology, not gyn content. Indirect, technology-only.",
    "question": "<p><strong>The clinical problem.</strong> Quantitative analysis of ICG-angiographic patterns (contrast, entropy) can predict treatment response — an image-analytics approach potentially portable to any ICG-imaging context.</p><p><strong>The question.</strong> Do ICG-angiographic staining-pattern metrics predict anti-VEGF response in central serous chorioretinopathy?</p>",
    "pico": {"P": "135 eyes with central serous chorioretinopathy.", "I": "ICG-angiographic texture analysis (entropy/contrast).", "C": "Good vs poor anti-VEGF responders.", "O": "Predictive performance for treatment response.", "D": "Retrospective imaging-analytics study.", "S": "135 eyes."},
    "findings": "<p>Mid-late-phase ICG entropy best predicted response (AUC 0.72), with poor responders showing higher contrast/entropy — demonstrating ICG-image texture as a quantitative biomarker.</p>",
    "strengths": "<p>Quantitative ICG-image-texture biomarker methodology with predictive validation.</p>",
    "applicability": "<p>Indirect/technology-only — image-analytics methodology, not gyn content. No clinical gyn action. Weak fit alongside the directly surgical ICG papers.</p>",
    "equity": "<p>Ophthalmology cohort; no gyn relevance.</p>",
    "prompts": "<ol><li>Could quantitative ICG-texture analysis ever inform surgical perfusion assessment?</li><li>Is methodology overlap enough to include two CSCR ICG papers?</li><li>Keep for ICG-analytics breadth, or trim?</li></ol>",
},

"42178533": {  # EpCAM-targeted NIR fluorescent antibodies for HNSCC margins
    "bottom": "Surgical-oncology study using EpCAM-targeted near-infrared fluorescent antibodies for microscopic margin delineation in head-and-neck squamous cell carcinoma. Out-of-field, included as <em>tumor-targeted fluorescence-guided-surgery technology</em> — the move beyond non-specific ICG to molecularly targeted probes for real-time margins, a frontier directly relevant to future gyn-onc fluorescence surgery. Technology transfer, not gyn content.",
    "question": "<p><strong>The clinical problem.</strong> Non-specific ICG shows perfusion, not tumor; molecularly targeted fluorescent probes (e.g., anti-EpCAM) promise true tumor-specific margin delineation — the next step for fluorescence-guided cancer surgery across sites, gyn included.</p><p><strong>The question.</strong> Do EpCAM-targeted NIR fluorescent antibodies enable microscopic delineation of primary and recurrent HNSCC?</p>",
    "pico": {"P": "HNSCC resections (EpCAM-overexpressing).", "I": "EpCAM-targeted near-infrared fluorescent antibodies.", "C": "Standard (non-targeted) margin assessment.", "O": "Microscopic tumor-margin delineation.", "D": "Translational fluorescence-guided-surgery study.", "S": "HNSCC specimens/cases."},
    "findings": "<p>EpCAM-targeted NIR antibodies enabled microscopic delineation of primary and recurrent HNSCC, demonstrating tumor-specific (not just perfusion-based) fluorescence guidance.</p>",
    "strengths": "<p>Showcases molecularly targeted FGS — a meaningful advance over non-specific ICG, with clear cross-site relevance.</p>",
    "applicability": "<p>Indirect: HNSCC, but EpCAM is expressed in many epithelial (including gynecologic) cancers, so targeted-FGS is a credible future direction for gyn-onc margins. No current gyn action.</p>",
    "equity": "<p>Translational ENT study; no gyn-population data.</p>",
    "prompts": "<ol><li>Given EpCAM expression in gyn epithelial cancers, is targeted-FGS a realistic future for gyn-onc margins?</li><li>What advantages would tumor-specific probes bring over ICG in your cancer surgery?</li><li>What's the regulatory/translational path for such probes?</li></ol>",
},

# ===================== INFERTILITY (infertility is a systems condition) =====================

"42219343": {  # Endometrial thickness & ectopic pregnancy in IVF — SR/MA
    "bottom": "Systematic review/meta-analysis of whether endometrial thickness predicts ectopic pregnancy in IVF — thin endometrium has been linked to ectopic risk, and this aggregates the evidence for transfer-day risk awareness.",
    "question": "<p><strong>The clinical problem.</strong> Ectopic pregnancy is a feared IVF complication; if endometrial thickness predicts it, that informs transfer decisions and surveillance.</p><p><strong>The question.</strong> Is endometrial thickness associated with ectopic pregnancy in IVF?</p>",
    "pico": {"P": "Women undergoing IVF.", "I": "Endometrial-thickness measurement.", "C": "Thinner vs thicker endometrium.", "O": "Ectopic-pregnancy risk.", "D": "Systematic review/meta-analysis.", "S": "Pooled IVF studies."},
    "findings": "<p>The meta-analysis synthesized the endometrial-thickness–ectopic association to inform transfer-day risk stratification.</p>",
    "strengths": "<p>Aggregates scattered data on an actionable, easily measured parameter.</p>",
    "applicability": "<p>May support heightened ectopic vigilance with thin endometrium. Observational pooling — association with residual confounding; don't treat thickness as the sole determinant.</p>",
    "equity": "<p>Heterogeneous pooled cohorts; thresholds may not transfer across ultrasound practices.</p>",
    "prompts": "<ol><li>Does thin endometrium change your transfer-vs-freeze decision for ectopic risk?</li><li>How does this fit your existing ectopic surveillance after IVF?</li><li>Is the effect size clinically meaningful?</li></ol>",
},

"42216928": {  # Melatonin alleviates sleep-disturbance ovarian-reserve decline via NLRP3 pyroptosis
    "bottom": "Mechanism study tying the systems thesis together neatly: sleep disturbance accelerated ovarian-reserve decline through NLRP3-mediated granulosa-cell pyroptosis, and melatonin rescued it. Connects circadian/sleep, inflammation (inflammasome), and ovarian reserve — a clean illustration of infertility as a systems condition. Pre-clinical.",
    "question": "<p><strong>The clinical problem.</strong> Sleep disruption is epidemic and linked to worse reproductive outcomes, but the mechanism connecting circadian/immune disturbance to ovarian reserve is unclear.</p><p><strong>The question.</strong> Does sleep disturbance reduce ovarian reserve via NLRP3-mediated granulosa-cell pyroptosis, and does melatonin protect against it?</p>",
    "pico": {"P": "Sleep-disturbance ovarian models (animal/granulosa cells).", "I": "Melatonin.", "C": "Untreated sleep-disturbed controls.", "O": "Ovarian reserve; NLRP3-pyroptosis markers.", "D": "Mechanistic study.", "S": "Experimental."},
    "findings": "<p>Sleep disturbance drove NLRP3-mediated granulosa-cell pyroptosis and reserve decline; melatonin suppressed the inflammasome pathway and preserved reserve.</p>",
    "strengths": "<p>Integrates circadian, inflammatory, and ovarian biology — a textbook systems-condition mechanism with a candidate intervention (melatonin).</p>",
    "applicability": "<p>Conceptual support for sleep hygiene and (speculatively) melatonin in reproductive counseling — but it's pre-clinical. Don't over-translate to melatonin prescriptions for reserve.</p>",
    "equity": "<p>Bench/animal; no population.</p>",
    "prompts": "<ol><li>Do you address sleep in fertility counseling, and would this strengthen that?</li><li>Is melatonin's reserve-protective signal anywhere near clinically actionable?</li><li>How does the inflammasome link to other ovarian-aging pathways?</li></ol>",
},

"42216385": {  # IVF with testicular vs urinary-recovered sperm in complete retrograde ejaculation
    "bottom": "Male-factor comparative study: in complete retrograde ejaculation, IVF outcomes using testicular sperm vs urinary-recovered sperm. Practical guidance for a specific male-factor scenario, reinforcing the couple-level systems view of infertility.",
    "question": "<p><strong>The clinical problem.</strong> Complete retrograde ejaculation causes male infertility; both testicular extraction and urinary sperm recovery are options, with unclear comparative IVF outcomes.</p><p><strong>The question.</strong> Do testicular vs urinary-recovered sperm yield different IVF outcomes in complete retrograde ejaculation?</p>",
    "pico": {"P": "Couples with male complete retrograde ejaculation undergoing IVF.", "I": "Testicular sperm.", "C": "Urinary-recovered sperm.", "O": "Fertilization/embryo/pregnancy outcomes.", "D": "Single-center retrospective comparative study.", "S": "CRE-IVF cohort."},
    "findings": "<p>The study compared IVF outcomes by sperm source in CRE, informing whether the less-invasive urinary recovery suffices or testicular extraction is preferable.</p>",
    "strengths": "<p>Addresses a specific, actionable male-factor decision with comparative outcomes.</p>",
    "applicability": "<p>Useful for the male-factor side of ART planning, with andrology/urology. Single-center retrospective; validate before firm preference.</p>",
    "equity": "<p>Single-center; generalize cautiously.</p>",
    "prompts": "<ol><li>Would you favor urinary recovery (less invasive) if outcomes are comparable?</li><li>How tightly do you integrate andrology for CRE couples?</li><li>What tips you toward testicular extraction?</li></ol>",
},

"42216383": {  # Planetary health diet & self-reported infertility — NHANES
    "bottom": "Cross-sectional NHANES analysis linking adherence to a 'planetary health' (EAT-Lancet) diet with self-reported infertility in US women. Diet-as-systems-input content; hypothesis-generating association between a sustainable dietary pattern and fertility. Cross-sectional, self-reported — weak causal weight.",
    "question": "<p><strong>The clinical problem.</strong> Diet plausibly affects fertility, and patients increasingly choose sustainable dietary patterns; whether the EAT-Lancet diet associates with infertility is unexplored.</p><p><strong>The question.</strong> Is adherence to a planetary health diet associated with self-reported infertility in US women?</p>",
    "pico": {"P": "US women (NHANES 2013–2018).", "I": "Higher planetary-health-diet adherence.", "C": "Lower adherence.", "O": "Self-reported infertility.", "D": "Cross-sectional NHANES analysis.", "S": "NHANES survey sample."},
    "findings": "<p>The analysis characterized the association between planetary-health-diet adherence and self-reported infertility, contributing population-level dietary-pattern data.</p>",
    "strengths": "<p>Population-scale, uses a defined dietary index; relevant to lifestyle counseling.</p>",
    "applicability": "<p>Supports general healthy-diet counseling but proves nothing causal. Cross-sectional with self-reported infertility — high bias risk; don't over-state.</p>",
    "equity": "<p>NHANES is broadly representative of US adults, a relative strength; still cross-sectional.</p>",
    "prompts": "<ol><li>How do you counsel diet in infertility given only cross-sectional associations?</li><li>Does self-reported infertility undermine the signal?</li><li>Is a sustainable-diet message defensible on health grounds regardless?</li></ol>",
},

"42213822": {  # Platelet-derived vesicles restore fertility in endometrial injury (mice)
    "bottom": "Pre-clinical (mouse) study: platelet-derived extracellular vesicles restored fertility after endometrial injury by modulating the endometrial immune niche. Mechanistic support for regenerative approaches to thin/injured endometrium (e.g., Asherman's) and the immune-niche view of receptivity. Animal model; no clinical translation.",
    "question": "<p><strong>The clinical problem.</strong> Endometrial injury (Asherman's, thin endometrium) causes refractory infertility with few effective regenerative options; the immune niche may be a target.</p><p><strong>The question.</strong> Do platelet-derived vesicles restore fertility after endometrial injury by modulating the immune niche?</p>",
    "pico": {"P": "Mouse endometrial-injury model.", "I": "Platelet-derived extracellular vesicles.", "C": "Untreated injured controls.", "O": "Fertility restoration; endometrial immune-niche changes.", "D": "Animal mechanistic study.", "S": "Mouse model."},
    "findings": "<p>Platelet-derived vesicles restored fertility in injured endometrium by remodeling the immune niche, supporting an EV-based regenerative strategy.</p>",
    "strengths": "<p>Functional fertility endpoint (not just markers) in a regenerative-medicine model; immune-niche mechanism.</p>",
    "applicability": "<p>Pre-clinical only — relates conceptually to PRP/EV approaches for thin endometrium. Mouse data; no clinical use.</p>",
    "equity": "<p>Animal model; no population.</p>",
    "prompts": "<ol><li>How does this relate to clinical PRP/regenerative attempts for thin endometrium?</li><li>Is the immune niche a credible target for receptivity?</li><li>What translational steps are needed?</li></ol>",
},

"42213241": {  # Oncofertility in the age of HER2/PARP/CDK4-6/immunotherapy — breast cancer
    "bottom": "Review of unanswered oncofertility questions as modern breast-cancer therapies (HER2 blockade, immunotherapy, PARP/CDK4-6 inhibitors, endocrine therapy) reshape gonadotoxicity and fertility-preservation timing in reproductive-age survivors. Genuinely relevant to fertility-preservation counseling and multidisciplinary coordination.",
    "question": "<p><strong>The clinical problem.</strong> As breast-cancer survival improves with novel agents whose reproductive effects are poorly characterized, oncofertility decisions (timing, preservation, safety of pregnancy) grow more complex.</p><p><strong>The question.</strong> What are the open oncofertility questions across modern breast-cancer therapy classes?</p>",
    "pico": {"P": "Reproductive-age breast-cancer patients on modern therapies.", "I": "Review of oncofertility implications by drug class.", "C": "Across HER2/immuno/PARP/CDK4-6/endocrine therapy.", "O": "Fertility-preservation and reproductive-safety considerations.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review maps the uncertain gonadotoxicity and fertility-timing implications of each modern therapy class, highlighting unanswered questions for counseling.</p>",
    "strengths": "<p>Current and clinically useful for fertility-preservation timing decisions in a fast-changing treatment landscape.</p>",
    "applicability": "<p>Directly informs oncofertility counseling and referral timing for reproductive-age breast-cancer patients. Narrative — many questions remain genuinely open.</p>",
    "equity": "<p>Fertility-preservation access is unequal; the review implicitly underscores who reaches these services.</p>",
    "prompts": "<ol><li>How do modern agents change your fertility-preservation timing advice?</li><li>Where is the evidence weakest for pregnancy safety after treatment?</li><li>Is your oncofertility referral fast enough for treatment timelines?</li></ol>",
},

"42213185": {  # rFSH or eCG ovarian response in guinea pig — veterinary
    "bottom": "Veterinary reproductive-physiology study (guinea pig) on ovarian response to recombinant human FSH vs equine chorionic gonadotropin. Out-of-field animal work, included under the systems thesis as <em>comparative ovarian-stimulation physiology</em> — gonadotropin response biology generalizable in principle. Support is indirect; this is an animal-model mechanism paper.",
    "question": "<p><strong>The clinical problem.</strong> Gonadotropin-driven ovarian response underlies all controlled ovarian stimulation; comparative animal models inform the basic physiology of FSH vs combined-activity gonadotropins.</p><p><strong>The question.</strong> How do recombinant human FSH and equine chorionic gonadotropin compare for ovarian response in the guinea pig?</p>",
    "pico": {"P": "Guinea pigs (ovarian-response model).", "I": "Recombinant human FSH.", "C": "Equine chorionic gonadotropin.", "O": "Ovarian (follicular) response.", "D": "Veterinary experimental study.", "S": "Animal cohort."},
    "findings": "<p>The study compared follicular/ovarian responses to rFSH vs eCG in guinea pigs, contributing comparative gonadotropin-stimulation physiology.</p>",
    "strengths": "<p>Controlled comparison of gonadotropin classes in a mammalian model.</p>",
    "applicability": "<p>Indirect — animal physiology, no clinical human application. Included as basic ovarian-stimulation biology. Don't transfer dosing/agent conclusions to human ART.</p>",
    "equity": "<p>Veterinary model; no human population.</p>",
    "prompts": "<ol><li>Does cross-species ovarian-stimulation physiology meaningfully inform human ART?</li><li>Is an animal gonadotropin study a fair fit for a CBG/MIGS digest?</li><li>What translational caveats apply?</li></ol>",
},

"42211451": {  # Phenotype-driven protocol switching in ART — self-controlled, 4,632 cycles
    "bottom": "Large self-controlled analysis (4,632 cycles): phenotype-driven protocol switching (addressing over-suppression or poor embryo quality) outperformed repeating the index protocol or escalating gonadotropin at constant dosage. Practical, well-designed guidance for managing the post-failure ART decision.",
    "question": "<p><strong>The clinical problem.</strong> After a failed ART cycle, clinicians choose among repeating, dose-escalating, or switching protocols with little comparative evidence — a common, consequential decision.</p><p><strong>The question.</strong> Is phenotype-driven protocol switching more effective than repeating the index protocol at constant gonadotropin dose?</p>",
    "pico": {"P": "ART patients after an initial cycle (4,632 cycles).", "I": "Phenotype-driven protocol switching.", "C": "Repeating the index protocol (constant Gn dose).", "O": "ART outcomes.", "D": "Self-controlled retrospective analysis.", "S": "4,632 cycles."},
    "findings": "<p>Phenotype-driven switching (targeting over-suppression or poor embryo quality) was associated with improved outcomes versus repeating the protocol, holding gonadotropin dose constant.</p>",
    "strengths": "<p>Large, self-controlled design (each patient as own control) reduces confounding; directly actionable post-failure guidance.</p>",
    "applicability": "<p>Supports a phenotype-driven switch over rote repetition after ART failure. Retrospective despite self-control — confirm against prospective data before rigid rules.</p>",
    "equity": "<p>Single-program data; generalize cautiously.</p>",
    "prompts": "<ol><li>Do you switch protocols by phenotype, escalate dose, or repeat after failure?</li><li>How do you define 'over-suppression' or 'poor embryo quality' to drive switching?</li><li>Does the self-controlled design convince you?</li></ol>",
},

"42210622": {  # Malignant ovarian germ cell tumor — survival, reproductive outcomes, relapse
    "bottom": "Outcomes study of malignant ovarian germ cell tumors — rare cancers of young women, often advanced at presentation, where fertility-sparing surgery plus chemotherapy can preserve reproductive function. Survival, reproductive outcomes, and relapse patterns directly inform the fertility-sparing-vs-radical decision in young patients.",
    "question": "<p><strong>The clinical problem.</strong> MOGCTs strike young women and are often curable, making fertility-sparing management and relapse vigilance central to counseling and surgical planning.</p><p><strong>The question.</strong> What are the survival, reproductive outcomes, and relapse patterns in malignant ovarian germ cell tumors?</p>",
    "pico": {"P": "Patients with malignant ovarian germ cell tumors.", "I": "Treatment (often fertility-sparing surgery + chemotherapy).", "C": "Across stage/management.", "O": "Survival, reproductive outcomes, relapse patterns.", "D": "Retrospective outcomes study.", "S": "MOGCT cohort."},
    "findings": "<p>The study reported survival, reproductive outcomes, and relapse patterns, supporting fertility-sparing approaches and informing surveillance in this young population.</p>",
    "strengths": "<p>Couples oncologic and reproductive endpoints in a rare cancer — exactly what counseling requires.</p>",
    "applicability": "<p>Directly relevant to fertility-sparing decisions and relapse surveillance in young women with MOGCT. Retrospective rare-tumor cohort; triangulate before fixed prognoses.</p>",
    "equity": "<p>Rare-tumor cohort; access to fertility-sparing expertise is unequal.</p>",
    "prompts": "<ol><li>How do the reproductive-outcome data shape your fertility-sparing counseling?</li><li>What relapse pattern drives your surveillance plan?</li><li>When is fertility-sparing not advisable?</li></ol>",
},

"42208006": {  # Early-onset cancer: epidemiology, well-being, oncofertility, survivorship — review
    "bottom": "Broad oncology review of early-onset cancer (rising incidence in the young) spanning epidemiology, well-being, oncofertility, and survivorship. Included under the infertility/systems thesis for its <em>oncofertility</em> thread; otherwise it's a general oncology survivorship piece. Loosest fit of the oncofertility papers — value is the fertility-preservation/survivorship framing.",
    "question": "<p><strong>The clinical problem.</strong> Early-onset cancer is rising, and survivors face long horizons where fertility and survivorship care matter as much as cure — intersecting reproductive medicine.</p><p><strong>The question.</strong> What are the contemporary challenges (epidemiology, well-being, oncofertility, survivorship) in early-onset cancer?</p>",
    "pico": {"P": "Patients with early-onset cancer.", "I": "Review across epidemiology/well-being/oncofertility/survivorship.", "C": "Not applicable.", "O": "Synthesis of challenges and care needs.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesized rising early-onset-cancer trends and the survivorship/oncofertility/well-being challenges they create.</p>",
    "strengths": "<p>Foregrounds oncofertility and survivorship within a timely epidemiologic trend.</p>",
    "applicability": "<p>Relevant only via its oncofertility/survivorship content for reproductive counseling; the rest is general oncology. Reasonable to keep for the fertility-preservation framing or trim as broad.</p>",
    "equity": "<p>Survivorship and fertility-preservation access disparities are part of the review's scope.</p>",
    "prompts": "<ol><li>Does the oncofertility content justify inclusion in a CBG/MIGS digest?</li><li>How do rising early-onset trends affect your fertility-preservation volume?</li><li>Keep for survivorship framing, or cut as too broad?</li></ol>",
},

"42205258": {  # Intraovarian autologous PRP for poor reserve/insufficiency — meta-analysis of RCTs
    "bottom": "Meta-analysis of RCTs on intraovarian autologous platelet-rich plasma for poor ovarian reserve/insufficiency — a popular but unproven 'add-on.' The honest read: potential signal but uncertain efficacy on the existing RCTs. De-implementation-relevant for a costly, heavily marketed intervention.",
    "question": "<p><strong>The clinical problem.</strong> Poor ovarian reserve has few effective options, and intraovarian PRP is widely offered (often at high cost) on thin evidence.</p><p><strong>The question.</strong> Is intraovarian autologous PRP efficacious for poor ovarian reserve/insufficiency in RCTs?</p>",
    "pico": {"P": "Women with poor ovarian reserve/insufficiency.", "I": "Intraovarian autologous PRP.", "C": "Control/no PRP.", "O": "Reserve markers and reproductive outcomes.", "D": "Meta-analysis of RCTs.", "S": "Pooled RCTs."},
    "findings": "<p>The meta-analysis pooled RCT evidence on PRP, finding the efficacy uncertain on current trials — cautioning against routine, high-cost adoption.</p>",
    "strengths": "<p>RCT-only synthesis grounding a marketed add-on in evidence rather than enthusiasm.</p>",
    "applicability": "<p>Supports cautious, informed-cost counseling on PRP — promising-but-unproven. Confirm certainty grade before offering as anything but investigational.</p>",
    "equity": "<p>High out-of-pocket cost with uncertain benefit is an equity/financial-toxicity concern.</p>",
    "prompts": "<ol><li>Do you offer intraovarian PRP, and how do you frame its uncertain evidence?</li><li>Is charging for an unproven add-on defensible?</li><li>What trial result would change your stance?</li></ol>",
},

"42202883": {  # PCOS pregnancy outcomes and management — systematic review
    "bottom": "Systematic review of pregnancy outcomes and management in PCOS — the leading cause of anovulatory infertility (70–90% of cases), with elevated pregnancy-complication risk. Bridges PCOS-related infertility to obstetric outcomes; useful synthesis for counseling and antenatal vigilance in PCOS pregnancies.",
    "question": "<p><strong>The clinical problem.</strong> PCOS causes most anovulatory infertility and, once pregnant, raises risks (GDM, hypertensive disease, preterm birth); management spans conception through obstetric care.</p><p><strong>The question.</strong> What are the pregnancy outcomes and optimal management in PCOS?</p>",
    "pico": {"P": "Pregnant women with PCOS.", "I": "Review of management strategies.", "C": "Non-PCOS pregnancy outcomes.", "O": "Pregnancy complications and management.", "D": "Systematic review.", "S": "Included PCOS-pregnancy studies."},
    "findings": "<p>The review synthesized elevated pregnancy-complication risks in PCOS and management approaches across the conception-to-delivery continuum.</p>",
    "strengths": "<p>Connects PCOS infertility to obstetric outcomes — a continuity often siloed.</p>",
    "applicability": "<p>Useful for counseling and antenatal-surveillance planning in PCOS pregnancies. Review-level; weight individual recommendations by their primary evidence.</p>",
    "equity": "<p>PCOS prevalence/phenotype varies by population; check representation before generalizing.</p>",
    "prompts": "<ol><li>How does PCOS change your antenatal-surveillance plan?</li><li>Which pre-conception optimizations most reduce pregnancy risk?</li><li>Do you maintain continuity from fertility care into obstetric care for PCOS?</li></ol>",
},

"42199798": {  # Acupuncture for repeated implantation failure — pilot RCT protocol
    "bottom": "Pilot RCT protocol for acupuncture as an adjunct in repeated implantation failure — designed to estimate effect sizes and feasibility for a definitive trial. Protocol only; reflects the systems/integrative interest in RIF but provides no efficacy data yet.",
    "question": "<p><strong>The clinical problem.</strong> Repeated implantation failure is frustrating and poorly served; acupuncture is widely used as an adjunct without robust evidence.</p><p><strong>The question.</strong> Is acupuncture feasible and what effect size might it have in RIF? (Pilot protocol.)</p>",
    "pico": {"P": "Patients with repeated implantation failure after IVF-ET.", "I": "Acupuncture adjunct.", "C": "Control (per protocol).", "O": "Feasibility and effect-size estimates (to be measured).", "D": "Pilot randomized controlled trial — protocol.", "S": "Planned pilot cohort."},
    "findings": "<p>No results — the paper publishes a feasibility/effect-size pilot design to inform a future definitive acupuncture-in-RIF trial.</p>",
    "strengths": "<p>Appropriately framed as a pilot to power a real trial rather than over-claiming.</p>",
    "applicability": "<p>Not actionable; supports offering acupuncture only as a low-risk patient-preference adjunct while evidence matures.</p>",
    "equity": "<p>Protocol; recruitment breadth to be assessed.</p>",
    "prompts": "<ol><li>How do you handle patient interest in acupuncture for RIF without efficacy data?</li><li>What effect size would justify a definitive trial?</li><li>Is a low-risk adjunct reasonable to permit pending evidence?</li></ol>",
},

"42199797": {  # Ovarian intelligence: AI leveraging AMH and inhibin B (abstract unavailable)
    "bottom": "Paper on AI applications using AMH and inhibin B for ovarian assessment ('ovarian intelligence'). The verbatim abstract wasn't captured in the source feed, so this appraisal is title-level: it sits in the data-driven/systems corner of reproductive medicine — algorithmic interpretation of ovarian-reserve biomarkers — and should be read with the usual caution about un-validated AI tools.",
    "question": "<p><strong>The clinical problem.</strong> Ovarian-reserve assessment relies on biomarkers (AMH, inhibin B) whose interpretation could be sharpened by AI — but un-validated algorithms risk false precision.</p><p><strong>The question.</strong> How can AI leverage AMH and inhibin B for ovarian assessment? (Abstract not available in the source feed.)</p>",
    "pico": {"P": "Women undergoing ovarian-reserve assessment.", "I": "AI models using AMH and inhibin B.", "C": "Conventional biomarker interpretation.", "O": "Ovarian-reserve/response prediction (per title).", "D": "Not determinable from the captured record.", "S": "Not available."},
    "findings": "<p>Abstract unavailable in the source feed — findings cannot be appraised here. Title indicates AI applications on AMH/inhibin B for ovarian assessment; await full text before weighting.</p>",
    "strengths": "<p>Not assessable without the abstract; the general direction (biomarker-driven AI) is topical.</p>",
    "applicability": "<p>Cannot recommend or dismiss without the full text. Treat AI ovarian-assessment claims skeptically until externally validated.</p>",
    "equity": "<p>Not assessable; AI tools risk encoding population bias if trained narrowly.</p>",
    "prompts": "<ol><li>What validation would an AI ovarian-reserve tool need before clinical use?</li><li>How do you guard against false precision from biomarker AI?</li><li>Should papers without retrievable abstracts appear in the digest?</li></ol>",
},

"42199796": {  # Vitamin D supplementation & ovarian reserve (AMH) — meta-analysis of RCTs
    "bottom": "Meta-analysis of RCTs on whether vitamin D supplementation changes ovarian reserve as measured by AMH — a common patient question with controversial evidence. Provides an RCT-grounded answer to temper supplement enthusiasm or support it.",
    "question": "<p><strong>The clinical problem.</strong> Vitamin D is implicated in ovarian physiology and widely supplemented, but its actual effect on ovarian reserve (AMH) is contested.</p><p><strong>The question.</strong> Does vitamin D supplementation influence ovarian reserve as reflected by AMH?</p>",
    "pico": {"P": "Women (reserve-assessment context).", "I": "Vitamin D supplementation.", "C": "Placebo/no supplementation.", "O": "Serum AMH (ovarian reserve).", "D": "Meta-analysis of RCTs.", "S": "Pooled RCTs."},
    "findings": "<p>The meta-analysis pooled RCT data on vitamin D's effect on AMH, clarifying whether supplementation meaningfully alters this reserve marker.</p>",
    "strengths": "<p>RCT-based answer to a frequent supplement question; AMH as an objective endpoint.</p>",
    "applicability": "<p>Grounds honest counseling on vitamin D for ovarian reserve. Note AMH is a reserve marker, not a fertility guarantee; weight the pooled certainty.</p>",
    "equity": "<p>Vitamin D status varies by latitude/skin type; pooled effects may mask population differences.</p>",
    "prompts": "<ol><li>Does this change how you counsel vitamin D for reserve?</li><li>Is an AMH change clinically meaningful for fertility?</li><li>How do baseline-deficiency differences affect the result?</li></ol>",
},

"42196562": {  # Immunologic factors in endometrial receptivity — review
    "bottom": "Review on immunologic factors in endometrial receptivity — the embryo-endometrium 'dialogue' integrating hormonal, molecular, and immune signals for implantation. Mechanistic backbone for the systems view of implantation failure; conceptual, not a clinical test.",
    "question": "<p><strong>The clinical problem.</strong> Implantation failure often has no anatomic explanation; the immune dimension of receptivity is increasingly central but clinically under-operationalized.</p><p><strong>The question.</strong> What immunologic factors govern endometrial receptivity and the embryo-endometrium dialogue?</p>",
    "pico": {"P": "Endometrial receptivity / implantation (conceptual).", "I": "Review of immunologic receptivity factors.", "C": "Receptive vs non-receptive states.", "O": "Mechanistic synthesis.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesizes how immune signaling integrates with hormonal/molecular cues to establish receptivity, framing implantation as a bidirectional dialogue.</p>",
    "strengths": "<p>Coherent immune-receptivity synthesis underpinning the systems model of implantation failure.</p>",
    "applicability": "<p>Conceptual — cautions against unvalidated 'immune' add-ons while explaining the biology. No specific test/therapy endorsed.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>How do you respond to requests for unvalidated immune testing/therapy in RIF?</li><li>Which immune factor is closest to a validated receptivity marker?</li><li>Does this temper or fuel the 'reproductive immunology' add-on market?</li></ol>",
},

"42196360": {  # Decidualization & the ER stress-immune-metabolic axis — review
    "bottom": "Mechanistic review reframing endometrial decidualization as more than hormone-driven differentiation — an adaptive program integrating ER stress, immune regulation, and metabolic reprogramming. Deepens the systems understanding of receptivity/early pregnancy; conceptual.",
    "question": "<p><strong>The clinical problem.</strong> Decidualization is essential for implantation and its failure underlies some infertility/early-loss, but reducing it to progesterone response misses the integrated stress-immune-metabolic program.</p><p><strong>The question.</strong> How do ER stress, immune, and metabolic axes integrate to control decidualization?</p>",
    "pico": {"P": "Human endometrial decidualization (conceptual).", "I": "Review of ER-stress-immune-metabolic integration.", "C": "Hormone-only model.", "O": "Mechanistic reframing of decidualization.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review positions decidualization as a multilayered adaptive program tightly integrating ER stress, immune regulation, and metabolic reprogramming.</p>",
    "strengths": "<p>Integrative mechanistic reframing aligned with the systems thesis.</p>",
    "applicability": "<p>Conceptual; informs how we think about decidualization failure, not a clinical action. Weight by primary evidence.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>Could the metabolic/ER-stress angle yield modifiable decidualization targets?</li><li>How does this connect to recurrent-loss workups?</li><li>Where is the biology closest to clinic?</li></ol>",
},

"42196194": {  # Biomarkers for endometrial receptivity — review
    "bottom": "Review of endometrial-receptivity biomarkers and their implications for infertility, implantation failure, and emerging diagnostics/therapeutics. Surveys the (still largely unvalidated for routine use) receptivity-testing landscape — useful for appraising tests patients ask about. Conceptual/critical.",
    "question": "<p><strong>The clinical problem.</strong> Receptivity tests (e.g., transcriptomic arrays) are marketed for personalized transfer timing, but their validation and clinical value are contested.</p><p><strong>The question.</strong> What biomarkers for endometrial receptivity exist, and what are their diagnostic/therapeutic implications?</p>",
    "pico": {"P": "Women with infertility/implantation failure (conceptual).", "I": "Review of receptivity biomarkers.", "C": "Across biomarker classes.", "O": "Diagnostic/therapeutic implications.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review catalogues receptivity biomarkers and weighs their diagnostic maturity and therapeutic implications.</p>",
    "strengths": "<p>Useful map of a confusing, heavily marketed test landscape.</p>",
    "applicability": "<p>Helps you appraise receptivity tests patients request — most remain investigational for routine use. Don't adopt off a narrative review.</p>",
    "equity": "<p>Costly receptivity testing with uncertain benefit is a financial-equity concern.</p>",
    "prompts": "<ol><li>Which receptivity tests, if any, meet your evidence bar?</li><li>How do you counsel patients requesting marketed receptivity assays?</li><li>What would validate a receptivity biomarker for routine use?</li></ol>",
},

"42194047": {  # NGF signaling in ovarian processes — narrative review
    "bottom": "Narrative review on nerve growth factor (NGF) signaling in normal and pathological ovarian processes — the heavily innervated ovary uses NGF beyond neurotrophic roles (folliculogenesis, ovulation, and pathology like PCOS). Supports the neuro-endocrine integration of the systems thesis; mechanistic background, not clinical.",
    "question": "<p><strong>The clinical problem.</strong> The ovary is densely innervated and NGF regulates ovarian function and pathology; understanding this neuro-ovarian axis could reveal targets in PCOS and ovarian dysfunction.</p><p><strong>The question.</strong> What roles does NGF signaling play in physiological and pathological ovarian processes?</p>",
    "pico": {"P": "Mammalian ovary (conceptual).", "I": "Review of NGF signaling roles.", "C": "Physiological vs pathological states.", "O": "Mechanistic synthesis of NGF in ovarian function.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesizes NGF's roles in folliculogenesis, ovulation, and ovarian pathology, positioning it as a neuro-endocrine regulator of ovarian function.</p>",
    "strengths": "<p>Illuminates the under-appreciated neuro-ovarian axis central to systems thinking.</p>",
    "applicability": "<p>Background mechanism; no clinical action. Frames a potential future target (e.g., in PCOS). Conceptual.</p>",
    "equity": "<p>Review; no population.</p>",
    "prompts": "<ol><li>Does the neuro-ovarian axis offer a credible target in PCOS or ovarian dysfunction?</li><li>How does ovarian innervation connect to the systems/autonomic framing?</li><li>What would translate NGF biology toward clinic?</li></ol>",
},

"42193968": {  # Physiological cell-culture lessons for human embryo culture in IVF
    "bottom": "Conceptual/lab paper arguing IVF embryo-culture media — historically designed to keep cells alive, not to mimic the in-vivo microenvironment — should adopt 'physiological cell culture' principles. Quietly important for the lab side of ART: media composition shapes embryo quality and possibly long-term outcomes.",
    "question": "<p><strong>The clinical problem.</strong> Embryo-culture media were derived from mid-20th-century cell-line media, not physiological reproductive-tract conditions; this mismatch may affect embryo development and outcomes.</p><p><strong>The question.</strong> What can physiological cell-culture principles teach us about improving human embryo-culture media?</p>",
    "pico": {"P": "Human IVF embryo culture (lab/conceptual).", "I": "Physiological-cell-culture-informed media design.", "C": "Conventional culture media.", "O": "Rationale for improved embryo-culture conditions.", "D": "Narrative/conceptual review.", "S": "Not applicable."},
    "findings": "<p>The paper argues for redesigning embryo-culture media around physiological microenvironment principles rather than legacy cell-line formulations.</p>",
    "strengths": "<p>Challenges an unexamined assumption in the IVF lab with biological logic.</p>",
    "applicability": "<p>Relevant to lab/media decisions and quality oversight; conceptual rather than a specific protocol. Embryologists are the primary audience.</p>",
    "equity": "<p>Conceptual; no population.</p>",
    "prompts": "<ol><li>How much do you scrutinize your lab's embryo-culture media rationale?</li><li>Could physiological media improve embryo quality or long-term outcomes?</li><li>What evidence would justify a media change?</li></ol>",
},

"42192635": {  # Bacterial dysbiosis in infertility — BIOME study protocol
    "bottom": "Protocol for the BIOME study, a Danish multicentre prospective cohort mapping microbiome composition across vagina, gut, urinary tract, and semen in relation to infertility. Squarely systems-condition (the multi-site microbiome-infertility axis); protocol only — track for results.",
    "question": "<p><strong>The clinical problem.</strong> The reproductive and gut microbiomes are increasingly linked to fertility, but causal, multi-site prospective data are lacking.</p><p><strong>The question.</strong> How does multi-site microbiome composition relate to infertility? (Protocol.)</p>",
    "pico": {"P": "Couples/individuals with infertility (Danish multicentre).", "I": "Multi-site microbiome profiling (vaginal/gut/urinary/semen).", "C": "Across fertility status (per protocol).", "O": "Microbiome-infertility associations (to be measured).", "D": "Prospective observational cohort — protocol.", "S": "Planned multicentre cohort."},
    "findings": "<p>No results — the paper publishes a rigorous multi-site microbiome-infertility cohort design.</p>",
    "strengths": "<p>Prospective, multi-site, multicentre design addresses the microbiome literature's usual single-site, cross-sectional limits.</p>",
    "applicability": "<p>Not actionable; track for results before any microbiome-directed fertility intervention. Tempers current marketed microbiome tests.</p>",
    "equity": "<p>Protocol; Danish multicentre — generalizability to be assessed.</p>",
    "prompts": "<ol><li>How do you handle patient interest in microbiome testing/treatment for infertility now?</li><li>What would multi-site causal data need to show to change practice?</li><li>Is the vaginal microbiome the most actionable site?</li></ol>",
},

"42189806": {  # VR medical hypnosis for anxiolysis during frozen embryo transfer — pilot
    "bottom": "Prospective pilot of virtual-reality medical hypnosis for anxiolysis during frozen embryo transfer, also observing effect on pregnancy rate. Fits the systems/whole-person view (stress/anxiety as a modifiable factor around transfer); feasibility-level evidence — promising but preliminary.",
    "question": "<p><strong>The clinical problem.</strong> Transfer-associated anxiety is common and may affect experience (and possibly outcomes via uterine contractility); non-pharmacologic anxiolysis is attractive.</p><p><strong>The question.</strong> Is VR medical hypnosis feasible for anxiolysis during FET, and does it affect pregnancy rate?</p>",
    "pico": {"P": "Patients undergoing frozen embryo transfer.", "I": "Virtual-reality medical hypnosis.", "C": "Standard care (observational pilot).", "O": "Feasibility, anxiety, pregnancy rate.", "D": "Prospective pilot study.", "S": "Pilot cohort."},
    "findings": "<p>The pilot assessed feasibility and anxiolytic effect of VR hypnosis during FET and observed pregnancy-rate signals, supporting a larger trial.</p>",
    "strengths": "<p>Tests a low-risk, scalable non-pharmacologic anxiolytic with patient-experience and outcome observation.</p>",
    "applicability": "<p>Reasonable low-risk comfort adjunct; pregnancy-rate claims are preliminary and uncontrolled. Don't over-state outcome effects.</p>",
    "equity": "<p>VR hardware access varies; pilot scale limits generalization.</p>",
    "prompts": "<ol><li>Would a VR anxiolytic improve your patients' transfer experience?</li><li>Is the pregnancy-rate signal credible from an uncontrolled pilot?</li><li>How do you weigh comfort adjuncts without outcome proof?</li></ol>",
},

"42181206": {  # Trigger-day LH & embryo quality in overweight/obese GnRH-antagonist cycles
    "bottom": "Retrospective cohort in overweight/obese women on GnRH-antagonist protocols: higher trigger-day LH correlated with fewer mature oocytes and high-quality embryos, though first-transfer clinical pregnancy/live birth didn't differ between groups. Nuanced data on LH dynamics and body weight in stimulation — affects lab expectations more than final outcomes.",
    "question": "<p><strong>The clinical problem.</strong> In overweight/obese women on antagonist cycles, trigger-day LH may track oocyte/embryo quality, but whether it predicts pregnancy is unclear.</p><p><strong>The question.</strong> Does trigger-day LH affect embryo quality and pregnancy outcomes in overweight/obese women on GnRH-antagonist protocols?</p>",
    "pico": {"P": "Overweight/obese women on GnRH-antagonist IVF protocols.", "I": "Trigger-day serum LH (stratified).", "C": "Across LH groups.", "O": "Oocyte/embryo quality; clinical pregnancy/live birth.", "D": "Retrospective cohort.", "S": "Stratified IVF cohort."},
    "findings": "<p>Higher trigger-day LH correlated with fewer mature oocytes and high-quality embryos, but first-transfer clinical pregnancy and live-birth rates didn't differ across LH groups.</p>",
    "strengths": "<p>Body-weight-specific analysis with both embryo and pregnancy endpoints; honest negative on the pregnancy outcome.</p>",
    "applicability": "<p>Informs lab/expectation-setting (LH–embryo-quality link) without over-claiming pregnancy effects. Retrospective; confirm before protocol change.</p>",
    "equity": "<p>Single-cohort; body-weight focus is a strength but limits broad transfer.</p>",
    "prompts": "<ol><li>Does trigger-day LH change your counseling on embryo yield in obese patients?</li><li>Why might embryo-quality effects not translate to pregnancy differences?</li><li>Would freeze-all change the interpretation?</li></ol>",
},

"42181185": {  # Euploidy rates: PPOS vs GnRH-antagonist in mixed-ethnicity Brazilian population
    "bottom": "Single-center study comparing embryo euploidy rates between PPOS and GnRH-antagonist suppression in a genetically admixed Brazilian population under-represented in reproductive research. Reassuring-type data that stimulation protocol shouldn't change ploidy, with welcome population diversity.",
    "question": "<p><strong>The clinical problem.</strong> Whether the suppression protocol (PPOS vs antagonist) affects embryo euploidy matters for protocol choice and for de-risking the newer PPOS approach.</p><p><strong>The question.</strong> Do euploidy rates differ between PPOS and GnRH-antagonist protocols, and what factors associate with euploidy?</p>",
    "pico": {"P": "Patients in an admixed Brazilian IVF population.", "I": "Progestin-primed ovarian stimulation (PPOS).", "C": "GnRH-antagonist protocol.", "O": "Embryo euploidy rate; associated factors (age, BMI, etc.).", "D": "Single-center comparative study.", "S": "Admixed Brazilian cohort."},
    "findings": "<p>The study compared euploidy between PPOS and antagonist protocols and examined predictors, contributing data from an under-represented admixed population.</p>",
    "strengths": "<p>Population diversity (admixed Brazilian) plus a clinically relevant protocol comparison on a hard endpoint (euploidy).</p>",
    "applicability": "<p>Supports protocol choice (likely ploidy-neutral) and broadens the evidence base. Single-center; confirm before firm conclusions.</p>",
    "equity": "<p>Deliberately studies an under-represented admixed population — a genuine equity contribution.</p>",
    "prompts": "<ol><li>If PPOS is ploidy-neutral, does that tip you toward its convenience?</li><li>How valuable is diversifying ART evidence to admixed populations?</li><li>Which euploidy predictors here change your counseling?</li></ol>",
},

"42181183": {  # Assessment indicators of ovarian response during COS (abstract unavailable)
    "bottom": "Paper on assessment indicators of ovarian response during controlled ovarian stimulation (influencing factors and clinical value). The verbatim abstract wasn't captured in the source feed, so this is a title-level placeholder appraisal: it addresses how we measure and predict ovarian response — central to stimulation management — and should be read in full before weighting.",
    "question": "<p><strong>The clinical problem.</strong> Predicting and monitoring ovarian response guides stimulation dosing and cycle decisions; which indicators carry the most clinical value is an ongoing question.</p><p><strong>The question.</strong> What indicators best assess ovarian response during COS, and what influences them? (Abstract not available in the source feed.)</p>",
    "pico": {"P": "Patients undergoing controlled ovarian stimulation.", "I": "Ovarian-response assessment indicators.", "C": "Across indicators/factors.", "O": "Predictive/clinical value of response indicators (per title).", "D": "Not determinable from the captured record.", "S": "Not available."},
    "findings": "<p>Abstract unavailable in the source feed — findings cannot be appraised here. Title indicates an analysis of ovarian-response indicators and their clinical value; await full text.</p>",
    "strengths": "<p>Not assessable without the abstract; the topic (response prediction) is clinically central.</p>",
    "applicability": "<p>Cannot recommend without full text. Flagged so the source-feed gap is visible rather than silently filled.</p>",
    "equity": "<p>Not assessable from the captured record.</p>",
    "prompts": "<ol><li>Which ovarian-response indicators do you trust most in practice?</li><li>Should papers lacking a retrievable abstract appear in the digest?</li><li>What would the full text need to show to change your monitoring?</li></ol>",
},

"42180460": {  # LLM benchmark for fertility-preservation counseling in breast cancer
    "bottom": "Benchmark study evaluating four public large language models for reliability and readability of fertility-preservation counseling responses in breast-cancer scenarios. AI-in-clinical-communication content — relevant as these tools enter patient education, with the key caveats about reliability in high-stakes, sensitive decisions.",
    "question": "<p><strong>The clinical problem.</strong> Patients increasingly consult LLMs for sensitive decisions like fertility preservation during cancer; their reliability and readability there are unknown and consequential.</p><p><strong>The question.</strong> How reliable and readable are public LLMs for fertility-preservation counseling in breast cancer?</p>",
    "pico": {"P": "Fertility-preservation counseling scenarios in breast cancer.", "I": "Four publicly available LLMs.", "C": "Across models / against expert standards.", "O": "Reliability and readability of responses.", "D": "Benchmarking study.", "S": "Defined scenario set."},
    "findings": "<p>The study benchmarked LLM reliability and readability for fertility-preservation counseling, identifying where models are adequate and where they fall short for sensitive decision support.</p>",
    "strengths": "<p>Timely, structured evaluation of AI tools patients are already using, on a high-stakes topic.</p>",
    "applicability": "<p>Informs how (and whether) to point patients to LLMs for fertility-preservation questions, and the need for clinician oversight. Benchmarks date quickly as models change.</p>",
    "equity": "<p>Readability findings matter for health-literacy equity; model access and language coverage vary.</p>",
    "prompts": "<ol><li>Do you address patients' LLM use in fertility-preservation decisions?</li><li>What reliability threshold would make an LLM acceptable adjunct counseling?</li><li>How do you mitigate AI misinformation in sensitive oncofertility decisions?</li></ol>",
},

# ===================== MENOPAUSE / MHT (menopause is a systems transition) =====================

"42213691": {  # BMI trajectories & gastric-cancer risk, effect modification by menopausal status (abstract unavailable)
    "bottom": "Korean cohort on BMI-change trajectories and gastric-cancer risk, with effect modification by sex, age, smoking, and menopausal status. The verbatim abstract wasn't captured in the source feed; at title level it sits in the menopause group only via the <em>menopausal-status effect-modification</em> and metabolic-trajectory angle. The endpoint is gastric cancer, so the menopause relevance is the systems/metabolic framing, not management. Loosest fit in this group.",
    "question": "<p><strong>The clinical problem.</strong> Body-weight trajectories interact with sex hormones and cancer risk; whether menopausal status modifies the BMI–gastric-cancer relationship speaks to metabolic-systems differences across the transition.</p><p><strong>The question.</strong> Do BMI-change trajectories predict gastric-cancer risk, and does menopausal status modify the effect? (Abstract not available in the source feed.)</p>",
    "pico": {"P": "Korean adults ≥40 (sex/menopausal-status strata).", "I": "BMI-change-trajectory characterization.", "C": "Across trajectory groups and menopausal status.", "O": "Gastric-cancer risk.", "D": "Cohort study (full record not captured).", "S": "Large Korean cohort."},
    "findings": "<p>Abstract unavailable in the source feed — findings cannot be appraised here. Title indicates effect modification of the BMI-trajectory/gastric-cancer link by menopausal status; await full text.</p>",
    "strengths": "<p>Not assessable without the abstract; large-cohort effect-modification design is the apparent strength.</p>",
    "applicability": "<p>Endpoint (gastric cancer) is outside CBG/MIGS; relevance is only the menopausal-status metabolic-modification framing. Reasonable to keep as systems-metabolic context or trim as out-of-scope.</p>",
    "equity": "<p>Korean-adult cohort; menopausal-status stratification is the equity-adjacent feature, but cancer endpoint limits gyn relevance.</p>",
    "prompts": "<ol><li>Does menopausal-status effect-modification of metabolic-cancer risk belong in a CBG/MIGS digest?</li><li>How would the systems-metabolic framing change anything you do?</li><li>Keep for metabolic-transition context, or cut as out-of-scope?</li></ol>",
},

"42208510": {  # Cancer risk & screening in TGD individuals on GAHT — review (Australasia)
    "bottom": "Review synthesizing cancer risk and evidence-based screening for transgender and gender-diverse individuals on gender-affirming hormone therapy. Genuinely within gyn/menopause-adjacent hormone care — GAHT modifies hormone-sensitive-cancer risk and screening needs, and CBG/MIGS surgeons care for TGD patients. Practical screening guidance.",
    "question": "<p><strong>The clinical problem.</strong> GAHT alters hormone-sensitive tissue and cancer risk, but screening guidance for TGD patients is fragmented, risking both over- and under-screening.</p><p><strong>The question.</strong> What is the association between GAHT and cancer risk, and what cancer-screening recommendations follow for TGD individuals?</p>",
    "pico": {"P": "Transgender and gender-diverse individuals on GAHT.", "I": "Review of GAHT–cancer-risk evidence and screening.", "C": "Across tissue/cancer types.", "O": "Cancer-risk synthesis and screening recommendations.", "D": "Narrative review (Australasian context).", "S": "Not applicable."},
    "findings": "<p>The review synthesized GAHT–cancer-risk evidence and offered evidence-based screening recommendations tailored to TGD patients for primary-care/specialist use.</p>",
    "strengths": "<p>Practical, equity-forward screening guidance for an under-served population whose hormone-sensitive-tissue risks are often mishandled.</p>",
    "applicability": "<p>Useful for organ-inventory-based screening and counseling in TGD patients you care for. Region-specific (Australasia) and narrative; adapt to local guidelines.</p>",
    "equity": "<p>Centers a marginalized, under-studied population — strong equity value; evidence base is thin, so recommendations are consensus-level.</p>",
    "prompts": "<ol><li>Do you screen TGD patients by organ inventory rather than gender marker?</li><li>How does GAHT change your hormone-sensitive-cancer counseling?</li><li>Where is the GAHT–cancer evidence weakest?</li></ol>",
},

"42207323": {  # ADHD across female reproductive stages
    "bottom": "Study showing women with ADHD have significantly higher menstrual irregularity, premenstrual symptom severity, postpartum depression, unplanned-pregnancy/complication risk, and menopausal symptom severity than non-ADHD peers. A striking neuro-reproductive-systems signal — ADHD intersects every reproductive stage, with real implications for screening and counseling.",
    "question": "<p><strong>The clinical problem.</strong> ADHD is under-recognized in women and may interact with hormonal transitions, but its associations across menstruation, perinatal period, and menopause are poorly mapped.</p><p><strong>The question.</strong> How does ADHD associate with reproductive-stage outcomes (menstrual, premenstrual, postpartum, menopausal)?</p>",
    "pico": {"P": "Women with ADHD vs without.", "I": "ADHD status (exposure).", "C": "Non-ADHD women.", "O": "Menstrual irregularity, premenstrual/postpartum/menopausal symptom severity, pregnancy outcomes.", "D": "Comparative study.", "S": "ADHD vs control cohort."},
    "findings": "<p>Women with ADHD had significantly more menstrual irregularity, severe premenstrual symptoms, higher postpartum depression, more unplanned pregnancies/complications, and greater menopausal symptom severity.</p>",
    "strengths": "<p>Spans the full reproductive lifespan with sizable effect sizes; surfaces a neglected neuro-reproductive intersection.</p>",
    "applicability": "<p>Supports asking about ADHD in women with disproportionate cyclical/perinatal/menopausal symptoms and contraceptive counseling (unplanned-pregnancy risk). Associational; don't infer causation.</p>",
    "equity": "<p>ADHD is historically under-diagnosed in women — this addresses a recognition gap; check sample representativeness.</p>",
    "prompts": "<ol><li>Do you consider ADHD when symptoms across reproductive stages seem disproportionate?</li><li>How does the unplanned-pregnancy signal change contraceptive counseling?</li><li>Is the link hormonal, behavioral, or both?</li></ol>",
},

"42204934": {  # TRT + exercise body composition in hypogonadal men
    "bottom": "RCT-type study of testosterone replacement plus exercise on body composition in hypogonadal MEN. Out-of-field by population (men's health), included under 'menopause is a systems transition' as <em>androgen-therapy + exercise body-composition mechanism</em> — relevant by analogy to the testosterone-for-women and exercise-in-menopause conversations, but the subjects are men. Indirect; the mechanism, not the population, is the thread.",
    "question": "<p><strong>The clinical problem.</strong> Androgen therapy and exercise both affect body composition; the systems-menopause frame (testosterone as one lever among many) borrows mechanistic insight from androgen-therapy studies — though this one is in men.</p><p><strong>The question.</strong> Does TRT combined with exercise improve body composition in hypogonadal men?</p>",
    "pico": {"P": "Hypogonadal men.", "I": "Testosterone replacement therapy + exercise.", "C": "TRT or exercise alone / control.", "O": "Body-composition outcomes.", "D": "Interventional study (men's health).", "S": "Hypogonadal-men cohort."},
    "findings": "<p>The study assessed combined TRT-plus-exercise effects on body composition in hypogonadal men, characterizing the additive androgen-plus-exercise effect.</p>",
    "strengths": "<p>Tests the androgen-plus-exercise interaction with body-composition endpoints.</p>",
    "applicability": "<p>Indirect for women's menopause care — subjects are men. Conceptual analogy to testosterone-for-women and exercise-in-menopause only; do not transfer dosing/effects across sexes. Weak fit.</p>",
    "equity": "<p>Male population; no direct women's-health generalization.</p>",
    "prompts": "<ol><li>Does male androgen-plus-exercise mechanism inform the testosterone-for-women debate at all?</li><li>Is a men's-health study a defensible inclusion under a menopause thesis?</li><li>Keep for mechanistic analogy, or cut?</li></ol>",
},

"42202138": {  # Normal-weight obesity across the female lifespan — musculoskeletal/metabolic
    "bottom": "Review of 'normal-weight obesity' (normal BMI but high body-fat/low muscle) and its musculoskeletal and metabolic consequences across the female lifespan. Directly supports 'menopause is a systems transition' and 'beyond BMI' thinking — body composition, not BMI, drives midlife metabolic and musculoskeletal risk in women.",
    "question": "<p><strong>The clinical problem.</strong> BMI misses body-composition risk; 'normal-weight obesity' carries metabolic and musculoskeletal consequences that compound across the female lifespan, especially through menopause.</p><p><strong>The question.</strong> What are the musculoskeletal and metabolic consequences of normal-weight obesity across the female lifespan?</p>",
    "pico": {"P": "Women across the lifespan (body-composition focus).", "I": "Review of normal-weight-obesity consequences.", "C": "Normal vs adverse body composition at equal BMI.", "O": "Musculoskeletal and metabolic outcomes.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesizes how normal-weight obesity (adverse body composition at normal BMI) drives musculoskeletal and metabolic risk across women's life stages, including the menopausal transition.</p>",
    "strengths": "<p>'Beyond BMI' framing aligns with body-composition-based risk and the systems-menopause thesis; lifespan scope.</p>",
    "applicability": "<p>Supports looking past BMI to body composition (muscle/fat) in midlife women's risk assessment and counseling. Narrative — weight specific claims by their primary evidence.</p>",
    "equity": "<p>Body-composition norms vary by ancestry; BMI's limits are themselves an equity issue.</p>",
    "prompts": "<ol><li>Do you assess body composition beyond BMI in midlife women?</li><li>How does normal-weight obesity change your metabolic/musculoskeletal counseling?</li><li>What practical tools capture this in clinic?</li></ol>",
},

"42201899": {  # Climacteric symptoms among working HRT never-users — cross-sectional
    "bottom": "Cross-sectional study of climacteric symptom occurrence/severity among full-time working women who never used HRT, across work environments. Illuminates the large, under-studied untreated-menopause population and the workplace dimension — squarely the systems/whole-person menopause thesis and an access/equity angle.",
    "question": "<p><strong>The clinical problem.</strong> Most menopausal women don't use HRT, yet their symptom burden — and how work environment shapes it — is poorly characterized, hiding a large untreated, working population.</p><p><strong>The question.</strong> How do full-time working HRT never-users experience climacteric symptoms across work environments?</p>",
    "pico": {"P": "Full-time working women, HRT never-users.", "I": "Assessment of climacteric symptoms across work environments.", "C": "Across work-environment types.", "O": "Symptom occurrence and severity.", "D": "Cross-sectional study.", "S": "Working-women cohort."},
    "findings": "<p>The study characterized symptom occurrence/severity in untreated working women and how it varied by work environment, surfacing a large under-treated group.</p>",
    "strengths": "<p>Focuses on the under-studied untreated majority and the workplace context — relevant to real-world menopause burden.</p>",
    "applicability": "<p>Supports proactively asking about menopausal symptoms and workplace impact in women not on HRT. Cross-sectional; associational.</p>",
    "equity": "<p>Work-environment lens adds an occupational-equity dimension to menopause care.</p>",
    "prompts": "<ol><li>Do you ask untreated women about symptom burden and work impact?</li><li>How might work environment modify menopausal experience?</li><li>What's the unmet-treatment gap in your practice?</li></ol>",
},

"42198958": {  # ML model for coronary-heart-disease risk in postmenopausal women — dual-center
    "bottom": "Dual-center study developing/validating a machine-learning model for coronary-heart-disease risk in postmenopausal women. Directly on the 'menopause is a systems transition' thesis — cardiovascular risk rises after menopause, and a tailored risk model could sharpen prevention. ML tools need external validation before standalone use.",
    "question": "<p><strong>The clinical problem.</strong> CHD risk accelerates after menopause, but general risk calculators may under-serve postmenopausal women; a tailored model could improve prevention targeting.</p><p><strong>The question.</strong> Can a machine-learning model assess CHD risk in postmenopausal women?</p>",
    "pico": {"P": "Postmenopausal women.", "I": "Machine-learning CHD-risk model.", "C": "Conventional risk assessment.", "O": "CHD-risk prediction (development + validation).", "D": "Dual-center retrospective study.", "S": "Postmenopausal cohort."},
    "findings": "<p>The study identified CHD risk factors and developed/validated an ML risk model specific to postmenopausal women across two centers.</p>",
    "strengths": "<p>Menopause-specific CV-risk modeling with internal validation across two centers; addresses a real prevention gap.</p>",
    "applicability": "<p>Reinforces post-menopausal CV-risk vigilance; the model itself needs external/prospective validation before clinical use. Treat as supportive, not standalone.</p>",
    "equity": "<p>Dual-center; ML models risk encoding population bias — validate before broad use.</p>",
    "prompts": "<ol><li>Do your CV-risk tools account for menopausal-status-specific risk?</li><li>What validation would let you trust an ML CHD model?</li><li>How do you act on a 'high CV risk' menopause flag?</li></ol>",
},

"42196982": {  # Iron biomarkers heterogeneity by age/sex/menopausal status/race — All of Us
    "bottom": "Large cross-sectional analysis (All of Us program) of how iron biomarkers vary by age, sex, menopausal status, and race in healthy US adults. Supports the systems-transition thesis — menopause shifts iron physiology (cessation of menstrual loss) — and flags that 'normal' iron ranges aren't one-size-fits-all across menopausal status and race.",
    "question": "<p><strong>The clinical problem.</strong> Iron-biomarker reference ranges are often applied uniformly, but physiology differs by sex, menopausal status (menstrual iron loss ceases), and race — risking misclassification.</p><p><strong>The question.</strong> How heterogeneous are iron biomarkers by age, sex, menopausal status, and race in healthy US adults?</p>",
    "pico": {"P": "Healthy US adults (All of Us Research Program).", "I": "Iron-biomarker measurement across strata.", "C": "Across age/sex/menopausal-status/race groups.", "O": "Population heterogeneity in iron biomarkers.", "D": "Cross-sectional analysis.", "S": "Large diverse US cohort."},
    "findings": "<p>The analysis quantified substantial iron-biomarker heterogeneity by age, sex, menopausal status, and race, challenging uniform reference ranges.</p>",
    "strengths": "<p>Large, diverse cohort with explicit menopausal-status and race stratification — directly relevant to interpreting iron studies in women.</p>",
    "applicability": "<p>Supports interpreting iron biomarkers with menopausal status and demographics in mind (e.g., post-menopausal iron shifts). Reference-range refinement, not a management protocol.</p>",
    "equity": "<p>Race-stratified analysis in a diverse cohort — a genuine equity contribution to lab-reference fairness.</p>",
    "prompts": "<ol><li>Do you adjust iron-study interpretation by menopausal status?</li><li>Should reference ranges be demographically stratified?</li><li>How does post-menopausal iron retention change your workups?</li></ol>",
},

"42196743": {  # Delays in seeking care for postmenopausal bleeding among Black women — disparities
    "bottom": "Study of cultural, societal, and behavioral contributors to delays in evaluating postmenopausal bleeding among disaggregated populations of Black women — PMB being the key endometrial-cancer symptom, and delay a driver of outcome disparities. Directly relevant equity research on a symptom every gyn must act on promptly.",
    "question": "<p><strong>The clinical problem.</strong> Endometrial-cancer outcomes differ among Black women by nativity, and delayed PMB evaluation may drive disparities; understanding why patients delay is essential to closing the gap.</p><p><strong>The question.</strong> What cultural, societal, and behavioral factors contribute to PMB-evaluation delays among disaggregated Black-women populations?</p>",
    "pico": {"P": "Disaggregated populations of Black women with postmenopausal bleeding.", "I": "Qualitative/mixed exploration of delay contributors.", "C": "Across nativity/subgroups.", "O": "Drivers of care-seeking delay.", "D": "Disparities/qualitative study.", "S": "Black-women participants (disaggregated)."},
    "findings": "<p>The study identified cultural, societal, and behavioral contributors to PMB-evaluation delay, disaggregating Black women rather than treating them as monolithic.</p>",
    "strengths": "<p>Disaggregation (by nativity/subgroup) and focus on a high-stakes symptom; directly targets an outcome-disparity mechanism.</p>",
    "applicability": "<p>Informs outreach, counseling, and access design to expedite PMB evaluation in affected populations — actionable for closing endometrial-cancer disparities. Qualitative themes, not statistics.</p>",
    "equity": "<p>This is the equity centerpiece of the group — disparities in endometrial-cancer evaluation among Black women, disaggregated.</p>",
    "prompts": "<ol><li>How do you reduce PMB-evaluation delays in your highest-risk populations?</li><li>What does disaggregation reveal that 'Black women' as a monolith hides?</li><li>Which system barriers can you actually change?</li></ol>",
},

"42196423": {  # Pathway-level genetic reorganization of low BMD across menopausal transition
    "bottom": "Genetic study showing pathway-level reorganization of signals associated with low bone mineral density across the menopausal transition — the genetic architecture of bone loss shifts as women move through menopause. Mechanistic support for menopause-as-systems-transition (bone), explaining why peri/postmenopause is the critical bone-loss window. Genomic/conceptual.",
    "question": "<p><strong>The clinical problem.</strong> Bone loss accelerates around menopause; whether the genetic determinants of low BMD themselves reorganize across the transition would reframe when and whom to target for prevention.</p><p><strong>The question.</strong> Does the pathway-level genetic architecture of low BMD reorganize across the menopausal transition?</p>",
    "pico": {"P": "Women across the menopausal transition (genetic-association scope).", "I": "Pathway-level genetic-signal analysis for low BMD.", "C": "Across menopausal stages.", "O": "Reorganization of BMD-associated genetic pathways.", "D": "Genetic-association/pathway study.", "S": "Genotyped cohort."},
    "findings": "<p>The study found pathway-level reorganization of BMD-associated genetic signals across the menopausal transition, indicating stage-dependent genetic architecture of bone loss.</p>",
    "strengths": "<p>Adds a genomic, stage-dynamic dimension to menopausal bone loss — mechanistically supports the transition framing.</p>",
    "applicability": "<p>Conceptual — reinforces the peri/postmenopausal window as critical for bone-health intervention. No genetic test to deploy. Background mechanism.</p>",
    "equity": "<p>GWAS-type data skews European-ancestry; portability across ancestries uncertain.</p>",
    "prompts": "<ol><li>Does stage-dependent genetic architecture sharpen when you intervene on bone health?</li><li>Could it ever yield a stage-specific risk test?</li><li>How does ancestry skew limit the findings?</li></ol>",
},

"42192589": {  # Sleep parameters & sexual quality of life in postmenopausal women
    "bottom": "Study of associations between sleep quality and sexual quality of life in postmenopausal women — two commonly siloed midlife complaints that the systems thesis links. Supports addressing sleep as part of sexual-health and menopause care. Cross-sectional association.",
    "question": "<p><strong>The clinical problem.</strong> Menopause impairs both sleep and sexual quality of life, but they're managed separately; if they're linked, addressing sleep could improve sexual health (and vice versa).</p><p><strong>The question.</strong> Are sleep parameters associated with sexual quality of life in postmenopausal women?</p>",
    "pico": {"P": "Postmenopausal women.", "I": "Assessment of sleep quality.", "C": "Across sleep-quality levels.", "O": "Sexual quality of life.", "D": "Cross-sectional association study.", "S": "Postmenopausal cohort."},
    "findings": "<p>The study related sleep quality to sexual quality of life in postmenopausal women, supporting an integrated view of these midlife complaints.</p>",
    "strengths": "<p>Connects two siloed, common menopausal complaints — aligned with whole-person care.</p>",
    "applicability": "<p>Supports asking about sleep when addressing sexual health (and vice versa) in menopausal women. Cross-sectional; association, not causation.</p>",
    "equity": "<p>Single-cohort; generalize cautiously.</p>",
    "prompts": "<ol><li>Do you address sleep when managing menopausal sexual concerns?</li><li>Which direction is the causal arrow likely to run?</li><li>Could a single intervention improve both domains?</li></ol>",
},

"42187601": {  # Endometrial cancer/hyperplasia clustering in HRT users with unscheduled bleeding — NHS cohort
    "bottom": "Retrospective NHS cohort on the temporal clustering of endometrial cancer and hyperplasia among HRT users presenting with unscheduled bleeding — directly practice-changing: it sharpens how urgently and how to work up unscheduled bleeding on HRT, a common and sometimes under-triaged presentation.",
    "question": "<p><strong>The clinical problem.</strong> Unscheduled bleeding on HRT is common and usually benign, but a subset harbors hyperplasia/cancer; knowing the temporal risk pattern guides triage and workup urgency.</p><p><strong>The question.</strong> How do endometrial cancer and hyperplasia cluster temporally among HRT users with unscheduled bleeding?</p>",
    "pico": {"P": "Postmenopausal HRT users with unscheduled bleeding.", "I": "Characterization of endometrial-cancer/hyperplasia timing.", "C": "Across time from bleeding onset / HRT duration.", "O": "Temporal clustering of cancer/hyperplasia.", "D": "Retrospective NHS cohort.", "S": "NHS HRT-user cohort."},
    "findings": "<p>The cohort characterized when endometrial cancer/hyperplasia cluster relative to unscheduled bleeding in HRT users, informing triage urgency and investigation thresholds.</p>",
    "strengths": "<p>Large NHS real-world cohort addressing a common, sometimes under-triaged presentation with direct workup implications.</p>",
    "applicability": "<p>Directly informs your threshold and timing for investigating unscheduled HRT bleeding (TVUS/biopsy). Retrospective; integrate with guideline pathways.</p>",
    "equity": "<p>NHS cohort; access to timely investigation is the equity factor in acting on bleeding.</p>",
    "prompts": "<ol><li>Does the temporal-risk pattern change your workup urgency for unscheduled HRT bleeding?</li><li>What's your threshold for biopsy vs surveillance?</li><li>How do you avoid both under- and over-investigation?</li></ol>",
},

"42181196": {  # Dydrogesterone monotherapy vs E2/DYD combination in perimenopause — real-world cohort
    "bottom": "Real-world cohort comparing 12-week effectiveness/safety of dydrogesterone monotherapy versus estradiol-dydrogesterone combination for perimenopausal symptoms. Practical menopause-prescribing data — when progestogen alone suffices versus when estrogen is needed for symptom control.",
    "question": "<p><strong>The clinical problem.</strong> Perimenopausal symptom management must balance estrogen's efficacy against when a progestogen alone suffices; real-world comparative data guide tailored prescribing.</p><p><strong>The question.</strong> How does dydrogesterone monotherapy compare with estradiol-dydrogesterone combination for perimenopausal symptoms over 12 weeks?</p>",
    "pico": {"P": "Perimenopausal women with symptoms.", "I": "Dydrogesterone monotherapy.", "C": "Estradiol-dydrogesterone combination therapy.", "O": "12-week effectiveness and safety.", "D": "Real-world cohort study.", "S": "Perimenopausal cohort."},
    "findings": "<p>The study compared symptom control and safety between progestogen monotherapy and estrogen-progestogen combination, clarifying when each is appropriate in perimenopause.</p>",
    "strengths": "<p>Real-world, head-to-head, with both effectiveness and safety endpoints relevant to everyday prescribing.</p>",
    "applicability": "<p>Informs tailored perimenopausal prescribing (when progestogen alone vs adding estrogen). Real-world/observational; confirm against RCT guidance.</p>",
    "equity": "<p>Cohort-specific; generalize prescribing cautiously.</p>",
    "prompts": "<ol><li>When do you use progestogen alone vs estrogen-progestogen in perimenopause?</li><li>Does this change your first-line choice for specific symptom clusters?</li><li>How do safety signals weigh in your decision?</li></ol>",
},

"42178881": {  # Depression in women across the lifespan — hormonal insights from brain imaging
    "bottom": "Review using brain imaging to connect hormonal transitions (puberty, perinatal, perimenopause, aging) to women's higher depression risk. Supports the neuro-endocrine systems thesis — depression in women is partly a hormone-brain phenomenon across reproductive stages. Conceptual/mechanistic background for menopausal mood care.",
    "question": "<p><strong>The clinical problem.</strong> Women have substantially higher depression incidence, clustering around hormonal transitions; neuroimaging may clarify the hormone-brain mechanisms to inform stage-specific care.</p><p><strong>The question.</strong> What do brain-imaging studies reveal about hormonal contributions to depression in women across the lifespan?</p>",
    "pico": {"P": "Women across reproductive life stages (imaging/conceptual).", "I": "Review of neuroimaging-hormone-depression links.", "C": "Across life stages/hormonal states.", "O": "Mechanistic synthesis of hormone-brain depression links.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review synthesizes imaging evidence connecting hormonal transitions to depression risk across adolescence, the perinatal period, perimenopause, and aging.</p>",
    "strengths": "<p>Integrates neuroimaging with reproductive-stage hormone biology — supports the systems framing of menopausal mood.</p>",
    "applicability": "<p>Reinforces attending to mood across hormonal transitions (esp. perimenopause) and the hormone-brain rationale; conceptual, not a specific therapy. Narrative review.</p>",
    "equity": "<p>Review; no population. Women's mental-health under-recognition is the implicit equity theme.</p>",
    "prompts": "<ol><li>Do you screen for mood symptoms across hormonal transitions, especially perimenopause?</li><li>Does the hormone-brain framing change how you counsel perimenopausal depression?</li><li>Where does MHT fit menopausal mood management?</li></ol>",
},

# ===================== PCOS (endocrine + HPA + neuro-immune integration) =====================

"42219828": {  # Subclinical hypothyroidism in PCOS — cross-sectional, molecular
    "bottom": "Cross-sectional study of how subclinical hypothyroidism affects hormonal/metabolic parameters and TSH/androgen-receptor/POMC gene expression in PCOS women (three groups, n=105). Directly supports the endocrine + HPA + neuro-immune thesis — thyroid–reproductive–metabolic crosstalk in PCOS, with a molecular layer.",
    "question": "<p><strong>The clinical problem.</strong> Subclinical hypothyroidism co-occurs with PCOS and may worsen its metabolic/reproductive phenotype, but the molecular interplay (TSH, AR, POMC) is poorly defined.</p><p><strong>The question.</strong> How does subclinical hypothyroidism influence hormonal, metabolic, and gene-expression patterns in PCOS?</p>",
    "pico": {"P": "Women 20–40 with PCOS (normal thyroid n=35; PCOS+SCH n=35; healthy n=35).", "I": "Subclinical-hypothyroidism status.", "C": "PCOS with normal thyroid; healthy women.", "O": "Hormonal/metabolic parameters; TSH/AR/POMC expression.", "D": "Cross-sectional observational study.", "S": "n=105 across three groups."},
    "findings": "<p>The study compared hormonal/metabolic profiles and TSH/AR/POMC expression across PCOS±SCH and controls, characterizing how SCH layers onto the PCOS phenotype molecularly.</p>",
    "strengths": "<p>Three-group design with a molecular dimension links a common comorbidity to mechanism.</p>",
    "applicability": "<p>Supports checking thyroid function in PCOS and appreciating SCH's metabolic contribution. Cross-sectional and small; associations are hypothesis-generating.</p>",
    "equity": "<p>Single-center (Pakistan); modest n limits subgroup generalization.</p>",
    "prompts": "<ol><li>Do you screen/treat SCH in PCOS, and at what TSH threshold?</li><li>Does the AR/POMC signal add anything actionable yet?</li><li>How does thyroid status modify your PCOS metabolic counseling?</li></ol>",
},

"42213411": {  # Increased mortality in PCOS — cohort study
    "bottom": "Sobering cohort (median 12-year follow-up): women with PCOS had higher overall mortality (adjusted HR 1.33) than controls even after adjusting for education, obesity, T2DM, and hypertension, with excess deaths from neoplasms and circulatory disease. Reframes PCOS as a lifelong systemic-risk condition, not just a fertility/cosmetic issue — strong support for long-term cardiometabolic and cancer vigilance.",
    "question": "<p><strong>The clinical problem.</strong> PCOS is often framed around fertility and hyperandrogenism, but its long-term mortality consequences — and whether they exceed what obesity/diabetes/hypertension explain — determine how aggressively to pursue lifelong risk reduction.</p><p><strong>The question.</strong> Is PCOS associated with increased mortality independent of obesity, T2DM, and hypertension?</p>",
    "pico": {"P": "Women with PCOS (n=9,839) vs controls (n=28,238).", "I": "PCOS diagnosis (exposure).", "C": "Non-PCOS controls.", "O": "Overall and cause-specific mortality.", "D": "Cohort study (median 12-year follow-up).", "S": "~38,000 women."},
    "findings": "<p>PCOS mortality was 2.02% vs 1.43% in controls; adjusted overall mortality HR 1.33, with excess neoplasm (HR 1.39) and circulatory-disease deaths persisting after adjustment for education, obesity, T2DM, and hypertension.</p>",
    "strengths": "<p>Large cohort, long follow-up, hard endpoint (mortality), and adjustment for the obvious metabolic confounders — the independent signal is striking.</p>",
    "applicability": "<p>Strongly supports lifelong cardiometabolic and cancer-risk vigilance in PCOS, reframing counseling beyond fertility. Observational; residual confounding remains, but the direction is compelling.</p>",
    "equity": "<p>Adjusted for education (an SES proxy); generalizability depends on the source population's makeup.</p>",
    "prompts": "<ol><li>Does an independent mortality signal change how you frame PCOS long-term to patients?</li><li>What lifelong screening (cardiac, metabolic, endometrial) does this justify?</li><li>How do you communicate mortality risk without alarmism?</li></ol>",
},

"42213202": {  # Normal serum androgen levels in healthy Indian adolescent girls by LC-MS/MS
    "bottom": "Normative study establishing serum-androgen reference ranges (by LC-MS/MS, the gold standard) in healthy Indian adolescent girls — addressing a real gap, since adolescent PCOS diagnosis hinges on hyperandrogenism but population/assay-specific cut-offs are lacking. Foundational data that improves diagnostic accuracy and reduces over-diagnosis.",
    "question": "<p><strong>The clinical problem.</strong> Adolescent PCOS is over- and under-diagnosed partly because 'normal' androgen cut-offs are ill-defined and assay/population-dependent; physiologic adolescent ranges by gold-standard assay are needed.</p><p><strong>The question.</strong> What are normal serum-androgen levels in healthy Indian adolescent girls by LC-MS/MS, and how do they relate to cycle phase and body parameters?</p>",
    "pico": {"P": "Healthy Indian adolescent school-going girls.", "I": "Serum androgens by LC-MS/MS (DHEAS by immunoassay).", "C": "Across cycle phase / body parameters.", "O": "Normative androgen reference ranges.", "D": "Normative cross-sectional study.", "S": "Adolescent-girl cohort."},
    "findings": "<p>The study established LC-MS/MS androgen reference ranges in healthy Indian adolescents and related them to menstrual-cycle phase and body parameters, filling a normative-data gap.</p>",
    "strengths": "<p>Gold-standard assay (LC-MS/MS) and an under-served population — directly improves adolescent-PCOS diagnostic accuracy.</p>",
    "applicability": "<p>Supports using population/assay-appropriate androgen cut-offs in adolescent-PCOS evaluation to avoid mislabeling normal puberty. Population-specific norms; use the right reference for your population/assay.</p>",
    "equity": "<p>Generates normative data for an under-represented population — a genuine equity contribution to diagnostic fairness.</p>",
    "prompts": "<ol><li>Do you use assay- and population-appropriate androgen cut-offs in adolescents?</li><li>How does over-diagnosis of adolescent PCOS harm patients?</li><li>Why does LC-MS/MS matter over immunoassay for androgens?</li></ol>",
},

"42204813": {  # Early-life ambient-temperature exposure & PCOS — nationwide cohort
    "bottom": "Nationwide cohort testing whether early-life ambient-temperature exposure (during sensitive developmental windows like oogenesis) associates with later PCOS. An environmental/developmental-origins angle on PCOS — supports the systems view that ovulation disorders have early-life environmental inputs. Novel and hypothesis-generating.",
    "question": "<p><strong>The clinical problem.</strong> PCOS etiology spans genetic and environmental factors; developmental-origins exposures like early-life temperature could imprint ovarian function, but evidence is absent.</p><p><strong>The question.</strong> Does early-life ambient-temperature exposure associate with later PCOS?</p>",
    "pico": {"P": "Individuals with early-life temperature-exposure data (nationwide cohort).", "I": "Early-life ambient-temperature exposure.", "C": "Across exposure levels/windows.", "O": "Later PCOS/ovulation disorders.", "D": "Nationwide cohort study.", "S": "Population cohort."},
    "findings": "<p>The cohort examined whether early-life temperature exposure during sensitive windows associates with later PCOS, introducing a developmental-environmental dimension to ovulation-disorder risk.</p>",
    "strengths": "<p>Novel developmental-origins/environmental hypothesis at population scale; expands the systems-etiology frame.</p>",
    "applicability": "<p>Conceptual/etiologic — no clinical action, and exposure isn't modifiable retrospectively. Of interest for understanding PCOS origins and environmental-health advocacy. Associational.</p>",
    "equity": "<p>Climate/temperature exposure tracks with geography and socioeconomics — an environmental-justice dimension.</p>",
    "prompts": "<ol><li>Does a developmental-origins view change how you conceptualize PCOS etiology?</li><li>Is there any actionable message, or is this purely etiologic?</li><li>How seriously should environmental exposures be taken in PCOS research?</li></ol>",
},

"42193977": {  # Modern PCOS management: intelligent drug delivery & metabolic reprogramming — review
    "bottom": "Review surveying emerging PCOS management — 'intelligent' drug-delivery systems and metabolic-reprogramming approaches for ovarian restoration and fertility. Forward-looking synthesis aligned with the endocrine-metabolic systems thesis; mostly horizon-scanning, not current practice.",
    "question": "<p><strong>The clinical problem.</strong> PCOS is a complex endocrine-metabolic disorder with imperfect therapies; targeted drug delivery and metabolic-reprogramming strategies are emerging but unproven.</p><p><strong>The question.</strong> What do modern intelligent-drug-delivery and metabolic-reprogramming approaches offer for PCOS management?</p>",
    "pico": {"P": "PCOS (management-focused review).", "I": "Review of intelligent drug delivery + metabolic reprogramming.", "C": "Conventional PCOS management.", "O": "Prospects for ovarian restoration/fertility.", "D": "Narrative review.", "S": "Not applicable."},
    "findings": "<p>The review surveys nanotech/targeted-delivery and metabolic-reprogramming strategies aimed at ovarian restoration and fertility in PCOS, framing the future pipeline.</p>",
    "strengths": "<p>Horizon-scan integrating delivery technology with PCOS metabolic biology.</p>",
    "applicability": "<p>Mostly future-facing — little changes current management. Useful for situational awareness of the PCOS pipeline. Don't over-promise emerging tech.</p>",
    "equity": "<p>Review; advanced therapeutics, if realized, raise access-equity questions.</p>",
    "prompts": "<ol><li>Which emerging PCOS approach is closest to clinical reality?</li><li>How do you temper patient expectations about 'metabolic reprogramming'?</li><li>What current management does the evidence actually support?</li></ol>",
},

"42188320": {  # Algae-derived bioactives & the gut-SIRT1-kisspeptin axis in PCOS
    "bottom": "Pre-clinical study: algae-derived bioactives reprogrammed a gut–SIRT1–kisspeptin axis in PCOS models. A neat integration of gut, metabolic-sensing (SIRT1), and reproductive-neuroendocrine (kisspeptin) signaling — textbook endocrine + neuro-immune systems thesis. Bench-level; one more 'natural bioactive' candidate, not clinical.",
    "question": "<p><strong>The clinical problem.</strong> PCOS integrates gut, metabolic, and neuroendocrine dysregulation; interventions hitting that axis (e.g., gut-SIRT1-kisspeptin) could address root mechanisms rather than symptoms.</p><p><strong>The question.</strong> Do algae-derived bioactives reprogram the gut-SIRT1-kisspeptin axis in PCOS?</p>",
    "pico": {"P": "PCOS models.", "I": "Algae-derived bioactive compounds.", "C": "Untreated PCOS models.", "O": "Gut-SIRT1-kisspeptin-axis modulation and PCOS phenotype.", "D": "Pre-clinical mechanistic study.", "S": "Experimental."},
    "findings": "<p>Algae-derived bioactives reprogrammed the gut-SIRT1-kisspeptin axis, improving PCOS-related parameters in models — linking gut/metabolic sensing to reproductive neuroendocrine control.</p>",
    "strengths": "<p>Mechanistically integrative (gut–metabolic–neuroendocrine), the systems thesis in miniature.</p>",
    "applicability": "<p>Pre-clinical only — no clinical use; one more natural-bioactive candidate to track. Don't endorse algae supplements off model data.</p>",
    "equity": "<p>Bench study; no population.</p>",
    "prompts": "<ol><li>Does the gut-SIRT1-kisspeptin axis offer a credible PCOS target?</li><li>How do you handle patient interest in 'natural bioactives' with only bench data?</li><li>What would move this toward a trial?</li></ol>",
},

"42181197": {  # Hyperinsulinemic hypoglycemia from INSR variants — endocrine genetics
    "bottom": "Endocrine-genetics study characterizing hyperinsulinemic hypoglycemia and insulin-resistance syndromes from INSR (insulin-receptor) variants (HHF5, type A insulin resistance, Rabson-Mendenhall, Donohue). Out-of-field by primary focus, but genuinely connected to the PCOS thesis via <em>insulin-receptor biology</em> — severe INSR variants are the monogenic extreme of the insulin-resistance spectrum that drives PCOS. Indirect, mechanistic.",
    "question": "<p><strong>The clinical problem.</strong> Insulin resistance is central to PCOS; the monogenic INSR-variant syndromes define the severe end of insulin-receptor dysfunction and illuminate the receptor biology underlying milder, common insulin resistance.</p><p><strong>The question.</strong> What is the metabolic, phenotypic, and genotypic spectrum of pathogenic INSR variants?</p>",
    "pico": {"P": "Individuals with pathogenic INSR variants (HHF5/TAIRS/RMS/DS).", "I": "Genotype-phenotype-metabolic characterization.", "C": "Across variant types/inheritance.", "O": "Metabolic signature, phenotypic overlap, inheritance pattern.", "D": "Genetic case-characterization study.", "S": "INSR-variant cases."},
    "findings": "<p>The study characterized the metabolic signature, phenotypic overlap, and semidominant inheritance of INSR-variant disorders, mapping the severe monogenic end of insulin-receptor dysfunction.</p>",
    "strengths": "<p>Detailed genotype-phenotype mapping of insulin-receptor biology relevant, by extension, to the insulin-resistance core of PCOS.</p>",
    "applicability": "<p>Indirect — these are rare monogenic syndromes, not PCOS. Value is mechanistic insight into insulin-receptor dysfunction underlying the PCOS insulin-resistance spectrum. No PCOS clinical action.</p>",
    "equity": "<p>Rare-disease genetics; no PCOS-population generalization.</p>",
    "prompts": "<ol><li>Do monogenic INSR syndromes illuminate the common insulin-resistance of PCOS?</li><li>Is 'insulin-receptor biology' a strong enough thread to include a rare-disease genetics paper?</li><li>Where does severe vs common insulin resistance converge mechanistically?</li></ol>",
},

# ===================== CHRONIC PELVIC PAIN (visceral-somatic + central sensitization) =====================

"42212951": {  # Physical activity, menstrual health & psychological wellbeing — Chinese students
    "bottom": "Study of how physical activity affects menstrual health and psychological wellbeing in Chinese female university students. Fits the visceral-somatic/whole-person pelvic-pain and menstrual-health thesis — movement as a lever on menstrual symptoms and mood. Cross-sectional/observational lifestyle data.",
    "question": "<p><strong>The clinical problem.</strong> Menstrual symptoms and mood burden young women, and non-pharmacologic levers like physical activity are attractive but under-quantified in this population.</p><p><strong>The question.</strong> How does physical activity affect menstrual health and psychological wellbeing in Chinese female university students?</p>",
    "pico": {"P": "Chinese female university students.", "I": "Physical activity (varying levels).", "C": "Across activity levels.", "O": "Menstrual health and psychological wellbeing.", "D": "Observational study.", "S": "University-student cohort."},
    "findings": "<p>The study related higher physical activity to better menstrual-health and psychological-wellbeing outcomes, supporting movement as a modifiable lever.</p>",
    "strengths": "<p>Addresses a modifiable lifestyle factor with both menstrual and mood outcomes in a young population.</p>",
    "applicability": "<p>Supports recommending physical activity for menstrual and mood symptoms in young women. Observational/cross-sectional and culturally specific; association, not proof.</p>",
    "equity": "<p>Single-population student sample; generalize cautiously.</p>",
    "prompts": "<ol><li>Do you counsel physical activity for menstrual/mood symptoms, and on what evidence?</li><li>How much is association vs causation here?</li><li>What activity 'dose' seems beneficial?</li></ol>",
},

"42199153": {  # Chronic overlapping pain & central sensitization in CPP — role of affect
    "bottom": "Study examining whether positive and negative affect shape chronic overlapping pain and central sensitization in chronic pelvic pain — the textbook systems-pain thesis made explicit. Supports the biopsychosocial, central-sensitization model of CPP and the role of emotional state in pain processing. Directly on-thesis for pelvic-pain care.",
    "question": "<p><strong>The clinical problem.</strong> CPP frequently overlaps with other chronic-pain conditions through central sensitization; emotional state (affect) may modulate this, but its role is under-characterized — central to a biopsychosocial treatment model.</p><p><strong>The question.</strong> Do positive and negative affect play a role in chronic overlapping pain and central sensitization in CPP?</p>",
    "pico": {"P": "Patients with chronic pelvic pain.", "I": "Assessment of positive/negative affect.", "C": "Across affect levels / overlapping-pain status.", "O": "Central sensitization and chronic-overlapping-pain measures.", "D": "Observational psychophysiology study.", "S": "CPP cohort."},
    "findings": "<p>The study related affect to central-sensitization and chronic-overlapping-pain measures in CPP, supporting an emotional-modulation component of the central-sensitization model.</p>",
    "strengths": "<p>Operationalizes the biopsychosocial/central-sensitization model with affect measures — directly on the pelvic-pain systems thesis.</p>",
    "applicability": "<p>Reinforces addressing mood/affect and central sensitization (not just peripheral pathology) in CPP management. Cross-sectional; association, supporting multimodal care.</p>",
    "equity": "<p>Single-cohort; CPP is itself under-recognized and under-resourced — an access-equity backdrop.</p>",
    "prompts": "<ol><li>Do you assess and address affect/central sensitization in CPP, or focus on peripheral pathology?</li><li>How does the overlapping-pain framing change your workup?</li><li>What multimodal levers follow from a central-sensitization model?</li></ol>",
},

}
