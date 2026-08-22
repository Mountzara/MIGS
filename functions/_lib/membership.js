// =====================================================================
// membership.js — the practice's membership tiers and their economics
// =====================================================================
// The brief: "insurance vs self-pay / tiered membership — a profitable
// model I design." This module is that model, plus the guardrails that
// keep it lawful, plus the arithmetic that shows whether it actually
// makes money at this practice's scale.
//
// ---------------------------------------------------------------------
// THE CENTRAL DESIGN CONSTRAINT, AND WHY THE TIERS LOOK LIKE THIS
// ---------------------------------------------------------------------
// A medical "membership" can be built two ways, and only one of them is
// safe for a surgeon who bills insurance.
//
//   WRONG: charge a monthly fee that covers medical services. That is
//   (a) arguably the business of INSURANCE, which requires a licence in
//   both IL and CA; (b) double-billing when the same service is also
//   claimed from a payer; and (c) for a Medicare or Medicaid patient, a
//   probable violation of the beneficiary-inducement civil money penalty
//   at 42 U.S.C. §1320a-7a(a)(5). Direct-primary-care statutes carve out
//   some of this, but they are written for PRIMARY care — a CBG/MIGS
//   subspecialist should not assume the carve-out reaches him.
//
//   RIGHT: charge for ACCESS AND CONVENIENCE that is not a covered
//   service and is never billed to anyone. Extended appointment length,
//   direct asynchronous messaging, care coordination across systems,
//   written recovery roadmaps, expedited scheduling. None of it is
//   claimable; none of it duplicates a payer-covered item; the patient's
//   insurance relationship is untouched.
//
// So EVERY benefit below carries `covered_service: false`, and
// `validateTierLegality()` fails the build if one is ever added that does
// not. The check exists because this is the mistake that gets made
// quietly, a year later, when someone adds "includes your annual visit"
// to a marketing page.
//
// FEDERAL BENEFICIARIES ARE EXCLUDED BY DEFAULT. `eligibility()` refuses
// to enrol a Medicare or Medicaid patient unless the operator explicitly
// overrides with a documented rationale, because the inducement analysis
// is genuinely different for them and should involve his lawyer, not a
// checkbox.
//
// ---------------------------------------------------------------------
// THIS IS NOT LEGAL ADVICE
// ---------------------------------------------------------------------
// The structure here is the defensible one and the citations are real,
// but membership models are state-regulated and fact-specific. The
// numbers and the copy are a starting point for his healthcare attorney
// to review, and `COMPLIANCE_REVIEW` below is surfaced in the admin UI so
// that never becomes invisible.
// =====================================================================

export const MEMBERSHIP_VERSION = "membership-v1-2026-08-13";

export const COMPLIANCE_REVIEW = [
    {
        topic: "Not insurance",
        note: "Membership buys access and convenience, never medical services. It must not be marketed as covering care, and the agreement should say so in its first paragraph.",
        cite: "State insurance codes (IL 215 ILCS 5/; CA Ins. Code) — a promise to pay for or provide future medical services for a fixed periodic fee can constitute insurance.",
    },
    {
        topic: "Federal beneficiaries",
        note: "Medicare and Medicaid patients are excluded by default. Offering them something of value that could influence where they seek care is the classic inducement fact pattern.",
        cite: "42 U.S.C. §1320a-7a(a)(5); OIG Advisory Opinions on concierge fees.",
    },
    {
        topic: "No duplicate billing",
        note: "No benefit may be a service that is also billed to a payer. Each benefit is tagged covered_service:false and the tier fails validation otherwise.",
        cite: "Payer participation agreements generally prohibit charging members for covered services.",
    },
    {
        topic: "Commercial contract terms",
        note: "Some commercial contracts restrict any additional patient charge. Each participating payer contract should be read before enrolling that plan's members.",
        cite: "Individual payer participation agreements.",
    },
    {
        topic: "Refunds",
        note: "Monthly terms with cancellation at any time and a pro-rata refund of unused prepaid months materially reduces the 'prepaid medical services' characterisation risk.",
        cite: null,
    },
];

// ---------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------
// Prices are anchored to what the tier COSTS HIM IN TIME, not to what a
// competitor charges — see `unitEconomics()`. Every one is monthly-term
// and cancellable, deliberately.
//
// EVERY BENEFIT SPLITS ITS TIME TWO WAYS, and this is the whole reason
// the model closes. `physician_minutes` is time only he can spend — the
// pre-operative conversation, the judgement in a reply. `automated_minutes`
// is work the system does: the AI drafts the message, assembles the
// recovery roadmap, chases the outside records, fires the check-ins.
//
// The first version of this file costed every minute at his hourly rate
// and every tier came out deeply unprofitable. That was not a pricing
// error, it was a modelling error: it priced a practice with no
// automation, which is precisely the practice he is not building. Twenty
// minutes of patient messaging is not twenty minutes of surgeon time when
// the surgeon is reviewing a draft rather than composing from scratch.
//
// Keeping the two apart also makes the automation's value legible: the
// admin console can show what the programme would cost without it, which
// is the honest argument for having built any of this.

export const TIERS = [
    {
        key: "standard",
        name: "Standard",
        price_month: 0,
        price_year: 0,
        tagline: "Use your insurance. Pay this practice nothing.",
        summary: "This is the ordinary arrangement, and for most patients it is the right one. You see Dr. Mabini as a patient of the practice, your visits and procedures are billed to your health plan, and you pay your plan's copay, coinsurance and deductible — nothing else. There is no membership fee and never will be. The paid tiers below add things insurance does not cover; they do not add care, and they do not change what your plan pays.",
        benefits: [
            { label: "Patient portal, records and visit summaries", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            // Zero physician minutes ON PURPOSE. AI triages; anything that
            // needs his judgement escalates into a patient-initiated online
            // digital E/M (CPT 99421-99423), which is BILLABLE. Absorbing it
            // as a free perk would turn covered work into unpaid work.
            { label: "Secure messaging about your existing care", covered_service: false, physician_minutes: 0, automated_minutes: 10 },
            { label: "Online scheduling", covered_service: false, physician_minutes: 0, automated_minutes: 2 },
            { label: "Your visits, procedures and surgery billed to your health plan", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            { label: "No membership fee, and no charge from this practice beyond your plan's cost-sharing", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
        ],
        capacity_weight: 0,
    },
    {
        key: "navigator",
        name: "Navigator",
        price_month: 59,
        price_year: 590,
        tagline: "Keep your doctor. Walk in prepared.",
        insurance_note: "Nothing here changes your insurance. You keep your own OB/GYN and your health plan is billed by them, exactly as it is now — this practice bills your plan nothing at all for Navigator. The fee buys preparation documents, which have no billing code and are never claimed from anyone.",
        summary: "For the patient who already has an OB/GYN and does not want to change — they want the fifteen minutes they get to actually count. Before every appointment, with any clinician, a preparation pack built from your own history.",
        // The economically important tier: ZERO physician minutes, so the
        // panel has no ceiling. This is the only thing here that scales.
        benefits: [
            { label: "A symptom timeline, in date order, on one page you can hand over",
              covered_service: false, physician_minutes: 0, automated_minutes: 25 },
            { label: "Questions worth asking, drawn from your own history",
              covered_service: false, physician_minutes: 0, automated_minutes: 15 },
            { label: "An index of your records — what exists, when, and what your doctor may not have seen",
              covered_service: false, physician_minutes: 0, automated_minutes: 12 },
            { label: "Plain-language explanations of the words on your own reports",
              covered_service: false, physician_minutes: 0, automated_minutes: 8 },
            { label: "After-visit capture, folded back in so the next visit starts where the last one ended",
              covered_service: false, physician_minutes: 0, automated_minutes: 10 },
        ],
        capacity_weight: 0,
        // Stated on the tier itself so it survives into every rendering.
        scope_note: "Preparation tools only. No diagnosis, no interpretation of results, no treatment advice — those are your own doctor's to give.",
    },
    {
        key: "priority",
        name: "Priority",
        price_month: 199,
        price_year: 1990,         // two months free — improves cash and retention
        tagline: "Reach him directly, and get more of his time.",
        insurance_note: "Your visits, procedures and surgery are still billed to your health plan, unchanged. This fee buys access and time — things insurance does not cover. While your membership is active, the practice is BLOCKED in software from billing your plan for the messaging your fee already covers, so it cannot be paid for twice.",
        summary: "For patients managing something ongoing — endometriosis, fibroids, chronic pelvic pain, menopause — where the value is continuity and access rather than more procedures.",
        benefits: [
            { label: "Everything in Navigator — preparation packs for visits with any of your clinicians",
              covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            // AI drafts in his voice; he reviews and sends. That is the
            // difference between 20 minutes and 4.
            { label: "Direct asynchronous messaging with Dr. Mabini, answered within one business day",
              covered_service: false, physician_minutes: 4, automated_minutes: 18 },
            // The only benefit that is irreducibly his: a longer room.
            { label: "Extended 45-minute consultations instead of the standard slot",
              covered_service: false, physician_minutes: 6, automated_minutes: 0 },
            { label: "Appointments within two weeks, held open for members",
              covered_service: false, physician_minutes: 0, automated_minutes: 2 },
            { label: "Care coordination — imaging, labs and outside records chased on your behalf",
              covered_service: false, physician_minutes: 1, automated_minutes: 12 },
            { label: "An annual written symptom review and plan you can take to any other clinician",
              covered_service: false, physician_minutes: 2, automated_minutes: 8 },
        ],
        capacity_weight: 1,
    },
    {
        key: "complete",
        name: "Complete",
        price_month: 449,
        price_year: 4490,         // two months free
        tagline: "Someone is actually watching the whole picture.",
        insurance_note: "Your visits, procedures and surgery are still billed to your health plan, unchanged. This fee buys access, time and coordination. While your membership is active, the practice is BLOCKED in software from billing your plan for the messaging, review sessions and care coordination your fee already covers.",
        summary: "For complex or long-running disease — deep endometriosis, recurrent fibroids, pelvic pain that has already been through three clinicians. Quarterly reviews, a written second opinion on your existing records, and symptom tracking he actually reads.",
        benefits: [
            { label: "Everything in Priority", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            // Quarterly video review, amortised across the year. Delivered
            // wherever he is — this is deliberately office-independent.
            // 40 minutes a quarter, amortised monthly. More room than a
            // normal visit is the single most legible thing a member buys.
            { label: "A 40-minute video review every quarter to go through where things stand",
              covered_service: false, physician_minutes: 13, automated_minutes: 6 },
            { label: "A written second opinion on the records and imaging you already have",
              covered_service: false, physician_minutes: 4, automated_minutes: 16 },
            { label: "Symptom tracking with trends summarised and read before every contact",
              covered_service: false, physician_minutes: 2, automated_minutes: 20 },
            { label: "Direct coordination with your other clinicians, in writing",
              covered_service: false, physician_minutes: 2, automated_minutes: 14 },
            { label: "Your questions answered the same business day",
              covered_service: false, physician_minutes: 0, automated_minutes: 8 },
        ],
        capacity_weight: 2,
    },
];

export function tier(key) {
    return TIERS.find((t) => t.key === String(key || "").toLowerCase()) || null;
}

// ---------------------------------------------------------------------
// Legality validation — run in tests, and at render time
// ---------------------------------------------------------------------

/**
 * A tier is only lawful in this structure if NOTHING it sells is a
 * covered medical service. This is the check that stops "includes your
 * annual visit" being added to a marketing page a year from now.
 */
export function validateTierLegality(t) {
    const problems = [];
    if (!t) return { ok: false, problems: ["no such tier"] };

    for (const b of t.benefits || []) {
        if (b.covered_service) {
            problems.push(`"${b.label}" is a covered medical service. Selling it as a membership benefit risks being characterised as insurance and, for a payer-covered patient, as duplicate billing.`);
        }
    }
    // Language that would recharacterise the offer regardless of intent.
    const text = `${t.name} ${t.tagline} ${t.summary} ${(t.benefits || []).map((b) => b.label).join(" ")}`.toLowerCase();
    for (const [pattern, why] of [
        [/\bcovers? (your )?(surgery|procedure|operation|visit|care|treatment)\b/, "promises to cover a medical service"],
        [/\bfree (surgery|procedure|visit|consult)/, "promises a free covered service"],
        [/\bunlimited visits\b/, "promises unlimited covered services"],
        [/\bno (co-?pay|deductible)\b/, "promises to absorb a patient's cost-sharing"],
    ]) {
        if (pattern.test(text)) problems.push(`Wording ${why} — that is the insurance characterisation risk.`);
    }
    return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------

export const FEDERAL_PAYERS = new Set(["medicare", "medicaid", "tricare", "champva"]);

/**
 * May this patient be offered a paid tier?
 *
 * @param payerKind 'commercial'|'medicare'|'medicaid'|'self_pay'|...
 * @returns {{eligible, reason, requires_override, disclosures:[]}}
 */
export function eligibility({ payerKind = "commercial", tierKey = "priority", override = null } = {}) {
    const t = tier(tierKey);
    if (!t) return { eligible: false, reason: `unknown tier: ${tierKey}`, requires_override: false, disclosures: [] };
    if (t.price_month === 0) {
        return { eligible: true, reason: "the free tier is available to everyone", requires_override: false, disclosures: [] };
    }

    const kind = String(payerKind || "").toLowerCase();

    if (FEDERAL_PAYERS.has(kind)) {
        if (!override || !override.rationale || !override.approved_by) {
            return {
                eligible: false,
                requires_override: true,
                reason: `${kind[0].toUpperCase()}${kind.slice(1)} patients are excluded from paid membership by default. Offering something of value to a federal beneficiary is the classic inducement fact pattern (42 U.S.C. §1320a-7a(a)(5)). If there is a considered reason to proceed, it needs your attorney's sign-off recorded here — not a checkbox.`,
                disclosures: [],
            };
        }
        return {
            eligible: true,
            requires_override: false,
            reason: `Enrolled under a recorded override by ${override.approved_by}.`,
            disclosures: [
                "This patient is a federal healthcare beneficiary. The membership must include no covered service and no waiver of cost-sharing.",
            ],
        };
    }

    return {
        eligible: true,
        requires_override: false,
        reason: "Commercial and self-pay patients may enrol.",
        disclosures: [
            "Membership is not insurance and does not pay for medical care.",
            "Your visits and procedures continue to be billed to your health plan in the ordinary way.",
            "You may cancel at any time; unused prepaid months are refunded pro rata.",
        ],
    };
}

// ---------------------------------------------------------------------
// Unit economics — is this actually profitable?
// ---------------------------------------------------------------------
// The number that decides a membership programme is not the price. It is
// how many minutes of the physician's week it consumes, because he is a
// solo operator and his time is the entire supply side. A tier priced
// above its time cost still destroys the practice if enough people buy it
// to crowd out the operating schedule.

export const DEFAULT_ASSUMPTIONS = {
    // What an hour of HIS time is worth if spent on the alternative —
    // seeing patients who generate professional fees. Conservative on
    // purpose; override in the admin console with real figures.
    opportunity_cost_per_hour: 400,
    // What an hour of AUTOMATED work costs: AI tokens, and the sliver of
    // his attention spent approving. Nowhere near his hourly rate, which
    // is the entire economic argument for building the automation.
    automated_cost_per_hour: 12,
    // Payment processing.
    processing_pct: 0.029,
    processing_fixed: 0.30,
    // How many hours a week he is willing to give the membership
    // programme IN HIS OWN TIME, before it starts eating operating or
    // clinic hours. Automated minutes do not count against this.
    weekly_capacity_hours: 6,
};

function tierMinutes(t) {
    const b = t?.benefits || [];
    return {
        physician: b.reduce((s, x) => s + (x.physician_minutes || 0), 0),
        automated: b.reduce((s, x) => s + (x.automated_minutes || 0), 0),
    };
}

/**
 * Per-member economics for one tier.
 *
 * Physician minutes are the expensive, capacity-constrained input.
 * Automated minutes cost almost nothing and, crucially, do not consume
 * his week. Reporting both is what makes the pricing defensible rather
 * than optimistic.
 */
export function unitEconomics(tierKey, assumptions = {}) {
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const t = tier(tierKey);
    if (!t) return null;

    const own = tierMinutes(t);
    // "Everything in Priority" is a real cost, not a free line.
    // Inheritance chain: Complete <- Priority <- Navigator. "Everything in
    // X" is a real cost, not a free line on a marketing page.
    const INHERITS = { priority: ["navigator"], complete: ["navigator", "priority"] };
    const inherited = (INHERITS[t.key] || []).reduce((acc, k) => {
        const m = tierMinutes(tier(k));
        return { physician: acc.physician + m.physician, automated: acc.automated + m.automated };
    }, { physician: 0, automated: 0 });
    const physician = own.physician + inherited.physician;
    const automated = own.automated + inherited.automated;

    const physicianCost = (physician / 60) * a.opportunity_cost_per_hour;
    const automatedCost = (automated / 60) * a.automated_cost_per_hour;
    const timeCost = physicianCost + automatedCost;
    const processing = t.price_month > 0
        ? t.price_month * a.processing_pct + a.processing_fixed
        : 0;
    const margin = t.price_month - timeCost - processing;
    const marginPct = t.price_month > 0 ? margin / t.price_month : 0;

    const breakeven = t.price_month > 0
        ? (timeCost + a.processing_fixed) / (1 - a.processing_pct)
        : 0;

    // What this tier would cost with no automation at all — every minute
    // his. The honest argument for having built the AI layer.
    const costWithoutAutomation = ((physician + automated) / 60) * a.opportunity_cost_per_hour;

    let verdict;
    if (t.price_month === 0) {
        verdict = margin >= -1
            ? "Free tier — costs essentially nothing because it is fully automated. It exists to make the paid tiers legible by contrast."
            : `Free tier is costing $${Math.abs(margin).toFixed(0)}/member/month of your own time. Automate more of it or trim it.`;
    } else if (margin < 0) {
        verdict = `LOSS of $${Math.abs(margin).toFixed(0)}/member/month. Price it at $${Math.ceil(breakeven)} or move more of the work to automation.`;
    } else if (marginPct < 0.35) {
        verdict = `Thin — ${(marginPct * 100).toFixed(0)}% margin. Works only at volume, which a solo practice does not have.`;
    } else {
        verdict = `Healthy — ${(marginPct * 100).toFixed(0)}% margin, $${margin.toFixed(0)} per member per month.`;
    }

    return {
        tier: t.key, name: t.name,
        price_month: t.price_month,
        physician_minutes: physician,
        automated_minutes: automated,
        minutes_month: physician + automated,
        physician_cost: round2(physicianCost),
        automated_cost: round2(automatedCost),
        time_cost: round2(timeCost),
        processing: round2(processing),
        gross_margin: round2(margin),
        margin_pct: round2(marginPct),
        breakeven_price: Math.ceil(breakeven),
        cost_without_automation: round2(costWithoutAutomation),
        automation_saving: round2(costWithoutAutomation - timeCost),
        verdict,
    };
}

/**
 * The question that actually matters for a solo surgeon: how many members
 * can he carry before the programme eats the operating schedule? Only
 * PHYSICIAN minutes count — automated work scales without him.
 */
export function capacity(mix = {}, assumptions = {}) {
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const monthlyMinutes = a.weekly_capacity_hours * 60 * 4.33;

    let usedMinutes = 0, revenue = 0, cost = 0, saved = 0;
    const lines = [];
    for (const [key, count] of Object.entries(mix)) {
        const e = unitEconomics(key, a);
        if (!e || !count) continue;
        usedMinutes += e.physician_minutes * count;
        revenue += e.price_month * count;
        cost += (e.time_cost + e.processing) * count;
        saved += e.automation_saving * count;
        lines.push({ tier: key, count, physician_minutes: e.physician_minutes * count,
                     revenue: e.price_month * count });
    }

    const util = monthlyMinutes > 0 ? usedMinutes / monthlyMinutes : 0;
    const warnings = [];
    if (util > 1) {
        warnings.push(`This mix needs ${Math.round(usedMinutes / 60)} hours a month of YOUR time but you have budgeted ${Math.round(monthlyMinutes / 60)}. Something gives — and for a solo surgeon it is usually the operating schedule.`);
    } else if (util > 0.8) {
        warnings.push(`At ${(util * 100).toFixed(0)}% of your budgeted membership time. Stop enrolling before you are full, not after — a member you cannot serve is worse than one you never sold.`);
    }

    return {
        lines,
        monthly_revenue: round2(revenue),
        monthly_cost: round2(cost),
        monthly_margin: round2(revenue - cost),
        annual_margin: round2((revenue - cost) * 12),
        automation_saving_month: round2(saved),
        minutes_used: Math.round(usedMinutes),
        minutes_budgeted: Math.round(monthlyMinutes),
        utilisation: round2(util),
        warnings,
    };
}

/**
 * The largest membership panel he can carry at a given mix ratio, and
 * what it earns. Answers "what is this programme worth if it works?"
 */
export function maxPanel({ priorityShare = 0.75 } = {}, assumptions = {}) {
    const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
    const p = unitEconomics("priority", a);
    const s = unitEconomics("complete", a);
    const perMember = p.physician_minutes * priorityShare + s.physician_minutes * (1 - priorityShare);
    const monthlyMinutes = a.weekly_capacity_hours * 60 * 4.33;
    const members = Math.floor(monthlyMinutes / perMember);

    const priority = Math.round(members * priorityShare);
    const mix = { priority, complete: members - priority };
    return { members, mix, ...capacity(mix, a) };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------
// The evidence, and the honest comparison
// ---------------------------------------------------------------------
// A membership page that says "better care!" is marketing. A membership
// page that says what the ordinary path actually costs a patient in TIME
// and OUTCOMES, with citations, is an argument.
//
// EVERY FIGURE BELOW IS SOURCED AND WAS VERIFIED AGAINST THE PUBLISHED
// LITERATURE, not recalled. Where a claim is directional rather than
// quantified, it says so. Nothing here asserts that this practice
// produces these outcomes — the evidence describes the PROBLEM the model
// is designed against, which is a different and defensible claim.

export const EVIDENCE = [
    {
        key: "wait_times",
        claim: "The average wait for a new-patient OB/GYN appointment in large US metros is 41.8 days.",
        detail: "Up 33% since 2022 and 79% since 2004, with a reported range of 1 to 231 days.",
        source: "AMN Healthcare, 2025 Survey of Physician Appointment Wait Times",
        url: "https://www.amnhealthcare.com/siteassets/amn-insights/physician/ps-2025-physician-appt-wait-times---wp-v6.pdf",
        year: 2025,
        supports: "Priority's two-week scheduling commitment is measured against a real and worsening baseline, not an invented one.",
    },
    {
        key: "diagnostic_delay",
        claim: "Mean diagnostic delay for endometriosis is 6.8 years.",
        detail: "Reported range across studies 1.5-11.4 years. Delay is associated with greater symptom severity, worse quality of life and adverse reproductive outcomes.",
        source: "Time to Diagnose Endometriosis: A Systematic Literature Review (2024)",
        url: "https://pubmed.ncbi.nlm.nih.gov/39373298/",
        year: 2024,
        supports: "The problem is not a single appointment — it is years of fragmented contact. Continuity and a written plan attack that directly.",
    },
    {
        key: "continuity",
        claim: "Higher continuity of care with the same doctor is associated with lower mortality.",
        detail: "In a systematic review of 22 studies, 18 of the high-quality studies found statistically significant mortality reductions with greater continuity. Protective associations were seen with both generalists and specialists. A later review found moderate-certainty evidence for reduced premature mortality and reduced hospital admission.",
        source: "Gray et al., BMJ Open (2018); Primary medical care continuity and patient mortality, BJGP (2020)",
        url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6042583/",
        year: 2018,
        supports: "Continuity is the mechanism the membership actually sells. This is the strongest evidence in the set, and it is associative, not causal.",
        caveat: "Association, not proof of causation. The reviews say so explicitly.",
    },
    // ------------------------------------------------------------------
    // REMOVED 2026-08-14, at the owner's instruction: "don't exploit black
    // women".
    //
    // There was an entry here citing racial disparities in access to
    // minimally invasive hysterectomy as evidence FOR the membership. The
    // finding is real and it matters. Using it to sell a paid tier is not.
    //
    // Its own caveat gave the game away — "this model does not claim to
    // solve structural inequity" — which raises the obvious question of why
    // it was being cited on a pricing page at all. A disparity you are not
    // addressing is not evidence for your product; invoking it borrows the
    // moral weight of someone else's harm to make a $59-a-month tier look
    // principled.
    //
    // This is NOT a decision to stop discussing the disparity. It stays in
    // the clinical education material (education/fibroids/) and in the
    // fellowship curriculum, where a patient or a trainee is being informed
    // rather than sold to. The distinction is the context, not the fact.
    //
    // Do not reinstate it here.
    // ------------------------------------------------------------------
];

/**
 * What the ordinary path looks like, beside what this one does. Framed
 * as a comparison of PROCESS, because that is what a membership actually
 * changes — it does not change the operation.
 */
export const MODEL_COMPARISON = [
    { dimension: "Getting seen",
      traditional: "41.8 days on average for a new OB/GYN appointment, and longer in many markets.",
      here: "Within two weeks, held open for members.",
      evidence: "wait_times" },
    { dimension: "Between visits",
      traditional: "A phone tree, a message that may be answered in several days, or nothing until the next appointment.",
      here: "Direct asynchronous messaging answered within one business day, by him.",
      evidence: null },
    { dimension: "Length of a visit",
      traditional: "A 15-minute slot, often shorter in practice.",
      here: "45 minutes on Priority; a 40-minute video review every quarter on Complete.",
      evidence: null },
    { dimension: "Continuity",
      traditional: "Whoever is available. Records that do not follow you between systems.",
      here: "The same surgeon every time, with your history already read.",
      evidence: "continuity" },
    { dimension: "Complex disease",
      traditional: "Mean 6.8 years to a diagnosis of endometriosis, across multiple clinicians.",
      here: "A written plan you own and can take anywhere, reviewed quarterly.",
      evidence: "diagnostic_delay" },
    { dimension: "Where you have to be",
      traditional: "In the building, during business hours.",
      here: "Virtual-first. Access does not depend on your geography or your ability to take a day off work." },
      // Deliberately uncited. This row used to reference the racial-
      // disparities study, which was removed on 2026-08-14 — see EVIDENCE.
      // The row stands on its own: virtual-first access is a plain
      // description of how the practice works, and it does not need
      // someone else's harm to justify it.
    { dimension: "Keeping your own doctor",
      traditional: "A second opinion means starting over somewhere else, or nothing.",
      here: "You keep your OB/GYN. Navigator prepares you for the visits you already have — a subspecialist organising your history so the fifteen minutes count.",
      evidence: "diagnostic_delay" },
    { dimension: "What it costs",
      traditional: "Your insurance is billed. Access is not something you can buy at any price.",
      here: "Your insurance is still billed exactly the same. The membership buys access, never care.",
      evidence: null },
];

// ---------------------------------------------------------------------
// Value — what a member would otherwise pay for the same access
// ---------------------------------------------------------------------
// The point is not that the membership is cheap. It is that the access it
// contains, bought piecemeal at ordinary self-pay rates, costs more than
// the membership does. `REFERENCE_PRICES` are conservative self-pay rates
// for a subspecialist and should be reviewed against his own fee schedule
// before the numbers are published.

export const REFERENCE_PRICES = {
    visit_prep_pack: 85,             // what a patient advocate charges to prepare one visit
    extended_consult_45min: 375,     // self-pay subspecialist, extended visit
    video_review_40min: 325,
    written_second_opinion: 450,
    async_message_exchange: 45,      // per exchange, cf. online digital E/M
    care_coordination_hour: 120,
    written_care_plan: 200,
};

/**
 * What one month of a tier would cost a la carte, and how that compares
 * with the price. Every line is labelled so the patient-facing page can
 * show the arithmetic rather than assert a number.
 */
export function valueComparison(tierKey, prices = {}) {
    const P = { ...REFERENCE_PRICES, ...prices };
    const t = tier(tierKey);
    if (!t) return null;

    const LINES = {
        priority: [
            { label: "Extended 45-minute consultation", qty: 1 / 3, unit: P.extended_consult_45min,
              note: "roughly one every three months" },
            { label: "Direct message exchanges with the surgeon", qty: 3, unit: P.async_message_exchange },
            { label: "Care coordination", qty: 0.4, unit: P.care_coordination_hour,
              note: "records, imaging and labs chased on your behalf" },
            { label: "Annual written symptom review and plan", qty: 1 / 12, unit: P.written_care_plan },
        ],
        complete: [
            { label: "Everything in Priority", qty: 1, unit: null, inherit: "priority" },
            { label: "40-minute video review", qty: 1 / 3, unit: P.video_review_40min,
              note: "every quarter" },
            { label: "Written second opinion on your existing records", qty: 1 / 12, unit: P.written_second_opinion },
            { label: "Symptom tracking reviewed before every contact", qty: 0.5, unit: P.care_coordination_hour },
            { label: "Coordination with your other clinicians", qty: 0.3, unit: P.care_coordination_hour },
        ],
        navigator: [
            { label: "Visit preparation packs", qty: 1.2, unit: P.visit_prep_pack,
              note: "typically one appointment a month across all your clinicians" },
            { label: "Symptom timeline, kept current", qty: 0.2, unit: P.care_coordination_hour },
            { label: "Records index — what exists and who has seen it", qty: 0.15, unit: P.care_coordination_hour },
            { label: "Plain-language explanation of your own reports", qty: 0.15, unit: P.care_coordination_hour },
            { label: "After-visit capture, folded back into your history", qty: 0.1, unit: P.care_coordination_hour },
        ],
        standard: [],
    };
    LINES.priority = [{ label: "Everything in Navigator", qty: 1, unit: null, inherit: "navigator" }, ...LINES.priority];

    const rows = [];
    let total = 0;
    for (const line of LINES[t.key] || []) {
        if (line.inherit) {
            const inner = valueComparison(line.inherit, prices);
            rows.push({ label: line.label, amount: round2(inner.alacarte_total), note: "at the Priority rate" });
            total += inner.alacarte_total;
            continue;
        }
        const amount = line.qty * line.unit;
        rows.push({ label: line.label, amount: round2(amount), note: line.note || null });
        total += amount;
    }

    const price = t.price_month;
    return {
        tier: t.key, name: t.name, price_month: price,
        rows,
        alacarte_total: round2(total),
        saving: round2(total - price),
        ratio: price > 0 ? round2(total / price) : 0,
        headline: price > 0 && total > price
            ? `About $${Math.round(total)} of access for $${price} a month.`
            : null,
    };
}

/**
 * How this sits against the concierge market, so the price is anchored to
 * something real rather than to how it feels.
 */
export const MARKET_ANCHOR = {
    concierge_median_year: 3200,
    concierge_monthly_typical: [250, 400],
    source: "Concierge medicine pricing surveys, 2025-2026",
    note: "Those figures are for PRIMARY care, which is a broader but shallower offer. A fellowship-trained subspecialist sits at or above the top of that band; Priority deliberately sits below it, because the first job is to fill the panel.",
};

// ---------------------------------------------------------------------
// Self-pay — a separate answer to a separate question
// ---------------------------------------------------------------------
// Membership is for insured patients who want more access. Self-pay is
// for the uninsured, who want to know the price before they say yes.
// Conflating them is how practices end up accidentally selling insurance.

export const SELF_PAY_PRINCIPLES = [
    "Quote one all-in number covering the surgeon's fee, and say plainly what it excludes — facility and anaesthesia are billed separately by them, not by this practice.",
    "Quote before scheduling, in writing, and honour it for 90 days.",
    "Bundle the global period: pre-operative visit, the operation, and 90 days of post-operative care in one price, so recovery never generates a surprise bill.",
    "Publish the price. A number a patient has to phone for is a number they assume is bad.",
    "Keep the self-pay price independent of the membership price. They answer different questions and bundling them invites the insurance characterisation.",
];

export default {
    MEMBERSHIP_VERSION, TIERS, tier, COMPLIANCE_REVIEW,
    validateTierLegality, eligibility, FEDERAL_PAYERS,
    DEFAULT_ASSUMPTIONS, unitEconomics, capacity, maxPanel,
    SELF_PAY_PRINCIPLES,
    EVIDENCE, MODEL_COMPARISON, REFERENCE_PRICES, valueComparison, MARKET_ANCHOR,
};
