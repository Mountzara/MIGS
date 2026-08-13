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
# PHI — READ THIS BEFORE CHANGING ANYTHING BELOW
# ---------------------------------------------------------------------
# This script runs `claude -p` against your PERSONAL Claude subscription.
# Your Anthropic BAA covers the API. It does NOT cover a consumer CLI
# subscription. So everything that reaches this machine has left
# BAA-covered infrastructure.
#
# Therefore this script NEVER fetches raw patient content, and it cannot:
# the server refuses. /context returns text that has already been
# Safe-Harbor scrubbed AND re-scanned to verify the scrub; if verification
# fails the server answers 409 and sends nothing at all.
#
# Names and dates arrive as indexed tokens — [NAME_1], [DATE_2]. Write the
# draft using those tokens exactly as given. The server puts the real
# values back before Dr. Mabini reads it. Do not guess at them, and do not
# ask the model to; a token the server cannot resolve causes the job to be
# discarded rather than shown.
#
# Every payload the server released — and every one it refused — is
# recorded at /api/v1/sync/ai-bridge/disclosures with the rule counts.
# Check it any time you want to see exactly what left.
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
    local ref resp text removed

    # Every kind fetches its context from the SAME de-identified endpoint.
    # There is no path here that obtains raw patient text — the server
    # refuses, and that is deliberate (see the header).
    case "$kind" in
        message_draft)      ref=$(jq -r '.thread_id // empty' <<<"$payload") ;;
        intake_summary)     ref=$(jq -r '.intake_id // empty' <<<"$payload") ;;
        visit_summary)      ref=$(jq -r '.encounter_id // empty' <<<"$payload") ;;
        enrollment_extract) ref=$(jq -r '.document_id // empty' <<<"$payload") ;;
        *) echo ""; return 1 ;;
    esac
    [ -z "$ref" ] && { echo ""; return 1; }

    resp=$(curl -s "${SITE}/api/v1/sync/ai-bridge/context/${kind}/${ref}?bridge_id=${BRIDGE_ID}&job_id=${JOB_ID}" "${AUTH[@]}")
    text=$(jq -r '.text // empty' <<<"$resp")
    if [ -z "$text" ]; then
        echo "  ! server released nothing: $(jq -r '.error // "no text"' <<<"$resp")" >&2
        echo ""; return 1
    fi
    removed=$(jq -r '[.deid.removed[]? | "\(.count) \(.key)"] | join(", ")' <<<"$resp" 2>/dev/null)
    [ -n "$removed" ] && echo "  · de-identified: ${removed}" >&2

    case "$kind" in
    message_draft)
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

TOKENS: this thread has been de-identified. Names and dates appear as
[NAME_1], [DATE_2] and so on. Use those tokens verbatim wherever you would
have written the name or the date — the real values are restored on the
server before Dr. Mabini sees the draft. NEVER invent a token that does not
appear below.

THREAD:
${text}

Return ONLY the reply text.
EOF
        ;;
    intake_summary)
        cat <<EOF
You are triaging a new-patient intake for Dr. Christopher Mabini, DO — a
fellowship-trained complex benign gynecologic surgeon. Your job is to decide
what KIND of appointment this person needs and how long it should be.

Return ONLY a JSON object, no prose, no code fence:
{
  "visit_type": one of: new_patient_complex | new_patient_standard |
                complex_pelvic_pain | endometriosis_followup | heavy_bleeding |
                preop | postop_early | postop_late | routine_followup |
                office_procedure | quick_concern | annual | telehealth_consult,
  "duration_min": 15 | 20 | 30 | 45 | 60,
  "urgency": "routine" | "soon" | "urgent",
  "in_person_required": true | false,
  "preferred_time_of_day": "any" | "morning" | "afternoon",
  "chaperone_required": true | false,
  "rationale": "<=400 chars, why this visit type and length",
  "secondary_concerns": ["short phrases worth raising at the visit"]
}

RULES:
  * Base it ONLY on what the intake says. Invent nothing.
  * Anything suggesting an emergency — heavy active bleeding, severe acute
    pain, syncope, fever with pelvic pain, pregnancy with bleeding — set
    urgency "urgent" and say so in the rationale.
  * Anything needing an examination or a procedure is in_person_required.
  * Longer for complex pain and multi-system histories; shorter for a single
    focused question.
  * Dates and names are tokens like [DATE_1]. Do not try to resolve them.

INTAKE:
${text}
EOF
        ;;
    visit_summary)
        cat <<EOF
You are writing the after-visit summary for a patient of Dr. Christopher
Mabini, DO. He reads it and decides whether to approve it before the patient
ever sees it.

Produce TWO summaries separated by a line containing only ---CLINICIAN---

FIRST the PATIENT-FACING summary:
  * Second person, plain language, explain any medical word on first use.
  * Headings: What we talked about / The plan / Your medicines / What happens next
  * ONLY what is in the note. No added fact, no reassurance, no new advice.
  * Do not promise an outcome. Do not minimise anything the patient raised.
    Do not speculate about what a symptom "could be".
  * Where the note records uncertainty, say so — "we do not know yet" is a
    real and useful sentence.

THEN ---CLINICIAN--- and the clinician summary: dense, keeps terminology,
assessment and plan, ending with a line starting "UNCERTAIN:" listing anything
ambiguous or contradictory in the note. If nothing, "UNCERTAIN: none".

Dates and names are tokens like [DATE_1]. Use them verbatim; the server
restores the real values.

NOTE:
${text}
EOF
        ;;
    enrollment_extract)
        cat <<EOF
Read this administrative document belonging to the practice and extract the
identifiers a clearinghouse enrolment form asks for.

Return ONLY JSON:
{"fields": {"<field>": {"value": "...", "quote": "<verbatim span from the document>", "confidence": "high|medium|low"}}, "notes": []}

RULES:
  * EVERY field must carry a verbatim quote. No quote, omit the field.
  * Never infer, complete or correct a value.
  * Fields allowed: legal_name, dba_name, entity_type, tin, npi_individual,
    npi_group, taxonomy_code, license_state, license_number, medicare_ptan,
    medicaid_id, caqh_id, practice_street, practice_city, practice_state,
    practice_zip, contact_name, contact_phone, contact_fax, contact_email.

DOCUMENT:
${text}
EOF
        ;;
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
    JOB_ID="$id"; export JOB_ID
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
