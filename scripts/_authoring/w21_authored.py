# -*- coding: utf-8 -*-
"""
w21_authored.py — Hand-authored journal-club content for the W21 CBG/MIGS
Monday Mornings post (blog-2026-W21).

Per CLAUDE.md §3.9: clinical content here is authored by reading each paper's
verbatim PubMed abstract individually — NOT heuristically generated. Each
entry below is a per-paper clinical assessment (surgeon's bottom line, PICO
scaffold, and the Monday-clinic change/hold/counsel call) keyed by PMID.

Fields per PMID:
  bottom   : <p class="mz-jc-bottom"> text  (the surgeon's bottom line / TL;DR)
  monday   : <p class="mz-jc-monday-take"> text (change / hold / counsel call)
  pico     : dict with keys P, I, C, O, D, S (Population/Intervention/Comparator/
             Outcome/Design/Sample) — only required where 'pico' is pending
  applic   : <p> applicability text — only for the 2 papers whose applicability
             section is pending (42141930, 42134914)

Author: Christopher Z. Mabini, DO — journal-club review for W21.
"""

AUTHORED = {

# ============================ ENDOMETRIOSIS ============================

# Decorin scRNA-seq — bioinformatic/mechanism
"42139232": {
    "bottom": "Mechanism / bioinformatics paper — no Monday-clinic change. Decorin (DCN) is upregulated in endometriotic stromal cells with single-dataset diagnostic AUC &gt; 0.8, but this is a tissue-and-database signal validated only by RT-qPCR, not a serum assay. Track DCN as a candidate for the still-unmet non-invasive endometriosis biomarker, alongside the TGF-&#x3b2;/complement pathways it co-localizes with.",
    "monday": "Hold. This is hypothesis-generating discovery work. There is no DCN-based test to order and nothing here changes operative or medical management. The honest takeaway for patients still waiting years for a tissue diagnosis: a validated non-invasive biomarker for endometriosis does not yet exist, and DCN is one more promising-but-unproven candidate.",
    "pico": {
        "P": "Human endometriotic stromal cells from ovarian endometriomas vs. control endometrial stromal cells; public scRNA-seq and bulk RNA-seq datasets.",
        "I": "Bioinformatic characterization of decorin (DCN) expression by scRNA-seq (Scissor/ROGUE), CIBERSORTx deconvolution, GSEA, with RT-qPCR validation.",
        "C": "Non-endometriosis control endometrial stromal cells / control datasets.",
        "O": "DCN expression level, ROC-based diagnostic AUC, stromal-subtype proportions, predicted DCN-targeted drugs.",
        "D": "In-silico multi-omics analysis with in-vitro RT-qPCR validation.",
        "S": "Public transcriptomic datasets plus clinical specimen-derived cell lines (n not individually specified).",
    },
},

# CA125/prolactin/cortisol vs stage & pain — cross-sectional, n=30
"42137843": {
    "bottom": "Small (n=30) single-center cross-sectional series correlating serum CA125, prolactin, and cortisol with ASRM stage and pain in laparoscopically confirmed endometriosis. Cohort was heavily skewed to stage IV (63%), so any stage gradient is fragile. Reinforces that CA125 tracks disease burden but is neither sensitive nor specific enough to diagnose or stage endometriosis.",
    "monday": "Hold / counsel. Nothing here justifies ordering CA125, prolactin, or cortisol to diagnose or stage endometriosis. CA125 remains a non-diagnostic adjunct — useful at most for tracking a known endometrioma over time, not for ruling disease in or out. Counsel patients that there is still no blood test that replaces imaging and, when indicated, laparoscopy.",
},

# VEGF/CA125 vs stage & pain — Indonesia cross-sectional
"42137832": {
    "bottom": "Cross-sectional Indonesian series: peritoneal-fluid VEGF correlated moderately with pain severity (r=0.51) but NOT with rASRM stage (r=0.04, p=0.81), and serum CA125 again tracked burden weakly. The dissociation between a pain-associated marker and an anatomic-stage marker is the real teaching point — pain and lesion stage are biologically distinct axes in endometriosis.",
    "monday": "Hold. Peritoneal-fluid sampling is itself invasive, so a fluid VEGF that correlates with pain has no practical diagnostic role. The durable clinical message: endometriosis pain is poorly predicted by anatomic stage, which is exactly why we treat the patient's symptoms, not their rASRM score.",
    "pico": {
        "P": "Women with surgically and histopathologically confirmed endometriosis at a single Indonesian hospital.",
        "I": "Peritoneal-fluid VEGF (ELISA) and serum CA125 (CLIA) measurement.",
        "C": "Correlation against rASRM stage and Numeric Rating Scale pain (no separate control arm).",
        "O": "Spearman correlation and ROC performance of VEGF/CA125 vs. stage and pain.",
        "D": "Single-center cross-sectional study.",
        "S": "Surgically confirmed endometriosis cohort (Feb-Jul 2025).",
    },
},

# COX-2/VEGF serum biomarkers — Indonesia cross-sectional, n=28
"42137826": {
    "bottom": "Third small Indonesian biomarker series from the same group (n=28): serum VEGF correlated strongly with ASRM stage; COX-2 less so. Promising as a non-invasive triage signal, but n=28, single-center, no external validation — far short of a deployable test.",
    "monday": "Hold. Do not order serum COX-2 or VEGF for endometriosis workup. This is early correlational data; the unmet need it speaks to — a validated, non-invasive way to triage suspected endometriosis before laparoscopy — remains unmet.",
    "pico": {
        "P": "Women with ASRM-staged confirmed endometriosis at a single Indonesian hospital, 2025.",
        "I": "Preoperative serum COX-2 and VEGF (ELISA).",
        "C": "Correlation against ASRM disease stage (no healthy-control arm reported).",
        "O": "Biomarker-stage correlation and ROC diagnostic performance (AUC, sensitivity, specificity).",
        "D": "Single-center cross-sectional study.",
        "S": "28 patients.",
    },
},

# Endometriosis incidence — US military surveillance
"42127311": {
    "bottom": "MSMR surveillance of US active-duty servicewomen: endometriosis incidence rose ~42% from 2017 (28.7/10,000 person-years) to 2024 (40.7), highest in older, nulliparous, never-deployed, and both obese and underweight women, with menorrhagia the leading co-condition. A population-burden signal, not a clinical-practice study.",
    "monday": "Counsel / systems. No change to individual management, but the rising documented incidence and the nulliparous/BMI-extreme risk profile are useful for counseling and for arguing that earlier diagnostic pathways reduce the years-long delay that drives quality-of-life and readiness costs.",
},

# Redox balance bipolar vs laser cystectomy — clinical, n=60
"42127161": {
    "bottom": "Sixty women randomized by energy source during endometrioma cystectomy: laser electrocoagulation lowered the superoxide anion radical and raised SOD activity more than bipolar, with both reducing lipid-peroxidation markers. A redox-biomarker surrogate study — it does not measure ovarian reserve, recurrence, or pain, which are the outcomes that actually drive energy-source choice.",
    "monday": "Hold. Interesting mechanistic signal that energy modality alters peri-operative oxidative stress, but surrogate redox markers are not a reason to switch your hemostatic technique. The decision that matters at the ovary — minimizing thermal spread to preserve reserve — is better served by the AMH/cystectomy-technique literature than by these biomarkers.",
    "pico": {
        "P": "60 women undergoing laparoscopic endometriotic cyst surgery.",
        "I": "Laser electrocoagulation for hemostasis.",
        "C": "Bipolar electrocoagulation.",
        "O": "Pro-oxidative (O2-, NO2-, H2O2, lipid peroxidation) and antioxidative (GSH, SOD, CAT) markers before/after surgery.",
        "D": "Comparative surgical cohort, two energy-source groups.",
        "S": "60 women with diagnosed endometriosis.",
    },
},

# Antioxidant capacity 2D/3D cell models — in vitro
"42123707": {
    "bottom": "In-vitro work showing endometriotic (12Z) cells are more vulnerable to H2O2 oxidative stress than endometrial (Ishikawa) cells, with 72% glutathione depletion in 3D culture and NAC rescuing viability but not DNA damage. Pure bench mechanism; the practical nugget is methodological — 3D culture exposed a vulnerability 2D missed.",
    "monday": "Hold — no Monday-clinic change. Do not extrapolate this to recommending N-acetylcysteine or antioxidant supplements for endometriosis patients; NAC failed to prevent DNA damage even in the dish. This is a model-validation paper, not a treatment signal.",
    "pico": {
        "P": "12Z (endometriotic) and Ishikawa (endometrial) cell lines in 2D and 3D culture.",
        "I": "H2O2 oxidative challenge with/without N-acetylcysteine.",
        "C": "Between cell lines and between 2D vs. 3D culture systems.",
        "O": "ROS production, glutathione homeostasis, lipid peroxidation, protein carbonylation, DNA damage, viability.",
        "D": "In-vitro experimental study.",
        "S": "Cell-line experiments (no human n).",
    },
},

# TGF-beta isoforms in PBMC — case-control pilot, n=80
"42123482": {
    "bottom": "Pilot case-control (50 endometriosis / 30 controls): unstimulated PBMC secretion of TGF-&#x3b2;1/2/3 did NOT differ between groups, though TGF-&#x3b2;2 was higher in stage III-IV than I-II within cases. The negative systemic result is the headline — it argues TGF-&#x3b2; dysregulation is compartmentalized to the peritoneum, not measurable in circulating immune cells.",
    "monday": "Hold. A negative systemic biomarker finding with an underpowered (n=11-14 per stage) subgroup signal. No clinical test emerges. Reinforces that peripheral blood immune assays do not capture the local peritoneal disease process.",
    "pico": {
        "P": "50 women with surgically confirmed endometriosis and 30 controls.",
        "I": "24-hour unstimulated PBMC culture with multiplex TGF-&#x3b2;1/2/3 quantification.",
        "C": "Non-endometriosis controls; within-case rASRM stage comparison.",
        "O": "Supernatant TGF-&#x3b2; isoform concentrations, between-group and stage-related differences.",
        "D": "Prospective case-control pilot study.",
        "S": "80 women (50 cases, 30 controls).",
    },
},

# LNG-IUS + GnRH-a post-op endometriosis — pilot, n=120
"42120175": {
    "bottom": "Exploratory pilot (n=120, alternation-allocated): adding an LNG-IUS to post-operative GnRH-a after laparoscopy for endometriosis improved VAS pain and Kupperman scores vs. GnRH-a alone, with the expected hormonal shifts. Directionally consistent with the established post-operative LNG-IUS literature, but the alternation allocation and mRNA-endpoint framing make this hypothesis-generating, not practice-defining.",
    "monday": "Counsel — consistent with existing practice. This supports, rather than newly establishes, post-operative LNG-IUS for secondary prevention of endometriosis-associated pain and recurrence. For the patient who has completed a GnRH-a course after excisional surgery and is not seeking immediate fertility, a levonorgestrel IUD is a reasonable, guideline-aligned maintenance option — a conversation to have, not a change driven by this pilot.",
},

# Vitamin D bidirectional MR — Mendelian randomization
"42116278": {
    "bottom": "Bidirectional Mendelian randomization: endometriosis appears to causally raise serum 25-OH vitamin D modestly, with no convincing reverse effect of vitamin D on endometriosis risk. Translation — low vitamin D is more likely a marker than a cause, which undercuts the rationale for vitamin D supplementation as endometriosis prevention or treatment.",
    "monday": "Counsel. When patients ask whether vitamin D will treat or prevent their endometriosis, this MR evidence supports an honest 'no' — correct deficiency for bone health on its own merits, but do not sell vitamin D as disease-modifying for endometriosis.",
},

# Bartholin gland endometrioma — case report
"42113614": {
    "bottom": "Single case of extrapelvic endometriosis of Bartholin's gland in a 40-year-old with cyclical vulvar pain, swelling, and dyspareunia, cured by primary excision. A reminder that cyclical, catamenial vulvar/perineal masses can be endometriosis even far outside the pelvis — and that excision is both diagnostic and curative.",
    "monday": "Counsel / pattern-recognition. No practice change, but keep extrapelvic endometriosis on the differential for any cyclical, painful vulvar or perineal mass — especially at sites of prior obstetric trauma. Histology, not assumption, makes the diagnosis.",
    "pico": {
        "P": "Healthy 40-year-old woman, para 2, with a cyclical painful Bartholin's-area mass and dyspareunia.",
        "I": "Primary surgical excision of the lesion.",
        "C": "None (single case report).",
        "O": "Histopathologic diagnosis and symptom resolution at 2-month follow-up.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# ============================ ADENOMYOSIS / FIBROIDS ============================

# HIFU coagulation function — retrospective, n=1189
"42136322": {
    "bottom": "Large retrospective series (n=1,148 analyzed) showing HIFU for fibroids/adenomyosis induces a transient hypercoagulable state — D-dimer rose in 62%, FDP in 56% on POD1, with shortened aPTT and falling platelets — yet zero clinical thromboembolic events occurred. A reassuring safety signal with a caveat: the lab derangement is real, so VTE-risk stratify before assuming it is benign in everyone.",
    "monday": "Counsel / hold. For most HIFU candidates this transient coagulation shift is subclinical and not a reason to add routine post-procedure anticoagulation. But in patients already at high VTE risk, the documented hypercoagulable window supports standard peri-procedural mobilization and individualized prophylaxis rather than ignoring the labs.",
    "pico": {
        "P": "1,148 patients with uterine fibroids or adenomyosis treated with HIFU at a single Chinese center (2015-2020).",
        "I": "High-intensity focused ultrasound ablation.",
        "C": "Pre- vs. post-treatment paired coagulation indices; HIFU-parameter tertiles.",
        "O": "D-dimer/FDP elevation, PT/TT/aPTT, platelet count, clinical thromboembolism.",
        "D": "Retrospective cohort with paired t-tests and logistic regression.",
        "S": "1,189 enrolled / 1,148 analyzed.",
    },
},

# Hysteroscopic adenomyosis criteria — prospective, n=40
"42134905": {
    "bottom": "Prospective office-hysteroscopy series (n=40, MUSA-confirmed adenomyosis): hemorrhagic spots (97.5%), hypervascularization/hyperemia (97.5%), structural irregularity (92.5%), and endometriotic-like 'strawberry' features (67.5%) were near-universal. A useful proposed hysteroscopic vocabulary for a condition that still lacks standardized direct-visualization criteria — but these findings are sensitive, not specific.",
    "monday": "Counsel — diagnostic adjunct, not a new standard. If you already perform office hysteroscopy in the workup of abnormal bleeding, recognizing these vascular and hemorrhagic patterns adds confidence to an imaging-based adenomyosis diagnosis. It does not replace MUSA ultrasound criteria, and absence of these findings does not exclude disease.",
    "pico": {
        "P": "40 symptomatic women (18-55) with MUSA-confirmed adenomyosis at a tertiary center.",
        "I": "Standardized video-recorded office hysteroscopy with structured categorization.",
        "C": "None (descriptive prevalence study).",
        "O": "Frequency of structural, vascular, hemorrhagic, and endometriotic-like hysteroscopic findings.",
        "D": "Prospective descriptive study (Aug 2022-May 2023).",
        "S": "40 women.",
    },
},

# COH protocols adenomyosis IVF — retrospective, n=1486
"42120313": {
    "bottom": "Real-world retrospective of 1,486 IVF-ET cycles in adenomyosis: the long/ultra-long (and short-acting long) protocols gave the best fresh-cycle and cumulative pregnancy rates, while the antagonist protocol underperformed overall — EXCEPT in women &lt;35 with normal AMH, where antagonist matched long protocols using far less gonadotropin. A protocol-individualization signal for the adenomyosis-IVF patient.",
    "monday": "Counsel / refer. For reproductive-endocrinology colleagues and for counseling adenomyosis patients pursuing IVF: long/ultra-long down-regulation remains the higher-yield default, but young normal-reserve patients can reasonably use a gentler antagonist protocol without sacrificing cumulative success. Not a CBG/MIGS procedural change — a fertility-pathway counseling point.",
    "pico": {
        "P": "Adenomyosis patients undergoing IVF-ET (1,486 cycles, 2018-2021).",
        "I": "Long / ultra-long and short-acting long controlled-ovarian-hyperstimulation protocols.",
        "C": "GnRH-antagonist protocol.",
        "O": "Fresh-cycle and cumulative clinical pregnancy and live-birth rates.",
        "D": "Real-world retrospective cohort with multivariable regression.",
        "S": "1,486 IVF-ET cycles.",
    },
},

# Benign metastasizing leiomyoma review — systematic review of case reports
"42145021": {
    "bottom": "Systematic review of 213 reports of benign metastasizing leiomyoma (BML): mean age 47.8, most with prior hysterectomy/myomectomy, metastasizing benign smooth-muscle tumors most often to lung (85%), frequently asymptomatic. A rare but real reminder that 'benign' uterine smooth muscle can seed distant sites years after surgery.",
    "monday": "Counsel / vigilance. No change to routine fibroid management, but BML belongs in the differential for a woman with prior myomectomy/hysterectomy who presents with pulmonary nodules or unexplained cough/dyspnea — avoid the trap of an automatic malignancy workup before considering this hormonally-driven, often indolent entity.",
    "pico": {
        "P": "Patients with benign metastasizing leiomyoma reported in the literature (2000-2024).",
        "I": "Systematic data extraction on presentation, sites, histology, treatment, outcomes.",
        "C": "None (descriptive synthesis).",
        "O": "Demographics, metastatic site distribution, treatment patterns, survival.",
        "D": "Systematic review of case reports and case series.",
        "S": "213 articles; ~239 surgically treated patients.",
    },
},

# UAE long-term for fibroids — retrospective cohort (title mislabeled)
"42138001": {
    "bottom": "[Note: card title is mislabeled 'ESHRE guideline: endometriosis'; the actual paper is a retrospective UAE cohort.] Retrospective cohort of uterine artery embolization for symptomatic fibroids (2012-2023): durable symptom relief, especially for bleeding, sustained across short/mid/long-term follow-up and enhanced by subsequent menopause, with mostly minor complications and rare pregnancies afterward. Confirms UAE as a durable uterine-sparing option, with the familiar caveats on fertility.",
    "monday": "Counsel. For the symptomatic-fibroid patient who wants to avoid hysterectomy and is not prioritizing future fertility, UAE remains a strong, durable, minimally invasive option — and this adds reassurance that benefit persists long-term and through menopause. Counsel fertility-seeking patients that pregnancy after UAE is possible but the data are thin, and myomectomy is generally preferred when fertility is the goal.",
    "pico": {
        "P": "Women undergoing UAE for symptomatic fibroids at one center (2012-2023).",
        "I": "Uterine artery embolization.",
        "C": "Pre- vs. post-UAE symptom scores; follow-up terciles.",
        "O": "Heavy-bleeding and pelvic-pain symptom change, complications, subsequent pregnancy.",
        "D": "Retrospective cohort with validated questionnaire.",
        "S": "Cohort across an 11-year window (n not specified in abstract).",
    },
},

# Leiomyosarcoma in pregnancy — case report (title mislabeled)
"42116313": {
    "bottom": "[Card title mislabeled 'ESHRE guideline: endometriosis'; the actual paper is a leiomyosarcoma-in-pregnancy case report.] Case of uterine leiomyosarcoma discovered in the context of pregnancy/cesarean, treated with surgery and chemotherapy. The teaching point is the one every surgeon fears: a 'fibroid' of uncertain nature encountered at cesarean demands deliberate intra-operative judgment, not reflexive myomectomy.",
    "monday": "Counsel / intra-operative judgment. When you meet an atypical or rapidly-grown 'fibroid' at cesarean, weigh feasibility of myomectomy against the small-but-real chance of malignancy and the bleeding risk, and have a plan for tissue handling and autologous transfusion. The durable lesson is diagnostic humility about the rare LMS masquerading as a benign fibroid.",
    "pico": {
        "P": "Pregnant patient with a uterine mass of uncertain nature diagnosed as leiomyosarcoma.",
        "I": "Surgery plus chemotherapy.",
        "C": "None (single case).",
        "O": "Diagnosis, management decisions, and follow-up.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# ============================ HYSTERECTOMY / ROUTE / ERAS ============================

# Robot hysterectomy adoption France — nationwide registry
"42126650": {
    "bottom": "Nationwide French registry (196,050 hysterectomies, 2020-2024): laparoscopy stayed dominant while robot-assisted hysterectomy grew steadily across all indications, mostly displacing open surgery, with the biggest uptake at high-volume/multidisciplinary centers. Length of stay after robotic was comparable to laparoscopic and shortest for benign cases at experienced centers. The story is open-to-MIS conversion, not robotic-over-laparoscopic superiority.",
    "monday": "Counsel / systems. This reinforces the core route message: for benign hysterectomy, the win is getting patients off the open route onto any minimally invasive approach. Robotic and straight-laparoscopic deliver comparable length of stay, so platform choice should follow surgeon expertise and case complexity, not a presumption that robotic is inherently better for benign disease.",
    "pico": {
        "P": "All non-vaginal total hysterectomies in France, 2020-2024 (PMSI registry).",
        "I": "Robot-assisted hysterectomy.",
        "C": "Open and conventional laparoscopic hysterectomy.",
        "O": "Surgical-route trends and length of hospital stay by route and center expertise.",
        "D": "Nationwide retrospective registry analysis.",
        "S": "196,050 hysterectomies.",
    },
},

# Robotic vs laparoscopic hysterectomy outcomes/cost — retrospective, n=4821
"42115535": {
    "bottom": "Single-center decade review (n=4,821): robotic hysterectomy rose from 6% to 38% of cases; for benign disease robotic and laparoscopic had similar operative and complication outcomes but robotic cost ~$2,790 more per case, while for radical hysterectomy/cervical cancer robotic cut operative time, transfusions, reoperations, and complications. Benefit is concentrated in complex oncologic cases, not benign hysterectomy.",
    "monday": "Counsel / value. For benign hysterectomy, this supports choosing the platform you are fastest and safest on rather than defaulting to the more expensive robotic option for equivalent outcomes. The differential value of robotics shows up in complex radical surgery — a reasonable place to concentrate robotic resources.",
    "pico": {
        "P": "4,821 hysterectomy and radical-hysterectomy cases at one center after robotic introduction.",
        "I": "Robot-assisted hysterectomy.",
        "C": "Laparoscopic and open approaches (propensity-matched).",
        "O": "Operative time, complications, transfusion, reoperation, and incremental cost.",
        "D": "Retrospective propensity-matched cohort with time-series trends.",
        "S": "4,821 cases.",
    },
},

# Intrathecal morphine dose RALH — dual-center cohort, n=100
"42115438": {
    "bottom": "Dual-center retrospective cohort (n=100): in robotic hysterectomy under an ERAS pathway, intrathecal morphine 0.15 mg gave lower pain scores and less rescue opioid than 0.10 mg, while the 0.10 mg group had MORE pruritus, PONV, and hypotension — a counter-intuitive result likely reflecting confounding by indication. No respiratory depression at either dose. Adds to the ERAS-analgesia toolkit for robotic hysterectomy.",
    "monday": "Counsel — discuss with anesthesia. For programs already using spinal/intrathecal morphine within a robotic-hysterectomy ERAS pathway, low-dose ITM (0.10-0.15 mg) delivers good analgesia with rare rescue and no respiratory events here. The retrospective design and paradoxical side-effect pattern mean this informs an anesthesia conversation, not a protocol mandate.",
    "pico": {
        "P": "100 women undergoing robotic-assisted laparoscopic hysterectomy at two centers.",
        "I": "Intrathecal morphine 0.15 mg.",
        "C": "Intrathecal morphine 0.10 mg.",
        "O": "VAS pain, rescue opioid use, PONV, pruritus, hypotension, recovery scores.",
        "D": "Retrospective dual-center cohort.",
        "S": "100 women.",
    },
},

# Esketamine + propofol hysteroscopy — RCT dose-response, n=112
"42112091": {
    "bottom": "Randomized double-blind dose-response trial (n=112): esketamine dose-dependently reduced the propofol effect-site concentration needed to suppress movement at cervical dilation during operative hysteroscopy. Mechanistically clean evidence that an esketamine adjunct lets you run lower propofol — potentially fewer respiratory/hemodynamic events — in a procedure where deep sedation is the norm.",
    "monday": "Counsel — anesthesia-facing. For operative hysteroscopy under propofol sedation, this is a genuine, well-designed signal that low-dose esketamine co-induction reduces propofol requirement and its associated respiratory/hemodynamic risk. Worth raising with your anesthesia team for hysteroscopy sedation protocols; the gynecologist's procedure itself is unchanged.",
    "pico": {
        "P": "112 adult women undergoing elective operative hysteroscopy.",
        "I": "Esketamine 0.1-0.4 mg/kg as a propofol adjunct before induction.",
        "C": "Esketamine 0 mg (placebo) and lower dose tiers.",
        "O": "Propofol effect-site concentration suppressing cervical-dilation movement.",
        "D": "Randomized, double-blind, parallel-group dose-response trial.",
        "S": "112 women across five dose groups.",
    },
},

# ============================ PLACENTA ACCRETA SPECTRUM ============================

# IIABO for PAS — retrospective, n=20
"42121103": {
    "bottom": "Small retrospective series (n=20): prophylactic internal iliac artery balloon occlusion roughly halved mean blood loss in PAS surgery (1,600 vs 3,222 mL) across both hysterectomy and conservative myometrial repair, but with wide individual variability driven by collateral circulation and scar morphology. Confirms IIABO reduces average blood loss without guaranteeing it in any given patient.",
    "monday": "Counsel — for the multidisciplinary PAS team. IIABO is a reasonable adjunct that lowers average hemorrhage in accreta surgery, but the high individual variance means it cannot replace meticulous surgical planning, blood-product readiness, and the option of definitive hysterectomy. Useful for shared decision-making and OR setup, not a stand-alone solution.",
    "pico": {
        "P": "20 patients with placenta accreta spectrum over 21 months.",
        "I": "Prophylactic internal iliac artery balloon occlusion.",
        "C": "No balloon occlusion; TAH vs. conservative myometrial repair.",
        "O": "Estimated blood loss (effect size by Cohen's d / two-way ANOVA).",
        "D": "Retrospective stratified cohort.",
        "S": "20 consecutive patients.",
    },
},

# Platelet indices in PAS — retrospective, n=200
"42120176": {
    "bottom": "Retrospective three-group study (PAS/previa/control, n=200): first-trimester mean platelet volume &lt;10.45 was the best single predictor of peripartum hysterectomy (AUC 0.71) and stayed independent on multivariate analysis, with other platelet indices showing only modest predictive value. Statistically real but too weak to act on alone.",
    "monday": "Hold. A first-trimester MPV is cheap and routinely available, but an AUC of 0.71 is nowhere near good enough to drive delivery planning or hysterectomy readiness — imaging (ultrasound/MRI) for PAS remains the decision-maker. File this as a possible future adjunct, not a present-day test to order.",
    "pico": {
        "P": "200 pregnant women: PAS (63), placenta previa (67), controls (70).",
        "I": "First- and third-trimester platelet indices (MPV, PDW, PCT, P-LCR).",
        "C": "Between PAS, previa, and control groups.",
        "O": "Prediction of peripartum hysterectomy, PPH, and adverse neonatal outcome.",
        "D": "Retrospective single-center study with ROC and logistic regression.",
        "S": "200 women.",
    },
},

# ============================ ABNORMAL UTERINE BLEEDING / HMB ============================

# HMB patient survey — n=1241 surveyed, 150 responded
"42116120": {
    "bottom": "Patient-experience survey (150 respondents): hysterectomy delivered the highest symptom-control satisfaction (97%) with low regret (8%), while medical options performed far worse — oral hormones controlled symptoms in only 40%, the LNG-IUS in 48%, both with high intolerable-side-effect and regret rates. A patient-reported reminder that definitive surgery satisfies, but selection and counseling around medical therapy matter enormously.",
    "monday": "Counsel. The actionable message is shared decision-making: present realistic effectiveness and tolerability figures for each HMB option rather than defaulting to 'try the Mirena first.' For women who have failed or won't tolerate medical therapy and have completed childbearing, the high satisfaction and low regret after hysterectomy are legitimate to put on the table early.",
    "pico": {
        "P": "1,241 women treated for heavy menstrual bleeding at a regional Australian center (2018-2023).",
        "I": "Retrospective recall patient-experience survey.",
        "C": "Across treatment types (hysterectomy, oral/non-oral hormones, LNG-IUS).",
        "O": "Satisfaction, side effects, decision regret, goal alignment.",
        "D": "Single-center retrospective survey.",
        "S": "150 respondents of 1,241 invited.",
    },
},

# ============================ DYSMENORRHEA / PELVIC PAIN ============================

# Exercise for menstrual symptoms — narrative review / 86 studies
"42142051": {
    "bottom": "Narrative review of 86 studies (women 18-35): aerobic, resistance, stretching, yoga, and multimodal exercise of at least 4 weeks reduced dysmenorrhea and PMS symptoms, offering a safe, low-cost, side-effect-free alternative or adjunct to NSAIDs and hormones. Narrative (not meta-analytic) synthesis, so effect sizes are not pooled, but the direction and safety are consistent.",
    "monday": "Counsel — low-risk recommendation. It is reasonable and evidence-supported to recommend regular exercise as first-line or adjunctive management for primary dysmenorrhea and PMS, especially for patients who want to minimize medication. Frame it as a genuine therapeutic option, not just generic wellness advice.",
    "pico": {
        "P": "Women aged 18-35 with dysmenorrhea or PMS across 86 included studies.",
        "I": "Aerobic, resistance, stretching, yoga, or multimodal exercise for >=4 weeks.",
        "C": "Non-exercise or usual care (variable across studies).",
        "O": "Menstrual symptom severity, mood, function, adherence.",
        "D": "Narrative review.",
        "S": "86 studies.",
    },
},

# Women's perspectives pelvic pain primary care — survey
"42134967": {
    "bottom": "UK primary-care survey (45 of 81 reporting pelvic pain): mean impact 7.5/10, fewer than half had a diagnosis explaining their symptoms, and pain descriptors carried explicit emotional trauma ('agonising', 'crippling'). A qualitative mirror of the diagnostic-delay and feeling-unheard experience that defines chronic pelvic pain care.",
    "monday": "Counsel / clinician-behavior. No procedure change — a prompt to validate symptoms, name the diagnostic uncertainty honestly, and avoid the dismissiveness that compounds these patients' distress. The therapeutic relationship is itself part of management in chronic pelvic pain.",
    "pico": {
        "P": "Female primary-care patients >18 at one UK GP practice (81 respondents).",
        "I": "Mixed-methods survey of physical/emotional impact and healthcare interactions.",
        "C": "None.",
        "O": "Pain impact scores, diagnosis rates, qualitative themes.",
        "D": "Cross-sectional mixed-methods survey.",
        "S": "81 responses; 45 with pelvic pain.",
    },
},

# BCC module & dysmenorrhea — propensity-matched, n=472
"42118763": {
    "bottom": "Propensity-matched comparative study among Bangladeshi university students (98 matched pairs): attending a behavioral-change-communication module was associated with lower dysmenorrhea prevalence. A low-resource, non-pharmacologic education signal — but cross-sectional design means reverse causation and residual confounding can't be excluded.",
    "monday": "Hold / context-specific. Educational/behavioral interventions for dysmenorrhea are low-risk and reasonable to support, but this design cannot prove the module reduced pain rather than motivated attenders differing at baseline. Relevant mainly for population-health programming, not individual clinic management.",
    "pico": {
        "P": "Female university students in Bangladesh (472 analyzed).",
        "I": "Attendance at a 3-session behavioral-change-communication module.",
        "C": "Non-attenders (propensity-matched 1:1).",
        "O": "Dysmenorrhea prevalence (average treatment effect on the treated).",
        "D": "Matched cross-sectional comparative study.",
        "S": "472 students; 98 matched pairs.",
    },
},

# Dysmenorrhea adolescents Saudi — cross-sectional (title mislabeled)
"42116345": {
    "bottom": "[Card title mislabeled 'ESHRE guideline: endometriosis'; actual paper is a dysmenorrhea-in-schoolgirls survey.] Cross-sectional survey of 445 Saudi secondary-school girls quantifying dysmenorrhea prevalence and its interference with daily life. Reinforces how common and functionally disruptive primary dysmenorrhea is in adolescents — and how often it goes unaddressed.",
    "monday": "Counsel. The takeaway is access and recognition: adolescent dysmenorrhea is highly prevalent and frequently impairs school and daily function, yet is undertreated. Ask about it, treat it as legitimate, and intervene early with NSAIDs/hormonal options rather than normalizing it.",
    "pico": {
        "P": "445 secondary-school girls in Abha, Saudi Arabia.",
        "I": "Self-administered MDOT-based menstrual-disorder questionnaire.",
        "C": "None.",
        "O": "Dysmenorrhea prevalence and daily-life interference.",
        "D": "Cross-sectional survey.",
        "S": "445 girls.",
    },
},

# ============================ OVARIAN / FERTILITY-SPARING SURGERY ============================

# 4DryField PH hemostasis ovarian surgery — pilot RCT, n=20
"42138724": {
    "bottom": "Pilot RCT (n=20) in laparoscopic cystectomy for benign lesions with good baseline AMH: a topical polysaccharide hemostatic (4DryField PH) was compared to bipolar electrocautery for ovarian hemostasis, tracking POD-14 AMH decline and inflammatory markers. The premise is sound — replacing thermal energy at the ovary to spare reserve — but n=20 is feasibility-only.",
    "monday": "Hold — promising, underpowered. The concept of substituting a topical hemostat for bipolar at the ovarian bed to preserve reserve is exactly right physiologically, and worth watching. But a 20-patient pilot does not justify changing your hemostatic technique; await adequately-powered AMH-outcome trials before adopting.",
    "pico": {
        "P": "20 women (AMH >=2.0) undergoing laparoscopic cystectomy for benign ovarian lesions.",
        "I": "Topical 4DryField PH hemostatic powder.",
        "C": "Bipolar electrocautery.",
        "O": "AMH decline at POD14, CRP/IL-6/PCT, hemoglobin.",
        "D": "Prospective, randomized, single-blind pilot study.",
        "S": "20 women (10 per arm).",
    },
},

# Ovarian torsion massive edema — case report
"42128437": {
    "bottom": "Case of massive ovarian edema from intermittent torsion mimicking a solid neoplasm — MRI suggested torsion-detorsion, and laparoscopy confirmed a viable enlarged ovary salvaged by detorsion, controlled stromal decompression, and ligament-based ovariopexy ('Hot-Dog-in-a-Bun') rather than oophorectomy. A fertility-preserving rescue of an ovary that imaging nearly condemned.",
    "monday": "Counsel / technique-awareness. The lesson is to resist reflexive oophorectomy when MRI features suggest torsion-induced massive edema rather than neoplasm — detorsion with ovariopexy can preserve a viable ovary. Keep massive ovarian edema on the differential for a young woman with a 'solid mass' and intermittent pain.",
    "pico": {
        "P": "Woman in her late 20s with intermittent pelvic pain, infertility, and an apparent solid ovarian mass.",
        "I": "Laparoscopic detorsion, controlled stromal decompression, ligament-based ovariopexy.",
        "C": "None (single case).",
        "O": "Ovarian viability, resolution of enlargement, fertility preservation.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# ============================ INFERTILITY / IVF / ART ============================

# Pre-IVF vaginal/semen cultures — retrospective, n=121 positive
"42136739": {
    "bottom": "Retrospective culture study: positive vaginal cultures in 25.5% and semen cultures in 29% of IVF couples, but partner pathogen overlap was rare (&lt;3%), and pregnancy rates were identical regardless of vaginal-culture positivity (36% vs 39%). Lactobacillus presence inversely tracked pathogens, and maternal age dominated ML prediction. Argues against routine pre-IVF microbiological culturing.",
    "monday": "Counsel / de-implement. This supports NOT reflexively culturing asymptomatic couples before IVF — culture positivity did not predict pregnancy, and partner concordance was minimal. Reserve cultures for symptomatic or clinically indicated cases rather than screening everyone.",
    "pico": {
        "P": "Infertile couples undergoing IVF with pre-cycle vaginal and semen cultures.",
        "I": "Microbiological culture characterization with ML analysis.",
        "C": "Positive vs. negative culture status.",
        "O": "Pathogen concordance and clinical pregnancy rate.",
        "D": "Retrospective comparative cohort.",
        "S": "121 culture-positive women; 134 culture-positive men.",
    },
},

# Air quality & embryo transfer — retrospective, n=190 ETs
"42136559": {
    "bottom": "Single-center retrospective during the 2023 Canadian-wildfire smoke event (190 transfers): worse EPA air-quality index on the day of embryo transfer was associated with lower clinical pregnancy rates. A provocative environmental-exposure signal, but small, single-window, and vulnerable to confounding by the many other things that change during a regional smoke event.",
    "monday": "Hold. Intriguing hypothesis that acute air pollution around transfer day harms implantation, but a 190-transfer retrospective from one smoke episode cannot drive cycle-timing decisions. Do not start rescheduling transfers around AQI on this evidence; flag as a question for larger studies.",
    "pico": {
        "P": "Patients undergoing fresh or frozen embryo transfer at one NY center (Jun-Jul 2023).",
        "I": "Air Quality Index category on transfer day (Good/Moderate/Unhealthy).",
        "C": "Across AQI strata.",
        "O": "Clinical pregnancy rate (plus biochemical, miscarriage, ectopic, live birth).",
        "D": "Retrospective cohort during a wildfire-smoke exposure window.",
        "S": "190 embryo transfers.",
    },
},

# CC/letrozole antagonist protocols — retrospective, n=565
"42130742": {
    "bottom": "Retrospective IVF cohort (565 cycles): modified antagonist protocols adding clomiphene or letrozole shortened gonadotropin duration and cut total gonadotropin dose and antagonist use versus conventional antagonist, in normal-reserve patients. A cost- and OHSS-conscious stimulation refinement — pregnancy outcomes need the full text to confirm non-inferiority.",
    "monday": "Counsel — REI-facing. Supports oral-agent-augmented (CC or letrozole) antagonist protocols as a gonadotropin-sparing, potentially OHSS-reducing option in normal-reserve IVF. A stimulation-protocol consideration for reproductive endocrinology, not a CBG/MIGS practice change.",
    "pico": {
        "P": "565 IVF/ICSI cycles in patients with normal ovarian reserve.",
        "I": "Antagonist protocol combined with clomiphene (n=217) or letrozole (n=148).",
        "C": "Conventional antagonist protocol (n=200).",
        "O": "Clinical pregnancy and live-birth rates, gonadotropin duration/dose, OHSS risk.",
        "D": "Retrospective cohort.",
        "S": "565 cycles.",
    },
},

# Endometrial prep after IUA surgery — retrospective, n=589
"42130736": {
    "bottom": "Retrospective FET cohort (589 cycles) in patients <=35 with prior intrauterine-adhesion surgery comparing HRT, natural-cycle, and down-regulation HRT endometrial preparation. A relevant question for Asherman patients — but baseline groups differed significantly, so confounding by indication clouds any protocol ranking.",
    "monday": "Hold. The post-Asherman endometrium is a genuine clinical challenge, but baseline imbalance between preparation groups here prevents a confident 'use protocol X' conclusion. Individualize endometrial preparation for adhesion-history patients; await better-controlled data before standardizing.",
    "pico": {
        "P": "Patients <=35 with prior intrauterine-adhesion separation surgery undergoing FET.",
        "I": "Hormone-replacement and down-regulation-HRT endometrial preparation.",
        "C": "Natural-cycle preparation.",
        "O": "Clinical pregnancy and reproductive outcomes.",
        "D": "Retrospective cohort with multivariable adjustment.",
        "S": "589 cycles (HRT 285, NC 200, down-reg 104).",
    },
},

# SLE oogenesis review — narrative mechanism
"42123573": {
    "bottom": "Mechanistic review of how systemic lupus erythematosus damages ovarian reserve and oocyte meiosis via chronic inflammation, hormonal disruption, and autoantibodies affecting the meiotic spindle and cytoskeleton. Background pathophysiology for counseling reproductive-age lupus patients, not a clinical-intervention study.",
    "monday": "Counsel. For reproductive-age patients with SLE, this reinforces early fertility-preservation counseling and reproductive planning, given disease- and treatment-related threats to ovarian reserve. No procedure change — a prompt to involve REI early in autoimmune patients.",
    "pico": {
        "P": "Reproductive-age women with systemic lupus erythematosus (review scope).",
        "I": "Narrative synthesis of molecular mechanisms affecting oogenesis/meiosis.",
        "C": "None.",
        "O": "Described mechanisms of ovarian/oocyte damage.",
        "D": "Narrative review.",
        "S": "Literature synthesis (no n).",
    },
},

# Fibrin matrix artificial ovary — in vitro, 282 follicles
"42123383": {
    "bottom": "In-vitro bioengineering: human follicles from cryopreserved ovarian tissue (6 patients, 282 follicles) survived at 84% over 7 days encapsulated in fibrin scaffolds of graded concentration, with growth comparable across concentrations. A translational step toward a malignant-cell-free 'artificial ovary' alternative to tissue autografting — still bench-stage.",
    "monday": "Hold — no Monday-clinic change. Early but encouraging proof-of-concept for an artificial-ovary approach that could let cancer survivors avoid reintroducing malignant cells. Relevant to the future of fertility preservation; nothing to offer patients clinically yet.",
    "pico": {
        "P": "Follicles isolated from cryopreserved ovarian tissue of 6 patients.",
        "I": "Encapsulation in fibrin scaffolds (high/medium/low concentration).",
        "C": "Across fibrin concentrations.",
        "O": "Follicle survival and diameter change after 7-day culture.",
        "D": "In-vitro morphometric study.",
        "S": "282 follicles from 6 patients.",
    },
},

# Infertility temporal meaning qualitative
"42121309": {
    "bottom": "Qualitative study framing infertility as a 'biographical disruption' and an 'extended present' oscillating between hope and uncertainty, with bodily objectification and social pressure. A reminder that infertility treatment is a psychosocial trauma process, not just a medical one.",
    "monday": "Counsel / clinician-behavior. Supports building psychosocial support and temporal sensitivity into fertility care, prioritizing the patient's emotional integrity alongside cycle outcomes. No procedural change — a care-approach prompt.",
    "pico": {
        "P": "Women undergoing infertility treatment (qualitative sample).",
        "I": "Qualitative interviews on emotional/temporal experience.",
        "C": "None.",
        "O": "Themes of meaning-making and psychosocial impact.",
        "D": "Qualitative study.",
        "S": "Interview cohort (n not specified in abstract).",
    },
},

# Psychiatric history & IUI distress — n=90
"42117558": {
    "bottom": "Cross-sectional study (n=90): 37% of women starting IUI had a lifetime Axis I disorder (mostly mood/anxiety), and those women reported significantly higher baseline depression and stress. Argues for psychological screening at the start of fertility treatment, when distress is already elevated.",
    "monday": "Counsel / screen. Reasonable to incorporate brief psychological screening at fertility-treatment onset, since a third of patients carry a psychiatric history that predicts higher treatment-related distress. Low-cost, supports timely mental-health referral. Not a CBG/MIGS change.",
    "pico": {
        "P": "90 women initiating intrauterine insemination at an academic center.",
        "I": "Structured psychiatric interview (SCID) plus BDI/PSS distress measures.",
        "C": "Psychiatric-history-positive vs. -negative.",
        "O": "Prevalence of lifetime disorders and association with distress.",
        "D": "Cross-sectional study.",
        "S": "90 women.",
    },
},

# UK ART perceptions survey — n=562
"42117546": {
    "bottom": "UK-wide thematic survey (562 respondents): most women reported no concerns about maternal/child health after ART, with residual concerns focused on maternal reproductive/cancer/endocrine and child neurodevelopmental outcomes, and broad support for national-database outcome studies. A patient-information and research-acceptability signal.",
    "monday": "Counsel. Useful for shaping how we counsel ART patients about long-term outcomes and for justifying registry-based outcome research. No clinical-management change.",
    "pico": {
        "P": "562 UK women who had undergone, were considering, or conceived without ART.",
        "I": "Anonymous cross-sectional survey with thematic analysis.",
        "C": "None.",
        "O": "Perceptions of long-term ART outcomes and information needs.",
        "D": "Cross-sectional qualitative-quantitative survey.",
        "S": "562 respondents.",
    },
},

# Microfluidic sperm sorting vs DGC — retrospective, n>2000 cycles
"42116698": {
    "bottom": "Large retrospective ICSI comparison (1,091 ZyMot vs 1,176 density-gradient cycles): microfluidic sorting yielded lower sperm DNA fragmentation, higher motility, modestly higher fertilization (81% vs 79%) and notably more day-5 blastocysts (25.6% vs 18.3%). Lab-endpoint gains are real; whether they translate to higher live birth needs the full text.",
    "monday": "Counsel — andrology/embryology-facing. Supports microfluidic sperm sorting as a reasonable lab technique with better DNA-integrity and blastulation endpoints. A laboratory-process consideration for the IVF team, not a clinical procedure change for the gynecologic surgeon.",
    "pico": {
        "P": "ICSI cycles using autologous or donor oocytes (2,267 cycles).",
        "I": "Microfluidic sperm sorting (ZyMot).",
        "C": "Density-gradient centrifugation.",
        "O": "DNA fragmentation, fertilization, blastulation, euploidy, pregnancy/live birth.",
        "D": "Retrospective comparative study.",
        "S": "1,091 ZyMot and 1,176 DGC cycles.",
    },
},

# Oncofertility review — narrative
"42114985": {
    "bottom": "Review of how expanding cancer therapies — beyond classic DNA-damaging agents to targeted antibodies, kinase inhibitors, and immunotherapies — carry variable and often poorly-characterized fertility risk, underscoring the oncology-REI partnership of oncofertility. A counseling and care-coordination framework.",
    "monday": "Counsel / referral. Reinforces urgent fertility-preservation referral before gonadotoxic therapy and honest acknowledgment that newer targeted/immune agents have uncertain reproductive effects. The actionable point: refer early and counsel about uncertainty rather than assuming low risk.",
    "pico": {
        "P": "Reproductive-age patients facing tumor-directed therapy (review scope).",
        "I": "Narrative synthesis of fertility-preservation options by treatment modality.",
        "C": "None.",
        "O": "Fertility risk and preservation strategies by therapy class.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Preeclampsia screening after ART — review
"42113617": {
    "bottom": "Review highlighting that ART pregnancies — especially frozen embryo transfer in artificial (programmed) cycles — carry elevated preeclampsia risk, and that the endometrial-preparation method itself alters uterine-artery pulsatility index, potentially distorting first-trimester preeclampsia screening. A subtle but important screening-accuracy caveat.",
    "monday": "Counsel. When interpreting first-trimester preeclampsia screening in ART pregnancies, account for the conception route — programmed FET (absent corpus luteum) both raises preeclampsia risk and may shift uterine-artery Doppler values used in screening. A reason to flag conception method to maternal-fetal medicine.",
    "pico": {
        "P": "Pregnancies conceived via assisted reproductive technology (review scope).",
        "I": "Discussion of first-trimester preeclampsia screening including uterine-artery PI.",
        "C": "Natural vs. artificial-cycle FET considerations.",
        "O": "Preeclampsia risk and screening-performance implications.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Oocyte cryopreservation success — observational, n=93 retrievals
"42113610": {
    "bottom": "Observational evaluation of 93 oocyte retrievals for elective vitrification, stratified by age (<35 vs >=35) and oocyte number (<4 vs >=4): survival 61.5-89.3%, with predictably better metrics in younger women and higher oocyte yields. Confirms the well-established age-and-number drivers of elective egg-freezing success.",
    "monday": "Counsel. Reinforces the central elective-freezing counseling points: freeze younger, aim for an adequate oocyte number, and set realistic expectations that success scales with age and yield. No new practice — useful, concrete numbers for the egg-freezing conversation.",
    "pico": {
        "P": "Women undergoing oocyte retrieval for elective vitrification (plus donor comparison).",
        "I": "Oocyte vitrification and long-term storage.",
        "C": "Age strata (<35 vs >=35) and oocyte-number strata (<4 vs >=4); anonymous donors.",
        "O": "Survival, fertilization, and utilization rates.",
        "D": "Observational evaluation.",
        "S": "93 oocyte retrievals.",
    },
},

# Progesterone duration & blastocyst stage FET — retrospective, n=2058
"42109745": {
    "bottom": "Strong retrospective cohort (2,058 single day-6 blastocyst FETs): overall live birth was similar for day-6 vs day-7 progesterone, but a significant interaction emerged — early-stage (3-4) blastocysts did worse with the longer day-7 progesterone exposure (37% vs 46%, adjusted OR 0.70). A clinically actionable embryo-progesterone synchronization signal.",
    "monday": "Counsel — REI-facing. The actionable nugget: progesterone exposure duration before FET should be matched to blastocyst expansion stage, since early-stage day-6 blastocysts are penalized by over-long progesterone. A lab/REI scheduling refinement worth raising, not a gynecologic-surgery change.",
    "pico": {
        "P": "2,058 women undergoing single frozen-thawed day-6 blastocyst transfer (2021-2024).",
        "I": "Day-7 progesterone exposure before transfer.",
        "C": "Day-6 progesterone exposure.",
        "O": "Live birth rate, with interaction by blastocyst expansion stage.",
        "D": "Retrospective cohort with formal interaction testing.",
        "S": "2,058 transfers.",
    },
},

# IUI ML prediction models — n=957
"42109740": {
    "bottom": "Development study of logistic-regression, random-forest, and neural-network models to predict IUI clinical pregnancy (957 cycles): all three showed only modest, comparable discrimination. The honest result is that IUI success remains hard to predict, and ML did not meaningfully beat regression.",
    "monday": "Hold. No deployable prediction tool here — modest AUCs mean these models can't reliably individualize IUI counseling yet. A reminder to temper enthusiasm for 'AI predicts your success' claims in fertility care.",
    "pico": {
        "P": "957 intrauterine-insemination cycles.",
        "I": "Random-forest and multilayer-perceptron prediction models.",
        "C": "Logistic regression.",
        "O": "Clinical-pregnancy prediction (AUC) and SHAP interpretability.",
        "D": "Model-development study with cross-validation.",
        "S": "957 cycles.",
    },
},

# ROS in diminished ovarian reserve — review
"42109737": {
    "bottom": "Mechanistic review positioning ROS-mediated oxidative stress as a common hub in diminished ovarian reserve, integrating aging, metabolic, environmental, and iatrogenic insults, with mitochondrial-targeted antioxidants as the proposed intervention axis. Background pathophysiology, not clinical evidence.",
    "monday": "Hold — no Monday-clinic change. Do not translate this into recommending antioxidant supplements for diminished reserve; the review frames mechanism and future targets, not proven therapy. Counsel patients that no supplement reliably restores ovarian reserve.",
    "pico": {
        "P": "Patients with diminished ovarian reserve (review scope).",
        "I": "Narrative synthesis of ROS mechanisms and antioxidant strategies.",
        "C": "None.",
        "O": "Described oxidative-stress mechanisms and intervention concepts.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# HSG 2h vs 24h delayed films — prospective comparative, n~400
"42124335": {
    "bottom": "Prospective comparison of 2-hour vs 24-hour delayed HSG films against hysteroscopy-chromopertubation reference (194 vs 203 patients): both delayed timings agreed only moderately with the reference (kappa ~0.6) but performed equivalently to each other, with no pregnancy-rate difference. Supports shortening the HSG protocol to a 2-hour delay.",
    "monday": "Counsel / efficiency. Where delayed HSG films are used, this supports a 2-hour delay rather than 24 hours without losing diagnostic accuracy — a workflow convenience for patients. The broader caveat stands: HSG agrees only moderately with direct tubal assessment.",
    "monday_note": "",
},

# ============================ PCOS ============================

# Angiopoietin-like protein-3 PCOS metabolic syndrome — n=95
"42138933": {
    "bottom": "Small prospective study (50 PCOS / 45 controls) assessing angiopoietin-like protein-3 as a discriminator of metabolic syndrome within PCOS, with a 15-patient MetS-positive subgroup. Exploratory biomarker work — far too small and unvalidated to enter clinical use.",
    "monday": "Hold. No role for ANGPTL3 testing in PCOS — this is preliminary discovery work. Continue standard metabolic-syndrome screening (lipids, glucose/insulin, blood pressure, waist circumference) in PCOS patients, which this paper does not replace.",
    "pico": {
        "P": "50 women with PCOS and 45 controls.",
        "I": "Serum angiopoietin-like protein-3 measurement.",
        "C": "Controls; MetS-positive vs. -negative PCOS subgroups.",
        "O": "ANGPTL3 discrimination of metabolic syndrome in PCOS.",
        "D": "Prospective case-control study.",
        "S": "95 women.",
    },
},

# Bone turnover non-obese PCOS — cross-sectional, n=174
"42138865": {
    "bottom": "Cross-sectional study (82 non-obese PCOS / 92 controls): PCOS women had significantly lower vitamin D and lower bone-turnover markers (P1NP, beta-CTX), suggesting reduced bone remodeling. Hypothesis-generating link between PCOS and altered bone metabolism, independent of obesity.",
    "monday": "Hold / counsel. Not a reason to order bone-turnover markers in PCOS, but a prompt to attend to vitamin D status and long-term bone health in these patients. Standard vitamin-D repletion and lifestyle counseling apply; the bone-turnover finding is research-stage.",
    "pico": {
        "P": "174 women 18-35 with menstrual irregularity (82 PCOS, 92 controls), non-obese.",
        "I": "Serum 25-OH vitamin D, P1NP, and beta-CTX measurement.",
        "C": "Non-PCOS controls.",
        "O": "Differences in vitamin D and bone-turnover markers.",
        "D": "Cross-sectional study.",
        "S": "174 women.",
    },
},

# Zinc/copper PCOS — cross-sectional
"42137979": {
    "bottom": "Cross-sectional study correlating serum zinc and copper (and Cu/Zn ratio) with PCOS metabolic subgroups: elevated Cu and Cu/Zn ratio in insulin-resistant PCOS, lower Zn/Cu with body-mass excess and subclinical inflammation. Adds to the trace-element-in-PCOS literature without establishing causation or a clinical test.",
    "monday": "Hold. No indication to measure zinc or copper in PCOS workup. Interesting associations with insulin resistance and inflammation, but nowhere near actionable — manage PCOS metabolics with established tools.",
    "pico": {
        "P": "Women with PCOS stratified by metabolic phenotype.",
        "I": "Serum zinc and copper measurement.",
        "C": "Within-PCOS metabolic subgroups.",
        "O": "Trace-element correlations with metabolic, inflammatory, hormonal variables.",
        "D": "Cross-sectional study.",
        "S": "PCOS cohort (n not specified in abstract).",
    },
},

# Vitamin D + myo-inositol + melatonin PCOS — review
"42130739": {
    "bottom": "Mechanistic review proposing vitamin D, myo-inositol, and melatonin as a synergistic 'redox-endocrine' bioactive cocktail in PCOS, each acting on insulin resistance, inflammation, and oxidative stress. Coherent biology, but a synthesis of mostly preclinical/isolated-agent data — not trial evidence for the combination.",
    "monday": "Counsel cautiously. Myo-inositol and vitamin D have some standing in PCOS metabolic management; this review is a hypothesis for combination therapy, not proof. If patients ask, frame these as adjuncts with modest individual evidence, and do not over-promise a synergistic 'cocktail' that hasn't been trialed.",
    "pico": {
        "P": "Women with PCOS (review scope).",
        "I": "Narrative synthesis of vitamin D, myo-inositol, and melatonin, alone and combined.",
        "C": "None.",
        "O": "Proposed synergistic mechanisms on the redox-endocrine network.",
        "D": "Critical narrative review.",
        "S": "Literature synthesis.",
    },
},

# Adiponectin adolescent PCOS — meta-analysis, n=1590
"42123535": {
    "bottom": "PRISMA meta-analysis (18 studies, 1,590 participants): adolescents with PCOS had significantly lower adiponectin than controls (MD -3.19 ug/mL) but with very high heterogeneity (I2 &gt;90%). Confirms in adolescents the low-adiponectin pattern long known in adults, while the extreme heterogeneity limits a precise effect estimate.",
    "monday": "Hold / context. Reinforces the adiponectin-linked metabolic phenotype of PCOS extending into adolescence, supporting early metabolic vigilance in adolescent PCOS. Adiponectin itself is not a clinical test to order; the actionable message is early metabolic screening in young PCOS patients.",
    "pico": {
        "P": "Post-pubertal adolescents with PCOS vs. controls across 18 studies.",
        "I": "Adiponectin measurement.",
        "C": "Non-PCOS adolescent controls.",
        "O": "Pooled mean difference in adiponectin.",
        "D": "Systematic review and random-effects meta-analysis (PRISMA).",
        "S": "1,590 participants.",
    },
},

# Shared PCOS/T2DM gene networks — bioinformatics
"42109727": {
    "bottom": "Bioinformatic GEO-dataset analysis identifying shared immune/inflammatory gene networks between PCOS and type 2 diabetes, with predicted candidate drugs. Mechanistic in-silico work supporting the established bidirectional PCOS-T2DM link, with no clinical readout.",
    "monday": "Counsel — known link, no new action. Reinforces aggressive long-term diabetes-risk screening and prevention in PCOS, which is already standard. The gene-network and drug-prediction findings are hypothesis-generating only.",
    "pico": {
        "P": "PCOS and T2DM transcriptomic datasets (GSE34526, GSE25724).",
        "I": "Differential-expression and pathway/drug-prediction bioinformatics with experimental validation.",
        "C": "Disease vs. control samples.",
        "O": "Shared immune-inflammatory genes/pathways and candidate drugs.",
        "D": "Bioinformatics study with experimental validation.",
        "S": "Public microarray datasets.",
    },
},

# GnRH pump PCOS pregnancy — case report
"42137358": {
    "bottom": "Case of a normal-BMI, normal-LH PCOS patient who failed letrozole+hMG but achieved ovulation and pregnancy with pulsatile GnRH pump therapy and no OHSS. A reminder that pulsatile GnRH remains a niche but useful option for selected ovulation-induction-resistant patients.",
    "monday": "Counsel / refer. For the occasional PCOS patient resistant to standard ovulation induction, pulsatile GnRH pump therapy is a legitimate alternative worth raising with reproductive endocrinology — particularly given the low OHSS risk. A single case, so an option to know about, not a new pathway.",
    "pico": {
        "P": "28-year-old PCOS patient with normal BMI and LH, resistant to letrozole+hMG.",
        "I": "Pulsatile GnRH pump therapy.",
        "C": "Prior failed letrozole+hMG (within-patient).",
        "O": "Ovulation and pregnancy without OHSS.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# ============================ MENOPAUSE / MIDLIFE ============================

# Obesity + endocrine therapy HR+ breast cancer — retrospective, n=5094
"42144406": {
    "bottom": "Large multicenter retrospective (5,094 premenopausal HR+/HER2- breast cancers): obesity was an independent predictor of worse disease-free survival even after PSM and adjustment, with hints of differential response to SERM endocrine therapy by BMI. Subtype-specific prognostic weight of obesity in young breast-cancer patients.",
    "monday": "Counsel — oncology-adjacent. For gynecologists managing menopausal/endocrine issues in breast-cancer survivors, this reinforces weight as a modifiable prognostic factor and the importance of coordinated endocrine-therapy decisions. Not a gynecologic-procedure change; relevant to survivorship counseling.",
    "pico": {
        "P": "5,094 premenopausal women with early-stage HR+/HER2- breast cancer (42 Chinese centers, 2016-2021).",
        "I": "Obesity (BMI category) and endocrine-therapy type.",
        "C": "Normal-weight and other BMI groups (propensity-matched).",
        "O": "Disease-free survival.",
        "D": "Multicenter retrospective cohort with PSM and Cox regression.",
        "S": "5,094 women.",
    },
},

# Creatine postmenopausal — meta-analysis (pico + applicability)
"42141930": {
    "pico": {
        "P": "Postmenopausal women aged >=40-45 across RCTs (608 participants).",
        "I": "Creatine monohydrate supplementation, with or without resistance training, >=6 weeks.",
        "C": "Placebo (with/without resistance training).",
        "O": "DXA lean mass, 1RM strength, bone mineral density, physical function, safety.",
        "D": "Systematic review and random-effects meta-analysis of placebo-controlled RCTs.",
        "S": "608 participants.",
    },
    "applic": "Directly applicable to the postmenopausal women we counsel on sarcopenia and bone loss. Creatine monohydrate is inexpensive, well-tolerated, and over-the-counter, and the population here — women >=40-45 past menopause — matches a large fraction of a gynecology practice. The main applicability caveat is that benefits are most consistent when creatine is paired with resistance training, so the evidence applies best to patients who will also exercise, not to supplementation alone.",
},

# Testosterone and bone health in men — review
"42141303": {
    "bottom": "Review of testosterone's role in male skeletal health: low testosterone and estradiol associate with lower BMD/bone quality in men, and testosterone therapy improves bone density, though fracture-reduction evidence is limited. Male-focused — peripheral to a gynecology practice except as background on androgen-bone biology.",
    "monday": "Hold — outside gynecologic scope. No Monday-clinic gynecologic application. Relevant only as androgen-physiology background; do not extrapolate male testosterone-bone data to women.",
    "pico": {
        "P": "Adult men (review scope on testosterone and bone).",
        "I": "Testosterone therapy / endogenous sex-steroid levels.",
        "C": "Lower vs. higher sex-steroid concentrations.",
        "O": "Bone mineral density, bone quality, fracture risk.",
        "D": "Narrative review of population studies and trials.",
        "S": "Literature synthesis.",
    },
},

# Salivary free testosterone POP — case-control, n=175
"42138067": {
    "bottom": "Prospective case-control (109 POP / 66 controls): the POP group had higher BMI and parity; the study tests whether salivary free testosterone and estradiol track prolapse severity by POP-Q. An exploratory hunt for a POP biomarker — parity and BMI remain the dominant, already-known risk factors.",
    "monday": "Hold. No salivary-hormone test belongs in prolapse evaluation; POP is diagnosed and staged clinically by POP-Q exam. Interesting hormone-biology question, but parity and BMI — not androgen assays — are what we counsel and act on.",
    "pico": {
        "P": "109 postmenopausal women with POP and 66 age-matched controls.",
        "I": "Salivary free testosterone, salivary 17-beta-estradiol, serum DHEA-S.",
        "C": "Women without POP.",
        "O": "Association of hormone levels with POP-Q severity and LUTS.",
        "D": "Prospective case-control study.",
        "S": "175 women.",
    },
},

# Free/bioavailable testosterone & NAFLD postmenopausal — prospective, n=1705
"42137350": {
    "bottom": "Community prospective cohort (1,705 postmenopausal women, 5,269 person-years): higher free and bioavailable testosterone — not total testosterone — associated with absence of NAFLD progression. A nuanced endocrine-metabolic signal that the testosterone fraction matters more than the total.",
    "monday": "Hold / counsel. Not a reason to measure testosterone fractions for liver risk, but reinforces the metabolic-health conversation in postmenopausal women and the general principle that bioavailable hormone fractions can diverge from totals. Manage NAFLD risk through standard metabolic levers.",
    "pico": {
        "P": "1,705 postmenopausal women followed for 5,269 person-years.",
        "I": "Serum total, free (calculated), and bioavailable testosterone.",
        "C": "Within-cohort exposure gradients.",
        "O": "NAFLD development vs. regression.",
        "D": "Community-based prospective cohort.",
        "S": "1,705 women.",
    },
},

# Menopause group consultations military — feasibility
"42134920": {
    "bottom": "Feasibility service evaluation of a 5-session menopause group-consultation series in a UK Armed Forces population (10 participants): acceptable and perceived as improving symptom knowledge and confidence in a resource-limited occupational setting. Small and uncontrolled, but a plausible scalable model for menopause care delivery.",
    "monday": "Counsel / service-design. For systems strained on women's-health access, group menopause consultations are a reasonable, acceptable delivery model to pilot. Not an individual-management change — an access-and-delivery idea with feasibility-level support.",
    "pico": {
        "P": "10 menopausal women in a UK Armed Forces primary-care setting.",
        "I": "Five-session menopause group-consultation series.",
        "C": "Pre/post within-participant comparison.",
        "O": "Acceptability, symptom scores (GCS, Meno-D), confidence/knowledge.",
        "D": "Feasibility service evaluation.",
        "S": "10 participants.",
    },
},

# Age at menopause & chronic pain — UK Biobank (pico + applicability)
"42134914": {
    "pico": {
        "P": "94,988 postmenopausal women in UK Biobank (2006-2010).",
        "I": "Age at menopause (years) as exposure.",
        "C": "Across the age-at-menopause distribution.",
        "O": "Chronic-pain severity (number of pain sites), with mediation by depression, anxiety, sleep, BMI, cognition.",
        "D": "Historical cohort with Bayesian mediation modeling.",
        "S": "94,988 women.",
    },
    "applic": "Broadly applicable to the midlife women we counsel, given the very large, population-representative UK Biobank sample. The finding that earlier menopause links to greater chronic-pain burden — partly mediated by mood, sleep, and BMI — supports a holistic midlife assessment rather than treating pain in isolation. The main applicability caveat is that UK Biobank skews healthier and less diverse than the general population, and the observational design means the menopause-to-pain pathway is associational, not proven causal — so use it to inform counseling and screening, not to promise that any single intervention will reverse the pain.",
},

# rUTI prevention premenopausal — scoping review
"42132404": {
    "bottom": "Scoping review (78 publications) mapping non-antibiotic prevention strategies for recurrent UTI in premenopausal women, motivated by antimicrobial-resistance concerns and the weak existing evidence base. Catalogs options (behavioral, cranberry, hydration, etc.) but explicitly notes the evidence is too thin for firm guideline inclusion.",
    "monday": "Counsel. Supports offering non-antibiotic prevention (increased hydration, behavioral measures, and discussing cranberry/methenamine where appropriate) as reasonable first steps in premenopausal rUTI to reduce antibiotic exposure, while being honest that the evidence is limited. Reserve antibiotic prophylaxis for refractory cases.",
    "pico": {
        "P": "Premenopausal women with recurrent UTI (review scope).",
        "I": "Non-antibiotic preventive strategies.",
        "C": "Antibiotic prophylaxis (contextual).",
        "O": "Mapped recommendations and evidence gaps.",
        "D": "Scoping review.",
        "S": "78 included publications.",
    },
},

# Reproductive factors & CKD postmenopausal — NHANES cross-sectional
"42128617": {
    "bottom": "NHANES population analysis (12,912 postmenopausal women): higher parity associated with modestly increased CKD odds (5+ births OR 1.22). A population-association signal consistent with the idea that reproductive history carries small long-term renal-risk imprints — not a basis for individual prediction.",
    "monday": "Hold / counsel. Parity's small association with CKD doesn't change management, but supports attention to long-term cardiovascular-renal health in high-parity postmenopausal women. Standard renal-risk screening applies; this is epidemiologic context.",
    "pico": {
        "P": "12,912 postmenopausal women in NHANES (1999-2020).",
        "I": "Reproductive factors (parity, etc.) as exposures.",
        "C": "Lower-parity reference groups.",
        "O": "Chronic kidney disease (eGFR <60 or ACR >=30).",
        "D": "Population-based cross-sectional analysis with survey weighting.",
        "S": "12,912 women.",
    },
},

# Muscle/fat mass & uric acid — longitudinal, n=39505
"42128394": {
    "bottom": "Large 2-year longitudinal cohort (39,505 adults): rising skeletal-muscle index lowered serum uric acid while rising fat mass and waist-hip ratio raised it, dose-dependently, across men and pre/postmenopausal women. Reinforces body-composition (not just weight) as a lever on metabolic markers.",
    "monday": "Counsel. Supports the broad metabolic-health message we give midlife women: building/preserving muscle and reducing central adiposity improves metabolic markers including uric acid. General lifestyle counseling reinforcement, not gynecology-specific.",
    "pico": {
        "P": "39,505 adults (incl. pre/postmenopausal women) with serial health checkups.",
        "I": "2-year changes in skeletal-muscle, fat-mass, and waist-hip indices.",
        "C": "Tertiles of increase/decrease/no change.",
        "O": "Serum uric acid change and optimal-level attainment.",
        "D": "Longitudinal cohort with bioimpedance body composition.",
        "S": "39,505 adults.",
    },
},

# Intermittent fasting menopause — narrative review
"42123946": {
    "bottom": "Narrative review of intermittent fasting's metabolic effects (metabolic switching, ketosis, insulin sensitivity) with attention to sexual dimorphism and the menopausal transition. Synthesizes mechanism and some clinical data but offers no menopause-specific trial conclusions.",
    "monday": "Counsel cautiously. Intermittent fasting is a reasonable option among dietary approaches for metabolic health in midlife women, but this review does not establish menopause-specific superiority or safety. Individualize, and avoid presenting IF as a uniquely effective menopausal strategy.",
    "pico": {
        "P": "Adults across the menopausal transition (review scope).",
        "I": "Intermittent fasting regimens.",
        "C": "Other dietary patterns (contextual).",
        "O": "Metabolic, cardiovascular, and physical effects; safety/tolerability.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Testosterone-dominant vagina epithelium — in vitro
"42121849": {
    "bottom": "In-vitro reconstructed vaginal-epithelium study characterizing histologic and immune changes under estrogen- vs testosterone-dominant conditions — relevant to postmenopausal, transgender-men-on-testosterone, and other androgen-dominant vaginal states. Mechanistic groundwork for understanding genitourinary changes beyond simple estrogen deficiency.",
    "monday": "Hold / counsel. No clinical action, but useful biology for counseling testosterone-exposed patients (transmasculine individuals, some postmenopausal states) about vaginal epithelial and barrier changes. Mechanistic, not therapeutic.",
    "pico": {
        "P": "In-vitro reconstructed human vaginal epithelial tissue model.",
        "I": "Testosterone-dominant hormonal milieu.",
        "C": "Estrogen-dominant milieu.",
        "O": "Histological and immunological epithelial barrier changes.",
        "D": "In-vitro translational study.",
        "S": "Cell/tissue model (no human n).",
    },
},

# HRV & vasomotor symptoms — meta-analysis (3 studies)
"42121335": {
    "bottom": "Systematic review with only 3 studies meta-analyzable: no significant difference in heart-rate-variability low-frequency power between menopausal women with and without vasomotor symptoms. Essentially a null/underpowered result on the autonomic-dysfunction hypothesis for hot flashes.",
    "monday": "Hold. No clinical application — too few studies, no clear HRV-VMS association. Manage vasomotor symptoms with established therapies (MHT, non-hormonal options); HRV has no role here.",
    "pico": {
        "P": "Peri/postmenopausal women with vs. without vasomotor symptoms across studies.",
        "I": "Heart-rate-variability assessment.",
        "C": "Women without vasomotor symptoms.",
        "O": "Pooled HRV differences (e.g., low-frequency power).",
        "D": "Systematic review and meta-analysis.",
        "S": "3 studies meta-analyzed.",
    },
},

# Plant adaptogen serum skin — open-label, 16 wk
"42117281": {
    "bottom": "16-week open-label, uncontrolled multicenter cosmetic study of a 13-adaptogen serum for perimenopausal/postmenopausal skin changes, reporting investigator-rated improvements in lines, elastosis, and texture. Open-label with no placebo — essentially marketing-grade evidence given the high placebo response of cosmetic endpoints.",
    "monday": "Hold — no clinical endorsement. Open-label cosmetic data with no control arm cannot support recommending this serum. If patients ask, note the absence of placebo-controlled evidence; skin changes of menopause are better addressed through established dermatologic measures.",
    "pico": {
        "P": "Women >=46 with photoaging/menopausal skin changes (FST I-VI).",
        "I": "Twice-daily plant-adaptogen serum (MYS-REV) for 16 weeks.",
        "C": "None (open-label, no placebo).",
        "O": "Investigator-rated wrinkles, elastosis, texture; hydration, TEWL.",
        "D": "Open-label multicenter study.",
        "S": "Cohort (n not specified in abstract).",
    },
},

# Polyphenol foods nutrigenomics postmenopausal
"42116480": {
    "bottom": "Nutrigenomics study: 2 months of daily polyphenol-rich foods (dark chocolate, green tea, mixed fruit juice) modified expression of cardiometabolic-linked genes in postmenopausal women. A mechanistic gene-expression signal supporting a plausible benefit of polyphenol-rich diet — clinical endpoints not measured.",
    "monday": "Counsel. Consistent with general advice that a polyphenol-rich, plant-forward diet supports cardiometabolic health in postmenopausal women. Reinforces dietary counseling; the gene-expression findings are mechanistic, not outcome data.",
    "pico": {
        "P": "Postmenopausal women.",
        "I": "Daily polyphenol-rich foods (dark chocolate, green tea, mixed-fruit juice) for 2 months.",
        "C": "Within-subject pre- vs. post-consumption.",
        "O": "Differentially expressed cardiometabolic-linked genes.",
        "D": "Nutrigenomic intervention study.",
        "S": "Postmenopausal cohort (no n in abstract).",
    },
},

# RA nursing program on hormone therapy — RCT, n=80
"42116353": {
    "bottom": "RCT (n=80) of an action-research nursing program for rheumatoid-arthritis patients on long-term steroids, measuring glucose control, compliance, pain, disease activity, and mood. A nursing-intervention trial outside gynecologic scope — 'hormone therapy' here means corticosteroids, not menopausal hormone therapy.",
    "monday": "Hold — outside gynecologic scope. No gynecologic application; the 'hormone therapy' is RA corticosteroid treatment. Included only by keyword overlap; no Monday-clinic relevance for the gynecologic surgeon.",
    "pico": {
        "P": "80 rheumatoid-arthritis patients on long-term corticosteroid therapy.",
        "I": "Action-research-based nursing program.",
        "C": "Conventional nursing care.",
        "O": "Blood glucose, compliance, pain (VAS), DAS28, anxiety/depression.",
        "D": "Randomized controlled trial.",
        "S": "80 patients.",
    },
},

# Menopause symptom severity & QoL — systematic review
"42113329": {
    "bottom": "Systematic review synthesizing the association between menopausal-symptom severity and quality of life across the transition, aiming to resolve prior inconsistencies. Confirms the intuitive and well-established link — worse symptoms, worse QoL — while noting heterogeneity across studies.",
    "monday": "Counsel. Reinforces taking symptom burden seriously as a QoL issue worth treating, not minimizing. Supports proactive symptom assessment and management across the menopausal transition. No new tool — a validation of patient-centered menopause care.",
    "pico": {
        "P": "Women across the menopausal transition (review scope).",
        "I": "Assessment of menopausal-symptom severity.",
        "C": "Across symptom-severity levels.",
        "O": "Quality-of-life association.",
        "D": "Systematic review.",
        "S": "Multiple studies (n not specified).",
    },
},

# Lichen sclerosus pre/post menopause — retrospective, n=287
"42110676": {
    "bottom": "Retrospective series (287 women): vulvar lichen sclerosus presented differently by menopausal status — atrophy and anatomical deformity predominated in older/postmenopausal women, dyspareunia in younger, with pruritus common to both, and 87% of cases over age 50. Useful phenotyping for a frequently-missed vulvar condition.",
    "monday": "Counsel / recognition. Reinforces examining the vulva carefully and keeping lichen sclerosus high on the differential — presenting as atrophy/architectural change in older women and dyspareunia in younger ones. Early recognition and potent topical steroids prevent scarring and reduce malignancy risk. A genuine practice reinforcement for vulvar care.",
    "pico": {
        "P": "287 women with biopsy-diagnosed vulvar lichen sclerosus (2009-2023, Brazil).",
        "I": "Comparison of clinical presentation by menopausal status.",
        "C": "Premenopausal vs. postmenopausal patients.",
        "O": "Symptom and presentation patterns, comorbidities, management.",
        "D": "Retrospective analytical study.",
        "S": "287 women.",
    },
},

# Gut microbiota perimenopausal atherosclerosis — review
"42109721": {
    "bottom": "Review proposing an 'estrogen-gut-vascular axis' to explain rising atherosclerosis risk in perimenopause: falling estrogen impairs the gut barrier and shifts microbial metabolites (lower SCFAs, more pro-inflammatory metabolites), accelerating atherogenesis. A mechanistic hypothesis to reconcile the estrogen-cardioprotection paradox.",
    "monday": "Hold / counsel. No clinical action — this is a mechanistic framework, not therapy. Continue evidence-based cardiovascular-risk management in perimenopausal women; the microbiome-targeting ideas are speculative.",
    "pico": {
        "P": "Perimenopausal women (review scope on atherosclerosis).",
        "I": "Narrative synthesis of the estrogen-gut-vascular axis.",
        "C": "None.",
        "O": "Proposed mechanisms linking estrogen decline, microbiota, and atherogenesis.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Episodic vestibular syndrome midlife women — cross-sectional, n=93
"42108535": {
    "bottom": "Cross-sectional neurotology study (93 midlife women, 40-65) with isolated episodic vertigo: episodes were frequent, brief, motion-triggered, and commonly tied to headache (55%) and emotional distress, with associations to migraine and climacteric symptoms. A reminder that midlife dizziness often sits at the migraine-menopause intersection.",
    "monday": "Counsel / refer. When a midlife woman reports episodic vertigo, consider the vestibular-migraine and menopause-transition overlap rather than attributing it solely to one cause; refer to neurotology when persistent. Peripheral to gynecologic surgery but relevant to whole-patient midlife care.",
    "pico": {
        "P": "93 women 40-65 with recurrent spontaneous vestibular symptoms and no hearing loss.",
        "I": "Structured interview plus DHI, Menopause Rating Scale, MIDAS.",
        "C": "None (descriptive).",
        "O": "Clinical features and associations with migraine and menopausal symptoms.",
        "D": "Cross-sectional study.",
        "S": "93 patients.",
    },
},

# THA on testosterone replacement — retrospective, n=152
"42108328": {
    "bottom": "Retrospective orthopedic cohort (152 hypogonadal men on TRT, 1:2 matched): evaluates 90-day ED visits, readmissions, reoperations after total hip arthroplasty. Male orthopedic surgery — outside gynecologic scope, included only via the 'testosterone replacement' keyword.",
    "monday": "Hold — outside gynecologic scope. No gynecologic Monday-clinic relevance. A male-orthopedics TRT-safety study captured by keyword overlap.",
    "pico": {
        "P": "152 hypogonadal men on testosterone replacement undergoing elective total hip arthroplasty.",
        "I": "Testosterone replacement therapy.",
        "C": "1:2 propensity-matched non-TRT patients.",
        "O": "90-day ED visits, readmissions, reoperations, revisions.",
        "D": "Retrospective matched cohort.",
        "S": "152 patients.",
    },
},

# ============================ OBSTETRIC / CESAREAN / SCAR ============================

# Racial differences antenatal periviable — population cohort
"42144379": {
    "bottom": "Population-based NCHS cohort study of periviable deliveries (20-25 weeks, 2016-2021) examining racial differences in receipt of guideline-recommended antenatal interventions (corticosteroids, antibiotics, cesarean). An equity-surveillance study documenting disparities in periviable obstetric care.",
    "monday": "Counsel / systems. The actionable message is equity vigilance — ensure guideline-concordant antenatal interventions are offered without racial disparity. Obstetric/systems-level; not a gynecologic-surgery change, but central to equitable care.",
    "pico": {
        "P": "Periviable singleton deliveries (20w0d-25w6d) in the US NCHS database (2016-2021).",
        "I": "Self-reported maternal race as exposure.",
        "C": "Non-Hispanic White reference.",
        "O": "Receipt of antenatal corticosteroids, antibiotics, cesarean.",
        "D": "Population-based cohort study.",
        "S": "National periviable-delivery cohort.",
    },
},

# Acquired hemophilia A in pregnancy — case report
"42139377": {
    "bottom": "Case of pregnancy-associated acquired hemophilia A found at preoperative cesarean evaluation, managed with bypassing agents alone (no prior immunosuppression) because hypertensive nephropathy forced urgent delivery, with good maternal/neonatal outcomes and controlled intraoperative hemostasis. A rare-but-instructive coagulopathy-at-cesarean scenario.",
    "monday": "Counsel / awareness. For the surgeon, the lesson is recognizing acquired hemophilia A on abnormal preoperative coagulation studies and knowing that bypassing agents can secure hemostasis for urgent delivery when immunosuppression isn't yet feasible. A hematology-coordination point for a rare emergency.",
    "pico": {
        "P": "Pregnant patient with acquired hemophilia A requiring urgent cesarean (hypertensive nephropathy).",
        "I": "Bypassing-agent hemostatic management without prior immunosuppression.",
        "C": "None (single case).",
        "O": "Intraoperative hemostasis, maternal and neonatal outcomes.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# Targeted mobilization after cesarean — RCT, n=64
"42138935": {
    "bottom": "RCT (n=64): a structured mobilization program starting 6 hours after cesarean and continuing 48 hours sped gastrointestinal recovery versus routine care. Consistent with ERAS principles that early, structured mobilization improves post-cesarean recovery — small but methodologically clean.",
    "monday": "Counsel — ERAS-aligned. Supports protocolized early mobilization after cesarean as a simple, low-cost recovery intervention, consistent with enhanced-recovery pathways. Reasonable to incorporate into post-cesarean order sets.",
    "pico": {
        "P": "64 women undergoing elective cesarean (Turkey).",
        "I": "Structured mobilization program from 6h postop for 48h, plus routine care.",
        "C": "Routine care alone.",
        "O": "GI recovery, abdominal distension, pain (VAS), breastfeeding outcomes.",
        "D": "Randomized controlled trial.",
        "S": "64 women (32 per arm).",
    },
},

# Phenylephrine ED50 tilt vs supine cesarean — RCT, n=80
"42137121": {
    "bottom": "Randomized up-and-down dose-finding study (n=80): determined the median effective phenylephrine-infusion dose to prevent spinal-induced hypotension at cesarean in 15-degree left tilt vs supine. An anesthesia dose-optimization study testing whether left uterine displacement reduces vasopressor need.",
    "monday": "Hold — anesthesia-facing. No gynecologic-surgery change; relevant to obstetric-anesthesia vasopressor protocols and the long-debated value of left uterine displacement. Of interest to anesthesia colleagues, not actionable for the surgeon.",
    "pico": {
        "P": "80 women undergoing elective cesarean under combined spinal-epidural.",
        "I": "Prophylactic phenylephrine infusion in 15-degree left tilt.",
        "C": "Supine position.",
        "O": "Median effective phenylephrine dose (ED50) preventing hypotension.",
        "D": "Randomized up-and-down dose-finding trial.",
        "S": "80 women.",
    },
},

# Wound complications after cesarean in GDM — prediction model, n=600
"42136168": {
    "bottom": "Retrospective prediction-model study (600 GDM cesareans, 18% wound-complication rate): built and validated a model from age, BMI, hypertension, HbA1c, albumin, and time-to-first-ambulation. A reasonable risk-stratification tool, but single-center and retrospective, needing external validation.",
    "monday": "Counsel / risk-awareness. The component risk factors — higher BMI, poorer glycemic control (HbA1c), low albumin, delayed ambulation — are clinically sensible targets to optimize in GDM patients before/after cesarean. Use the risk factors to guide wound vigilance and early mobilization; the model itself isn't ready for routine deployment.",
    "pico": {
        "P": "600 women with gestational diabetes undergoing cesarean (2022-2025).",
        "I": "Prediction model from clinical/laboratory variables.",
        "C": "Training vs. validation split (7:3).",
        "O": "Postoperative wound complications.",
        "D": "Retrospective prediction-model development and validation.",
        "S": "600 women.",
    },
},

# ============================ SCAR / KELOID / WOUND ============================

# Scar dermatoses review (case report tag)
"42144014": {
    "bottom": "Review of scar dermatoses — Koebner, Wolf's isotopic response, and Renbok phenomena — explaining why some skin diseases preferentially arise in scars. Dermatologic background relevant to understanding cutaneous changes at surgical and cesarean scars.",
    "monday": "Hold / awareness. No procedural change, but a useful framework for recognizing that new lesions at a surgical scar may be a scar-localized dermatosis rather than infection or recurrence. Refer atypical scar lesions to dermatology.",
    "pico": {
        "P": "Patients with dermatoses arising in scars (review scope).",
        "I": "Literature synthesis of scar-dermatosis phenomena.",
        "C": "None.",
        "O": "Described mechanisms (Koebner, Wolf, Renbok).",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Disposable infusion-set cryosurgery keloids — technique
"42139579": {
    "bottom": "Technical note describing an economical intralesional-cryosurgery delivery method adapting a disposable infusion set to a standard cryospray nozzle for keloids/hypertrophic scars. A cost-reduction workaround for an existing dermatologic procedure — outside gynecologic surgical practice.",
    "monday": "Hold — outside gynecologic scope. A dermatology procedural cost-saving tip with no gynecologic application. Included via the keloid/scar topic sweep.",
    "pico": {
        "P": "Patients with keloids or hypertrophic scars (technique description).",
        "I": "Disposable-infusion-set-adapted intralesional cryosurgery.",
        "C": "Conventional costly cryoprobes (contextual).",
        "O": "Procedural feasibility, cost, safety.",
        "D": "Technical note.",
        "S": "Not applicable.",
    },
},

# POSTN+ fibroblasts SPP1+ macrophages scar — review
"42138176": {
    "bottom": "Mechanistic review of POSTN+ fibroblasts and SPP1+ macrophages as key interacting drivers of scar formation, with their crosstalk a potential therapeutic target. Basic fibrosis biology — relevant background to wound-healing/scar research, no clinical readout.",
    "monday": "Hold — no Monday-clinic change. Fibrosis-mechanism review with no current clinical application to surgical-scar management.",
    "pico": {
        "P": "Scar/wound-healing models (review scope).",
        "I": "Synthesis of POSTN+ fibroblast / SPP1+ macrophage biology.",
        "C": "None.",
        "O": "Described mechanisms and candidate therapeutic targets.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Split-thickness graft maturation — observational, n=22 scars
"42130408": {
    "bottom": "Small observational study (22 graft scars) tracking elasticity, pliability, erythema, and pigmentation of split-thickness skin grafts over 12 months, comparing deep-dermal vs muscular wound beds. Plastic/reconstructive surgery scope — no gynecologic application.",
    "monday": "Hold — outside gynecologic scope. Reconstructive-surgery scar-maturation data with no gynecologic-surgery relevance.",
    "pico": {
        "P": "22 split-thickness graft scars (17 deep-dermal, 5 muscular wound beds).",
        "I": "Serial assessment over 12 months.",
        "C": "Deep-dermal vs. muscular wound bed.",
        "O": "Scar-scale scores, elasticity, pliability, erythema, melanin.",
        "D": "Observational longitudinal study.",
        "S": "22 graft scars.",
    },
},

# Cryotherapy + steroid keloid — meta-analysis
"42130027": {
    "bottom": "Systematic review/meta-analysis of cryotherapy plus intralesional steroid versus controls for keloids/hypertrophic scars, pooling scar-improvement and adverse-event data across RCTs and prospective studies. Dermatologic-treatment evidence — outside gynecologic surgical practice.",
    "monday": "Hold — outside gynecologic scope. A dermatology scar-therapy meta-analysis with no gynecologic application.",
    "pico": {
        "P": "Patients with keloids or hypertrophic scars across included trials.",
        "I": "Cryotherapy plus intralesional steroid.",
        "C": "Control treatments.",
        "O": "Scar-improvement rate, excellent-response rate, adverse events.",
        "D": "Systematic review and meta-analysis.",
        "S": "Pooled RCTs/prospective studies.",
    },
},

# Refractory keloid immune mechanisms — review
"42121883": {
    "bottom": "Review framing refractory keloids/hypertrophic scars as driven by immune and neuroimmune dysregulation (sustained IL-6/TNF-alpha/TGF-beta/IL-17 signaling) rather than purely mechanical factors. Fibroproliferative-disease mechanism — outside gynecologic scope.",
    "monday": "Hold — outside gynecologic scope. Dermatologic mechanism review with no gynecologic-surgery application.",
    "pico": {
        "P": "Patients with refractory keloids/hypertrophic scars (review scope).",
        "I": "Synthesis of immune/neuroimmune mechanisms of treatment failure.",
        "C": "None.",
        "O": "Described cytokine and neuroimmune pathways.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Mechanical forces & inflammatory immunity keloid — review
"42112383": {
    "bottom": "Review of how mechanical forces interact with chronic inflammation and profibrotic signaling (M2 macrophages, Th2/Th17) to drive keloid formation and recurrence. Mechanistic dermatologic/fibrosis review — outside gynecologic scope.",
    "monday": "Hold — outside gynecologic scope. Keloid-pathogenesis review captured by topic sweep; no gynecologic-surgery relevance.",
    "pico": {
        "P": "Keloid pathophysiology (review scope).",
        "I": "Synthesis of mechanotransduction and immune mechanisms.",
        "C": "None.",
        "O": "Described mechanical-immune interactions in keloid formation.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
},

# Betamethasone vs triamcinolone HTS — retrospective, n=126
"42108543": {
    "bottom": "Retrospective comparison (126 patients) of intralesional compound betamethasone vs triamcinolone for hypertrophic scars, with 6-month efficacy, safety, and recurrence outcomes. Dermatologic-injection comparison — outside gynecologic surgical scope.",
    "monday": "Hold — outside gynecologic scope. A dermatology intralesional-steroid comparison with no gynecologic-surgery application.",
    "pico": {
        "P": "126 patients with hypertrophic scars.",
        "I": "Intralesional compound betamethasone (n=63).",
        "C": "Intralesional triamcinolone acetonide (n=63).",
        "O": "Efficacy, safety, 6-month recurrence.",
        "D": "Retrospective comparative analysis.",
        "S": "126 patients.",
    },
},

# ============================ ICG / FLUORESCENCE / ADJACENT SURGERY ============================

# Hepatic spectral CT ICG reserve — retrospective, n=24
"42136333": {
    "bottom": "Small retrospective study (24 patients) correlating dual-layer spectral-CT iodine concentration and extracellular volume with indocyanine-green clearance as a measure of hepatic functional reserve. Hepatology/radiology scope — captured only via the 'indocyanine green' keyword shared with gyn-surgery fluorescence imaging.",
    "monday": "Hold — outside gynecologic scope. No gynecologic application; an ICG-keyword overlap with hepatic-imaging research.",
    "pico": {
        "P": "24 patients undergoing triphasic abdominal spectral CT.",
        "I": "Spectral-CT iodine-concentration and extracellular-volume mapping.",
        "C": "Correlation with ICG clearance-test parameters.",
        "O": "Association of imaging parameters with hepatic functional reserve.",
        "D": "Retrospective study.",
        "S": "24 patients.",
    },
},

# Peripapillary CNV — case series, ophthalmology
"42132463": {
    "bottom": "Multicenter retrospective ophthalmology case series (156 eyes) characterizing peripapillary choroidal neovascularization etiologies (AMD, pachychoroid, angioid streaks) and outcomes, using indocyanine-green angiography among other imaging. Ophthalmology scope — only the ICG keyword links it to gyn-surgery fluorescence.",
    "monday": "Hold — outside gynecologic scope. An ophthalmology series captured by ICG-keyword overlap; no gynecologic relevance.",
    "pico": {
        "P": "138 treatment-naive patients (156 eyes) with peripapillary CNV at 12 centers.",
        "I": "Multimodal imaging including ICG angiography.",
        "C": "Across etiologies (AMD, pachychoroid, angioid streaks).",
        "O": "CNV etiology distribution and visual outcomes.",
        "D": "Multicenter retrospective case series.",
        "S": "156 eyes.",
    },
},

# ICG gas vesicles photothermal therapy — preclinical
"42127030": {
    "bottom": "Preclinical nanomedicine study conjugating indocyanine green to biosynthetic gas vesicles for acoustically-delivered tumor photothermal therapy in a murine bladder-cancer model. Basic-science ICG-engineering — outside gynecologic scope, shares only the ICG keyword.",
    "monday": "Hold — outside gynecologic scope. A preclinical ICG-nanotechnology paper with no gynecologic application.",
    "pico": {
        "P": "Subcutaneous MB49 bladder-cancer xenografts in C57BL/6 mice.",
        "I": "ICG-conjugated biosynthetic gas vesicles for photothermal therapy.",
        "C": "Free ICG / controls.",
        "O": "Tumor targeting, imaging, photothermal efficacy, pharmacokinetics.",
        "D": "Preclinical in-vivo study.",
        "S": "Murine xenograft model.",
    },
},

# NIR-II ICG bowel perfusion — n=17 (relevant to bowel-endometriosis anastomosis assessment)
"42126680": {
    "bottom": "Surgical study (17 cases): intraoperative NIR-II ICG fluorescence angiography assessed bowel vascular morphology and inflammatory severity, giving clearer microvascular visualization than NIR-I (higher signal-to-background) and correlating with histopathologic inflammatory grade. Directly relevant to the CBG/MIGS surgeon who resects bowel for deep infiltrating endometriosis — ICG perfusion assessment of the bowel segment and anastomosis is exactly this technology, and NIR-II promises deeper, cleaner perfusion mapping than the NIR-I/ICG we use today.",
    "monday": "Watch / counsel. For bowel-endometriosis work — segmental resection, discoid excision, low anterior resection — ICG fluorescence angiography to confirm anastomotic perfusion is already an established adjunct, and NIR-II is the next-generation upgrade worth tracking. Not yet a change to your perfusion-assessment workflow, but squarely within CBG/MIGS bowel-surgery practice rather than a curiosity.",
    "pico": {
        "P": "17 children with Hirschsprung's disease undergoing pull-through surgery.",
        "I": "Intraoperative NIR-II ICG fluorescence angiography.",
        "C": "NIR-I imaging; histopathologic inflammatory grade.",
        "O": "Vessel visualization (SBR) and correlation with inflammation/outcomes.",
        "D": "Prospective surgical study with phantom experiments.",
        "S": "17 children.",
    },
},

# Robot sigmoid conduit urinary diversion — case report (relevant to CBG/MIGS urinary-tract work)
"42119081": {
    "bottom": "Case report of robot-assisted sigmoid colon conduit urinary diversion that avoided a bowel anastomosis in a patient with prior loop colostomy and pelvic radiation — 95-minute operative time, 100 mL blood loss, oral intake on POD1, discharge POD3, preserved renal function with no obstruction at 6 months. Relevant to the complex CBG/MIGS surgeon: urinary-tract reconstruction in the irradiated/frozen pelvis is the same territory we enter for ureterolysis, ureteral reimplantation, and bladder resection in deep endometriosis.",
    "monday": "Counsel / technique-awareness. For the hostile post-radiation or severe-endometriosis pelvis, a robotic anastomosis-sparing diversion is a reconstructive option worth knowing for multidisciplinary planning with urology. A single case, so awareness rather than a protocol change — but firmly within the bowel/bladder/ureter scope of complex CBG/MIGS.",
    "pico": {
        "P": "Patient with prior loop colostomy and pelvic radiation needing urinary diversion.",
        "I": "Robot-assisted sigmoid colon conduit (no bowel anastomosis).",
        "C": "None (single case).",
        "O": "Operative time, recovery, 6-month renal function.",
        "D": "Case report.",
        "S": "n=1.",
    },
},

# Pinhole pupilloplasty scarred cornea — ophthalmology case series
"42113943": {
    "bottom": "Prospective ophthalmology interventional series (25 eyes) using pinhole pupilloplasty to reduce higher-order aberrations from corneal scars, combined with phacoemulsification/IOL. Ophthalmic surgery scope — captured only via the 'scarred cornea' keyword overlap with the scar topic sweep.",
    "monday": "Hold — outside gynecologic scope. An ophthalmic surgical-technique series with no gynecologic application; included by keyword overlap.",
    "pico": {
        "P": "24 patients (25 eyes) with central/paracentral corneal scars and adjacent clear cornea.",
        "I": "Pinhole pupilloplasty with phacoemulsification and IOL implantation.",
        "C": "None (single-arm interventional series).",
        "O": "Higher-order aberrations, visual acuity, satisfaction, pupil size.",
        "D": "Prospective interventional case series.",
        "S": "25 eyes.",
    },
},

# APR vs LAR rectal resection morbidity — retrospective, n=226 (relevant to bowel-endometriosis surgery)
"42112223": {
    "bottom": "Retrospective study (226 patients): abdominoperineal resection trended toward higher post-operative septic complications (fistula, abscess) than low anterior resection, though the confidence intervals crossed 1. Relevant to the CBG/MIGS surgeon operating on rectal/rectosigmoid deep infiltrating endometriosis — the resection-level morbidity gradient (and its septic-complication drivers: comorbidity, tumor/lesion height, surgical approach) informs how we counsel and plan segmental low rectal resection vs. more conservative disc/shave techniques.",
    "monday": "Counsel / surgical-planning. The takeaway for bowel-endometriosis surgery: lower, more radical rectal resections carry a higher septic-complication burden, which strengthens the case for the least-aggressive adequate technique (shave or discoid over segmental where disease allows) and for multidisciplinary planning with colorectal surgery on low lesions. Context for shared decision-making, not a single-paper practice change.",
    "pico": {
        "P": "226 rectal-cancer patients undergoing APR or LAR (2018-2023).",
        "I": "Abdominoperineal resection.",
        "C": "Low anterior resection.",
        "O": "Early/late/overall postoperative septic complications.",
        "D": "Retrospective single-center cohort.",
        "S": "226 patients.",
    },
},

}
