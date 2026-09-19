#!/usr/bin/env node
// =====================================================================
// check_clinical_grounding_wired.mjs — no clinical path ships ungrounded
// =====================================================================
// The owner's standing rule: clinical answers come from HIS KB, never from
// the model's general knowledge or the internet.
//
// On 2026-08-13 that rule was not being enforced anywhere. The KB was
// loaded (1,144 documents in `kb_docs`) and `_lib/kb.js` worked, but it
// was wired into ONE endpoint — `admin/ai/suggest-edit.js`, a copy editor
// for website titles. Every clinical path — triage, the after-visit
// summary the patient reads, the draft reply to a patient message,
// Navigator visit-prep, the PROM recommender — called the model with no
// reference material at all.
//
// Nothing caught it, because "the prompt does not include the KB" is not a
// runtime error. It produces confident, fluent, plausible medicine from
// the wrong source, which is the failure mode with no symptom.
//
// This gate enumerates every file that calls a model, classifies it, and
// requires each CLINICAL one to import the grounding module and actually
// use it. A new clinical feature that forgets cannot deploy.
//
// Run: node scripts/check_clinical_grounding_wired.mjs
// =====================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const FN_DIR = join(ROOT, "functions");

// Files that call a model but are NOT clinical. Each needs a reason —
// "it's not clinical" has to be argued, not assumed, because that is the
// escape hatch a future clinical feature would slip through.
const NON_CLINICAL = {
    "functions/_lib/anthropic.js": "the transport wrapper itself; it builds no prompt",
    "functions/_lib/ai_router.js": "routes jobs; builds no prompt",
    "functions/_lib/billing_ai_advisor.js": "CPT/ICD coding and payer rules — not patient clinical advice",
    "functions/_lib/billing_ai_preflight.js": "claim scrubbing against payer rules; codes only, no narrative",
    "functions/_lib/billing_appeal.js": "payer appeal letters; argues coverage policy, not medicine",
    "functions/_lib/correspondence_extract.js": "extracts fields from a document; asserts nothing",
    "functions/_lib/enrollment_extract.js": "reads the practice's own W-9 / PTAN paperwork",
    "functions/api/v1/admin/ai/suggest-edit.js": "website copy editing — and it is KB-grounded anyway",
    "functions/api/v1/admin/membership/interest.js": "comments on waitlist arithmetic; no clinical content",
    "functions/api/v1/patient/intake/[intake_id]/triage.js": "thin route wrapper; the medicine is in _lib/intake_triage.js",
};

// Clinical paths, and what each one produces. Named explicitly so that
// deleting a wiring shows up here rather than passing silently.
const CLINICAL = {
    "functions/_lib/intake_triage.js": "decides visit type/duration and flags perioperative risk",
    "functions/_lib/visit_summary.js": "the after-visit summary the PATIENT reads",
    "functions/_lib/visit_prep.js": "the pack a member hands to their own OB/GYN, under his name",
    "functions/_lib/prom_recommender.js": "which validated instruments to administer",
    "functions/api/v1/admin/messages/[thread_id]/draft.js": "the clinical reply sent to a patient",
};

function jsFiles(dir) {
    const out = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (e !== "node_modules") out.push(...jsFiles(p)); }
        else if (e.endsWith(".js")) out.push(p);
    }
    return out;
}

const CALLS_MODEL = /api\.anthropic\.com|\bcallClaude\s*\(|\benqueueAiJob\s*\(/;

const problems = [];
const found = [];

for (const abs of jsFiles(FN_DIR)) {
    const rel = relative(ROOT, abs);
    const src = readFileSync(abs, "utf8");
    if (!CALLS_MODEL.test(src)) continue;
    found.push(rel);

    const classifiedClinical = rel in CLINICAL;
    const classifiedNon = rel in NON_CLINICAL;

    if (!classifiedClinical && !classifiedNon) {
        problems.push(
            `${rel}\n    calls a model but is classified in neither list.\n` +
            `    Add it to CLINICAL (and wire _lib/clinical_grounding.js) or to\n` +
            `    NON_CLINICAL with the reason it asserts no medicine.`);
        continue;
    }
    if (!classifiedClinical) continue;

    // Clinical: must import AND use the grounding module.
    if (!/from "[^"]*clinical_grounding\.js"/.test(src)) {
        problems.push(`${rel}\n    CLINICAL (${CLINICAL[rel]}) but does not import _lib/clinical_grounding.js.\n` +
                      `    Its clinical content would come from the model's training data.`);
        continue;
    }
    if (!/\bgroundClinical\s*\(/.test(src)) {
        problems.push(`${rel}\n    imports the grounding module but never calls groundClinical().`);
        continue;
    }
    if (!/\bgroundingInstruction\s*\(/.test(src)) {
        problems.push(`${rel}\n    retrieves KB context but never puts groundingInstruction() in the prompt,\n` +
                      `    so the model is not actually told the library is its only source.`);
        continue;
    }
    if (!/\bverifyGrounding\s*\(/.test(src)) {
        problems.push(`${rel}\n    grounds the prompt but never calls verifyGrounding().\n` +
                      `    The instruction is not enforcement — verification is. A model with\n` +
                      `    nothing to cite will invent a citation before admitting it.`);
    }
}

// The bridge must carry the KB too, or bridge-routed jobs become the one
// remaining ungrounded path.
const bridge = join(ROOT, "functions/api/v1/sync/ai-bridge/[[path]].js");
try {
    const src = readFileSync(bridge, "utf8");
    if (!/groundClinical\s*\(/.test(src)) {
        problems.push("functions/api/v1/sync/ai-bridge/[[path]].js\n    does not attach KB context to bridge jobs — a bridge-routed draft\n    would answer from the model's general knowledge.");
    }
    if (!/kb_instruction/.test(src)) {
        problems.push("functions/api/v1/sync/ai-bridge/[[path]].js\n    does not return kb_instruction to the bridge client.");
    }
} catch { problems.push("functions/api/v1/sync/ai-bridge/[[path]].js is missing"); }

try {
    const sh = readFileSync(join(ROOT, "scripts/claude_bridge.sh"), "utf8");
    if (!/kb_instruction/.test(sh) || !/\$\{kb\}/.test(sh)) {
        problems.push("scripts/claude_bridge.sh\n    does not put the server-supplied KB block into its prompts.");
    }
} catch { /* the bridge script is optional in some environments */ }

console.log(`clinical grounding gate: ${found.length} model call site(s), ${Object.keys(CLINICAL).length} clinical`);
if (problems.length) {
    console.log(`\n${problems.length} problem(s):\n`);
    for (const p of problems) console.log("  " + p + "\n");
    console.log("Clinical answers must derive from the practice KB, never from model training data.");
    process.exit(1);
}
for (const c of Object.keys(CLINICAL)) console.log(`  ✓ ${c}`);
console.log("every clinical path grounds, instructs and verifies against the practice library");
