// =====================================================================
// functions/_lib/prom_scorer.js — generic PROM scorer
// =====================================================================
// Reads a PROM definition's `scoring` + `thresholds` blocks and produces:
//   - computed_scores: { total, subscales:{...}, interpretation:'...' }
//   - threshold_flags: [{flag_type, severity, message, follow_up_action}]
//
// Supported scoring methods:
//   'sum'                  — straight sum of items (PHQ-2, GAD-2)
//   'subscale_mean'        — mean per subscale (BPI-SF)
//   'weighted_transformed' — per-item transform then aggregate (EHP-5: sum*25, mean)
//
// Supported threshold rules:
//   'total >= N'
//   'total <= N'
//   'subscale.X >= N'
//   'delta_vs_baseline >= N'  (requires `baseline_total` in context)
// =====================================================================

function num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return parseFloat(v);
    return null;
}

function evalRule(rule, computed, context) {
    // Very small DSL — handles the rule strings we actually use in the JSON defs.
    // Format: "total OP N" | "subscale.X OP N" | "delta_vs_baseline OP N"
    const m = /^([\w.]+)\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)$/.exec(rule.trim());
    if (!m) return false;
    const [, lhs, op, rhsStr] = m;
    const rhs = parseFloat(rhsStr);

    let left = null;
    if (lhs === "total") {
        left = computed.total;
    } else if (lhs.startsWith("subscale.")) {
        const key = lhs.slice("subscale.".length);
        left = computed.subscales && computed.subscales[key];
    } else if (lhs === "delta_vs_baseline") {
        if (context && typeof context.baseline_total === "number" && typeof computed.total === "number") {
            left = computed.total - context.baseline_total;
        }
    }
    if (left === null || typeof left !== "number" || isNaN(left)) return false;

    switch (op) {
        case ">=": return left >= rhs;
        case "<=": return left <= rhs;
        case ">":  return left >  rhs;
        case "<":  return left <  rhs;
        case "==": return left === rhs;
        case "!=": return left !== rhs;
        default:   return false;
    }
}

function interpretBand(scoring, scopeName, value) {
    const bands = scoring.interpretation_bands || [];
    for (const b of bands) {
        if (b.subscale && b.subscale !== scopeName) continue;
        if (!b.subscale && scopeName !== "total") continue;
        if (typeof value !== "number" || isNaN(value)) continue;
        if (value >= b.min && value <= b.max) {
            return { label: b.label, patient_label: b.patient_label };
        }
    }
    return null;
}

export function scorePROM(definition, responseData, context = {}) {
    const scoring = definition.scoring || {};
    const computed = { total: null, subscales: {}, interpretation: null, per_subscale_interpretation: {} };

    const itemVal = (id) => num(responseData[id]);

    if (scoring.method === "sum") {
        const items = scoring.items || [];
        let total = 0;
        let any = false;
        for (const id of items) {
            const v = itemVal(id);
            if (v !== null) { total += v; any = true; }
        }
        computed.total = any ? total : null;
    } else if (scoring.method === "subscale_mean") {
        const subscales = scoring.subscales || {};
        let grandSum = 0, grandCount = 0;
        for (const [sname, sdef] of Object.entries(subscales)) {
            const items = sdef.items || [];
            let sum = 0, count = 0;
            for (const id of items) {
                const v = itemVal(id);
                if (v !== null) { sum += v; count += 1; }
            }
            const mean = count ? sum / count : null;
            computed.subscales[sname] = mean;
            if (sdef.method === "mean" && mean !== null) {
                grandSum += mean;
                grandCount += 1;
            }
            // Per-subscale interpretation
            if (mean !== null) {
                const band = interpretBand(scoring, sname, mean);
                if (band) computed.per_subscale_interpretation[sname] = band;
            }
        }
        // Overall total = mean of subscale means (only when meaningful)
        computed.total = grandCount ? grandSum / grandCount : null;
    } else if (scoring.method === "weighted_transformed") {
        // Per-item transform (e.g., value * 25), then aggregate (mean/sum)
        const items = scoring.items || [];
        const transform = scoring.transform || "value"; // simple "value * 25" / "value"
        const aggregate = scoring.aggregate || "mean";
        const transformed = [];
        for (const id of items) {
            const v = itemVal(id);
            if (v === null) continue;
            let t = v;
            const tm = /^value\s*\*\s*(\d+(?:\.\d+)?)$/.exec(transform);
            if (tm) t = v * parseFloat(tm[1]);
            transformed.push(t);
        }
        if (transformed.length === 0) {
            computed.total = null;
        } else if (aggregate === "mean") {
            computed.total = transformed.reduce((a, b) => a + b, 0) / transformed.length;
        } else if (aggregate === "sum") {
            computed.total = transformed.reduce((a, b) => a + b, 0);
        } else {
            computed.total = null;
        }
    }

    // Overall interpretation
    if (computed.total !== null) {
        const band = interpretBand(scoring, "total", computed.total);
        if (band) computed.interpretation = band;
    }

    // Evaluate thresholds
    const triggered = [];
    for (const t of (definition.thresholds || [])) {
        if (!t.rule) continue;
        if (evalRule(t.rule, computed, context)) {
            triggered.push({
                flag_type: t.flag_type,
                severity: t.severity || "info",
                message: t.message || "",
                follow_up_action: t.follow_up_action || null,
                rule: t.rule
            });
        }
    }

    return { computed_scores: computed, threshold_flags: triggered };
}
