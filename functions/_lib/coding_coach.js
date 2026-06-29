// =====================================================================
// functions/_lib/coding_coach.js — cross-encounter CODING COACH
// =====================================================================
// The MountZaraMedicalTranscription app runs CodingService.analyzeForCoding()
// PER ENCOUNTER and syncs the result here (see api/v1/sync/transcription/
// coding.js): E/M level + MDM, CPT/HCPCS lines + modifiers, ICD-10, a
// 1995/1997 CMS documentation audit, compliance flags, and
// documentation-supported "undercoding" opportunities (each carrying the
// `required_documentation` that would justify the higher level).
//
// What the per-session app CANNOT see is the pattern ACROSS encounters.
// That is this module's job: aggregate the already-synced analysis into a
// coaching view —
//   * where you UNDER-coded relative to what your note documents
//     (recoverable, documentation-supported — NOT speculative upcoding),
//   * the recurring compliance flags / documentation gaps you keep hitting,
//   * the modifiers you keep missing,
//   * your E/M level mix and how often you override the suggested code,
//   * the month-over-month trend (are you improving?),
//   * deterministic, concrete coaching actions.
//
// COMPLIANCE FRAMING (deliberate): every "undercoding" figure here is tied
// to documentation the note ALREADY contains (the app's analysis only flags
// an opportunity when `required_documentation` is satisfiable). This is
// under-coding RECOVERY and a documentation/coding EDUCATION loop — never a
// prompt to bill a level the record does not support. There is intentionally
// no "raise every claim" action.
//
// All inputs are de-identified aggregates (counts, codes, cents) — no PHI —
// so this runs without the §12.2 Anthropic BAA.
// =====================================================================

import { windowRange } from "./billing_insights.js";

const centsToUsd = (c) => Math.round((c || 0)) / 100;

// ---------------------------------------------------------------------
// Pure shaping helpers (no env / no DB) — unit-testable with mock rows.
// ---------------------------------------------------------------------

// E/M level distribution → ordered list with share-of-total.
export function shapeLevelDistribution(rows, totalClaims) {
    const total = totalClaims || rows.reduce((s, r) => s + (r.n || 0), 0) || 0;
    return rows
        .filter((r) => r.em_code)
        .map((r) => ({
            code: r.em_code,
            count: r.n || 0,
            share: total ? +( (r.n || 0) / total ).toFixed(3) : 0,
            avg_medicolegal_score: r.avg_score != null ? Math.round(r.avg_score) : null,
        }))
        .sort((a, b) => b.count - a.count);
}

// Undercoding (documentation-supported) opportunities by current→potential.
export function shapeUndercoding(rows) {
    const pairs = rows.map((r) => ({
        from_code: r.current_code,
        to_code: r.potential_code,
        count: r.n || 0,
        accepted_count: r.accepted_n || 0,
        open_count: (r.n || 0) - (r.accepted_n || 0),
        revenue_delta_usd: centsToUsd(r.rev_delta),
        open_revenue_delta_usd: centsToUsd((r.rev_delta || 0) - (r.accepted_rev || 0)),
        wrvu_delta: +(r.wrvu_delta || 0).toFixed(2),
        avg_confidence: r.avg_conf != null ? +r.avg_conf.toFixed(2) : null,
    }));
    const totals = pairs.reduce(
        (a, p) => ({
            count: a.count + p.count,
            open_count: a.open_count + p.open_count,
            revenue_delta_usd: a.revenue_delta_usd + p.revenue_delta_usd,
            open_revenue_delta_usd: a.open_revenue_delta_usd + p.open_revenue_delta_usd,
            wrvu_delta: a.wrvu_delta + p.wrvu_delta,
        }),
        { count: 0, open_count: 0, revenue_delta_usd: 0, open_revenue_delta_usd: 0, wrvu_delta: 0 },
    );
    return {
        // headline = still-open (not yet accepted/rebilled), documentation-supported
        documented_undercoding_open_usd: +totals.open_revenue_delta_usd.toFixed(2),
        documented_undercoding_total_usd: +totals.revenue_delta_usd.toFixed(2),
        open_opportunity_count: totals.open_count,
        total_opportunity_count: totals.count,
        open_wrvu: +totals.wrvu_delta.toFixed(2),
        top_pairs: pairs.sort((a, b) => b.open_revenue_delta_usd - a.open_revenue_delta_usd).slice(0, 8),
    };
}

// Recurring compliance flags by kind.
export function shapeRecurringFlags(rows, totalClaims) {
    return rows
        .map((r) => ({
            kind: r.flag_kind,
            severity: r.severity,
            count: r.n || 0,
            claims_affected: r.claims_affected || 0,
            share_of_claims: totalClaims ? +((r.claims_affected || 0) / totalClaims).toFixed(3) : 0,
            resolved_count: r.resolved_n || 0,
        }))
        .sort((a, b) => b.count - a.count);
}

const labelForKind = (k) =>
    ({
        missing_modifier: "missing a modifier",
        documentation_gap: "a documentation gap",
        mdm_mismatch: "an MDM level mismatch",
        time_not_documented: "time not documented for a timed service",
        unsupported_level: "a level the note may not support",
        specificity: "an unspecified diagnosis code",
    }[k] || (k ? k.replace(/_/g, " ") : "a coding issue"));

// Deterministic coaching points (the "what you're doing wrong / how to improve").
// Ordered high→low; every action is documentation/coding behavior, never "bill higher blindly".
export function buildCoachingPoints({ totalClaims, undercoding, recurringFlags, modifierMisses, docGaps, overrideRate, levels }) {
    const points = [];

    if (undercoding.documented_undercoding_open_usd >= 1 && undercoding.open_opportunity_count > 0) {
        const top = undercoding.top_pairs[0];
        points.push({
            priority: "high",
            theme: "undercoding-recovery",
            title: `~$${undercoding.documented_undercoding_open_usd.toLocaleString()} in documentation-supported coding not yet captured`,
            detail: `${undercoding.open_opportunity_count} encounter(s) where your note already documents a higher level than was billed`
                + (top ? ` — most commonly ${top.from_code} → ${top.to_code} (${top.open_count}×).` : "."),
            next_step: "Review these in the claim queue; where the note supports it, accept the corrected level (rebill via 837 frequency 7 if still inside timely filing). The app lists the exact documentation already present.",
        });
    }

    const topMod = modifierMisses[0];
    if (topMod && topMod.count >= 2) {
        points.push({
            priority: "high",
            theme: "modifier",
            title: `Modifier repeatedly missing on ${topMod.referenced_code || "procedures"}`,
            detail: `Flagged ${topMod.count}× this period.` + (topMod.example_fix ? ` Fix: ${topMod.example_fix}` : ""),
            next_step: `Add the indicated modifier when billing ${topMod.referenced_code || "this code"} alongside a same-day E/M or bilateral/distinct service.`,
        });
    }

    const topGap = docGaps[0];
    if (topGap && topGap.count >= 2) {
        points.push({
            priority: "medium",
            theme: "documentation",
            title: `Recurring documentation gap: ${topGap.title}`,
            detail: `Seen on ${topGap.claims || topGap.count} encounter(s).` + (topGap.example_fix ? ` ${topGap.example_fix}` : ""),
            next_step: "Add this element to your note template so the supporting documentation is captured at the point of care, not reconstructed later.",
        });
    }

    // E/M mix skew: lots of open undercoding AND the mode level is a low code.
    const mode = levels[0];
    if (mode && undercoding.open_opportunity_count >= Math.max(3, Math.round(totalClaims * 0.15))) {
        points.push({
            priority: "medium",
            theme: "em-mix",
            title: `Your E/M mix skews below what your documentation supports`,
            detail: `Most common billed level is ${mode.code} (${Math.round(mode.share * 100)}% of visits), yet ${undercoding.open_opportunity_count} visits document a higher level.`,
            next_step: "Not a prompt to upcode — a prompt to confirm the level matches the MDM you actually documented (problems addressed · data reviewed · risk).",
        });
    }

    if (overrideRate && overrideRate.rate >= 0.2 && overrideRate.total_lines >= 10) {
        points.push({
            priority: "low",
            theme: "override",
            title: `You override the suggested code on ${Math.round(overrideRate.rate * 100)}% of lines`,
            detail: `${overrideRate.overridden} of ${overrideRate.total_lines} lines changed during review.`,
            next_step: "If overrides cluster on specific code families, that's a signal to refine the note language the analyzer keys on — or a coding pattern worth a CPC's eyes.",
        });
    }

    // A residual "what you're doing wrong" rollup from the top recurring flag if not already covered.
    const topFlag = recurringFlags.find((f) => f.kind !== "missing_modifier" && f.kind !== "documentation_gap");
    if (topFlag && topFlag.count >= 3 && points.length < 5) {
        points.push({
            priority: topFlag.severity === "error" ? "high" : "medium",
            theme: "compliance",
            title: `Recurring flag: ${labelForKind(topFlag.kind)}`,
            detail: `${topFlag.count} occurrence(s) across ${topFlag.claims_affected} claim(s) this period; ${topFlag.resolved_count} resolved.`,
            next_step: "Work these down in the claims queue — unresolved compliance flags are the denials you can prevent before submission.",
        });
    }

    return points.slice(0, 6);
}

// ---------------------------------------------------------------------
// DB-backed aggregation (D1 = env.DB)
// ---------------------------------------------------------------------
export async function computeCodingCoach(env, { window = "ytd" } = {}) {
    const { fromMs, toMs, label } = windowRange(window);
    const db = env.DB;

    const safeAll = async (sql, binds) => {
        try { return (await db.prepare(sql).bind(...binds).all())?.results || []; }
        catch { return []; }
    };
    const safeFirst = async (sql, binds) => {
        try { return await db.prepare(sql).bind(...binds).first(); }
        catch { return null; }
    };

    const totalsRow = await safeFirst(
        `SELECT COUNT(*) n, COALESCE(SUM(total_wrvu),0) wrvu, AVG(medico_legal_score) avg_score
           FROM billing_claims WHERE created_at BETWEEN ? AND ?`,
        [fromMs, toMs],
    );
    const totalClaims = totalsRow?.n || 0;

    const levelRows = await safeAll(
        `SELECT em_code, COUNT(*) n, AVG(medico_legal_score) avg_score
           FROM billing_claims
          WHERE created_at BETWEEN ? AND ? AND em_code IS NOT NULL AND em_code <> ''
          GROUP BY em_code`,
        [fromMs, toMs],
    );

    const undercodeRows = await safeAll(
        `SELECT o.current_code, o.potential_code, COUNT(*) n,
                COALESCE(SUM(o.revenue_delta_cents),0) rev_delta,
                COALESCE(SUM(o.wrvu_delta),0) wrvu_delta,
                SUM(CASE WHEN o.accepted=1 THEN 1 ELSE 0 END) accepted_n,
                COALESCE(SUM(CASE WHEN o.accepted=1 THEN o.revenue_delta_cents ELSE 0 END),0) accepted_rev,
                AVG(o.confidence) avg_conf
           FROM billing_upcoding_opportunities o
           JOIN billing_claims c ON c.id = o.claim_id
          WHERE c.created_at BETWEEN ? AND ?
          GROUP BY o.current_code, o.potential_code`,
        [fromMs, toMs],
    );

    const flagRows = await safeAll(
        `SELECT f.flag_kind, f.severity, COUNT(*) n,
                COUNT(DISTINCT c.id) claims_affected,
                SUM(CASE WHEN f.resolved=1 THEN 1 ELSE 0 END) resolved_n
           FROM billing_compliance_flags f
           JOIN billing_claims c ON c.id = f.claim_id
          WHERE c.created_at BETWEEN ? AND ?
          GROUP BY f.flag_kind, f.severity`,
        [fromMs, toMs],
    );

    const modifierRows = await safeAll(
        `SELECT f.referenced_code, COUNT(*) n, MIN(f.suggested_fix) example_fix
           FROM billing_compliance_flags f
           JOIN billing_claims c ON c.id = f.claim_id
          WHERE c.created_at BETWEEN ? AND ? AND f.flag_kind = 'missing_modifier'
          GROUP BY f.referenced_code ORDER BY n DESC LIMIT 10`,
        [fromMs, toMs],
    );

    const docGapRows = await safeAll(
        `SELECT f.title, COUNT(*) n, COUNT(DISTINCT c.id) claims, MIN(f.suggested_fix) example_fix
           FROM billing_compliance_flags f
           JOIN billing_claims c ON c.id = f.claim_id
          WHERE c.created_at BETWEEN ? AND ? AND f.flag_kind = 'documentation_gap'
          GROUP BY f.title ORDER BY n DESC LIMIT 10`,
        [fromMs, toMs],
    );

    const overrideRow = await safeFirst(
        `SELECT COUNT(*) total_lines,
                SUM(CASE WHEN l.user_override_code IS NOT NULL AND l.user_override_code <> '' THEN 1 ELSE 0 END) overridden
           FROM billing_claim_lines l
           JOIN billing_claims c ON c.id = l.claim_id
          WHERE c.created_at BETWEEN ? AND ?`,
        [fromMs, toMs],
    );

    const trendRows = await safeAll(
        `SELECT strftime('%Y-%m', datetime(c.created_at/1000,'unixepoch')) ym,
                COUNT(DISTINCT c.id) claims,
                COALESCE(SUM(CASE WHEN o.accepted=0 THEN o.revenue_delta_cents ELSE 0 END),0) open_undercode_cents
           FROM billing_claims c
           LEFT JOIN billing_upcoding_opportunities o ON o.claim_id = c.id
          WHERE c.created_at BETWEEN ? AND ?
          GROUP BY ym ORDER BY ym`,
        [fromMs, toMs],
    );

    const levels = shapeLevelDistribution(levelRows, totalClaims);
    const undercoding = shapeUndercoding(undercodeRows);
    const recurringFlags = shapeRecurringFlags(flagRows, totalClaims);
    const modifierMisses = modifierRows.map((r) => ({
        referenced_code: r.referenced_code, count: r.n || 0, example_fix: r.example_fix || null,
    }));
    const docGaps = docGapRows.map((r) => ({
        title: r.title, count: r.n || 0, claims: r.claims || 0, example_fix: r.example_fix || null,
    }));
    const overrideRate = {
        total_lines: overrideRow?.total_lines || 0,
        overridden: overrideRow?.overridden || 0,
        rate: overrideRow?.total_lines ? +(((overrideRow.overridden || 0) / overrideRow.total_lines)).toFixed(3) : 0,
    };
    const trend = trendRows.map((r) => ({
        month: r.ym, claims: r.claims || 0, open_undercoding_usd: centsToUsd(r.open_undercode_cents),
    }));

    const coaching_points = buildCoachingPoints({
        totalClaims, undercoding, recurringFlags, modifierMisses, docGaps, overrideRate, levels,
    });

    return {
        window: { key: window, label, from_ms: fromMs, to_ms: toMs },
        summary: {
            claims_analyzed: totalClaims,
            total_wrvu: +(totalsRow?.wrvu || 0).toFixed(2),
            avg_medicolegal_score: totalsRow?.avg_score != null ? Math.round(totalsRow.avg_score) : null,
            documented_undercoding_open_usd: undercoding.documented_undercoding_open_usd,
            open_opportunity_count: undercoding.open_opportunity_count,
            top_recurring_flag: recurringFlags[0]?.kind || null,
        },
        em_level_distribution: levels,
        undercoding,
        recurring_flags: recurringFlags,
        modifier_misses: modifierMisses,
        documentation_gaps: docGaps,
        override_rate: overrideRate,
        trend,
        coaching_points,
        compliance_note:
            "Every figure here is tied to documentation already in the note. This is under-coding recovery and a documentation/coding education loop — not a prompt to bill a level the record does not support.",
        generated_at: new Date().toISOString(),
    };
}
