#!/usr/bin/env python3
"""Pretty-print the medication_watch section of a briefing JSON."""
import json
import sys

d = json.load(sys.stdin)
print("=== executive lede ===")
print("  " + (d.get("executive_lede") or "")[:600])

mw = d.get("medication_watch") or []
mf = d.get("medication_watch_manifest") or {}
print()
print("=== medication_watch ({0} drug(s)) ===".format(len(mw)))
for entry in mw:
    print()
    print("--- {0}  (raw input: '{1}', matched_on: {2}) ---".format(
        entry.get("drug"), entry.get("raw_input"), entry.get("matched_on")))
    print("  set_id:    {0}".format(entry.get("set_id")))
    print("  fetched_at:{0}".format(entry.get("fetched_at")))
    print("  not_found: {0}".format(entry.get("not_found")))
    if entry.get("advisory"):
        print("  advisory:  {0}".format(entry["advisory"]))
    matches = entry.get("matches") or []
    print("  matches:   {0} (high-conf: {1})".format(
        len(matches), entry.get("high_confidence_count", 0)))
    for m in matches[:5]:
        toks = ", ".join(m.get("matched_tokens") or [])
        srcs = ", ".join(m.get("patient_sources") or [])
        print("    [{0}] [{1}]  tokens=({2})".format(
            m.get("confidence"), m.get("category"), toks))
        print("       sources: {0}".format(srcs))
        ae = (m.get("ae_text") or "")[:240]
        print("       AE: {0}".format(ae))

print()
print("=== manifest ===")
print("  considered:        {0}".format(mf.get("considered_count")))
print("  skipped_for_budget:{0}".format(mf.get("skipped_for_budget")))
print("  generated_at:      {0}".format(mf.get("generated_at")))
print("  openfda_calls:")
for c in (mf.get("openfda_calls") or []):
    print("    {0} -> {1} ({2}ms, cache={3}, status={4})".format(
        c.get("raw"),
        c.get("drug_key"),
        c.get("duration_ms"),
        c.get("cache"),
        c.get("status")))
