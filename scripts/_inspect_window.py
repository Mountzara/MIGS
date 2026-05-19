#!/usr/bin/env python3
"""Pretty-print a /api/v1/admin/briefings window response."""
import json
import sys

d = json.load(sys.stdin)
print("  window:    {0}".format(d.get("window")))
print("  appts:     {0}".format(len(d.get("appointments") or [])))
print("  briefings: {0} unique patient(s)".format(len(d.get("briefings") or [])))
for b in d.get("briefings") or []:
    p = b["patient"]
    lede = b.get("executive_lede") or ""
    print("   - {0} ({1}): {2}".format(p["display_name"], p["id"][:8], lede[:160]))
