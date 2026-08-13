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
// An autofill that quietly replaces a hand-corrected field is a bug that
// surfaces weeks later as a rejected enrollment.
// =====================================================================

import { npiValid } from "./clearinghouse_onboarding.js";

const BASE = "https://npiregistry.cms.hhs.gov/api/";

/** NPPES returns ZIP as 9 unseparated digits. Payers want ZIP+4 hyphenated. */
function formatZip(postal) {
    const d = String(postal || "").replace(/\D/g, "");
    if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
    if (d.length === 5) return d;              // registry only has five — flag it
    return String(postal || "");
}

function formatPhone(p) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return String(p || "");
}

function pickAddress(addresses, purpose) {
    return (addresses || []).find((a) => a.address_purpose === purpose) || null;
}

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

    const r = data.results[0];
    const basic = r.basic || {};
    const isOrg = r.enumeration_type === "NPI-2";
    const warnings = [];
    const fields = {};

    // ---- name --------------------------------------------------------
    const personName = [basic.first_name, basic.middle_name, basic.last_name]
        .filter(Boolean).join(" ").trim();
    const orgName = basic.organization_name || "";
    const legal = isOrg ? orgName : personName;
    if (legal) {
        fields.legal_name = basic.name_prefix && !isOrg
            ? legal            // credentials belong on the CV, not the W-9
            : legal;
    }
    if (isOrg) {
        fields.npi_group = clean;
        warnings.push("This is a Type 2 (organization) NPI, so it filled the GROUP NPI field. Look up your individual Type 1 NPI separately for the personal identifier.");
    } else {
        fields.npi_individual = clean;
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
        fields.practice_street = loc.address_1 || "";
        fields.practice_street2 = loc.address_2 || "";
        fields.practice_city = loc.city || "";
        fields.practice_state = loc.state || "";
        fields.practice_zip = formatZip(loc.postal_code);
        if (loc.telephone_number) fields.contact_phone = formatPhone(loc.telephone_number);
        if (loc.fax_number) fields.contact_fax = formatPhone(loc.fax_number);
        if (String(loc.postal_code || "").replace(/\D/g, "").length !== 9) {
            warnings.push("NPPES has only a five-digit ZIP for your practice location. Medicare rejects professional claims without ZIP+4 — look up the full nine and enter it by hand.");
        }
    } else {
        warnings.push("NPPES published no practice location address.");
    }

    // A mailing address that differs from the location is the pay-to.
    if (mail && loc && (mail.address_1 !== loc.address_1 || mail.postal_code !== loc.postal_code)) {
        fields.payto_street = mail.address_1 || "";
        fields.payto_street2 = mail.address_2 || "";
        fields.payto_city = mail.city || "";
        fields.payto_state = mail.state || "";
        fields.payto_zip = formatZip(mail.postal_code);
    }

    if (!isOrg && personName) fields.contact_name = personName;

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
            last_updated: r.last_updated_epoch
                ? new Date(Number(r.last_updated_epoch) * 1000).toISOString().slice(0, 10)
                : null,
        },
    };
}

export default { lookupNpi };
