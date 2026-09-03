#!/usr/bin/env node
// Deploy gate: No Surprises Act Good Faith Estimates. A wrong deadline or
// a missing required element is a regulatory defect, not a cosmetic one.
import g from "../functions/_lib/gfe.js";

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL:", n); } };

// --- business-day arithmetic (2026-08-18 is a Tuesday) ---------------
t("adds business days within a week", g.addBusinessDays("2026-08-18", 3) === "2026-08-21");
t("skips the weekend", g.addBusinessDays("2026-08-20", 3) === "2026-08-25");
t("one business day from Friday is Monday", g.addBusinessDays("2026-08-21", 1) === "2026-08-24");
t("invalid date returns null", g.addBusinessDays("not-a-date", 3) === null);
t("counts business days between", g.businessDaysBetween("2026-08-18", "2026-08-25") === 5);
t("same day is zero", g.businessDaysBetween("2026-08-18", "2026-08-18") === 0);
t("reversed range is -1", g.businessDaysBetween("2026-08-25", "2026-08-18") === -1);

// --- the deadline ladder ---------------------------------------------
const far = g.gfeDueBy({ scheduled_on: "2026-08-18", service_date: "2026-09-30" });
t("10+ business days out requires a GFE", far.required === true);
t("10+ business days out gives 3 business days", far.due_by === "2026-08-21");
const mid = g.gfeDueBy({ scheduled_on: "2026-08-18", service_date: "2026-08-25" });
t("3-9 business days out requires a GFE", mid.required === true);
t("3-9 business days out gives 1 business day", mid.due_by === "2026-08-19");
const soon = g.gfeDueBy({ scheduled_on: "2026-08-18", service_date: "2026-08-19" });
t("under 3 business days out is not required", soon.required === false);
t("not-required still explains why", /fewer than 3/.test(soon.reason));
const req = g.gfeDueBy({ trigger_kind: "request", scheduled_on: "2026-08-18" });
t("patient request requires a GFE", req.required === true);
t("patient request gives 3 business days", req.due_by === "2026-08-21");
t("no scheduling date is not required", g.gfeDueBy({}).required === false);

// --- overdue ---------------------------------------------------------
t("draft past due is overdue", g.isGfeOverdue({ status: "draft", due_by: "2026-08-19" }, "2026-08-20") === true);
t("issued is never overdue", g.isGfeOverdue({ status: "issued", due_by: "2026-08-19" }, "2026-08-20") === false);
t("void is never overdue", g.isGfeOverdue({ status: "void", due_by: "2026-08-19" }, "2026-08-20") === false);
t("draft before due is not overdue", g.isGfeOverdue({ status: "draft", due_by: "2026-08-25" }, "2026-08-20") === false);

// --- required content ------------------------------------------------
const gfe = { patient_name: "Jane Doe", patient_dob: "1985-04-02", primary_service: "Consultation",
              service_date: "2026-09-30", diagnosis: ["N80.03"] };
const lines = [{ kind: "practice", description: "New patient consult", service_code: "99204",
                 provider_name: "Mount Zara", provider_npi: "1992265797", provider_tin: "88-8888888",
                 provider_state: "IL", total_cents: 45000 }];
t("complete GFE validates", g.validateGfe(gfe, lines).ok === true);
t("missing DOB caught", g.validateGfe({ ...gfe, patient_dob: "" }, lines).missing.includes("patient date of birth"));
t("missing dx caught", g.validateGfe({ ...gfe, diagnosis: [] }, lines).missing.includes("diagnosis code(s)"));
t("missing primary service caught", g.validateGfe({ ...gfe, primary_service: "" }, lines).missing.some(m => /primary item/.test(m)));
t("no lines caught", g.validateGfe(gfe, []).missing.some(m => /itemized/.test(m)));
t("line without service code caught", g.validateGfe(gfe, [{ ...lines[0], service_code: "" }]).missing.includes("service code on every line"));
t("line without provider caught", g.validateGfe(gfe, [{ ...lines[0], provider_name: "" }]).missing.includes("provider/facility name on every line"));
t("practice line without NPI caught", g.validateGfe(gfe, [{ ...lines[0], provider_npi: "" }]).missing.includes("NPI for practice-furnished items"));
t("practice line without TIN caught", g.validateGfe(gfe, [{ ...lines[0], provider_tin: "" }]).missing.includes("TIN for practice-furnished items"));
// An OUTSIDE line is billed by someone else, so we do not hold their TIN.
t("outside line needs no TIN of ours",
  g.validateGfe(gfe, [...lines, { kind: "outside", description: "CBC", service_code: "85025", provider_name: "Quest", total_cents: 2500 }]).ok === true);

// --- totals split practice from outside ------------------------------
const mixed = [...lines, { kind: "outside", description: "Pelvic US", service_code: "76856", provider_name: "Imaging Ctr", total_cents: 30000 }];
t("practice total excludes outside", g.totals(mixed).practice_cents === 45000);
t("outside total is separate", g.totals(mixed).outside_cents === 30000);
t("grand total sums both", g.totals(mixed).total_cents === 75000);
t("outside count reported", g.totals(mixed).outside_count === 1);
t("empty totals are zero", g.totals([]).total_cents === 0);

// --- $400 dispute threshold ------------------------------------------
t("threshold is $400", g.DISPUTE_THRESHOLD_CENTS === 40000);
t("exactly $400 over is disputable", g.disputeExposure(45000, 85000).disputable === true);
t("$399 over is not disputable", g.disputeExposure(45000, 84900).disputable === false);
t("billed under estimate is not disputable", g.disputeExposure(45000, 40000).disputable === false);
t("difference reported", g.disputeExposure(45000, 85000).difference_cents === 40000);

// --- disclaimers -----------------------------------------------------
t("four disclaimers present", g.DISCLAIMERS.length === 4);
t("dispute disclaimer names $400", g.DISCLAIMERS.some(d => d.includes("$400")));
t("dispute disclaimer names 120 days", g.DISCLAIMERS.some(d => d.includes("120 calendar days")));
t("disclaimer says not a contract", g.DISCLAIMERS.some(d => /not a contract/.test(d)));
t("disclaimer says others bill separately", g.DISCLAIMERS.some(d => /billed by that provider/.test(d)));

console.log(`gfe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
