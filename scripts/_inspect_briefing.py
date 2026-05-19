#!/usr/bin/env python3
"""Pretty-print a single-patient briefing JSON from /api/v1/admin/briefings/<id>."""
import json
import sys

d = json.load(sys.stdin)

p = d["patient"]
print("--- patient header ---")
print("  display:        {0}  (full name: {1})".format(p["display_name"], p["full_name"]))
print("  nickname:       {0}".format(p.get("nickname")))
print("  age / pronouns: {0} / {1}".format(p.get("age"), p.get("pronouns")))
print("  photo_url:      {0}".format(p.get("photo_url")))
print("  care_goals:")
cg = p.get("care_goals") or {}
for k in ("goals", "preferences", "avoid"):
    for v in (cg.get(k) or []):
        print("     - {0}: {1}".format(k, v))
if cg.get("notes"):
    print("     - notes: {0}".format(cg["notes"]))

print()
print("--- executive lede ---")
print("  {0}".format(d["executive_lede"]))

print()
print("--- appointment focus ---")
print("  focused: {0}".format(d.get("appointment_focus")))
ctx = d.get("appointments_context", {})
print("  recent_completed: {0}".format(len(ctx.get("recent_completed", []))))
print("  upcoming_scheduled: {0}".format(len(ctx.get("upcoming_scheduled", []))))

print()
print("--- intake / triage ---")
intake = d.get("intake_summary")
if intake:
    print("  intake status={0} completion_pct={1}%".format(
        intake["status"], intake.get("completion_pct")))
else:
    print("  (no intake on file)")
print("  triage: {0}".format(d.get("triage")))

print()
print("--- snapshot ---")
snap = d.get("snapshot_summary")
if snap:
    print("  exec_summary: {0}".format(snap.get("executive_summary") or "(none)"))
    print("  problems: {0}  open actions: {1}".format(
        snap.get("problem_count"), snap.get("action_item_count")))
else:
    print("  (no Phase 9 snapshot generated yet for this patient)")

print()
print("--- PROM trends ---")
for tr in d.get("prom_trends") or []:
    print("  {0}: {1}->{2} ({3}, {4} completions)".format(
        tr["short_name"], tr.get("previous_score"), tr["latest_score"],
        tr.get("direction") or "n/a", tr["total_completions"]))

print()
print("--- personal touchpoints (pinned + personal-category) ---")
for n in d.get("personal_touchpoints") or []:
    pin = " (pinned)" if n["is_pinned"] else ""
    print("  [{0}]{1} {2}".format(n["category"], pin, n["summary"]))
    if n.get("body"):
        print("     body: {0}".format(n["body"][:120]))

print()
print("--- all_personal_notes total: {0}".format(len(d.get("all_personal_notes") or [])))

print()
print("--- watch_for ---")
for w in d.get("watch_for") or []:
    print("  [{0}] {1}  ({2})".format(w["severity"], w["label"], w["kind"]))

print()
print("--- suggested_questions ---")
for q in d.get("suggested_questions") or []:
    print("  - {0}".format(q))
