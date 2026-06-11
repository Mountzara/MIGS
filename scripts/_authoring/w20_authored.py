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

# ============================ FEMALE INFERTILITY ============================

# Lifetime psychiatric history & distress in IUI patients, n=90
"42117558": {
    "bottom": "Cross-sectional evaluation of 90 women starting IUI at an academic center using a structured DSM interview. A lifetime Axis I disorder was present in 36.7% (mostly mood/anxiety), and those women had higher baseline depression, stress, and neuroticism scores. It argues for baseline psychological screening before fertility treatment, since a sizable minority arrive already vulnerable.",
    "question": "<strong>The clinical problem.</strong> Fertility treatment is psychologically demanding, and a patient&apos;s pre-existing mental-health vulnerability may shape distress, adherence, and experience &mdash; yet psychiatric history is rarely assessed systematically before IUI. <strong>The question.</strong> How prevalent are lifetime psychiatric disorders among women initiating IUI, and are they associated with greater distress at treatment onset?",
    "pico": {
        "P": "90 women initiating IUI at an academic fertility center.",
        "I": "Not applicable &mdash; observational; structured psychiatric assessment (SCID for DSM-IV-TR).",
        "C": "Women without a lifetime psychiatric history.",
        "O": "Beck Depression Inventory, Perceived Stress Scale, Eysenck personality traits.",
        "D": "Cross-sectional.",
        "S": "90.",
    },
    "methods": "Pre-treatment cross-sectional assessment of 90 IUI patients using the structured clinical interview (SCID) for lifetime diagnoses and validated distress/personality instruments, with t-tests, chi-square, and multivariable logistic regression for predictors of elevated distress (BDI or PSS &gt; 14).",
    "findings": "36.7% had a lifetime Axis I disorder (mood 28.9%, anxiety 15.6%). Those with a psychiatric history had higher depression (10.5 vs 5.5, p=0.005), stress (18.8 vs 12.8, p=0.002), and neuroticism; psychiatric history independently predicted elevated baseline distress.",
    "rob": "Moderate. Single-center, small sample, cross-sectional (baseline only, no treatment-outcome linkage), and reliant on self-reported distress instruments. The structured diagnostic interview is a methodological strength.",
    "strengths": "Use of a gold-standard structured psychiatric interview rather than screening scales, and a clinically actionable signal that baseline vulnerability clusters in an identifiable subgroup.",
    "applicability": "Supports incorporating brief mental-health screening into fertility intake; relevant to any center running IUI/ART programs.",
    "kb": "Consistent with the broader literature on psychological burden in infertility care and the case for integrated psychosocial support in ART.",
    "equity": "Single academic-center sample limits socioeconomic/ancestry generalizability; access to psychological support after a positive screen is itself an equity issue the study does not address.",
    "monday": "Counsel / inform. A reminder to screen for mental-health history at fertility intake and to have referral pathways ready &mdash; over a third of IUI patients carry a lifetime psychiatric diagnosis and start treatment more distressed. Not surgical, but relevant to whole-patient fertility care.",
    "prompts": "<ol><li>Should a brief validated mental-health screen be routine at fertility-treatment intake?</li><li>What referral and support structures need to exist before you screen?</li><li>How might baseline distress affect treatment adherence and dropout, and how would you mitigate it?</li></ol>",
},

# UK-wide survey of women's ART perceptions, n=562
"42117546": {
    "bottom": "Thematic analysis of a UK-wide social-media survey (562 respondents) on women&apos;s perceptions of long-term ART outcomes. Most reported no concerns about maternal or child health, but a meaningful minority worried about reproductive, cancer, endocrine, and child neurodevelopmental outcomes &mdash; and many felt clinics did not provide long-term-outcome information. It signals a counseling/information gap rather than a clinical risk.",
    "question": "<strong>The clinical problem.</strong> Patients increasingly ask about the long-term health of ART-conceived children and of themselves, but it is unclear what they actually understand or worry about and whether clinics address it. <strong>The question.</strong> What are UK women&apos;s perceptions and concerns about long-term ART outcomes, and how well do they feel informed?",
    "pico": {
        "P": "562 UK women (had ART, considering ART, or conceived naturally).",
        "I": "Not applicable &mdash; anonymous cross-sectional survey.",
        "C": "Not applicable.",
        "O": "Perceived concerns about long-term maternal/child outcomes; adequacy of information provision.",
        "D": "Cross-sectional survey with inductive thematic analysis.",
        "S": "562.",
    },
    "methods": "Anonymous social-media-distributed survey over 8 months with descriptive statistics and inductive semantic thematic analysis. Convenience/social-media sampling skews toward engaged, younger, private-ART respondents.",
    "findings": "Of 562 (72% aged 25&ndash;40; 38% private ART), most reported no concern about maternal (52%), child health (67%), or child education (83%). Concerns that did surface centered on maternal reproductive/cancer/endocrine and child reproductive/neurodevelopmental outcomes; information on long-term outcomes was frequently not provided by clinics.",
    "rob": "High for representativeness. Self-selected social-media sample, no probability sampling, and perception (not outcome) data. Appropriate for hypothesis-generating qualitative insight, not prevalence estimates.",
    "strengths": "Captures the patient voice on an under-explored topic and identifies a concrete, addressable information-provision gap.",
    "applicability": "Relevant to ART counseling practice and to the case for national outcome databases; not a clinical-risk study.",
    "kb": "Adds qualitative patient-perception data to the ART long-term-outcomes literature and supports calls for clearer information provision.",
    "equity": "Social-media recruitment under-represents older, lower-income, and publicly-funded ART patients &mdash; the very groups who may have the least access to long-term-outcome information.",
    "monday": "Counsel / inform. The takeaway is a communication one: patients want clearer information about long-term ART outcomes and often don&apos;t get it. Worth auditing your own consent/counseling materials. No clinical practice change.",
    "prompts": "<ol><li>What long-term-outcome information should be standard in ART consent, and how do you convey uncertainty honestly?</li><li>How would a national ART-outcomes database change what you can tell patients?</li><li>How do you weight a self-selected survey&apos;s findings when planning patient communication?</li></ol>",
},

# Microfluidic sperm sorting (ZyMot) vs density-gradient centrifugation, 2267 cycles
"42116698": {
    "bottom": "Large retrospective comparison (1,091 ZyM&#333;t vs 1,176 density-gradient cycles) of sperm-preparation methods in ICSI. Microfluidic sorting yielded lower sperm DNA fragmentation, higher motility, modestly higher fertilization (81.0% vs 78.7%), and notably more day-5 blastocysts (25.6% vs 18.3%), independent of age and diagnosis. A real laboratory signal favoring microfluidic preparation, though clinical pregnancy/live-birth differences are the endpoints that matter most.",
    "question": "<strong>The clinical problem.</strong> Sperm preparation method may influence DNA integrity and downstream embryo quality, but the standard density-gradient technique can induce oxidative damage; microfluidic sorting promises gentler selection. <strong>The question.</strong> Does microfluidic sperm sorting improve laboratory and clinical ICSI outcomes versus density-gradient centrifugation?",
    "pico": {
        "P": "ICSI cycles with autologous or donor oocytes.",
        "I": "Microfluidic sperm sorting (ZyM&#333;t).",
        "C": "Density-gradient centrifugation.",
        "O": "DNA fragmentation, motility, fertilization, blastulation, euploidy, clinical pregnancy/live birth.",
        "D": "Retrospective cohort.",
        "S": "1,091 ZyM&#333;t vs 1,176 density-gradient cycles.",
    },
    "methods": "Retrospective comparison of two sperm-preparation methods across &gt;2,200 ICSI cycles, with hierarchical multivariable regression adjusting for female age, male age, and infertility diagnosis. Retrospective allocation may reflect lab/patient selection.",
    "findings": "ZyM&#333;t produced lower DNA fragmentation and higher motility, higher fertilization (81.0% vs 78.7%, P=0.003), and significantly more day-5 blastocysts (25.6% vs 18.3%, P&lt;0.001); microfluidic processing independently predicted higher blastulation (&beta;=0.11, P&lt;0.001).",
    "rob": "Moderate. Large but retrospective and single-center; allocation to method was not randomized, and the headline endpoints are intermediate (fertilization, blastulation) rather than live birth, which the abstract does not clearly resolve in favor of either arm.",
    "strengths": "Large sample, multivariable adjustment, and a coherent mechanistic story (less DNA damage &rarr; better blastulation). Directly compares two real-world lab workflows.",
    "applicability": "Relevant to embryology-lab practice and REI; the intermediate-endpoint gains support microfluidic adoption pending clearer live-birth data.",
    "kb": "Adds a large dataset to the contested microfluidic-vs-gradient literature, favoring microfluidic preparation on laboratory endpoints.",
    "equity": "Cost of microfluidic devices versus standard gradient prep is an access consideration for clinics and self-funded patients, unaddressed here.",
    "monday": "Inform (REI/lab-facing). Evidence favoring microfluidic sperm sorting on lab endpoints (less DNA fragmentation, more blastocysts), but it&apos;s retrospective and the live-birth advantage isn&apos;t established. A consideration for lab protocols, not a MIGS-surgical issue.",
    "prompts": "<ol><li>Do intermediate gains in blastulation justify the added cost of microfluidic sorting without a clear live-birth benefit?</li><li>How much should retrospective allocation temper enthusiasm here?</li><li>Which patients (e.g., high sperm DNA fragmentation) might benefit most?</li></ol>",
},

# Oncofertility review — cancer treatment & female fertility preservation
"42114985": {
    "bottom": "Narrative review of oncofertility: how modern cancer therapies (beyond classic DNA-damaging agents &mdash; now targeted antibodies, kinase inhibitors, immunotherapy) affect female fertility, the preservation options available, and the multidisciplinary (including pharmacist) role. A useful practical summary reinforcing early REI referral before gonadotoxic treatment.",
    "question": "<strong>The clinical problem.</strong> Expanding cancer therapeutics have varied and often poorly-characterized effects on ovarian function, and the window to preserve fertility closes once treatment begins. <strong>The question.</strong> What are the fertility effects of current cancer-treatment modalities, and what preservation options and team roles support patients facing gonadotoxic therapy?",
    "pico": {
        "P": "Female patients undergoing or having received tumor-directed therapy.",
        "I": "Not applicable &mdash; narrative review of fertility-preservation strategies.",
        "C": "Not applicable.",
        "O": "Treatment-related fertility risk; preservation options; team/pharmacist roles.",
        "D": "Narrative review.",
        "S": "Literature synthesis (no enumerated cohort).",
    },
    "methods": "Narrative literature review summarizing gonadotoxicity across treatment classes and preservation options. Non-systematic, so subject to selection and currency limitations.",
    "findings": "Cancer therapies vary widely in gonadotoxicity; newer targeted/immune agents have less-characterized fertility effects than classic alkylators. Preservation (oocyte/embryo cryopreservation, ovarian tissue) is most effective when arranged before treatment, supported by oncology&ndash;REI&ndash;pharmacy collaboration.",
    "rob": "Narrative review: no systematic search or quality grading, so conclusions are expert-synthesis rather than graded evidence.",
    "strengths": "Practical, multidisciplinary framing including the under-discussed pharmacist role, and attention to newer agents whose fertility effects are uncertain.",
    "applicability": "Useful reference for any clinician who counsels reproductive-age oncology patients; reinforces prompt fertility-preservation referral.",
    "kb": "A current synthesis within the established oncofertility literature; consolidates rather than extends evidence.",
    "equity": "Fertility-preservation access is profoundly inequitable (cost, insurance, time-to-treatment, geography) &mdash; a central oncofertility equity concern the review touches but cannot solve.",
    "monday": "Counsel / refer. The actionable message is timing: refer reproductive-age patients for fertility-preservation counseling before gonadotoxic cancer therapy starts. Relevant whenever you co-manage oncology patients.",
    "prompts": "<ol><li>How do you ensure fertility-preservation referral isn&apos;t lost in the rush to start cancer treatment?</li><li>How do you counsel when a newer agent&apos;s gonadotoxicity is genuinely unknown?</li><li>What local barriers to timely preservation could you address?</li></ol>",
},

# Preeclampsia screening after ART — review
"42113617": {
    "bottom": "Short review on the limits of first-trimester preeclampsia screening after ART. ART pregnancies carry higher preeclampsia risk, particularly frozen embryo transfer in an artificial (programmed) cycle, and the endometrial-preparation method itself may alter uterine-artery pulsatility index &mdash; potentially distorting the very screening algorithm used to estimate risk. A caution about applying standard screening uncritically to ART pregnancies.",
    "question": "<strong>The clinical problem.</strong> First-trimester preeclampsia screening combines maternal factors, biomarkers, and uterine-artery Doppler &mdash; but ART, especially programmed frozen transfers, both raises preeclampsia risk and may itself change Doppler inputs, undermining screening accuracy. <strong>The question.</strong> How do ART and endometrial-preparation methods affect the validity of first-trimester preeclampsia screening?",
    "pico": {
        "P": "Pregnancies conceived via assisted reproductive technology.",
        "I": "Not applicable &mdash; review of screening performance by endometrial-preparation method.",
        "C": "Natural-cycle / spontaneous conception.",
        "O": "Preeclampsia risk; uterine-artery pulsatility index and screening estimates.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
    "methods": "Narrative review synthesizing evidence on ART-associated preeclampsia risk and the effect of endometrial-preparation method on uterine-artery Doppler. Non-systematic.",
    "findings": "Artificial-cycle frozen embryo transfer is highlighted as a preeclampsia risk factor; endometrial-preparation method may shift uterine-artery pulsatility index values, thereby biasing first-trimester risk estimation in ART pregnancies.",
    "rob": "Narrative review without systematic methodology; conclusions are mechanistic/expert-level and should be confirmed against primary screening-performance studies.",
    "strengths": "Flags a subtle but important measurement-validity problem &mdash; that the screening inputs themselves may be altered by ART &mdash; with direct counseling and surveillance implications.",
    "applicability": "Relevant to obstetric and REI clinicians managing ART pregnancies; supports heightened preeclampsia vigilance, particularly after programmed FET.",
    "kb": "Aligns with the growing evidence that programmed (absent-corpus-luteum) FET cycles carry higher hypertensive-disorder risk; adds the screening-validity nuance.",
    "equity": "No explicit equity dimension; access to natural-cycle FET (which may lower risk) versus programmed cycles can vary by clinic resources.",
    "monday": "Counsel / inform. Heighten preeclampsia vigilance in ART pregnancies, especially after programmed frozen transfers, and interpret first-trimester screening cautiously since ART may alter its Doppler inputs. Relevant to obstetric co-management.",
    "prompts": "<ol><li>Should programmed-FET pregnancies trigger a lower threshold for aspirin prophylaxis?</li><li>How do you interpret first-trimester screening when ART may have shifted the Doppler inputs?</li><li>Where natural-cycle FET is feasible, does the hypertensive-risk difference change your recommendation?</li></ol>",
},

# Oocyte cryopreservation success — n=93 retrievals
"42113610": {
    "bottom": "Czech single-center evaluation of 93 oocyte-vitrification retrievals for fertility preservation, stratified by age (&lt;35 vs &ge;35) and oocyte number (&lt;4 vs &ge;4), compared against young anonymous donors. It reiterates the established levers of egg-freezing success &mdash; younger age and more oocytes &mdash; and flags low awareness and high cost as barriers to uptake.",
    "question": "<strong>The clinical problem.</strong> Elective oocyte cryopreservation can extend reproductive options, but patients and clinicians need realistic success expectations by age and oocyte yield, and uptake is limited by awareness and cost. <strong>The question.</strong> What is the success rate of oocyte vitrification, and how does it vary by patient age and number of oocytes stored?",
    "pico": {
        "P": "Women undergoing oocyte retrieval for elective vitrification (plus donor comparison).",
        "I": "Oocyte vitrification and long-term storage.",
        "C": "Young anonymous oocyte donors; stratified by age and oocyte number.",
        "O": "Oocyte survival/success rates.",
        "D": "Retrospective evaluation.",
        "S": "93 retrievals.",
    },
    "methods": "Retrospective evaluation of 93 vitrification retrievals stratified by age and oocyte number, benchmarked against donor outcomes. Small, single-center, intermediate (survival) endpoints rather than live birth.",
    "findings": "Outcomes followed the expected gradient &mdash; younger age and a greater number of vitrified oocytes were associated with better success, with donors (young, healthy) as the favorable reference. Awareness and cost were noted as adoption barriers.",
    "rob": "Moderate-to-high. Small single-center sample, retrospective, and survival-based endpoints; no live-birth outcomes from warmed oocytes, which is what patients ultimately care about.",
    "strengths": "Reinforces the two best-established counseling levers (age, oocyte number) with a donor benchmark, in a setting where the method is under-utilized.",
    "applicability": "Supports standard egg-freezing counseling: freeze younger and bank enough oocytes. The specific numbers are limited by sample size.",
    "kb": "Consistent with the large body of evidence that oocyte-cryopreservation success is driven by age and oocyte yield.",
    "equity": "Explicitly flags cost and low awareness as access barriers &mdash; a central equity issue in elective fertility preservation, especially outside well-funded systems.",
    "monday": "Counsel / inform. Reinforces the egg-freezing counseling staples &mdash; younger age and more oocytes mean better odds &mdash; and the access barriers of cost and awareness. REI-facing, not surgical.",
    "prompts": "<ol><li>How do you set realistic expectations for elective egg freezing without over- or under-selling it?</li><li>What oocyte-number targets do you counsel by age band?</li><li>How can low awareness and cost barriers be addressed in your setting?</li></ol>",
},

# Progesterone exposure duration x blastocyst stage, day-6 FET, n=2058
"42109745": {
    "bottom": "Retrospective cohort (2,058 single frozen-thawed day-6 blastocyst transfers) examining progesterone-exposure duration before transfer. Overall live-birth rates were similar for day-6 vs day-7 progesterone, but a strong interaction emerged: for early-stage (3&ndash;4) blastocysts, day-7 progesterone gave lower live birth than day-6 (37.3% vs 46.2%). A practical embryo-stage-specific synchronization signal for FET timing.",
    "question": "<strong>The clinical problem.</strong> Endometrial&ndash;embryo synchrony governs frozen-transfer success, and the optimal progesterone-exposure duration before transferring day-6 blastocysts is debated &mdash; with the right answer possibly depending on how expanded the blastocyst is. <strong>The question.</strong> Does progesterone-exposure duration before day-6 blastocyst FET affect live birth, and is the effect modified by blastocyst expansion stage?",
    "pico": {
        "P": "2,058 women undergoing single frozen-thawed day-6 blastocyst transfer (2021&ndash;2024).",
        "I": "Day-6 progesterone exposure before transfer.",
        "C": "Day-7 progesterone exposure.",
        "O": "Live-birth rate, with interaction by blastocyst expansion stage.",
        "D": "Retrospective cohort.",
        "S": "2,058.",
    },
    "methods": "Retrospective cohort with univariable and multivariable logistic regression and formal interaction testing for effect modification by blastocyst expansion stage and other covariates. Retrospective protocol assignment limits causal inference.",
    "findings": "Overall live-birth rate was similar for day-6 vs day-7 progesterone (42.8% vs 41.9%, P=0.691), but a significant interaction with expansion stage (P&lt;0.01) was found: among early-stage (3&ndash;4) blastocysts, day-7 progesterone gave lower live birth than day-6 (37.3% vs 46.2%).",
    "rob": "Moderate. Large but retrospective and single-center; the headline is an interaction/subgroup effect (more fragile than a main effect), though it was pre-specified with formal interaction testing.",
    "strengths": "Large sample, formal interaction testing rather than naive subgrouping, and an actionable, stage-specific synchronization message for FET protocols.",
    "applicability": "Directly relevant to FET laboratory/clinical protocols; supports tailoring progesterone duration to blastocyst expansion stage for day-6 embryos.",
    "kb": "Refines the endometrial-receptivity/synchrony literature by adding an embryo-stage dimension to progesterone-exposure timing.",
    "equity": "No explicit equity dimension; protocol optimization is broadly applicable across FET programs.",
    "monday": "Inform (REI-facing). A nuance for FET timing: for early-stage day-6 blastocysts, longer (day-7) progesterone exposure may reduce live birth, so match progesterone duration to expansion stage. Retrospective, so confirmatory data would help. Not a MIGS issue.",
    "prompts": "<ol><li>How robust is a pre-specified interaction effect in a retrospective cohort, and would you change protocols on it?</li><li>How might embryo-stage-specific progesterone timing be tested prospectively?</li><li>What other synchrony variables interact with progesterone duration?</li></ol>",
},

# Machine-learning IUI pregnancy prediction, n=957
"42109740": {
    "bottom": "Methodological study building IUI clinical-pregnancy prediction models (logistic regression, random forest, multilayer perceptron) on 957 cycles, with SMOTE for class imbalance and SHAP for interpretability. The models showed moderate discrimination; this is proof-of-concept that ML can predict IUI success, not a validated clinical tool. External validation is the missing step.",
    "question": "<strong>The clinical problem.</strong> Counseling patients on IUI success is hard because outcome depends on many interacting factors, and simple statistics may under-capture them. <strong>The question.</strong> Can machine-learning models predict clinical pregnancy after IUI more accurately and interpretably than conventional approaches?",
    "pico": {
        "P": "957 intrauterine-insemination cycles.",
        "I": "Machine-learning models (random forest, multilayer perceptron) with SMOTE + SHAP.",
        "C": "Logistic regression.",
        "O": "Discrimination (AUC) for clinical pregnancy; interpretability.",
        "D": "Retrospective predictive-modeling study.",
        "S": "957 cycles (80/20 train/validation).",
    },
    "methods": "957 cycles split 80/20, SMOTE applied to the training set for class imbalance, 10-fold cross-validation, AUC for discrimination, and SHAP for interpretability. Single-center data and internal validation only.",
    "findings": "All three models showed moderate discrimination on cross-validation, with SHAP providing feature-level interpretability. No external/temporal validation was reported, and SMOTE on imbalanced data can optimistically bias internal performance.",
    "rob": "Moderate-to-high for clinical use. Single-center, internally-validated only, and SMOTE-augmented &mdash; a combination that tends to overstate real-world performance. Adequate as a methods demonstration.",
    "strengths": "Compares multiple algorithms head-to-head, addresses class imbalance explicitly, and adds interpretability (SHAP) rather than a black box.",
    "applicability": "Not yet clinically usable; useful as a template for prediction-model development that still needs external validation before counseling use.",
    "kb": "Joins the rapidly-growing ART machine-learning literature, most of which remains at the internal-validation, proof-of-concept stage.",
    "equity": "Single-center training data risk poor transportability to other populations &mdash; an algorithmic-equity concern if such models were deployed without local revalidation.",
    "monday": "Hold. A proof-of-concept ML model for IUI success, not a validated tool &mdash; nothing to deploy in counseling yet. Watch the space; demand external validation before any clinical use.",
    "prompts": "<ol><li>What external-validation evidence would you require before using an ML model to counsel IUI patients?</li><li>How does SMOTE on imbalanced data risk inflating apparent performance?</li><li>Does interpretability (SHAP) change your trust in a prediction model, and should it?</li></ol>",
},

# ROS in diminished ovarian reserve — review
"42109737": {
    "bottom": "Narrative review framing reactive-oxygen-species&ndash;mediated oxidative stress as a common pathological hub in diminished ovarian reserve, integrating aging, metabolic, environmental, and iatrogenic insults, and pointing to mitochondrial-targeted antioxidants as the intervention focus. Mechanistically coherent but, as a review of preclinical/mechanistic work, it does not establish that antioxidants improve clinical fertility outcomes.",
    "question": "<strong>The clinical problem.</strong> Diminished ovarian reserve reduces fertility and ART success, has a complex multifactorial etiology, and lacks effective interventions. <strong>The question.</strong> Does ROS-mediated oxidative stress serve as a unifying mechanism in DOR, and do mitochondrial-targeted antioxidants represent a rational intervention?",
    "pico": {
        "P": "Women with diminished ovarian reserve (mechanistic/preclinical evidence base).",
        "I": "Conceptual &mdash; mitochondrial-targeted antioxidant strategies.",
        "C": "Not applicable.",
        "O": "Mechanistic understanding; candidate intervention targets.",
        "D": "Narrative mechanistic review.",
        "S": "Literature synthesis.",
    },
    "methods": "Narrative review synthesizing mechanistic and preclinical evidence on ROS in DOR and antioxidant intervention strategies. Non-systematic; integrates heterogeneous basic-science sources.",
    "findings": "ROS-driven oxidative stress is presented as a convergent mechanism linking multiple DOR risk factors, with mitochondrial-targeted antioxidants proposed as the leading intervention direction &mdash; without clinical efficacy data.",
    "rob": "Narrative mechanistic review: no systematic search or outcome grading, and the leap from mechanism to clinical antioxidant benefit is unproven (clinical antioxidant trials in reproduction have been largely disappointing).",
    "strengths": "A clear integrative framework that organizes diverse DOR risk factors around a single mechanistic hub and identifies tractable targets for study.",
    "applicability": "No direct clinical action; it should not be read as endorsing antioxidant supplements for DOR, where high-quality trial evidence is lacking.",
    "kb": "Sits within the large oxidative-stress-in-reproduction literature; consolidates mechanism but does not advance clinical evidence.",
    "equity": "No population/equity dimension; cautionary note that unproven antioxidant supplements can become a costly, evidence-light market aimed at desperate patients.",
    "monday": "Hold / counsel. Mechanistic review only &mdash; it does not justify prescribing antioxidant supplements for diminished ovarian reserve, where clinical evidence is weak. Useful for understanding mechanism, not for changing management.",
    "prompts": "<ol><li>Why have antioxidant supplement trials in reproduction so often failed despite strong mechanistic rationale?</li><li>How do you counsel a DOR patient asking about antioxidant supplements?</li><li>What clinical-trial design would actually test mitochondrial-targeted antioxidants in DOR?</li></ol>",
},

# Regional fat distribution & infertility, NHANES, n=2531
"42104773": {
    "bottom": "Cross-sectional NHANES analysis (2,531 US women, 2013&ndash;2018) of DXA-based regional fat measures and self-reported infertility. Total, android, and android/gynoid-ratio fat and BMI were modestly associated with infertility. It reinforces the known adiposity&ndash;infertility link and hints that central (android) fat distribution, not just overall BMI, matters &mdash; but cross-sectional and self-reported, so association only.",
    "question": "<strong>The clinical problem.</strong> Adiposity is linked to infertility, but BMI is a crude measure, and whether fat distribution (central vs peripheral) carries independent risk is under-studied. <strong>The question.</strong> Are DXA-based regional fat-distribution indicators associated with female infertility in a nationally representative sample, beyond BMI?",
    "pico": {
        "P": "2,531 US women aged 20&ndash;45 (NHANES 2013&ndash;2018).",
        "I": "Not applicable &mdash; DXA-based regional fat measures (android, gynoid, visceral, etc.).",
        "C": "Not applicable.",
        "O": "Self-reported infertility (&ge;12 months trying or seeking care).",
        "D": "Cross-sectional.",
        "S": "2,531.",
    },
    "methods": "Cross-sectional analysis of nationally-representative NHANES data using DXA-derived fat-distribution indices and multivariable logistic regression with sensitivity analyses. Self-reported infertility and cross-sectional timing are key limitations.",
    "findings": "In adjusted models, total percent fat, android percent fat, android/gynoid ratio, and BMI were modestly associated with infertility, suggesting central adiposity contributes beyond overall BMI.",
    "rob": "Moderate. Nationally representative and DXA-based (strengths), but cross-sectional (no temporality), infertility self-reported, and associations modest. Cannot establish causation.",
    "strengths": "National representativeness, objective DXA fat measures rather than BMI alone, and adjustment plus sensitivity analyses.",
    "applicability": "Supports the general counseling that adiposity &mdash; especially central fat &mdash; is associated with infertility; not a basis for a specific fat-distribution target.",
    "kb": "Consistent with the established adiposity&ndash;infertility literature and adds nuance that fat distribution, not just BMI, may matter.",
    "equity": "NHANES is nationally representative (an equity strength), though self-reported infertility may be differentially captured across groups with unequal access to fertility care.",
    "monday": "Counsel / inform. Adds weight to the adiposity&ndash;infertility association and suggests central fat distribution matters beyond BMI &mdash; useful for lifestyle counseling, but cross-sectional and not a new intervention. Not surgical.",
    "prompts": "<ol><li>Does fat distribution add anything actionable beyond BMI in fertility counseling?</li><li>How do you discuss weight and fertility without stigma while being honest about associations?</li><li>What longitudinal design would establish whether central adiposity is causal?</li></ol>",
},

# Sperm DNA fragmentation testing — narrative review
"42104690": {
    "bottom": "Narrative review of sperm DNA fragmentation (SDF) testing &mdash; now referenced in the WHO 6th-edition manual &mdash; comparing TUNEL, SCSA, SCD, and Comet assays for clinical utility, thresholds, and management. Elevated SDF is associated with worse fertilization, embryo quality, pregnancy, and miscarriage, especially in couples with normal standard semen parameters. A useful map of a still-imperfectly-standardized test.",
    "question": "<strong>The clinical problem.</strong> Standard semen analysis misses DNA-level sperm damage that can impair ART outcomes, and SDF testing is increasingly used but lacks standardized assays and thresholds. <strong>The question.</strong> What is the clinical utility, optimal methodology, and threshold for sperm DNA fragmentation testing in the ART era?",
    "pico": {
        "P": "Couples in male-infertility/ART evaluation.",
        "I": "Sperm DNA fragmentation testing (TUNEL, SCSA, SCD, Comet).",
        "C": "Conventional semen analysis / across assays.",
        "O": "Predictive value for fertilization, embryo quality, pregnancy, miscarriage.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
    "methods": "Narrative review comparing four SDF assays on technical characteristics, reproducibility, and predictive value for ART outcomes. Non-systematic synthesis.",
    "findings": "Elevated SDF is associated with reduced fertilization and embryo quality, lower pregnancy, and higher miscarriage, particularly when standard semen parameters are normal; assays differ in methodology and thresholds, limiting standardization despite WHO 6th-edition recognition.",
    "rob": "Narrative review without systematic grading; the underlying SDF literature is heterogeneous, with inconsistent thresholds and assay-dependent results.",
    "strengths": "Side-by-side comparison of the major assays and a practical orientation to thresholds and management for a test that is increasingly requested.",
    "applicability": "Relevant to male-infertility and ART counseling, especially unexplained infertility or recurrent loss with normal semen analysis; assay/threshold variability tempers direct application.",
    "kb": "Consolidates the SDF literature at a moment of rising clinical use and partial guideline recognition; standardization remains the open problem.",
    "equity": "Assay availability and cost vary widely, so access to SDF testing &mdash; and to interventions if abnormal &mdash; is uneven; not addressed directly.",
    "monday": "Inform (REI/andrology-facing). SDF testing is worth considering in unexplained infertility or recurrent loss with normal semen analysis, but assay and threshold variability limit how decisively it changes management. Not a MIGS-surgical issue.",
    "prompts": "<ol><li>In which couples does SDF testing actually change management versus add cost?</li><li>How do you handle assay-dependent thresholds when counseling on an elevated result?</li><li>What interventions for high SDF have real outcome evidence?</li></ol>",
},

# Prior malignancy/precancer & IVF/ICSI outcomes, PSM cohort, n=1004
"42104684": {
    "bottom": "Single-center retrospective cohort with propensity matching (251 patients with prior malignancy/precancer vs 753 controls). A cancer/precancer history was associated with significantly lower ovarian reserve and poorer embryo outcomes. Useful counseling data: prior oncologic disease/treatment can blunt IVF/ICSI performance, supporting realistic expectation-setting and, where possible, pre-treatment fertility preservation.",
    "question": "<strong>The clinical problem.</strong> Cancer survivors increasingly pursue IVF/ICSI, but how a prior malignancy or precancerous lesion (and its treatment) affects ovarian reserve and embryo outcomes is not well quantified. <strong>The question.</strong> Do women with a history of malignant tumors/precancerous lesions have worse IVF/ICSI ovarian-reserve and pregnancy outcomes than matched controls?",
    "pico": {
        "P": "1,004 IVF/ICSI patients (251 with prior malignancy/precancer, 753 PSM controls).",
        "I": "Not applicable &mdash; exposure is prior malignancy/precancerous lesion.",
        "C": "Propensity-matched controls without that history.",
        "O": "Ovarian reserve, embryo outcomes, cumulative live-birth rate.",
        "D": "Retrospective cohort with propensity matching.",
        "S": "1,004 patients / 1,258 retrieval cycles.",
    },
    "methods": "Single-center retrospective cohort (2015&ndash;2022) with propensity-score matching on baseline characteristics, comparing IVF/ICSI ovarian-reserve, embryo, and cumulative-live-birth outcomes between cancer/precancer-history patients and controls.",
    "findings": "Patients with a prior malignancy/precancerous lesion had significantly lower ovarian reserve and poorer embryo outcomes than matched controls, indicating measurable impairment of IVF/ICSI performance.",
    "rob": "Moderate. Retrospective and single-center; propensity matching addresses measured confounders but not unmeasured ones, and the heterogeneous &apos;malignancy/precancer&apos; exposure lumps varied diagnoses and treatments together.",
    "strengths": "Reasonable sample, propensity matching, and clinically-relevant cumulative endpoints &mdash; useful for survivor counseling.",
    "applicability": "Relevant to counseling cancer survivors pursuing ART and to the case for pre-treatment fertility preservation; the lumped exposure limits diagnosis-specific guidance.",
    "kb": "Adds matched-cohort evidence to the oncofertility literature documenting reduced reproductive potential after cancer/precancer and its treatment.",
    "equity": "Single-center cohort; survivors&apos; access to ART and prior fertility preservation varies widely, shaping who is even represented in such a cohort.",
    "monday": "Counsel / inform. Set realistic expectations for cancer survivors pursuing IVF/ICSI &mdash; prior malignancy/precancer is associated with lower ovarian reserve and poorer embryo outcomes &mdash; and reinforce the value of pre-treatment fertility preservation. Whole-patient relevance, not surgical.",
    "prompts": "<ol><li>How do you counsel a survivor on realistic IVF expectations without discouraging them?</li><li>Does lumping diverse cancers/treatments obscure diagnosis-specific effects you&apos;d want to know?</li><li>How does this strengthen the case for fertility preservation before cancer treatment?</li></ol>",
},

}
