// =====================================================================
// /api/v1/admin/membership/interest — who wants this, and what it means
// =====================================================================
// GET  → the waitlist, plus the aggregates that answer the questions the
//        list exists to answer.
// POST { action: "analyze" } → an AI read of the same numbers.
// POST { action: "export" }  → CSV of the list.
//
// THE QUESTIONS THIS IS BUILT TO ANSWER
//   1. Which tier do people actually want? That decides what gets built
//      first, and the answer is frequently not the one the founder
//      expects.
//   2. How much demand sits OUTSIDE Illinois and California? That is the
//      number that decides whether a third licence pays for itself — it
//      is otherwise invisible, because those people simply never book.
//   3. Do they already have an OB/GYN? That is the Navigator thesis. If
//      most signups already have a doctor, the "keep your doctor" tier is
//      the product and the others are the upsell. If most do not, it is
//      the reverse.
//
// THE ARITHMETIC IS DETERMINISTIC. Counts, rates and revenue projections
// are computed in SQL and JavaScript, never by the model. A language
// model asked "how many people signed up in Texas" will occasionally get
// it wrong, and a business decision made on a hallucinated count is worse
// than no analysis. AI reads the FINISHED numbers and comments on them.
//
// PHI: none. This is an email address, a state and a tier — the interest
// endpoint refuses clinical content precisely so this stays true, and so
// this analysis can run without a de-identification step.
// =====================================================================

import { adminRoute, jsonResponse, jsonError, readJsonBody } from "../../../../_lib/admin_api.js";
import { TIERS, tier, unitEconomics, capacity } from "../../../../_lib/membership.js";
import { routeFor, enqueueAiJob } from "../../../../_lib/ai_router.js";
import { licensedStates } from "../../../../_lib/visit_prep.js";

function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

async function rows(env, sql, ...binds) {
    const r = await env.DB.prepare(sql).bind(...binds).all();
    return r?.results || [];
}

async function buildAnalytics(env) {
    const all = await rows(env,
        `SELECT email, tier, state, has_obgyn, note, source, created_at
           FROM membership_interest ORDER BY created_at DESC`);
    const total = all.length;
    const licensed = licensedStates(env);

    const byTier = {};
    const byState = {};
    const bySource = {};
    let hasOb = 0, noOb = 0, unknownOb = 0, outOfState = 0, withNote = 0;

    for (const r of all) {
        byTier[r.tier || "any"] = (byTier[r.tier || "any"] || 0) + 1;
        if (r.state) {
            byState[r.state] = (byState[r.state] || 0) + 1;
            if (!licensed.includes(r.state)) outOfState++;
        }
        bySource[r.source || "unknown"] = (bySource[r.source || "unknown"] || 0) + 1;
        if (r.has_obgyn === "yes") hasOb++;
        else if (r.has_obgyn === "no") noOb++;
        else unknownOb++;
        if (r.note) withNote++;
    }

    // Signups per day, last 30 — enough to see a trend without pretending
    // a handful of points is one.
    const daily = {};
    const cutoff = Date.now() - 30 * 86400000;
    for (const r of all) {
        const t = Date.parse(r.created_at || "");
        if (!Number.isFinite(t) || t < cutoff) continue;
        const d = new Date(t).toISOString().slice(0, 10);
        daily[d] = (daily[d] || 0) + 1;
    }

    // What the list would be worth IF everyone converted, and at a more
    // honest fraction. Both are shown, because the first number is the
    // one people quote and the second is the one that is true.
    const mix = {};
    for (const [k, n] of Object.entries(byTier)) {
        if (k === "any" || k === "standard") continue;
        if (tier(k)) mix[k] = n;
    }
    const anyCount = byTier.any || 0;
    const fullMix = { ...mix };
    // "Not sure yet" gets distributed across the paid tiers in the same
    // proportion as the people who did choose, rather than being ignored
    // (understates) or assigned to the top tier (flatters).
    const chosen = Object.values(mix).reduce((a, b) => a + b, 0);
    if (anyCount && chosen) {
        for (const k of Object.keys(mix)) {
            fullMix[k] = mix[k] + Math.round(anyCount * (mix[k] / chosen));
        }
    }

    const atFull = Object.keys(fullMix).length ? capacity(fullMix, {}) : null;
    const CONVERSION = 0.15;   // waitlist-to-paid, deliberately conservative
    const realistic = {};
    for (const [k, n] of Object.entries(fullMix)) realistic[k] = Math.round(n * CONVERSION);
    const atReal = Object.keys(realistic).some((k) => realistic[k] > 0)
        ? capacity(realistic, {}) : null;

    return {
        total,
        by_tier: byTier,
        by_state: Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([state, n]) => ({
            state, count: n, licensed: licensed.includes(state),
        })),
        by_source: bySource,
        obgyn: {
            has: hasOb, none: noOb, unknown: unknownOb,
            has_pct: pct(hasOb, hasOb + noOb),
            // The Navigator thesis, stated as a testable claim.
            reads: hasOb + noOb === 0 ? "No one has answered yet."
                : hasOb > noOb
                    ? `${pct(hasOb, hasOb + noOb)}% already have an OB/GYN — Navigator is the product, and the others are the upsell.`
                    : `${pct(noOb, hasOb + noOb)}% do NOT have an OB/GYN — they are looking for a doctor, not a navigator. Priority and Complete matter more than the thesis assumed.`,
        },
        geography: {
            licensed_states: licensed,
            out_of_state: outOfState,
            out_of_state_pct: pct(outOfState, total),
            reads: outOfState === 0 ? "No demand recorded outside your licensed states yet."
                : `${outOfState} of ${total} (${pct(outOfState, total)}%) are outside ${licensed.join(" and ")}. Preparation tools reach them; a consultation does not. This is the number that decides whether another licence pays for itself.`,
        },
        daily,
        with_note: withNote,
        projection: {
            conversion_assumed: CONVERSION,
            if_all_converted: atFull ? {
                mix: fullMix,
                monthly_margin: atFull.monthly_margin,
                annual_margin: atFull.annual_margin,
                utilisation: atFull.utilisation,
                warnings: atFull.warnings,
            } : null,
            at_assumed_conversion: atReal ? {
                mix: realistic,
                monthly_margin: atReal.monthly_margin,
                annual_margin: atReal.annual_margin,
                utilisation: atReal.utilisation,
                warnings: atReal.warnings,
            } : null,
            note: "The first figure assumes every person on the list pays, which never happens. The second applies a deliberately conservative 15%. Both use the real capacity model, so a mix that would exceed your available hours says so.",
        },
        economics: TIERS.filter((t) => t.price_month > 0).map((t) => {
            const u = unitEconomics(t.key);
            return { tier: t.key, name: t.name, price_month: t.price_month,
                     margin: u.gross_margin, margin_pct: u.margin_pct,
                     physician_minutes: u.physician_minutes };
        }),
        recent: all.slice(0, 100),
    };
}

function toCsv(list) {
    const head = ["email", "tier", "state", "has_obgyn", "source", "created_at"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [head.join(",")]
        .concat(list.map((r) => head.map((k) => esc(r[k])).join(",")))
        .join("\n");
}

export async function onRequest(ctx) {
    return adminRoute(ctx, async ({ env, request, admin }) => {
        if (!env.DB) return jsonError("D1 not bound", 500);

        if (request.method === "GET") {
            return jsonResponse({ ok: true, ...(await buildAnalytics(env)) });
        }
        if (request.method !== "POST") return jsonError("method_not_allowed", 405);

        const body = await readJsonBody(request);
        const action = String(body?.action || "");

        if (action === "export") {
            const list = await rows(env,
                `SELECT email, tier, state, has_obgyn, source, created_at
                   FROM membership_interest ORDER BY created_at DESC`);
            return new Response(toCsv(list), {
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="membership-interest.csv"`,
                    "Cache-Control": "no-store",
                },
            });
        }

        if (action === "analyze") {
            const a = await buildAnalytics(env);
            if (a.total < 5) {
                return jsonResponse({
                    ok: true, skipped: true,
                    message: `Only ${a.total} signup${a.total === 1 ? "" : "s"} so far. Any read of that is astrology — the numbers below are the honest answer until there are a few dozen.`,
                });
            }

            // The model gets the FINISHED arithmetic and is asked to
            // interpret it. It is never asked to count.
            const prompt = `You are advising a solo fellowship-trained complex benign gynecologic surgeon on a membership programme that has not opened yet. Below is his waitlist, already tallied. The counts are correct — do not recompute them, and do not invent any number that is not here.

TOTAL SIGNUPS: ${a.total}

BY TIER: ${JSON.stringify(a.by_tier)}
Tier economics (his margin per member per month, and the minutes of HIS OWN time each consumes): ${JSON.stringify(a.economics)}

BY STATE: ${JSON.stringify(a.by_state)}
He is licensed in ${a.geography.licensed_states.join(" and ")} only. Outside those states he can sell preparation tools but NOT a clinical consultation.

ALREADY HAS AN OB/GYN: ${JSON.stringify(a.obgyn)}
This matters because the Navigator tier ($59) is built for people who KEEP their existing doctor and consumes none of his time, so it scales without limit. The higher tiers consume his hours and are capped.

SIGNUPS PER DAY (last 30): ${JSON.stringify(a.daily)}

PROJECTION AT 15% CONVERSION: ${JSON.stringify(a.projection.at_assumed_conversion)}

Give him:
1. What this actually says, in three sentences. Lead with the thing that should change a decision.
2. The single strongest signal, and what he should do about it this month.
3. What the data does NOT support — someone will over-read this, so say plainly which conclusions the sample cannot carry.
4. One thing worth asking future signups that is not being asked.

Be direct. He is a surgeon, not a founder — skip the startup vocabulary. If the sample is too small to support a claim, say so rather than hedging your way into one. No bullet padding.`;

            const route = routeFor(env, "membership_analysis");
            if (route === "bridge") {
                const job = await enqueueAiJob(env, {
                    kind: "membership_analysis",
                    payload: { total: a.total, requested_at: new Date().toISOString() },
                    requested_by: admin.user,
                });
                return jsonResponse({
                    ok: true, queued: true, job_id: job.id,
                    message: "Queued for your Claude CLI bridge. The numbers below are live regardless — the AI read is commentary on them, not a source of them.",
                    analytics: a,
                });
            }
            if (route === "blocked") {
                return jsonResponse({ ok: true, unavailable: true,
                    message: "No AI route configured. The numbers below are complete on their own.", analytics: a });
            }

            try {
                const res = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-api-key": env.ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                    },
                    body: JSON.stringify({
                        model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
                        max_tokens: 1200,
                        messages: [{ role: "user", content: prompt }],
                    }),
                });
                if (!res.ok) return jsonResponse({ ok: true, unavailable: true,
                    message: `Model call failed (HTTP ${res.status}). The numbers below stand on their own.`, analytics: a });
                const j = await res.json();
                const text = (j.content || []).map((c) => c.text || "").join("");
                return jsonResponse({ ok: true, analysis: text, analytics: a });
            } catch (e) {
                return jsonResponse({ ok: true, unavailable: true,
                    message: `Model call failed: ${String(e).slice(0, 160)}`, analytics: a });
            }
        }

        return jsonError("unknown_action — expected analyze | export", 400);
    });
}
