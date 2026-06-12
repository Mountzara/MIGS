# -*- coding: utf-8 -*-
"""tb_pelvic_congestion.py — deep-dives for the trend brief
"Pelvic congestion syndrome and ovarian-vein embolization for chronic pelvic pain".
Verdict: Partially supported · IR-driven case-series; no RCTs; payer-rejected as unproven.
Patient+provider voice per §3.9."""

AUTHORED = {

# 27397619 — systematic review of embolization/sclerotherapy for CPP
"27397619": {
    "bottom": "A <strong>systematic review</strong> — a structured summary of the existing studies — of using embolization (blocking off) or sclerotherapy (sealing) of pelvic veins to treat chronic pelvic pain attributed to 'pelvic congestion'. Its honest headline is that the procedures are reported to relieve pain in many case series, but those studies are low-quality, and the basic assumption — that dilated, 'leaky' (refluxing) pelvic veins actually cause the pain — has never been proven. So the treatment may help some people, but the evidence is far weaker than for most accepted procedures, which is the main reason insurers often decline to cover it: high reported success, low evidence quality, and no proof of cause.",
    "question": "<strong>The problem.</strong> Some people with chronic pelvic pain have dilated, 'leaky' (refluxing) pelvic veins on imaging, labeled pelvic congestion syndrome, and interventional radiologists can block those veins. But it's unclear whether the veins cause the pain or are just an incidental finding. <strong>The question:</strong> across the published studies, how effective is embolization/sclerotherapy of pelvic veins at reducing chronic pelvic pain — and how trustworthy is that evidence?",
    "pico": {"P": "People (mostly women) with chronic pelvic pain and dilated/refluxing pelvic veins.",
             "I": "Percutaneous embolization or sclerotherapy of incompetent pelvic veins.",
             "C": "Largely uncontrolled (most included studies lack a comparison group).",
             "O": "Reduction in chronic pelvic pain; success rates; quality of the evidence.",
             "D": "Systematic review of mostly observational studies.",
             "S": "Pooled across the included case series/cohorts."},
    "methods": "The authors systematically searched for and critically appraised studies of pelvic-vein embolization/sclerotherapy for CPP. <strong>Key point:</strong> a systematic review can only be as strong as the studies it finds — and here those were mostly uncontrolled case series, which can overstate benefit because there's no comparison group and pelvic pain often improves on its own or with attention/placebo effects.",
    "findings": "High pain-relief 'success rates' are commonly cited, but the review concludes the evidence is <strong>low quality</strong>: studies are mostly uncontrolled, outcome measures vary, and — crucially — the causal link between refluxing pelvic veins and the pain was not established. So the apparent effectiveness can't be separated from natural improvement, placebo response, and selection of patients likely to do well.",
    "rob": "<strong>High risk of bias.</strong> Uncontrolled designs, heterogeneous and often subjective pain outcomes, and publication bias (positive series more likely published) all inflate apparent benefit. Without randomized comparison, benefit attributable to the procedure itself can't be isolated.",
    "strengths": "It applies systematic, critical appraisal to a field built largely on uncontrolled case series, and resists overstating the result — a useful corrective for both patients and referring clinicians.",
    "applicability": "If you've been offered ovarian-vein embolization, this is the honest evidence picture: it may help, but it isn't proven, and that uncertainty is real rather than just bureaucratic. The reasonable approach is to reserve it for carefully selected people after other causes of pain have been addressed, with candid discussion of the evidence limits — and to expect insurer scrutiny.",
    "kb": "This is the evidence anchor of the brief and the reason for the 'no RCTs; payer-rejected' verdict. It contrasts with the two companion review articles, which describe the condition and procedure but don't supply higher-quality effectiveness data.",
    "equity": "Chronic pelvic pain in women is historically under-investigated and under-funded, which partly explains why a plausible treatment still lacks RCTs decades on. The flip side: weak evidence shouldn't be a reason to dismiss women's pain — it's a reason to demand better trials.",
    "monday": "<strong>Counsel honestly; case-by-case referral.</strong> Don't present embolization as established therapy. For selected patients with classic imaging and refractory pain after other causes are addressed, referral to interventional radiology is reasonable <em>with</em> explicit consent that benefit is unproven and coverage may be denied. Advocate for the RCTs this field still lacks.",
    "prompts": "<ol><li>How do you distinguish pelvic veins that <em>cause</em> pain from incidental venous dilatation?</li><li>What would an adequately powered sham-controlled trial of ovarian-vein embolization need to look like?</li><li>How do you consent a patient for an 'unproven but plausibly helpful' procedure without over- or under-selling it?</li></ol>",
},

# 33541587 — review: Pelvic Congestion Syndrome (diagnosis/imaging)
"33541587": {
    "bottom": "A <strong>review article</strong> describing pelvic congestion syndrome as an under-diagnosed cause of chronic pelvic pain, defined by dilated ovarian (gonadal) veins and varicose veins around the uterus on imaging, sometimes alongside vulvar or leg varicose veins. It's useful background on what the diagnosis means and how it's found, but it's a descriptive and diagnostic overview — it doesn't provide evidence on how well treatment works.",
    "question": "<strong>The problem.</strong> Chronic pelvic pain has many causes and pelvic congestion is easy to miss; clinicians need a clear picture of when to suspect it and how to confirm it. <strong>The question this review addresses:</strong> what is pelvic congestion syndrome, how does it present, and how is it diagnosed?",
    "pico": {"P": "Women with chronic pelvic pain and suspected pelvic venous congestion.",
             "I": "Diagnostic evaluation (Doppler ultrasound, CT/MR, and catheter venography as the reference standard).",
             "C": "Other causes of chronic pelvic pain (differential).",
             "O": "Diagnostic criteria and imaging features.",
             "D": "Narrative review.",
             "S": "Not applicable."},
    "methods": "A narrative synthesis of the clinical features and imaging of pelvic congestion, positioning transcatheter venography as the gold standard used after inconclusive non-invasive imaging (ultrasound, CT, MRI). <strong>Keep in mind:</strong> it summarizes expert understanding rather than testing diagnostic accuracy or treatment.",
    "findings": "It characterizes the syndrome — gonadal-vein dilatation and parauterine varices, often with vulvar/lower-limb venous insufficiency — and the imaging pathway to diagnosis. It reinforces that imaging <em>findings</em> are common; the harder question (does a given finding explain a given patient's pain) remains unsettled.",
    "rob": "As a narrative review there's no systematic appraisal; descriptions of diagnostic certainty may be more confident than the underlying data support, given the unresolved finding-versus-cause problem.",
    "strengths": "A clear, practical orientation to a commonly missed entity and its imaging — helpful for recognizing candidates who merit further evaluation.",
    "applicability": "It explains why imaging is ordered and what the findings mean — and what they don't mean, since a positive scan isn't the same as a proven cause of pain. It's most useful for recognizing who merits further evaluation, read alongside the systematic review for the honest picture of how well treatment works.",
    "kb": "Provides the diagnostic scaffolding for the brief; complements the effectiveness systematic review (27397619) and the endovascular-options review (37076700).",
    "equity": "Under-diagnosis is the through-line — a condition predominantly affecting (often multiparous) women that's frequently overlooked across the many specialties these patients pass through.",
    "monday": "<strong>Counsel / recognize.</strong> Use to identify candidates and explain imaging findings, while being clear that a positive scan is not the same as a proven cause of pain. No treatment recommendation flows from this review alone.",
    "prompts": "<ol><li>When does a refluxing gonadal vein on imaging warrant venography versus watchful management?</li><li>How often are these venous findings incidental in asymptomatic people?</li><li>How do you integrate this with a multifactorial chronic-pelvic-pain workup?</li></ol>",
},

# 37076700 — review: endovascular treatment options for pelvic venous congestion
"37076700": {
    "bottom": "A <strong>review</strong> of female pelvic venous congestion and the catheter-based (endovascular) options to treat it, emphasizing that it's a common but under-diagnosed cause of chronic pelvic pain that patients often carry across many specialties before it's recognized. It lays out the menu of minimally invasive treatments, but as a descriptive overview rather than head-to-head evidence on which option works best.",
    "question": "<strong>The problem.</strong> Once pelvic venous congestion is suspected, clinicians and patients need to understand the endovascular treatment options and where they fit. <strong>The question:</strong> what are the female venous congestive syndromes and the endovascular treatment options for them?",
    "pico": {"P": "Women with chronic pelvic pain from pelvic venous congestion (often multiparous).",
             "I": "Endovascular treatments (embolization, sclerotherapy, stenting where relevant).",
             "C": "Conservative/other management (described, not formally compared).",
             "O": "Overview of treatment options and rationale.",
             "D": "Narrative review.",
             "S": "Not applicable."},
    "methods": "A descriptive synthesis of the venous syndromes (including overlaps like May-Thurner/nutcracker physiology) and the catheter-based treatments available. <strong>Keep in mind:</strong> it catalogs options rather than ranking them by proven effectiveness.",
    "findings": "It maps the spectrum of pelvic venous congestive syndromes and the endovascular toolkit, reinforcing the long diagnostic odyssey patients face (presenting to GPs, gynecologists, vascular, pain, GI, and psychiatry). It does not supply controlled outcome data.",
    "rob": "Narrative review limitations apply; as with the field generally, the treatment discussion rests on low-quality, uncontrolled evidence.",
    "strengths": "Captures the multidisciplinary, often-missed nature of the problem and gives a useful overview of the endovascular options for clinicians coordinating these patients.",
    "applicability": "It's a helpful guide to what minimally invasive treatments exist and why getting referred can be complicated, and an orientation to the multidisciplinary pathway. It isn't evidence to favor one procedure over another, or over conservative management.",
    "kb": "Rounds out the brief's procedural picture alongside the diagnostic review and the effectiveness systematic review. Together they justify 'partially supported' — real condition, plausible treatments, but RCT-level proof absent.",
    "equity": "Reinforces the access/recognition gap: a long, multi-specialty path to diagnosis is itself an equity problem for women with chronic pelvic pain.",
    "monday": "<strong>Counsel / coordinate.</strong> Useful for explaining options and organizing multidisciplinary referral; not a basis for recommending embolization as proven. Keep consent honest about the evidence gap.",
    "prompts": "<ol><li>How do you decide which endovascular option (if any) fits a given venous anatomy?</li><li>What role should conservative management play before intervention?</li><li>How do you shorten the diagnostic odyssey these patients describe?</li></ol>",
},

}
