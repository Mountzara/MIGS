// =====================================================================
// test_clearinghouse_onboarding.mjs
// =====================================================================
// The wizard's logic lives server-side precisely so it can be tested
// without a browser. These assertions cover the parts that would fail
// silently and expensively: a bad NPI reaching a payer, a vendor scored
// backwards for a government-heavy practice, a checklist rebuild wiping
// weeks of recorded enrollment progress, and go-live opening while a
// payer is still unenrolled.
//
//   node scripts/test_clearinghouse_onboarding.mjs
// =====================================================================

import {
    npiValid, zip9Valid, tinValid, taxonomyValid, validateProfile,
    scoreVendors, pairingAdvice, buildApplicationPacket,
    buildEnrollmentMatrix, enrollmentSummary, enrollmentDefaultsFor,
    readiness, vendorReadiness, routingPlan, validateVendorSet,
    VENDOR_FACTS, STEPS,
} from "../functions/_lib/clearinghouse_onboarding.js";

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.error(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------------
section("NPI check digit (CMS spec: Luhn over 80840 + NPI)");
// Known-good NPIs, verified by the published algorithm.
ok(npiValid("1234567893"), "1234567893 is valid");
ok(npiValid("1245319599"), "1245319599 is valid");
ok(!npiValid("1234567890"), "wrong check digit rejected");
ok(!npiValid("123456789"), "nine digits rejected");
ok(!npiValid("12345678933"), "eleven digits rejected");
ok(!npiValid(""), "empty rejected");
// The failure this actually guards against: a transposition.
ok(!npiValid("1234567839"), "transposed final digits rejected");

section("Other field validators");
ok(zip9Valid("60611-1234"), "ZIP+4 accepted");
ok(!zip9Valid("60611"), "five-digit ZIP rejected — Medicare rejects these");
ok(!zip9Valid("60611-12"), "short +4 rejected");
ok(tinValid("36-1234567"), "EIN with dash accepted");
ok(tinValid("361234567"), "EIN without dash accepted");
ok(!tinValid("3612345"), "short TIN rejected");
ok(taxonomyValid("207V00000X"), "OB/GYN taxonomy accepted");
ok(!taxonomyValid("207V0000"), "short taxonomy rejected");

// ---------------------------------------------------------------------
section("Profile validation");

const goodProfile = {
    legal_name: "Christopher Mabini DO PC",
    entity_type: "pc",
    tin: "361234567",
    npi_individual: "1234567893",
    npi_group: "1245319599",
    taxonomy_code: "207V00000X",
    license_state: "IL", license_number: "036-000000",
    practice_street: "1 N State St", practice_city: "Chicago",
    practice_state: "IL", practice_zip: "60602-3300",
    contact_name: "Christopher Mabini", contact_phone: "312-555-0100",
    contact_email: "billing@mountzara.com",
};

let v = validateProfile(goodProfile);
ok(v.ok, "a complete profile validates");
ok(v.complete_ratio === 1, "complete_ratio is 1 when nothing is missing");

v = validateProfile({ ...goodProfile, npi_individual: "1234567890" });
ok(!v.ok && v.invalid.some((i) => i.key === "npi_individual"), "bad individual NPI is caught");

v = validateProfile({ ...goodProfile, practice_zip: "60602" });
ok(!v.ok && v.invalid.some((i) => i.key === "practice_zip"), "five-digit ZIP is caught");

v = validateProfile({ ...goodProfile, legal_name: "" });
ok(!v.ok && v.missing.some((m) => m.key === "legal_name"), "missing legal name is caught");

// The conditional: a sole proprietor is not nagged for a group NPI.
v = validateProfile({ ...goodProfile, entity_type: "sole_proprietor", npi_group: "" });
ok(v.ok, "sole proprietor does not require a group NPI");
v = validateProfile({ ...goodProfile, entity_type: "pc", npi_group: "" });
ok(!v.ok && v.missing.some((m) => m.key === "npi_group"), "a PC does require a group NPI");

// A present-but-wrong optional NPI must still be rejected.
v = validateProfile({ ...goodProfile, entity_type: "sole_proprietor", npi_group: "1111111111" });
ok(v.invalid.some((i) => i.key === "npi_group"), "an optional-but-present group NPI is still checked");

// ---------------------------------------------------------------------
section("Vendor scoring");

const govHeavy = { states: ["IL", "CA"], government_share: "lots", volume: "low",
                   automation: "max", eligibility: "yes" };
let ranked = scoreVendors(govHeavy);
ok(ranked.length === Object.keys(VENDOR_FACTS).length, "every vendor is scored");
ok(ranked[0].score >= ranked[ranked.length - 1].score, "results are sorted descending");
ok(ranked.every((r) => r.reasons.length > 0), "every vendor carries its reasons — a score with no rationale is not auditable");

const avail = ranked.find((r) => r.vendor === "availity");
ok(avail.reasons.some((r) => !r.good && /government/i.test(r.text)),
   "Availity is penalised and EXPLAINED for a government-heavy practice");

const waystar = ranked.find((r) => r.vendor === "waystar");
ok(waystar.reasons.some((r) => !r.good && /enterprise/i.test(r.text)),
   "enterprise vendors are penalised at solo volume");

ok(["claim_md", "stedi"].includes(ranked[0].vendor),
   `a low-volume, government-heavy, automation-max practice tops out at a small-practice vendor (got ${ranked[0].vendor})`);

// A portal-first, commercial-only practice should rank differently — if it
// does not, the scoring is not actually reading the answers.
const portalOnly = { states: ["IL"], government_share: "none", volume: "low",
                     automation: "portal", eligibility: "yes" };
const ranked2 = scoreVendors(portalOnly);
ok(ranked2[0].vendor !== ranked[0].vendor || ranked2[0].score !== ranked[0].score,
   "different answers produce a different ranking");

const stediPortal = ranked2.find((r) => r.vendor === "stedi");
ok(stediPortal.reasons.some((r) => !r.good && /API-first/i.test(r.text)),
   "Stedi is penalised when the operator does not want to integrate");

// Unverified vendors must say so rather than being silently ranked.
const cheOnly = ranked.find((r) => r.vendor === "change_healthcare");
ok(cheOnly.reasons.some((r) => /not verified/i.test(r.text)),
   "an unverified vendor's uncertainty is surfaced, not hidden");
ok(ranked.every((r) => r.cost_verified === false),
   "no vendor claims verified pricing — pricing is never invented");

section("Pairing advice");
const pair = pairingAdvice(govHeavy, ranked);
ok(pair.suggest === true, "eligibility + government mix suggests running Availity alongside");
ok(pair.secondary === "availity", "the suggested second account is Availity");
const noPair = pairingAdvice({ ...govHeavy, eligibility: "no" }, ranked);
ok(noPair.suggest === false, "no pairing suggested when eligibility is not needed");

// ---------------------------------------------------------------------
section("Application packet");

let packet = buildApplicationPacket(goodProfile, "claim_md", { tin: null });
ok(packet.vendor_label === "Claim.MD", "packet names the vendor");
ok(packet.fields.some((f) => f.label.includes("Legal business name") && f.value === goodProfile.legal_name),
   "legal name is carried through verbatim");
const tinField = packet.fields.find((f) => f.secret);
ok(tinField.value === "" || tinField.value.startsWith("•"), "TIN is masked when not revealed");
ok(tinField.revealed === false, "TIN reports itself as unrevealed");

packet = buildApplicationPacket({ ...goodProfile, tin_last4: "4567" }, "claim_md", { tin: "361234567" });
ok(packet.fields.find((f) => f.secret).value === "361234567", "TIN appears only when explicitly revealed");
ok(packet.fields.find((f) => f.secret).revealed === true, "revealed TIN is flagged as such");

ok(packet.warnings.some((w) => /PTAN/i.test(w)), "a missing Medicare PTAN is warned about");
packet = buildApplicationPacket({ ...goodProfile, practice_zip: "60602" }, "claim_md");
ok(packet.warnings.some((w) => /ZIP/i.test(w)), "a five-digit ZIP is warned about in the packet too");

ok(packet.turnaround_days === null && /does not publish/i.test(packet.turnaround_note),
   "no turnaround is invented when the vendor publishes none");
ok(packet.confirm_tasks.length >= 3, "unverifiable items become explicit confirm tasks");

// Pay-to defaulting.
ok(buildApplicationPacket(goodProfile, "claim_md").fields
    .find((f) => f.label === "Pay-to address").value === "Same as service facility",
   "an empty pay-to block falls back to the practice address");

// ---------------------------------------------------------------------
section("Payer EDI enrollment matrix");

ok(enrollmentDefaultsFor({ payer_kind: "medicare" }).edi_required === 1,
   "Medicare requires an EDI agreement");
ok(enrollmentDefaultsFor({ payer_kind: "medicaid" }).edi_required === 1,
   "Medicaid requires an EDI agreement");
ok(enrollmentDefaultsFor({ payer_kind: "commercial" }).edi_required === 0,
   "commercial claim submission is not gated on a separate EDI agreement");
ok(enrollmentDefaultsFor({ payer_kind: "commercial" }).era_required === 1,
   "commercial remittance delivery still needs its own enrollment");

const payers = [
    { name: "Medicare Part B — Illinois (NGS, J6)", kind: "medicare" },
    { name: "Illinois Medicaid (HFS)", kind: "medicaid" },
    { name: "Aetna", kind: "commercial" },
];
let matrix = buildEnrollmentMatrix("claim_md", payers, []);
ok(matrix.length === 3, "a row per payer");
ok(matrix.every((r) => r.status === "not_started"), "fresh rows start not_started");

// THE regression that matters: a rebuild must never discard recorded work.
const withProgress = matrix.map((r) =>
    r.payer_name === "Aetna" ? { ...r, status: "approved", reference_number: "TKT-44812" } : r);
const rebuilt = buildEnrollmentMatrix("claim_md", payers, withProgress);
const aetna = rebuilt.find((r) => r.payer_name === "Aetna");
ok(aetna.status === "approved", "rebuilding the checklist preserves an approved row");
ok(aetna.reference_number === "TKT-44812", "rebuilding preserves the recorded reference number");

// A payer added to the directory later must appear without disturbing the rest.
const grown = buildEnrollmentMatrix("claim_md", payers.concat([{ name: "Cigna", kind: "commercial" }]), withProgress);
ok(grown.length === 4, "a newly added payer appears on rebuild");
ok(grown.find((r) => r.payer_name === "Aetna").status === "approved", "…without resetting existing progress");

section("Enrollment summary");
let sum = enrollmentSummary(rebuilt);
ok(sum.total === 3, "counts every row");
ok(sum.blocking === 2, "only EDI-required rows that are unapproved block go-live");
sum = enrollmentSummary(rebuilt.map((r) => ({ ...r, status: "approved" })));
ok(sum.blocking === 0, "nothing blocks once every EDI enrollment is approved");
sum = enrollmentSummary(rebuilt.map((r) => ({ ...r, status: "not_required" })));
ok(sum.blocking === 0, "a payer marked not_required does not block");

// ---------------------------------------------------------------------
section("Vendor set validation");

const V = (vendor, over = {}) => ({ vendor, role: "both", is_primary: false, ...over });

let vs = validateVendorSet([], {});
ok(!vs.ok && /No clearinghouse selected/.test(vs.problems[0]), "an empty set is rejected");

vs = validateVendorSet([V("availity")], { government_share: "lots" });
ok(!vs.ok && vs.problems.some((p) => /Medicare or Medicaid/.test(p)),
   "Availity ALONE is rejected for a government practice — the expensive mistake this exists to catch");

vs = validateVendorSet([V("availity")], { government_share: "none" });
ok(vs.ok, "Availity alone is fine for a purely commercial practice");

vs = validateVendorSet([V("claim_md", { is_primary: true }), V("availity", { role: "eligibility" })], { government_share: "lots" });
ok(vs.ok, "the standard pair — full-service for claims plus Availity for eligibility — validates");
ok(vs.notes.some((n) => /2 clearinghouses/.test(n)), "a multi-vendor set explains that each needs its own enrollment");

vs = validateVendorSet([V("availity", { role: "eligibility" })], {});
ok(!vs.ok && vs.problems.some((p) => /eligibility only/.test(p)),
   "a set that can submit nothing is rejected");

vs = validateVendorSet([V("claim_md")], {});
ok(vs.ok && vs.notes.some((n) => /No primary/.test(n)), "a missing primary is a note, not a blocker");

section("Routing across multiple clearinghouses");

let plan = routingPlan([V("claim_md", { is_primary: true }), V("availity", { role: "eligibility" })]);
ok(plan.routing.medicare === "claim_md", "Medicare routes to the full-service clearinghouse");
ok(plan.routing.medicaid === "claim_md", "Medicaid routes to the full-service clearinghouse");
ok(plan.routing.commercial === "claim_md", "commercial routes to the primary");
ok(plan.routing.eligibility === "availity", "eligibility routes to Availity — the reason to hold the account");
ok(plan.gaps.length === 0, "the standard pair has no routing gaps");

// Availity must never silently become the government route.
plan = routingPlan([V("availity", { is_primary: true })]);
ok(plan.routing.medicare === null && plan.gaps.some((g) => /medicare/i.test(g)),
   "Availity alone leaves a NAMED government gap rather than silently routing Medicare to it");

plan = routingPlan([V("stedi", { is_primary: true }), V("claim_md")]);
ok(plan.routing.commercial === "stedi", "the primary takes unrouted commercial");
ok(["stedi", "claim_md"].includes(plan.routing.medicare), "government goes to a capable vendor");

plan = routingPlan([]);
ok(plan.gaps.length >= 2, "an empty set reports its gaps rather than pretending to be routed");

section("Per-vendor readiness");

const enrApproved = rebuilt.map((r) => ({ ...r, status: "approved" }));
let vr = vendorReadiness({
    vendor: "claim_md", role: "both", is_primary: true,
    credentials: { last_test_ok: true }, enrollment: enrApproved, lastTestClaim: { ok: true },
});
ok(vr.ready, "a fully set-up vendor is ready");

vr = vendorReadiness({ vendor: "claim_md", role: "both", credentials: null, enrollment: [], lastTestClaim: null });
ok(!vr.ready && vr.blockers.length >= 2, "an untouched vendor reports several blockers");

// An eligibility-only vendor is never asked for a test claim.
vr = vendorReadiness({ vendor: "availity", role: "eligibility",
                       credentials: { last_test_ok: true }, enrollment: [], lastTestClaim: null });
ok(vr.ready, "an eligibility-only vendor does not need a test claim");
ok(!vr.blockers.some((b) => /test claim/.test(b)), "…and is not told it needs one");

section("Readiness gating across the whole set");

function state(over) {
    return Object.assign({
        profile: goodProfile,
        onboarding: {},
        answers: { government_share: "lots", eligibility: "yes" },
        vendors: [
            { vendor: "claim_md", role: "both", is_primary: true,
              credentials: { last_test_ok: true, last_test_at: "2026-08-13T00:00:00Z" },
              enrollment: enrApproved, lastTestClaim: { ok: true } },
            { vendor: "availity", role: "eligibility", is_primary: false,
              credentials: { last_test_ok: true, last_test_at: "2026-08-13T00:00:00Z" },
              enrollment: [], lastTestClaim: null },
        ],
        liveMode: false,
    }, over);
}

let rd = readiness(state());
ok(rd.can_go_live === true, "a fully configured two-clearinghouse setup opens go-live");
ok(rd.steps.length === STEPS.length, "readiness reports every step");
ok(rd.per_vendor.length === 2, "per-vendor readiness is reported for each clearinghouse");
ok(rd.routing.eligibility === "availity", "readiness carries the routing plan");

// THE multi-vendor regression: one good vendor must not vouch for the other.
rd = readiness(state({
    vendors: [
        { vendor: "claim_md", role: "both", is_primary: true,
          credentials: { last_test_ok: true }, enrollment: enrApproved, lastTestClaim: { ok: true } },
        { vendor: "stedi", role: "both", is_primary: false,
          credentials: null, enrollment: [], lastTestClaim: null },
    ],
}));
ok(!rd.can_go_live, "one verified clearinghouse does NOT let an unverified second one through");
ok(rd.steps.find((s) => s.key === "golive").blockers.some((b) => /Stedi/.test(b)),
   "…and the blocker names which clearinghouse is at fault");
ok(rd.steps.find((s) => s.key === "credentials").detail.includes("Stedi"),
   "the credentials step names the unverified vendor");

// A removed vendor stops counting.
rd = readiness(state({
    vendors: state().vendors.concat([
        { vendor: "waystar", role: "both", removed_at: "2026-08-01T00:00:00Z",
          credentials: null, enrollment: [], lastTestClaim: null },
    ]),
}));
ok(rd.can_go_live === true, "a removed clearinghouse no longer blocks go-live");
ok(rd.per_vendor.length === 2, "…and is excluded from per-vendor readiness");

// Availity-only must be caught at the readiness level too, not just validation.
rd = readiness(state({
    vendors: [{ vendor: "availity", role: "both", is_primary: true,
                credentials: { last_test_ok: true }, enrollment: [], lastTestClaim: { ok: true } }],
}));
ok(!rd.can_go_live, "Availity alone cannot go live for a government practice");

rd = readiness(state({ profile: { ...goodProfile, legal_name: "" } }));
ok(!rd.can_go_live && rd.steps.find((s) => s.key === "golive").blockers.some((b) => /identity/i.test(b)),
   "an incomplete profile blocks go-live, and says why");

rd = readiness({ profile: {}, onboarding: {}, vendors: [] });
ok(rd.current_step === "profile", "an empty setup starts at step 1");
ok(rd.steps.find((s) => s.key === "selection").done === false, "no vendors leaves step 2 open");

rd = readiness(state({ profile: {} }));
ok(rd.steps.every((s) => typeof s.detail === "string" && s.detail.length > 0),
   "every step reports a human-readable reason, never a bare false");

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
