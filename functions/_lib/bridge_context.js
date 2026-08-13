// =====================================================================
// bridge_context.js — what the local Claude CLI is allowed to see
// =====================================================================
// THE THREAT MODEL, stated plainly.
//
// The CLI bridge runs `claude -p` on the owner's Mac against his personal
// Claude subscription. His Anthropic BAA covers the API. It does NOT
// cover a consumer CLI subscription. Therefore anything reaching the
// bridge is, for compliance purposes, leaving BAA-covered infrastructure,
// and PHI must not be in it.
//
// The original bridge script fetched a raw message thread and piped it
// into `claude -p`. That would have been a disclosure of PHI to a
// non-BAA processor. This module exists so that cannot happen.
//
// ENFORCEMENT IS SERVER-SIDE, NOT CLIENT-SIDE.
// The bridge is an untrusted client. It holds a token, it runs on a
// laptop, and its script can be edited by anyone at that keyboard. So the
// server never returns raw content and trusts the bridge to scrub it —
// the server scrubs, VERIFIES the scrub, and refuses to answer at all if
// verification fails. There is no request shape, no flag and no query
// parameter that yields un-scrubbed text from this endpoint. The only way
// to change that is to change this file.
//
// SEND THE STRUCTURE, KEEP THE VALUES.
// Safe Harbor would have us replace every date with [DATE], which
// destroys the very thing a draft needs ("your surgery on the 14th").
// So dates become indexed tokens — [DATE_1], [DATE_2] — and names become
// [NAME_1]. The model reasons over tokens; the server REHYDRATES the
// result before the physician ever sees it. He reads a normal draft. The
// model never saw a real name or a real date. This is the same technique
// billing_appeal.js uses for placeholders, generalized.
//
// MINIMUM NECESSARY (45 CFR §164.502(b)).
// Even de-identified, each job kind gets only the fields its task needs.
// A billing job sees CPT, ICD, modifiers, units and place of service —
// never narrative, never a chief complaint. "It might be useful" is not
// a justification; the standard is necessary.
// =====================================================================

import { scrubForAI, tokenizeDates, resolveDateToken } from "./deidentify.js";

/**
 * Job kinds the bridge may run. A kind absent from this map CANNOT be
 * routed to the bridge — the context endpoint refuses it — because we
 * have not decided what "de-identified" means for it. Defaulting to
 * "allow and hope the scrubber catches it" is how PHI escapes.
 */
export const BRIDGE_KINDS = {
    message_draft: {
        label: "Draft a reply to a patient message",
        needs: "the thread text, de-identified",
        phi: true,
    },
    intake_summary: {
        label: "Summarise an intake questionnaire",
        needs: "the answers, de-identified",
        phi: true,
    },
    visit_summary: {
        label: "Draft an after-visit summary",
        needs: "the encounter note, de-identified",
        phi: true,
    },
    enrollment_extract: {
        label: "Read a practice document",
        // NOT patient data. This is the practice's own W-9 / PTAN letter.
        // It is gated separately by enrollment_extract.looksLikePatientDocument().
        needs: "the document text, admitted only after the patient-document gate",
        phi: false,
    },
};

export function bridgeKindAllowed(kind) {
    return Object.prototype.hasOwnProperty.call(BRIDGE_KINDS, String(kind || ""));
}

// ---------------------------------------------------------------------
// Name tokenisation
// ---------------------------------------------------------------------
// deidentify.scrubKnownNames replaces every known name with the same
// "[NAME]", which is correct for Safe Harbor but useless for a reply that
// has to address someone. Indexed tokens keep them distinguishable and
// reversible, exactly as tokenizeDates does for dates.

export function tokenizeNames(text, names = []) {
    let out = String(text || "");
    const map = {};
    let i = 0;
    // Longest first, so "Mary Jane Smith" is not half-consumed by "Mary".
    const sorted = [...new Set(names.filter((n) => String(n || "").trim().length >= 3))]
        .sort((a, b) => b.length - a.length);
    for (const name of sorted) {
        const token = `[NAME_${++i}]`;
        const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${esc}\\b`, "gi");
        if (re.test(out)) {
            out = out.replace(re, token);
            map[token] = String(name);
        } else {
            i--;                       // name never appeared; do not burn an index
        }
    }
    return { text: out, map };
}

/**
 * Build de-identified context, and VERIFY it.
 *
 * @returns {{ok, text, map, findings, residual}}
 *   ok === false means DO NOT SEND. The caller must refuse, not warn.
 */
export function deidentifyForBridge(rawText, { knownNames = [] } = {}) {
    const named = tokenizeNames(rawText, knownNames);
    const dated = tokenizeDates(named.text);
    const scrub = scrubForAI(dated.text);

    // The scrubber's own re-scan is the verification. If any high-risk
    // shape survives, we refuse — silence is never treated as success.
    return {
        ok: scrub.ok,
        text: scrub.ok ? scrub.text : null,
        map: { ...named.map, ...(dated.map || {}) },
        findings: scrub.findings,
        residual: scrub.residual,
    };
}

/**
 * Put the real values back. Runs on the SERVER, after the bridge returns,
 * so the physician reads a normal draft while the model only ever saw
 * tokens.
 */
export function rehydrate(text, map = {}) {
    let out = String(text || "");
    for (const [token, value] of Object.entries(map)) {
        if (/^\[DATE_\d+\]$/.test(token)) {
            const resolved = resolveDateToken(token, map);
            out = out.split(token).join(resolved || value);
        } else {
            out = out.split(token).join(value);
        }
    }
    return out;
}

/**
 * Did any token survive into the final text? A leftover [NAME_2] means the
 * model invented a reference we cannot resolve, and showing it to the
 * physician as a finished draft would be worse than showing nothing.
 */
export function unresolvedTokens(text) {
    return [...new Set(String(text || "").match(/\[(?:NAME|DATE)_\d+\]/g) || [])];
}

// ---------------------------------------------------------------------
// Minimum necessary — per-kind field selection
// ---------------------------------------------------------------------

/**
 * Billing context. Codes only. This is what "minimum necessary" means in
 * practice: a claim is decided on CPT, ICD, modifiers, units and place of
 * service, so narrative never leaves — not de-identified narrative,
 * NONE. There is nothing to scrub because nothing is selected.
 */
export function billingContext(claim = {}, lines = []) {
    return {
        place_of_service: claim.place_of_service || null,
        billing_provider_taxonomy: claim.taxonomy || null,
        payer_kind: claim.payer_kind || null,
        lines: lines.map((l) => ({
            cpt: l.cpt || l.procedure_code || null,
            modifiers: [l.mod1, l.mod2, l.mod3, l.mod4].filter(Boolean),
            units: l.units ?? 1,
            icd: [l.icd1, l.icd2, l.icd3, l.icd4].filter(Boolean),
            charge: l.charge ?? null,
        })),
        // Deliberately absent: patient name, DOB, member ID, address, sex,
        // account number, dates of service, and every narrative field.
    };
}

export default {
    BRIDGE_KINDS, bridgeKindAllowed, tokenizeNames,
    deidentifyForBridge, rehydrate, unresolvedTokens, billingContext,
};
