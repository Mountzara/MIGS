// =====================================================================
// practice_setup.js — "is this practice actually operational?"
// =====================================================================
// THE PRODUCT THESIS. This is meant to be a private-practice platform
// OUT OF THE BOX: install it and it walks the physician from nothing to
// operating. A console that renders twenty empty pages and says nothing
// is not that — it reads as broken software, because from the outside a
// blank page and a broken page look identical.
//
// So setup state is COMPUTED FROM REAL DATA, never remembered in a flag.
// Every step here answers "how would I prove this?" with a query. A
// checklist that marks itself complete without evidence is worse than no
// checklist: it is a lie the operator plans around. (This exact bug
// shipped once in the notification health check — it counted a test probe
// as a live event and reported the bounce pipeline healthy while it was
// not. Never again.)
//
// Steps are ordered so following them top to bottom never hits a
// prerequisite that is not yet met, and `blocking` is honest: it means
// "you cannot safely see a patient without this", not "we would like it".
// Licensure and bookable hours block. A clearinghouse does not — a
// cash-pay patient can be seen the day the practice opens.
// =====================================================================

const DONE = "done", TODO = "todo", ATTN = "attention";

async function count(env, sql, ...binds) {
    try {
        const row = await env.DB.prepare(sql).bind(...binds).first();
        return row ? Number(Object.values(row)[0]) || 0 : 0;
    } catch { return -1; }          // -1 = could not determine, never "done"
}

async function setting(env, key) {
    try {
        const r = await env.DB.prepare(
            `SELECT value_json FROM practice_settings WHERE key = ? ORDER BY updated_at DESC LIMIT 1`
        ).bind(key).first();
        return r ? r.value_json : null;
    } catch { return null; }
}

async function tableExists(env, name) {
    try {
        const r = await env.DB.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`
        ).bind(name).first();
        return !!r;
    } catch { return false; }
}

export async function computeSetup(env) {
    const steps = [];
    const add = (s) => steps.push(s);

    // ---- 1. Where you are licensed to practice --------------------------
    let states = [];
    try { states = JSON.parse((await setting(env, "licensed_states_json")) || "[]"); } catch { states = []; }
    add({
        id: "licensed_states",
        title: "Set the states you are licensed in",
        why: "Telehealth happens where the patient is sitting. Every booking and intake is checked against this list, and anything not on it is refused.",
        href: "/admin/scheduling/",
        blocking: true,
        status: Array.isArray(states) && states.length ? DONE : TODO,
        detail: Array.isArray(states) && states.length
            ? `Licensed in ${states.join(", ")}`
            : "No states set — bookings fall back to Illinois only.",
    });

    // ---- 2. Hours a patient can actually book ---------------------------
    const avail = await count(env, `SELECT COUNT(*) n FROM clinician_availability`);
    add({
        id: "availability",
        title: "Publish your bookable hours",
        why: "Nothing can be booked until there are hours to book. This is the single most common reason a new practice's portal looks empty to patients.",
        href: "/admin/scheduling/",
        blocking: true,
        status: avail > 0 ? DONE : TODO,
        detail: avail > 0 ? `${avail} availability window(s) configured` : "No availability — patients will see no appointment times.",
    });

    // ---- 3. Telehealth room ---------------------------------------------
    const room = await setting(env, "doxy_room_url");
    add({
        id: "telehealth_room",
        title: "Connect your telehealth room",
        why: "The Join button on a patient's visit needs somewhere to send them.",
        href: "/admin/scheduling/",
        blocking: true,
        status: room && String(room).length > 6 ? DONE : TODO,
        detail: room && String(room).length > 6 ? "Room link saved" : "No room link — the Join button has no destination.",
    });

    // ---- 4. Can the practice send email at all? -------------------------
    // Proven by a real successful send, not by configuration looking right.
    const sent = await count(env, `SELECT COUNT(*) n FROM notification_outbox WHERE status = 'sent'`);
    const failed = await count(env, `SELECT COUNT(*) n FROM notification_outbox WHERE status IN ('failed','abandoned')`);
    add({
        id: "email_delivery",
        title: "Get email delivering",
        why: "Sign-in links, appointment confirmations and result notices all travel by email. Until one message has actually been delivered, assume none will be.",
        href: "/admin/",
        blocking: true,
        status: sent > 0 ? DONE : (failed > 0 ? ATTN : TODO),
        detail: sent > 0
            ? `${sent} message(s) delivered${failed > 0 ? `, ${failed} failed earlier` : ""}`
            : (failed > 0 ? `${failed} attempt(s) failed and none succeeded — the sending account is probably still restricted.` : "Nothing has been sent yet."),
    });

    // ---- 5. Bounce and complaint handling -------------------------------
    let realSns = 0;
    if (await tableExists(env, "sns_confirmations")) {
        realSns = await count(env, `SELECT COUNT(*) n FROM sns_confirmations WHERE body LIKE '%Amazon Simple Notification Service%'`);
    }
    add({
        id: "bounce_pipeline",
        title: "Turn on bounce and complaint handling",
        why: "If mail keeps going to a dead address, the sending reputation degrades until nothing arrives for anyone — including sign-in links.",
        href: "/admin/",
        blocking: false,
        status: realSns > 0 ? DONE : TODO,
        detail: realSns > 0 ? "Bounce events are reaching the application" : "No bounce events received yet.",
    });

    // ---- 6. Identity used on claims and estimates -----------------------
    const npi = env.BILLING_PROVIDER_NPI || "";
    const tin = env.BILLING_PROVIDER_TIN || "";
    const addr = await setting(env, "practice_address");
    const idOk = !!npi && !!tin && !!addr;
    add({
        id: "practice_identity",
        title: "Record your practice identifiers",
        why: "Your NPI, tax ID and practice address appear on every claim and every good faith estimate. A mismatch here is the commonest claim rejection.",
        href: "/admin/billing/clearinghouse/",
        blocking: false,
        status: idOk ? DONE : (npi || tin || addr ? ATTN : TODO),
        detail: idOk ? "NPI, TIN and address on file"
            : `Missing: ${[!npi && "NPI", !tin && "tax ID", !addr && "practice address"].filter(Boolean).join(", ")}`,
    });

    // ---- 7. Legal documents ---------------------------------------------
    // The pages are deployment-gated, so their existence is not in question;
    // what varies is whether anyone has acknowledged the current version.
    const acks = await count(env, `SELECT COUNT(*) n FROM patient_acknowledgments`);
    add({
        id: "legal",
        title: "Have the legal pages reviewed",
        why: "Privacy policy, notice of privacy practices, terms and telehealth consent are published and wired into signup. They are grounded drafts, not attorney-reviewed documents.",
        href: "/privacy-practices/",
        blocking: false,
        status: ATTN,
        detail: acks > 0
            ? `${acks} patient acknowledgment(s) recorded. Attorney review still outstanding.`
            : "Published and enforced at signup. Attorney review still outstanding.",
    });

    // ---- 8. Insurance rails (optional to start) --------------------------
    const payers = await count(env, `SELECT COUNT(*) n FROM billing_payers`);
    let vendors = 0;
    if (await tableExists(env, "clearinghouse_vendors")) {
        vendors = await count(env, `SELECT COUNT(*) n FROM clearinghouse_vendors WHERE removed_at IS NULL`);
    }
    add({
        id: "insurance",
        title: "Set up insurance billing",
        why: "Only needed to bill insurance. A cash-pay practice can see patients the day it opens without any of this.",
        href: "/admin/billing/clearinghouse/",
        blocking: false,
        status: vendors > 0 ? DONE : (payers > 0 ? ATTN : TODO),
        detail: vendors > 0 ? `${vendors} clearinghouse connection(s), ${payers} payer(s)`
            : (payers > 0 ? `${payers} payers loaded, no clearinghouse connected yet` : "No payers or clearinghouse configured."),
    });

    // ---- 9. Patient education library ------------------------------------
    const edu = await count(env, `SELECT COUNT(*) n FROM education_materials`);
    add({
        id: "education",
        title: "Stock the patient education library",
        why: "What patients read between visits. Assigning the right material is most of the follow-up questions you would otherwise answer twice.",
        href: "/admin/education/",
        blocking: false,
        status: edu > 0 ? DONE : TODO,
        detail: edu > 0 ? `${edu} material(s) available` : "No education materials yet.",
    });

    // ---- 10. Background jobs ---------------------------------------------
    // Proven by evidence of a run, not by the code existing.
    // ONLY runs whose actor is the pipeline itself. The first version of
    // this query also matched on action name, so the four sweeps a human
    // had triggered from the board counted as proof the cron worker was
    // running — it was not. A readiness check that a manual click can
    // satisfy is the lie this module exists to avoid.
    const cronRuns = await count(env,
        `SELECT COUNT(*) n FROM audit_log WHERE user_id IN ('sweep','auto','cron','pipeline')`);
    add({
        id: "cron",
        title: "Deploy the background worker",
        why: "It chases overdue results, releases triage after four hours, and sweeps message deadlines. Without it those only happen when someone clicks.",
        href: "/admin/orders/",
        blocking: false,
        status: cronRuns > 0 ? DONE : TODO,
        detail: cronRuns > 0 ? `${cronRuns} background run(s) recorded` : "No background run has ever been recorded.",
    });

    // ---- 11. Clinical knowledge base --------------------------------------
    const kbDocs = (await tableExists(env, "kb_docs")) ? await count(env, `SELECT COUNT(*) n FROM kb_docs`) : 0;
    const kbSections = await tableExists(env, "kb_sections");
    add({
        id: "knowledge_base",
        title: "Load your clinical knowledge base",
        why: "Every clinical AI answer is grounded in your own library and refuses to answer beyond it. Loading the structured sections makes it cite the right part of a source instead of the whole document.",
        href: "/admin/",
        blocking: false,
        status: kbDocs > 0 && kbSections ? DONE : (kbDocs > 0 ? ATTN : TODO),
        detail: kbDocs > 0
            ? `${kbDocs} documents indexed${kbSections ? " with structured sections" : " — structured sections not loaded yet"}`
            : "No knowledge base loaded.",
    });

    // ---- 12. Open the doors ------------------------------------------------
    const launched = String(env.PORTAL_PUBLIC_LAUNCH || "false").trim().toLowerCase() === "true";
    const patients = await count(env, `SELECT COUNT(*) n FROM patients`);
    add({
        id: "launch",
        title: "Open the portal to patients",
        why: "Until this is on, the portal answers only to you. Patients reaching it get nothing — which is correct while you are still setting up, and wrong the day you open.",
        href: "/admin/",
        blocking: false,
        status: launched ? DONE : TODO,
        detail: launched
            ? `Open to the public. ${patients} patient record(s).`
            : `Preview only — the public cannot sign up or sign in. ${patients} patient record(s) exist.`,
    });

    const blocking = steps.filter((s) => s.blocking);
    const blockingLeft = blocking.filter((s) => s.status !== DONE);
    return {
        steps,
        summary: {
            total: steps.length,
            done: steps.filter((s) => s.status === DONE).length,
            attention: steps.filter((s) => s.status === ATTN).length,
            todo: steps.filter((s) => s.status === TODO).length,
            blocking_remaining: blockingLeft.length,
            // The honest headline. "Ready" means every blocking step is
            // provably done — not that most boxes are ticked.
            ready_to_see_patients: blockingLeft.length === 0,
            next: (blockingLeft[0] || steps.find((s) => s.status !== DONE) || null),
        },
    };
}

export default { computeSetup };
