// =====================================================================
// clearinghouse_onboarding.js — the setup wizard's engine
// =====================================================================
// The go-live page used to be a paragraph telling the physician to go
// enroll somewhere and come back. This module is the difference between
// that and a wizard: it holds the field specs, the validation, the vendor
// scoring, the application field-mapping, and the per-payer EDI matrix, so
// the UI is a thin renderer over real logic that can be tested.
//
// DOCTRINE — inherited from credentialing_wizard.js, and it applies with
// even more force here. This module NEVER asserts a requirement a vendor
// does not publish. Vendor enrollment terms, pricing and API endpoints
// change without notice, and a wizard that confidently prints a stale
// requirement wastes weeks. So every vendor fact carries a `verified`
// flag and a source URL. Unverified items surface as "confirm with the
// vendor" tasks, visually separated from sourced ones, exactly the way
// the payer credentialing wizard separates them.
//
// NO INVENTED PRICING. Clearinghouse pricing is negotiated, tiered, and
// frequently unpublished. This module carries a qualitative posture
// ("priced for small practices") and tells the operator to confirm. It
// does not print a dollar figure it cannot source.
//
// AI IS OPTIONAL HERE, ON PURPOSE. Everything on the critical path --
// which vendor, which fields, which payers need EDI enrollment -- is
// deterministic data. AI is used only for genuinely generative work
// (drafting a cover note, explaining a rejection), and every one of those
// paths degrades to a usable non-AI result. A setup wizard that cannot
// finish because a language model is unreachable is not a wizard.
// =====================================================================

// ---------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------

export const STEPS = [
    { key: "profile",     n: 1, title: "Practice identity",
      blurb: "Every form below is filled from this. Enter it once." },
    { key: "selection",   n: 2, title: "Choose a clearinghouse",
      blurb: "Scored against your states, payer mix and volume." },
    { key: "packet",      n: 3, title: "Enrollment packet",
      blurb: "Your application values, and the per-payer EDI checklist." },
    { key: "credentials", n: 4, title: "Credentials",
      blurb: "Enter what the vendor issued, then test the connection." },
    { key: "testclaim",   n: 5, title: "Test claim",
      blurb: "Submit a test 837 and read the 277CA back." },
    { key: "golive",      n: 6, title: "Go live",
      blurb: "Flip to production. Gated on everything above." },
];

export function stepIndex(key) {
    return STEPS.findIndex((s) => s.key === key);
}

// ---------------------------------------------------------------------
// Practice identity — the field specs the whole wizard reuses
// ---------------------------------------------------------------------
// `required` means "no clearinghouse application can be completed without
// it". `conditional` fields are required only when a condition holds, so
// the wizard does not nag a sole proprietor for a group NPI he does not
// have.

export const PROFILE_FIELDS = [
    { key: "legal_name",     label: "Legal business name",  group: "identity", required: true,
      help: "Exactly as it appears on your W-9 / IRS record. A mismatch here is the single most common reason an EDI enrollment is rejected." },
    { key: "dba_name",       label: "Practice / DBA name",  group: "identity",
      help: "Leave blank if you bill under the legal name." },
    { key: "entity_type",    label: "Entity type",          group: "identity", required: true,
      options: [["sole_proprietor","Sole proprietor"],["llc","LLC"],["pc","Professional corporation"],["corp","Corporation"]] },
    { key: "tin",            label: "Tax ID (EIN or SSN)",  group: "identity", required: true, secret: true,
      help: "Stored encrypted. Only the last four digits are ever displayed." },

    { key: "npi_individual", label: "Individual NPI (Type 1)", group: "ids", required: true,
      help: "Your personal 10-digit NPI. Validated with the official check digit." },
    { key: "npi_group",      label: "Group NPI (Type 2)",   group: "ids",
      conditional: "entity_type != sole_proprietor",
      help: "Required when you bill under an entity rather than yourself." },
    { key: "taxonomy_code",  label: "Taxonomy code",        group: "ids", required: true,
      placeholder: "207V00000X",
      help: "207V00000X is Obstetrics & Gynecology. 207VX0201X is Gynecologic Oncology; 207VF0040X is Female Pelvic Medicine & Reconstructive Surgery. Use the one on your NPPES record." },
    { key: "license_state",  label: "License state",        group: "ids", required: true },
    { key: "license_number", label: "License number",       group: "ids", required: true },
    { key: "medicare_ptan",  label: "Medicare PTAN",        group: "ids",
      help: "Issued by your MAC when Medicare enrollment completed. Required before Medicare EDI enrollment, not before choosing a clearinghouse." },
    { key: "medicaid_id",    label: "Medicaid provider ID", group: "ids",
      help: "State-issued. Separate per state." },
    { key: "caqh_id",        label: "CAQH ProView ID",      group: "ids",
      help: "Not used by clearinghouses, but most commercial payers pull from it. Recorded here so it is in one place." },

    { key: "practice_street",  label: "Practice street",    group: "practice", required: true },
    { key: "practice_street2", label: "Suite / unit",       group: "practice" },
    { key: "practice_city",    label: "City",               group: "practice", required: true },
    { key: "practice_state",   label: "State",              group: "practice", required: true },
    { key: "practice_zip",     label: "ZIP+4",              group: "practice", required: true,
      placeholder: "60611-1234",
      help: "The full nine digits. Medicare rejects professional claims whose service-facility ZIP is only five digits." },

    { key: "payto_street",   label: "Pay-to street",        group: "payto" },
    { key: "payto_street2",  label: "Suite / unit",         group: "payto" },
    { key: "payto_city",     label: "City",                 group: "payto" },
    { key: "payto_state",    label: "State",                group: "payto" },
    { key: "payto_zip",      label: "ZIP+4",                group: "payto",
      help: "Leave the pay-to block blank to reuse the practice address." },

    { key: "contact_name",   label: "Contact name",         group: "contact", required: true },
    { key: "contact_title",  label: "Title",                group: "contact" },
    { key: "contact_phone",  label: "Phone",                group: "contact", required: true },
    { key: "contact_fax",    label: "Fax",                  group: "contact",
      help: "Several Medicaid EDI units still return enrollment approvals by fax only." },
    { key: "contact_email",  label: "Email",                group: "contact", required: true },
];

export const PROFILE_GROUPS = [
    { key: "identity", title: "Legal identity",     blurb: "What the IRS and the payers have on file." },
    { key: "ids",      title: "Provider identifiers", blurb: "Your NPI, taxonomy and state credentials." },
    { key: "practice", title: "Practice address",   blurb: "Where care is delivered." },
    { key: "payto",    title: "Pay-to address",     blurb: "Where payment is sent, if different." },
    { key: "contact",  title: "Enrollment contact", blurb: "Who the clearinghouse and payers will call." },
];

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

/**
 * NPI check digit, per the CMS specification: Luhn over the 10-digit NPI
 * prefixed with the 80840 issuer identifier. This catches transposed
 * digits at entry rather than six weeks later in a rejection letter.
 */
export function npiValid(npi) {
    const s = String(npi || "").replace(/\D/g, "");
    if (s.length !== 10) return false;
    const body = "80840" + s.slice(0, 9);
    let sum = 0;
    // Double every second digit counting from the right of `body`.
    for (let i = 0; i < body.length; i++) {
        let d = Number(body[body.length - 1 - i]);
        if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
    }
    const check = (10 - (sum % 10)) % 10;
    return check === Number(s[9]);
}

export function zip9Valid(z) {
    return /^\d{5}-\d{4}$/.test(String(z || "").trim());
}
export function tinValid(t) {
    const s = String(t || "").replace(/\D/g, "");
    return s.length === 9;
}
export function taxonomyValid(t) {
    // 10 characters, alphanumeric, ending in a letter or digit. NUCC codes
    // are 10 chars; we check shape only, not membership in the code set,
    // because the set changes twice a year and we will not ship a stale copy.
    return /^[0-9A-Za-z]{10}$/.test(String(t || "").trim());
}
export function emailValid(e) {
    return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(e || "").trim());
}

function conditionHolds(cond, profile) {
    if (!cond) return true;
    const m = /^(\w+)\s*(!=|==)\s*(.+)$/.exec(cond);
    if (!m) return true;
    const [, key, op, raw] = m;
    const want = raw.trim();
    const have = String(profile?.[key] ?? "").trim();
    return op === "==" ? have === want : have !== want;
}

/**
 * @returns {{ok, missing:[{key,label}], invalid:[{key,label,why}], complete_ratio}}
 */
export function validateProfile(profile = {}) {
    const missing = [];
    const invalid = [];
    let applicable = 0;
    let filled = 0;

    for (const f of PROFILE_FIELDS) {
        const isRequired = f.required || (f.conditional && conditionHolds(f.conditional, profile));
        if (!isRequired) continue;
        applicable++;
        const raw = f.key === "tin" ? (profile.tin || profile.tin_last4) : profile[f.key];
        const v = String(raw ?? "").trim();
        if (!v) { missing.push({ key: f.key, label: f.label }); continue; }
        filled++;

        if ((f.key === "npi_individual" || f.key === "npi_group") && !npiValid(v)) {
            invalid.push({ key: f.key, label: f.label, why: "fails the NPI check digit — re-read it from your NPPES record" });
        }
        if (f.key === "practice_zip" && !zip9Valid(v)) {
            invalid.push({ key: f.key, label: f.label, why: "needs the full ZIP+4, e.g. 60611-1234" });
        }
        if (f.key === "tin" && profile.tin && !tinValid(profile.tin)) {
            invalid.push({ key: f.key, label: f.label, why: "an EIN or SSN is nine digits" });
        }
        if (f.key === "taxonomy_code" && !taxonomyValid(v)) {
            invalid.push({ key: f.key, label: f.label, why: "a NUCC taxonomy code is 10 characters, e.g. 207V00000X" });
        }
        if (f.key === "contact_email" && !emailValid(v)) {
            invalid.push({ key: f.key, label: f.label, why: "not a valid email address" });
        }
    }

    // Optional NPI still gets checked when present — a wrong group NPI is
    // worse than an absent one.
    if (profile.npi_group && !npiValid(profile.npi_group)
        && !invalid.some((i) => i.key === "npi_group")) {
        invalid.push({ key: "npi_group", label: "Group NPI (Type 2)", why: "fails the NPI check digit" });
    }

    return {
        ok: missing.length === 0 && invalid.length === 0,
        missing, invalid,
        complete_ratio: applicable ? Math.round((filled / applicable) * 100) / 100 : 0,
    };
}

// ---------------------------------------------------------------------
// Vendor knowledge
// ---------------------------------------------------------------------
// Each entry describes what enrollment with that vendor actually involves.
// `verified: true` means the claim is checkable against the cited source.
// Anything softer is `verified: false` and reaches the operator as a
// "confirm this" task, never as an assertion.

export const VENDOR_FACTS = {
    claim_md: {
        label: "Claim.MD",
        signup_url: "https://www.claim.md/",
        docs_url: "https://www.claim.md/api/",
        strengths: [
            "Carries Medicare, Medicaid/Medi-Cal and commercial through one account",
            "Sold to small and solo practices without an enterprise contract",
            "REST API with a simple account-key auth, workable from a Worker",
        ],
        tradeoffs: [
            "Less polished developer documentation than Stedi",
        ],
        cost_posture: "Priced for small practices; per-provider monthly is typical.",
        cost_verified: false,
        auth_fields: [
            { key: "CLAIMMD_ACCOUNT_KEY", label: "Account key", secret: true,
              help: "Issued in your Claim.MD account once enrollment completes." },
        ],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "practice_address", "contact", "payer_list"],
        supports_era: true, supports_eft_help: true,
        turnaround_days: null,          // not published — do not invent one
        verified: true,
    },
    availity: {
        label: "Availity Essentials",
        signup_url: "https://www.availity.com/essentials",
        docs_url: "https://developer.availity.com/",
        strengths: [
            "Free real-time eligibility with the Blues — BCBS Illinois, Anthem Blue Cross and Blue Shield of California",
            "The default portal many commercial payers push providers toward",
            "OAuth2 API",
        ],
        tradeoffs: [
            "Practices commonly pair it with a second clearinghouse for claim submission",
            "Government payer coverage is narrower than a full-service clearinghouse",
        ],
        cost_posture: "Essentials tier is free for core transactions; premium tiers are paid.",
        cost_verified: false,
        auth_fields: [
            { key: "AVAILITY_CLIENT_ID", label: "Client ID", secret: false },
            { key: "AVAILITY_CLIENT_SECRET", label: "Client secret", secret: true },
        ],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "practice_address", "contact"],
        supports_era: true, supports_eft_help: false,
        turnaround_days: null,
        verified: true,
    },
    stedi: {
        label: "Stedi",
        signup_url: "https://www.stedi.com/",
        docs_url: "https://www.stedi.com/docs/healthcare",
        strengths: [
            "The cleanest API of the group — best fit if you want this pipeline fully automated",
            "Modern key auth, real X12 tooling, good errors",
        ],
        tradeoffs: [
            "The most engineering-heavy option; you own more of the integration",
        ],
        cost_posture: "Usage-based API pricing.",
        cost_verified: false,
        auth_fields: [
            { key: "STEDI_API_KEY", label: "API key", secret: true },
        ],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "contact"],
        supports_era: true, supports_eft_help: false,
        turnaround_days: null,
        verified: true,
    },
    office_ally: {
        label: "Office Ally",
        signup_url: "https://cms.officeally.com/",
        docs_url: "https://cms.officeally.com/",
        strengths: [
            "Long-standing low-cost option for small practices",
            "Very broad payer list",
        ],
        tradeoffs: [
            "Usually SFTP batch rather than REST — heavier to automate from a Worker",
            "Interface is dated",
        ],
        cost_posture: "Historically low-cost or free for primarily-commercial submitters; confirm current terms.",
        cost_verified: false,
        auth_fields: [
            { key: "OFFICEALLY_USER", label: "Username", secret: false },
            { key: "OFFICEALLY_PASS", label: "Password", secret: true },
        ],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "practice_address", "contact"],
        supports_era: true, supports_eft_help: true,
        turnaround_days: null,
        verified: false,
    },
    change_healthcare: {
        label: "Change Healthcare / Optum",
        signup_url: "https://www.changehealthcare.com/",
        docs_url: "https://developers.changehealthcare.com/",
        strengths: ["Very large network", "Mature APIs"],
        tradeoffs: [
            "Enterprise sales motion — heavy for a solo practice",
            "Confirm current onboarding posture directly; this vendor's access terms have moved repeatedly",
        ],
        cost_posture: "Enterprise contract.",
        cost_verified: false,
        auth_fields: [
            { key: "CHC_CLIENT_ID", label: "Client ID", secret: false },
            { key: "CHC_CLIENT_SECRET", label: "Client secret", secret: true },
        ],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "practice_address", "contact"],
        supports_era: true, supports_eft_help: true,
        turnaround_days: null,
        verified: false,
    },
    waystar: {
        label: "Waystar",
        signup_url: "https://www.waystar.com/",
        docs_url: "https://www.waystar.com/",
        strengths: ["Strong denial and remit tooling"],
        tradeoffs: ["Enterprise pricing and contract; oversized for one physician"],
        cost_posture: "Enterprise contract.",
        cost_verified: false,
        auth_fields: [{ key: "WAYSTAR_API_KEY", label: "API key", secret: true }],
        needs_at_signup: ["legal_name", "tin", "npi_individual", "practice_address", "contact"],
        supports_era: true, supports_eft_help: true,
        turnaround_days: null,
        verified: false,
    },
};

// ---------------------------------------------------------------------
// Step 2 — the interview, and the scoring it drives
// ---------------------------------------------------------------------

export const INTERVIEW = [
    { key: "states", type: "multi", question: "Which states will you bill in?",
      options: [["IL","Illinois"],["CA","California"],["other","Somewhere else"]] },
    { key: "government_share", type: "single",
      question: "Roughly how much of your volume will be Medicare or Medicaid?",
      options: [["none","Essentially none"],["some","Up to about a third"],["lots","More than a third"]] },
    { key: "volume", type: "single", question: "About how many claims a month?",
      options: [["low","Under 100"],["mid","100 to 500"],["high","Over 500"]] },
    { key: "automation", type: "single",
      question: "How much of this do you want running without you touching it?",
      options: [["max","Fully automated — API end to end"],
                ["mixed","Mostly automated, portal for exceptions"],
                ["portal","A portal is fine"]] },
    { key: "eligibility", type: "single",
      question: "Do you need real-time eligibility checks at booking?",
      options: [["yes","Yes — check before every visit"],["no","Not initially"]] },
];

/**
 * Score the vendors against the interview. Returns a ranked list, each
 * entry carrying the REASONS for its score, because a recommendation a
 * physician cannot audit is just an opinion with a number attached.
 */
export function scoreVendors(answers = {}) {
    const gov = answers.government_share || "some";
    const vol = answers.volume || "low";
    const auto = answers.automation || "mixed";
    const elig = answers.eligibility || "no";
    const states = Array.isArray(answers.states) ? answers.states : [];

    const out = [];
    for (const [vendor, f] of Object.entries(VENDOR_FACTS)) {
        let score = 0;
        const reasons = [];

        // Government payers are the discriminator for a solo practice.
        if (gov === "lots" || gov === "some") {
            if (vendor === "claim_md" || vendor === "office_ally" || vendor === "change_healthcare") {
                score += gov === "lots" ? 30 : 18;
                reasons.push({ good: true, text: "Carries Medicare and Medicaid alongside commercial in one account" });
            } else if (vendor === "availity") {
                score -= gov === "lots" ? 18 : 8;
                reasons.push({ good: false, text: "Government payer coverage is thinner — you would likely need a second clearinghouse for Medicare/Medicaid" });
            }
        }

        // Volume: enterprise vendors are a poor fit at low volume.
        if (vol === "low") {
            if (vendor === "claim_md" || vendor === "office_ally" || vendor === "stedi") {
                score += 20; reasons.push({ good: true, text: "Sold to small practices without an enterprise contract" });
            }
            if (vendor === "waystar" || vendor === "change_healthcare") {
                score -= 25; reasons.push({ good: false, text: "Enterprise sales and contract — oversized for a solo practice" });
            }
        } else if (vol === "high") {
            if (vendor === "waystar" || vendor === "change_healthcare") { score += 8; reasons.push({ good: true, text: "Built for high volume" }); }
        }

        // Automation appetite.
        if (auto === "max") {
            if (vendor === "stedi") { score += 25; reasons.push({ good: true, text: "Cleanest API of the group — least integration work for a fully automated pipeline" }); }
            if (vendor === "claim_md") { score += 12; reasons.push({ good: true, text: "Straightforward REST API, workable directly from a Worker" }); }
            if (vendor === "office_ally") { score -= 20; reasons.push({ good: false, text: "Typically SFTP batch rather than REST — significant extra work to automate" }); }
        } else if (auto === "portal") {
            if (vendor === "office_ally" || vendor === "availity") { score += 12; reasons.push({ good: true, text: "Mature web portal; no integration required to start" }); }
            if (vendor === "stedi") { score -= 15; reasons.push({ good: false, text: "API-first — less useful if you do not want to integrate" }); }
        }

        // Eligibility at booking.
        if (elig === "yes") {
            if (vendor === "availity") { score += 22; reasons.push({ good: true, text: "Free real-time eligibility with the Blues — the strongest reason to hold an Availity account" }); }
            if (vendor === "claim_md" || vendor === "stedi") { score += 8; reasons.push({ good: true, text: "Supports real-time eligibility" }); }
        }

        // Blues concentration in IL/CA.
        if (states.includes("IL") || states.includes("CA")) {
            if (vendor === "availity") { score += 10; reasons.push({ good: true, text: "BCBS Illinois and Anthem/Blue Shield California both route through Availity" }); }
        }

        if (!f.verified) {
            reasons.push({ good: false, text: "This vendor's current onboarding terms are not verified here — confirm directly before committing" });
            score -= 5;
        }

        out.push({ vendor, label: f.label, score, reasons,
                   cost_posture: f.cost_posture, cost_verified: f.cost_verified,
                   signup_url: f.signup_url, docs_url: f.docs_url,
                   strengths: f.strengths, tradeoffs: f.tradeoffs });
    }

    out.sort((a, b) => b.score - a.score);
    return out;
}

/**
 * Should he run two clearinghouses? For an IL/CA practice with Blues
 * concentration and government payers, that is genuinely the common
 * answer, and pretending there is one winner would be misleading.
 */
export function pairingAdvice(answers = {}, ranked = []) {
    const elig = answers.eligibility === "yes";
    const gov = answers.government_share;
    const top = ranked[0]?.vendor;
    if (elig && gov !== "none" && top && top !== "availity") {
        return {
            suggest: true,
            primary: top,
            secondary: "availity",
            why: "Availity's free real-time eligibility with the Blues is worth holding alongside a full-service clearinghouse. Many small practices run exactly this pair: one account for claims, Availity for eligibility. The system supports per-payer routing, so this is configurable rather than a compromise.",
        };
    }
    return { suggest: false };
}

// ---------------------------------------------------------------------
// Step 3 — the application packet
// ---------------------------------------------------------------------

function joinAddr(street, street2, city, state, zip) {
    const l1 = [street, street2].filter(Boolean).join(", ");
    const l2 = [city, state].filter(Boolean).join(", ");
    return [l1, [l2, zip].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

/**
 * Turn the stored profile into the exact values a clearinghouse
 * application asks for, labelled the way the forms label them. The point
 * is copy-and-paste: no hunting through a CV, no re-deriving the ZIP+4.
 *
 * `tin` is passed separately and only when the caller has decrypted it,
 * so this function can be used in contexts that must not see it.
 */
export function buildApplicationPacket(profile = {}, vendor, { tin = null } = {}) {
    const f = VENDOR_FACTS[vendor];
    const usePayto = Boolean(profile.payto_street);

    const fields = [
        { label: "Legal business name (as on W-9)", value: profile.legal_name || "" },
        { label: "Doing business as", value: profile.dba_name || profile.legal_name || "" },
        { label: "Entity type", value: ({
            sole_proprietor: "Sole proprietor", llc: "LLC",
            pc: "Professional corporation", corp: "Corporation",
          })[profile.entity_type] || profile.entity_type || "" },
        { label: "Tax ID (EIN/SSN)", value: tin || (profile.tin_last4 ? `•••••${profile.tin_last4}` : ""),
          secret: true, revealed: Boolean(tin) },
        { label: "Individual NPI (Type 1)", value: profile.npi_individual || "" },
        { label: "Group NPI (Type 2)", value: profile.npi_group || "— none, billing as individual —" },
        { label: "Taxonomy code", value: profile.taxonomy_code || "" },
        { label: "State license", value: [profile.license_state, profile.license_number].filter(Boolean).join(" ") },
        { label: "Medicare PTAN", value: profile.medicare_ptan || "— not yet issued —" },
        { label: "Medicaid provider ID", value: profile.medicaid_id || "— not yet issued —" },
        { label: "Service facility address", value: joinAddr(profile.practice_street, profile.practice_street2, profile.practice_city, profile.practice_state, profile.practice_zip) },
        { label: "Pay-to address", value: usePayto
            ? joinAddr(profile.payto_street, profile.payto_street2, profile.payto_city, profile.payto_state, profile.payto_zip)
            : "Same as service facility" },
        { label: "Contact", value: [profile.contact_name, profile.contact_title].filter(Boolean).join(", ") },
        { label: "Contact phone", value: profile.contact_phone || "" },
        { label: "Contact fax", value: profile.contact_fax || "— none —" },
        { label: "Contact email", value: profile.contact_email || "" },
    ];

    const warnings = [];
    if (!profile.medicare_ptan) {
        warnings.push("No Medicare PTAN recorded. You can open the clearinghouse account without it, but Medicare EDI enrollment cannot complete until your MAC issues one.");
    }
    if (!profile.npi_group && profile.entity_type && profile.entity_type !== "sole_proprietor") {
        warnings.push("You selected an entity type other than sole proprietor but recorded no group NPI. Most payers will expect the claim's billing provider to be the entity.");
    }
    if (profile.practice_zip && !zip9Valid(profile.practice_zip)) {
        warnings.push("The practice ZIP is not ZIP+4. Medicare rejects professional claims whose service-facility ZIP has only five digits.");
    }

    return {
        vendor,
        vendor_label: f?.label || vendor,
        signup_url: f?.signup_url || null,
        docs_url: f?.docs_url || null,
        vendor_verified: Boolean(f?.verified),
        cost_posture: f?.cost_posture || null,
        cost_verified: Boolean(f?.cost_verified),
        turnaround_days: f?.turnaround_days ?? null,
        turnaround_note: f?.turnaround_days == null
            ? "This vendor does not publish a turnaround. Ask for one in writing when you apply, and record it in the notes."
            : null,
        fields,
        warnings,
        confirm_tasks: [
            "Confirm current pricing directly with the vendor — pricing here is qualitative and unverified on purpose.",
            "Ask which of your payers require a separate EDI enrollment, and get the list in writing.",
            "Ask whether ERA (835) enrollment is separate from claim submission enrollment. It usually is.",
        ],
    };
}

// ---------------------------------------------------------------------
// Per-payer EDI enrollment matrix
// ---------------------------------------------------------------------
// This is the step that silently eats months. A clearinghouse account
// does not mean a payer will accept your claims: government payers and
// many Blues require their own EDI agreement first.
//
// `edi_required` below is a PLANNING DEFAULT derived from payer kind, not
// a sourced assertion about a specific payer. Every row is a "confirm
// with your clearinghouse" task, and the UI says so. The value is that
// nothing is forgotten, not that we know each payer's current rule.

export function enrollmentDefaultsFor(payer) {
    const kind = String(payer.payer_kind || payer.kind || "commercial").toLowerCase();
    if (kind === "medicare") {
        return { edi_required: 1, era_required: 1, eft_required: 1,
                 form_name: "EDI Enrollment / EDI Registration (via your MAC)",
                 note: "Medicare requires an EDI agreement with your MAC before a clearinghouse can submit on your behalf. Needs your PTAN." };
    }
    if (kind === "medicaid") {
        return { edi_required: 1, era_required: 1, eft_required: 1,
                 form_name: "State Medicaid EDI / trading partner agreement",
                 note: "State Medicaid programs and their managed-care plans each run their own EDI enrollment. Expect one per plan, not one per state." };
    }
    // Blues and large commercial frequently require ERA enrollment even
    // when claim submission works immediately.
    return { edi_required: 0, era_required: 1, eft_required: 0,
             form_name: "ERA (835) enrollment",
             note: "Claim submission usually works as soon as the clearinghouse account is live. Remittance delivery normally still needs its own enrollment." };
}

/**
 * Build the checklist rows for a vendor from a payer list. Existing rows
 * are preserved by name so re-running never destroys recorded progress.
 */
export function buildEnrollmentMatrix(vendor, payers = [], existing = []) {
    const byName = new Map(existing.map((e) => [e.payer_name, e]));
    return payers.map((p) => {
        const name = p.payer_name || p.name;
        const prior = byName.get(name);
        if (prior) return prior;
        const d = enrollmentDefaultsFor(p);
        return {
            vendor,
            payer_id: p.id || null,
            payer_name: name,
            payer_kind: p.payer_kind || p.kind || "commercial",
            edi_required: d.edi_required,
            era_required: d.era_required,
            eft_required: d.eft_required,
            form_name: d.form_name,
            form_url: null,
            status: "not_started",
            expected_days: null,
            note: d.note,
        };
    });
}

export function enrollmentSummary(rows = []) {
    const s = { total: rows.length, not_started: 0, in_progress: 0, submitted: 0,
                approved: 0, rejected: 0, not_required: 0, blocking: 0 };
    for (const r of rows) {
        const st = r.status || "not_started";
        if (st in s) s[st]++;
        // Only rows that actually gate claim submission block go-live.
        if (r.edi_required && st !== "approved" && st !== "not_required") s.blocking++;
    }
    return s;
}

// ---------------------------------------------------------------------
// Readiness across all six steps
// ---------------------------------------------------------------------

/**
 * The wizard's single source of truth for "where am I and what is next".
 * Each step reports done/blocked with a human reason — never a bare false.
 */
export function readiness(state = {}) {
    const {
        profile = {}, onboarding = {}, credentials = null,
        enrollment = [], lastTestClaim = null, liveMode = false,
    } = state;

    const pv = validateProfile(profile);
    const enr = enrollmentSummary(enrollment);
    const vendor = onboarding.selected_vendor || null;

    const steps = [];

    steps.push({
        key: "profile", done: pv.ok,
        detail: pv.ok ? "Complete."
            : pv.missing.length
                ? `${pv.missing.length} required field${pv.missing.length === 1 ? "" : "s"} still empty.`
                : `${pv.invalid.length} field${pv.invalid.length === 1 ? "" : "s"} need correcting.`,
        missing: pv.missing, invalid: pv.invalid, ratio: pv.complete_ratio,
    });

    steps.push({
        key: "selection", done: Boolean(vendor),
        blocked_by: pv.ok ? null : "profile",
        detail: vendor ? `${VENDOR_FACTS[vendor]?.label || vendor} selected.` : "No clearinghouse chosen yet.",
    });

    const packetDone = Boolean(onboarding.packet_done_at);
    steps.push({
        key: "packet", done: packetDone,
        blocked_by: vendor ? null : "selection",
        detail: !vendor ? "Choose a clearinghouse first."
            : enr.total === 0 ? "Payer checklist not built yet."
            : `${enr.approved}/${enr.total} payers approved · ${enr.blocking} still blocking.`,
        summary: enr,
    });

    const credsOk = Boolean(credentials?.last_test_ok);
    steps.push({
        key: "credentials", done: credsOk,
        blocked_by: vendor ? null : "selection",
        detail: !credentials ? "No credentials stored."
            : credentials.last_test_ok ? `Connection verified ${credentials.last_test_at || ""}.`
            : `Last test failed: ${credentials.last_test_detail || "no detail returned"}`,
    });

    const testOk = Boolean(lastTestClaim?.ok);
    steps.push({
        key: "testclaim", done: testOk,
        blocked_by: credsOk ? null : "credentials",
        detail: !lastTestClaim ? "No test claim submitted."
            : lastTestClaim.ok ? "Test claim accepted."
            : `Test claim rejected: ${lastTestClaim.detail || "see the 277CA"}`,
    });

    const goliveBlockers = [];
    if (!pv.ok) goliveBlockers.push("practice identity is incomplete");
    if (!vendor) goliveBlockers.push("no clearinghouse selected");
    if (!credsOk) goliveBlockers.push("credentials have not passed a connection test");
    if (!testOk) goliveBlockers.push("no accepted test claim");
    if (enr.blocking > 0) goliveBlockers.push(`${enr.blocking} payer EDI enrollment${enr.blocking === 1 ? "" : "s"} not approved`);

    steps.push({
        key: "golive", done: liveMode,
        blocked_by: goliveBlockers.length ? "prerequisites" : null,
        detail: liveMode ? "Live. Claims submit with usage indicator P."
            : goliveBlockers.length ? `Blocked: ${goliveBlockers.join("; ")}.`
            : "Ready. Nothing is blocking production submission.",
        blockers: goliveBlockers,
    });

    const firstOpen = steps.find((s) => !s.done);
    return {
        steps,
        current_step: firstOpen ? firstOpen.key : "golive",
        can_go_live: goliveBlockers.length === 0,
        percent: Math.round((steps.filter((s) => s.done).length / steps.length) * 100),
    };
}

export default {
    STEPS, stepIndex, PROFILE_FIELDS, PROFILE_GROUPS,
    npiValid, zip9Valid, tinValid, taxonomyValid, emailValid, validateProfile,
    VENDOR_FACTS, INTERVIEW, scoreVendors, pairingAdvice,
    buildApplicationPacket, enrollmentDefaultsFor, buildEnrollmentMatrix,
    enrollmentSummary, readiness,
};
