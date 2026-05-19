// =====================================================================
// functions/_lib/billing_ai_advisor.js — accountant-level narrative
// =====================================================================
// Takes the deterministic KPI bundle from billing_insights.js and
// produces a structured Claude-generated narrative with:
//   - Top 3 observations a CPA would call out
//   - Top 3 recommendations
//   - Tax-prep notes
//   - Risk flags (with severity)
//
// Anthropic call uses claude-sonnet-4-6 (pinned). Falls back to a
// rule-based narrative when ANTHROPIC_API_KEY is absent or the call
// fails — the page still renders something useful, just less rich.
//
// Per CLAUDE.md §0.8: this is NON-CLINICAL content (finance/accounting),
// so general-knowledge Claude usage is permitted. The clinical KB-only
// rule does not apply.
//
// Disclaimer: this function's output ALWAYS includes a "not professional
// tax advice — consult a CPA" line. The frontend renders it prominently.
// =====================================================================

import { callClaude, AnthropicError } from "./anthropic.js";

export const ADVISOR_PROMPT_VERSION = "billing-advisor-v1.0-2026-05-18";
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a senior CPA-level advisor reviewing a sole-practitioner medical practice's billing and accounting data. The practice owner sees this on their admin dashboard.

Your output MUST be a single JSON object with EXACTLY this shape:

{
  "headline": "<one-sentence summary of the period's financial story (<=110 chars)>",
  "observations": [
    { "label": "<short title>", "detail": "<1-2 sentence explanation grounded in the numbers>", "trend": "up|down|flat|neutral" },
    ... 3 to 5 items
  ],
  "recommendations": [
    { "priority": "high|medium|low", "title": "<actionable title>", "rationale": "<why this matters now>", "next_step": "<concrete first action>" },
    ... 3 to 5 items
  ],
  "tax_notes": [
    "<plain-language note about the practice's tax position grounded in YTD numbers>",
    ... 2 to 4 items
  ],
  "risk_flags": [
    { "severity": "warning|critical", "label": "<short label>", "detail": "<why this is a concern>" },
    ... 0 to 3 items (omit if no real risks)
  ]
}

GUIDELINES:
- Be specific. Refer to actual dollar amounts and percentages from the data, not generic advice.
- Sound like a CPA, not a marketing chatbot. Direct, calm, professional.
- If a metric is good, say so plainly. If a metric is concerning, say what to do about it.
- Tax notes should reference Schedule C lines, quarterly estimated tax dates (Apr 15, Jun 15, Sep 15, Jan 15), or SE tax structure where relevant.
- Recommendations must be ACTIONABLE — not "consider monitoring" but "review the 4 invoices over 120 days and decide on collection vs. write-off."
- If the dataset is too thin to meaningfully analyze (e.g., <5 payments), say so in the headline and keep observations brief.
- NEVER include patient names, diagnoses, or PHI. The data you receive is pre-anonymized.
- Output JSON ONLY. No prose preamble, no code fences, no markdown.`;

function buildUserMessage(insights) {
    return [
        "Period:", insights.window, `(${insights.period.from} → ${insights.period.to})`,
        "",
        "CURRENT PERIOD AGGREGATES (cents):",
        JSON.stringify(insights.current, null, 2),
        "",
        "PREVIOUS COMPARABLE PERIOD:",
        JSON.stringify(insights.previous, null, 2),
        "",
        "TREND vs PREVIOUS PERIOD:",
        JSON.stringify(insights.trend, null, 2),
        "",
        "A/R AGING (open invoices):",
        JSON.stringify(insights.ar_aging, null, 2),
        "",
        "DAYS SALES OUTSTANDING:",
        JSON.stringify(insights.dso, null, 2),
        "",
        "TOP SERVICES BY REVENUE (this period):",
        JSON.stringify(insights.top_services, null, 2),
        "",
        "12-MONTH TREND:",
        JSON.stringify(insights.monthly_trend, null, 2),
        "",
        "ANOMALIES DETECTED BY RULES:",
        JSON.stringify(insights.anomalies, null, 2),
        "",
        "YEAR-TO-DATE SCHEDULE C PROJECTION:",
        JSON.stringify(insights.schedule_c_projection, null, 2),
        "",
        "Return the JSON object now. JSON only.",
    ].join("\n");
}

function extractJson(text) {
    if (typeof text !== "string") return null;
    const t = text.trim();
    try { return JSON.parse(t); } catch {}
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(t.slice(start, end + 1)); } catch {}
    }
    return null;
}

// =====================================================================
// Rule-based fallback — used when ANTHROPIC_API_KEY is unset or call
// fails. Less rich but always reliable. Same JSON shape.
// =====================================================================
export function ruleBasedNarrative(i) {
    const cur = i.current;
    const trend = i.trend;
    const ar = i.ar_aging;
    const dso = i.dso;
    const sc = i.schedule_c_projection;
    const observations = [];
    const recommendations = [];
    const tax_notes = [];
    const risk_flags = [];

    // Observations
    observations.push({
        label: "Period revenue",
        detail: `Gross ${money(cur.gross_cents)} across ${cur.payment_count} payment${cur.payment_count === 1 ? "" : "s"} (avg ${money(cur.average_revenue_per_visit_cents)}/visit). Stripe fees ${cur.stripe_fee_pct_of_gross ?? "—"}% of gross.`,
        trend: trend.gross_pct_change == null ? "neutral" : trend.gross_pct_change >= 0 ? "up" : "down",
    });
    if (trend.gross_pct_change != null) {
        observations.push({
            label: "Trend vs. previous comparable window",
            detail: `Revenue is ${trend.gross_pct_change >= 0 ? "up" : "down"} ${Math.abs(trend.gross_pct_change)}% (${money(i.previous.gross_cents)} → ${money(cur.gross_cents)}).`,
            trend: trend.gross_pct_change >= 0 ? "up" : "down",
        });
    }
    if (dso.dso_days != null) {
        observations.push({
            label: "Days Sales Outstanding (DSO)",
            detail: `DSO is ${dso.dso_days} days against an A/R balance of ${money(dso.ar_cents)} on ${money(dso.sales_90d_cents)} of 90-day sales.`,
            trend: dso.dso_days <= 30 ? "up" : dso.dso_days <= 60 ? "flat" : "down",
        });
    }
    observations.push({
        label: "A/R aging",
        detail: `Outstanding receivables: ${money(ar.total_outstanding_cents)}. Current ${money(ar.buckets.current)}, 31-60d ${money(ar.buckets.b30)}, 61-90d ${money(ar.buckets.b60)}, 91-120d ${money(ar.buckets.b90)}, 120+ ${money(ar.buckets.b120plus)}.`,
        trend: ar.buckets.b120plus > 0 ? "down" : "neutral",
    });

    // Recommendations
    if (ar.buckets.b120plus > 0) {
        recommendations.push({
            priority: "high",
            title: "Address 120+ day A/R",
            rationale: `${money(ar.buckets.b120plus)} in receivables aged 120+ days. Likelihood of collection drops sharply past this point.`,
            next_step: "Contact each patient with a payment plan offer, then evaluate write-off if no response in 14 days.",
        });
    }
    if ((cur.stripe_fee_pct_of_gross ?? 0) > 3.5) {
        recommendations.push({
            priority: "medium",
            title: "Stripe fee % is above expected range",
            rationale: `Fees are ${cur.stripe_fee_pct_of_gross}% of gross — typical range for card-not-present healthcare is 2.9–3.2%.`,
            next_step: "Review payment mix; consider ACH/bank-transfer options for larger invoices (Stripe ACH is 0.8% capped at $5).",
        });
    }
    if ((cur.refund_pct_of_gross ?? 0) > 5) {
        recommendations.push({
            priority: "high",
            title: "Elevated refund rate",
            rationale: `Refunds are ${cur.refund_pct_of_gross}% of gross — above typical baseline.`,
            next_step: "Review the refund reasons in the billing event log; recurring patterns may signal a service or pricing issue.",
        });
    }
    if (i.anomalies.some(a => a.kind === "uninvoiced_completed_appointments")) {
        recommendations.push({
            priority: "high",
            title: "Invoice the completed-but-uninvoiced visits",
            rationale: "Completed appointments without an invoice are revenue you've earned but not billed.",
            next_step: "From /admin/billing/invoices/, create invoices for each flagged visit using the service catalog defaults.",
        });
    }
    if (recommendations.length === 0) {
        recommendations.push({
            priority: "low",
            title: "Maintain current cadence",
            rationale: "No urgent issues detected in this period.",
            next_step: "Continue weekly review of A/R and a monthly export to QuickBooks for accounting reconciliation.",
        });
    }

    // Tax notes
    tax_notes.push(`YTD gross receipts: ${money(sc.ytd_gross_cents)}; YTD net (after Stripe fees, before other business expenses): ${money(sc.ytd_net_profit_pre_other_expenses_cents)}.`);
    tax_notes.push(`Estimated YTD self-employment tax: ${money(sc.ytd_se_tax_estimate_cents)} (15.3% on 92.35% of net SE earnings, capped at the Social Security wage base).`);
    tax_notes.push(`Projected quarterly estimated tax payment: ${money(sc.quarterly_estimated_payment_cents)}. Q1 due Apr 15, Q2 Jun 15, Q3 Sep 15, Q4 Jan 15.`);
    tax_notes.push("These are projections — adjust for actual filing status, deductions, and business expenses entered in QuickBooks. Verify with your CPA before remitting estimated taxes.");

    // Risk flags from anomalies
    for (const a of i.anomalies) {
        risk_flags.push({ severity: a.severity === "warning" ? "warning" : "warning", label: a.kind.replace(/_/g, " "), detail: a.message });
    }

    return {
        headline: cur.payment_count === 0
            ? `No payment activity in ${i.window.toLowerCase()} — no insights to generate.`
            : `${i.window}: ${money(cur.gross_cents)} gross across ${cur.payment_count} payments${trend.gross_pct_change != null ? ` (${trend.gross_pct_change >= 0 ? "+" : ""}${trend.gross_pct_change}% vs. prior)` : ""}.`,
        observations: observations.slice(0, 5),
        recommendations: recommendations.slice(0, 5),
        tax_notes: tax_notes.slice(0, 4),
        risk_flags: risk_flags.slice(0, 3),
        ai_used: false,
    };
}

function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

// =====================================================================
// Main entry — call Claude, fall back to rule-based on any failure.
// =====================================================================
export async function generateBillingNarrative(env, insights) {
    if (!env.ANTHROPIC_API_KEY) {
        return { ...ruleBasedNarrative(insights), prompt_version: ADVISOR_PROMPT_VERSION, ai_used: false, reason: "no_api_key" };
    }
    try {
        const raw = await callClaude({
            env,
            model: MODEL,
            max_tokens: 1500,
            temperature: 0.2,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: buildUserMessage(insights) }],
        });
        const parsed = extractJson(raw);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.observations)) {
            throw new Error("invalid_response_shape");
        }
        return {
            ...parsed,
            ai_used: true,
            prompt_version: ADVISOR_PROMPT_VERSION,
            model: MODEL,
        };
    } catch (e) {
        const code = String(e?.message || e);
        console.warn("billing_ai_advisor falling back to rule-based", { error: code });
        return { ...ruleBasedNarrative(insights), prompt_version: ADVISOR_PROMPT_VERSION, ai_used: false, reason: code };
    }
}
