// =====================================================================
// functions/_lib/billing_insights.js — deterministic billing KPIs
// =====================================================================
// Pure-JS, no LLM. Reads D1 billing tables and produces an opinionated
// set of KPIs + anomalies that the AI advisor (billing_ai_advisor.js)
// then narrates with accountant-level recommendations.
//
// Time semantics: all `*_at` columns are ms-epoch; `issue_date` is YYYY-MM-DD.
// Windows: 'mtd', 'qtd', 'ytd', 'l30d', 'l90d', 'l365d'.
// =====================================================================

function nowMs() { return Date.now(); }
function toIso(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function startOfMonthMs() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function startOfQuarterMs() {
    const d = new Date();
    const qStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
    return Date.UTC(d.getUTCFullYear(), qStartMonth, 1);
}
function startOfYearMs() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), 0, 1);
}
function daysAgoMs(days) { return nowMs() - days * 86400000; }

export function windowRange(window) {
    const now = nowMs();
    switch (window) {
        case "mtd":   return { fromMs: startOfMonthMs(),    toMs: now, label: "Month-to-date" };
        case "qtd":   return { fromMs: startOfQuarterMs(),  toMs: now, label: "Quarter-to-date" };
        case "ytd":   return { fromMs: startOfYearMs(),     toMs: now, label: "Year-to-date" };
        case "l30d":  return { fromMs: daysAgoMs(30),       toMs: now, label: "Last 30 days" };
        case "l90d":  return { fromMs: daysAgoMs(90),       toMs: now, label: "Last 90 days" };
        case "l365d": return { fromMs: daysAgoMs(365),      toMs: now, label: "Last 365 days" };
        default:      return { fromMs: startOfMonthMs(),    toMs: now, label: "Month-to-date" };
    }
}

// ---------- Single-window aggregate ----------
async function aggregatePayments(env, fromMs, toMs) {
    const row = await env.DB.prepare(`
        SELECT
            COUNT(*) AS payment_count,
            COALESCE(SUM(gross_amount_cents), 0) AS gross_cents,
            COALESCE(SUM(fee_amount_cents),   0) AS fees_cents,
            COALESCE(SUM(net_amount_cents),   0) AS net_cents
        FROM payments
        WHERE status = 'succeeded' AND captured_at BETWEEN ? AND ?
    `).bind(fromMs, toMs).first();
    return {
        payment_count: row?.payment_count || 0,
        gross_cents: row?.gross_cents || 0,
        fees_cents: row?.fees_cents || 0,
        net_cents: row?.net_cents || 0,
    };
}

async function aggregateRefunds(env, fromMs, toMs) {
    const row = await env.DB.prepare(`
        SELECT
            COUNT(*) AS refund_count,
            COALESCE(SUM(amount_cents), 0) AS refunds_cents
        FROM refunds
        WHERE status = 'succeeded' AND initiated_at BETWEEN ? AND ?
    `).bind(fromMs, toMs).first();
    return {
        refund_count: row?.refund_count || 0,
        refunds_cents: row?.refunds_cents || 0,
    };
}

// ---------- A/R aging (open invoices grouped by age bucket) ----------
async function aging(env) {
    const now = nowMs();
    const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b120plus: 0 };
    const counts  = { current: 0, b30: 0, b60: 0, b90: 0, b120plus: 0 };
    const res = await env.DB.prepare(`
        SELECT id, issue_date, total_cents, amount_paid_cents,
               (total_cents - amount_paid_cents) AS balance_cents
        FROM invoices
        WHERE status IN ('sent', 'partially_paid')
          AND (total_cents - amount_paid_cents) > 0
    `).all();
    for (const inv of (res?.results || [])) {
        const issuedMs = new Date(inv.issue_date + "T00:00:00Z").getTime();
        const age = Math.floor((now - issuedMs) / 86400000);
        let key;
        if (age <= 30)  key = "current";
        else if (age <= 60)  key = "b30";
        else if (age <= 90)  key = "b60";
        else if (age <= 120) key = "b90";
        else key = "b120plus";
        buckets[key] += inv.balance_cents;
        counts[key]  += 1;
    }
    const total = Object.values(buckets).reduce((s, n) => s + n, 0);
    return { buckets, counts, total_outstanding_cents: total };
}

// ---------- Days Sales Outstanding (DSO) ----------
// Standard formula: (Avg Accounts Receivable / Sales per period) * Days
// We use the last 90 days as the sales window.
async function dso(env) {
    const ninetyDays = 90 * 86400000;
    const since = nowMs() - ninetyDays;
    const sales = await env.DB.prepare(`
        SELECT COALESCE(SUM(total_cents), 0) AS sales_cents
        FROM invoices
        WHERE issue_date >= ?
          AND status NOT IN ('draft', 'void')
    `).bind(toIso(since)).first();
    const ar = await env.DB.prepare(`
        SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS ar_cents
        FROM invoices
        WHERE status IN ('sent', 'partially_paid')
    `).first();
    const salesCents = sales?.sales_cents || 0;
    const arCents = ar?.ar_cents || 0;
    const dsoDays = salesCents > 0 ? Math.round((arCents / salesCents) * 90) : null;
    return { dso_days: dsoDays, ar_cents: arCents, sales_90d_cents: salesCents };
}

// ---------- Top services by revenue ----------
async function topServices(env, fromMs, toMs, limit = 10) {
    const res = await env.DB.prepare(`
        SELECT
            COALESCE(i.tax_export_summary, 'Office services') AS category,
            COUNT(p.id) AS payment_count,
            SUM(p.gross_amount_cents) AS gross_cents
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        WHERE p.status = 'succeeded' AND p.captured_at BETWEEN ? AND ?
        GROUP BY category
        ORDER BY gross_cents DESC
        LIMIT ?
    `).bind(fromMs, toMs, limit).all();
    return (res?.results || []).map(r => ({
        category: r.category,
        payment_count: r.payment_count,
        gross_cents: r.gross_cents || 0,
    }));
}

// ---------- Monthly trend ----------
async function monthlyTrend(env, monthsBack = 12) {
    const sinceMs = nowMs() - monthsBack * 31 * 86400000;
    const res = await env.DB.prepare(`
        SELECT
            strftime('%Y-%m', datetime(captured_at/1000, 'unixepoch')) AS month,
            COUNT(*) AS payment_count,
            COALESCE(SUM(gross_amount_cents), 0) AS gross_cents,
            COALESCE(SUM(fee_amount_cents),   0) AS fees_cents,
            COALESCE(SUM(net_amount_cents),   0) AS net_cents
        FROM payments
        WHERE status = 'succeeded' AND captured_at >= ?
        GROUP BY month
        ORDER BY month
    `).bind(sinceMs).all();
    return res?.results || [];
}

// ---------- Anomaly detection ----------
async function detectAnomalies(env) {
    const out = [];
    const now = nowMs();

    // Anomaly 1: >2 refunds in last 30 days (vs. typical low rate)
    const r30 = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM refunds WHERE status='succeeded' AND initiated_at >= ?"
    ).bind(now - 30 * 86400000).first();
    if ((r30?.n || 0) >= 3) {
        out.push({
            kind: "elevated_refund_rate",
            severity: "warning",
            message: `${r30.n} refunds in the last 30 days — above typical baseline. Review reasons for trend.`,
        });
    }

    // Anomaly 2: any failed payments in last 14d
    const failed14 = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM payments WHERE status='failed' AND updated_at >= ?"
    ).bind(now - 14 * 86400000).first();
    if ((failed14?.n || 0) >= 3) {
        out.push({
            kind: "elevated_payment_failures",
            severity: "warning",
            message: `${failed14.n} failed payment attempts in 14 days. Patients may need outreach to update card on file.`,
        });
    }

    // Anomaly 3: 120+ day A/R balance
    const agedRes = await env.DB.prepare(`
        SELECT id, invoice_number, issue_date, total_cents - amount_paid_cents AS balance_cents
        FROM invoices
        WHERE status IN ('sent', 'partially_paid')
          AND (total_cents - amount_paid_cents) > 0
          AND issue_date <= ?
        LIMIT 5
    `).bind(toIso(now - 120 * 86400000)).all();
    const aged = agedRes?.results || [];
    if (aged.length) {
        const total = aged.reduce((s, i) => s + i.balance_cents, 0);
        out.push({
            kind: "aged_ar_120plus",
            severity: "warning",
            message: `${aged.length} invoice${aged.length > 1 ? "s" : ""} unpaid >120 days totaling $${(total/100).toFixed(2)}. Consider collection-call cycle or write-off review.`,
            detail: { invoices: aged.map(i => ({ invoice_number: i.invoice_number, balance_cents: i.balance_cents, age_days: Math.floor((now - new Date(i.issue_date + "T00:00:00Z").getTime()) / 86400000) })) },
        });
    }

    // Anomaly 4: $0 invoices (likely operator error)
    const zeroRes = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM invoices WHERE total_cents = 0 AND status != 'void' AND created_at >= ?"
    ).bind(now - 30 * 86400000).first();
    if ((zeroRes?.n || 0) > 0) {
        out.push({
            kind: "zero_dollar_invoices",
            severity: "info",
            message: `${zeroRes.n} $0 invoice${zeroRes.n > 1 ? "s" : ""} created in the last 30 days. If intentional (charity care), document; if accidental, void or correct.`,
        });
    }

    // Anomaly 5: completed appointments with no invoice in the last 30 days
    const uninvoicedRes = await env.DB.prepare(`
        SELECT COUNT(*) AS n
        FROM appointments a
        LEFT JOIN invoices i ON i.appointment_id = a.id
        WHERE a.status = 'completed'
          AND a.ends_at >= ?
          AND i.id IS NULL
    `).bind(now - 30 * 86400000).first();
    if ((uninvoicedRes?.n || 0) > 0) {
        out.push({
            kind: "uninvoiced_completed_appointments",
            severity: "warning",
            message: `${uninvoicedRes.n} completed appointment${uninvoicedRes.n > 1 ? "s" : ""} in the last 30 days have no invoice attached. Review and invoice promptly.`,
        });
    }

    return out;
}

// ---------- Schedule C-style P&L projection ----------
// Maps gross/refunds/fees onto Schedule C lines + projects SE tax + QBI.
// Uses YTD numbers for tax projection.
async function scheduleCProjection(env) {
    const ytdPayments = await aggregatePayments(env, startOfYearMs(), nowMs());
    const ytdRefunds  = await aggregateRefunds(env, startOfYearMs(), nowMs());
    const gross   = ytdPayments.gross_cents;
    const returns = ytdRefunds.refunds_cents;
    const net_receipts = gross - returns;
    const fees    = ytdPayments.fees_cents;
    // Conservative: assume Stripe fees are the only Schedule C expense
    // we know about. The operator will have other expenses (rent, etc.)
    // that they enter in QuickBooks. We don't try to estimate those.
    const net_profit_pre_other = net_receipts - fees;

    // Self-employment tax: 15.3% on 92.35% of net SE earnings up to SS wage base
    const SS_WAGE_BASE_2026 = 17680000; // $176,800 (placeholder — operator should update yearly)
    const se_basis = Math.round(net_profit_pre_other * 0.9235);
    const ss_portion = Math.min(se_basis, SS_WAGE_BASE_2026) * 0.124;
    const medicare_portion = se_basis * 0.029;
    const se_tax_estimate = Math.round(ss_portion + medicare_portion);

    // Quarterly estimated tax (simple heuristic — pro-rate annualized)
    const dayOfYear = Math.floor((nowMs() - startOfYearMs()) / 86400000);
    const annualizedNet = dayOfYear > 0 ? Math.round((net_profit_pre_other * 365) / dayOfYear) : 0;

    // Federal income tax estimate (very rough — assumes 22% marginal bracket
    // for single filers in healthcare/professional income range; operator
    // should adjust with actual filing status + deductions)
    const fed_income_estimate = Math.round(annualizedNet * 0.22);
    const annualizedSe = Math.round(annualizedNet * 0.9235 * 0.153);
    const annual_tax_estimate = fed_income_estimate + annualizedSe;
    const quarterly_estimate = Math.round(annual_tax_estimate / 4);

    return {
        ytd_gross_cents: gross,
        ytd_returns_cents: returns,
        ytd_net_receipts_cents: net_receipts,
        ytd_stripe_fees_cents: fees,
        ytd_net_profit_pre_other_expenses_cents: net_profit_pre_other,
        ytd_se_tax_estimate_cents: se_tax_estimate,
        annualized_net_cents: annualizedNet,
        estimated_annual_tax_cents: annual_tax_estimate,
        quarterly_estimated_payment_cents: quarterly_estimate,
        notes: [
            "Self-employment tax: 15.3% (12.4% SS + 2.9% Medicare) on 92.35% of net SE earnings.",
            "Quarterly estimate uses YTD run-rate × 22% marginal federal + SE tax. Adjust for actual filing status, deductions, business expenses entered in QuickBooks.",
            "This is a projection only — not professional tax advice. Use for sanity-checking against your CPA's actual estimates.",
        ],
    };
}

// ---------- Main entry — build the full KPI bundle ----------
export async function computeBillingInsights(env, { window = "mtd" } = {}) {
    const w = windowRange(window);

    // Current-window aggregates
    const cur = await aggregatePayments(env, w.fromMs, w.toMs);
    const curRf = await aggregateRefunds(env, w.fromMs, w.toMs);

    // Previous comparable window (for trend %)
    const span = w.toMs - w.fromMs;
    const prev = await aggregatePayments(env, w.fromMs - span, w.fromMs - 1);
    const prevRf = await aggregateRefunds(env, w.fromMs - span, w.fromMs - 1);

    const grossDelta = prev.gross_cents > 0
        ? Math.round(((cur.gross_cents - prev.gross_cents) / prev.gross_cents) * 1000) / 10
        : null;

    // A/R + DSO + top services + monthly trend + anomalies + Schedule C proj.
    const [agingRes, dsoRes, topRes, monthlyRes, anomaliesRes, schedC] = await Promise.all([
        aging(env),
        dso(env),
        topServices(env, w.fromMs, w.toMs),
        monthlyTrend(env, 12),
        detectAnomalies(env),
        scheduleCProjection(env),
    ]);

    // Derived metrics
    const grossNet  = cur.gross_cents - curRf.refunds_cents;
    const feePct    = cur.gross_cents > 0 ? Math.round((cur.fees_cents / cur.gross_cents) * 1000) / 10 : null;
    const refundPct = cur.gross_cents > 0 ? Math.round((curRf.refunds_cents / cur.gross_cents) * 1000) / 10 : null;
    const arpv      = cur.payment_count > 0 ? Math.round(cur.gross_cents / cur.payment_count) : 0;

    return {
        window: w.label,
        period: { from: toIso(w.fromMs), to: toIso(w.toMs) },
        current: {
            gross_cents: cur.gross_cents,
            fees_cents: cur.fees_cents,
            net_cents: cur.net_cents,
            refunds_cents: curRf.refunds_cents,
            net_after_refunds_cents: grossNet,
            payment_count: cur.payment_count,
            refund_count: curRf.refund_count,
            average_revenue_per_visit_cents: arpv,
            stripe_fee_pct_of_gross: feePct,
            refund_pct_of_gross: refundPct,
        },
        previous: {
            gross_cents: prev.gross_cents,
            payment_count: prev.payment_count,
            refunds_cents: prevRf.refunds_cents,
        },
        trend: { gross_pct_change: grossDelta },
        ar_aging: agingRes,
        dso: dsoRes,
        top_services: topRes,
        monthly_trend: monthlyRes,
        anomalies: anomaliesRes,
        schedule_c_projection: schedC,
    };
}
