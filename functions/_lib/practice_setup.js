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

const DONE = "done", TODO = "todo", ATTN = "attention", UNKNOWN = "unknown";

// Values schema/0002 ships with. A setting still equal to its seed has
// never been touched by the operator, so treating it as configured would
// print a hospital's address on this practice's good faith estimates.
const SEEDS = {
    practice_address: "PRIME Healthcare St. Francis Hospital, Evanston, IL",
    timezone: "America/Chicago",
    reminders_email_from: "appointments@mountzara.com",
};

// -1 means the query threw. It must never read as "empty" — an operator
// sent to configure something already configured stops trusting the list.
const UNRESOLVED = -1;

async function count(env, sql, ...binds) {
    try {
        const row = await env.DB.prepare(sql).bind(...binds).first();
        return row ? Number(Object.values(row)[0]) || 0 : 0;
    } catch { return UNRESOLVED; }
}

// value_json is JSON-ENCODED. Returning it raw meant every length and
// truthiness test here was measuring a string with its quotes still on.
async function setting(env, key) {
    try {
        const r = await env.DB.prepare(
            `SELECT value_json FROM practice_settings WHERE key = ? ORDER BY updated_at DESC LIMIT 1`
        ).bind(key).first();
        if (!r || r.value_json == null) return null;
        try { return JSON.parse(r.value_json); } catch { return null; }
    } catch { return undefined; }          // undefined = could not check
}

function touched(value, key) {
    if (value === undefined || value === null) return false;
    const v = typeof value === "string" ? value.trim() : value;
    if (v === "" ) return false;
    if (SEEDS[key] !== undefined && String(v) === SEEDS[key]) return false;   // untouched seed
    return true;
}

async function tableExists(env, name) {
    try {
        const r = await env.DB.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`
        ).bind(name).first();
        return !!r;
    } catch { return false; }
}

const fromCount = (n, ok) => (n === UNRESOLVED ? UNKNOWN : (ok(n) ? DONE : TODO));

export async function computeSetup(env) {
    const steps = [];
    const add = (s) => steps.push(s);

    // ---- 1. Where you are licensed to practice --------------------------
    // setting() parses; parsing its result again turned a perfectly good
    // ["CA","IL"] into an exception and reported the practice unlicensed.
    const rawStates = await setting(env, "licensed_states_json");
    const states = Array.isArray(rawStates) ? rawStates.filter((x) => /^[A-Z]{2}$/.test(String(x).trim())) : [];
    add({
        id: "licensed_states",
        title: "Set the states you are licensed in",
        why: "Telehealth happens where the patient is sitting. Every booking and intake is checked against this list, and anything not on it is refused.",
        href: "/admin/scheduling/",
        blocking: true,
        status: rawStates === undefined ? UNKNOWN : (states.length ? DONE : TODO),
        detail: rawStates === undefined ? "Could not read practice settings."
            : states.length ? `Licensed in ${states.join(", ")}`
            : "No states set — every booking silently falls back to Illinois only.",
    });

    // ---- 2. Hours a patient can actually book ---------------------------
    // Only `block_kind='open'` is bookable — scheduling.js filters on exactly
    // that — and only dates from today forward. Counting every row called a
    // calendar of surgery blocks "bookable hours" while the patient booker
    // showed no times at all: green here, empty there, and neither party can
    // see the other's screen.
    const openBlocks = await count(env,
        `SELECT COUNT(*) n FROM clinician_availability WHERE block_kind = 'open' AND date >= date('now','-1 day')`);
    const appts = await count(env, `SELECT COUNT(*) n FROM appointments WHERE status NOT IN ('cancelled','no_show')`);
    add({
        id: "availability",
        title: "Publish your bookable hours",
        why: "Nothing can be booked until there are hours to book. This is the commonest reason a new practice's portal looks empty to patients.",
        href: "/admin/scheduling/",
        blocking: true,
        status: openBlocks === UNRESOLVED ? UNKNOWN
            : (openBlocks > 0 ? DONE : (appts > 0 ? ATTN : TODO)),
        detail: openBlocks === UNRESOLVED ? "Could not check the calendar."
            : openBlocks > 0 ? `${openBlocks} open block(s) from today onward`
            : (appts > 0
                ? `${appts} appointment(s) exist but no open blocks. Admin bookings bypass the calendar; patient self-booking does not, so patients currently see no times at all.`
                : "No open hours — patients will see no appointment times."),
    });

    // ---- 3. Telehealth room ---------------------------------------------
    const room = await setting(env, "doxy_room_url");
    const roomOk = typeof room === "string" && /^https:\/\/\S+\.\S+/.test(room.trim());
    add({
        id: "telehealth_room",
        title: "Connect your telehealth room",
        why: "The Join button on a patient's visit needs somewhere to send them. Your visits run through Doxy.me, so this is that room's link.",
        href: "/admin/scheduling/",
        blocking: true,
        status: room === undefined ? UNKNOWN : (roomOk ? DONE : TODO),
        detail: room === undefined ? "Could not read practice settings."
            : roomOk ? "Doxy.me room link saved"
            : "No usable room link — the Join button has no destination.",
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
    // clearinghouse_profile is the operator-editable, validated source of
    // truth; the env vars are a display fallback only. And a practice
    // address still equal to its seed is not this practice's address.
    let profNpi = "", profTin = "";
    if (await tableExists(env, "clearinghouse_profile")) {
        try {
            const r = await env.DB.prepare(
                `SELECT npi_individual, tin_last4 FROM clearinghouse_profile LIMIT 1`).first();
            profNpi = (r && r.npi_individual) || "";
            profTin = (r && r.tin_last4) || "";
        } catch { /* leave blank */ }
    }
    const npi = profNpi || env.BILLING_PROVIDER_NPI || "";
    const tin = profTin || env.BILLING_PROVIDER_TIN || "";
    const addr = await setting(env, "practice_address");
    const addrOk = touched(addr, "practice_address");
    const idOk = !!npi && !!tin && addrOk;
    add({
        id: "practice_identity",
        title: "Record your practice identifiers",
        why: "Your NPI, tax ID and practice address appear on every claim and every good faith estimate. A mismatch here is the commonest claim rejection.",
        href: "/admin/billing/clearinghouse/",
        blocking: false,
        status: addr === undefined ? UNKNOWN : (idOk ? DONE : ((npi || tin || addrOk) ? ATTN : TODO)),
        detail: addr === undefined ? "Could not read practice settings."
            : idOk ? "NPI, tax ID and practice address on file"
            : `Missing: ${[!npi && "NPI", !tin && "tax ID", !addrOk && "practice address (still the seeded value)"].filter(Boolean).join(", ")}`,
    });

    // ---- 7. Legal documents ---------------------------------------------
    // The pages are deployment-gated, so their existence is not in question;
    // what varies is whether anyone has acknowledged the current version.
    // Version-bound: counting every row regardless of doc_version would keep
    // reporting full coverage the moment a document is revised, silently
    // defeating the re-acknowledgment the versioning exists to force.
    let ackDetail = "Published and enforced at signup.";
    try {
        const { DOC_VERSIONS } = await import("./acknowledgments.js");
        const cur = await env.DB.prepare(
            `SELECT COUNT(DISTINCT patient_id) n FROM patient_acknowledgments
              WHERE doc_key = 'npp' AND doc_version = ?`).bind(DOC_VERSIONS.npp).first();
        const pts = await env.DB.prepare(`SELECT COUNT(*) n FROM patients`).first();
        const have = (cur && cur.n) || 0, total = (pts && pts.n) || 0;
        ackDetail = total > 0
            ? `${have} of ${total} patient(s) have acknowledged the current notice.`
            : "Published and enforced at signup.";
    } catch { /* keep the default sentence */ }
    add({
        id: "legal",
        title: "Have the legal pages reviewed",
        why: "Privacy policy, notice of privacy practices, terms and telehealth consent are published and wired into signup. They are grounded drafts, not attorney-reviewed documents.",
        href: "/privacy-practices/",
        blocking: false,
        status: ATTN,
        detail: `${ackDetail} Attorney review still outstanding.`,
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
    const eduPub = await count(env, `SELECT COUNT(*) n FROM education_materials WHERE status = 'published'`);
    const eduDraft = await count(env, `SELECT COUNT(*) n FROM education_materials WHERE status != 'published'`);
    add({
        id: "education",
        title: "Stock the patient education library",
        why: "What patients read between visits. Assigning the right material answers most of the questions you would otherwise field twice.",
        href: "/admin/education/",
        blocking: false,
        status: fromCount(eduPub, (n) => n > 0),
        detail: eduPub === UNRESOLVED ? "Could not check the library."
            : eduPub > 0
                ? `${eduPub} published${eduDraft > 0 ? `, ${eduDraft} still in draft (drafts are invisible to patients)` : ""}`
                : (eduDraft > 0 ? `${eduDraft} draft(s) only — patients see nothing until they are published.` : "No education materials yet."),
    });

    // ---- 10. Background jobs ---------------------------------------------
    // Proven by evidence of a run, not by the code existing.
    // The worker writes user_id NULL and stamps user_agent 'mountzara-cron'
    // (cron-worker/index.js:135, triage/auto-release.js:172). Matching on
    // user_id — twice now — reported "not deployed" no matter the truth,
    // which trains an operator to ignore the row. Freshness matters too:
    // having run once is not the same as running.
    let cronRuns = UNRESOLVED, cronLast = null, sweepRuns = 0;
    try {
        const r = await env.DB.prepare(
            `SELECT COUNT(*) n, MAX(ts) last FROM audit_log
              WHERE user_agent = 'mountzara-cron' OR user_id IN ('sweep','auto','cron','pipeline')`).first();
        cronRuns = r ? Number(r.n) || 0 : 0;
        cronLast = r && r.last ? Number(r.last) : null;
        const sw = await env.DB.prepare(
            `SELECT COUNT(*) n FROM audit_log WHERE action = 'order_sweep' AND user_id = 'sweep'`).first();
        sweepRuns = sw ? Number(sw.n) || 0 : 0;
    } catch { cronRuns = UNRESOLVED; }
    const cronFresh = cronLast && (Date.now() - cronLast) < 36 * 3600 * 1000;
    add({
        id: "cron",
        title: "Deploy the background worker",
        why: "It chases overdue results, releases triage after four hours, and sweeps message deadlines. Without it, those only happen when someone clicks.",
        href: "/admin/orders/",
        blocking: false,
        // A worker that runs but predates the result sweep is a real state,
        // and calling it simply "done" would hide the one job that guards
        // against a missed result.
        status: cronRuns === UNRESOLVED ? UNKNOWN
            : cronRuns === 0 ? TODO
            : (sweepRuns > 0 && cronFresh) ? DONE : ATTN,
        detail: cronRuns === UNRESOLVED ? "Could not check the audit log."
            : cronRuns === 0 ? "No background run has ever been recorded."
            : sweepRuns === 0
                ? `A worker is running (${cronRuns} recorded run(s)), but the overdue-result sweep has never run from it — redeploy the worker to pick it up.`
                : cronFresh ? `Running — ${cronRuns} recorded run(s), including the result sweep`
                : `${cronRuns} run(s) recorded but nothing recent — the worker may have stopped.`,
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

    // ---- 11b. The transcription app ---------------------------------------
    // Proven by data it alone can produce: an encounter or claim whose
    // session id is not one of the known test fixtures. The seam was
    // "wired" for three months while three separate defects meant it had
    // never actually worked once — connected is a claim about evidence.
    let appEnc = UNRESOLVED;
    try {
        const r = await env.DB.prepare(`
            SELECT COUNT(*) n FROM encounters
             WHERE transcription_session_id IS NOT NULL
               AND transcription_session_id NOT LIKE 'test-%'
               AND transcription_session_id NOT LIKE 'ios-test%'
               AND transcription_session_id NOT LIKE 'sw-test%'
               AND transcription_session_id NOT LIKE 'e2e-%'`).first();
        appEnc = r ? Number(r.n) || 0 : 0;
    } catch { appEnc = UNRESOLVED; }
    add({
        id: "transcription_app",
        title: "Connect the Medical Transcription app",
        why: "Dictate a visit and the note, coding, orders and the patient's summary all flow here on their own — no re-typing. Until it connects, every note is manual.",
        href: "/admin/visits/",
        blocking: false,
        status: appEnc === UNRESOLVED ? UNKNOWN : (appEnc > 0 ? DONE : TODO),
        detail: appEnc === UNRESOLVED ? "Could not check for synced encounters."
            : appEnc > 0 ? `${appEnc} real encounter(s) synced from the app`
            : "The app has never synced a real visit. Its token and setup steps are in docs/transcription-app-integration.md.",
    });

    // ---- 12. Open the doors ------------------------------------------------
    const launched = String(env.PORTAL_PUBLIC_LAUNCH || "false").trim().toLowerCase() === "true";
    const patients = await count(env, `SELECT COUNT(*) n FROM patients`);
    add({
        id: "launch",
        title: "Open the portal to patients",
        why: "Until this is on, the portal answers only to you — a patient reaching it gets a coming-soon page and cannot sign up or sign in. That is correct while you are setting up, and wrong the day you open.",
        href: "/admin/",
        // Blocking on purpose: reporting a practice "ready to see patients"
        // while every patient hitting the portal gets a closed door means
        // discovering the gap from a phone call.
        blocking: true,
        status: launched ? DONE : TODO,
        detail: launched
            ? `Open to the public. ${patients === UNRESOLVED ? "?" : patients} patient record(s).`
            : `Preview only — you can see and test everything; the public cannot sign up or sign in. ${patients === UNRESOLVED ? "?" : patients} patient record(s) exist.`,
    });

    const blocking = steps.filter((s) => s.blocking);
    const blockingLeft = blocking.filter((s) => s.status !== DONE);   // unknown counts as not done
    const doorsOpen = String(env.PORTAL_PUBLIC_LAUNCH || "false").trim().toLowerCase() === "true";
    return {
        steps,
        summary: {
            total: steps.length,
            done: steps.filter((s) => s.status === DONE).length,
            attention: steps.filter((s) => s.status === ATTN).length,
            todo: steps.filter((s) => s.status === TODO).length,
            unknown: steps.filter((s) => s.status === UNKNOWN).length,
            blocking_remaining: blockingLeft.length,
            doors_open: doorsOpen,
            // Honest headline: every blocking step provably done. An
            // unverifiable step is not a done step.
            ready_to_see_patients: blockingLeft.length === 0,
            mode: blockingLeft.length > 0 ? "setup" : (doorsOpen ? "steady" : "ready_closed"),
            next: (blockingLeft[0] || steps.find((s) => s.status !== DONE) || null),
        },
    };
}

export default { computeSetup };
