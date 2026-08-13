// credentialing_wizard.js — turn a verified payer research record into an
// actionable, trackable enrollment plan.
//
// DOCTRINE (2026-08-12): this wizard NEVER asserts a requirement the payer does
// not publish. The research records carry an `unverified_claims` list precisely
// because payer sites omit things everyone "knows" — BCBSIL, for example,
// publishes a supporting-document checklist ONLY for ancillary/facility
// providers, not for physicians. A wizard that silently printed "upload your
// W-9, DEA, COI" as though BCBSIL required it would be inventing requirements.
//
// So unverified items become EXPLICIT "confirm" tasks, visibly separated from
// sourced steps. The physician sees exactly which instructions are the payer's
// own words (with the URL) and which are prudent-but-unconfirmed preparation.
//
// The wizard also refuses to fabricate a timeline: if the payer publishes no
// turnaround, the plan says so rather than showing an invented ETA.

export const TASK_KIND = {
    PREREQ: "prerequisite",     // must be true before applying
    STEP: "step",               // a published step in the payer's process
    CONFIRM: "confirm",         // unverified — the physician must confirm with the payer
    OPERATE: "operate",         // post-approval operating requirement
};

const OPERATE_HINTS = [
    "operate under", "file all", "identify the member", "do not see",
    "verify eligibility", "register with availity",
];

/** Heuristic split so post-approval operating guidance isn't shown as an application step. */
function kindForStep(step) {
    const s = `${step.step || ""} ${step.detail || ""}`.toLowerCase();
    return OPERATE_HINTS.some((h) => s.includes(h)) ? TASK_KIND.OPERATE : TASK_KIND.STEP;
}

/**
 * Build the enrollment plan for one payer record.
 * @param {object} rec  a payer record from data/payer_credentialing.json
 * @returns {{payer, tasks, counts, sourced_ratio, turnaround, warnings}}
 */
export function buildPlan(rec) {
    if (!rec || !rec.name) throw new Error("buildPlan: payer record required");
    const tasks = [];
    const warnings = [];
    let seq = 0;

    // 1. Prerequisites first — an application that fails eligibility wastes weeks.
    for (const p of rec.prerequisites || []) {
        const { text, url } = splitCitation(String(p));
        tasks.push({
            seq: ++seq, kind: TASK_KIND.PREREQ, title: trim(text, 160),
            detail: text, source_url: url, sourced: Boolean(url), status: "pending",
        });
    }

    // 2. Published steps, in the payer's own order.
    for (const s of rec.process_steps || []) {
        const url = String(s.source_url || "").trim();
        if (!url) warnings.push(`Unsourced step: "${trim(s.step, 80)}"`);
        tasks.push({
            seq: ++seq, kind: kindForStep(s), title: trim(s.step, 160),
            detail: String(s.detail || ""), source_url: url || null,
            sourced: Boolean(url), status: "pending",
        });
    }

    // 3. Unverified claims become explicit confirmation tasks — never silent
    //    omissions and never presented as payer requirements.
    for (const u of rec.unverified_claims || []) {
        tasks.push({
            seq: ++seq, kind: TASK_KIND.CONFIRM,
            title: "Confirm with payer: " + trim(firstSentence(String(u)), 130),
            detail: String(u), source_url: null, sourced: false, status: "pending",
        });
    }

    const steps = tasks.filter((t) => t.kind === TASK_KIND.STEP || t.kind === TASK_KIND.OPERATE);
    const sourcedSteps = steps.filter((t) => t.sourced).length;

    return {
        payer: {
            name: rec.name,
            category: rec.category || null,
            operates_in_illinois: rec.operates_in_illinois !== false,
            portal: rec.enrollment_portal_url || null,
            contact: rec.contact || null,
            sources: rec.sources || [],
        },
        tasks,
        counts: {
            total: tasks.length,
            prerequisites: tasks.filter((t) => t.kind === TASK_KIND.PREREQ).length,
            steps: steps.length,
            confirm: tasks.filter((t) => t.kind === TASK_KIND.CONFIRM).length,
        },
        sourced_ratio: steps.length ? sourcedSteps / steps.length : 0,
        // Never invent an ETA. Empty string in the record means "not published".
        turnaround: (rec.typical_turnaround || "").trim() ||
            "Not published by this payer — do not promise an effective date.",
        warnings,
    };
}

/** Every URL the plan relies on, for live verification. */
export function planUrls(plan) {
    const set = new Set();
    for (const t of plan.tasks) if (t.source_url) set.add(t.source_url);
    for (const s of plan.payer.sources || []) set.add(s);
    if (plan.payer.portal) set.add(plan.payer.portal);
    return [...set];
}

/** Readiness gate: the application should not be started until prereqs are met. */
export function readiness(plan) {
    const prereqs = plan.tasks.filter((t) => t.kind === TASK_KIND.PREREQ);
    const open = prereqs.filter((t) => t.status !== "done");
    return {
        ready_to_apply: open.length === 0,
        open_prerequisites: open.length,
        blocking: open.map((t) => t.title),
    };
}

function splitCitation(s) {
    const m = s.match(/\((https?:\/\/[^)]+)\)\s*$/);
    if (!m) return { text: s.trim(), url: null };
    return { text: s.slice(0, m.index).trim(), url: m[1].split(/\s*;\s*/)[0].trim() };
}
function firstSentence(s) {
    const i = s.search(/[.;]\s/);
    return i > 20 ? s.slice(0, i) : s;
}
function trim(s, n) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export default { buildPlan, planUrls, readiness, TASK_KIND };
