#!/usr/bin/env bash
# =====================================================================
# scripts/_feedback_queue.sh — Cowork-side queue inspector
# =====================================================================
# When Chris opens a new Cowork session and says "process the feedback
# queue", I (Claude) run this to see what's pending. It:
#
#   1. Fetches all status='new' rows from /api/v1/admin/feedback
#   2. Pretty-prints each (route, type, severity, comment, traces)
#   3. Saves the raw JSON to /tmp/_mz_feedback_queue.json so I can
#      iterate through and PATCH back recommendations one at a time.
#
# Also fetches status='approved' rows so I can see what's ready for me
# to implement.
#
# Usage:
#   bash scripts/_feedback_queue.sh                 — show new + approved
#   bash scripts/_feedback_queue.sh new             — only new (unanalyzed)
#   bash scripts/_feedback_queue.sh approved        — only ready-to-implement
# =====================================================================
set -e
cd "$(dirname "$0")/.."
source "$(dirname "$0")/_lib_admin_auth.sh"
resolve_admin_auth

FILTER="${1:-new,ai_analyzed,approved}"

echo "==============================================================="
echo "  Mount Zara — Feedback Queue ($FILTER)"
echo "==============================================================="

curl -sS -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" \
    "https://mountzara.com/api/v1/admin/feedback?status=$FILTER&limit=100" \
    > /tmp/_mz_feedback_queue.json

# python3 - <<'PY' reads the script from stdin; we pass the JSON via argv
# instead so the heredoc-script and the data-file don't fight for stdin.
python3 - /tmp/_mz_feedback_queue.json <<'PY'
import json, sys, textwrap
with open(sys.argv[1]) as _f:
    data = json.load(_f)
if not data.get("ok"):
    print("ERR:", data)
    sys.exit(1)
fb = data.get("feedback", [])
summary = data.get("summary", {})
print()
print("Status counts (all-time):", ", ".join(f"{k}={v}" for k, v in summary.items()) or "(none)")
print(f"In this filter: {len(fb)}")
print()
if not fb:
    print("Nothing to do in this filter.")
    sys.exit(0)
for i, f in enumerate(fb, 1):
    print(f"--- [{i}] {f['id'][:8]}... ({f['status']}) ---")
    print(f"  type        : {f['feedback_type']}" + (f"  severity: {f['severity']}" if f.get('severity') else ""))
    print(f"  route       : {f['route']}")
    print(f"  label       : {f.get('invite_label') or 'anon'}    patient: {f.get('patient_id') or 'none'}")
    print(f"  viewport    : {f.get('viewport_width','?')}x{f.get('viewport_height','?')}    screenshot: {'YES' if f.get('has_screenshot') else 'no'}")
    print( "  comment     : ")
    for line in textwrap.wrap(f.get('comment_text',''), 78, initial_indent="    > ", subsequent_indent="    > "):
        print(line)
    if f.get('detail'):
        d = f['detail']
        if d.get('recent_traces'):
            print(f"  last traces : {len(d['recent_traces'])} events")
            for t in d['recent_traces'][-3:]:
                print(f"                {t.get('action')} -> {t.get('outcome')} ({t.get('route')})")
        if d.get('scroll_pct') is not None:
            print(f"  scroll_pct  : {d['scroll_pct']}%")
    rec = f.get('ai_recommendation')
    if rec:
        print( "  AI rec      : EXISTS")
        if rec.get('summary'): print(f"                 summary: {rec['summary'][:120]}")
        if rec.get('proposed_change'): print(f"                 change:  {rec['proposed_change'][:120]}")
    print()
PY

echo "==============================================================="
echo "  Raw JSON cached at /tmp/_mz_feedback_queue.json"
echo "  Watch live at: https://mountzara.com/admin/feedback/"
echo "==============================================================="
