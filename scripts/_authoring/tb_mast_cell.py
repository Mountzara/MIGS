# -*- coding: utf-8 -*-
"""
tb_mast_cell.py — authored deep-dive content for the trend brief
"Mast cell activation as a driver of endometriosis pelvic pain"
(evidence-2026-05-19-mast-cell-activation-drives-endometriosis-pelvic-pain).

Per CLAUDE.md §3.9: authored by reading each paper's verbatim abstract.
VOICE: these trend briefs are read by BOTH patients and clinicians, so each
section is written in plain language a patient can follow while preserving the
evidence rigor a provider needs. Framed against the brief's claim + verdict
("Partially supported · mechanism dense; clinical translation pending").
"""

AUTHORED = {

# ── 40948761 — review: neuroinflammation, JAK-STAT, mast cells in endo pain ──
"40948761": {
    "bottom": "This is a <strong>review article</strong> — it gathers and interprets existing laboratory and animal evidence rather than testing a treatment in patients. Its case: endometriosis pain isn't just from the lesions themselves but from <em>neuroinflammation</em> — irritated nerves and immune cells (including mast cells) talking to each other in and around the lesions, and changes that reach all the way to the spinal cord and brain. It highlights two potential drug targets, the JAK-STAT inflammatory pathway and mast-cell activation. <strong>For patients:</strong> it helps explain why pain can persist even after lesions are removed, and why pain can be out of proportion to what's seen at surgery. <strong>For clinicians:</strong> it's a mechanistic synthesis, not trial evidence — promising targets, no proven therapy yet.",
    "question": "<strong>The problem.</strong> Pain is the most life-limiting part of endometriosis, yet surgery and hormones often don't fully control it, and pain can continue after lesions are treated. That points to pain being driven partly by the nervous and immune systems, not the lesions alone. <strong>The question this review asks:</strong> what is the neuro-immune biology of endometriosis pain — from the lesion's own nerve supply up to the spinal cord and brain — and which parts of it might be drug targets?",
    "pico": {"P": "People with endometriosis-associated pain (the biology, synthesized across human and animal studies).",
             "I": "Conceptual review of neuroinflammatory mechanisms; candidate targets (JAK-STAT signaling, mast-cell activation).",
             "C": "Not a comparative study — no control group (it is a narrative review).",
             "O": "A mechanistic framework for endometriosis pain and nominated therapeutic targets.",
             "D": "Narrative/mechanistic review.",
             "S": "Not applicable (synthesizes prior studies)."},
    "methods": "The authors reviewed published laboratory and animal work on how endometriosis generates pain, organizing it by anatomical level — the lesion and its nerve supply, the dorsal root ganglia (relay stations where sensory nerves enter the spinal cord), and the brain. <strong>What to keep in mind:</strong> a narrative review selects and interprets evidence; it doesn't pool data statistically or test anything new, so its conclusions are hypotheses to pursue, not proof.",
    "findings": "The review concludes that endometriosis pain involves <em>neuroinflammation</em> at multiple levels: lesions grow their own nerve fibres, immune cells (mast cells among them) release pain- and inflammation-promoting signals, and the nervous system becomes sensitized so it amplifies pain (central sensitization). It singles out the JAK-STAT signaling pathway and mast-cell activation as mechanisms that drive <em>both</em> lesion growth and pain — which is why the authors find them attractive as dual-purpose targets. These are mechanistic conclusions; the review reports no patient outcomes.",
    "rob": "As a narrative review, the main limitations are <strong>selection and interpretation</strong>: there's no systematic search protocol or risk-of-bias appraisal of the included studies, and much of the underlying evidence is from animal models and cell work that may not translate to humans. It establishes biological plausibility, not clinical effect.",
    "strengths": "It connects scattered mechanistic findings into a coherent, anatomy-based picture of why endometriosis pain behaves the way it does — persisting after surgery, spreading beyond the pelvis, and varying between people. That framing is genuinely useful for explaining the disease and for prioritizing what to test next.",
    "applicability": "<strong>For patients:</strong> this supports the reality that endometriosis pain is a whole-nervous-system condition, which is why a combination of approaches (not just surgery) is often needed — but it does <em>not</em> mean any specific anti-mast-cell or JAK drug is proven for endometriosis. <strong>For clinicians:</strong> useful for counseling and for understanding persistent post-operative pain; not a basis for off-label prescribing.",
    "kb": "It sits within the growing 'endometriosis as a neuro-immune-inflammatory condition' literature and underpins this brief's central claim. It's the mechanistic backbone; the companion mast-cell paper (MRGPRX2/histamine) is the experimental counterpart. Neither is a clinical trial — hence the brief's 'mechanism dense; clinical translation pending' verdict.",
    "equity": "Mechanism reviews don't enroll patients, so there's no demographic representation to assess. Worth noting for the bigger picture: endometriosis pain is historically under-recognized and under-treated, and mechanistic legitimacy for that pain matters for how seriously patients are taken.",
    "monday": "<strong>Hold / counsel — don't change prescribing.</strong> This is mechanism, not a treatment trial. Use it to explain to patients <em>why</em> their pain can persist after surgery and isn't 'in their head', and why management is often multimodal (hormonal, pain-modulating, pelvic-floor, lifestyle). It is not evidence to start antihistamines, JAK inhibitors, or mast-cell stabilizers for endometriosis pain outside a trial.",
    "prompts": "<ol><li>If mast-cell and JAK-STAT pathways drive both lesion growth and pain, what would a first credible human trial need to measure?</li><li>How do we explain 'central sensitization' to patients without dismissing their pain or over-promising a fix?</li><li>Where does this mechanistic story intersect with the MCAS / chronic-pelvic-pain literature in the related brief?</li></ol>",
},

# ── 40600649 — mechanism/animal: MRGPRX2 mast-cell → sensory-neuron pain ──
"40600649": {
    "bottom": "This is a <strong>laboratory and animal mechanism study</strong> — the strongest experimental support in this brief. Working in mice and cells, the researchers showed that removing mast cells reduced endometriosis pain sensitivity, that a particular mast-cell receptor (MRGPRX2) is more abundant in endometriosis lesions, and that mast cells drive pain by releasing histamine, which sensitizes nearby sensory nerves through the HRH1 receptor and the TRPV1 'pain channel'. <strong>For patients:</strong> it gives a concrete biological chain for how mast cells could cause endometriosis pain — and hints at why histamine pathways are of interest. <strong>For clinicians:</strong> compelling mechanism with a named receptor cascade, but it's pre-clinical — no humans were treated.",
    "question": "<strong>The problem.</strong> Mast cells (allergy/immune cells that release histamine) are found in endometriosis lesions, and many suspect they contribute to pain — but <em>how</em> has been unclear, which is exactly what's needed before any anti-mast-cell treatment could be rational. <strong>The question:</strong> do mast cells cause endometriosis pain, and through which receptor and signaling pathway?",
    "pico": {"P": "Mouse models of endometriosis and sensory-neuron/cell experiments.",
             "I": "Mast-cell knockout; study of the MRGPRX2 receptor and histamine → HRH1 → TRPV1 pathway.",
             "C": "Animals/cells with intact mast cells vs depleted; lesion vs normal tissue.",
             "O": "Pain sensitivity (hyperalgesia), MRGPRX2+ mast-cell density, sensory-neuron sensitization.",
             "D": "Pre-clinical mechanistic study (animal + cell).",
             "S": "Laboratory cohorts (not patient-level)."},
    "methods": "Using mouse endometriosis models, the team compared pain responses when mast cells were present versus genetically/experimentally removed, measured MRGPRX2-positive mast cells in lesions, and traced the downstream signaling (histamine acting on the HRH1 receptor to sensitize the TRPV1 pain channel on sensory neurons). <strong>What to keep in mind:</strong> mouse pain models and human MRGPRX2 biology don't map perfectly, so the pathway is a strong lead, not a settled human mechanism.",
    "findings": "Three linked results: (1) removing mast cells <em>alleviated</em> endometriosis-induced pain sensitivity — direct evidence mast cells are involved; (2) MRGPRX2-positive mast cells were <em>increased</em> in endometriotic lesions; and (3) mast cells drove pain by releasing histamine that sensitized sensory neurons via HRH1/TRPV1. Together these trace a coherent cause-and-effect chain from mast cell to felt pain.",
    "rob": "<strong>Species and model limits</strong> are the key caveats: results are in mice and cells, MRGPRX2 has known human-vs-rodent differences, and endometriosis models don't fully reproduce the human disease. It shows the pathway <em>can</em> drive pain in the model — not that blocking it relieves pain in patients.",
    "strengths": "It moves the mast-cell story from correlation ('mast cells are present') to causation ('removing them reduces pain') and names a specific, druggable receptor cascade. That mechanistic specificity is what makes it the centerpiece experimental support for the claim.",
    "applicability": "<strong>For patients:</strong> this is encouraging biology and helps explain why histamine and mast cells are being studied in endometriosis pain — but it is <em>not</em> evidence that antihistamines or mast-cell stabilizers treat endometriosis pain in people. <strong>For clinicians:</strong> a strong rationale for human trials; not a basis for off-label antihistamine prescribing for endometriosis.",
    "kb": "This is the experimental anchor of the brief, paired with the neuroinflammation review's broader framework. The HRH1/histamine link is also what ties this claim to the separate 'antihistamines for endometriosis pain' brief — same biology, where the clinical evidence is still 'insufficient'.",
    "equity": "An animal study, so no human demographics. Relevant context: a validated biological mechanism for endometriosis pain matters for patients whose pain has been minimized — but mechanism alone shouldn't drive treatment decisions ahead of human evidence.",
    "monday": "<strong>Hold / counsel.</strong> Genuinely promising mechanism, but pre-clinical. It's reasonable to tell patients that mast cells and histamine are a real and active area of endometriosis-pain research; it is not grounds to start antihistamines for endometriosis pain outside a trial. Watch this space for first-in-human studies.",
    "prompts": "<ol><li>Given the HRH1/TRPV1 pathway, what would a rigorous trial of an H1 antihistamine for endometriosis pain need to show — and against what comparator?</li><li>How well does mouse MRGPRX2 biology predict human response?</li><li>Could mast-cell-targeted therapy affect lesion growth as well as pain, or pain only?</li></ol>",
},

}
