// =====================================================================
// POST /api/v1/membership/interest — the waitlist
// =====================================================================
// Membership is announced but not yet purchasable: Stripe is not wired,
// the portal is gated, and email is still in the SES sandbox. Rather than
// show a price behind a button that does nothing, the page says OPENING
// SOON and collects interest.
//
// That is also the more valuable thing right now. It answers "will anyone
// pay for this, and for which tier" before another line of subscription
// code is written — and `state` answers a question the practice cannot
// otherwise see: how much demand sits outside Illinois and California,
// which is where a third licence would pay for itself.
//
// ---------------------------------------------------------------------
// THIS FORM MUST NOT BECOME A MEDICAL INTAKE
// ---------------------------------------------------------------------
// People will type their symptoms into a free-text box. They always do.
// This table is not encrypted, is not governed as a medical record, and
// is not the place for it — so `note` is short, and clinical-looking
// submissions are REFUSED with an explanation that points them at the
// portal, where that content is encrypted and belongs.
//
// Refusing is friendlier than it sounds: silently storing someone's
// diagnosis in a marketing table would be the actual disservice.
// =====================================================================

import { newId } from "../../../_lib/db.js";
import { TIERS } from "../../../_lib/membership.js";

const MAX_NOTE = 400;
const VALID_TIERS = new Set(TIERS.map((t) => t.key).concat(["any"]));
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO " +
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR").split(" "));

/**
 * Clinical content that does not belong in a marketing table. Narrower
 * than the Safe-Harbor scrubber on purpose — we are not trying to detect
 * every identifier, only to notice that someone is describing a medical
 * problem so we can send them somewhere appropriate.
 */
const CLINICAL_RX = [
    /\b(endometriosis|adenomyosis|fibroid|prolapse|cyst|cancer|tumou?r|hysterectom|laparoscop)/i,
    /\b(pain|bleeding|cramp|discharge|infertil|miscarriage|periods?)\b/i,
    /\b(diagnos|surgery|operation|medication|prescription|mg\b|dose)/i,
    /\b(MRN|medical record|date of birth|DOB)\b/i,
];

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
}

async function hashIp(env, ip) {
    const salt = env.IP_HASH_SALT || "";
    const buf = new TextEncoder().encode(`${salt}:${ip}`);
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(ctx) {
    const { request, env } = ctx;
    if (!env.DB) return json({ ok: false, error: "unavailable" }, 503);

    let b;
    try { b = await request.json(); } catch { return json({ ok: false, error: "invalid request" }, 400); }

    const email = String(b?.email || "").trim().toLowerCase();
    if (!EMAIL_RX.test(email) || email.length > 254) {
        return json({ ok: false, error: "That does not look like an email address." }, 400);
    }

    const tier = VALID_TIERS.has(String(b?.tier || "")) ? String(b.tier) : "any";
    const stateRaw = String(b?.state || "").trim().toUpperCase();
    const state = US_STATES.has(stateRaw) ? stateRaw : null;
    const hasObgyn = ["yes", "no"].includes(String(b?.has_obgyn || "")) ? String(b.has_obgyn) : null;

    const note = String(b?.note || "").trim().slice(0, MAX_NOTE);
    if (note && CLINICAL_RX.some((re) => re.test(note))) {
        return json({
            ok: false,
            clinical_refused: true,
            error: "Please leave the medical details out of this form — it is a mailing list, not a medical record, and is not encrypted for that. "
                 + "Join the list with just your email, and when the portal opens you will be able to share your history somewhere it is properly protected.",
        }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ip_hash = ip ? await hashIp(env, ip) : null;

    // Crude but sufficient rate limit: one IP cannot register more than a
    // handful of addresses in a day. A real signup surge is many IPs.
    if (ip_hash) {
        try {
            const since = new Date(Date.now() - 86400000).toISOString();
            const row = await env.DB.prepare(
                `SELECT COUNT(*) AS n FROM membership_interest WHERE ip_hash = ? AND created_at > ?`
            ).bind(ip_hash, since).first();
            if (Number(row?.n || 0) >= 8) {
                return json({ ok: false, error: "Too many signups from this connection today." }, 429);
            }
        } catch { /* never block a signup on the rate-limit query failing */ }
    }

    try {
        await env.DB.prepare(
            `INSERT INTO membership_interest (id, email, tier, state, has_obgyn, note, source, created_at, ip_hash)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(email, tier) DO UPDATE SET
                state = COALESCE(excluded.state, membership_interest.state),
                has_obgyn = COALESCE(excluded.has_obgyn, membership_interest.has_obgyn),
                note = COALESCE(NULLIF(excluded.note, ''), membership_interest.note)`
        ).bind(newId(), email, tier, state, hasObgyn, note || null,
               String(b?.source || "membership_page").slice(0, 60),
               new Date().toISOString(), ip_hash).run();
    } catch (e) {
        console.error("membership interest insert failed", String(e).slice(0, 200));
        return json({ ok: false, error: "Could not add you just now. Please try again." }, 500);
    }

    return json({
        ok: true,
        message: "You are on the list. We will email you when membership opens — nothing else, and you can leave at any time.",
        // Told plainly, because someone in Texas should know now rather
        // than at checkout that a consultation is not available to them.
        note: state && !["IL", "CA"].includes(state)
            ? `Dr. Mabini is licensed in Illinois and California. Preparation tools will be available wherever you live; a clinical consultation will not be, unless he licenses in ${state}. Your interest is recorded, which is how that decision gets made.`
            : null,
    });
}

export async function onRequestGet() {
    // No public read. The list is an operator asset and an email address
    // is enough to be worth protecting.
    return json({ ok: false, error: "method_not_allowed" }, 405);
}
