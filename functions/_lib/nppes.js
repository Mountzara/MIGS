// =====================================================================
// nppes.js — autofill practice identity from the official NPI registry
// =====================================================================
// The first screen of the clearinghouse wizard asks for a dozen
// identifiers the physician has to dig out of a CV, a W-9 and a state
// license. Almost all of it is already published, by CMS, in the NPPES
// registry — the same record the payers themselves check against.
//
// So: type the NPI, get the rest. This is not a model guessing at fields;
// it is the authoritative source, which makes it BETTER than AI here.
// The most common EDI enrollment rejection is a name or address that does
// not match NPPES, so filling from NPPES is not merely convenient — it
// makes the mismatch impossible by construction.
//
// NO AUTH, NO KEY, NO COST. NPPES is a public CMS API.
//   https://npiregistry.cms.hhs.gov/api/?version=2.1&number=<npi>
//
// NEVER SILENTLY OVERWRITE. This module PROPOSES values; the caller shows
// them beside whatever is already entered and the physician accepts them.
//
// ---------------------------------------------------------------------
// WHAT THE REGISTRY ACTUALLY RETURNS — learned the hard way, 2026-08-13
// ---------------------------------------------------------------------
// The v2.1 API has three shapes that will produce garbage if taken at
// face value, and the first version of this file hit all three:
//
//   1. `last_updated_epoch` is a STRING IN MILLISECONDS ("1690308121000").
//      Treating it as seconds and multiplying by 1000 yields the year
//      55533. Prefer `basic.last_updated`, which is already "2023-07-25";
//      fall back to the epoch with magnitude detection.
//   2. EVERYTHING IS UPPERCASE — "CHRISTOPHER-ARMAND", "355 RIDGE AVE",
//      "EVANSTON". Pasted into a clearinghouse application verbatim it
//      reads as shouting, so names and addresses are title-cased, with
//      hyphens, apostrophes, generational suffixes and street
//      abbreviations handled rather than naively capitalised.
//   3. LOCATION and MAILING addresses frequently share a street and
//      differ only in the ZIP+4 extension (…3328 vs …3399, the same
//      building's delivery routing). Comparing the full nine digits
//      declares a distinct pay-to address that does not exist and fills
//      five fields with a duplicate. Compare the street, city, state and
//      FIVE-digit ZIP instead.
//
// Also mined, because they fill required fields for free:
//   * `basic.sole_proprietor: "YES"` -> entity_type, a required field.
//   * `basic.credential: "DO"` -> the contact's title.
//   * fax lives on whichever address carries it, often MAILING not
//     LOCATION.
// =====================================================================

import { npiValid } from "./clearinghouse_onboarding.js";

const BASE = "https://npiregistry.cms.hhs.gov/api/";

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

// Kept uppercase: these read wrong title-cased.
const KEEP_UPPER = new Set([
    "II", "III", "IV", "V", "VI",              // generational suffixes
    "MD", "DO", "PC", "PA", "PLLC", "LLC", "LLP", "INC", "PHD", "DDS", "DPM",
    "NE", "NW", "SE", "SW",                    // address quadrants
    "PO", "US", "USA",
]);

// Street words with a conventional short form.
const STREET_FIX = {
    AVE: "Ave", AVENUE: "Avenue", ST: "St", STREET: "Street", RD: "Rd", ROAD: "Road",
    BLVD: "Blvd", DR: "Dr", DRIVE: "Drive", LN: "Ln", LANE: "Lane", CT: "Ct",
    COURT: "Court", PL: "Pl", PLACE: "Place", PKWY: "Pkwy", HWY: "Hwy",
    STE: "Ste", SUITE: "Suite", APT: "Apt", UNIT: "Unit", FL: "Fl", FLOOR: "Floor",
    BOX: "Box", N: "N", S: "S", E: "E", W: "W",
};

/** Title-case one word, preserving hyphenated and apostrophed parts. */
function titleWord(word, { street = false } = {}) {
    const raw = String(word || "");
    if (!raw) return raw;
    const upper = raw.toUpperCase();

    if (KEEP_UPPER.has(upper)) return upper;
    if (street && STREET_FIX[upper]) return STREET_FIX[upper];

    // Split on hyphens and apostrophes but KEEP the separators, so
    // CHRISTOPHER-ARMAND and O'BRIEN both survive intact.
    return raw
        .toLowerCase()
        .split(/([-'’])/)
        .map((part, i) =>
            i % 2 === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

export function titleCase(text, opts) {
    return String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => titleWord(w, opts))
        .join(" ");
}

export function formatName(...parts) {
    return titleCase(parts.filter(Boolean).join(" "));
}

export function formatStreet(text) {
    return titleCase(text, { street: true });
}

/** NPPES returns ZIP as 9 unseparated digits. Payers want ZIP+4 hyphenated. */
export function formatZip(postal) {
    const d = String(postal || "").replace(/\D/g, "");
    if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
    if (d.length === 5) return d;              // registry only has five — flagged below
    return String(postal || "");
}

export function formatPhone(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === "1") return `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
    return String(p || "");
}

/**
 * NPPES gives BOTH `basic.last_updated` ("2023-07-25") and
 * `last_updated_epoch` ("1690308121000" — a STRING, in MILLISECONDS).
 * Prefer the plain date. When falling back to the epoch, decide by
 * magnitude rather than assuming: a seconds value is ~1.7e9, a
 * milliseconds value ~1.7e12, and guessing wrong yields the year 55533.
 */
export function formatRegistryDate(basicDate, epoch) {
    const plain = String(basicDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(plain)) return plain;

    const n = Number(epoch);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e11 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    if (year < 1990 || year > 2100) return null;    // refuse a nonsense date outright
    return d.toISOString().slice(0, 10);
}

function pickAddress(addresses, purpose) {
    return (addresses || []).find((a) => a.address_purpose === purpose) || null;
}

/**
 * Are these the same physical address? Compare street, city, state and
 * the FIVE-digit ZIP. NPPES routinely lists the same building with
 * different ZIP+4 extensions for location vs mailing, and treating that
 * as a distinct pay-to address fills five fields with a duplicate.
 */
export function sameAddress(a, b) {
    if (!a || !b) return false;
    const norm = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ").replace(/[.,]/g, "");
    const zip5 = (s) => String(s || "").replace(/\D/g, "").slice(0, 5);
    return norm(a.address_1) === norm(b.address_1)
        && norm(a.address_2) === norm(b.address_2)
        && norm(a.city) === norm(b.city)
        && norm(a.state) === norm(b.state)
        && zip5(a.postal_code) === zip5(b.postal_code);
}

const ENTITY_FROM_SOLE_PROP = { YES: "sole_proprietor", NO: null };

/**
 * Look up an NPI and map it onto the wizard's profile fields.
 *
 * @returns {{ok, npi, type, fields, warnings, raw_name, source}}
 *   `fields` is a partial profile object — only keys NPPES actually
 *   published. Absent data is absent, never guessed.
 */
export async function lookupNpi(npi) {
    const clean = String(npi || "").replace(/\D/g, "");
    if (!npiValid(clean)) {
        return { ok: false, error: "That is not a valid NPI — it fails the check digit." };
    }

    let data;
    try {
        const res = await fetch(`${BASE}?version=2.1&number=${clean}`, {
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return { ok: false, error: `NPPES returned HTTP ${res.status}` };
        data = await res.json();
    } catch (e) {
        return { ok: false, error: `Could not reach the NPI registry: ${String(e).slice(0, 160)}` };
    }

    if (data?.Errors?.length) {
        return { ok: false, error: data.Errors[0]?.description || "NPPES rejected the query" };
    }
    if (!data?.result_count || !data.results?.length) {
        return { ok: false, error: "No NPPES record for that NPI." };
    }

    return mapRecord(data.results[0], clean);
}

/** Pure mapping, split out so it can be tested against a real record. */
export function mapRecord(r, clean) {
    const basic = r.basic || {};
    const isOrg = r.enumeration_type === "NPI-2";
    const warnings = [];
    const fields = {};

    // ---- name --------------------------------------------------------
    // NPPES is all-caps. Title-case it, keeping hyphens intact
    // (CHRISTOPHER-ARMAND -> Christopher-Armand).
    const personName = formatName(basic.first_name, basic.middle_name, basic.last_name);
    const orgName = titleCase(basic.organization_name || "");
    const legal = isOrg ? orgName : personName;
    if (legal) fields.legal_name = legal;

    if (isOrg) {
        fields.npi_group = clean;
        warnings.push("This is a Type 2 (organization) NPI, so it filled the GROUP NPI field. Look up your individual Type 1 NPI separately for the personal identifier.");
    } else {
        fields.npi_individual = clean;
        fields.contact_name = personName;
        if (basic.credential) fields.contact_title = String(basic.credential).replace(/\./g, "").toUpperCase();
    }

    // ---- entity type — a required field NPPES answers for free -------
    const sp = String(basic.sole_proprietor || "").toUpperCase();
    if (ENTITY_FROM_SOLE_PROP[sp]) {
        fields.entity_type = ENTITY_FROM_SOLE_PROP[sp];
    } else if (isOrg) {
        warnings.push("NPPES does not say which kind of entity this is. Set the entity type by hand — it changes whether a group NPI is required.");
    }

    if (basic.status && basic.status !== "A") {
        warnings.push(`NPPES lists this NPI with status "${basic.status}" rather than active. Payers check this — resolve it before enrolling.`);
    }
    if (basic.deactivation_date) {
        warnings.push(`NPPES shows a deactivation date of ${basic.deactivation_date}.`);
    }

    // ---- taxonomy + state licence -----------------------------------
    const taxes = r.taxonomies || [];
    const primary = taxes.find((t) => t.primary) || taxes[0];
    if (primary) {
        if (primary.code) fields.taxonomy_code = primary.code;
        if (primary.license) fields.license_number = primary.license;
        if (primary.state) fields.license_state = primary.state;
    }
    if (taxes.length > 1) {
        warnings.push(`NPPES lists ${taxes.length} taxonomies. The primary one was used (${primary?.desc || primary?.code}); change it if you bill under another.`);
    }

    // ---- addresses ---------------------------------------------------
    const loc = pickAddress(r.addresses, "LOCATION");
    const mail = pickAddress(r.addresses, "MAILING");

    if (loc) {
        fields.practice_street = formatStreet(loc.address_1);
        if (loc.address_2) fields.practice_street2 = formatStreet(loc.address_2);
        fields.practice_city = titleCase(loc.city);
        fields.practice_state = String(loc.state || "").toUpperCase();
        fields.practice_zip = formatZip(loc.postal_code);
        if (String(loc.postal_code || "").replace(/\D/g, "").length !== 9) {
            warnings.push("NPPES has only a five-digit ZIP for your practice location. Medicare rejects professional claims without ZIP+4 — look up the full nine and enter it by hand.");
        }
    } else {
        warnings.push("NPPES published no practice location address.");
    }

    // Only fill pay-to when it is genuinely a DIFFERENT address. A ZIP+4
    // extension that differs on the same street is the same building.
    if (mail && loc && !sameAddress(mail, loc)) {
        fields.payto_street = formatStreet(mail.address_1);
        if (mail.address_2) fields.payto_street2 = formatStreet(mail.address_2);
        fields.payto_city = titleCase(mail.city);
        fields.payto_state = String(mail.state || "").toUpperCase();
        fields.payto_zip = formatZip(mail.postal_code);
    }

    // Phone and fax live on whichever address carries them — fax is often
    // on MAILING only, which the first version of this file missed.
    const phone = loc?.telephone_number || mail?.telephone_number;
    const fax = loc?.fax_number || mail?.fax_number;
    if (phone) fields.contact_phone = formatPhone(phone);
    if (fax) fields.contact_fax = formatPhone(fax);

    return {
        ok: true,
        npi: clean,
        type: isOrg ? "organization" : "individual",
        raw_name: legal,
        fields,
        warnings,
        source: {
            registry: "NPPES (CMS)",
            url: `https://npiregistry.cms.hhs.gov/provider-view/${clean}`,
            last_updated: formatRegistryDate(basic.last_updated, r.last_updated_epoch),
        },
    };
}

export default {
    lookupNpi, mapRecord, titleCase, formatName, formatStreet,
    formatZip, formatPhone, formatRegistryDate, sameAddress,
};
