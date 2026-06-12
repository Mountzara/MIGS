# -*- coding: utf-8 -*-
"""tb_testosterone.py — deep-dives for the trend brief
"Testosterone therapy for perimenopause symptoms beyond libido".
Verdict: Partially supported · narrow (HSDD only) per NAMS 2022 · broader indications RCT-insufficient.
Patient+provider voice per §3.9."""

AUTHORED = {

# 31498871 — Global Consensus Position Statement on testosterone therapy for women
"31498871": {
    "bottom": "This is the <strong>international consensus statement</strong> — the agreed expert position from multiple menopause and endocrine societies — on testosterone therapy for women. Its bottom line is precise: testosterone has good evidence for <strong>one</strong> indication, low sexual desire that causes distress (hypoactive sexual desire disorder, HSDD), in postmenopausal women, and the evidence does <em>not</em> support it for energy, mood, cognition, bone, or general well-being. <strong>For patients:</strong> if you've heard testosterone fixes fatigue/brain fog/mood, the official evidence doesn't back that — only libido. <strong>For clinicians:</strong> the guardrail document for appropriate, evidence-based prescribing and dosing (female physiologic levels, not male doses).",
    "question": "<strong>The problem.</strong> Testosterone is widely promoted to women for a long list of perimenopausal symptoms, often at non-physiologic doses, ahead of the evidence. <strong>The question this consensus answers:</strong> for which indications is testosterone therapy in women actually supported, and how should it be used safely?",
    "pico": {"P": "Women (chiefly postmenopausal) considering testosterone therapy.",
             "I": "Testosterone therapy at female-physiologic doses.",
             "C": "Placebo / no testosterone (drawing on the trial evidence base).",
             "O": "Evidence-supported indications, efficacy, safety, and dosing guidance.",
             "D": "Multi-society consensus position statement.",
             "S": "Synthesizes the available RCT evidence."},
    "methods": "An international panel reviewed the trial evidence and reached consensus recommendations on indications, dosing, monitoring, and safety. <strong>Keep in mind:</strong> consensus statements distill evidence into practice guidance; their strength tracks the underlying trials, which are robust for HSDD and thin for everything else.",
    "findings": "The consensus supports testosterone <strong>only</strong> for HSDD in postmenopausal women, using doses that restore female-physiologic (not male) levels, with monitoring to avoid excess. It explicitly states evidence is insufficient for other indications (mood, cognition, energy, bone, cardiovascular) and cautions against non-physiologic dosing and unregulated products.",
    "strengths": "It draws a clear, authoritative line between what's proven (HSDD) and what's marketed (everything else), and gives concrete safety/dosing guidance — exactly what patients and prescribers need amid heavy promotion.",
    "rob": "As consensus guidance it inherits the gaps in the evidence base (few long-term and few broader-indication trials), and panel composition/industry context always warrant awareness — but its restraint (limiting claims) argues against overreach.",
    "applicability": "<strong>For patients:</strong> reasonable to discuss testosterone if low desire is distressing and other causes are addressed; be skeptical of clinics selling it for fatigue/mood/anti-aging. <strong>For clinicians:</strong> prescribe for HSDD at physiologic doses with monitoring; don't extend to unproven indications; avoid compounded/non-physiologic regimens.",
    "kb": "The governing reference for the brief and the basis for 'narrow (HSDD only)'. The systematic reviews (31353194, 27916205) supply its evidence; the UK cohort (39283522) is exactly the kind of broader-indication, lower-tier data the consensus says is insufficient.",
    "equity": "Women's sexual health and midlife symptoms are under-researched and easily commercialized; a clear evidence line protects patients from costly, unproven, sometimes harmful (virilizing) over-treatment while preserving access for the proven indication.",
    "monday": "<strong>Counsel; prescribe narrowly.</strong> Offer testosterone for postmenopausal HSDD after addressing other contributors, at female-physiologic doses with monitoring. For energy/mood/cognition requests, explain the evidence doesn't support it and pursue evidence-based alternatives.",
    "prompts": "<ol><li>How do you counsel a patient requesting testosterone for fatigue or brain fog?</li><li>What monitoring prevents supraphysiologic dosing and virilization?</li><li>Where does perimenopausal (vs postmenopausal) use sit, given the evidence is postmenopausal-HSDD-based?</li></ol>",
},

# 31353194 — SR/MA: safety and efficacy of testosterone for women (Lancet)
"31353194": {
    "bottom": "A <strong>systematic review and meta-analysis</strong> (pooling the randomized trials) of testosterone's safety and efficacy in women — the evidence backbone under the consensus statement. It confirms a real benefit for sexual function and flags the safety signals (e.g., acne, hair effects, lipid changes with oral forms). <strong>For patients:</strong> the libido benefit is real and measurable; broader benefits aren't established. <strong>For clinicians:</strong> the pooled trial evidence justifying HSDD use and transdermal (not oral) delivery.",
    "question": "<strong>The problem.</strong> Individual testosterone trials in women are modest in size; clinicians needed the pooled picture of what it helps and what it risks. <strong>The question:</strong> across randomized trials, is testosterone therapy effective and safe for women, and for which outcomes?",
    "pico": {"P": "Women in randomized trials of testosterone therapy.",
             "I": "Testosterone therapy (various routes/doses).",
             "C": "Placebo or comparator.",
             "O": "Sexual function and other outcomes; adverse effects.",
             "D": "Systematic review and meta-analysis of RCTs.",
             "S": "Pooled across multiple RCTs."},
    "methods": "Randomized trials of testosterone in women were systematically identified and pooled for efficacy (notably sexual function) and safety outcomes. <strong>Keep in mind:</strong> meta-analysis strengthens precision but inherits the trials' limits — mostly short-term, mostly sexual-function endpoints, mostly postmenopausal.",
    "findings": "Testosterone improved sexual function outcomes versus placebo. Safety: generally acceptable with transdermal delivery at physiologic doses; oral testosterone showed unfavorable lipid effects, and androgenic effects (acne, hair) can occur. Evidence for non-sexual outcomes was limited or absent.",
    "rob": "Pooled trials are mostly short-term with heterogeneous formulations and a narrow outcome focus (sexual function); long-term safety (breast, cardiovascular) remains under-characterized. The efficacy signal for HSDD is robust; broader conclusions aren't supported.",
    "strengths": "Provides the quantitative, randomized-evidence foundation distinguishing proven (sexual function) from unproven uses and route-specific safety (favor transdermal over oral).",
    "applicability": "<strong>For patients:</strong> supports a genuine, evidence-based option for distressing low desire, via skin (not oral) testosterone, with realistic expectations. <strong>For clinicians:</strong> use transdermal physiologic dosing for HSDD; counsel on androgenic effects; don't infer mood/energy benefit.",
    "kb": "The meta-analytic evidence behind the consensus statement; together they define the proven-indication boundary the brief describes.",
    "equity": "Most data are in postmenopausal women; perimenopausal and diverse populations are under-represented, limiting generalization — a gap worth naming to patients.",
    "monday": "<strong>Prescribe for HSDD; transdermal; counsel on limits.</strong> Use the pooled evidence to support physiologic transdermal testosterone for distressing low desire, avoid oral forms, and set expectations that non-sexual benefits aren't established.",
    "prompts": "<ol><li>Why prefer transdermal over oral testosterone on this evidence?</li><li>What long-term safety data would you want before broader/longer use?</li><li>How do you set realistic expectations beyond libido?</li></ol>",
},

# 27916205 — SR/MA: transdermal testosterone for postmenopausal HSDD
"27916205": {
    "bottom": "A <strong>systematic review and meta-analysis of 7 randomized trials (≈3,035 women)</strong> focused specifically on transdermal (skin) testosterone for postmenopausal hypoactive sexual desire disorder. It's the most targeted evidence for the one proven indication, showing improved sexual desire and satisfying sexual events. <strong>For patients:</strong> for distressing low desire after menopause, skin testosterone has solid trial support. <strong>For clinicians:</strong> the focused RCT evidence base for the HSDD indication and route.",
    "question": "<strong>The problem.</strong> Among testosterone formulations, transdermal delivery is preferred on safety grounds, and HSDD is the indication with the most data — clinicians needed the pooled efficacy/safety specifically for that combination. <strong>The question:</strong> is transdermal testosterone effective and safe for postmenopausal HSDD?",
    "pico": {"P": "Postmenopausal women with hypoactive sexual desire disorder.",
             "I": "Transdermal testosterone.",
             "C": "Placebo.",
             "O": "Sexual desire, satisfying sexual events, distress; adverse effects.",
             "D": "Systematic review and meta-analysis of 7 RCTs.",
             "S": "n ≈ 3,035 (1,350 randomized to treatment)."},
    "methods": "Seven RCTs of transdermal testosterone for postmenopausal HSDD were pooled for sexual-function efficacy and safety. <strong>Keep in mind:</strong> well-defined population and route, but follow-up is relatively short and breast/cardiovascular long-term safety isn't resolved.",
    "findings": "Transdermal testosterone significantly improved sexual desire and the frequency of satisfying sexual events and reduced associated distress versus placebo, with androgenic side effects (e.g., acne, hair) more common but generally mild. This is the concrete efficacy behind the HSDD recommendation.",
    "rob": "Short-to-moderate follow-up, sexual-function-focused outcomes, and unresolved long-term safety (breast/CV) are the main limits. Within that scope, the HSDD efficacy finding is consistent and reasonably robust.",
    "strengths": "Tightly focused on the proven indication and preferred route with a sizable pooled sample — directly actionable and appropriately bounded.",
    "applicability": "<strong>For patients:</strong> strong support for trying transdermal testosterone if low desire is distressing and other causes are addressed; expect a libido benefit, watch for skin/hair effects. <strong>For clinicians:</strong> the evidence to offer it confidently for postmenopausal HSDD, with monitoring.",
    "kb": "The most indication-specific evidence in the brief; together with the broader meta-analysis and consensus, it cements the 'HSDD-only' proven boundary.",
    "equity": "Postmenopausal-focused; perimenopausal and non-trial populations are less represented. Access and cost (often not covered, sometimes compounded) are real equity issues for an evidence-based therapy.",
    "monday": "<strong>Offer for postmenopausal HSDD.</strong> Transdermal testosterone at physiologic doses is a supported option for distressing low desire after addressing other contributors; counsel on the libido-specific benefit and androgenic effects; monitor levels.",
    "prompts": "<ol><li>How do you select and counsel HSDD candidates and exclude other causes of low desire?</li><li>What's your monitoring schedule for androgenic effects and levels?</li><li>How do you handle off-label perimenopausal requests given postmenopausal evidence?</li></ol>",
},

# 39283522 — retrospective cohort: testosterone for mood/cognition (UK clinic)
"39283522": {
    "bottom": "A <strong>retrospective cohort from a UK menopause clinic</strong> (510 women on HRT with persistent low libido, mood, and cognitive symptoms) reporting outcomes after adding testosterone cream. It's exactly the kind of study fueling the 'testosterone for mood and brain fog' trend — and exactly the kind the consensus calls <em>insufficient</em>, because it's observational, uncontrolled, and prone to expectation effects. <strong>For patients:</strong> real-world clinics report mood/cognitive improvement, but without a placebo comparison this can't separate the drug from expectation and natural variation. <strong>For clinicians:</strong> hypothesis-generating, not practice-changing for non-sexual indications.",
    "question": "<strong>The problem.</strong> Many women on HRT still have low mood, libido, and cognitive symptoms, and clinics increasingly add testosterone hoping to help all three — but rigorous evidence beyond libido is lacking. <strong>The question:</strong> in real-world practice, what happens to mood and cognitive symptoms when testosterone is added for women with persistent symptoms on HRT?",
    "pico": {"P": "510 women on HRT with persistent low libido, mood, and cognitive symptoms (UK menopause clinic).",
             "I": "Addition of transdermal testosterone cream.",
             "C": "None — single-arm, before/after (no placebo or control group).",
             "O": "Self-reported mood and cognitive symptoms (and libido).",
             "D": "Retrospective cohort (uncontrolled).",
             "S": "n = 510."},
    "methods": "Records of women given testosterone for persistent symptoms on HRT were reviewed for changes in mood and cognitive symptoms. <strong>Keep in mind:</strong> no control group means improvement could reflect placebo response, regression to the mean, concurrent HRT optimization, or reporting bias — not necessarily testosterone.",
    "findings": "The clinic reported improvements in mood and cognitive symptoms (and libido) after adding testosterone. Because the design is uncontrolled, these results suggest a hypothesis worth testing in RCTs rather than demonstrating a real, drug-specific effect on mood/cognition.",
    "rob": "<strong>High risk of bias:</strong> no control/placebo, self-reported subjective outcomes, selection and expectation effects, and confounding from concurrent HRT changes. It cannot establish that testosterone improves mood or cognition.",
    "strengths": "Reflects real-world practice and patient-reported experience at scale, and transparently targets the unmet symptom cluster — valuable for framing what an RCT should test.",
    "applicability": "<strong>For patients:</strong> be cautious — apparent mood/cognitive benefits from uncontrolled clinic data aren't proof; the proven benefit remains libido. <strong>For clinicians:</strong> don't use this to justify testosterone for mood/cognition; it underscores the need for placebo-controlled trials.",
    "kb": "Illustrates the broader-indication, lower-tier evidence the brief and consensus deem insufficient — the contrast that produces the 'narrow (HSDD only)' verdict.",
    "equity": "Single specialist UK clinic; generalizability is limited, and enthusiastic-clinic populations may differ from typical patients.",
    "monday": "<strong>Hold for mood/cognition.</strong> Treat as hypothesis-generating. Continue to limit testosterone to HSDD; for mood/cognitive symptoms, optimize HRT and use evidence-based approaches, and frame testosterone-for-mood as unproven pending RCTs.",
    "prompts": "<ol><li>How do you respond to a patient citing clinic testimonials of mood/cognitive benefit?</li><li>What would a credible placebo-controlled trial for these endpoints require?</li><li>How much of the reported benefit is plausibly placebo/HRT optimization?</li></ol>",
},

}
