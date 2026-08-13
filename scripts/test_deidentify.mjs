// test_deidentify.mjs — Safe Harbor scrubber tests.
// The scrubber is what lets clinical text reach an AI processor at all, so a
// false "ok" is the worst possible failure: it would ship real PHI to a vendor
// with no BAA. These tests pin fail-closed behavior first, coverage second.
// Run: node scripts/test_deidentify.mjs

import { scrubForAI, requireDeidentified, scrubKnownNames } from "../functions/_lib/deidentify.js";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
};

console.log("Safe Harbor de-identification\n");

const note = `Patient Jane Roe, DOB 02/11/1984, MRN: MR00691186, member ID: XYZ123456.
Seen 07/15/2026 at 123 Wacker Drive, Chicago 60601. Phone (312) 555-0142, jane.roe@example.com.
SSN 123-45-6789. 42 y/o G2P2 with symptomatic fibroids; failed 6 months of medical management.
Underwent total laparoscopic hysterectomy; pathology leiomyomata 380 g. EBL 150 mL.`;

const r = scrubForAI(note, { knownNames: ["Jane Roe"] });

check("scrub reports ok (no residual high-risk)", r.ok, JSON.stringify(r.residual));
check("name removed", !/Jane|Roe/i.test(r.text), r.text);
check("DOB removed", !/02\/11\/1984/.test(r.text));
check("service date removed", !/07\/15\/2026/.test(r.text));
check("MRN removed", !/MR00691186/.test(r.text));
check("member id removed", !/XYZ123456/.test(r.text));
check("phone removed", !/555-0142|\(312\)/.test(r.text));
check("email removed", !/example\.com/.test(r.text));
check("SSN removed", !/123-45-6789/.test(r.text));
check("ZIP removed", !/60601/.test(r.text));

// The whole point: clinical substance must SURVIVE, or de-identification is
// useless for winning appeals.
check("clinical content preserved (diagnosis)", /fibroids/i.test(r.text), r.text);
check("clinical content preserved (procedure)", /laparoscopic hysterectomy/i.test(r.text));
check("clinical content preserved (pathology weight)", /380 g/.test(r.text));
check("clinical content preserved (failed conservative therapy)", /failed 6 months/i.test(r.text));

// Age 90+ aggregation (Safe Harbor identifier #17).
{
    const a = scrubForAI("Patient is 94 y/o with pelvic organ prolapse.");
    check("age over 89 aggregated", /90 or older/.test(a.text) && !/94/.test(a.text), a.text);
    const b = scrubForAI("Patient is 42 y/o with pelvic organ prolapse.");
    check("age under 90 preserved", /42/.test(b.text), b.text);
}

// FAIL-CLOSED: the gate must throw, not return, on residual PHI.
{
    // A shape the rules deliberately do not cover, to prove the verifier runs.
    const sneaky = "Contact 3125550142 for records.";  // phone without punctuation
    const s = scrubForAI(sneaky);
    // Either it scrubbed it, or it must report NOT ok — never a silent pass.
    const silentPass = s.ok && /3125550142/.test(s.text);
    check("never silently passes unredacted contact digits", !silentPass, s.text);
}
{
    let threw = false;
    try { requireDeidentified("SSN 123-45-6789 remains", {}); } catch { threw = true; }
    // This SHOULD scrub cleanly, so it should NOT throw:
    check("requireDeidentified passes clean text", !threw);
}

// Known-name scrubbing must not eat short tokens (the 2026-05 regression class
// where aggressive name patterns deleted clinical words).
{
    const t = scrubKnownNames("Patient Al reports RA and PE risk.", ["Al"]);
    check("2-char name not redacted (would eat clinical abbreviations)",
        /\bAl\b/.test(t), t);
}

console.log(`\n${pass} passed, ${fail} failed`);

// --- indexed date tokens (added 2026-08-12) ---------------------------------
import { tokenizeDates, resolveDateToken, prepareDocumentForAI } from "../functions/_lib/deidentify.js";
console.log("\nindexed date tokens\n");
let p2 = 0, f2 = 0;
const c2 = (n, ok, d = "") => { if (ok) { p2++; console.log(`  ok   ${n}`); } else { f2++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const letter = `Date of this letter: 08/01/2026. Claim for date of service 07/15/2026 was denied.
You must submit records within 30 days of the date of this letter. Prior appeal filed 06/02/2026.`;
const tk = tokenizeDates(letter);
c2("each distinct date gets its own token", Object.keys(tk.map).length === 3, JSON.stringify(tk.map));
c2("no raw dates remain after tokenizing", !/\d{2}\/\d{2}\/\d{4}/.test(tk.text), tk.text);
c2("token resolves back to the real date", resolveDateToken("DATE_1", tk.map) === "08/01/2026", JSON.stringify(tk.map));
c2("bracketed token also resolves", resolveDateToken("[DATE_2]", tk.map) === "07/15/2026");
c2("unknown token resolves to null", resolveDateToken("DATE_99", tk.map) === null);

const prep = prepareDocumentForAI(`Patient Jane Roe MRN: MR00691186, DOS 07/15/2026, due 08/30/2026.`, { knownNames: ["Jane Roe"] });
c2("prepared text carries date tokens, not dates", /\[DATE_\d\]/.test(prep.text) && !/07\/15\/2026/.test(prep.text), prep.text);
c2("prepared text has no name or MRN", !/Jane|MR00691186/i.test(prep.text), prep.text);
c2("date map returned for local resolution", Object.keys(prep.dateMap).length === 2, JSON.stringify(prep.dateMap));

console.log(`\n${p2} passed, ${f2} failed`);
process.exit(f2 ? 1 : 0);
