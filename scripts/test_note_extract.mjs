#!/usr/bin/env node
// Deploy gate: drafting an AVS from the note. A mangled draft wastes his
// time; a draft assembled from fragments could mislead a patient if
// approved in a hurry. Both are failures here.
import n from "../functions/_lib/note_extract.js";

let pass = 0, fail = 0;
const t = (x, c) => { if (c) pass++; else { fail++; console.error("FAIL:", x); } };

// --- the run-on form the app actually sends --------------------------
const runon = "S: 38F with 8 months heavy menses. O: Telehealth. A: AUB, suspected leiomyoma. P: CBC and ferritin today; pelvic ultrasound; follow up 2 weeks.";
const p1 = n.parseSoap(runon);
t("run-on: subjective parsed", /38F with 8 months/.test(p1.subjective));
t("run-on: assessment parsed", p1.assessment === "AUB, suspected leiomyoma.");
t("run-on: plan parsed", /CBC and ferritin/.test(p1.plan));
t("run-on: sections do not bleed into each other", !/CBC/.test(p1.assessment));

// --- the line form ---------------------------------------------------
const lines = ["Subjective: Pelvic pain for a year.", "Objective: Exam deferred.",
               "Assessment: Endometriosis, clinical.", "Plan: Start NSAIDs. Refer to surgery.", "Follow up in 6 weeks."].join("\n");
const p2 = n.parseSoap(lines);
t("line form: assessment parsed", p2.assessment === "Endometriosis, clinical.");
t("line form: plan absorbs its continuation", /Refer to surgery/.test(p2.plan) && /Follow up in 6 weeks/.test(p2.plan));

// --- refusals: no draft beats a bad draft ----------------------------
t("empty note yields no draft", n.draftFromNote("") === null);
t("null note yields no draft", n.draftFromNote(null) === null);
t("prose with no A or P yields no draft",
  n.draftFromNote("The patient and I had a long conversation about options.") === null);
t("subjective alone is not enough", n.draftFromNote("S: tired all the time.") === null);

// --- the draft itself -------------------------------------------------
const d = n.draftFromNote(runon, { chiefComplaint: "heavy periods and tiredness",
                                   next_step_summary: "Labs and ultrasound, follow-up in 2 weeks",
                                   medications: ["Iron"] });
t("draft is produced", typeof d === "string" && d.length > 40);
t("draft leads with what was discussed", d.startsWith("What we talked about"));
t("draft names the reason for the visit", /heavy periods and tiredness/.test(d));
t("draft carries his assessment VERBATIM", d.includes("AUB, suspected leiomyoma."));
t("draft carries the plan verbatim", /CBC and ferritin/.test(d));
t("draft has a plan heading", /\nThe plan\n/.test(d));
t("draft lists medicines when given", /Your medicines\nIron/.test(d));
t("draft states what happens next", /What happens next\nLabs and ultrasound/.test(d));
t("draft invents nothing about outcome", !/should improve|will resolve|likely fine/i.test(d));
t("draft contains no disclaimer text (that belongs in the admin view)",
  !/drafted automatically/i.test(d));

// --- plan_summary from the app wins over the note's P line -----------
const d2 = n.draftFromNote(runon, { plan_summary: "Iron started; recheck in 8 weeks." });
t("explicit plan_summary is preferred", /Iron started; recheck in 8 weeks\./.test(d2));
t("...and the note's P line is then not duplicated", !/CBC and ferritin/.test(d2));

// --- the notice exists and is for him, not her -----------------------
t("notice tells him to rewrite", /Rewrite it in patient language/.test(n.DRAFT_NOTICE));
t("notice states nothing reaches the patient first", /reaches the patient until you do/.test(n.DRAFT_NOTICE));

console.log(`note extract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
