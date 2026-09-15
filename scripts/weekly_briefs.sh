#!/usr/bin/env bash
# weekly_briefs.sh — the scheduled routine for every unpublished brief.
#
# What it does: lists every draft the generator left (weekly roundups on
# /evidence/, trend briefs on /trending/) and runs each one through
# scripts/brief_pipeline.py run, which is the whole chain — prepare, curate,
# author, guard, apply, publish — with every stage reviewed, the standards
# S1-S14 audited, and a bounded repair loop for anything a stage refuses.
# The server refuses to publish a brief without the pipeline's receipt for
# the exact body, so this is the ONLY route to publication.
#
# Exit status: 0 when every draft published, 1 when any was left unpublished
# (the reasons are in <work>/.ledger/ and in this script's output).
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${MZ_BASE:-https://www.mountzara.com}"
AUTH="${MZ_ADMIN_AUTH:-chris.mabini@gmail.com:MartyBeans!2345}"
UA="mz-operator-tools/1.0 (weekly_briefs)"

command -v claude >/dev/null || { echo "claude CLI not on PATH — the pipeline authors and reviews through it"; exit 1; }

# the pipeline's own rules must have passed the standards check for THIS version
python3 scripts/brief_pipeline.py standards-check - || { echo "standards-check found gaps — fix the pipeline before publishing anything"; exit 1; }

ids=$(curl -sS -u "$AUTH" -A "$UA" "$BASE/api/posts?kind=evidence&status=draft" | python3 -c 'import json,sys; print("\n".join(p["id"] for p in (json.load(sys.stdin).get("posts") or [])))')
# trend drafts (kind=blog) need their descriptor (<work>/trend.json + the assembled source) before
# the trend path can take them; they are reported, never silently skipped
trend_ids=$(curl -sS -u "$AUTH" -A "$UA" "$BASE/api/posts?kind=blog&status=draft" | python3 -c 'import json,sys; print("\n".join(p["id"] for p in (json.load(sys.stdin).get("posts") or [])))')
for t in $trend_ids; do echo "TREND DRAFT WAITING FOR A DESCRIPTOR: $t (run: brief_pipeline.py run trend-<dir> once <dir>/trend.json exists)"; done
failed=0; n=0
for id in $ids; do
  n=$((n+1))
  echo "================ $id ================"
  if ! timeout 6000 python3 scripts/brief_pipeline.py run "$id"; then
    echo "!! $id left unpublished"; failed=$((failed+1))
  fi
done
echo "weekly_briefs: $n draft(s), $failed unpublished"
[ "$failed" -eq 0 ]
