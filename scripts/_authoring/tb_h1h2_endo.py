# -*- coding: utf-8 -*-
"""tb_h1h2_endo.py — deep-dives for the trend brief
"H1 and H2 antihistamines for endometriosis pain".
Verdict: mechanism-plausible; clinical evidence insufficient.
The mast-cell/histamine papers (40600649, 40948761) supply the mechanistic
plausibility (HRH1 = the H1 receptor); the surgery/recurrence/infertility papers
set the treatment-landscape context. Patient+provider voice per §3.9."""

AUTHORED = {

# 40600649 — MRGPRX2 mast-cell → histamine/HRH1/TRPV1 (the H1 link)
"40600649": {
    "bottom": "The <strong>core mechanistic paper</strong> for this claim. In mice and cells, mast cells drove endometriosis pain by releasing <strong>histamine</strong>, which sensitized sensory nerves through the <strong>HRH1 receptor — the very target H1 antihistamines block</strong> — and the TRPV1 pain channel. Removing mast cells reduced pain. <strong>For patients:</strong> this is the biological reason people are excited about antihistamines for endometriosis pain — but it's a lab/animal study, not a treatment trial in people. <strong>For clinicians:</strong> a clean rationale for testing H1 antihistamines, not yet a reason to prescribe them.",
    "question": "<strong>The problem.</strong> If mast-cell histamine sensitizes pain nerves in endometriosis via the H1 receptor, then H1 antihistamines (which block exactly that receptor) become a logical thing to test. <strong>The question:</strong> do mast cells cause endometriosis pain, and through the histamine/HRH1 pathway?",
    "pico": {"P": "Mouse endometriosis models and sensory-neuron/cell experiments.",
             "I": "Mast-cell depletion; study of MRGPRX2 and histamine→HRH1→TRPV1 signaling.",
             "C": "Intact vs depleted mast cells; lesion vs normal tissue.",
             "O": "Pain sensitivity; HRH1/TRPV1-mediated neuron sensitization.",
             "D": "Pre-clinical mechanistic study (animal + cell).",
             "S": "Laboratory cohorts."},
    "methods": "Mouse and cell experiments traced how mast-cell histamine sensitizes sensory neurons via HRH1 and TRPV1, and tested whether removing mast cells reduces pain. <strong>Keep in mind:</strong> rodent histamine-receptor biology and endometriosis models don't perfectly mirror humans, so this identifies a target, not a proven treatment.",
    "findings": "Mast-cell removal reduced endometriosis pain; MRGPRX2+ mast cells were increased in lesions; and histamine acting on HRH1 (the H1 receptor) sensitized sensory neurons via TRPV1. The HRH1 step is the mechanistic bridge to H1 antihistamines.",
    "rob": "Species/model limits and the gap between blocking a receptor in mice and relieving pain in patients. Strong mechanism, no human efficacy.",
    "strengths": "Names the exact receptor (HRH1) that a common, cheap, well-tolerated drug class blocks — an unusually actionable mechanistic lead.",
    "applicability": "<strong>For patients:</strong> explains the rationale for antihistamines in endometriosis pain, but it is not evidence they work in people — don't self-treat expecting pain relief. <strong>For clinicians:</strong> rationale for a trial; not a basis for off-label prescribing.",
    "kb": "The mechanistic anchor that makes the antihistamine claim 'mechanism-plausible'. The matching clinical-trial evidence is what's missing — hence 'clinical evidence insufficient'.",
    "equity": "Animal study (no demographics). A cheap, accessible drug class would be an equity win <em>if</em> trials proved benefit — which is the point of testing it properly.",
    "monday": "<strong>Hold / counsel.</strong> Reasonable to tell patients the histamine/H1 pathway is a real and promising research direction; not a reason to start antihistamines for endometriosis pain outside a trial.",
    "prompts": "<ol><li>Given the HRH1 link, what would a credible H1-antihistamine endometriosis-pain RCT look like?</li><li>H1 vs H2 receptors — which does this mechanism actually implicate?</li><li>Would antihistamines affect pain only, or lesions too?</li></ol>",
},

# 40948761 — neuroinflammation review (broader mechanism)
"40948761": {
    "bottom": "A <strong>review</strong> of endometriosis-pain neurobiology arguing the pain is driven by neuroinflammation involving mast cells and nerve sensitization — broader context for why histamine-blocking (antihistamines) is a plausible idea. <strong>For patients:</strong> background on why endometriosis pain persists and why immune/histamine pathways are studied. <strong>For clinicians:</strong> mechanistic framing, not trial evidence for antihistamines.",
    "question": "<strong>The problem.</strong> Endometriosis pain often resists surgery and hormones, implicating neuro-immune mechanisms (including mast-cell/histamine signaling) as drivers and potential targets. <strong>The question:</strong> what is the neuroinflammatory biology of endometriosis pain and which targets emerge?",
    "pico": {"P": "Endometriosis-associated pain (mechanism, synthesized).",
             "I": "Review of neuroinflammatory mechanisms; candidate targets (incl. mast-cell activation, JAK-STAT).",
             "C": "Not comparative (narrative review).",
             "O": "Mechanistic framework and targets.",
             "D": "Narrative review.",
             "S": "Not applicable."},
    "methods": "A narrative synthesis of how lesions, immune cells, and the nervous system interact to generate pain. <strong>Keep in mind:</strong> selective, interpretive review — hypotheses, not proof.",
    "findings": "Endometriosis pain involves multi-level neuroinflammation with mast cells among the contributors; this supports exploring immune/histamine-modulating approaches but reports no patient outcomes.",
    "rob": "Narrative-review limits (no systematic appraisal; much animal/cell evidence). Establishes plausibility, not effect.",
    "strengths": "Coherent mechanistic backdrop that situates the histamine hypothesis within the wider neuro-immune model of endometriosis pain.",
    "applicability": "<strong>For patients:</strong> supports a whole-system view of endometriosis pain; not evidence for any specific antihistamine. <strong>For clinicians:</strong> useful framing/counseling; not prescribing guidance.",
    "kb": "Broader mechanistic companion to the HRH1 paper; together they make the antihistamine idea biologically reasonable while leaving the clinical question open.",
    "equity": "Mechanism review — no demographics; legitimizes endometriosis pain as a real neuro-immune phenomenon.",
    "monday": "<strong>Hold / counsel.</strong> Explain the neuro-immune basis of persistent pain and the rationale for studying histamine pathways; don't start antihistamines for endometriosis pain off this.",
    "prompts": "<ol><li>Which neuroinflammatory target is closest to a testable therapy?</li><li>How do you convey 'plausible mechanism, unproven treatment' without dismissiveness?</li><li>How does this connect to the standalone mast-cell brief?</li></ol>",
},

# 33020832 — recurrence after post-op hormonal suppression (SR)
"33020832": {
    "bottom": "A <strong>systematic review</strong> showing that endometriosis frequently <strong>recurs after surgery</strong>, and that evidence for post-operative medical (hormonal) therapy to prevent recurrence is limited and inconsistent. <strong>For patients:</strong> surgery often isn't a cure and pain can return — which is exactly why people search for added options like antihistamines. <strong>For clinicians:</strong> the unmet-need context that motivates the antihistamine question, and a reminder that even established hormonal adjuncts have weak recurrence-prevention evidence.",
    "question": "<strong>The problem.</strong> Surgery improves endometriosis pain and fertility but recurrence is common, and it's unclear whether post-operative hormonal suppression reliably prevents it. <strong>The question:</strong> does post-operative medical therapy reduce endometriosis recurrence?",
    "pico": {"P": "People with endometriosis after conservative surgery.",
             "I": "Post-operative hormonal suppression (various).",
             "C": "No suppression / placebo / other regimens.",
             "O": "Disease/symptom recurrence.",
             "D": "Systematic review of observational studies and RCTs.",
             "S": "Pooled across included studies."},
    "methods": "Prospective observational studies and RCTs of post-operative medical therapy were reviewed for recurrence outcomes. <strong>Keep in mind:</strong> heterogeneous regimens and outcome definitions limit firm pooled conclusions.",
    "findings": "Recurrence after surgery is high, and the benefit of post-operative hormonal suppression for preventing it is uncertain with little consensus — establishing a genuine unmet need for better adjunctive strategies.",
    "rob": "Heterogeneity, variable recurrence definitions, and observational components weaken certainty; the high-recurrence and uncertain-prevention findings are nonetheless well recognized.",
    "strengths": "Clearly frames the recurrence problem and the limits of current medical adjuncts — the clinical rationale for seeking new options.",
    "applicability": "<strong>For patients:</strong> sets realistic expectations that surgery may not be curative and adjuncts have limits. <strong>For clinicians:</strong> context for individualized post-op management; supports honest counseling and interest in better-evidenced adjuncts (which antihistamines are not yet).",
    "kb": "Provides the 'why look beyond surgery and standard hormones' context for the antihistamine claim; shared with the GLP-1 brief.",
    "equity": "Recurrence and repeat surgery burden fall on patients with limited access to specialized endometriosis care — an argument for accessible, well-tested adjuncts.",
    "monday": "<strong>Counsel.</strong> Discuss recurrence risk and the modest evidence for post-op suppression; this motivates—but does not justify—unproven adjuncts like antihistamines.",
    "prompts": "<ol><li>How do you counsel recurrence risk and post-op suppression given weak evidence?</li><li>What endpoints should adjunct trials use?</li><li>Where would an antihistamine fit if it were ever proven?</li></ol>",
},

# 33095458 — laparoscopic surgery for endometriosis (Cochrane)
"33095458": {
    "bottom": "The <strong>Cochrane review of laparoscopic surgery for endometriosis</strong> — the evidence underpinning surgery as a standard treatment for endometriosis pain and subfertility. It's context: it defines what the established treatment <em>is</em>, against which any new adjunct (antihistamines) would be added or compared. <strong>For patients:</strong> surgery is an evidence-based mainstay; antihistamines are not a substitute. <strong>For clinicians:</strong> the baseline-of-care reference for the brief.",
    "question": "<strong>The problem.</strong> Endometriosis needs effective treatment for pain and fertility; laparoscopic surgery is widely used and its evidence base anchors care. <strong>The question:</strong> what is the effect of laparoscopic surgery on endometriosis-associated pain and subfertility?",
    "pico": {"P": "People with endometriosis (pain and/or subfertility).",
             "I": "Laparoscopic surgical treatment of endometriosis.",
             "C": "Diagnostic laparoscopy only / no surgical treatment.",
             "O": "Pain relief and fertility outcomes.",
             "D": "Cochrane systematic review of RCTs.",
             "S": "Pooled across RCTs."},
    "methods": "A Cochrane systematic review pooled randomized evidence on laparoscopic treatment versus control for pain and fertility. <strong>Keep in mind:</strong> high-quality synthesis defining standard-of-care efficacy.",
    "findings": "Laparoscopic surgery improves endometriosis-associated pain and can improve fertility versus no treatment — establishing it as an effective standard, though (per the recurrence review) not a permanent cure.",
    "rob": "Cochrane methodology limits bias; the standard-of-care conclusion is robust within the trials available.",
    "strengths": "Authoritative baseline evidence for the established treatment, essential context for evaluating any add-on claim.",
    "applicability": "<strong>For patients:</strong> confirms surgery as a proven option; antihistamines wouldn't replace it. <strong>For clinicians:</strong> the standard against which adjuncts must show added value.",
    "kb": "Defines standard-of-care in the brief; shared with the GLP-1 brief as the same baseline.",
    "equity": "Access to skilled endometriosis surgery is uneven; accessible proven adjuncts would help, but only if actually proven.",
    "monday": "<strong>Standard of care.</strong> Surgery remains evidence-based for appropriate patients; position any adjunct (antihistamine) as unproven add-on, not replacement.",
    "prompts": "<ol><li>How do you set expectations about surgery's benefits and recurrence?</li><li>What added value would an adjunct need to show over surgery alone?</li><li>Where do medical therapies fit around surgery?</li></ol>",
},

# 36948440 — endometriosis/adenomyosis with pregnancy and infertility
"36948440": {
    "bottom": "A <strong>review of how endometriosis and adenomyosis affect pregnancy and infertility</strong> — context establishing the reproductive stakes of the disease. <strong>For patients:</strong> background on fertility and pregnancy implications. <strong>For clinicians:</strong> situates why effective, fertility-compatible treatments matter — relevant when considering any new therapy's reproductive safety.",
    "question": "<strong>The problem.</strong> Endometriosis and adenomyosis impair fertility and complicate pregnancy, shaping treatment priorities. <strong>The question:</strong> how are endometriosis and adenomyosis associated with pregnancy outcomes and infertility?",
    "pico": {"P": "People with endometriosis and/or adenomyosis and reproductive goals.",
             "I": "Review of disease–fertility/pregnancy associations.",
             "C": "Unaffected reproduction (comparative framing).",
             "O": "Infertility and adverse pregnancy associations.",
             "D": "Narrative review.",
             "S": "Not applicable."},
    "methods": "A synthesis of evidence linking endometriosis/adenomyosis to subfertility and adverse pregnancy outcomes. <strong>Keep in mind:</strong> associational synthesis, not a treatment study.",
    "findings": "Both conditions are associated with infertility and with adverse pregnancy outcomes, underscoring why fertility-preserving, pregnancy-safe management is a priority — context for evaluating any adjunctive therapy's reproductive profile.",
    "rob": "Narrative review; associations with residual confounding. Establishes context, not causation or treatment effect.",
    "strengths": "Clarifies the reproductive stakes that any new endometriosis therapy must respect.",
    "applicability": "<strong>For patients:</strong> understand fertility/pregnancy implications when weighing treatments. <strong>For clinicians:</strong> reproductive considerations frame adjunct choices; an unproven adjunct (antihistamine) must also be weighed for pregnancy safety.",
    "kb": "Reproductive-stakes context for the brief; shared with the GLP-1 brief (where GLP-1 agonists carry specific pregnancy cautions).",
    "equity": "Fertility care access disparities compound endometriosis's reproductive burden.",
    "monday": "<strong>Context / counsel.</strong> Factor fertility and pregnancy implications into endometriosis management; note any adjunct's reproductive-safety profile before use.",
    "prompts": "<ol><li>How do fertility goals change your endometriosis-pain management?</li><li>What reproductive-safety data would an adjunct need?</li><li>How do you counsel pregnancy risk in endometriosis/adenomyosis?</li></ol>",
},

}
