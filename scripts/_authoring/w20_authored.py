# -*- coding: utf-8 -*-
"""
w20_authored.py — Hand-authored journal-club content for the W20 CBG/MIGS
Monday Mornings post (blog-2026-W20), drafted for clinician review.

Per CLAUDE.md §3.9: each entry is authored by reading the paper's verbatim
PubMed abstract individually — NOT heuristically generated. These are
CLAUDE-DRAFTED candidates for Dr. Mabini's review; they are NOT yet
§3.9-certified and must NOT be applied to the live post until reviewed and
accepted. Mirror of the apply_authored.py contract so accepted entries can be
spliced into the dd-<PMID>-<section> blocks.

W20's deep-dive template leaves 12 of 13 sections pending (only the verbatim
abstract auto-fills), so each paper carries the full section set:
  bottom        : surgeon's bottom line / TL;DR        (<p class="mz-jc-bottom">)
  question      : 1 · clinical question                (bare <p>)
  pico          : 2 · PICO  (dict P/I/C/O/D/S -> <dl>)
  methods       : 3 · methodology
  findings      : 5 · key findings
  rob           : 6 · risk of bias
  strengths     : 7 · strengths
  applicability : 8 · external validity / applicability
  kb            : 9 · where it fits in the literature (KB placement)
  equity        : 10 · equity considerations
  monday        : 11 · Monday-clinic takeaway
  prompts       : 12 · discussion prompts (block <ol>)
(Section 4, the verbatim abstract, is auto-filled per §3.7 and not authored.)

Status: DRAFT — un-certified. Author of record on accept: Christopher Z.
Mabini, DO. Drafting assistant: Claude (Fable 5).
"""

AUTHORED = {

# ============================ ENDOMETRIOSIS ============================

# Post-op GnRH-a + LNG-IUS pilot, n=120, BNIP3/EPAC1 surrogate markers
"42120175": {
    "bottom": "Exploratory pilot (n=120) of post-laparoscopic GnRH-agonist alone vs GnRH-a plus levonorgestrel-IUS for endometriosis. The combined arm showed better VAS and Kupperman scores plus a molecular signal (BNIP3/EPAC1 mRNA), but allocation was by simple alternation rather than true randomization, it was single-center, and the molecular endpoints are surrogate. It reinforces, rather than changes, what is already standard: LNG-IUS as post-operative maintenance after conservative endometriosis surgery to reduce pain and recurrence.",
    "question": "<strong>The clinical problem.</strong> Endometriosis recurs after conservative surgery, and post-operative medical suppression is used to delay that recurrence and control pain &mdash; but the optimal regimen is unsettled, and clinicians want to know whether layering a levonorgestrel IUS onto a GnRH-agonist adds benefit. <strong>The question.</strong> In patients treated surgically for endometriosis, does post-operative GnRH-a plus LNG-IUS improve symptom scores versus GnRH-a alone, and what changes in the BNIP3/EPAC1 (autophagy/cAMP) pathway accompany it?",
    "pico": {
        "P": "120 endometriosis patients undergoing laparoscopic surgery (2020&ndash;2023).",
        "I": "Post-operative GnRH-agonist (leuprorelin microspheres) plus levonorgestrel-releasing IUS.",
        "C": "Post-operative GnRH-agonist alone.",
        "O": "Response rate, VAS and Kupperman scores, FSH/E2/P/LH, BNIP3 and EPAC1 mRNA.",
        "D": "Exploratory pilot, quasi-randomized by simple alternation.",
        "S": "n = 120 (60 per arm).",
    },
    "methods": "Single-center study of 120 post-laparoscopy endometriosis patients allocated by a simple alternation scheme (not a concealed randomization sequence) to GnRH-a alone or GnRH-a + LNG-IUS, with clinical scores, serum hormones, and tissue/blood BNIP3 and EPAC1 mRNA assessed at 6 months. The molecular endpoints are mechanistic surrogates rather than patient-important outcomes.",
    "findings": "The combined group had a higher overall response rate and larger improvements in VAS and Kupperman scores (p &lt; 0.05). At 6 months it showed lower FSH, estradiol, and progesterone and higher LH, with decreased EPAC1 and increased BNIP3 mRNA versus controls. No recurrence or fertility endpoints were reported.",
    "rob": "Moderate-to-high. Allocation by alternation is predictable and breaks concealment (selection bias); there was no blinding; the study was single-center with a short horizon; and the headline novelty rests on surrogate mRNA markers rather than recurrence, pain at 12+ months, or fertility. Treat the molecular claims as hypothesis-level.",
    "strengths": "A pragmatic, clinically-framed comparison of two real post-operative regimens, a reasonable pilot sample, and the pairing of symptom scores with a candidate mechanistic readout that could seed future hypothesis-testing.",
    "applicability": "High for the clinical practice, low for the molecular claim. Post-operative LNG-IUS after conservative endometriosis surgery is already an established adjunct, so the symptom result is confirmatory and directly applicable; the BNIP3/EPAC1 signal is not yet something to measure or act on.",
    "kb": "Sits within the established post-operative hormonal-suppression literature, where LNG-IUS is documented to reduce dysmenorrhea and recurrence after conservative surgery. It adds a small molecular correlate but does not move the evidence tier.",
    "equity": "Single-center (likely Chinese) cohort with no reported breakdown by ethnicity, socioeconomic status, or access. GnRH-agonist cost and IUS access materially shape who can receive this regimen &mdash; an access dimension the study does not address.",
    "monday": "Hold / counsel. The clinical practice here &mdash; post-operative LNG-IUS suppression after conservative endometriosis surgery &mdash; is already established, and this small quasi-randomized pilot is consistent with it, not practice-changing. The BNIP3/EPAC1 markers are mechanistic curiosities with nothing to order. Keep offering LNG-IUS as post-op maintenance where appropriate.",
    "prompts": "<ol><li>Does the symptom benefit here justify GnRH-a co-administration, or would LNG-IUS alone capture most of the gain at lower cost and fewer hypoestrogenic side effects?</li><li>What patient-important endpoint (recurrence at 24 months, repeat surgery, fertility) would you want before changing practice on the basis of molecular markers?</li><li>How do you counsel a patient about GnRH-a add-back and the cost trade-off when the incremental benefit over an IUS is uncertain?</li></ol>",
},

# Bidirectional Mendelian randomization, endometriosis -> serum 25-OH vitamin D
"42116278": {
    "bottom": "Bidirectional Mendelian randomization. It found suggestive evidence that endometriosis raises serum 25-hydroxyvitamin D (a weak effect, &beta; 0.010) and NO evidence that vitamin D causally influences endometriosis risk. The translation is useful: low vitamin D is not a driver of endometriosis, and the vitamin-D&ndash;endometriosis link seen in observational work is likely reverse causation or confounding.",
    "question": "<strong>The clinical problem.</strong> Observational studies repeatedly link low vitamin D with endometriosis, which fuels patient interest in supplementation &mdash; but observational designs cannot separate cause from consequence or confounding. <strong>The question.</strong> Using genetic instruments, is serum 25-OH vitamin D a causal risk factor for endometriosis, or is any association better explained by endometriosis influencing vitamin D (reverse causation)?",
    "pico": {
        "P": "GWAS summary-statistic populations for 25-OH vitamin D and endometriosis.",
        "I": "Genetically-instrumented serum 25-OH vitamin D (forward) / endometriosis (reverse).",
        "C": "Not applicable &mdash; Mendelian randomization design.",
        "O": "Causal effect estimates in both directions, with heterogeneity/pleiotropy sensitivity analyses.",
        "D": "Bidirectional two-sample Mendelian randomization.",
        "S": "95 SNP instruments forward; 9 SNP instruments reverse.",
    },
    "methods": "Two-sample bidirectional MR using 95 SNPs as instruments for vitamin D (forward) and 9 for endometriosis (reverse), with heterogeneity and pleiotropy sensitivity analyses. MR leverages randomly-assorted germline variants to approximate a natural randomization, reducing confounding and reverse-causation bias inherent to observational data.",
    "findings": "Forward MR showed no causal effect of 25-OH vitamin D on endometriosis. Reverse MR showed suggestive evidence that endometriosis raises serum 25-OH vitamin D (&beta; 0.010, 95% CI 0.002&ndash;0.02, P = .016) &mdash; a statistically present but biologically small effect.",
    "rob": "Low-to-moderate for the causal-direction question, which is MR's strength. Caveats: the reverse instrument set is small (9 SNPs), the effect size is tiny and only &apos;suggestive,&apos; and MR assumes valid instruments with no horizontal pleiotropy &mdash; partially addressed here by sensitivity analyses.",
    "strengths": "The design directly attacks the confounding/reverse-causation problem that plagues the observational vitamin-D literature, tests both directions, and reports sensitivity analyses. It gives a cleaner causal answer than any observational cohort could.",
    "applicability": "Directly applicable to counseling. It argues against vitamin D as an endometriosis-modifying intervention while leaving deficiency-correction for bone health untouched.",
    "kb": "Slots into the growing MR literature reframing several endometriosis &apos;risk factors&apos; as consequences or confounded associations. Consistent with the broader message that endometriosis is a systemic condition with downstream metabolic signatures.",
    "equity": "MR estimates derive predominantly from European-ancestry GWAS, so causal estimates may not transport to other ancestries &mdash; a recurring external-validity limit of the method that the abstract does not resolve.",
    "monday": "Hold / counsel. Don&apos;t prescribe vitamin D to prevent or treat endometriosis &mdash; the genetic evidence shows no causal protective effect. Treat vitamin D deficiency on its own merits (bone health), not as an endometriosis intervention. Handy for answering the common patient question about whether supplements can &apos;cure&apos; endo.",
    "prompts": "<ol><li>How do you reframe a patient&apos;s expectation that vitamin D will treat their endometriosis without dismissing the value of correcting true deficiency?</li><li>What does it change, if anything, that endometriosis may slightly raise vitamin D rather than the reverse?</li><li>Where else in your counseling do observational &apos;risk factors&apos; deserve an MR-style skepticism?</li></ol>",
},

# Ontario population cohort: endometriosis -> congenital anomalies, 1.46M births
"42114909": {
    "bottom": "The week&apos;s flagship paper: a population-based Ontario cohort of 1,460,564 births, 33,619 to patients with pre-conception endometriosis. Endometriosis was independently associated with a 16% higher relative risk of any congenital anomaly (adjusted RR 1.16, 95% CI 1.12&ndash;1.21), partly mediated by subfertility and fertility treatment. The design is strong, but the absolute difference is modest &mdash; 6.3% vs 5.4%, roughly one percentage point.",
    "question": "<strong>The clinical problem.</strong> Maternal chronic conditions are recognized contributors to congenital-anomaly risk, but endometriosis &mdash; a common reproductive condition tightly linked to subfertility and fertility treatment &mdash; has rarely been studied as an exposure. <strong>The question.</strong> Do infants of patients with pre-conception endometriosis have a higher risk of congenital anomalies, and how much of any excess is mediated by subfertility versus the fertility treatments themselves?",
    "pico": {
        "P": "1,460,564 Ontario births (2006&ndash;2021) to patients aged 15&ndash;50.",
        "I": "Maternal endometriosis diagnosed before conception.",
        "C": "No endometriosis.",
        "O": "Any/specific congenital anomaly; mediation by subfertility, ovulation induction/IUI, and IVF/ICSI.",
        "D": "Population-based cohort.",
        "S": "33,619 births to patients with endometriosis.",
    },
    "methods": "Population-based linkage study of all Ontario births &ge;20 weeks over 15 years, comparing infants of patients with vs without pre-conception endometriosis, with formal mediation analysis partitioning the association through subfertility, ovulation induction/IUI, and IVF/ICSI. The near-complete provincial denominator minimizes selection bias.",
    "findings": "Congenital anomalies occurred in 6.3% of infants of patients with endometriosis vs 5.4% without (adjusted RR 1.16, 95% CI 1.12&ndash;1.21). Specific anomalies carried higher point estimates (e.g., unspecified cleft palate aRR 1.52). A portion of the association was mediated by subfertility and fertility treatment.",
    "rob": "Low for an observational design: very large, population-based, near-complete ascertainment, adjusted and mediation-analyzed. Residual confounding by indication and shared risk factors (maternal age, comorbidity) cannot be fully excluded, and administrative endometriosis coding may misclassify exposure.",
    "strengths": "Enormous sample with a near-complete provincial denominator, 15-year span, formal mediation analysis separating the condition from its treatments, and adjusted estimates &mdash; a far stronger design than prior small series.",
    "applicability": "Highly applicable to pre-conception counseling in any comparable health system. The effect is a population-level signal; it informs counseling, not individual prediction.",
    "kb": "A landmark addition placing endometriosis among maternal conditions with measurable offspring sequelae, and reinforcing the systemic framing of endometriosis beyond pelvic pain and infertility.",
    "equity": "Single-payer Ontario data improve generalizability within that system but may not transport to settings with different ART access. The absolute-vs-relative framing matters for equity: communicating a 16% relative rise without the ~1-point absolute context risks disproportionate alarm.",
    "monday": "Counsel, don&apos;t alarm. This is solid population data worth knowing for pre-conception counseling: endometriosis carries a small but real increase in offspring congenital-anomaly risk, partly through the infertility/ART pathway. Frame it honestly &mdash; the absolute risk rises about one point and the large majority of these infants are born without anomalies. No change to surveillance beyond standard anomaly screening.",
    "prompts": "<ol><li>How do you communicate a 16% relative risk increase against a ~1 percentage-point absolute difference without causing disproportionate anxiety?</li><li>If part of the risk is mediated by fertility treatment, how should that nuance enter ART counseling for patients with endometriosis?</li><li>Does this change anything about your anomaly-screening recommendations, or only your counseling?</li></ol>",
},

# Bartholin's gland endometrioma — case report
"42113614": {
    "bottom": "Case report of extrapelvic endometriosis in the Bartholin&apos;s gland &mdash; a 40-year-old with 10 years of cyclical Bartholin-area pain, swelling, dyspareunia, and vulvodynia, cured by excision with histologic confirmation. An extremely rare entity, but a clean reminder to keep endometriosis on the differential for a cyclical vulvar/Bartholin mass.",
    "question": "<strong>The clinical problem.</strong> Cyclical vulvar pain and a recurrent Bartholin-area swelling are usually attributed to cysts or abscesses, and endometriosis at this site is so rare it is seldom considered &mdash; risking repeated drainage of a lesion that needs excision. <strong>The question.</strong> Can extrapelvic endometriosis present as an isolated Bartholin-gland lesion, and is excision diagnostic and curative?",
    "pico": {
        "P": "40-year-old woman, two prior deliveries, 10-year cyclical Bartholin pain.",
        "I": "Primary surgical excision.",
        "C": "None.",
        "O": "Histologic diagnosis; resolution of dyspareunia and vulvodynia at 2 months.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
    "methods": "Single descriptive case report with operative and pathohistologic documentation and a 2-month follow-up examination. As an n=1 report it characterizes a phenomenon rather than testing a hypothesis.",
    "findings": "Excision of the Bartholin-area lesion yielded histologically-proven endometriosis, with complete resolution of dyspareunia and vulvodynia at 2-month follow-up.",
    "rob": "Not applicable in the cohort sense; the limitation is inherent to a single case &mdash; no generalizable rate, no comparator, and publication bias toward unusual presentations.",
    "strengths": "Clear clinico-pathologic correlation and a clean illustrative teaching point about a recognized but very rare site of extrapelvic endometriosis.",
    "applicability": "Narrow but useful: it sharpens the differential for a cyclical Bartholin/vulvar mass, particularly when symptoms are catamenial and recur after simple drainage.",
    "kb": "Adds to the scattered case literature on extrapelvic/vulvar endometriosis, reinforcing that endometriosis can implant well outside the classic pelvic distribution.",
    "equity": "n=1; no representativeness claim. The broader equity point is diagnostic delay &mdash; rare vulvar presentations are easily missed, lengthening time to correct treatment.",
    "monday": "Counsel / awareness. Keep endometriosis on the differential for a cyclical Bartholin or vulvar mass with dyspareunia &mdash; rare, but excision is both diagnostic and curative. A teaching case, not a practice change.",
    "prompts": "<ol><li>In a patient with a recurrent, catamenial Bartholin swelling, when do you move from repeated drainage to excisional biopsy?</li><li>How does extrapelvic endometriosis at unusual sites reshape your mental model of the disease&apos;s distribution?</li><li>What features of a vulvar mass would prompt you to send tissue rather than assume a simple cyst?</li></ol>",
},

# HDAC10 inhibitors in endometriotic stromal cells — bench/mechanism
"42091420": {
    "bottom": "Bench mechanism work. HDAC10 inhibitors (tucidinostat, TH34) suppressed proliferation of human endometriotic cyst stromal cells in vitro and arrested the cell cycle, acting via re-acetylation and reactivation of the DACH1 and IRF6 genes. It is purely preclinical &mdash; cell-line only, no animal or human data &mdash; and adds HDAC10 to the long list of candidate druggable targets in endometriosis.",
    "question": "<strong>The clinical problem.</strong> Medical therapy for endometriosis is dominated by hormonal suppression, which fails some patients and is incompatible with conception; non-hormonal, lesion-directed targets remain an unmet need. <strong>The question.</strong> Does HDAC10 contribute to endometriotic stromal-cell proliferation, and can HDAC10 inhibition suppress it through identifiable target genes?",
    "pico": {
        "P": "Human endometriotic cyst stromal cells vs normal endometrial stromal cells.",
        "I": "HDAC10 inhibitors (tucidinostat, TH34); lentiviral DACH1/IRF6 overexpression.",
        "C": "Untreated cells / normal stromal cells.",
        "O": "Proliferation, cell-cycle arrest, DACH1/IRF6 expression, promoter acetylation (ChIP).",
        "D": "In-vitro mechanistic study.",
        "S": "Cell-line based (n not patient-enumerated).",
    },
    "methods": "In-vitro assays of proliferation and cell cycle in endometriotic cyst stromal cells treated with two HDAC10 inhibitors, RNA-seq target identification, lentiviral overexpression of candidate genes, and ChIP for promoter acetylation. No in-vivo or clinical component.",
    "findings": "Both inhibitors suppressed proliferation and produced G0/G1 arrest; DACH1 and IRF6 were identified as HDAC10 targets; inhibitor treatment increased acetylation at their promoters, implicating epigenetic silencing of DACH1/IRF6 in endometriosis pathogenesis.",
    "rob": "Inherent preclinical limits: cell-line system, no animal model, no clinical correlation, and the inhibitors used are not endometriosis-selective. Mechanistically coherent but far from therapeutic evidence.",
    "strengths": "A clean mechanistic chain &mdash; phenotype, target identification, functional validation, and epigenetic readout &mdash; that identifies a plausible non-hormonal pathway.",
    "applicability": "None at the bedside today; relevant only as early target-discovery that may inform future non-hormonal drug development.",
    "kb": "One more entry in the crowded endometriosis target-discovery literature; HDAC/epigenetic modulation joins many candidate pathways awaiting translational validation.",
    "equity": "No human-population dimension. The downstream equity question &mdash; whether any resulting therapy would be affordable/accessible &mdash; is premature.",
    "monday": "Hold. Bench discovery only: there is no patient here and no drug to prescribe. Track HDAC-targeting as one of many experimental directions; nothing about it is actionable in clinic.",
    "prompts": "<ol><li>What would have to be shown (animal efficacy, selectivity, safety) before an HDAC-targeting agent merited a clinical trial in endometriosis?</li><li>How do you weigh non-hormonal target discovery against the reality that most such candidates never reach clinic?</li><li>Does a fertility-compatible, non-hormonal mechanism change how excited you should be about an early target?</li></ol>",
},

# ============================ ADENOMYOSIS ============================

# COH protocol comparison in adenomyosis IVF, 1486 cycles
"42120313": {
    "bottom": "Real-world retrospective cohort of 1,486 IVF-ET cycles in adenomyosis patients. Long/ultra-long down-regulation protocols delivered the best fresh-cycle and cumulative pregnancy and live-birth rates; the antagonist protocol underperformed overall, but in younger patients (&lt;35) with normal reserve (AMH &ge; 1.2) it matched the long protocol with significantly less gonadotropin. It supports the long-protocol preference in adenomyosis while carving out an antagonist niche for good-prognosis younger patients.",
    "question": "<strong>The clinical problem.</strong> Adenomyosis lowers IVF success, and the best controlled-ovarian-stimulation protocol for these patients is debated &mdash; long down-regulation may suppress the adenomyotic milieu but at higher gonadotropin cost. <strong>The question.</strong> Among adenomyosis patients, which COH protocol yields the best fresh and cumulative pregnancy/live-birth outcomes, and does the answer differ by age and ovarian reserve?",
    "pico": {
        "P": "Adenomyosis patients undergoing IVF-ET (2018&ndash;2021).",
        "I": "Long / ultra-long controlled-ovarian-hyperstimulation protocols.",
        "C": "Antagonist protocol.",
        "O": "Fresh-cycle and cumulative clinical pregnancy and live-birth rates; gonadotropin dose.",
        "D": "Real-world retrospective cohort.",
        "S": "1,486 IVF-ET cycles.",
    },
    "methods": "Retrospective real-world cohort of 1,486 IVF-ET cycles in adenomyosis patients across COH protocols, with multivariable logistic regression for clinical and cumulative pregnancy and a pre-specified subgroup of younger patients with normal AMH. Cycle-level (not patient-level) analysis.",
    "findings": "The short-acting long protocol had the highest live-birth (47.9%) and cumulative pregnancy (68.8%) rates. The antagonist protocol had lower fresh-cycle, live-birth, and cumulative rates than long/ultra-long overall; protocol independently predicted outcomes. In patients &lt;35 with AMH &ge; 1.2, antagonist matched long protocol with less gonadotropin.",
    "rob": "Moderate. Retrospective and non-randomized, so protocol selection likely tracks prognosis (confounding by indication); cycle-level counting can double-count patients; single-center practice patterns limit transport. Regression adjustment mitigates but cannot remove allocation bias.",
    "strengths": "Large real-world sample, clinically-relevant cumulative endpoints, multivariable adjustment, and an actionable age/reserve subgroup that nuances a one-size answer.",
    "applicability": "Directly relevant to REI and to MIGS surgeons co-managing adenomyosis fertility patients, with a practical message for protocol selection by prognosis.",
    "kb": "Adds a sizable real-world dataset to the contested adenomyosis-IVF protocol literature, broadly supporting long down-regulation while refining the antagonist niche.",
    "equity": "Single-center cohort without socioeconomic or ancestry detail. Gonadotropin cost is an equity lever the subgroup finding highlights &mdash; an antagonist option with less drug could widen access for younger good-prognosis patients.",
    "monday": "Counsel / inform (REI-facing). For adenomyosis patients in IVF, long/ultra-long protocols remain the better-outcome default, but younger patients with normal ovarian reserve can reasonably use an antagonist protocol with less gonadotropin and similar cumulative results. It&apos;s retrospective, so hypothesis-supporting rather than definitive.",
    "prompts": "<ol><li>How much of the long-protocol advantage is real biology versus confounding by which patients were selected for it?</li><li>For a 32-year-old with adenomyosis and normal AMH, would the gonadotropin savings of an antagonist protocol change your recommendation?</li><li>What randomized evidence would you want before abandoning long down-regulation in adenomyosis?</li></ol>",
},

# ============================ CHRONIC PELVIC PAIN ============================

# Behavioral-change-communication module & dysmenorrhea, Bangladesh, PSM
"42118763": {
    "bottom": "Propensity-matched cross-sectional study (98 matched pairs, Bangladeshi university students). Attending a behavioral-change-communication module was associated with a 23-percentage-point lower dysmenorrhea prevalence (ATT &minus;0.23). The design is cross-sectional and associational &mdash; it cannot establish that the module reduced pain (selection and recall bias are likely) &mdash; but it signals that low-cost menstrual-health education may help in low-resource settings.",
    "question": "<strong>The clinical problem.</strong> Dysmenorrhea is the most common menstrual disorder in young women and disrupts daily life, yet sustainable non-pharmacologic strategies are under-studied, especially in low-resource settings. <strong>The question.</strong> Is attendance at a behavioral-change-communication module associated with lower dysmenorrhea prevalence among university students?",
    "pico": {
        "P": "472 female university students in Bangladesh (98 propensity-matched pairs).",
        "I": "Attendance at a behavioral-change-communication module (3 sessions).",
        "C": "Non-attenders.",
        "O": "Dysmenorrhea prevalence (average treatment effect on the treated).",
        "D": "Propensity-matched cross-sectional comparative study.",
        "S": "98 matched pairs.",
    },
    "methods": "Matched cross-sectional comparison; 1:1 nearest-neighbor propensity matching (caliper 0.01) yielding 98 pairs, with a doubly-robust estimator of the average treatment effect on the treated. The cross-sectional structure means exposure and outcome are measured together, so temporality cannot be established.",
    "findings": "Overall matched-sample dysmenorrhea prevalence was 69.4%, lower in module-exposed (61.2%) than non-exposed (77.6%) participants; the doubly-robust ATT was &minus;0.23 (95% CI &minus;0.33 to &minus;0.13, p &lt; 0.001).",
    "rob": "High for causal inference. Cross-sectional timing cannot separate cause from effect; self-selection into the module is likely correlated with health behavior; dysmenorrhea is self-reported. Propensity matching balances measured covariates only.",
    "strengths": "Thoughtful analytic rigor for an observational design (propensity matching plus a doubly-robust estimator), a relevant low-resource setting, and a clinically meaningful effect size if causal.",
    "applicability": "Generalizable to similar educational settings as a hypothesis, not as proof. It supports investing in menstrual-health education but should not be cited as established efficacy.",
    "kb": "Joins the non-pharmacologic dysmenorrhea literature, where education and behavioral interventions show promise but lack high-quality randomized confirmation.",
    "equity": "Squarely an equity-oriented study &mdash; it targets a low-resource setting and a low-cost, scalable intervention, which is its main appeal even with weak causal inference.",
    "monday": "Hold / counsel. Hypothesis-generating only; a cross-sectional design can&apos;t prove the module caused lower dysmenorrhea. Don&apos;t overstate it, but it adds to the general case for menstrual-health education. No change to clinical management.",
    "prompts": "<ol><li>What would a cluster-randomized version of this study need to look like to support scale-up?</li><li>How much of the 23-point difference is plausibly self-selection rather than the module?</li><li>Where do low-cost educational interventions fit alongside pharmacologic management of dysmenorrhea?</li></ol>",
},

# Menstruation & daily-life interference, Saudi adolescents
"42116345": {
    "bottom": "Cross-sectional survey of 445 Saudi secondary-school girls. Dysmenorrhea prevalence was 75%, with 84% reporting high interference in daily activities and 70% missing school. It&apos;s an epidemiologic snapshot underscoring the under-recognized functional burden of adolescent dysmenorrhea.",
    "question": "<strong>The clinical problem.</strong> Adolescent dysmenorrhea is common but frequently normalized and undertreated, and its true functional toll &mdash; on school attendance and daily activity &mdash; is poorly quantified in many populations. <strong>The question.</strong> What is the prevalence of dysmenorrhea among secondary-school girls in Abha, and how strongly is it associated with interference in daily life?",
    "pico": {
        "P": "445 secondary-school girls in Abha, Saudi Arabia.",
        "I": "Not applicable &mdash; survey (MDOT questionnaire).",
        "C": "Not applicable.",
        "O": "Dysmenorrhea prevalence/severity, daily-life interference, school absence.",
        "D": "Cross-sectional survey.",
        "S": "445.",
    },
    "methods": "Cross-sectional self-administered MDOT-questionnaire survey of 445 schoolgirls, with chi-square and multivariable logistic regression to identify symptoms independently associated with high daily-life interference. Self-report, single-city sampling.",
    "findings": "One in three reported irregular menstruation; dysmenorrhea prevalence was 75.3% (25% severe). High daily-life interference was reported by 83.9% and school absence by 70.3%; dysmenorrhea was associated with limited physical activity (OR 1.67, 95% CI 1.04&ndash;2.68).",
    "rob": "Typical cross-sectional survey limits: self-report and recall bias, single-city sampling limiting generalizability, and association-only inference. Prevalence estimates are nonetheless informative.",
    "strengths": "A validated questionnaire, a clear functional-impact focus (school absence, activity limitation), and a reasonable sample for a prevalence snapshot.",
    "applicability": "Generalizes best to similar adolescent populations; the headline message &mdash; high prevalence and high functional impact &mdash; travels widely as a call to take adolescent dysmenorrhea seriously.",
    "kb": "Adds regional prevalence data to the global adolescent-dysmenorrhea literature, consistent with high prevalence and substantial school/activity impact reported elsewhere.",
    "equity": "Highlights an under-served adolescent group and a culturally-specific setting where menstrual symptoms may be under-disclosed; the school-absence finding has direct educational-equity implications.",
    "monday": "Counsel / awareness. A reminder that adolescent dysmenorrhea is both highly prevalent and genuinely disabling (school absence) &mdash; take adolescent menstrual pain seriously, screen for it, and treat rather than dismiss. No procedural implication.",
    "prompts": "<ol><li>How can clinicians and schools partner to reduce dysmenorrhea-related absenteeism?</li><li>What is the threshold at which &apos;normal&apos; period pain should trigger evaluation for secondary causes in an adolescent?</li><li>How do cultural factors shape disclosure and treatment-seeking for menstrual pain in this population?</li></ol>",
},

# Negative laparoscopy for pelvic pain by training level, n=1309
"42104671": {
    "bottom": "Five-year retrospective cohort (1,309 women) of laparoscopy for pelvic pain. The negative-laparoscopy rate was 13% overall but 2.5&times; higher among non-fellowship-trained gynecologists than fellowship-trained ones (OR 2.48), and there was a 56% discordance between intraoperative visual impression and histopathology. It is a strong argument for both fellowship-level (MIGS) training and routine biopsy in pelvic-pain laparoscopy.",
    "question": "<strong>The clinical problem.</strong> Laparoscopy for pelvic pain that returns &apos;negative&apos; carries real surgical morbidity, cost, and diagnostic dead-ends &mdash; and a visually &apos;normal&apos; pelvis may still harbor biopsy-proven endometriosis. <strong>The question.</strong> What is the incidence of negative laparoscopy for pelvic pain, and does it vary by surgeon training level and the use of biopsy?",
    "pico": {
        "P": "1,309 women undergoing laparoscopy for pelvic pain (Australian tertiary public + private).",
        "I": "Fellowship-trained (AGES-accredited) gynecologist.",
        "C": "Non-fellowship-trained gynecologist.",
        "O": "Negative-laparoscopy rate; visual&ndash;histologic discordance.",
        "D": "5-year retrospective cohort.",
        "S": "1,309.",
    },
    "methods": "Retrospective 5-year cohort across one public hospital (mixed fellowship/non-fellowship surgeons) and one private fellowship clinic, defining negative laparoscopy visually or by vision-plus-negative-biopsy, and comparing rates by training and sector via odds ratios.",
    "findings": "174/1,309 (13%) were negative. Non-fellowship-trained surgeons had a higher negative rate (OR 2.48, 95% CI 1.76&ndash;3.43). Visually-negative-only assessments (no biopsy) were concentrated in the public sector and among non-fellowship surgeons; visual-histologic findings were discordant in 56% of cases.",
    "rob": "Moderate. Retrospective and single-network, with case-mix and referral differences between fellowship and non-fellowship surgeons that could partly explain the gap. The biopsy-discordance finding is, however, hard to explain away and is the most actionable result.",
    "strengths": "Large, multi-year, real-world surgical cohort directly comparing training levels and biopsy practice, with a clinically piercing discordance statistic that reframes &apos;visual&apos; diagnosis.",
    "applicability": "Highly applicable to MIGS practice and referral patterns &mdash; it supports biopsy-confirmed assessment and fellowship-level surgery for complex pelvic pain.",
    "kb": "Reinforces the established teaching that visual-only laparoscopy under-detects and misclassifies endometriosis, and links diagnostic yield to surgeon training &mdash; central to the case for MIGS subspecialization.",
    "equity": "The public-vs-private and training-level gradient is itself an access-equity finding: patients in the public sector were more likely to receive visual-only, lower-yield laparoscopy &mdash; a disparity in diagnostic quality.",
    "monday": "Change / reinforce &mdash; squarely MIGS. Two actionable points: take biopsies (visual-only assessment missed or misclassified disease in over half of cases), and recognize that negative-laparoscopy rates are training-dependent &mdash; a concrete argument for referring complex pelvic pain to fellowship-trained surgeons. It validates biopsy-confirmed excisional practice over &apos;look and see.&apos;",
    "prompts": "<ol><li>Should biopsy of a visually &apos;normal&apos; pelvis be standard in every pelvic-pain laparoscopy?</li><li>How should this training-level gradient influence referral pathways for complex pelvic pain?</li><li>What share of the negative-laparoscopy gap is training versus case selection, and how would you test that?</li></ol>",
},

# Emotional Freedom Technique RCT, n=65, dysmenorrhea
"42091422": {
    "bottom": "Small RCT (n=65) of Emotional Freedom Technique (EFT, &apos;tapping&apos;) vs awareness training for primary dysmenorrhea. The EFT group had reduced pain and improved quality of life. It is small, single-center, and carries high bias risk &mdash; a behavioral intervention can&apos;t be blinded and the control was attention-only &mdash; so it is best read as a low-risk adjunct some patients may find helpful.",
    "question": "<strong>The clinical problem.</strong> Primary dysmenorrhea is common and many patients prefer non-pharmacologic options or cannot tolerate NSAIDs/hormones, creating demand for low-risk self-management techniques. <strong>The question.</strong> Does Emotional Freedom Technique improve pain and quality of life in primary dysmenorrhea compared with awareness training?",
    "pico": {
        "P": "65 women with primary dysmenorrhea.",
        "I": "Emotional Freedom Technique (two 45&ndash;60 min sessions).",
        "C": "Dysmenorrhea awareness training + brochures.",
        "O": "Menstrual Symptom Scale, Quality of Life Scale, pain.",
        "D": "Randomized controlled trial (pretest&ndash;posttest).",
        "S": "65.",
    },
    "methods": "Randomized pretest&ndash;posttest trial (n=65, G*Power-justified) comparing two EFT sessions with awareness training plus brochures, using validated symptom and quality-of-life scales. No blinding is possible for a self-applied behavioral technique, and the comparator is attention-only.",
    "findings": "The EFT group showed significant reductions in menstrual-symptom somatic complaints and total scores and in dysmenorrhea pain, with improvement in the physical-function quality-of-life domain.",
    "rob": "High. Unblindable intervention, attention-only control (no active comparator), small single-center sample, and subjective self-reported outcomes susceptible to expectation effects. The effect may reflect non-specific attention/placebo.",
    "strengths": "Randomized with an a priori power calculation and validated outcome instruments &mdash; reasonable rigor for a small behavioral pilot &mdash; addressing a genuine demand for low-risk options.",
    "applicability": "A low-cost, low-risk self-help technique some motivated patients may try; not a substitute for proven therapy and not strong enough to recommend broadly.",
    "kb": "Sits in the weak-but-growing complementary/behavioral dysmenorrhea literature, where effects are plausible but confounded by blinding and placebo limitations.",
    "equity": "Low cost and self-administration are equity advantages (no drug access needed), but generalizability beyond the single-center sample is unestablished.",
    "monday": "Counsel / hold. EFT is a low-risk, low-cost self-help option a motivated patient could try for primary dysmenorrhea, but the evidence is weak (small, unblinded). Offer it as one of several non-pharmacologic options, not a replacement for proven therapy.",
    "prompts": "<ol><li>How much of EFT&apos;s benefit is plausibly non-specific (attention, expectation) rather than the technique itself?</li><li>Where do you place no-harm behavioral options in a stepped-care plan for primary dysmenorrhea?</li><li>What active-control trial would convince you EFT has a specific effect?</li></ol>",
},

# Pilates tele-exercise pilot RCT, n=22, primary dysmenorrhea
"42091251": {
    "bottom": "Tiny pilot RCT (n=22) of 6-week Pilates-based tele-exercise vs no intervention for primary dysmenorrhea. The intervention group improved across symptom, attitude, and quality-of-life scales. It is very small and used an untreated comparator (which inflates the apparent effect), but the direction is consistent with the broader evidence that exercise helps dysmenorrhea.",
    "question": "<strong>The clinical problem.</strong> Exercise plausibly reduces dysmenorrhea, but access and adherence are barriers; remotely-delivered programs could lower both, if effective. <strong>The question.</strong> Does a 6-week Pilates-based tele-exercise program improve menstrual symptoms, attitudes, and quality of life in primary dysmenorrhea versus no intervention?",
    "pico": {
        "P": "22 women with primary dysmenorrhea.",
        "I": "6-week Pilates-based tele-exercise (twice weekly, 50 min).",
        "C": "No intervention.",
        "O": "Menstrual Symptom Questionnaire, Menstrual Attitude Questionnaire, FEDS.",
        "D": "Small pilot RCT.",
        "S": "22.",
    },
    "methods": "Randomized two-arm pilot (n=22) comparing 6 weeks of twice-weekly tele-delivered Pilates with no intervention, using validated symptom/attitude/dysmenorrhea scales. The no-treatment comparator and tiny sample are the key design constraints.",
    "findings": "The Pilates group improved significantly on total and subdomain Menstrual Symptom Questionnaire scores, on menstrual-attitude subscales, and on the FEDS total; the control group, receiving nothing, did not.",
    "rob": "High. Very small sample, no-treatment control (so any attention/expectation effect inflates the difference), unblindable intervention, and subjective outcomes. Pilot-level evidence only.",
    "strengths": "Randomized design, validated instruments, and a scalable tele-delivery model that addresses real access barriers; a reasonable feasibility signal.",
    "applicability": "Supports a general, low-risk recommendation to exercise for dysmenorrhea; this specific protocol/sample is too small to weigh heavily on its own.",
    "kb": "Consistent with the broader, better-established literature that physical activity reduces dysmenorrhea; adds a tele-delivery feasibility data point.",
    "equity": "Tele-delivery is an access advantage for those with connectivity, but the digital divide and the tiny, likely-homogeneous sample limit equity claims.",
    "monday": "Counsel. Exercise &mdash; including home/tele-delivered Pilates &mdash; is a reasonable, low-risk recommendation for primary dysmenorrhea and aligns with existing exercise evidence. This particular n=22 trial is too small to weigh heavily, but it points the right way.",
    "prompts": "<ol><li>Would an active comparator (e.g., stretching or education) change your read of the effect size?</li><li>How do you build exercise recommendations into dysmenorrhea care in a way patients will actually sustain?</li><li>What sample size and control would a definitive tele-exercise trial need?</li></ol>",
},

# ============================ UTERINE FIBROIDS ============================

# Leiomyosarcoma in pregnancy — case report
"42116313": {
    "bottom": "Case report: a 35-year-old with a presumed fibroid in pregnancy had a cesarean plus myomectomy, and pathology returned leiomyosarcoma with pulmonary metastases (stage IVB), requiring subsequent hysterectomy, BSO, and staging. It is the sobering reminder that leiomyosarcoma can masquerade as a benign fibroid and that the distinction is unreliable preoperatively.",
    "question": "<strong>The clinical problem.</strong> Uterine leiomyosarcoma is rare but cannot be reliably distinguished from a benign fibroid before surgery, and pregnancy further obscures the picture &mdash; risking delayed diagnosis and inappropriate (e.g., morcellated) handling of an occult malignancy. <strong>The question.</strong> How does leiomyosarcoma present and behave when masquerading as a fibroid in pregnancy, and what are the operative lessons?",
    "pico": {
        "P": "35-year-old pregnant woman with presumed uterine fibroid.",
        "I": "Cesarean + myomectomy; then laparoscopic hysterectomy, BSO, pelvic lymphadenectomy, staging.",
        "C": "None.",
        "O": "Histologic diagnosis (leiomyosarcoma), stage IVB with pulmonary metastases.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
    "methods": "Single case report with operative, pathologic, and imaging documentation across the diagnostic and treatment course. Descriptive; no comparator or generalizable rate.",
    "findings": "An asymptomatic large &apos;fibroid&apos; managed with cesarean + myomectomy proved to be leiomyosarcoma on pathology, with CT-confirmed pulmonary metastases (stage IVB), prompting hysterectomy, BSO, lymphadenectomy, peritoneal/omental sampling, and chemotherapy.",
    "rob": "n=1; no rate or comparator. Its value is illustrative, and as a case report it is subject to selection toward dramatic presentations.",
    "strengths": "A vivid, well-documented cautionary case that anchors a high-stakes, real-world surgical-consent issue (the sarcoma-masquerade and morcellation risk).",
    "applicability": "Directly relevant to fibroid surgery counseling and tissue-handling decisions, especially for atypical or rapidly-growing myomas and in pregnancy.",
    "kb": "Reinforces the well-established leiomyosarcoma-masquerade literature underpinning morcellation-safety guidance; it is a teaching exemplar rather than new evidence.",
    "equity": "n=1; no representativeness. The general equity concern is that occult sarcoma risk and morcellation counseling should be communicated consistently to all fibroid-surgery patients.",
    "monday": "Counsel / caution &mdash; directly relevant to fibroid surgery. It reinforces the leiomyosarcoma-masquerade risk underlying the morcellation debate: you cannot reliably tell a fibroid from a sarcoma before pathology. For any atypical or rapidly-growing myoma &mdash; especially in pregnancy or the peri/postmenopausal window &mdash; counsel about the small malignancy risk, avoid uncontained morcellation, and have a tissue-containment plan.",
    "prompts": "<ol><li>How do you counsel about occult-sarcoma risk and morcellation for a patient who strongly prefers a minimally-invasive, uterus-sparing approach?</li><li>What features (growth rate, imaging, age) raise your suspicion enough to alter the surgical plan?</li><li>When a fibroid of uncertain nature is encountered at cesarean, how do you decide whether to proceed with myomectomy?</li></ol>",
},

}
