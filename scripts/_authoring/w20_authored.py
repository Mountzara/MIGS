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
    "applicability": "Directly relevant to REI and to CBG/MIGS surgeons co-managing adenomyosis fertility patients, with a practical message for protocol selection by prognosis.",
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
    "bottom": "Five-year retrospective cohort (1,309 women) of laparoscopy for pelvic pain. The negative-laparoscopy rate was 13% overall but 2.5&times; higher among non-fellowship-trained gynecologists than fellowship-trained ones (OR 2.48), and there was a 56% discordance between intraoperative visual impression and histopathology. It is a strong argument for both fellowship-level (CBG/MIGS) training and routine biopsy in pelvic-pain laparoscopy.",
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
    "applicability": "Highly applicable to CBG/MIGS practice and referral patterns &mdash; it supports biopsy-confirmed assessment and fellowship-level surgery for complex pelvic pain.",
    "kb": "Reinforces the established teaching that visual-only laparoscopy under-detects and misclassifies endometriosis, and links diagnostic yield to surgeon training &mdash; central to the case for CBG/MIGS subspecialization.",
    "equity": "The public-vs-private and training-level gradient is itself an access-equity finding: patients in the public sector were more likely to receive visual-only, lower-yield laparoscopy &mdash; a disparity in diagnostic quality.",
    "monday": "Change / reinforce &mdash; squarely CBG/MIGS. Two actionable points: take biopsies (visual-only assessment missed or misclassified disease in over half of cases), and recognize that negative-laparoscopy rates are training-dependent &mdash; a concrete argument for referring complex pelvic pain to fellowship-trained surgeons. It validates biopsy-confirmed excisional practice over &apos;look and see.&apos;",
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
    "monday": "Inform (REI/lab-facing). Evidence favoring microfluidic sperm sorting on lab endpoints (less DNA fragmentation, more blastocysts), but it&apos;s retrospective and the live-birth advantage isn&apos;t established. A consideration for lab protocols, not a CBG/MIGS-surgical issue.",
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
    "monday": "Inform (REI-facing). A nuance for FET timing: for early-stage day-6 blastocysts, longer (day-7) progesterone exposure may reduce live birth, so match progesterone duration to expansion stage. Retrospective, so confirmatory data would help. Not a CBG/MIGS issue.",
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
    "monday": "Inform (REI/andrology-facing). SDF testing is worth considering in unexplained infertility or recurrent loss with normal semen analysis, but assay and threshold variability limit how decisively it changes management. Not a CBG/MIGS-surgical issue.",
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

# Baseline cardiometabolic/hepatic/renal profile & ART pregnancy, Ghana, n=206
"42104632": {
    "bottom": "Cross-sectional baseline study with prospective follow-up (206 infertile women, Accra, Ghana) testing whether pre-ART systemic metabolic health &mdash; lipids, blood count, renal and liver function &mdash; relates to ART pregnancy status. It advances the idea that pre-ART assessment should look beyond ovarian-reserve hormones to whole-body metabolic health, though as a single-center cross-sectional analysis it is associational.",
    "question": "<strong>The clinical problem.</strong> Pre-ART workups focus narrowly on ovarian reserve and semen, while systemic metabolic health &mdash; increasingly linked to reproductive outcomes &mdash; is rarely characterized, especially in under-studied populations. <strong>The question.</strong> Do baseline cardiometabolic, hepatic, renal, and hematologic profiles differ by subsequent ART pregnancy status in infertile women?",
    "pico": {
        "P": "206 infertile women (aged 28&ndash;60) at a Ghanaian fertility center.",
        "I": "Not applicable &mdash; baseline metabolic/hepatic/renal/hematologic profiling before ART.",
        "C": "Comparison by post-ART pregnancy status (positive vs negative).",
        "O": "Pregnancy after ART in relation to baseline labs.",
        "D": "Cross-sectional baseline assessment with prospective follow-up.",
        "S": "206.",
    },
    "methods": "Single-center study collecting fasting lipids, complete blood count, and renal/liver function before ART, then comparing profiles by post-procedure pregnancy status. Cross-sectional baseline design with limited follow-up detail.",
    "findings": "The study frames baseline systemic metabolic health as a candidate determinant of ART outcome, reporting baseline cardiometabolic/hepatic/renal/hematologic differences relevant to pregnancy status (specific effect sizes not fully detailed in the abstract).",
    "rob": "Moderate-to-high. Single-center, modest sample, wide age range (28&ndash;60), and association-only design without adjustment detail in the abstract. Hypothesis-generating.",
    "strengths": "Broadens the pre-ART lens to systemic metabolic health and contributes data from an under-represented Sub-Saharan African population.",
    "applicability": "Supports attention to general metabolic health before ART; not yet a basis for specific pre-ART metabolic targets.",
    "kb": "Adds to the growing literature linking metabolic health to reproductive outcomes, from a geographically under-represented setting.",
    "equity": "Valuable for adding Ghanaian data to a literature dominated by high-income-country cohorts &mdash; a positive representational contribution.",
    "monday": "Counsel / inform. Reinforces looking at whole-patient metabolic health before ART, not just ovarian reserve. Associational and single-center, so no specific new target &mdash; but a reasonable nudge toward optimizing metabolic health. Not surgical.",
    "prompts": "<ol><li>Which metabolic parameters, if any, would you optimize before ART based on current evidence?</li><li>How much does adding diverse-population data change confidence in metabolic&ndash;reproductive associations?</li><li>What prospective design would establish causality here?</li></ol>",
},

# MSH5 mutation causing POI, IVF success — family genetics
"42104542": {
    "bottom": "Genetic study of a Han Chinese family with three sisters affected by primary ovarian insufficiency, identifying a novel homozygous MSH5 splice-site variant (with successful IVF intervention). It extends the catalogue of monogenic POI causes and reinforces that familial/early POI warrants genetic evaluation &mdash; with implications for sisters and for timely fertility preservation.",
    "question": "<strong>The clinical problem.</strong> Primary ovarian insufficiency is genetically heterogeneous and frequently unexplained, yet identifying a cause has real value for affected relatives and reproductive planning. <strong>The question.</strong> What genetic variant underlies POI in this consanguineous family, and does it confirm MSH5 as a POI gene?",
    "pico": {
        "P": "Han Chinese family with three sisters affected by POI (parents unaffected).",
        "I": "Whole-exome and Sanger sequencing; functional splicing analysis.",
        "C": "Unaffected heterozygous parents / reference databases.",
        "O": "Causal variant identification; transcript/functional consequence.",
        "D": "Family-based genetic study with functional validation.",
        "S": "Single family (3 affected, 2 carrier parents).",
    },
    "methods": "Whole-exome sequencing of the proband, Sanger confirmation in relatives, and functional analysis showing the c.271+1G&gt;A variant causes aberrant MSH5 splicing with loss of exon 3. Single-family design with mechanistic validation.",
    "findings": "A novel homozygous MSH5 splice-donor variant segregated with POI in all three affected sisters (heterozygous in unaffected parents) and produced an aberrant transcript, confirming MSH5 loss-of-function as a POI cause; IVF was a successful therapeutic intervention.",
    "rob": "Appropriate for a gene-discovery report: strong segregation and functional data, but n=1 family, so penetrance and population frequency are not established.",
    "strengths": "Clear segregation, functional confirmation of the splicing defect, and a directly actionable genetic diagnosis for the family.",
    "applicability": "Supports genetic evaluation in familial/early POI; individual-gene findings inform counseling and cascade testing rather than population screening.",
    "kb": "Adds to the expanding monogenic-POI gene catalogue, consolidating MSH5 (a meiotic mismatch-repair gene) among confirmed causes.",
    "equity": "Single-family; the broader equity point is uneven access to genetic testing for POI, which leaves many families without a diagnosis or cascade screening.",
    "monday": "Counsel / refer. Reinforces offering genetic evaluation for familial or early POI &mdash; a diagnosis can guide cascade testing of sisters and prompt timely fertility preservation. Relevant to whole-patient gynecologic care.",
    "prompts": "<ol><li>When does POI warrant genetic testing in your practice, and which panel?</li><li>How does identifying a monogenic cause change counseling for the patient and her relatives?</li><li>How do you fold fertility-preservation timing into a new POI genetic diagnosis?</li></ol>",
},

# GREB1 frameshift mutation & female infertility — genetics
"42100493": {
    "bottom": "Whole-exome discovery of a novel homozygous GREB1 frameshift variant in a woman with primary infertility and repeated implantation failure, with functional and computational support. It establishes GREB1 as a candidate cause of female infertility tied to endometrial receptivity &mdash; a gene-discovery contribution, not a clinical test.",
    "question": "<strong>The clinical problem.</strong> Primary infertility affects ~15% of couples and many genetic causes &mdash; particularly those affecting endometrial receptivity and implantation &mdash; remain unknown. <strong>The question.</strong> Does a homozygous GREB1 mutation cause female infertility via impaired endometrial receptivity?",
    "pico": {
        "P": "Woman with primary infertility and repeated embryo-implantation failure (carrier parents).",
        "I": "Whole-exome sequencing; functional and computational analysis.",
        "C": "Reference databases (gnomAD/ExAC); heterozygous parents.",
        "O": "Variant identification and predicted/observed functional consequence.",
        "D": "Single-case gene-discovery study with functional validation.",
        "S": "n = 1 proband.",
    },
    "methods": "WES of an affected proband, Sanger confirmation of parental carrier status, western-blot and computational structural analysis of the variant&apos;s effect; the variant is absent from population databases.",
    "findings": "A novel homozygous GREB1 frameshift (c.5364delC) produced abnormal protein without nonsense-mediated decay and predicted pathogenic structural change, implicating GREB1 in endometrial-receptivity regulation and female infertility.",
    "rob": "Single-case discovery: strong functional support but n=1, so causality is suggested rather than population-established.",
    "strengths": "Functional and computational corroboration plus database absence strengthen pathogenicity; links to a biologically plausible endometrial-receptivity mechanism.",
    "applicability": "Research-level; not yet a clinical test, but contributes to understanding unexplained implantation failure.",
    "kb": "Expands the genetics of female infertility/implantation failure, adding GREB1 to receptivity-related candidate genes.",
    "equity": "n=1; broadly, access to exome sequencing for unexplained infertility is limited and uneven.",
    "monday": "Hold / inform. Gene-discovery work &mdash; no clinical test to order. Of interest for understanding unexplained implantation failure; nothing to change in management today.",
    "prompts": "<ol><li>At what point does recurrent implantation failure justify exome sequencing in your practice?</li><li>How do you communicate a research-level genetic finding to a patient?</li><li>What would move GREB1 from candidate gene to clinically-actionable test?</li></ol>",
},

# LH activity vs rFSH in ovarian stimulation — meta-analysis, 56 RCTs
"42100203": {
    "bottom": "Systematic review and meta-analysis of 56 RCTs (&gt;14,000 women) comparing gonadotropins with LH activity versus recombinant FSH alone for controlled ovarian stimulation. This is the strongest evidence tier in the week&apos;s infertility set; its head-to-head outcomes (live birth, oocytes, OHSS) directly inform stimulation-protocol choice.",
    "question": "<strong>The clinical problem.</strong> Whether adding LH activity to FSH in ovarian stimulation improves outcomes &mdash; and for whom &mdash; remains debated, with implications for live birth, oocyte yield, and OHSS risk. <strong>The question.</strong> How do gonadotropins with LH activity compare with recombinant FSH alone for efficacy and safety in controlled ovarian stimulation?",
    "pico": {
        "P": "Women undergoing controlled ovarian stimulation (across 56 RCTs).",
        "I": "Gonadotropins with LH activity (with or without rFSH).",
        "C": "Recombinant FSH alone (or different LH sources/doses).",
        "O": "Live births, ongoing pregnancies, oocytes and MII oocytes recovered, OHSS.",
        "D": "Systematic review and meta-analysis of RCTs.",
        "S": "56 RCTs, &gt;14,000 women.",
    },
    "methods": "Systematic search of MEDLINE, Embase, and CENTRAL for RCTs comparing LH-activity gonadotropins versus rFSH (or LH sources/doses), pooling mean differences and risk ratios for efficacy and safety outcomes. RCT-only inclusion is a methodological strength.",
    "findings": "Pooled across 56 RCTs, the review compares live birth, ongoing pregnancy, oocyte and MII-oocyte yield, and OHSS between LH-activity and rFSH protocols (direction/magnitude per the full results), providing the highest-quality synthesis available on this question.",
    "rob": "Low-to-moderate at the synthesis level (RCT-only, large), tempered by expected heterogeneity across trials in populations, LH sources, and protocols &mdash; the usual limits of pooling diverse stimulation RCTs.",
    "strengths": "Large RCT base, clinically-important endpoints including live birth and OHSS, and a rigorous meta-analytic approach &mdash; the most decision-relevant infertility paper in this set.",
    "applicability": "Directly informs ovarian-stimulation protocol selection in ART, especially weighing live-birth benefit against OHSS risk in relevant subgroups.",
    "kb": "Sits at the top of the evidence hierarchy for the LH-activity-versus-rFSH question, consolidating decades of RCTs.",
    "equity": "Cost differences between LH-activity preparations and rFSH affect access; subgroup applicability (e.g., poor responders, advanced age) shapes who benefits.",
    "monday": "Inform / consider (REI-facing). The best-evidence synthesis on adding LH activity to ovarian stimulation &mdash; worth incorporating into protocol decisions, weighing live-birth outcomes against OHSS. Not a CBG/MIGS-surgical issue, but the strongest infertility evidence this week.",
    "prompts": "<ol><li>In which patients does adding LH activity most plausibly change live-birth outcomes?</li><li>How do you weigh efficacy against OHSS risk and cost in protocol selection?</li><li>How much does between-trial heterogeneity limit applying a pooled estimate to your patient?</li></ol>",
},

# Sperm DFI/ROS/MMP predictive value in asthenozoospermia IVF, n=320+143
"42100189": {
    "bottom": "Retrospective cohort (320 asthenozoospermic men, 100 normal; 143 couples followed through IVF) assessing whether sperm DNA fragmentation index, reactive oxygen species, and mitochondrial membrane potential predict IVF outcomes. It reinforces that beyond-standard sperm-function markers carry prognostic signal, with a combined DFI/MMP approach &mdash; though retrospective and single-center.",
    "question": "<strong>The clinical problem.</strong> Conventional semen analysis poorly predicts IVF success in asthenozoospermia, and functional sperm markers (DFI, ROS, MMP) may add prognostic value. <strong>The question.</strong> Do sperm DFI, ROS, and mitochondrial membrane potential predict IVF pregnancy outcomes in asthenozoospermic patients?",
    "pico": {
        "P": "320 asthenozoospermic men + 100 normal controls; 143 couples in IVF-ET.",
        "I": "Not applicable &mdash; sperm DFI, ROS, and MMP measurement.",
        "C": "Normal semen parameters; threshold-based strata.",
        "O": "Fertilization, cleavage, high-quality embryo, blastocyst, clinical pregnancy, miscarriage, live birth.",
        "D": "Retrospective cohort.",
        "S": "420 men (143 IVF couples).",
    },
    "methods": "Retrospective measurement of conventional parameters plus DFI, ROS, and MMP, with threshold stratification, a combined DFI/MMP group, multivariable logistic regression, and ROC analysis for predictive value of IVF outcomes.",
    "findings": "Asthenozoospermic patients showed abnormal DFI/ROS/MMP profiles; these markers (and a combined DFI/MMP index) carried predictive value for IVF pregnancy and embryo outcomes on regression/ROC analysis.",
    "rob": "Moderate. Retrospective, single-center, with multiple thresholds and combined indices that raise overfitting/multiple-comparison concerns; no external validation of the predictive model.",
    "strengths": "Pairs multiple complementary sperm-function assays with clinical IVF endpoints and explores a combined predictor, which is more informative than single markers.",
    "applicability": "Supports considering functional sperm markers in asthenozoospermia prognosis; thresholds need external validation before routine use.",
    "kb": "Adds to the sperm-function-testing literature (DFI/ROS/MMP) linking oxidative/DNA-integrity measures to ART outcomes.",
    "equity": "Specialized sperm-function assays are not universally available, limiting equitable access to this prognostic information.",
    "monday": "Inform (REI/andrology-facing). Functional sperm markers (DFI, ROS, MMP) carry prognostic signal in asthenozoospermia IVF, but retrospective single-center data and unvalidated thresholds mean it&apos;s a consideration, not a standard. Not surgical.",
    "prompts": "<ol><li>Do combined sperm-function indices add enough over DFI alone to justify the testing?</li><li>How wary should you be of multiple thresholds derived in one retrospective dataset?</li><li>What would convince you to use these markers to guide ICSI-versus-IVF decisions?</li></ol>",
},

# "People behind the papers" interview — ICSI offspring mouse study
"42095842": {
    "bottom": "An interview/news feature, not a primary clinical study, accompanying a preclinical paper in which offspring of ICSI-derived male mice showed multi-organ inflammation and oxidative stress in development and higher miscarriage rates. The underlying work is provocative but animal-model and mechanistic &mdash; it raises a transgenerational-safety question about ICSI, not a clinical finding.",
    "question": "<strong>The clinical problem.</strong> ICSI bypasses natural sperm selection and is used widely, but its effects on subsequent generations are not well understood. <strong>The question (of the underlying study).</strong> Do offspring of ICSI-derived male mice show developmental abnormalities, inflammation, or oxidative stress that could signal transgenerational risk?",
    "pico": {
        "P": "Mouse model &mdash; offspring of ICSI-derived male mice.",
        "I": "ICSI-derived lineage.",
        "C": "Naturally-conceived mice.",
        "O": "Multi-organ inflammation/oxidative stress; miscarriage rates.",
        "D": "Preclinical animal study (reported via an interview feature).",
        "S": "Murine (not enumerated in the feature).",
    },
    "methods": "This item is a &apos;people behind the papers&apos; interview describing a preclinical mouse study; it carries no independent methodology. The underlying study used a murine ICSI lineage with developmental and inflammatory/oxidative readouts.",
    "findings": "The featured study reported that ICSI-derived male mice produced offspring with inflammation and oxidative stress across brain, heart, and placenta during development, and higher miscarriage rates &mdash; a transgenerational signal in mice.",
    "rob": "As a clinical-evidence source, not applicable &mdash; it is a news interview about animal data. Species translation to humans is the dominant limitation; human ICSI-offspring cohorts do not show comparable dramatic effects.",
    "strengths": "Communicates an important mechanistic safety question and the researchers&apos; perspective; useful for context, not for practice.",
    "applicability": "No direct clinical applicability; do not extrapolate murine transgenerational findings to ICSI counseling in humans.",
    "kb": "Sits in the ICSI-safety/transgenerational literature as a mechanistic, hypothesis-raising animal study (and its accompanying feature), distinct from human outcome cohorts.",
    "equity": "Not applicable; the broader point is responsible communication so animal findings are not misread as human ICSI risk.",
    "monday": "Hold. An interview about a mouse study &mdash; nothing to change in human ICSI counseling. Worth awareness as a transgenerational-safety research direction, but human data do not show comparable effects; avoid over-extrapolation.",
    "prompts": "<ol><li>How do you discuss provocative animal-model safety signals with patients without causing undue alarm?</li><li>What human-cohort evidence would be needed to take a transgenerational ICSI signal seriously?</li><li>How should journals frame interview features so preclinical findings aren&apos;t misread as clinical?</li></ol>",
},

# Limited interventions to improve male fertility — review/perspective
"42095308": {
    "bottom": "A perspective/review arguing that male-infertility treatment is neglected: because ART succeeds with few sperm, the field treats the woman even when the problem is male-factor, and there is under-investment in actual male-fertility therapeutics. More an agenda-setting commentary than evidence, but a fair critique of a real gap.",
    "question": "<strong>The clinical problem.</strong> Male-factor infertility is common, yet therapeutic development has lagged because ART circumvents (rather than treats) it &mdash; shifting the treatment burden onto the female partner. <strong>The question.</strong> Why is male-infertility therapeutic development so limited, and what is needed to advance it?",
    "pico": {
        "P": "Couples with male-factor infertility (field-level perspective).",
        "I": "Conceptual &mdash; development of male-directed fertility therapeutics.",
        "C": "Current ART-centric paradigm (treating the female partner).",
        "O": "Identification of barriers and future directions.",
        "D": "Narrative review / perspective.",
        "S": "Literature/field synthesis.",
    },
    "methods": "Narrative review and perspective summarizing barriers (the ART &apos;paradox,&apos; under-investment by researchers, governments, industry) and considerations for future male-infertility research. Opinion-weighted.",
    "findings": "It argues that ART&apos;s success has paradoxically de-prioritized male-fertility treatment, that the woman is often treated for a male-factor problem, and that insufficient investment blocks innovative male therapeutics.",
    "rob": "Perspective piece: low on graded evidence, high on argument; conclusions reflect expert opinion rather than data.",
    "strengths": "Names a genuine, under-discussed structural gap and the equity asymmetry of treating the female partner for male-factor infertility.",
    "applicability": "No direct practice change; useful framing for counseling couples about the asymmetry and for advocacy/research priorities.",
    "kb": "A position contribution to the male-infertility literature, reinforcing calls for investment in male-directed therapeutics.",
    "equity": "Centers an equity issue &mdash; the female partner bears invasive treatment for a male-factor problem &mdash; a fairness asymmetry worth naming in counseling.",
    "monday": "Counsel / inform. A useful reminder of the asymmetry in infertility care: ensure male-factor evaluation and counseling are not skipped just because ART can bypass them. No specific new intervention.",
    "prompts": "<ol><li>How thoroughly is male-factor infertility evaluated before defaulting to treating the female partner?</li><li>How do you discuss the treatment-burden asymmetry with couples?</li><li>What would meaningfully shift investment toward male-fertility therapeutics?</li></ol>",
},

# Scientometric analysis of spontaneous-abortion immunology — bibliometric
"42093970": {
    "bottom": "A 25-year scientometric/bibliometric analysis of 4,495 publications on the immunology of spontaneous abortion, mapping trends, collaboration networks, and research frontiers. It describes the shape of a research field rather than producing clinical evidence &mdash; useful for orientation, not for patient care.",
    "question": "<strong>The clinical problem.</strong> Reproductive immunology of pregnancy loss is large and fast-moving, making it hard to see the field&apos;s structure and emerging directions. <strong>The question.</strong> What are the publication trends, collaboration networks, and research frontiers in the immunology of spontaneous abortion over 2000&ndash;2025?",
    "pico": {
        "P": "4,495 publications on spontaneous-abortion immunology (Web of Science, 2000&ndash;2025).",
        "I": "Not applicable &mdash; bibliometric/scientometric analysis (CiteSpace, HistCite).",
        "C": "Not applicable.",
        "O": "Publication trends, collaboration/co-citation networks, keyword/frontier evolution.",
        "D": "Scientometric (bibliometric) analysis.",
        "S": "4,495 publications.",
    },
    "methods": "Bibliometric analysis of Web of Science records using CiteSpace and HistCite to map output trends, country/journal contributions, co-citation structure, and burst-detected frontiers. It analyzes the literature, not patients.",
    "findings": "Output grew rapidly from 2008, peaking in 2022; the American Journal of Reproductive Immunology led journals; China and the USA led collaboration; co-citation identified foundational works and emerging frontiers.",
    "rob": "Not a clinical-evidence study; limitations are bibliometric (database coverage, citation-based bias). It cannot inform diagnosis or treatment.",
    "strengths": "Provides a useful map of a complex field and its trajectory, helpful for researchers orienting to reproductive immunology.",
    "applicability": "No bedside applicability; relevant to research orientation and grant/literature strategy.",
    "kb": "A meta-level map of the spontaneous-abortion-immunology literature rather than a node of clinical evidence within it.",
    "equity": "Notes geographic concentration of output (China/USA), an indirect marker of global research-capacity inequity.",
    "monday": "Hold. A bibliometric map of a research field &mdash; nothing to apply clinically. Of interest for context on where reproductive-immunology research is heading, not for patient management.",
    "prompts": "<ol><li>How do you separate research-volume trends from clinical importance when reading a field map?</li><li>Do bibliometric frontiers reliably predict clinically-useful directions?</li><li>What does the geographic concentration of output imply for global applicability of findings?</li></ol>",
},

# Psychological flexibility moderating stress in IVF — SEM, n=204
"42087559": {
    "bottom": "Structural-equation-modeling study (204 IVF patients) showing that psychological flexibility moderates the link between intolerance of uncertainty and perceived stress &mdash; i.e., flexibility buffers the stress that uncertainty produces. A psychosocial-mechanism study supporting acceptance/flexibility-based support (e.g., ACT) during fertility treatment.",
    "question": "<strong>The clinical problem.</strong> IVF is saturated with uncertainty, and patients high in intolerance of uncertainty suffer more stress; whether a modifiable trait like psychological flexibility buffers this is clinically useful to know. <strong>The question.</strong> Does psychological flexibility moderate the relationship between intolerance of uncertainty and perceived stress in women undergoing IVF?",
    "pico": {
        "P": "204 women undergoing IVF treatment.",
        "I": "Not applicable &mdash; measured psychological flexibility as a moderator.",
        "C": "Not applicable (continuous moderation model).",
        "O": "Perceived stress (PSS-10) as a function of intolerance of uncertainty (IUS-12) and flexibility (MPFI-60).",
        "D": "Cross-sectional structural-equation modeling.",
        "S": "204.",
    },
    "methods": "Purposive-sample cross-sectional study using validated scales (IUS-12, PSS-10, MPFI-60) and covariance-based SEM with multi-group analysis to test moderation. Cross-sectional, so directionality is inferred from the model, not established.",
    "findings": "Intolerance of uncertainty and psychological inflexibility related to higher perceived stress, and psychological flexibility moderated (buffered) the uncertainty&ndash;stress relationship.",
    "rob": "Moderate. Cross-sectional (no causal/temporal claim), purposive sampling, and self-report scales; SEM tests a hypothesized structure rather than proving it.",
    "strengths": "Validated instruments, a coherent theoretical model, and a clinically-actionable, modifiable target (flexibility) amenable to ACT-style intervention.",
    "applicability": "Supports offering acceptance/flexibility-based psychological support to IVF patients, particularly those high in intolerance of uncertainty.",
    "kb": "Fits the psychosocial-oncology/infertility literature on acceptance and commitment approaches to treatment-related distress.",
    "equity": "Access to structured psychological support (e.g., ACT) during fertility treatment is uneven &mdash; an implementation-equity gap.",
    "monday": "Counsel / inform. Supports integrating flexibility/acceptance-based psychological support into IVF care, especially for patients who struggle with uncertainty. A whole-patient-care signal, not a procedure change.",
    "prompts": "<ol><li>Could brief acceptance/flexibility-based support be built into your IVF pathway?</li><li>How do you identify patients high in intolerance of uncertainty who might benefit most?</li><li>What would a trial of an ACT-based intervention during IVF need to show?</li></ol>",
},

# ART & birth defects, mediation by twin pregnancy, Hunan, n=745,671
"42086487": {
    "bottom": "Large provincial monitoring study (745,671 fetuses, Hunan) finding ART associated with higher birth-defect risk (aOR 1.84) and quantifying how much is mediated by twin pregnancy. Together with the Ontario endometriosis-anomalies paper, it reinforces a real but modest ART&ndash;anomaly association, with multiple/twin pregnancy as a key mediating pathway &mdash; arguing for single-embryo transfer.",
    "question": "<strong>The clinical problem.</strong> ART is associated with higher birth-defect risk, but how much is intrinsic versus driven by ART&apos;s tendency toward multiple gestation is important for counseling and for the single-embryo-transfer debate. <strong>The question.</strong> What is the ART&ndash;birth-defect association, and how much of it is mediated by twin pregnancy?",
    "pico": {
        "P": "745,671 fetuses (Hunan Province provincial monitoring, 2023&ndash;2024).",
        "I": "ART-conceived pregnancy.",
        "C": "Naturally-conceived pregnancy.",
        "O": "Birth defects; mediation by twin pregnancy.",
        "D": "Retrospective population-monitoring study with mediation analysis.",
        "S": "745,671 fetuses.",
    },
    "methods": "Retrospective comparison of ART- versus naturally-conceived pregnancies in large provincial surveillance data, with multivariable logistic regression, subgroup interaction analyses, and formal mediation analysis quantifying twin pregnancy&apos;s contribution.",
    "findings": "ART was a risk factor for birth defects (aOR 1.84, 95% CI 1.68&ndash;2.01), with twin pregnancy serving as a meaningful mediating pathway &mdash; implicating ART-associated multiple gestation in part of the excess risk.",
    "rob": "Moderate. Very large and population-based (strengths), but observational with residual confounding by indication (subfertility itself raises risk), and administrative defect ascertainment. The aOR is higher than some prior estimates, possibly reflecting case-mix.",
    "strengths": "Large surveillance denominator and a formal mediation analysis that operationalizes the clinically-important twin-pregnancy pathway, supporting single-embryo transfer.",
    "applicability": "Directly relevant to ART counseling and embryo-transfer policy; reinforces single-embryo transfer to reduce multiple-gestation-mediated risk.",
    "kb": "Complements the Ontario endometriosis-anomalies cohort this week; both reinforce a modest, real subfertility/ART&ndash;anomaly association with mediating pathways.",
    "equity": "Adds large-scale Chinese surveillance data; the SET implication has cost/access dimensions (number of cycles needed) that vary by funding system.",
    "monday": "Counsel / inform. Reinforces honest ART counseling: a real but modest increase in birth-defect risk, with twin pregnancy a key mediator &mdash; a concrete argument for single-embryo transfer. Frame the absolute risk carefully. Relevant to ART co-management.",
    "prompts": "<ol><li>How does the twin-mediation finding strengthen your single-embryo-transfer counseling?</li><li>How much of the ART&ndash;defect association is the underlying subfertility versus the technology?</li><li>How do you present an aOR of 1.84 without overstating absolute risk?</li></ol>",
},

# DFI variability epididymal vs testicular sperm — n=24
"42086360": {
    "bottom": "Small retrospective single-surgeon series (24 men with obstructive azoospermia/infertility and elevated DNA fragmentation) examining DFI variability between left/right testis and epididymis during surgical sperm retrieval. It probes whether bilateral extraction is needed when DFI is high &mdash; a niche andrology/surgical-retrieval question with a very small sample.",
    "question": "<strong>The clinical problem.</strong> In surgical sperm retrieval for obstructive azoospermia or infertility with high DNA fragmentation, sperm DNA integrity may vary by site (testis vs epididymis, left vs right), which could justify bilateral retrieval. <strong>The question.</strong> How variable is the DNA fragmentation index between retrieval sites, and is bilateral extraction necessary?",
    "pico": {
        "P": "24 men with obstructive azoospermia/infertility and elevated DFI.",
        "I": "Bilateral testicular biopsy and/or microscopic epididymal sperm aspiration (MESA).",
        "C": "Between-site comparison (left vs right testis/epididymis).",
        "O": "DFI variability between sites (TUNEL, normal &le;15%).",
        "D": "Retrospective single-surgeon case series.",
        "S": "24.",
    },
    "methods": "Retrospective analysis of men undergoing bilateral testicular biopsy and/or MESA by one surgeon (2020&ndash;2022), with TUNEL-based DFI measured per site to assess right-versus-left variability. Very small, single-operator series.",
    "findings": "The study characterizes substantial between-site DFI variability in surgically-retrieved epididymal/testicular sperm, raising the possibility that site selection matters and that bilateral assessment may be informative when DFI is elevated.",
    "rob": "High for generalization. n=24, single surgeon, retrospective, and a niche population; findings are exploratory.",
    "strengths": "Addresses a practical intraoperative question (which site/side to retrieve) with objective TUNEL measurement.",
    "applicability": "Narrow andrology/surgical-retrieval relevance; not generalizable from 24 patients, but hypothesis-forming for retrieval strategy.",
    "kb": "Adds a small data point to the sperm-retrieval-site/DNA-integrity literature in male infertility surgery.",
    "equity": "Surgical sperm retrieval and TUNEL testing are specialized and unevenly available; n=24 from one surgeon limits broad relevance.",
    "monday": "Hold / inform (andrology-facing). A small, exploratory series on retrieval-site DNA-fragmentation variability &mdash; too small to change retrieval practice, but a reminder that site selection may matter when DFI is high. Not a gynecologic-surgical issue.",
    "prompts": "<ol><li>Would site-specific DFI variability change how you plan surgical sperm retrieval?</li><li>How much weight can a 24-patient single-surgeon series carry?</li><li>What sample size would be needed to guide bilateral-versus-unilateral retrieval decisions?</li></ol>",
},

# ============================ HYSTERECTOMY ============================

# Platelet indices in placenta accreta spectrum, predicting peripartum hysterectomy, n=200
"42120176": {
    "bottom": "Retrospective three-group study (63 PAS, 67 previa, 70 controls) testing whether platelet indices predict placenta accreta spectrum and peripartum hysterectomy. PAS is a leading cause of massive obstetric hemorrhage and emergency hysterectomy, so a cheap predictive marker is attractive &mdash; but platelet indices are non-specific, and this single-center retrospective signal is at best an adjunct to imaging, never a replacement for antenatal ultrasound/MRI diagnosis and a planned surgical team.",
    "question": "<strong>The clinical problem.</strong> Placenta accreta spectrum drives catastrophic hemorrhage and peripartum hysterectomy, and antenatal risk stratification depends on imaging that is not universally available or definitive. <strong>The question.</strong> Do routine platelet indices (count, MPV, PDW, PCT, P-LCR) help diagnose PAS and predict the need for hysterectomy?",
    "pico": {
        "P": "200 pregnant women: PAS (63), placenta previa (67), controls (70).",
        "I": "Not applicable &mdash; first-trimester and preoperative platelet indices.",
        "C": "Placenta previa and control groups.",
        "O": "Diagnostic value for PAS; independent prediction of hysterectomy (ROC, regression).",
        "D": "Retrospective comparative.",
        "S": "200.",
    },
    "methods": "Single-center retrospective comparison of platelet indices across three groups with ROC-derived cut-offs and multivariable logistic regression to identify independent predictors of hysterectomy. Laboratory-marker study without external validation.",
    "findings": "The study reports diagnostic/prognostic associations between platelet indices and PAS and identifies independent predictors of hysterectomy on regression and ROC analysis (specific cut-offs in the full results).",
    "rob": "Moderate-to-high. Single-center, retrospective, modest groups, and platelet indices are non-specific (affected by many conditions). Risk of overfitting ROC cut-offs without external validation.",
    "strengths": "Uses cheap, universally-available labs and an appropriate three-group comparison with control for the diagnostic question.",
    "applicability": "At most a low-cost adjunct to imaging-based PAS risk assessment; it should not displace ultrasound/MRI diagnosis or planned multidisciplinary delivery.",
    "kb": "Joins a large literature seeking inexpensive hematologic predictors for obstetric complications, most of which lack the specificity to change management.",
    "equity": "Low-cost labs could, in principle, help in settings without advanced PAS imaging &mdash; an equity appeal &mdash; but only if validated, which it is not yet.",
    "monday": "Hold / counsel. Interesting but not practice-changing: platelet indices are non-specific and don&apos;t replace imaging-based PAS diagnosis or a planned surgical team. The real lesson is antenatal recognition and preparation for PAS, where peripartum hysterectomy must be anticipated.",
    "prompts": "<ol><li>Could a low-cost lab adjunct ever add value over imaging for PAS, and how would you validate it?</li><li>How does anticipating PAS change your surgical and transfusion planning for a peripartum hysterectomy?</li><li>What multidisciplinary structure does your center have for planned PAS delivery?</li></ol>",
},

# Opioid-free anesthesia + ERAS for laparoscopic total hysterectomy, n=255
"42120170": {
    "bottom": "Retrospective cohort (255 laparoscopic total hysterectomies) comparing traditional opioid-based anesthesia with opioid-free anesthesia plus ERAS. The OFA+ERAS group had better recovery-quality metrics (pain, PONV, cognition, recovery scores). It supports the broader ERAS/opioid-sparing direction in benign CBG/MIGS hysterectomy, though confounded by being a combined (OFA + ERAS) intervention and retrospective.",
    "question": "<strong>The clinical problem.</strong> Opioid-based anesthesia in laparoscopic hysterectomy contributes to PONV, ileus, and cognitive effects that slow recovery, and opioid-sparing pathways are increasingly favored. <strong>The question.</strong> Does opioid-free anesthesia combined with an ERAS protocol improve postoperative recovery quality after laparoscopic total hysterectomy?",
    "pico": {
        "P": "255 patients undergoing laparoscopic total hysterectomy (2023&ndash;2025).",
        "I": "Opioid-free anesthesia + ERAS protocol (131 patients).",
        "C": "Traditional opioid-based anesthesia (124 patients).",
        "O": "Recovery times, pain (VAS), cognition (MMSE), PONV, sleep, QoR-15/ADL.",
        "D": "Retrospective cohort.",
        "S": "255.",
    },
    "methods": "Single-center retrospective cohort comparing OFA+ERAS with conventional opioid anesthesia using validated recovery, pain, cognitive, and quality-of-recovery instruments, with multivariable adjustment for confounders. The intervention bundles two changes (OFA and ERAS), limiting attribution.",
    "findings": "The OFA+ERAS group showed improved recovery-quality outcomes &mdash; lower pain and PONV, better cognitive and quality-of-recovery scores &mdash; versus opioid-based anesthesia.",
    "rob": "Moderate. Retrospective allocation, single-center, and a bundled intervention (cannot separate OFA from ERAS effects). Adjustment mitigates but does not remove confounding.",
    "strengths": "Validated multidimensional recovery outcomes, reasonable sample, and alignment with the well-supported ERAS movement in gynecologic surgery.",
    "applicability": "Supports opioid-sparing, ERAS-based pathways for benign laparoscopic hysterectomy &mdash; directly relevant to CBG/MIGS perioperative practice.",
    "kb": "Reinforces the substantial ERAS/opioid-sparing evidence base in gynecologic and laparoscopic surgery.",
    "equity": "ERAS implementation requires institutional resources and protocols; access to optimized perioperative pathways varies between centers.",
    "monday": "Consider / reinforce &mdash; CBG/MIGS-relevant. Adds support for opioid-free anesthesia within an ERAS pathway for laparoscopic hysterectomy, with better recovery metrics. Retrospective and bundled, so confirmatory, not decisive &mdash; but consistent with where benign-hysterectomy perioperative care is already heading.",
    "prompts": "<ol><li>How much of the benefit is OFA versus the ERAS bundle, and does it matter if both are adopted together?</li><li>What are the barriers to implementing opioid-free anesthesia in your hysterectomy pathway?</li><li>Which recovery outcomes matter most to your patients and your discharge planning?</li></ol>",
},

# Heavy menstrual bleeding patient-experience survey, n=150
"42116120": {
    "bottom": "Patient-experience recall survey on heavy menstrual bleeding (150 respondents from 1,241 treated at a regional Australian center). It probes treatment access, satisfaction, side effects, decision regret, and alignment of patient/clinician goals. Low response rate limits inference, but it surfaces a real theme: HMB care often misaligns with patient priorities, and shared decision-making matters.",
    "question": "<strong>The clinical problem.</strong> Heavy menstrual bleeding affects 1 in 4 women and markedly degrades quality of life, yet patient experience of HMB treatment &mdash; satisfaction, side effects, regret, and goal alignment &mdash; is under-measured. <strong>The question.</strong> How do patients experience HMB treatment access, satisfaction, side effects, decision regret, and alignment with clinician goals?",
    "pico": {
        "P": "Women treated for HMB at a regional Victorian referral center (1,241 invited, 150 responded).",
        "I": "Not applicable &mdash; retrospective recall patient survey.",
        "C": "Not applicable.",
        "O": "Treatment access, satisfaction, side effects, decision regret, patient&ndash;clinician goal alignment.",
        "D": "Retrospective recall survey.",
        "S": "150 respondents (12% response).",
    },
    "methods": "Retrospective recall survey of women treated for HMB over ~5 years at a single referral center. The ~12% response rate (150/1,241) introduces substantial response bias.",
    "findings": "The survey gathered patient-reported experience across access, satisfaction, side effects, decision regret, and goal alignment, surfacing misalignment between patient and clinician treatment goals as a recurring theme (detailed proportions in the full results).",
    "rob": "High. Low response rate (response/recall bias), single-center, and retrospective self-report. Best read as qualitative/experiential insight, not representative prevalence.",
    "strengths": "Centers the patient voice and decision-regret/goal-alignment constructs that are often neglected in HMB outcome studies.",
    "applicability": "Supports shared decision-making and explicit goal-setting in HMB care; not a basis for prevalence claims.",
    "kb": "Adds patient-experience data to the HMB management literature, complementing efficacy-focused studies.",
    "equity": "Regional-center sampling and low response may under-represent the least-served patients; access and goal-alignment gaps are themselves equity concerns in HMB care.",
    "monday": "Counsel / reflect. The takeaway is communication: elicit patient goals explicitly in HMB management and watch for decision regret and goal misalignment. Worth reflecting on your own HMB counseling. No procedural change.",
    "prompts": "<ol><li>How do you elicit and document a patient&apos;s actual HMB treatment goals (bleeding control vs fertility vs avoiding surgery)?</li><li>How might a 12% response rate distort these findings?</li><li>Where does decision regret most often arise in your HMB pathway, and how could you reduce it?</li></ol>",
},

# Robotic systems & hysterectomy approach/outcomes, n=4821
"42115535": {
    "bottom": "Large single-center retrospective time-series (4,821 hysterectomies) on the adoption and outcomes of robotic-assisted surgery for benign and malignant disease. Robotic use rose sharply (6.1% to 38.2% overall; 12.5% to 55.9% for cervical cancer) with operative and complication outcomes similar to laparoscopy but at higher cost. A real-world adoption snapshot; the cost-without-clear-benefit signal is the practical message &mdash; and the cervical-cancer point sits against the LACC-trial caution about minimally-invasive radical hysterectomy.",
    "question": "<strong>The clinical problem.</strong> Robotic hysterectomy has been adopted rapidly despite higher cost and uncertain outcome advantages over conventional laparoscopy, and its appropriate role &mdash; especially in cervical cancer &mdash; is contested. <strong>The question.</strong> How has robotic adoption changed hysterectomy approach over a decade, and how do its outcomes and cost compare with laparoscopy?",
    "pico": {
        "P": "4,821 hysterectomy / radical-hysterectomy cases (benign and malignant).",
        "I": "Robotic-assisted hysterectomy.",
        "C": "Laparoscopic (and open) approaches.",
        "O": "Adoption trends; operative and complication outcomes; cost.",
        "D": "Retrospective time-series with propensity-score matching.",
        "S": "4,821.",
    },
    "methods": "Single-center retrospective study with time-series analysis of approach trends and propensity-score matching to compare robotic versus other approaches. Single-institution adoption data limit generalizability.",
    "findings": "Robotic use rose from 6.1% to 38.2% of hysterectomies (and to 55.9% for cervical cancer by 2024). Robotic and laparoscopic approaches yielded similar operative and complication outcomes, but robotic surgery incurred additional cost.",
    "rob": "Moderate. Single-center and retrospective; propensity matching addresses measured confounders. Cervical-cancer adoption data should be read against the LACC-trial evidence cautioning against minimally-invasive radical hysterectomy for cervical cancer.",
    "strengths": "Large sample, decade-long trend data, and propensity matching &mdash; a useful real-world picture of robotic adoption and its cost-outcome trade-off.",
    "applicability": "Directly relevant to CBG/MIGS approach selection and value discussions; supports that robotic offers similar benign outcomes at higher cost.",
    "kb": "Consistent with the broad literature showing comparable benign-hysterectomy outcomes for robotic vs laparoscopic with a cost premium; the oncologic application warrants LACC-aware caution.",
    "equity": "Higher robotic cost has health-system value implications; access to robotic platforms is itself unevenly distributed.",
    "monday": "Counsel / value-aware. For benign hysterectomy, robotic offers outcomes similar to laparoscopy at higher cost &mdash; a value, not an outcome, decision. For cervical cancer, weigh rising minimally-invasive adoption against LACC-trial evidence favoring open radical hysterectomy. Squarely a CBG/MIGS approach-selection issue.",
    "prompts": "<ol><li>For benign hysterectomy, what justifies the robotic cost premium when outcomes match laparoscopy?</li><li>How do you reconcile rising minimally-invasive radical hysterectomy use with LACC-trial findings?</li><li>How should value (cost-per-outcome) enter your approach selection?</li></ol>",
},

# Intrathecal morphine dose optimization in RALH, dual-center, n=100
"42115438": {
    "bottom": "Retrospective dual-center cohort (100 women) comparing two low-dose intrathecal morphine regimens (0.10 vs 0.15 mg) within ERAS for robotic-assisted laparoscopic hysterectomy. A narrow perioperative-analgesia optimization question; it informs ERAS analgesia fine-tuning (balancing pain control against pruritus/PONV/respiratory effects), not surgical technique.",
    "question": "<strong>The clinical problem.</strong> Within ERAS pathways for robotic hysterectomy, intrathecal morphine improves early analgesia, but the optimal low dose balances pain control against opioid side effects (pruritus, PONV, respiratory depression). <strong>The question.</strong> How do 0.10 mg and 0.15 mg intrathecal morphine compare for analgesic efficacy and safety in robotic-assisted laparoscopic hysterectomy?",
    "pico": {
        "P": "100 women undergoing robotic-assisted laparoscopic hysterectomy.",
        "I": "Intrathecal morphine 0.15 mg (&plusmn; levobupivacaine).",
        "C": "Intrathecal morphine 0.10 mg.",
        "O": "VAS pain at 3 timepoints, rescue opioids, PONV, pruritus, hemodynamics, Aldrete recovery.",
        "D": "Retrospective dual-center cohort.",
        "S": "100.",
    },
    "methods": "Retrospective dual-center comparison of two low-dose ITM regimens with VAS pain at PACU arrival/discharge and 24 h, plus rescue-opioid, side-effect, and recovery metrics. Retrospective and modest sample.",
    "findings": "The study compares analgesic efficacy and side-effect profiles of the two ITM doses across the perioperative timepoints to identify the better-balanced regimen (specific dose recommendation in the full results).",
    "rob": "Moderate. Retrospective, n=100, dual-center; allocation not randomized, and outcomes (VAS, side effects) are susceptible to documentation variability.",
    "strengths": "Practical, ERAS-aligned dose-optimization question with relevant safety endpoints (pruritus, PONV) alongside analgesia.",
    "applicability": "Relevant to anesthesia/ERAS protocols for robotic hysterectomy; a fine-tuning input, not a surgical decision.",
    "kb": "Adds to the intrathecal-morphine dosing literature within gynecologic ERAS pathways.",
    "equity": "Neuraxial-analgesia expertise and ERAS infrastructure vary by center, affecting who receives optimized perioperative analgesia.",
    "monday": "Inform (anesthesia/ERAS-facing). A dose-optimization data point for intrathecal morphine in robotic hysterectomy ERAS &mdash; useful for your anesthesia colleagues&apos; protocols, balancing analgesia against pruritus/PONV. Not a surgical-technique change.",
    "prompts": "<ol><li>Where is the sweet spot between analgesia and side effects for intrathecal morphine in your ERAS pathway?</li><li>How does predictable neuraxial analgesia affect your early-mobilization and discharge planning?</li><li>Would you want a randomized comparison before standardizing a dose?</li></ol>",
},

# vNOTES hysterectomy reduces laparotomy conversion in class III obesity, n=134
"42113611": {
    "bottom": "Retrospective comparison (134 obese patients: 70 laparoscopic, 64 vNOTES hysterectomy) stratified by obesity class. vNOTES took longer (205 vs 178 min) with similar major-complication rates, but the standout finding is reduced laparotomy conversion in class III obesity (BMI &ge; 40). A genuinely CBG/MIGS-relevant signal: vNOTES may be a valuable route to avoid open conversion in the most challenging-access obese patients.",
    "question": "<strong>The clinical problem.</strong> Severe (class III) obesity makes laparoscopic hysterectomy technically difficult and raises the risk of conversion to laparotomy, with its added morbidity; vaginal natural-orifice (vNOTES) approaches may bypass the abdominal-access problem. <strong>The question.</strong> In obese patients, how do laparoscopic and vNOTES hysterectomy compare for operative outcomes and laparotomy conversion, by obesity class?",
    "pico": {
        "P": "134 patients (BMI &ge; 30) undergoing benign hysterectomy (70 laparoscopic, 64 vNOTES).",
        "I": "vNOTES hysterectomy.",
        "C": "Laparoscopic hysterectomy.",
        "O": "Operative time, major complications, laparotomy conversion (stratified by obesity class).",
        "D": "Retrospective comparative.",
        "S": "134.",
    },
    "methods": "Single-center retrospective review of obese patients undergoing LH or vNOTES hysterectomy (2020&ndash;2024), with outcomes stratified by obesity class (I/II/III). Retrospective allocation and modest, class-III subgroup sizes are limitations.",
    "findings": "vNOTES had longer median operative time (205 vs 178 min, P&lt;0.01) with similar overall major-complication rates; the key finding was reduced laparotomy conversion with vNOTES in class III obesity (BMI &ge; 40).",
    "rob": "Moderate. Retrospective, single-center, non-randomized (selection bias in approach choice), and the headline benefit rests on a class III subgroup of limited size. Hypothesis-supporting.",
    "strengths": "Addresses a real, difficult CBG/MIGS problem (access in severe obesity) with class-stratified outcomes and a clinically-meaningful endpoint (avoiding open conversion).",
    "applicability": "Directly relevant to CBG/MIGS route selection in obese patients; supports considering vNOTES to reduce open conversion in class III obesity, accepting longer operative time.",
    "kb": "Adds to the growing vNOTES literature, extending its potential value to the technically-hard severe-obesity population.",
    "equity": "vNOTES requires specific training and is not universally available; severely obese patients &mdash; who may benefit most &mdash; could face access barriers to surgeons offering it.",
    "monday": "Consider &mdash; CBG/MIGS-relevant. For benign hysterectomy in class III obesity, vNOTES may reduce laparotomy conversion versus laparoscopy, at the cost of longer operative time and similar complications. Retrospective, so a reasonable option to weigh and discuss, not a mandate &mdash; squarely in the CBG/MIGS toolkit for difficult-access patients.",
    "prompts": "<ol><li>In which obese patients would you preferentially consider vNOTES to avoid open conversion?</li><li>How do you weigh longer operative time against a lower conversion risk?</li><li>What training/credentialing is needed before adding vNOTES for this population?</li></ol>",
},

# Iatrogenic ureteric injuries post-hysterectomy — 2 case reports
"42103338": {
    "bottom": "Two case reports of ureterovaginal fistula after hysterectomy, managed differently (one with double-J stent/PCN/conservative care, one requiring definitive surgery after recurrence). It is a clean reminder of one of the most feared CBG/MIGS/gynecologic-surgery complications &mdash; ureteric injury &mdash; and that early recognition plus individualized, escalation-ready management drives outcomes.",
    "question": "<strong>The clinical problem.</strong> Ureteric injury is among the most serious complications of hysterectomy, and ureterovaginal fistula can follow unrecognized or delayed-recognition injury; optimal management (conservative vs surgical) depends on severity and timing. <strong>The question.</strong> How should post-hysterectomy ureteric injuries/ureterovaginal fistulas be recognized and managed?",
    "pico": {
        "P": "Two women (mid-40s) with post-hysterectomy ureterovaginal fistula.",
        "I": "Double-J stenting, percutaneous nephrostomy, conservative vs definitive surgical repair.",
        "C": "Not applicable (case series).",
        "O": "Resolution; need for definitive surgery.",
        "D": "Two case reports.",
        "S": "n = 2.",
    },
    "methods": "Descriptive two-patient case series detailing presentation, imaging, and stepwise management of post-hysterectomy ureterovaginal fistula. No comparator or generalizable rate.",
    "findings": "One patient resolved with stenting/PCN/conservative care; the other recurred after PCN and required definitive surgical repair &mdash; illustrating that individualized, escalation-ready management is needed and that conservative and surgical approaches each have a role.",
    "rob": "n=2; illustrative only, with selection toward instructive cases. No incidence or comparative-effectiveness inference.",
    "strengths": "A practical management teaching case for a high-stakes complication, spanning the conservative-to-surgical spectrum.",
    "applicability": "Directly relevant to CBG/MIGS practice: reinforces intraoperative ureteric awareness, early postoperative recognition of injury, and a graded management pathway.",
    "kb": "Consistent with established teaching on ureteric-injury recognition and management after gynecologic surgery; a reinforcing exemplar rather than new evidence.",
    "equity": "Access to interventional uroradiology (stent/PCN) and reconstructive urology shapes management options and outcomes after ureteric injury.",
    "monday": "Counsel / caution &mdash; core CBG/MIGS complication. Reinforces ureteric vigilance: know the ureter&apos;s course, consider intraoperative assessment in difficult cases, and recognize postoperative fistula early. Management is individualized &mdash; conservative stenting/PCN for some, definitive repair for others. A teaching reminder, not new evidence.",
    "prompts": "<ol><li>In which hysterectomies do you take specific steps (ureterolysis, stents, cystoscopy) to protect or confirm the ureter?</li><li>What postoperative findings should trigger immediate evaluation for ureteric injury?</li><li>How do you decide between conservative and surgical management of a ureterovaginal fistula?</li></ol>",
},

# Hysterectomy & ovarian cancer risk, Korean national cohort, n=26118 matched
"42090413": {
    "bottom": "Large Korean national-cohort study (13,059 benign-hysterectomy patients vs 13,059 propensity-matched controls, median 11.5-year follow-up) on subsequent ovarian-cancer risk. It addresses a question patients ask &mdash; does hysterectomy (with ovarian conservation) change ovarian-cancer risk? &mdash; in an under-studied Asian population, informing counseling about ovary-sparing benign hysterectomy and opportunistic salpingectomy decisions.",
    "question": "<strong>The clinical problem.</strong> Patients undergoing benign hysterectomy with ovarian conservation ask how the surgery affects their later ovarian-cancer risk, and Asian-population data are sparse. <strong>The question.</strong> Is benign hysterectomy (with or without concomitant adnexal surgery) associated with subsequent ovarian-cancer risk in South Korean women?",
    "pico": {
        "P": "13,059 women with benign hysterectomy (age 40&ndash;59) vs 13,059 PSM controls (NHIS).",
        "I": "Hysterectomy for benign indications (&plusmn; concomitant adnexal surgery).",
        "C": "Propensity-matched women without hysterectomy.",
        "O": "Incident ovarian cancer (Cox hazard ratios).",
        "D": "Retrospective national cohort with propensity matching.",
        "S": "26,118 matched.",
    },
    "methods": "Retrospective cohort from the Korean National Health Insurance Service (2002&ndash;2020) with 1:1 propensity matching and Cox proportional-hazards modeling for incident ovarian cancer over a median 11.5 years, adjusting for demographic/clinical confounders. Claims-based outcome definition.",
    "findings": "Over median 11.5-year follow-up, ovarian-cancer incidence was reported per group (e.g., 18 per 100,000 person-years in the hysterectomy arm) with Cox-estimated hazard ratios quantifying the association (direction/magnitude in the full results).",
    "rob": "Moderate. Large and propensity-matched (strengths), but claims-based ascertainment, potential residual confounding, and the effect of concomitant adnexal surgery may complicate the ovarian-conservation interpretation.",
    "strengths": "Large national denominator, long follow-up, propensity matching, and valuable data from an under-represented Asian population.",
    "applicability": "Informs counseling about ovarian-cancer risk after ovary-sparing benign hysterectomy and contributes to opportunistic-salpingectomy discussions.",
    "kb": "Adds Asian-population evidence to the literature on hysterectomy, ovarian conservation, and ovarian-cancer risk, where opportunistic salpingectomy is increasingly standard.",
    "equity": "National-insurance data improve representativeness within Korea and add geographic diversity to a literature dominated by Western cohorts.",
    "monday": "Counsel / inform &mdash; CBG/MIGS-relevant. Useful national-cohort data for counseling about ovarian-cancer risk after benign hysterectomy, and for framing opportunistic salpingectomy decisions. Observational, so it informs counseling rather than mandating a change.",
    "prompts": "<ol><li>How does this inform your counseling on ovarian conservation versus removal at benign hysterectomy?</li><li>Where does opportunistic salpingectomy fit for these patients?</li><li>How much should claims-based cancer ascertainment temper the estimate?</li></ol>",
},

# ============================ POLYCYSTIC OVARY SYNDROME ============================

# Shared PCOS/T2DM immune-inflammatory gene networks — bioinformatics
"42109727": {
    "bottom": "Bioinformatics study mining public datasets (GSE34526, GSE25724) for immune/inflammation genes shared between PCOS and type 2 diabetes, with drug prediction and some experimental validation. It supports the well-established PCOS&ndash;T2DM metabolic link at a molecular level but is hypothesis-generating target-discovery, not clinical evidence &mdash; nothing to order or prescribe.",
    "question": "<strong>The clinical problem.</strong> PCOS and type 2 diabetes are bidirectionally linked, but the shared molecular drivers &mdash; and whether they reveal druggable targets &mdash; are incompletely understood. <strong>The question.</strong> What immune/inflammation-related genes and pathways are shared between PCOS and T2DM, and do they predict candidate therapeutics?",
    "pico": {
        "P": "Public PCOS and T2DM transcriptomic datasets (GSE34526, GSE25724).",
        "I": "Bioinformatic identification of shared differentially-expressed genes; drug prediction.",
        "C": "Disease vs control groups within datasets.",
        "O": "Shared immune/inflammatory genes/pathways; candidate drugs; partial experimental validation.",
        "D": "Bioinformatics with experimental validation.",
        "S": "Public microarray datasets.",
    },
    "methods": "Differential-expression and pathway analysis across public PCOS and T2DM datasets to find shared immune/inflammatory genes, network and drug-prediction analyses, with some experimental validation. In-silico-led, dataset-dependent.",
    "findings": "The study identifies shared immune/inflammation-related genes and pathways linking PCOS and T2DM and predicts candidate drugs targeting them, with partial experimental corroboration.",
    "rob": "Preclinical/bioinformatic limits: reliance on small public datasets, batch/heterogeneity effects, and the long gap between predicted targets and clinical utility. Hypothesis-generating only.",
    "strengths": "Integrates transcriptomic, network, and drug-prediction analyses with some validation to give a mechanistic account of a real clinical comorbidity.",
    "applicability": "No bedside applicability; relevant only as target discovery for the PCOS&ndash;metabolic axis.",
    "kb": "Adds molecular detail to the firmly-established PCOS&ndash;T2DM metabolic-comorbidity literature.",
    "equity": "No population/equity dimension; the clinical reality it reflects &mdash; metabolic comorbidity in PCOS &mdash; has major long-term-health-equity implications.",
    "monday": "Hold / counsel. Mechanistic bioinformatics &mdash; nothing to order. The actionable clinical reality it underlines is unchanged: screen PCOS patients for metabolic risk and manage T2DM risk proactively.",
    "prompts": "<ol><li>How aggressively do you screen and manage metabolic risk in your PCOS patients?</li><li>What would move a predicted drug target from bioinformatics toward a trial?</li><li>Does shared inflammatory biology change how you frame PCOS as a systemic condition?</li></ol>",
},

# AutoPCOS ML diagnostic framework
"42095178": {
    "bottom": "Machine-learning proof-of-concept (AutoPCOS) building stepwise multimodal PCOS-prediction models (clinical, +laboratory, +ultrasound) on a public Kaggle dataset, with Random Forest as the primary classifier. It demonstrates a flexible diagnostic-support concept for resource-limited settings, but Kaggle-dataset training and absent external validation mean it is not a clinical tool.",
    "question": "<strong>The clinical problem.</strong> PCOS diagnosis requires multimodal evaluation (clinical, labs, ultrasound) that is time-consuming, costly, and resource-dependent, limiting access. <strong>The question.</strong> Can a stepwise multimodal machine-learning framework support PCOS risk stratification flexibly based on whatever data are available?",
    "pico": {
        "P": "Public Kaggle PCOS dataset (clinical, laboratory, ultrasound features).",
        "I": "AutoPCOS stepwise multimodal ML (Random Forest primary).",
        "C": "Logistic regression, SVM, decision tree, and partial-modality models.",
        "O": "Predictive performance across data-availability tiers.",
        "D": "Retrospective machine-learning modeling.",
        "S": "Public dataset (sample per Kaggle source).",
    },
    "methods": "Feature categorization into clinical/laboratory/ultrasound modalities, four predictive models by data availability, Random Forest primary with comparator algorithms, evaluated on a public Kaggle dataset. Single open dataset, internal evaluation.",
    "findings": "The multimodal models supported PCOS risk stratification with performance increasing as more data modalities were added; the framework is designed to function flexibly when only partial data are available.",
    "rob": "High for clinical deployment. Public Kaggle dataset (quality/provenance limits), no external/prospective validation, and risk of optimistic internal performance. A methods demonstration.",
    "strengths": "A pragmatic, modality-flexible design aimed at low-resource access, and head-to-head algorithm comparison.",
    "applicability": "Not clinically usable as-is; conceptually interesting for resource-limited diagnostic support pending real-world validation.",
    "kb": "Part of the expanding ML-in-gynecology literature, most of which remains proof-of-concept on public datasets.",
    "equity": "Explicitly motivated by access &mdash; a flexible tool for resource-limited settings &mdash; but Kaggle-trained models risk poor transportability to the very populations they aim to serve.",
    "monday": "Hold. A proof-of-concept PCOS ML framework on a public dataset &mdash; not a validated diagnostic tool. Continue diagnosing PCOS by established (Rotterdam/guideline) criteria; watch ML diagnostics but demand external validation.",
    "prompts": "<ol><li>What real-world validation would a PCOS diagnostic-support model need before clinical use?</li><li>Does modality-flexible prediction genuinely help access, or risk under-evaluation?</li><li>How do Kaggle-trained models risk failing in real, diverse populations?</li></ol>",
},

# AMH-based PCOS diagnostic strategy (JSOG + Rotterdam), n=270
"42092744": {
    "bottom": "Japanese nationwide-survey study (270 women with oligomenorrhea and antral follicle count &ge;10) evaluating an AMH cut-off to reclassify PCOS in patients who fail the endocrine-based JSOG 2024 criteria, combining JSOG with Rotterdam/international 2023 criteria. It addresses a real diagnostic-criteria gap: AMH may capture PCOS patients missed by criteria requiring endocrinologic abnormalities.",
    "question": "<strong>The clinical problem.</strong> PCOS diagnostic criteria differ internationally, and the Japanese (JSOG) criteria require endocrinologic abnormalities, potentially missing patients the Rotterdam/international criteria would capture; AMH (a marker of follicle number) might bridge that gap. <strong>The question.</strong> Does an AMH cut-off, combined with JSOG 2024 and Rotterdam/IEBG 2023 criteria, improve PCOS diagnosis in patients who fail JSOG criteria?",
    "pico": {
        "P": "270 women with irregular cycles and antral follicle count &ge; 10 (Japan).",
        "I": "AMH cut-off (level 2) combined with JSOG 2024 + Rotterdam/IEBG 2023 criteria.",
        "C": "JSOG 2024 criteria alone.",
        "O": "Proportion reclassified/diagnosed as PCOS.",
        "D": "Nationwide cross-sectional survey.",
        "S": "270.",
    },
    "methods": "Nationwide-survey data on 270 patients assessed against JSOG 2024 criteria, with an AMH cut-off applied to those failing JSOG to estimate additional diagnoses under a combined criteria approach. Diagnostic-criteria reclassification study.",
    "findings": "Of 270, 78.9% met JSOG 2024 criteria via endocrine abnormalities; among the 21.1% who did not, a majority (63.2%) were additionally identified using the AMH cut-off, supporting a combined JSOG + Rotterdam/AMH approach.",
    "rob": "Moderate. Cross-sectional reclassification without an external gold standard for PCOS, AMH-assay/cut-off standardization concerns, and Japan-specific criteria limit transportability.",
    "strengths": "Tackles a concrete diagnostic-criteria harmonization problem with a clinically-available marker (AMH) and a nationwide sample.",
    "applicability": "Most relevant to Japanese practice reconciling JSOG with international criteria; the AMH-as-PCOS-marker concept is broadly topical but assay-dependent.",
    "kb": "Contributes to the ongoing international PCOS-criteria harmonization debate and the role of AMH within it.",
    "equity": "Criteria differences create diagnostic inequities across health systems; AMH-assay availability and standardization shape who gets correctly diagnosed.",
    "monday": "Inform / consider. Reinforces the role of AMH in PCOS diagnosis where standard criteria fall short, within the international move toward harmonized (Rotterdam/IEBG) criteria. Most directly relevant to settings using JSOG criteria; assay standardization is the caveat.",
    "prompts": "<ol><li>Where does AMH currently fit in your PCOS diagnostic workflow, given assay variability?</li><li>How should differing national criteria be reconciled for consistent diagnosis?</li><li>What are the risks of over-diagnosing PCOS by lowering the diagnostic threshold?</li></ol>",
},

# ============================ OPERATIVE HYSTEROSCOPY ============================

# Esketamine dose-response on propofol for hysteroscopy — RCT, n=112
"42112091": {
    "bottom": "Well-designed randomized, double-blind dose-response RCT (112 women, five esketamine doses 0&ndash;0.4 mg/kg) measuring how esketamine reduces the propofol effect-site concentration needed to suppress movement during cervical dilation in operative hysteroscopy. A rigorous anesthesia-optimization study: esketamine as a propofol-sparing adjunct could reduce the respiratory/hemodynamic risks of deep propofol anesthesia for hysteroscopy.",
    "question": "<strong>The clinical problem.</strong> Operative hysteroscopy under propofol often requires high propofol concentrations to suppress movement during painful cervical dilation, raising respiratory and hemodynamic risk; a propofol-sparing adjunct would improve safety. <strong>The question.</strong> Does esketamine dose-dependently reduce the propofol effect-site concentration required to suppress cervical-dilation movement during operative hysteroscopy?",
    "pico": {
        "P": "112 adult women undergoing elective operative hysteroscopy.",
        "I": "Esketamine 0.1, 0.2, 0.3, or 0.4 mg/kg before induction.",
        "C": "Esketamine 0 mg/kg (placebo).",
        "O": "Propofol effect-site concentration suppressing cervical-dilation movement (dose-response).",
        "D": "Randomized, double-blind, parallel-group dose-response trial.",
        "S": "112.",
    },
    "methods": "Prospective randomized, double-blind, parallel-group dose-response trial across five esketamine doses with target-controlled propofol infusion, measuring the effect-site concentration suppressing movement at cervical dilation. Strong design for the pharmacodynamic question.",
    "findings": "The trial quantifies a dose-dependent reduction in required propofol effect-site concentration with increasing esketamine dose, characterizing esketamine&apos;s propofol-sparing effect during hysteroscopic cervical dilation (specific dose-response in the full results).",
    "rob": "Low for the pharmacodynamic question: randomized, double-blind, placebo-anchored dose-response. Single-center and a surrogate endpoint (movement suppression) rather than patient-centered safety outcomes are the main limits.",
    "strengths": "Rigorous randomized double-blind dose-response design directly answering a practical anesthesia-safety question for a common gynecologic procedure.",
    "applicability": "Relevant to anesthesia practice for operative hysteroscopy &mdash; supports esketamine as a propofol-sparing adjunct; informs your anesthesia colleagues more than surgical technique.",
    "kb": "Adds high-quality dose-response data to the propofol-adjunct/esketamine literature in procedural sedation.",
    "equity": "Esketamine availability and anesthesia-protocol sophistication vary by setting, affecting who benefits from propofol-sparing techniques.",
    "monday": "Inform (anesthesia-facing). High-quality evidence that esketamine spares propofol during operative hysteroscopy, potentially improving cardiorespiratory safety. Worth raising with your anesthesia team for hysteroscopy sedation protocols. Not a surgical-technique change.",
    "prompts": "<ol><li>Could a propofol-sparing adjunct improve safety in your higher-risk hysteroscopy patients?</li><li>Does a movement-suppression surrogate translate to fewer real respiratory/hemodynamic events?</li><li>What esketamine dose best balances propofol sparing against its own side effects?</li></ol>",
},

# Hysteroscopic evacuation vs Femoston for retained products of conception, n=75
"42093117": {
    "bottom": "Prospective comparative study (75 women with retained products of conception after abortion) of hysteroscopic evacuation versus oral estrogen-progestogen (Femoston). The medical (Femoston) group had shorter bleeding, earlier menses, thicker post-treatment endometrium, and fewer adverse outcomes (infection, adhesions). It suggests medical management may be a reasonable, less-invasive first option for selected RPOC &mdash; but allocation was by patient preference, a major bias.",
    "question": "<strong>The clinical problem.</strong> Retained products of conception after abortion cause bleeding and infection and traditionally prompt instrumental/hysteroscopic evacuation, which risks intrauterine adhesions (Asherman syndrome). A medical alternative could spare the uterus. <strong>The question.</strong> How does hysteroscopic evacuation compare with oral estrogen-progestogen therapy for resolving RPOC and avoiding complications?",
    "pico": {
        "P": "75 women with post-abortion retained products of conception.",
        "I": "Oral estrogen-progestogen therapy (Femoston).",
        "C": "Hysteroscopic evacuation.",
        "O": "Bleeding duration, time to menses, endometrial thickness, success, adverse outcomes (infection, adhesions).",
        "D": "Prospective comparative (preference-allocated).",
        "S": "75.",
    },
    "methods": "Prospective comparison with treatment allocated by informed patient preference (38 Femoston, 37 hysteroscopy), comparing bleeding, menstrual resumption, endometrial thickness, success, and adverse events. Preference-based allocation is the key bias.",
    "findings": "The Femoston group had shorter bleeding, earlier menstrual resumption, greater post-treatment endometrial thickness, and fewer adverse outcomes (including infection and adhesions); both groups improved clinically.",
    "rob": "Moderate-to-high. Preference-based (non-randomized) allocation introduces selection bias (likely milder RPOC chose medical management), single-center, and modest sample. The adhesion-avoidance signal is plausible but confounded.",
    "strengths": "Prospective design addressing a clinically-meaningful trade-off (uterine-sparing medical therapy vs instrumentation and adhesion risk) with relevant endometrial outcomes.",
    "applicability": "Supports considering medical management for selected, stable RPOC to avoid instrumentation and adhesion risk &mdash; relevant to CBG/MIGS/benign gynecology &mdash; with appropriate patient selection.",
    "kb": "Adds to the RPOC-management literature weighing expectant/medical versus surgical (hysteroscopic) approaches and Asherman-risk mitigation.",
    "equity": "Access to hysteroscopy versus medical therapy varies; a low-tech oral option could widen access where hysteroscopic resources are limited.",
    "monday": "Consider / counsel &mdash; CBG/MIGS-relevant. For selected stable RPOC, medical management (estrogen-progestogen) may avoid instrumentation and reduce adhesion risk, with faster recovery. Preference-allocated and small, so it informs shared decision-making rather than mandating a switch; hysteroscopic evacuation remains appropriate when indicated.",
    "prompts": "<ol><li>Which RPOC patients are suitable for medical rather than hysteroscopic management?</li><li>How much does preference-based allocation undermine the comparison?</li><li>How heavily does adhesion (Asherman) risk weigh in your RPOC management choice?</li></ol>",
},

# ============================ ICG FLUORESCENCE IN GYNECOLOGIC SURGERY ============================
# (Pelvic reconstructive / bowel-bladder cases relevant to complex CBG/MIGS technique transfer.)

# Robot-assisted sigmoid colon conduit urinary diversion — case report
"42119081": {
    "bottom": "Single case report of a single-stage robot-assisted sigmoid-colon-conduit urinary diversion that avoids bowel anastomosis, in a 46-year-old with a devastating post-radiation pelvis (rectovaginal fistula with loop colostomy, bilateral ureteral strictures, radiation cystitis, parastomal hernia). It is squarely in the complex-CBG/MIGS technique-transfer space &mdash; ureteric and bladder reconstruction in the irradiated pelvis is exactly the deep-endometriosis/oncologic terrain CBG/MIGS surgeons enter, and minimally-invasive diversion that avoids a bowel anastomosis is a useful conceptual tool.",
    "question": "<strong>The clinical problem.</strong> Late radiation injury after pelvic-malignancy treatment can require both urinary and fecal diversion, and a standard ileal conduit adds a bowel anastomosis with its leak risk &mdash; especially hazardous in a frail, irradiated, multiply-operated pelvis. <strong>The question.</strong> Can a robot-assisted sigmoid-colon-conduit urinary diversion provide effective diversion while avoiding a new bowel anastomosis?",
    "pico": {
        "P": "46-year-old woman with prior pelvic chemoradiation and severe genitourinary/GI sequelae.",
        "I": "Single-stage robot-assisted sigmoid colon conduit urinary diversion (using existing colostomy limb).",
        "C": "None (case report).",
        "O": "Feasibility; avoidance of bowel anastomosis; morbidity.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
    "methods": "Descriptive single case report detailing the clinical course and a single-stage robotic sigmoid-colon-conduit diversion leveraging a pre-existing loop colostomy to avoid a new bowel anastomosis. Technique illustration, no comparator.",
    "findings": "The report demonstrates feasibility of a minimally-invasive sigmoid-colon-conduit urinary diversion that avoids bowel anastomosis in a hostile, irradiated pelvis, proposing reduced morbidity for frail/previously-irradiated patients.",
    "rob": "n=1; feasibility/illustrative only, with publication bias toward successful novel reconstructions. No outcome rate or comparison.",
    "strengths": "A clever reconstructive solution to a genuinely hard problem, demonstrating minimally-invasive feasibility where morbidity is otherwise high.",
    "applicability": "Conceptually relevant to complex CBG/MIGS and gyn-onc reconstruction in the irradiated/hostile pelvis &mdash; the ureteric/bladder-reconstruction skill set CBG/MIGS surgeons share with urology in deep endometriosis and oncologic cases.",
    "kb": "Sits in the complex pelvic-reconstruction literature; reinforces that minimally-invasive diversion avoiding bowel anastomosis is feasible in selected hostile pelvises.",
    "equity": "Robotic reconstructive expertise for these rare, complex cases is concentrated in tertiary centers, limiting access for affected patients.",
    "monday": "Watch / counsel &mdash; complex-CBG/MIGS adjacent. Not an everyday technique, but a useful conceptual tool for the irradiated/hostile pelvis: minimally-invasive urinary diversion avoiding a bowel anastomosis. Relevant to the ureteric/bladder-reconstruction skills CBG/MIGS surgeons draw on in deep endometriosis and oncologic work; refer or collaborate with reconstructive urology for these cases.",
    "prompts": "<ol><li>When does avoiding a bowel anastomosis justify a more complex diversion in an irradiated pelvis?</li><li>How do you build the ureteric/bladder-reconstruction collaboration (urology) your complex deep-endometriosis cases need?</li><li>What makes a frail, irradiated patient a candidate for a minimally-invasive versus open reconstruction?</li></ol>",
},

# APR vs LAR morbidity/mortality in rectal cancer — retrospective, n=226
"42112223": {
    "bottom": "Single-center retrospective cohort (226 rectal-cancer patients) comparing abdominoperineal resection (APR) with low anterior resection (LAR), focused on postoperative sepsis/septic complications. APR trended toward higher septic complications (wide, non-significant CIs). For CBG/MIGS, the relevance is technique-transfer: deep-infiltrating-endometriosis bowel work spans the same low-rectal resection spectrum, and the resection-level morbidity gradient informs how aggressively to take the bowel.",
    "question": "<strong>The clinical problem.</strong> The choice and level of rectal resection (APR for very low tumors vs sphincter-preserving LAR) carries different septic-complication and morbidity profiles, which matter wherever low-rectal surgery is performed &mdash; including bowel-endometriosis resection. <strong>The question.</strong> What are the risk factors for, and the comparative rates of, postoperative septic complications after APR versus LAR for rectal cancer?",
    "pico": {
        "P": "226 rectal-cancer patients undergoing surgery (2018&ndash;2023).",
        "I": "Abdominoperineal resection (tumors &lt; 5 cm from anal verge).",
        "C": "Low anterior resection.",
        "O": "Early/late/overall septic complications (fistula, abscess); morbidity/mortality.",
        "D": "Retrospective cohort.",
        "S": "226.",
    },
    "methods": "Single-center retrospective cohort comparing APR and LAR with analysis of septic-complication risk factors (age, comorbidity, approach, tumor location). Observational, with confounding by tumor level (APR reserved for lowest tumors).",
    "findings": "APR was associated with higher odds of early (OR 1.84), late (OR 2.75), and overall septic complications, but the confidence intervals were wide and crossed 1 (not statistically significant), reflecting limited power; the resection-level morbidity gradient is directional.",
    "rob": "Moderate-to-high. Retrospective, single-center, underpowered (non-significant wide CIs), and inherently confounded because APR is selected for the lowest, most adverse tumors. Directional rather than definitive.",
    "strengths": "Addresses a clinically-relevant morbidity gradient by resection level with explicit septic-complication endpoints.",
    "applicability": "For colorectal surgery directly; for CBG/MIGS, relevant as technique-transfer &mdash; informs how the resection level in low-rectal/bowel-endometriosis surgery relates to septic morbidity and informs how aggressively to resect.",
    "kb": "Consistent with the colorectal literature that lower, more radical rectal resections carry higher septic morbidity; the CBG/MIGS relevance is the shared low-pelvic bowel-surgery terrain in deep endometriosis.",
    "equity": "Single-center; access to sphincter-preserving (LAR) versus APR and to specialized colorectal collaboration affects outcomes and quality of life.",
    "monday": "Inform &mdash; complex-CBG/MIGS adjacent. Not gynecologic per se, but the resection-level morbidity gradient is directly relevant when planning bowel resection for deep infiltrating endometriosis (shaving vs discoid vs segmental/low-anterior resection): lower, more radical resections carry more septic morbidity. Reinforces multidisciplinary planning with colorectal surgery.",
    "prompts": "<ol><li>How does the resection-level morbidity gradient inform your shaving-vs-discoid-vs-segmental decision in bowel endometriosis?</li><li>When do you involve colorectal surgery, and how early?</li><li>How do you weigh radicality against septic-complication and quality-of-life risk in low-rectal endometriosis?</li></ol>",
},

# ============================ MENOPAUSAL HORMONE THERAPY ============================

# 13 plant-adaptogen skin serum, open-label, peri/post-menopause
"42117281": {
    "bottom": "16-week open-label, uncontrolled multicenter study of a 13-plant-adaptogen cosmetic serum (MYS-REV) for skin quality (lines, elastosis, crepey skin) in women &ge;46 with hormonal-decline skin changes. As an open-label trial with no control and investigator-assessed appearance endpoints, it is marketing-adjacent cosmetic evidence &mdash; not menopause therapeutics and not something to recommend on this basis.",
    "question": "<strong>The clinical problem.</strong> Estrogen decline degrades skin quality (thinning, wrinkles, elastosis), and women seek topical solutions; whether a specific botanical serum helps is the commercial question here. <strong>The question.</strong> Does twice-daily application of a 13-plant-adaptogen serum visibly improve skin quality in peri/postmenopausal women?",
    "pico": {
        "P": "Women &ge;46 (Fitzpatrick I&ndash;VI) with fine-to-moderate lines, elastosis, crepey skin.",
        "I": "Twice-daily plant-adaptogen serum (MYS-REV) for 16 weeks.",
        "C": "None (open-label, uncontrolled).",
        "O": "Investigator-assessed lines/wrinkles, elastosis, texture; hydration/TEWL.",
        "D": "Open-label multicenter study.",
        "S": "Not specified in abstract.",
    },
    "methods": "16-week open-label, uncontrolled multicenter evaluation with investigator-assessed appearance scales plus instrumental hydration/transepidermal-water-loss measures. No comparator or blinding.",
    "findings": "Investigators reported improvements in lines/wrinkles, elastosis, crepey skin, dullness, texture, and objective hydration measures over 16 weeks.",
    "rob": "High. Open-label, uncontrolled, investigator-assessed subjective endpoints, and a commercial product &mdash; classic cosmetic-marketing study limitations. No causal claim is supportable.",
    "strengths": "Includes some objective instrumental measures (hydration, TEWL) alongside subjective scores; multicenter.",
    "applicability": "Minimal clinical relevance; it is cosmetic, not menopause therapeutics, and the design cannot support efficacy claims.",
    "kb": "Sits in the cosmeceutical literature rather than menopause-medicine evidence; an example of the marketing-adjacent material that the digest&apos;s &apos;hormone&apos; keyword can pull in.",
    "equity": "Cosmetic-product cost and access are not a clinical-equity priority; the framing risks medicalizing normal skin aging.",
    "monday": "Hold. An uncontrolled cosmetic-serum study &mdash; nothing to recommend for menopause care. If a patient asks, be honest that open-label appearance data can&apos;t establish efficacy. Not a clinical priority.",
    "prompts": "<ol><li>How do you respond when patients ask about cosmeceuticals marketed for &apos;menopausal skin&apos;?</li><li>What would a credible trial of a topical for menopausal skin require?</li><li>Where is the line between menopause medicine and cosmetic marketing in this literature?</li></ol>",
},

# Polyphenol-rich foods nutrigenomics, postmenopausal women
"42116480": {
    "bottom": "Small nutrigenomic study measuring gene-expression changes after 2 months of daily polyphenol-rich foods (dark chocolate, green tea, mixed-fruit juice) in postmenopausal women. It reports multigenomic modulation of cardiometabolic-linked genes &mdash; a mechanistic/exploratory signal that diet affects gene expression, not evidence that it changes cardiometabolic outcomes.",
    "question": "<strong>The clinical problem.</strong> Estrogen loss raises postmenopausal cardiometabolic risk, and dietary polyphenols are hypothesized to mitigate it, but the simultaneous effect of multiple polyphenol classes on gene expression is under-studied. <strong>The question.</strong> Does chronic consumption of polyphenol-rich foods alter expression of cardiometabolic-health genes in postmenopausal women?",
    "pico": {
        "P": "Postmenopausal women (small sample).",
        "I": "2 months of daily polyphenol-rich foods (dark chocolate, green tea, mixed-fruit juice).",
        "C": "Pre- vs post-intervention (within-subject).",
        "O": "Global/differential gene expression (nutrigenomic profiling).",
        "D": "Pre&ndash;post interventional pilot.",
        "S": "Small (not enumerated in abstract).",
    },
    "methods": "Within-subject pre/post nutrigenomic profiling of blood gene expression after 2 months of polyphenol-rich food intake, with bioinformatic differential-expression analysis. Small, uncontrolled, intermediate (transcriptomic) endpoints.",
    "findings": "Daily polyphenol-rich food consumption produced multigenomic modification of genes linked to cardiometabolic health, indicating a measurable nutrigenomic effect.",
    "rob": "High for clinical inference. Small, uncontrolled, within-subject design with transcriptomic surrogates rather than cardiometabolic outcomes; no isolation of which foods/polyphenols drive effects.",
    "strengths": "Tests a realistic combined-polyphenol dietary pattern and uses objective gene-expression readouts.",
    "applicability": "Supports general healthy-diet counseling at most; it cannot justify specific polyphenol prescriptions for cardiometabolic protection.",
    "kb": "Adds mechanistic nutrigenomic data to the diet&ndash;cardiometabolic-health literature in menopause; outcome evidence remains the gap.",
    "equity": "Polyphenol-rich foods are broadly accessible dietary advice, though cost and availability still vary.",
    "monday": "Counsel / inform. Consistent with general advice that a polyphenol-rich (fruit, tea, etc.) diet is reasonable for postmenopausal cardiometabolic health &mdash; but this is gene-expression data, not outcomes. No specific prescription. Reinforces healthy-diet counseling.",
    "prompts": "<ol><li>Do nutrigenomic changes meaningfully predict cardiometabolic outcomes, or just mechanism?</li><li>How do you give dietary advice in menopause without over-promising specific foods?</li><li>What outcome trial would test polyphenols for postmenopausal cardiovascular risk?</li></ol>",
},

# Menopausal symptom severity & QoL — systematic review
"42113329": {
    "bottom": "Systematic review synthesizing the relationship between menopausal-symptom severity and quality of life across the transition, motivated by inconsistent prior findings. It consolidates the expected association &mdash; more severe symptoms, worse QoL &mdash; while acknowledging heterogeneity. A reference-level synthesis supporting symptom-directed management to protect quality of life.",
    "question": "<strong>The clinical problem.</strong> Menopausal symptoms affect quality of life, but the literature is inconsistent about how symptom severity relates to QoL across the transition, hampering counseling and prioritization. <strong>The question.</strong> What is the relationship between menopausal-symptom severity and quality of life during the menopausal transition?",
    "pico": {
        "P": "Women in the menopausal transition (across included studies).",
        "I": "Not applicable &mdash; evidence synthesis.",
        "C": "Not applicable.",
        "O": "Association between symptom severity and quality of life.",
        "D": "Systematic review.",
        "S": "Multiple studies (multi-database search).",
    },
    "methods": "Systematic multi-database search (Web of Science, Scopus, PubMed, Magiran, Google Scholar) synthesizing studies on symptom severity and QoL. Heterogeneity across instruments and populations is the main analytic challenge.",
    "findings": "The review supports an inverse association &mdash; greater menopausal-symptom severity corresponds to poorer quality of life &mdash; while noting inconsistencies driven by differing measures and populations.",
    "rob": "Moderate at the synthesis level: dependent on included-study quality and heterogeneity; the association is intuitive and consistent but measurement-variable.",
    "strengths": "Comprehensive multi-database (including non-English Persian-database) search and a clarifying synthesis of a clinically-relevant but muddled literature.",
    "applicability": "Supports prioritizing symptom control to protect quality of life across the menopausal transition; broadly applicable to menopause care.",
    "kb": "A consolidating systematic review within the menopause symptom&ndash;QoL literature.",
    "equity": "Inclusion of a Persian-language database broadens representation beyond English-only syntheses, a modest equity strength.",
    "monday": "Counsel / reinforce. Confirms that symptom severity tracks with worse quality of life across menopause &mdash; supporting proactive, symptom-directed management (including MHT where appropriate). A reference-level reinforcement, not a new intervention.",
    "prompts": "<ol><li>How systematically do you measure menopausal-symptom severity and its QoL impact?</li><li>Which symptoms most degrade QoL and should be prioritized in treatment?</li><li>How does heterogeneity in symptom/QoL instruments complicate comparing studies?</li></ol>",
},

# Lichen sclerosus pre/post-menopausal presentation differences, n=287
"42110676": {
    "bottom": "Retrospective analytical study (287 women with vulvar lichen sclerosus, Brazil) comparing pre- and postmenopausal presentation. Most cases (87%) occurred after age 50, strongly associated with menopause, with vulvar atrophy and anatomical deformity prominent and hypertension/diabetes common comorbidities. Useful clinical data reinforcing vigilance for vulvar lichen sclerosus in postmenopausal women &mdash; an under-diagnosed, malignancy-risk condition.",
    "question": "<strong>The clinical problem.</strong> Vulvar lichen sclerosus is under-recognized, carries vulvar-cancer risk, and may present differently before and after menopause &mdash; differences that, if characterized, could sharpen diagnosis and management. <strong>The question.</strong> How does vulvar lichen sclerosus differ in clinical presentation between pre- and postmenopausal women?",
    "pico": {
        "P": "287 women with vulvar lichen sclerosus (2009&ndash;2023, single Brazilian center).",
        "I": "Not applicable &mdash; comparison by menopausal status.",
        "C": "Premenopausal vs postmenopausal presentation.",
        "O": "Clinical/epidemiologic/therapeutic features (atrophy, deformity, comorbidity).",
        "D": "Retrospective analytical study.",
        "S": "287.",
    },
    "methods": "Single-center retrospective comparison of clinical, epidemiologic, and therapeutic features of vulvar lichen sclerosus by menopausal status over 14 years. Retrospective and single-center.",
    "findings": "87% of cases occurred in women over 50, strongly associated with menopause; vulvar atrophy and anatomical deformity were prominent, with hypertension and type 2 diabetes the most frequent comorbidities.",
    "rob": "Moderate. Retrospective, single-center, referral-based (a cancer hospital, possibly skewing severity); descriptive comparison without adjustment.",
    "strengths": "Substantial sample for a relatively uncommon condition, long study period, and a clinically-useful menopause-stratified description.",
    "applicability": "Relevant to gynecologic practice: reinforces recognizing and treating vulvar lichen sclerosus in postmenopausal women, where atrophy can mask or mimic it, and where malignancy surveillance matters.",
    "kb": "Adds menopause-stratified clinical data to the vulvar-lichen-sclerosus literature, consistent with its postmenopausal predominance.",
    "equity": "Single referral-center (cancer hospital) data may over-represent severe/advanced disease; access to dermatologic/vulvar specialty care affects diagnosis timing.",
    "monday": "Counsel / inform &mdash; gynecology-relevant. Reinforces examining the vulva and keeping lichen sclerosus on the differential in postmenopausal women with atrophy, itching, or deformity &mdash; it&apos;s under-diagnosed and carries vulvar-cancer risk. Treat with potent topical steroids and maintain surveillance. A clinical reinforcement.",
    "prompts": "<ol><li>How routinely do you examine the vulva and consider lichen sclerosus in postmenopausal patients?</li><li>How do you distinguish lichen sclerosus from simple atrophy?</li><li>What is your surveillance approach given the vulvar-malignancy risk?</li></ol>",
},

# Gut microbiota in perimenopausal atherosclerosis (estrogen-gut-vascular axis) — review
"42109721": {
    "bottom": "Mechanistic review proposing an &apos;estrogen-gut-vascular axis&apos; to explain rising perimenopausal atherosclerosis risk: declining estrogen impairs the intestinal barrier and shifts microbial metabolites (less short-chain fatty acids, more pro-inflammatory metabolites), accelerating atherogenesis. A hypothesis-organizing review pointing toward microbiome-targeted prevention &mdash; mechanistic, not clinical evidence.",
    "question": "<strong>The clinical problem.</strong> Cardiovascular risk rises sharply in perimenopause, and the &apos;estrogen cardioprotection&apos; hypothesis doesn&apos;t fully fit the mixed HRT cardiovascular data, implying unexplained intermediary mechanisms. <strong>The question.</strong> Does the gut microbiota mediate the estrogen&ndash;cardiovascular relationship (an &apos;estrogen-gut-vascular axis&apos;) in perimenopausal atherosclerosis?",
    "pico": {
        "P": "Perimenopausal women (mechanistic evidence base).",
        "I": "Conceptual &mdash; microbiome/metabolite-targeted prevention.",
        "C": "Not applicable.",
        "O": "Mechanistic model of estrogen&ndash;gut&ndash;vascular interactions; prevention targets.",
        "D": "Narrative mechanistic review.",
        "S": "Literature synthesis.",
    },
    "methods": "Narrative review integrating evidence on estrogen, intestinal-barrier function, microbial metabolites, and atherogenesis into a unifying axis model. Non-systematic; mechanistic synthesis.",
    "findings": "It proposes that declining estrogen causes intestinal-barrier dysfunction and adverse microbial-metabolite shifts (reduced SCFAs, increased pro-inflammatory metabolites) that accelerate atherosclerosis, suggesting microbiome-targeted personalized prevention.",
    "rob": "Narrative mechanistic review: no systematic search or outcome data; the axis is plausible but the leap to clinical microbiome-targeted prevention is unproven.",
    "strengths": "Offers a coherent mechanistic framework that could reconcile the &apos;estrogen paradox&apos; and generate testable prevention hypotheses.",
    "applicability": "No direct clinical action; relevant as a research framework, not a basis for microbiome interventions.",
    "kb": "Contributes to the estrogen&ndash;microbiome&ndash;cardiovascular literature, an active mechanistic frontier.",
    "equity": "No population dimension; cautionary note that &apos;microbiome-targeted&apos; products could become an evidence-light commercial market for menopausal women.",
    "monday": "Hold / counsel. A mechanistic review &mdash; nothing to prescribe. The actionable message is unchanged: address cardiovascular risk factors in perimenopause through proven means; microbiome interventions are not evidence-based yet.",
    "prompts": "<ol><li>Does the estrogen-gut-vascular model change anything in current perimenopausal CV-risk management? (No &mdash; but why is it appealing?)</li><li>What study would test whether microbiome modulation reduces CV risk in menopause?</li><li>How do you counter premature marketing of microbiome products to menopausal women?</li></ol>",
},

# Isolated episodic vestibular syndrome & menopause/migraine, n=93
"42108535": {
    "bottom": "Cross-sectional neurotology study (93 midlife women, 40&ndash;65) characterizing isolated episodic vestibular syndrome and its relationship to migraine and the menopause transition, using the Dizziness Handicap Inventory, Menopause Rating Scale, and MIDAS. Primarily a neurotology paper, but its menopause relevance is real: it links climacteric symptom burden with vestibular/migraine symptoms, reminding us that midlife dizziness intersects with the menopause transition.",
    "question": "<strong>The clinical problem.</strong> Midlife women commonly report episodic dizziness, which overlaps with migraine and the menopause transition, but the clinical profile and these associations are poorly characterized. <strong>The question.</strong> What are the clinical features of isolated episodic vestibular syndrome in midlife women, and how do they relate to migraine and climacteric symptoms?",
    "pico": {
        "P": "93 women aged 40&ndash;65 with recurrent spontaneous vestibular symptoms, no hearing loss.",
        "I": "Not applicable &mdash; observational characterization.",
        "C": "Not applicable.",
        "O": "Dizziness Handicap Inventory, Menopause Rating Scale, MIDAS; symptom associations.",
        "D": "Cross-sectional (tertiary neurotology clinic).",
        "S": "93.",
    },
    "methods": "Cross-sectional study using structured interview and validated dizziness, menopause, and migraine-disability scales, examining associations among them in a tertiary neurotology population. Referral-based, cross-sectional.",
    "findings": "Most patients had at least weekly brief episodes; the study describes associations between dizziness handicap, climacteric (Menopause Rating Scale) symptoms, and migraine disability, situating episodic vestibular syndrome within the migraine&ndash;menopause overlap.",
    "rob": "Moderate. Cross-sectional, tertiary-referral sample (selection toward more severe/complex dizziness), and association-only; menopause is one of several correlates rather than a tested cause.",
    "strengths": "Validated instruments across three domains and a clinically-useful framing of an under-recognized midlife symptom cluster.",
    "applicability": "Mainly neurotology, but a useful reminder for menopause clinicians that midlife dizziness intersects with migraine and the menopause transition &mdash; consider the overlap when counseling.",
    "kb": "Adds to the vestibular-migraine/menopause-overlap literature; tangential to core menopause therapeutics.",
    "equity": "Tertiary-clinic sample limits generalizability; access to neurotology evaluation for midlife dizziness is uneven.",
    "monday": "Counsel / inform. A reminder that midlife dizziness overlaps with migraine and the menopause transition &mdash; consider this intersection when a perimenopausal patient reports episodic vertigo, and co-manage with neurotology. Tangential to MHT decisions; not practice-changing.",
    "prompts": "<ol><li>How do you approach episodic dizziness in a perimenopausal patient with migraine history?</li><li>Does the menopause&ndash;migraine&ndash;vestibular overlap change your counseling or referral threshold?</li><li>How much can a cross-sectional referral sample tell us about causation here?</li></ol>",
},

# Mental symptoms & estrogen fluctuations postmenopause — review
"42100911": {
    "bottom": "Review summarizing the link between estrogen fluctuations and menopausal psychiatric symptoms (depression rates 2&ndash;3&times; higher than premenopause), the mechanisms (neurotransmitter, HPA-axis, neuroinflammatory, epigenetic), and MHT&apos;s therapeutic role within a personalized, evidence-based approach. A useful mechanistic-and-clinical synthesis reinforcing that mood symptoms are core to menopause care.",
    "question": "<strong>The clinical problem.</strong> Depression and anxiety rise markedly during the menopause transition, driven by estrogen fluctuation, yet the mechanisms and the appropriate role of MHT for mood symptoms need clear synthesis. <strong>The question.</strong> How do estrogen fluctuations drive menopausal psychiatric symptoms, and what is MHT&apos;s therapeutic role?",
    "pico": {
        "P": "Peri/postmenopausal women with psychiatric symptoms (evidence synthesis).",
        "I": "Not applicable &mdash; review; discusses MHT.",
        "C": "Not applicable.",
        "O": "Mechanisms of estrogen&ndash;mood links; therapeutic potential of MHT.",
        "D": "Narrative/systematic review.",
        "S": "Literature synthesis.",
    },
    "methods": "Review synthesizing epidemiologic and mechanistic evidence on estrogen and menopausal mood symptoms and evaluating MHT&apos;s role. Synthesis-level, dependent on included evidence.",
    "findings": "It documents 2&ndash;3&times; higher depression rates in menopause from rapid estrogen change, mechanisms spanning neurotransmitter regulation, HPA-axis sensitivity, neuroinflammation, and epigenetics, and supports MHT as a treatment requiring personalized, evidence-based use.",
    "rob": "Review-level: conclusions reflect synthesized evidence quality; the MHT-for-mood claim should be applied within current guideline nuance (timing, symptom type, individual risk).",
    "strengths": "Integrates mechanism with therapeutics and stresses personalization, reinforcing mood as central to menopause assessment.",
    "applicability": "Supports routine assessment of mood in menopausal patients and considering MHT for vasomotor-associated mood symptoms within guideline-based, individualized care.",
    "kb": "Consolidates the estrogen&ndash;mood and MHT-for-mood literature; consistent with guideline emphasis on individualized MHT.",
    "equity": "Access to mental-health care and MHT varies; under-treatment of menopausal mood symptoms is a recognized care gap.",
    "monday": "Counsel / reinforce. Reinforces screening for depression/anxiety in menopausal patients and considering MHT for mood symptoms (especially with vasomotor symptoms) within individualized, guideline-based care. A clinically-aligned reinforcement.",
    "prompts": "<ol><li>How routinely do you screen for mood symptoms in your menopausal patients?</li><li>When do you consider MHT versus psychiatric therapy (or both) for menopausal mood symptoms?</li><li>How do you personalize MHT decisions given timing and individual risk?</li></ol>",
},

# Prior depression/anxiety & autism on menopause symptoms, n=80
"42098595": {
    "bottom": "Longitudinal sub-study (52 autistic, 28 non-autistic people assigned female at birth) examining whether pre-existing depression/anxiety symptoms predict worse menopause symptoms, with attention to autistic people, for whom menopause may be especially challenging. Small but valuable for an under-served group: it supports that pre-existing mental-health symptoms shape the menopause experience and that autistic patients may need tailored support.",
    "question": "<strong>The clinical problem.</strong> Menopause may be particularly difficult for autistic people, and pre-existing mental-health symptoms may worsen the experience, yet research on these intersections is sparse. <strong>The question.</strong> Do pre-existing depression and anxiety symptoms affect menopause-symptom severity for autistic and non-autistic people?",
    "pico": {
        "P": "52 autistic + 28 non-autistic people assigned female at birth (AgeWellAutism study).",
        "I": "Not applicable &mdash; baseline depression/anxiety as predictor.",
        "C": "Autistic vs non-autistic; by baseline mental-health symptoms.",
        "O": "Menopause symptoms (Greene Climacteric Scale) at follow-up.",
        "D": "Longitudinal observational (STROBE).",
        "S": "80.",
    },
    "methods": "Longitudinal AgeWellAutism cohort with baseline self-reported depression/anxiety and follow-up Greene Climacteric Scale menopause symptoms, comparing autistic and non-autistic participants. Small sample, self-report.",
    "findings": "The study examines whether pre-existing depression/anxiety predicts worse menopause symptoms in autistic and non-autistic people, supporting that prior mental-health symptoms shape the menopause experience &mdash; with autistic people a group needing tailored attention.",
    "rob": "Moderate-to-high. Small sample (especially the non-autistic comparison, n=28), self-report measures, and limited power for subgroup effects; valuable as early evidence in a neglected area.",
    "strengths": "Longitudinal design and a focus on an under-researched, potentially vulnerable population (autistic people in menopause).",
    "applicability": "Supports individualized, neurodiversity-aware menopause care and attention to mental-health history when anticipating symptom burden.",
    "kb": "An early contribution to the small literature on menopause in autistic people and the role of pre-existing mental health.",
    "equity": "Directly equity-advancing &mdash; it centers an under-served, often-overlooked group (autistic people) in menopause research.",
    "monday": "Counsel / inform. A reminder to take mental-health history into account and to provide neurodiversity-aware, individualized menopause support &mdash; autistic patients may find menopause especially challenging. Small study, so a sensitivity prompt rather than a protocol change.",
    "prompts": "<ol><li>How do you adapt menopause counseling and support for autistic patients?</li><li>How does pre-existing depression/anxiety change your anticipatory guidance?</li><li>What would adequately-powered research in this area need to look like?</li></ol>",
},

# Vitamin D & BMI/obesity postmenopausal, NHANES, n=3386, AIP mediator
"42091424": {
    "bottom": "Cross-sectional NHANES analysis (3,386 postmenopausal women) finding an inverse association between serum 25-OH vitamin D and BMI/obesity, with the atherogenic index of plasma as a partial mediator. Reinforces the well-known inverse vitamin-D&ndash;adiposity relationship (direction of causality unresolved by cross-sectional data) and adds a lipid-mediation nuance &mdash; not a basis for vitamin D as a weight intervention.",
    "question": "<strong>The clinical problem.</strong> Low vitamin D and obesity co-occur in postmenopausal women, but the relationship&apos;s direction and mediators are unclear, and patients often ask whether vitamin D helps weight or metabolic health. <strong>The question.</strong> Is serum 25-OH vitamin D associated with BMI/obesity in postmenopausal women, and does the atherogenic index of plasma mediate it?",
    "pico": {
        "P": "3,386 postmenopausal women (NHANES 2011&ndash;2018).",
        "I": "Not applicable &mdash; vitamin D status (deficient/insufficient/sufficient).",
        "C": "Across vitamin D strata.",
        "O": "BMI and obesity; mediation by atherogenic index of plasma (AIP).",
        "D": "Cross-sectional.",
        "S": "3,386.",
    },
    "methods": "Cross-sectional weighted regression of NHANES data across vitamin D strata with adjustment and formal mediation analysis quantifying the atherogenic index of plasma&apos;s role. Cross-sectional design precludes causal/directional inference.",
    "findings": "A significant inverse association between 25-OH vitamin D and BMI (&beta; &minus;2.36, 95% CI &minus;3.16 to &minus;1.55) was observed, with the atherogenic index of plasma partially mediating the vitamin D&ndash;adiposity relationship.",
    "rob": "Moderate. Large and nationally representative but cross-sectional (reverse causation likely &mdash; adiposity sequesters vitamin D), with a mediation model that cannot establish direction.",
    "strengths": "Large representative sample, formal mediation analysis, and a clinically-relevant lipid-mediation nuance.",
    "applicability": "Supports treating vitamin D deficiency on its own merits, not as a weight/metabolic intervention; useful for countering supplement over-claims.",
    "kb": "Consistent with the established inverse vitamin-D&ndash;adiposity association (likely bidirectional/reverse-causal), adding a lipid-mediation observation.",
    "equity": "NHANES representativeness is a strength; vitamin-D and metabolic-health disparities track with broader social determinants.",
    "monday": "Counsel / inform. Reinforces that low vitamin D and obesity co-occur, likely because adiposity lowers vitamin D &mdash; treat deficiency for bone health, not as a weight or metabolic fix. Cross-sectional, so no causal claim. Useful for honest supplement counseling.",
    "prompts": "<ol><li>How do you counsel patients who expect vitamin D to aid weight or metabolic health?</li><li>Given likely reverse causation, how do you interpret the inverse association?</li><li>Does the lipid-mediation finding change anything clinically? (Probably not &mdash; why?)</li></ol>",
},

# Affective temperament & menopausal symptom severity, n=105
"42091421": {
    "bottom": "Cross-sectional study (105 women, STRAW+10 late-transition/early-postmenopause) showing affective temperament traits &mdash; especially anxious temperament &mdash; predict menopausal symptom severity (Menopause Rating Scale), with 59% reporting severe symptoms. It frames stable psychological vulnerability as a contributor to symptom burden, supporting a biopsychosocial approach to menopause care.",
    "question": "<strong>The clinical problem.</strong> Menopausal symptom severity varies widely between women, and stable psychological traits (affective temperament) may be an under-recognized vulnerability factor that could identify those at higher risk. <strong>The question.</strong> Do affective temperament traits predict menopausal symptom severity in the late transition and early postmenopause?",
    "pico": {
        "P": "105 women aged 40&ndash;55 (STRAW+10 stages &minus;1, +1a, +1b).",
        "I": "Not applicable &mdash; affective temperament (TEMPS-A) as predictor.",
        "C": "Across temperament profiles.",
        "O": "Menopausal symptom severity (Menopause Rating Scale).",
        "D": "Cross-sectional.",
        "S": "105.",
    },
    "methods": "Cross-sectional assessment using the Menopause Rating Scale and TEMPS-A temperament questionnaire, with correlation and multivariable linear regression to identify independent temperament predictors of symptom severity. Cross-sectional, self-report.",
    "findings": "Mean MRS total was 18.37 (59% reporting severe symptoms); anxious temperament showed the strongest correlations with somatic symptom burden and independently predicted greater menopausal symptom severity.",
    "rob": "Moderate. Cross-sectional (no temporality), modest single-sample size, and self-report instruments; temperament and symptom reporting may share method/affective bias.",
    "strengths": "Uses validated staging (STRAW+10) and temperament instruments, and identifies a potentially screenable vulnerability factor.",
    "applicability": "Supports a biopsychosocial menopause assessment &mdash; recognizing that anxious-temperament patients may experience or report more severe symptoms and may benefit from added psychological support.",
    "kb": "Adds to the literature linking psychological traits to menopausal symptom experience, reinforcing biopsychosocial models.",
    "equity": "Access to psychological support for higher-vulnerability patients is uneven; recognizing temperament could help target limited resources.",
    "monday": "Counsel / inform. Reinforces a biopsychosocial approach: anxious-temperament patients may experience more severe menopausal symptoms and benefit from added psychological support alongside symptom-directed therapy. A sensitivity/assessment prompt, not a procedure change.",
    "prompts": "<ol><li>Could brief psychological-vulnerability awareness help you anticipate symptom burden?</li><li>How do you integrate psychological support with MHT/symptom management?</li><li>How much does shared affective-reporting bias inflate the temperament&ndash;symptom link?</li></ol>",
},

# ==================== C-SECTION SCAR (PREGNANCY & PATHOLOGY) ====================

# US-guided regional anesthesia for post-caesarean analgesia — narrative review
"42101317": {
    "bottom": "Narrative review of ultrasound-guided regional (abdominal-wall block) techniques for post-caesarean analgesia, positioned for when intrathecal morphine &mdash; the gold standard &mdash; is omitted or undesirable. It supports abdominal-wall blocks as effective, opioid-sparing somatic analgesia within multimodal ERAS pathways. Practical obstetric-anesthesia guidance, not new trial data.",
    "question": "<strong>The clinical problem.</strong> Intrathecal morphine is the gold standard for post-caesarean analgesia but isn&apos;t always feasible or desirable (side effects, contraindications), leaving a need for effective opioid-sparing alternatives. <strong>The question.</strong> What is the role and efficacy of ultrasound-guided regional anaesthesia (abdominal-wall blocks) for post-caesarean analgesia, especially when neuraxial opioids are omitted?",
    "pico": {
        "P": "Women undergoing caesarean delivery (post-operative analgesia).",
        "I": "Ultrasound-guided regional anaesthesia (abdominal-wall blocks).",
        "C": "Intrathecal morphine / within multimodal pathways.",
        "O": "Analgesic efficacy; opioid-sparing.",
        "D": "Narrative review.",
        "S": "Literature synthesis.",
    },
    "methods": "Narrative synthesis of evidence on ultrasound-guided abdominal-wall block techniques for post-caesarean analgesia, emphasizing anatomical rationale, efficacy, and their role without neuraxial opioids. Non-systematic.",
    "findings": "Abdominal-wall blocks provide effective somatic analgesia and meaningful opioid-sparing, particularly when intrathecal morphine is not used; technique selection and integration into multimodal pathways are key.",
    "rob": "Narrative review without systematic grading; conclusions reflect synthesized expert evidence rather than pooled trial estimates.",
    "strengths": "Practical, anatomy-grounded guidance aligned with obstetric ERAS and opioid-sparing priorities.",
    "applicability": "Relevant to obstetric-anaesthesia and caesarean ERAS practice; informs your anaesthesia colleagues more than surgical technique.",
    "kb": "Consolidates the regional-analgesia-for-caesarean literature within multimodal/ERAS frameworks.",
    "equity": "Regional-block expertise and ultrasound availability vary; where intrathecal morphine is unavailable, abdominal-wall blocks may widen access to good analgesia.",
    "monday": "Inform (obstetric-anaesthesia-facing). Supports ultrasound-guided abdominal-wall blocks as effective opioid-sparing analgesia after caesarean, especially when intrathecal morphine isn&apos;t used. Useful for caesarean ERAS protocols with your anaesthesia team. Not a surgical-technique change.",
    "prompts": "<ol><li>When intrathecal morphine is omitted, which abdominal-wall block fits your caesarean pathway?</li><li>How do regional blocks integrate with the rest of your multimodal analgesia?</li><li>Where block expertise is limited, how do you ensure adequate post-caesarean analgesia?</li></ol>",
},

# Prior gestational diabetes & adverse pregnancy outcomes, PSM, n=1326
"42100195": {
    "bottom": "Retrospective propensity-matched study (332 prior-GDM vs 994 controls) confirming that a history of gestational diabetes raises risks in subsequent pregnancies &mdash; notably GDM recurrence (50.0% vs 11.8%), cesarean delivery (32.8% vs 26.9%), and gestational hypertension. Solid confirmatory data supporting early screening and closer surveillance in women with prior GDM.",
    "question": "<strong>The clinical problem.</strong> Gestational diabetes tends to recur and may flag broader pregnancy risk, but quantifying the independent association with adverse outcomes in subsequent pregnancies sharpens management of this high-risk group. <strong>The question.</strong> Is a history of GDM independently associated with adverse maternal-fetal outcomes in subsequent pregnancies?",
    "pico": {
        "P": "1,326 women delivering at a Shenzhen hospital (332 prior GDM, 994 controls).",
        "I": "Not applicable &mdash; prior-GDM history as exposure.",
        "C": "Propensity-matched women without prior GDM.",
        "O": "GDM recurrence, cesarean delivery, gestational hypertension, other adverse outcomes.",
        "D": "Retrospective cohort with propensity matching.",
        "S": "1,326.",
    },
    "methods": "Single-center retrospective cohort (2015&ndash;2025) with propensity-score matching and logistic regression for the independent association between prior GDM and adverse pregnancy outcomes. Observational, single-center.",
    "findings": "Prior GDM was associated with markedly higher GDM recurrence (50.0% vs 11.8%), more cesarean delivery (32.8% vs 26.9%), and higher gestational hypertension, confirming elevated risk in subsequent pregnancies.",
    "rob": "Moderate. Retrospective and single-center; propensity matching addresses measured confounders but residual confounding (shared metabolic risk) persists. The recurrence association is large and robust.",
    "strengths": "Reasonable sample, propensity matching, and clinically-clear, actionable risk estimates for a common condition.",
    "applicability": "Directly supports early GDM screening and closer surveillance in women with prior GDM &mdash; standard obstetric risk management.",
    "kb": "Consistent with the established literature on GDM recurrence and subsequent-pregnancy risk.",
    "equity": "Single-center Chinese data; access to early screening and metabolic optimization between pregnancies varies and shapes recurrence risk.",
    "monday": "Counsel / reinforce. Confirms prior GDM strongly predicts recurrence and other adverse outcomes &mdash; reinforces early screening, preconception/interpregnancy metabolic optimization, and closer surveillance. Standard obstetric practice, reinforced.",
    "prompts": "<ol><li>How early do you screen for GDM in a woman with a prior affected pregnancy?</li><li>What interpregnancy interventions could reduce recurrence risk?</li><li>How do you counsel about the 50% recurrence figure without causing fatalism?</li></ol>",
},

# Companions & providers in pregnancy/childbirth, Burkina Faso — qualitative, n=24
"42097646": {
    "bottom": "Qualitative interview study (24 postpartum women, urban Burkina Faso) exploring how companions and providers help women navigate the vulnerability of pregnancy and childbirth, set in hospitals using a shared-decision-making caesarean intervention. It centers respectful, supported care and shared decision-making around caesarean &mdash; a health-systems/experience contribution rather than clinical evidence.",
    "question": "<strong>The clinical problem.</strong> Appropriate caesarean use and respectful maternity care depend on how women experience support and decision-making, which is under-studied in low-resource settings. <strong>The question.</strong> How do women in urban Burkina Faso experience care and support from companions and providers across pregnancy and childbirth, particularly around caesarean decisions?",
    "pico": {
        "P": "24 postpartum women in two urban Burkina Faso public hospitals.",
        "I": "Not applicable &mdash; qualitative exploration (within a shared-decision caesarean intervention).",
        "C": "Not applicable.",
        "O": "Themes on support, vulnerability, and decision-making.",
        "D": "Qualitative (reflexive thematic analysis).",
        "S": "24.",
    },
    "methods": "Exploratory qualitative study with in-depth interviews of purposively-sampled postpartum women and reflexive thematic analysis, in hospitals running a quality-decision-making caesarean intervention. Small purposive sample; transferable, not generalizable.",
    "findings": "Two themes describe how women rely on providers and companions to navigate uncertainty and vulnerability, underscoring the value of companionship and supported, shared decision-making around caesarean.",
    "rob": "Appropriate qualitative methodology; the limitation is transferability (single setting, n=24) rather than bias in the quantitative sense.",
    "strengths": "Centers patient experience and respectful-care/shared-decision themes in an under-represented low-resource setting.",
    "applicability": "Supports companionship in labour and shared decision-making for caesarean; experiential rather than clinical-outcome evidence.",
    "kb": "Contributes to the respectful-maternity-care and appropriate-caesarean-use literature, especially in low-resource contexts.",
    "equity": "Directly equity-relevant &mdash; it amplifies the experiences of women in a low-resource setting and supports interventions (companionship, shared decision-making) that improve care quality and dignity.",
    "monday": "Counsel / reflect. Reinforces labour companionship and genuine shared decision-making around caesarean &mdash; care-quality and dignity practices worth examining in your own setting. Experiential evidence, not a clinical protocol change.",
    "prompts": "<ol><li>How well does your service support labour companionship and shared caesarean decisions?</li><li>What would respectful, supported caesarean decision-making look like in your setting?</li><li>How do you weigh transferable qualitative insight against generalizable quantitative data?</li></ol>",
},

# Type A aortic dissection in pregnancy — case report
"42096376": {
    "bottom": "Case report of a 37-year-old pregnant woman with acute Type A aortic dissection managed by combined emergent cesarean section and aortic repair. A rare, life-threatening obstetric emergency where survival of mother and fetus depends on rapid multidisciplinary surgery. Illustrative of high-acuity obstetric crisis management, not generalizable evidence.",
    "question": "<strong>The clinical problem.</strong> Acute Type A aortic dissection in pregnancy is rare and frequently fatal, and simultaneous management of the obstetric and cardiovascular emergencies is exceptionally challenging, demanding coordinated multidisciplinary surgery. <strong>The question.</strong> How can a pregnant patient with acute Type A aortic dissection be managed to optimize maternal and fetal survival?",
    "pico": {
        "P": "37-year-old pregnant woman (G3P1) with acute Type A aortic dissection.",
        "I": "Combined emergent cesarean section and aortic-dissection repair.",
        "C": "None (case report).",
        "O": "Maternal and fetal survival; surgical management lessons.",
        "D": "Single case report.",
        "S": "n = 1.",
    },
    "methods": "Descriptive single case report of combined cesarean and aortic repair with shared clinical experience and insights. No comparator or generalizable rate.",
    "findings": "The report details simultaneous cesarean delivery and Type A aortic-dissection repair, emphasizing rapid diagnosis, comprehensive preoperative assessment, and coordinated multidisciplinary surgery to address both mother and fetus.",
    "rob": "n=1; illustrative only, with publication bias toward instructive/successful crisis cases.",
    "strengths": "A vivid, well-coordinated account of an extreme obstetric-cardiovascular emergency, useful for crisis preparedness.",
    "applicability": "Rare scenario; the transferable lesson is the value of rapid multidisciplinary mobilization for catastrophic obstetric emergencies.",
    "kb": "Adds to the small case literature on aortic dissection in pregnancy and combined obstetric-cardiac surgery.",
    "equity": "Such combined emergency capability exists only at well-resourced centers, a stark access disparity for catastrophic obstetric emergencies.",
    "monday": "Counsel / awareness. A rare but lethal emergency &mdash; keep aortic dissection on the differential for severe chest/back pain in pregnancy and know your institution&apos;s rapid multidisciplinary (obstetric + cardiac surgery) pathway. A preparedness reminder, not a routine practice change.",
    "prompts": "<ol><li>Would aortic dissection enter your differential for a pregnant patient with sudden severe chest/back pain?</li><li>Does your institution have a pathway for combined obstetric-cardiac surgical emergencies?</li><li>What preparedness steps make catastrophic obstetric emergencies survivable?</li></ol>",
},

# Knee-to-chest flexion maneuver acceptability (neonatal RDS post-CS) — qualitative, n=15
"42091518": {
    "bottom": "Qualitative study (15 obstetricians/residents, Tanzania) on the acceptability of a novel low-resource knee-to-chest flexion maneuver intended to reduce neonatal respiratory distress after elective cesarean by aiding lung-fluid expulsion. It assesses provider perceptions of a feasible, safe technique &mdash; an early implementation/acceptability study, not efficacy evidence.",
    "question": "<strong>The clinical problem.</strong> Planned cesarean (without labour) raises neonatal respiratory distress from retained lung fluid; a low-resource maneuver mimicking uterine contraction could help, but its uptake depends on provider acceptability. <strong>The question.</strong> How do healthcare providers perceive and accept the knee-to-chest flexion maneuver for preventing neonatal respiratory distress after planned cesarean?",
    "pico": {
        "P": "15 obstetricians and resident doctors (tertiary hospital, Moshi, Tanzania).",
        "I": "Not applicable &mdash; qualitative acceptability assessment of the knee-to-chest flexion maneuver.",
        "C": "Not applicable.",
        "O": "Provider perceptions and acceptability.",
        "D": "Exploratory qualitative (semi-structured interviews).",
        "S": "15.",
    },
    "methods": "Exploratory qualitative study with semi-structured interviews of providers who had observed/performed the maneuver, analyzed thematically. Single-center, small purposive sample; acceptability not efficacy.",
    "findings": "The study characterizes provider perceptions and acceptability of the knee-to-chest flexion maneuver, complementing prior feasibility/safety data and informing whether the technique could be adopted.",
    "rob": "Appropriate qualitative design; limitation is transferability (n=15, single center) and that acceptability says nothing about clinical efficacy.",
    "strengths": "Addresses the implementation/acceptability step needed before adopting a low-cost technique, in a relevant low-resource setting.",
    "applicability": "Relevant to low-resource obstetric/neonatal care if efficacy is confirmed; provider acceptability is one prerequisite for adoption.",
    "kb": "Adds an implementation-science data point to the nascent literature on the knee-to-chest maneuver for post-cesarean neonatal respiratory distress.",
    "equity": "A low-resource, equipment-free technique with clear appeal for settings lacking neonatal respiratory support &mdash; an equity-oriented innovation if proven effective.",
    "monday": "Hold / watch. An acceptability study of a novel low-resource neonatal maneuver &mdash; promising for under-resourced settings, but efficacy isn&apos;t established here. Nothing to adopt yet; worth watching for outcome trials. Not a gynecologic-surgical issue.",
    "prompts": "<ol><li>What efficacy evidence would you need before adopting the knee-to-chest maneuver?</li><li>How does provider acceptability shape whether a feasible technique is actually used?</li><li>Where do low-resource innovations fit alongside established neonatal-RDS prevention?</li></ol>",
},

# Intention-for-cesarean scale — Turkish validation, n=300
"42090689": {
    "bottom": "Methodological validation of a Turkish-language Theory-Based Intention for Cesarean Section scale (300 pregnant women). It provides a validated tool to measure birth-mode intention &mdash; useful for research and interventions aimed at reducing non-indicated cesareans &mdash; but it is an instrument-development study, not clinical evidence.",
    "question": "<strong>The clinical problem.</strong> Cesarean rates are rising globally, and understanding and shifting birth-mode intention during pregnancy is key to reducing non-indicated cesareans &mdash; which requires validated measurement tools across languages. <strong>The question.</strong> Is the Turkish adaptation of the Theory-Based Intention for Cesarean Section scale valid and reliable?",
    "pico": {
        "P": "300 pregnant women (Turkey).",
        "I": "Not applicable &mdash; psychometric validation of the intention-for-cesarean scale.",
        "C": "Not applicable.",
        "O": "Validity (content, construct) and reliability of the Turkish scale.",
        "D": "Methodological validation study.",
        "S": "300.",
    },
    "methods": "Translation/back-translation, content validity (9 experts, Davis technique), pilot testing (n=30), and construct-validity/reliability analysis (SPSS, AMOS) in 300 pregnant women. Standard psychometric methodology.",
    "findings": "The study reports the Turkish scale&apos;s validity and reliability for measuring theory-based intention for cesarean section, yielding a usable instrument.",
    "rob": "Appropriate for a validation study; limitations are single-language-population scope and that a scale measures intention, not behaviour or outcomes.",
    "strengths": "Rigorous psychometric process (expert content validity, pilot, construct validity) producing a research-ready tool.",
    "applicability": "Useful for research and intention-modifying interventions to reduce non-indicated cesareans in Turkish-speaking populations; no direct individual-patient action.",
    "kb": "Adds a validated measurement instrument to the cesarean-reduction/birth-preference literature.",
    "equity": "Language-specific validation improves research inclusion for Turkish-speaking women; reducing non-indicated cesareans has population health-equity value.",
    "monday": "Hold / inform. An instrument-validation study &mdash; nothing to apply at the bedside. Relevant to researchers and programs working to understand and reduce non-indicated cesareans. Not a clinical practice change.",
    "prompts": "<ol><li>Could measuring birth-mode intention help target counseling to reduce non-indicated cesareans?</li><li>How does intention relate to actual birth-mode behaviour and outcomes?</li><li>What drives rising cesarean rates in your own setting?</li></ol>",
},

# Vaginal trial outcomes & emergency CS in hypertensive disorders of pregnancy, n=894
"42086488": {
    "bottom": "Single-center retrospective cohort (894 women with hypertensive disorders of pregnancy undergoing a vaginal trial: 584 gestational hypertension, 216 pre-eclampsia, 94 chronic hypertension) examining vaginal-trial outcomes and emergency-cesarean risk factors across HDP classifications. It begins to fill a real gap &mdash; there is no standardized framework for vaginal delivery across HDP subtypes &mdash; supporting individualized intrapartum planning.",
    "question": "<strong>The clinical problem.</strong> Most women with hypertensive disorders of pregnancy can attempt vaginal delivery, but outcomes and emergency-cesarean risk likely differ across HDP subtypes, and no standardized framework guides this. <strong>The question.</strong> How do vaginal-trial outcomes and emergency-cesarean risk factors differ across HDP classifications?",
    "pico": {
        "P": "894 women with HDP undergoing a vaginal trial (584 gestational HTN, 216 pre-eclampsia, 94 chronic HTN).",
        "I": "Not applicable &mdash; vaginal trial of labour.",
        "C": "Across HDP classifications.",
        "O": "Vaginal-trial success; emergency-cesarean risk factors; maternal/perinatal outcomes.",
        "D": "Retrospective cohort.",
        "S": "894.",
    },
    "methods": "Single-center retrospective cohort comparing maternal and perinatal outcomes and emergency-cesarean risk factors across three HDP classifications among women attempting vaginal delivery. Observational, single-center.",
    "findings": "The study compares vaginal-trial outcomes and identifies emergency-cesarean risk factors across HDP subtypes (specific success rates and predictors in the full results), supporting subtype-aware intrapartum planning.",
    "rob": "Moderate. Retrospective and single-center, with unequal subgroup sizes (chronic HTN n=94) limiting power; useful descriptive risk-stratification.",
    "strengths": "Reasonable sample, clinically-relevant HDP-subtype stratification, and a focus on the under-framed question of vaginal delivery across HDP types.",
    "applicability": "Relevant to intrapartum counseling and planning for women with HDP attempting vaginal delivery; supports individualized, subtype-aware management.",
    "kb": "Adds subtype-stratified intrapartum data to the HDP-delivery literature, where standardized frameworks are lacking.",
    "equity": "Single-center; access to close intrapartum monitoring (which enables safe vaginal trials in HDP) varies between settings.",
    "monday": "Counsel / inform. Supports offering and planning vaginal delivery in HDP with subtype-aware attention to emergency-cesarean risk factors &mdash; useful for intrapartum counseling. Observational, so it refines rather than dictates management. Obstetric, not CBG/MIGS-surgical.",
    "prompts": "<ol><li>How does HDP subtype shape your intrapartum plan and emergency-cesarean preparedness?</li><li>Which risk factors most predict needing emergency cesarean in HDP?</li><li>What monitoring makes a vaginal trial safe across HDP classifications?</li></ol>",
},

}
