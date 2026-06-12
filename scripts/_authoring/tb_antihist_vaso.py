# -*- coding: utf-8 -*-
"""tb_antihist_vaso.py — deep-dives for the trend brief
"Antihistamines for menopausal vasomotor symptoms".
Verdict: mechanism-plausible; clinical evidence insufficient.
Note: the cited papers establish the PROVEN options (hormone therapy; the NK3
antagonist fezolinetant via the KNDy/neurokinin-B pathway) — the contrast that
shows antihistamines remain unproven. Patient+provider voice per §3.9."""

AUTHORED = {

# 35797481 — NAMS 2022 hormone therapy position statement
"35797481": {
    "bottom": "The <strong>North American Menopause Society's 2022 position statement</strong> — the authoritative US guidance on hormone therapy. It confirms hormone therapy is the <strong>most effective</strong> treatment for menopausal hot flushes and night sweats (vasomotor symptoms), with a favorable benefit-risk profile for most healthy women under 60 or within 10 years of menopause. <strong>For patients:</strong> if hot flushes are disrupting your life, hormone therapy is the proven first-line option for most; 'natural' alternatives like antihistamines are not established. <strong>For clinicians:</strong> the benchmark against which any non-hormonal claim (including antihistamines) must be judged.",
    "question": "<strong>The problem.</strong> Vasomotor symptoms are common and disruptive, and patients are flooded with hormonal and non-hormonal options of varying evidence. <strong>The question:</strong> what is the current evidence-based position on hormone therapy's benefits, risks, and role for menopausal symptoms?",
    "pico": {"P": "Menopausal women, especially with bothersome vasomotor symptoms.",
             "I": "Menopausal hormone therapy (with the age/time-since-menopause 'window').",
             "C": "No therapy / non-hormonal options.",
             "O": "Symptom relief, benefits, and risks by age and timing.",
             "D": "Evidence-based society position statement.",
             "S": "Synthesizes the trial and cohort evidence."},
    "methods": "An expert panel synthesized the evidence into graded recommendations on indications, the timing/'window' hypothesis, route, and risk. <strong>Keep in mind:</strong> guidance reflects the weight of evidence; for VMS that evidence (hormone therapy as most effective) is strong.",
    "findings": "Hormone therapy is the most effective treatment for vasomotor symptoms and genitourinary symptoms, with benefits generally outweighing risks for healthy symptomatic women who start before age 60 or within 10 years of menopause; risk rises with later initiation and certain routes/regimens. Non-hormonal pharmacologic options are positioned as alternatives when hormones are unsuitable.",
    "strengths": "Authoritative, current, and nuanced about the age/timing window and individualized risk — the right yardstick for evaluating newer or alternative approaches.",
    "rob": "Consensus guidance inherits evidence gaps and requires individualized application; it's a synthesis, not a single trial. Its VMS-efficacy conclusion is well supported.",
    "applicability": "<strong>For patients:</strong> proven first-line relief for hot flushes for most women; discuss your personal risk/timing. <strong>For clinicians:</strong> offer hormone therapy within the window for bothersome VMS; reserve non-hormonal agents (proven ones) for contraindications/preference — and note antihistamines aren't among the proven options.",
    "kb": "Sets the efficacy benchmark for this brief: any antihistamine claim must beat or complement proven therapy, and it currently has no comparable evidence. Shared with the MHT-safety brief.",
    "equity": "Access to hormone therapy and informed counseling is uneven; clear guidance helps counter both under-treatment (post-WHI fear) and over-selling of unproven alternatives.",
    "monday": "<strong>Counsel; offer proven first-line.</strong> For bothersome VMS, discuss hormone therapy within the window first; use evidence-based non-hormonal options when needed. Don't substitute antihistamines for proven therapy.",
    "prompts": "<ol><li>How do you apply the age/timing window to individual risk?</li><li>When hormones are contraindicated, which non-hormonal options have real evidence?</li><li>How do you redirect a patient set on an unproven 'natural' route?</li></ol>",
},

# 36734148 — fezolinetant SKYLIGHT 2 phase 3 RCT
"36734148": {
    "bottom": "A <strong>phase-3 randomized controlled trial (SKYLIGHT 2)</strong> of fezolinetant — a non-hormonal drug that blocks the neurokinin-3 (NK3) receptor — for moderate-to-severe menopausal hot flushes. It's high-quality proof that targeting the <em>right</em> brain pathway works without hormones. <strong>For patients:</strong> there's now a proven non-hormonal pill for hot flushes — but it's fezolinetant (an NK3 blocker), not an antihistamine. <strong>For clinicians:</strong> the modern non-hormonal standard, and the contrast that makes the antihistamine idea look unproven by comparison.",
    "question": "<strong>The problem.</strong> Many women can't or won't take hormones and need an effective non-hormonal option for hot flushes. The hot-flush 'thermostat' is driven by KNDy neurons signaling through the NK3 receptor — a precise, druggable target. <strong>The question:</strong> does the NK3-receptor antagonist fezolinetant reduce moderate-to-severe vasomotor symptoms safely?",
    "pico": {"P": "Women 40–65 with moderate-to-severe menopausal vasomotor symptoms.",
             "I": "Fezolinetant (oral NK3-receptor antagonist).",
             "C": "Placebo (double-blind), with active-treatment extension.",
             "O": "Frequency and severity of vasomotor symptoms; safety.",
             "D": "Double-blind, placebo-controlled phase-3 RCT (12 weeks + 40-week extension).",
             "S": "Phase-3 trial cohort (SKYLIGHT 2)."},
    "methods": "A rigorous double-blind, placebo-controlled phase-3 trial measured reductions in hot-flush frequency and severity over 12 weeks with a 40-week safety extension. <strong>Keep in mind:</strong> this is the gold-standard design — the kind of evidence antihistamines for VMS entirely lack.",
    "findings": "Fezolinetant significantly reduced the frequency and severity of moderate-to-severe vasomotor symptoms versus placebo, with an acceptable safety profile over the trial period — validating NK3 blockade as an effective non-hormonal mechanism.",
    "rob": "Well-conducted RCT; main caveats are industry sponsorship, finite follow-up (liver monitoring is advised in practice), and that benefit is specific to the NK3 mechanism. Internally strong evidence.",
    "strengths": "Phase-3 RCT rigor establishing a proven non-hormonal option and pinpointing the correct neuroendocrine target for hot flushes.",
    "applicability": "<strong>For patients:</strong> a genuine non-hormonal option exists (fezolinetant) if hormones aren't right for you — distinct from unproven antihistamines. <strong>For clinicians:</strong> offer fezolinetant for VMS when hormones are unsuitable; it sets the evidentiary bar antihistamines have not met.",
    "kb": "Defines the proven non-hormonal pathway (NK3/KNDy) in the brief; together with the kisspeptin/NKB mechanism review it shows where the real biology and evidence sit — not on histamine.",
    "equity": "Non-hormonal efficacy expands options for women who can't take estrogen (e.g., breast-cancer survivors); cost/access to a new branded drug is the equity flip-side.",
    "monday": "<strong>Offer as proven non-hormonal option.</strong> For bothersome VMS without hormones, fezolinetant is evidence-based (with monitoring). Use it — not antihistamines — when a non-hormonal route is needed.",
    "prompts": "<ol><li>Where does fezolinetant sit relative to hormones and SSRIs/SNRIs/gabapentin for VMS?</li><li>What monitoring (e.g., hepatic) do you put in place?</li><li>Why does proving NK3 blockade make the histamine hypothesis look weaker, not stronger?</li></ol>",
},

# 36924778 — fezolinetant Lancet commentary
"36924778": {
    "bottom": "A <strong>commentary in The Lancet</strong> accompanying the fezolinetant trial program — expert context on what NK3-antagonist therapy means for menopause care. <strong>For patients:</strong> signals that the field views non-hormonal NK3 blockade as a meaningful advance. <strong>For clinicians:</strong> editorial perspective situating fezolinetant among options; commentary, not new data.",
    "question": "<strong>The problem.</strong> A new drug class needs expert interpretation of its place, promise, and caveats. <strong>The question:</strong> what is the significance and appropriate role of fezolinetant/NK3 antagonism for vasomotor symptoms?",
    "pico": {"P": "Menopausal women with vasomotor symptoms (field-level perspective).",
             "I": "NK3-receptor antagonism (fezolinetant).",
             "C": "Existing hormonal and non-hormonal options.",
             "O": "Expert appraisal of role, benefits, and caveats.",
             "D": "Editorial commentary.",
             "S": "Not applicable."},
    "methods": "An invited commentary interpreting the fezolinetant trial evidence for practice. <strong>Keep in mind:</strong> commentary reflects expert opinion on others' data, not independent results.",
    "findings": "It frames NK3 antagonism as a clinically meaningful non-hormonal advance while noting practical caveats (monitoring, cost, long-term data), reinforcing that the proven non-hormonal direction is NK3 — not histamine.",
    "rob": "Opinion piece — no data, subject to author perspective. Useful for context, not evidence.",
    "strengths": "Concise expert situating of a new option, helpful for clinicians deciding where it fits.",
    "applicability": "<strong>For patients:</strong> supportive context that non-hormonal NK3 therapy is a real advance. <strong>For clinicians:</strong> perspective for positioning fezolinetant; doesn't change the evidence on antihistamines (still none of this caliber).",
    "kb": "Adds expert framing around the proven NK3 pathway central to contrasting the unproven antihistamine claim.",
    "equity": "Commentary often flags access/cost concerns relevant to equitable adoption of new therapies.",
    "monday": "<strong>Context only.</strong> Use to inform how you position fezolinetant; it carries no implication for prescribing antihistamines for VMS.",
    "prompts": "<ol><li>What practical caveats does the commentary raise for real-world use?</li><li>How should commentary weigh against the trial in your decisions?</li><li>Does expert framing change where you place NK3 antagonists?</li></ol>",
},

# 39813600 — kisspeptin and neurokinin B review (mechanism)
"39813600": {
    "bottom": "A <strong>review of kisspeptin and neurokinin B (NKB)</strong> — the brain signaling molecules of the KNDy neurons that control reproductive hormones and, importantly, generate hot flushes. It explains <em>why</em> blocking neurokinin B (the NK3 pathway) relieves vasomotor symptoms. <strong>For patients:</strong> the science of why hot flushes happen and why the new non-hormonal drug works. <strong>For clinicians:</strong> the mechanistic basis for NK3 antagonism — and a reminder that the validated hot-flush pathway is NKB, not histamine.",
    "question": "<strong>The problem.</strong> Understanding the neuroendocrine control of hot flushes is what enabled a targeted non-hormonal treatment. <strong>The question:</strong> what roles do kisspeptin and neurokinin B play in reproductive health and in mediating menopausal symptoms?",
    "pico": {"P": "Human reproductive neuroendocrinology (mechanistic scope).",
             "I": "Review of kisspeptin/NKB (KNDy neuron) signaling.",
             "C": "Normal vs menopausal/estrogen-deprived signaling.",
             "O": "Mechanistic understanding of GnRH pulse control and vasomotor symptom generation.",
             "D": "Narrative mechanistic review.",
             "S": "Not applicable."},
    "methods": "A synthesis of how infundibular kisspeptin/NKB neurons regulate GnRH pulses and how estrogen withdrawal at menopause leads, via NKB/NK3 signaling, to thermoregulatory instability (hot flushes). <strong>Keep in mind:</strong> mechanistic review establishes the pathway, supporting the targeted drug class.",
    "findings": "Kisspeptin and NKB are central to reproductive control and to the generation of vasomotor symptoms; loss of estrogen's restraint on KNDy neurons drives the NKB/NK3 signaling that produces hot flushes — the mechanistic rationale for NK3 antagonists like fezolinetant.",
    "rob": "Narrative review; mechanistic synthesis rather than outcome data. The NKB→hot-flush link is well supported by the successful NK3-antagonist trials.",
    "strengths": "Connects basic neuroendocrinology to a successful therapy — a clean example of mechanism validating treatment, and the standard the histamine hypothesis hasn't met.",
    "applicability": "<strong>For patients:</strong> explains the biology behind hot flushes and the new non-hormonal pill. <strong>For clinicians:</strong> mechanistic grounding for NK3 therapy; underscores that the validated vasomotor pathway is NKB-based, not histaminergic.",
    "kb": "Provides the mechanistic 'why' behind the proven NK3 option; together they frame the antihistamine claim as biologically conceivable but neither mechanistically validated for VMS nor clinically tested.",
    "equity": "Mechanistic review — no population. Understanding the pathway helps justify access to targeted non-hormonal therapy for those who can't use estrogen.",
    "monday": "<strong>Background.</strong> Use to explain hot-flush biology and the rationale for NK3 antagonists. It does not support antihistamines for VMS — the validated pathway is NKB/NK3.",
    "prompts": "<ol><li>How does the KNDy/NKB pathway explain the timing and triggers of hot flushes?</li><li>Why is a mechanism like this stronger justification than the histamine hypothesis?</li><li>Could other KNDy-pathway targets follow fezolinetant?</li></ol>",
},

}
