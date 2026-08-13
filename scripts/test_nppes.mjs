// =====================================================================
// test_nppes.mjs — the NPI-registry mapper, pinned to a REAL record
// =====================================================================
// The first version of this mapper shipped three bugs that only a real
// record exposes, and all three reached the physician's screen:
//
//   * "record last updated +055533-09" — last_updated_epoch is a STRING
//     in MILLISECONDS, and multiplying by 1000 produced the year 55533.
//   * "CHRISTOPHER-ARMAND ZARAGOZA MABINI" — NPPES is entirely uppercase,
//     which reads as shouting when pasted into an application.
//   * five pay-to fields filled with a duplicate of the practice address,
//     because LOCATION and MAILING shared a street and differed only in
//     the ZIP+4 extension.
//
// So the fixture below is the ACTUAL NPPES response for NPI 1992265797,
// not a hand-written ideal. A synthetic fixture would have passed the
// original code.
//
//   node scripts/test_nppes.mjs
// =====================================================================

import {
    mapRecord, titleCase, formatName, formatStreet,
    formatZip, formatPhone, formatRegistryDate, sameAddress,
} from "../functions/_lib/nppes.js";

let pass = 0, fail = 0;
function ok(c, l) { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.error(`  ✗ ${l}`); } }
function section(t) { console.log(`\n${t}`); }

// The real record, copied verbatim from the live API.
const REAL = {
    enumeration_type: "NPI-1",
    number: "1992265797",
    last_updated_epoch: "1690308121000",
    created_epoch: "1553098161000",
    basic: {
        certification_date: "2023-07-25", credential: "DO",
        enumeration_date: "2019-03-20", first_name: "CHRISTOPHER-ARMAND",
        last_name: "MABINI", last_updated: "2023-07-25", middle_name: "ZARAGOZA",
        name_prefix: "Dr.", sex: "M", sole_proprietor: "YES", status: "A",
    },
    taxonomies: [{ code: "207V00000X", desc: "Obstetrics & Gynecology",
                   license: "125075291", primary: true, state: "IL", taxonomy_group: "" }],
    addresses: [
        { address_1: "355 RIDGE AVE", address_purpose: "LOCATION", address_type: "DOM",
          city: "EVANSTON", country_code: "US", postal_code: "602023328", state: "IL",
          telephone_number: "949-290-7630" },
        { address_1: "355 RIDGE AVE", address_purpose: "MAILING", address_type: "DOM",
          city: "EVANSTON", country_code: "US", fax_number: "847-316-3307",
          postal_code: "602023399", state: "IL", telephone_number: "847-316-6229" },
    ],
    practiceLocations: [], other_names: [], identifiers: [],
};

const m = mapRecord(REAL, "1992265797");
const f = m.fields;

// ---------------------------------------------------------------------
section("The registry date — the bug that printed the year 55533");
ok(m.source.last_updated === "2023-07-25",
   `last_updated is a real date (got ${JSON.stringify(m.source.last_updated)})`);
ok(formatRegistryDate(null, "1690308121000") === "2023-07-25",
   "a millisecond epoch string is detected by magnitude, not assumed");
ok(formatRegistryDate(null, 1690308121) === "2023-07-25",
   "a seconds epoch also resolves correctly");
ok(formatRegistryDate(null, "999999999999999") === null,
   "an epoch that lands outside 1990-2100 is refused rather than printed");
ok(formatRegistryDate(null, null) === null, "a missing epoch yields null, not NaN");
ok(formatRegistryDate("2023-07-25", "garbage") === "2023-07-25",
   "the plain date wins over a broken epoch");

// ---------------------------------------------------------------------
section("Name — NPPES shouts, applications should not");
ok(f.legal_name === "Christopher-Armand Zaragoza Mabini",
   `legal_name is title-cased with the hyphen intact (got ${JSON.stringify(f.legal_name)})`);
ok(f.contact_name === "Christopher-Armand Zaragoza Mabini", "contact_name matches");
ok(f.contact_title === "DO", "the credential becomes the contact title");
ok(!/^[A-Z ]+$/.test(f.legal_name), "the name is not left in all caps");

section("…and the title-caser handles the awkward cases");
ok(titleCase("O'BRIEN") === "O'Brien", "apostrophes survive");
ok(titleCase("MARY-JANE SMITH") === "Mary-Jane Smith", "hyphens survive");
ok(titleCase("JOHN SMITH III") === "John Smith III", "generational suffixes stay uppercase");
ok(titleCase("MOUNT ZARA LLC") === "Mount Zara LLC", "entity suffixes stay uppercase");
ok(formatName("JANE", null, "DOE") === "Jane Doe", "an absent middle name leaves no double space");

// ---------------------------------------------------------------------
section("Entity type — a required field NPPES answers for free");
ok(f.entity_type === "sole_proprietor",
   "sole_proprietor:'YES' fills the required entity_type, which the first version ignored entirely");

// ---------------------------------------------------------------------
section("Address — the duplicate pay-to bug");
ok(f.practice_street === "355 Ridge Ave", `street is title-cased with AVE -> Ave (got ${JSON.stringify(f.practice_street)})`);
ok(f.practice_city === "Evanston", "city is title-cased");
ok(f.practice_state === "IL", "state stays uppercase");
ok(f.practice_zip === "60202-3328", "ZIP is hyphenated as ZIP+4");

ok(!("payto_street" in f), "pay-to is NOT filled — same street, same ZIP5, only the +4 differs");
ok(!("payto_city" in f) && !("payto_zip" in f), "…and no other pay-to field is filled either");

section("…but a genuinely different mailing address IS captured");
const withPayto = mapRecord({
    ...REAL,
    addresses: [
        REAL.addresses[0],
        { ...REAL.addresses[1], address_1: "PO BOX 4412", city: "CHICAGO", postal_code: "606110001" },
    ],
}, "1992265797");
ok(withPayto.fields.payto_street === "PO Box 4412", "a real pay-to address is filled, and PO BOX formats correctly");
ok(withPayto.fields.payto_city === "Chicago", "its city is title-cased too");

section("sameAddress compares what matters");
ok(sameAddress(REAL.addresses[0], REAL.addresses[1]), "same street + ZIP5, differing +4 => same address");
ok(!sameAddress(REAL.addresses[0], { ...REAL.addresses[1], address_1: "12 OTHER ST" }), "a different street => different address");
ok(!sameAddress(REAL.addresses[0], { ...REAL.addresses[1], postal_code: "606110001" }), "a different ZIP5 => different address");
ok(sameAddress({ address_1: "355 Ridge Ave.", city: "Evanston", state: "il", postal_code: "60202" },
               { address_1: "355 RIDGE AVE", city: "EVANSTON", state: "IL", postal_code: "602023328" }),
   "comparison ignores case, punctuation and the +4");

// ---------------------------------------------------------------------
section("Phone and fax — fax lives on MAILING, which was missed");
ok(f.contact_phone === "949-290-7630", "phone comes from the practice location");
ok(f.contact_fax === "847-316-3307",
   `fax is picked up from the MAILING address (got ${JSON.stringify(f.contact_fax)})`);
ok(formatPhone("9492907630") === "949-290-7630", "a bare 10-digit number is formatted");
ok(formatPhone("19492907630") === "949-290-7630", "a leading US country code is stripped");
ok(formatPhone("") === "", "an empty phone stays empty rather than becoming '--'");

section("Taxonomy and licence");
ok(f.taxonomy_code === "207V00000X", "the primary taxonomy code is used");
ok(f.license_number === "125075291", "the licence number comes from the taxonomy record");
ok(f.license_state === "IL", "the licence state comes with it");

section("ZIP formatting");
ok(formatZip("602023328") === "60202-3328", "nine digits become ZIP+4");
ok(formatZip("60202") === "60202", "five digits are left alone");
ok(formatZip("") === "", "empty stays empty");

section("Overall shape");
ok(m.ok && m.type === "individual", "an NPI-1 is reported as an individual");
ok(m.warnings.length === 0, "a clean, active record produces no spurious warnings");
ok(Object.keys(f).length >= 13, `a useful number of fields is filled (${Object.keys(f).length})`);
ok(!Object.values(f).some((v) => String(v).includes("undefined") || String(v).includes("NaN")),
   "no field contains 'undefined' or 'NaN'");
ok(!Object.values(f).some((v) => /^\s|\s$/.test(String(v))), "no field has leading or trailing whitespace");

section("A five-digit ZIP is warned about");
const short = mapRecord({ ...REAL,
    addresses: [{ ...REAL.addresses[0], postal_code: "60202" }, REAL.addresses[1]] }, "1992265797");
ok(short.warnings.some((w) => /ZIP\+4/.test(w)), "a five-digit practice ZIP produces the Medicare warning");

section("An organization NPI");
const org = mapRecord({ ...REAL, enumeration_type: "NPI-2",
    basic: { organization_name: "MOUNT ZARA MEDICAL PC", status: "A" } }, "1245319599");
ok(org.fields.legal_name === "Mount Zara Medical PC", "the organization name is title-cased, PC preserved");
ok(org.fields.npi_group === "1245319599", "an NPI-2 fills the GROUP NPI");
ok(!("npi_individual" in org.fields), "…and not the individual NPI");
ok(org.warnings.some((w) => /Type 2/.test(w)), "and it says so");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
