# -*- coding: utf-8 -*-
"""
w20_authored.py — Hand-authored journal-club content for the W20 CBG/MIGS
Monday Mornings post (blog-2026-W20), drafted for clinician review.

Per CLAUDE.md §3.9: each entry is authored by reading the paper's verbatim
PubMed abstract individually — NOT heuristically generated. These are
CLAUDE-DRAFTED candidates for Dr. Mabini's review; they are NOT yet
§3.9-certified and must NOT be applied to the live post until reviewed and
accepted. Mirror of the w21_authored.py shape so apply_authored.py can splice
accepted entries into the dd-<PMID>-<section> blocks.

Fields per PMID:
  bottom : <p class="mz-jc-bottom"> text  (the surgeon's bottom line / TL;DR)
  monday : <p class="mz-jc-monday-take"> text (change / hold / counsel call)
  pico   : dict P/I/C/O/D/S (Population/Intervention/Comparator/Outcome/
           Design/Sample) — only where the 'pico' section is pending

Status: DRAFT — un-certified. Author of record on accept: Christopher Z.
Mabini, DO. Drafting assistant: Claude (Fable 5).
"""

AUTHORED = {

# ============================ ENDOMETRIOSIS ============================

# Post-op GnRH-a + LNG-IUS pilot, n=120, BNIP3/EPAC1 surrogate markers
"42120175": {
    "bottom": "Exploratory pilot (n=120) of post-laparoscopic GnRH-agonist alone vs GnRH-a plus levonorgestrel-IUS for endometriosis. The combined arm showed better VAS and Kupperman scores plus a molecular signal (BNIP3/EPAC1 mRNA), but allocation was by simple alternation rather than true randomization, it was single-center, and the molecular endpoints are surrogate. It reinforces, rather than changes, what is already standard: LNG-IUS as post-operative maintenance after conservative endometriosis surgery to reduce pain and recurrence.",
    "monday": "Hold / counsel. The clinical practice here &mdash; post-operative LNG-IUS suppression after conservative endometriosis surgery &mdash; is already established, and this small quasi-randomized pilot is consistent with it, not practice-changing. The BNIP3/EPAC1 markers are mechanistic curiosities with nothing to order. Keep offering LNG-IUS as post-op maintenance where appropriate.",
    "pico": {
        "P": "120 endometriosis patients undergoing laparoscopic surgery (2020&ndash;2023).",
        "I": "Post-operative GnRH-agonist (leuprorelin microspheres) plus levonorgestrel-releasing IUS.",
        "C": "Post-operative GnRH-agonist alone.",
        "O": "Response rate, VAS and Kupperman scores, FSH/E2/P/LH, BNIP3 and EPAC1 mRNA.",
        "D": "Exploratory pilot, quasi-randomized by simple alternation.",
        "S": "n = 120 (60 per arm).",
    },
},

# Bidirectional Mendelian randomization, endometriosis -> serum 25-OH vitamin D
"42116278": {
    "bottom": "Bidirectional Mendelian randomization. It found suggestive evidence that endometriosis raises serum 25-hydroxyvitamin D (a weak effect, &beta; 0.010) and NO evidence that vitamin D causally influences endometriosis risk. The translation is useful: low vitamin D is not a driver of endometriosis, and the vitamin-D&ndash;endometriosis link seen in observational work is likely reverse causation or confounding.",
    "monday": "Hold / counsel. Don&apos;t prescribe vitamin D to prevent or treat endometriosis &mdash; the genetic evidence shows no causal protective effect. Treat vitamin D deficiency on its own merits (bone health), not as an endometriosis intervention. Handy for answering the common patient question about whether supplements can &apos;cure&apos; endo.",
    "pico": {
        "P": "GWAS summary-statistic populations for 25-OH vitamin D and endometriosis.",
        "I": "Genetically-instrumented serum 25-OH vitamin D (forward) / endometriosis (reverse).",
        "C": "Not applicable &mdash; Mendelian randomization design.",
        "O": "Causal effect estimates in both directions, with heterogeneity/pleiotropy sensitivity analyses.",
        "D": "Bidirectional two-sample Mendelian randomization.",
        "S": "95 SNP instruments forward; 9 SNP instruments reverse.",
    },
},

# Ontario population cohort: endometriosis -> congenital anomalies, 1.46M births
"42114909": {
    "bottom": "The week&apos;s flagship paper: a population-based Ontario cohort of 1,460,564 births, 33,619 to patients with pre-conception endometriosis. Endometriosis was independently associated with a 16% higher relative risk of any congenital anomaly (adjusted RR 1.16, 95% CI 1.12&ndash;1.21), partly mediated by subfertility and fertility treatment. The design is strong, but the absolute difference is modest &mdash; 6.3% vs 5.4%, roughly one percentage point.",
    "monday": "Counsel, don&apos;t alarm. This is solid population data worth knowing for pre-conception counseling: endometriosis carries a small but real increase in offspring congenital-anomaly risk, partly through the infertility/ART pathway. Frame it honestly &mdash; the absolute risk rises about one point and the large majority of these infants are born without anomalies. No change to surveillance beyond standard anomaly screening, but it supports the message that endometriosis is a systemic reproductive condition, not just pelvic disease.",
    "pico": {
        "P": "1,460,564 Ontario births (2006&ndash;2021) to patients aged 15&ndash;50.",
        "I": "Maternal endometriosis diagnosed before conception.",
        "C": "No endometriosis.",
        "O": "Any/specific congenital anomaly; mediation by subfertility, ovulation induction/IUI, and IVF/ICSI.",
        "D": "Population-based cohort.",
        "S": "33,619 births to patients with endometriosis.",
    },
},

# Bartholin's gland endometrioma — case report
"42113614": {
    "bottom": "Case report of extrapelvic endometriosis in the Bartholin&apos;s gland &mdash; a 40-year-old with 10 years of cyclical Bartholin-area pain, swelling, dyspareunia, and vulvodynia, cured by excision with histologic confirmation. An extremely rare entity, but a clean reminder to keep endometriosis on the differential for a cyclical vulvar/Bartholin mass.",
    "monday": "Counsel / awareness. Keep endometriosis on the differential for a cyclical Bartholin or vulvar mass with dyspareunia &mdash; rare, but excision is both diagnostic and curative. A teaching case, not a practice change.",
    "pico": {
        "P": "40-year-old woman, two prior deliveries, 10-year cyclical Bartholin pain.",
        "I": "Primary surgical excision.",
        "C": "None.",
        "O": "Histologic diagnosis; resolution of dyspareunia and vulvodynia at 2 months.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
},

# HDAC10 inhibitors in endometriotic stromal cells — bench/mechanism
"42091420": {
    "bottom": "Bench mechanism work. HDAC10 inhibitors (tucidinostat, TH34) suppressed proliferation of human endometriotic cyst stromal cells in vitro and arrested the cell cycle, acting via re-acetylation and reactivation of the DACH1 and IRF6 genes. It is purely preclinical &mdash; cell-line only, no animal or human data &mdash; and adds HDAC10 to the long list of candidate druggable targets in endometriosis.",
    "monday": "Hold. Bench discovery only: there is no patient here and no drug to prescribe. Track HDAC-targeting as one of many experimental directions; nothing about it is actionable in clinic.",
    "pico": {
        "P": "Human endometriotic cyst stromal cells vs normal endometrial stromal cells.",
        "I": "HDAC10 inhibitors (tucidinostat, TH34); lentiviral DACH1/IRF6 overexpression.",
        "C": "Untreated cells / normal stromal cells.",
        "O": "Proliferation, cell-cycle arrest, DACH1/IRF6 expression, promoter acetylation (ChIP).",
        "D": "In-vitro mechanistic study.",
        "S": "Cell-line based (n not patient-enumerated).",
    },
},

# ============================ ADENOMYOSIS ============================

# COH protocol comparison in adenomyosis IVF, 1486 cycles
"42120313": {
    "bottom": "Real-world retrospective cohort of 1,486 IVF-ET cycles in adenomyosis patients. Long/ultra-long down-regulation protocols delivered the best fresh-cycle and cumulative pregnancy and live-birth rates; the antagonist protocol underperformed overall, but in younger patients (&lt;35) with normal reserve (AMH &ge; 1.2) it matched the long protocol with significantly less gonadotropin. It supports the long-protocol preference in adenomyosis while carving out an antagonist niche for good-prognosis younger patients.",
    "monday": "Counsel / inform (REI-facing). For adenomyosis patients in IVF, long/ultra-long protocols remain the better-outcome default, but younger patients with normal ovarian reserve can reasonably use an antagonist protocol with less gonadotropin and similar cumulative results. It&apos;s retrospective, so hypothesis-supporting rather than definitive &mdash; relevant when co-managing adenomyosis fertility patients.",
    "pico": {
        "P": "Adenomyosis patients undergoing IVF-ET (2018&ndash;2021).",
        "I": "Long / ultra-long controlled-ovarian-hyperstimulation protocols.",
        "C": "Antagonist protocol.",
        "O": "Fresh-cycle and cumulative clinical pregnancy and live-birth rates; gonadotropin dose.",
        "D": "Real-world retrospective cohort.",
        "S": "1,486 IVF-ET cycles.",
    },
},

# ============================ CHRONIC PELVIC PAIN ============================

# Behavioral-change-communication module & dysmenorrhea, Bangladesh, PSM
"42118763": {
    "bottom": "Propensity-matched cross-sectional study (98 matched pairs, Bangladeshi university students). Attending a behavioral-change-communication module was associated with a 23-percentage-point lower dysmenorrhea prevalence (ATT &minus;0.23). The design is cross-sectional and associational &mdash; it cannot establish that the module reduced pain (selection and recall bias are likely) &mdash; but it signals that low-cost menstrual-health education may help in low-resource settings.",
    "monday": "Hold / counsel. Hypothesis-generating only; a cross-sectional design can&apos;t prove the module caused lower dysmenorrhea. Don&apos;t overstate it, but it adds to the general case for menstrual-health education. No change to clinical management.",
    "pico": {
        "P": "472 female university students in Bangladesh (98 propensity-matched pairs).",
        "I": "Attendance at a behavioral-change-communication module (3 sessions).",
        "C": "Non-attenders.",
        "O": "Dysmenorrhea prevalence (average treatment effect on the treated).",
        "D": "Propensity-matched cross-sectional comparative study.",
        "S": "98 matched pairs.",
    },
},

# Menstruation & daily-life interference, Saudi adolescents
"42116345": {
    "bottom": "Cross-sectional survey of 445 Saudi secondary-school girls. Dysmenorrhea prevalence was 75%, with 84% reporting high interference in daily activities and 70% missing school. It&apos;s an epidemiologic snapshot underscoring the under-recognized functional burden of adolescent dysmenorrhea.",
    "monday": "Counsel / awareness. A reminder that adolescent dysmenorrhea is both highly prevalent and genuinely disabling (school absence) &mdash; take adolescent menstrual pain seriously, screen for it, and treat rather than dismiss. No procedural implication.",
    "pico": {
        "P": "445 secondary-school girls in Abha, Saudi Arabia.",
        "I": "Not applicable &mdash; survey (MDOT questionnaire).",
        "C": "Not applicable.",
        "O": "Dysmenorrhea prevalence/severity, daily-life interference, school absence.",
        "D": "Cross-sectional survey.",
        "S": "445.",
    },
},

# Negative laparoscopy for pelvic pain by training level, n=1309
"42104671": {
    "bottom": "Five-year retrospective cohort (1,309 women) of laparoscopy for pelvic pain. The negative-laparoscopy rate was 13% overall but 2.5&times; higher among non-fellowship-trained gynecologists than fellowship-trained ones (OR 2.48), and there was a 56% discordance between intraoperative visual impression and histopathology. It is a strong argument for both fellowship-level (MIGS) training and routine biopsy in pelvic-pain laparoscopy.",
    "monday": "Change / reinforce &mdash; squarely MIGS. Two actionable points: take biopsies (visual-only assessment missed or misclassified disease in over half of cases), and recognize that negative-laparoscopy rates are training-dependent &mdash; a concrete argument for referring complex pelvic pain to fellowship-trained surgeons. It validates biopsy-confirmed excisional practice over &apos;look and see.&apos;",
    "pico": {
        "P": "1,309 women undergoing laparoscopy for pelvic pain (Australian tertiary public + private).",
        "I": "Fellowship-trained (AGES-accredited) gynecologist.",
        "C": "Non-fellowship-trained gynecologist.",
        "O": "Negative-laparoscopy rate; visual&ndash;histologic discordance.",
        "D": "5-year retrospective cohort.",
        "S": "1,309.",
    },
},

# Emotional Freedom Technique RCT, n=65, dysmenorrhea
"42091422": {
    "bottom": "Small RCT (n=65) of Emotional Freedom Technique (EFT, &apos;tapping&apos;) vs awareness training for primary dysmenorrhea. The EFT group had reduced pain and improved quality of life. It is small, single-center, and carries high bias risk &mdash; a behavioral intervention can&apos;t be blinded and the control was attention-only &mdash; so it is best read as a low-risk adjunct some patients may find helpful.",
    "monday": "Counsel / hold. EFT is a low-risk, low-cost self-help option a motivated patient could try for primary dysmenorrhea, but the evidence is weak (small, unblinded). Offer it as one of several non-pharmacologic options, not a replacement for proven therapy.",
    "pico": {
        "P": "65 women with primary dysmenorrhea.",
        "I": "Emotional Freedom Technique (two 45&ndash;60 min sessions).",
        "C": "Dysmenorrhea awareness training + brochures.",
        "O": "Menstrual Symptom Scale, Quality of Life Scale, pain.",
        "D": "Randomized controlled trial (pretest&ndash;posttest).",
        "S": "65.",
    },
},

# Pilates tele-exercise pilot RCT, n=22, primary dysmenorrhea
"42091251": {
    "bottom": "Tiny pilot RCT (n=22) of 6-week Pilates-based tele-exercise vs no intervention for primary dysmenorrhea. The intervention group improved across symptom, attitude, and quality-of-life scales. It is very small and used an untreated comparator (which inflates the apparent effect), but the direction is consistent with the broader evidence that exercise helps dysmenorrhea.",
    "monday": "Counsel. Exercise &mdash; including home/tele-delivered Pilates &mdash; is a reasonable, low-risk recommendation for primary dysmenorrhea and aligns with existing exercise evidence. This particular n=22 trial is too small to weigh heavily, but it points the right way.",
    "pico": {
        "P": "22 women with primary dysmenorrhea.",
        "I": "6-week Pilates-based tele-exercise (twice weekly, 50 min).",
        "C": "No intervention.",
        "O": "Menstrual Symptom Questionnaire, Menstrual Attitude Questionnaire, FEDS.",
        "D": "Small pilot RCT.",
        "S": "22.",
    },
},

# ============================ UTERINE FIBROIDS ============================

# Leiomyosarcoma in pregnancy — case report
"42116313": {
    "bottom": "Case report: a 35-year-old with a presumed fibroid in pregnancy had a cesarean plus myomectomy, and pathology returned leiomyosarcoma with pulmonary metastases (stage IVB), requiring subsequent hysterectomy, BSO, and staging. It is the sobering reminder that leiomyosarcoma can masquerade as a benign fibroid and that the distinction is unreliable preoperatively.",
    "monday": "Counsel / caution &mdash; directly relevant to fibroid surgery. It reinforces the leiomyosarcoma-masquerade risk underlying the morcellation debate: you cannot reliably tell a fibroid from a sarcoma before pathology. For any atypical or rapidly-growing myoma &mdash; especially in pregnancy or the peri/postmenopausal window &mdash; counsel about the small malignancy risk, avoid uncontained morcellation, and have a tissue-containment plan. A teaching case that anchors real consent practice.",
    "pico": {
        "P": "35-year-old pregnant woman with presumed uterine fibroid.",
        "I": "Cesarean + myomectomy; then laparoscopic hysterectomy, BSO, pelvic lymphadenectomy, staging.",
        "C": "None.",
        "O": "Histologic diagnosis (leiomyosarcoma), stage IVB with pulmonary metastases.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
},

}
