# -*- coding: utf-8 -*-
"""tb_glp1_endo.py — deep-dives for the trend brief
"GLP-1 receptor agonists for endometriosis lesion burden".
Verdict: partially supported.
Maps the evidence pyramid: a biochemical/mechanistic basis (GLP-1↔estrogen in
adipose/lipid metabolism) plus the surgery/recurrence/fertility context that
motivates seeking new adjuncts. Direct endometriosis-lesion clinical evidence is
the missing top of the pyramid. Patient+provider voice per §3.9."""

AUTHORED = {

# 39542180 — GLP-1 ↔ estrogen interaction in lipid/adipose metabolism (mechanism)
"39542180": {
    "bottom": "The <strong>biochemical/mechanistic paper</strong> that grounds this claim. It studies how GLP-1 and estrogen <em>interact</em> to regulate fat and lipid metabolism — the kind of basic-science finding that explains <em>why</em> a GLP-1 drug might plausibly influence an estrogen-dependent, inflammation-driven disease like endometriosis. This is the laboratory rationale behind the growing interest in GLP-1 (Ozempic-class) drugs for endometriosis: a real mechanistic thread that establishes biological plausibility at the molecular level. But it doesn't measure endometriosis lesions or symptoms, so it's a basis for the idea, not yet a treatment study.",
    "question": "<strong>The problem.</strong> Endometriosis is estrogen-dependent and linked to metabolic and inflammatory signaling; GLP-1 receptor agonists affect estrogen-related metabolism, raising the question of a mechanistic overlap. <strong>The question:</strong> how do GLP-1 and estrogen interact to regulate lipid and adipose-tissue metabolism?",
    "pico": {"P": "Adipose-tissue/metabolic models (sex-specific fat distribution and estrogen signaling).",
             "I": "Study of GLP-1 ↔ estrogen interaction on lipid/adipose regulation.",
             "C": "Conditions with altered estrogen/GLP-1 signaling.",
             "O": "Mechanistic effects on fat metabolism and estrogen-related pathways.",
             "D": "Pre-clinical mechanistic study.",
             "S": "Laboratory/experimental."},
    "methods": "Experimental study of how GLP-1 signaling and estrogen jointly regulate white-adipose-tissue lipid metabolism, including sex differences and the post-menopausal shift in fat distribution and metabolic risk. <strong>Keep in mind:</strong> this is molecular/metabolic mechanism — it builds the <em>basis</em> for a hypothesis, it doesn't test endometriosis outcomes.",
    "findings": "GLP-1 and estrogen interact in regulating lipid and adipose metabolism, intersecting pathways (estrogen signaling, insulin resistance, inflammation) that are also implicated in endometriosis biology. This is the mechanistic bridge connecting a metabolic drug class to an estrogen-dependent gynecologic disease.",
    "rob": "Pre-clinical and metabolism-focused; the link to endometriosis lesion burden is inferential, not measured. It supports plausibility, not efficacy.",
    "strengths": "Provides a concrete molecular rationale (the estrogen–GLP-1 intersection) that elevates the GLP-1–endometriosis idea above pure speculation — the bench foundation of the evidence pyramid for this claim.",
    "applicability": "It explains the scientific reason GLP-1 drugs are being discussed for endometriosis, while making clear that no study yet shows they shrink lesions or relieve endometriosis pain. It's a justification for future trials — not a basis for using GLP-1 drugs for endometriosis now.",
    "kb": "The mechanistic anchor that makes the verdict 'partially supported': there is a genuine biochemical basis, but direct endometriosis (lesion/symptom) evidence — the clinical top of the pyramid — is absent.",
    "equity": "Mechanism study (no demographics). GLP-1 drugs are costly and access-limited; any endometriosis use, if proven, would raise real equity/access questions.",
    "monday": "<strong>Hold / counsel.</strong> Tell patients there's a plausible metabolic-estrogen mechanism being explored, but no evidence GLP-1 drugs treat endometriosis lesions or pain — and they shouldn't be used off-label for that. Track for trials.",
    "prompts": "<ol><li>Which estrogen/metabolic pathways does GLP-1 touch that overlap endometriosis biology?</li><li>What would a first endometriosis-specific GLP-1 study need to measure — lesions, pain, or both?</li><li>How do you separate weight/metabolic effects from any direct lesion effect?</li></ol>",
},

# 33095458 — laparoscopic surgery for endometriosis (Cochrane) — context
"33095458": {
    "bottom": "The <strong>Cochrane review of laparoscopic surgery for endometriosis</strong> — the established, evidence-based treatment that any new add-on like a GLP-1 drug would have to <em>add value</em> on top of. Surgery is a proven mainstay; GLP-1 drugs are not a replacement for it. It's the standard-of-care baseline for this brief.",
    "question": "<strong>The problem.</strong> Effective endometriosis treatment for pain and fertility is needed; laparoscopic surgery anchors care. <strong>The question:</strong> what is the effect of laparoscopic surgery on endometriosis pain and subfertility?",
    "pico": {"P": "People with endometriosis (pain/subfertility).", "I": "Laparoscopic surgical treatment.",
             "C": "Diagnostic laparoscopy/no treatment.", "O": "Pain and fertility outcomes.",
             "D": "Cochrane systematic review of RCTs.", "S": "Pooled RCTs."},
    "methods": "Cochrane synthesis of randomized evidence for laparoscopic treatment vs control. <strong>Keep in mind:</strong> high-quality, defines standard-of-care efficacy.",
    "findings": "Laparoscopic surgery improves endometriosis pain and can improve fertility versus no treatment — the effective standard against which adjuncts are measured (and, per the recurrence review, not a permanent cure).",
    "rob": "Cochrane methods limit bias; standard-of-care conclusion robust.",
    "strengths": "Authoritative baseline for evaluating any add-on claim's incremental value.",
    "applicability": "Surgery is proven, and a GLP-1 drug wouldn't replace it — it's the bar any add-on would have to clear.",
    "kb": "Defines standard-of-care context shared across the endometriosis briefs.",
    "equity": "Access to skilled endometriosis surgery is uneven.",
    "monday": "<strong>Standard of care.</strong> Surgery remains evidence-based; frame GLP-1 as an unproven potential adjunct, not a substitute.",
    "prompts": "<ol><li>What incremental benefit would justify adding a GLP-1 drug to surgical care?</li><li>How do you set expectations about surgery and recurrence?</li><li>Where might metabolic therapy fit around surgery?</li></ol>",
},

# 33020832 — recurrence after post-op hormonal suppression — context
"33020832": {
    "bottom": "A <strong>systematic review</strong> documenting high endometriosis recurrence after surgery and limited evidence that post-operative hormonal suppression prevents it — the unmet-need context driving interest in newer add-ons like GLP-1 drugs. Surgery often isn't curative, which is why new options are sought; that gap is what motivates the GLP-1 question.",
    "question": "<strong>The problem.</strong> Recurrence after endometriosis surgery is common and prevention is uncertain. <strong>The question:</strong> does post-operative medical therapy reduce recurrence?",
    "pico": {"P": "Post-surgical endometriosis patients.", "I": "Post-operative hormonal suppression.",
             "C": "No suppression/placebo/other.", "O": "Recurrence.",
             "D": "Systematic review (observational + RCT).", "S": "Pooled."},
    "methods": "Review of post-operative medical therapy for recurrence. <strong>Keep in mind:</strong> heterogeneous regimens/outcomes limit firm conclusions.",
    "findings": "Recurrence is high and the benefit of post-op suppression uncertain — a real unmet need that legitimizes exploring better-evidenced adjuncts.",
    "rob": "Heterogeneity and observational components weaken certainty; high-recurrence finding is well recognized.",
    "strengths": "Frames the recurrence problem motivating new adjunct research.",
    "applicability": "It sets realistic expectations about surgery and add-on therapies, and it's the context behind individualized management and the interest in newer options.",
    "kb": "The 'why seek new adjuncts' context for the GLP-1 claim; shared with the antihistamine-endometriosis brief.",
    "equity": "Recurrence/repeat-surgery burden falls on patients with limited specialist access.",
    "monday": "<strong>Counsel.</strong> Discuss recurrence risk and modest suppression evidence; this motivates but doesn't justify unproven GLP-1 use.",
    "prompts": "<ol><li>What endpoints should adjunct (GLP-1) trials use — recurrence, lesion burden, pain?</li><li>How do you counsel recurrence risk honestly?</li><li>Where would a metabolic adjunct plausibly help?</li></ol>",
},

# 36948440 — endometriosis/adenomyosis with pregnancy and infertility — context
"36948440": {
    "bottom": "A <strong>review of endometriosis/adenomyosis effects on fertility and pregnancy</strong> — the reproductive-stakes context. It matters specifically for GLP-1 drugs because <strong>they are generally avoided around pregnancy and conception</strong>, so fertility plans strongly shape whether these drugs could ever fit endometriosis care. That makes reproductive goals central to the treatment choice, and a key safety lens for the GLP-1 question.",
    "question": "<strong>The problem.</strong> Endometriosis/adenomyosis impair fertility and complicate pregnancy. <strong>The question:</strong> how are they associated with infertility and adverse pregnancy outcomes?",
    "pico": {"P": "People with endometriosis/adenomyosis and reproductive goals.",
             "I": "Review of disease–fertility/pregnancy associations.", "C": "Unaffected reproduction.",
             "O": "Infertility and adverse pregnancy associations.", "D": "Narrative review.", "S": "n/a."},
    "methods": "Synthesis of disease–reproduction associations. <strong>Keep in mind:</strong> associational, not a treatment study.",
    "findings": "Both conditions are associated with infertility and adverse pregnancy outcomes, making fertility-/pregnancy-safe management a priority — directly relevant given GLP-1 agonists' pregnancy cautions.",
    "rob": "Narrative review; associations with confounding.",
    "strengths": "Clarifies reproductive stakes and a concrete safety constraint for any endometriosis adjunct.",
    "applicability": "If pregnancy is a goal, GLP-1 drugs carry specific cautions — reproductive safety is a gating consideration for using them in reproductive-age people with endometriosis.",
    "kb": "Reproductive-stakes + safety context for the GLP-1 claim; shared with the antihistamine-endometriosis brief.",
    "equity": "Fertility-care access disparities compound the reproductive burden.",
    "monday": "<strong>Context / counsel.</strong> Weigh fertility goals and GLP-1 pregnancy cautions before any consideration; this is a real barrier to GLP-1 use in reproductive-age patients.",
    "prompts": "<ol><li>How do GLP-1 pregnancy cautions constrain use in reproductive-age endometriosis patients?</li><li>How do fertility goals reshape adjunct choice?</li><li>What reproductive-safety data would a GLP-1 endometriosis trial need?</li></ol>",
},

}
