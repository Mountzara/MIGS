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
        tagline: "Your insurance, used properly.",
        summary: "No fee. Care is billed to your plan the ordinary way, and you get the portal, your records, secure messaging about your own visits, and online scheduling.",
        benefits: [
            { label: "Patient portal, records and visit summaries", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            // Zero physician minutes ON PURPOSE. AI triages; anything that
            // needs his judgement escalates into a patient-initiated online
            // digital E/M (CPT 99421-99423), which is BILLABLE. Absorbing it
            // as a free perk would turn covered work into unpaid work.
            { label: "Secure messaging about your existing care", covered_service: false, physician_minutes: 0, automated_minutes: 10 },
            { label: "Online scheduling", covered_service: false, physician_minutes: 0, automated_minutes: 2 },
            { label: "Insurance billed directly", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
        ],
        capacity_weight: 0,
    },
    {
        key: "priority",
        name: "Priority",
        price_month: 179,
        price_year: 1790,         // two months free — improves cash and retention
        tagline: "Reach him directly, and get more of his time.",
        summary: "For patients managing something ongoing — endometriosis, fibroids, chronic pelvic pain, menopause — where the value is continuity and access rather than more procedures.",
        benefits: [
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
        key: "surgical",
        name: "Surgical Concierge",
        price_month: 649,
        price_year: 6490,
        tagline: "The months around an operation, handled.",
        summary: "For patients going through surgery. The operation itself is billed to your insurance exactly as always — this covers everything around it that insurance does not pay for and most practices therefore do not do.",
        benefits: [
            { label: "Everything in Priority", covered_service: false, physician_minutes: 0, automated_minutes: 0 },
            // Irreducible: this is the conversation that makes the rest work.
            { label: "A pre-operative session covering what will happen, in plain language, with time for questions",
              covered_service: false, physician_minutes: 18, automated_minutes: 5 },
            { label: "A written recovery roadmap — what is normal, what is not, and when to call",
              covered_service: false, physician_minutes: 3, automated_minutes: 14 },
            { label: "Direct access for 90 days after surgery, including evenings and weekends",
              covered_service: false, physician_minutes: 9, automated_minutes: 22 },
            { label: "Proactive check-ins at 48 hours, one week and one month",
              covered_service: false, physician_minutes: 3, automated_minutes: 18 },
            { label: "Coordination with your referring doctor and any other specialists",
              covered_service: false, physician_minutes: 2, automated_minutes: 14 },
        ],
        capacity_weight: 2.5,
        // Most surgical patients want this for a defined window, not forever.
        alt_package: {
            label: "90-day perioperative package",
            price_once: 1795,
            note: "One payment covering the pre-operative session through 90 days after surgery, for patients who do not want an ongoing membership.",
        },
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
    const inherited = t.key === "surgical" ? tierMinutes(tier("priority")) : { physician: 0, automated: 0 };
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
    const s = unitEconomics("surgical", a);
    const perMember = p.physician_minutes * priorityShare + s.physician_minutes * (1 - priorityShare);
    const monthlyMinutes = a.weekly_capacity_hours * 60 * 4.33;
    const members = Math.floor(monthlyMinutes / perMember);

    const priority = Math.round(members * priorityShare);
    const mix = { priority, surgical: members - priority };
    return { members, mix, ...capacity(mix, a) };
}

function round2(n) { return Math.round(n * 100) / 100; }

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
};
