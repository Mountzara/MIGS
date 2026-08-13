#!/usr/bin/env bash
# =====================================================================
# claude_bridge.sh — run mountzara.com's AI work on your Claude CLI
# =====================================================================
# WHY
# You run this practice alone and already pay for a Claude CLI
# subscription. Your rule: "I only will use the API key for actual
# billing sent to clearinghouses." So the site queues non-billing AI work
# — message drafts, summaries — and this bridge executes it locally at no
# per-token cost. Billing/clearinghouse work still goes straight to the
# API, because it must run unattended the moment a claim is worked.
#
# RUN IT
#   export AI_BRIDGE_TOKEN='...'          # same value as the Pages secret
#   ./scripts/claude_bridge.sh            # poll forever
#   ./scripts/claude_bridge.sh --once     # drain the queue and exit
#
# Leave it running in a terminal (or as a launchd job) whenever you want
# drafts to appear. If it is not running, work simply waits in the queue
# and the admin console reports the bridge as offline — nothing is lost
# and nothing fails silently.
#
# WHAT IT DOES, PER JOB
#   1. Claim the oldest job          GET  /api/v1/sync/ai-bridge/next
#   2. Fetch whatever context it needs over the authenticated admin API
#   3. Run `claude -p` locally with a job-specific prompt
#   4. Return the result            POST /api/v1/sync/ai-bridge/<id>/result
#
# PHI: patient content is fetched to THIS machine and passed to your local
# Claude CLI. That is the same trust boundary as your Medical
# Transcription app. Nothing clinical is stored in the job queue itself.
# =====================================================================
set -uo pipefail

SITE="${MZ_SITE:-https://mountzara.com}"
BRIDGE_ID="${MZ_BRIDGE_ID:-$(hostname -s 2>/dev/null || echo local)}"
POLL_SECONDS="${MZ_BRIDGE_POLL:-20}"
VERSION="1.0.0"
ONCE=""
[ "${1:-}" = "--once" ] && ONCE=1

if [ -z "${AI_BRIDGE_TOKEN:-}" ]; then
    echo "ERROR: AI_BRIDGE_TOKEN is not set." >&2
    echo "  export AI_BRIDGE_TOKEN='<the value stored as the Pages secret>'" >&2
    exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
    echo "ERROR: the 'claude' CLI is not on PATH." >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: 'jq' is required (brew install jq)." >&2
    exit 1
fi

AUTH=(-H "Authorization: Bearer ${AI_BRIDGE_TOKEN}")
DONE=0
FAILED=0

heartbeat() {
    curl -s -X POST "${SITE}/api/v1/sync/ai-bridge/heartbeat" \
        "${AUTH[@]}" -H "Content-Type: application/json" \
        --data "$(jq -nc --arg b "$BRIDGE_ID" --arg v "$VERSION" \
                 --argjson d "$DONE" --argjson f "$FAILED" \
                 '{bridge_id:$b, version:$v, jobs_done:$d, jobs_failed:$f}')" \
        >/dev/null 2>&1 || true
}

# Build the prompt for a job. Each kind fetches its own context from the
# site so the queue never has to carry clinical text.
build_prompt() {
    local kind="$1" payload="$2"
    case "$kind" in
        message_draft)
            local thread_id
            thread_id=$(jq -r '.thread_id // empty' <<<"$payload")
            [ -z "$thread_id" ] && { echo ""; return 1; }
            local thread
            thread=$(curl -s "${SITE}/api/v1/sync/ai-bridge/context/message/${thread_id}" "${AUTH[@]}")
            [ -z "$thread" ] && { echo ""; return 1; }
            cat <<EOF
You are drafting a patient-portal reply for Dr. Christopher Mabini, DO, MSAEd —
a fellowship-trained complex benign gynecology / MIGS surgeon.

HE REVIEWS AND SENDS. You are never the final word.

VOICE: warm but direct; plain language; specific over vague; short paragraphs;
no marketing tone, no exclamation marks; never "I hope this finds you well";
start with the answer; sign off "Dr. Mabini".

HARD RULES: do not diagnose, prescribe, change a dose, or promise an outcome.
Do not introduce a clinical fact that is not in the thread. If anything reads
as an emergency, tell them to seek emergency care now. If key information is
missing, ASK rather than assume.

THREAD:
${thread}

Return ONLY the reply text.
EOF
            ;;
        *)
            echo ""; return 1 ;;
    esac
}

process_one() {
    local job
    job=$(curl -s "${SITE}/api/v1/sync/ai-bridge/next?bridge_id=${BRIDGE_ID}" "${AUTH[@]}")
    local id kind payload
    id=$(jq -r '.job.id // empty' <<<"$job" 2>/dev/null)
    [ -z "$id" ] && return 1          # nothing to do

    kind=$(jq -r '.job.kind // empty' <<<"$job")
    payload=$(jq -c '.job.payload // {}' <<<"$job")
    echo "▶ job ${id} (${kind})"

    local prompt
    if ! prompt=$(build_prompt "$kind" "$payload") || [ -z "$prompt" ]; then
        curl -s -X POST "${SITE}/api/v1/sync/ai-bridge/${id}/result" "${AUTH[@]}" \
            -H "Content-Type: application/json" \
            --data "$(jq -nc --arg e "unsupported or unbuildable job kind: ${kind}" '{error:$e}')" >/dev/null
        FAILED=$((FAILED+1)); echo "  ✗ could not build a prompt"; return 0
    fi

    local out
    if ! out=$(printf '%s' "$prompt" | claude -p 2>/dev/null); then
        curl -s -X POST "${SITE}/api/v1/sync/ai-bridge/${id}/result" "${AUTH[@]}" \
            -H "Content-Type: application/json" \
            --data '{"error":"claude CLI invocation failed"}' >/dev/null
        FAILED=$((FAILED+1)); echo "  ✗ claude CLI failed"; return 0
    fi

    curl -s -X POST "${SITE}/api/v1/sync/ai-bridge/${id}/result" "${AUTH[@]}" \
        -H "Content-Type: application/json" \
        --data "$(jq -nc --arg r "$out" '{result:$r, meta:{via:"claude-cli"}}')" >/dev/null
    DONE=$((DONE+1)); echo "  ✓ returned draft ($(printf '%s' "$out" | wc -c | tr -d ' ') bytes)"
    return 0
}

echo "Claude bridge ${VERSION} — ${BRIDGE_ID} -> ${SITE}"
heartbeat

if [ -n "$ONCE" ]; then
    while process_one; do :; done
    heartbeat
    echo "queue drained (done=${DONE} failed=${FAILED})"
    exit 0
fi

while true; do
    worked=0
    while process_one; do worked=1; done
    heartbeat
    [ "$worked" = "0" ] && sleep "$POLL_SECONDS"
done
