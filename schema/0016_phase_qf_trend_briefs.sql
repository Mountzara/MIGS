-- ====================================================================
-- 0016_phase_qf_trend_briefs.sql
-- Phase QF — trend-brief peer-review queue
-- ====================================================================
-- Per CLAUDE.md §3.8 (NO-AUTO-VERDICT — codified 2026-05-19): every
-- trend brief that trend_tracker generates carries `verdict = "review
-- required"` until a clinician-authored override JSON supplies an
-- explicit verdict. The §3.8 verifier's verdict-gate row INTENTIONALLY
-- fails when the rendered body still carries the "REVIEW REQUIRED"
-- label, blocking publish until override exists.
--
-- Previously this gate produced a silent abort in publish_to_admin.py:
-- the brief existed locally on the Mac, but nothing surfaced in the
-- admin queue. Chris had to either hand-author the override JSON or
-- run the Cowork bundle workflow — both required leaving the browser.
--
-- This table is the queue. When the producer detects "verdict-gate is
-- the ONLY failing row" (all other 31 §3.8 checks pass), it POSTs the
-- rendered brief to /api/v1/admin/trend-briefs/pending-review. That
-- endpoint inserts a row here and stores the rendered body_html +
-- sidecar JSON in R2 mountzara-content under trend-briefs-pending/<id>/.
-- The /admin/trend-briefs/ SPA renders the queue, lets Chris approve
-- with a verdict + rationale (and optional extra_meta_cards /
-- extra_mech_cards / deep_dive_content per §3.8 2026-05-20 sub-rule),
-- and the Mac-side scripts/pull_approved_overrides.py picks up
-- approved overrides on the next orchestrator run.
--
-- Privacy posture: trend briefs cite published peer-reviewed literature
-- (PubMed PMIDs) — they are NOT PHI. This table contains no patient
-- data and is BAA-not-gated per §12.2 (Phase 1–4 of agent platform).
-- ====================================================================

CREATE TABLE IF NOT EXISTS trend_brief_pending (
    -- Primary key uses the slug ("glp-1-receptor-agonists-cause-...")
    -- the same way trend_tracker names the .md/.json files. One row
    -- per (brief_date, slug); re-submissions of the same slug+date
    -- overwrite via PUT semantics (the producer endpoint detects an
    -- existing row and updates it).
    id                      TEXT PRIMARY KEY,           -- "<brief_date>__<slug>"
    slug                    TEXT NOT NULL,              -- the trend_tracker slug
    brief_date              TEXT NOT NULL,              -- 'YYYY-MM-DD'
    claim_text              TEXT NOT NULL,              -- verbatim claim from sidecar
    influencer              TEXT,                       -- source influencer/account if known
    topics_covered          TEXT,                       -- JSON array of strings
    pmids_cited             TEXT,                       -- JSON array of PMIDs
    kb_entries_retrieved    TEXT,                       -- JSON array of KB doc UUIDs
    gaps_surfaced           TEXT,                       -- JSON array of gap strings

    -- R2 keys under mountzara-content
    body_html_r2_key        TEXT NOT NULL,              -- 'trend-briefs-pending/<id>/body.html'
    sidecar_r2_key          TEXT NOT NULL,              -- 'trend-briefs-pending/<id>/sidecar.json'

    -- §3.8 audit table (JSON list of {label, ok, observed, threshold})
    -- — surfaces in the per-brief view so Chris sees exactly which
    -- row blocked publish (always the verdict-gate row for queue-eligible
    -- submissions; other failures hard-abort upstream).
    audit_table_json        TEXT NOT NULL,
    audit_pass_count        INTEGER NOT NULL,
    audit_fail_count        INTEGER NOT NULL,

    -- State machine: pending → approved | rejected
    -- 'approved' rows persist with override_json populated; the Mac
    -- puller GETs /overrides?since=<ts> and downloads them by
    -- approved_at. 'rejected' rows persist for audit; the Mac puller
    -- ignores them.
    status                  TEXT NOT NULL DEFAULT 'pending',
    status_reason           TEXT,                       -- operator note on reject

    -- Override JSON written on approve. Schema mirrors what
    -- gold_brief_render.py expects: { verdict, verdict_label, rationale,
    -- bottom_line, level_a_items[], pyramid_rows[], do_migs_lens,
    -- gap_paragraphs[], counseling[], extra_meta_cards[],
    -- extra_mech_cards[], deep_dive_content{} }. Persisted here AND
    -- mirrored to R2 at trend-briefs-pending/<id>/override.json so the
    -- Mac puller can GET it without needing D1 access.
    override_json           TEXT,
    override_r2_key         TEXT,                       -- 'trend-briefs-pending/<id>/override.json'

    -- Approval workflow timestamps (epoch ms)
    submitted_at            INTEGER NOT NULL,
    approved_at             INTEGER,
    approved_by             TEXT,                       -- admin user (chris.mabini@gmail.com)
    rejected_at             INTEGER,
    rejected_by             TEXT,

    -- Mac-side pulled tracking. After scripts/pull_approved_overrides.py
    -- successfully writes the override locally, it PATCHes this row
    -- with pulled_at — closes the loop for diagnostics.
    pulled_at               INTEGER,

    -- Re-render outcome. Once the next orchestrator run picks up the
    -- override and POSTs to /api/posts as a draft, the publish_to_admin
    -- script PATCHes this row with rerender_passed=1 + draft_post_id.
    -- The /admin/trend-briefs/ SPA hides queue items where this is set,
    -- moving them to a "Recently Approved" history view instead.
    rerender_passed         INTEGER,                    -- 1 = §3.8 passed on re-render
    rerender_attempted_at   INTEGER,
    draft_post_id           TEXT,                       -- 'evidence-<date>-<slug>'

    -- Free-text suggestions Chris typed in the UI but did NOT click
    -- approve on (Phase QF.2 path). When set, the Mac puller will
    -- materialize a Cowork peer-review bundle via prep_peer_review.py
    -- and surface a clipboard-ready trigger string. Cleared on approve
    -- or reject.
    suggestions_text        TEXT,
    suggestions_set_at      INTEGER,

    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trend_brief_pending_status     ON trend_brief_pending(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_brief_pending_brief_date ON trend_brief_pending(brief_date DESC);
CREATE INDEX IF NOT EXISTS idx_trend_brief_pending_approved   ON trend_brief_pending(approved_at) WHERE approved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trend_brief_pending_slug       ON trend_brief_pending(slug);


-- ====================================================================
-- trend_brief_audit_events — append-only state-change log
-- ====================================================================
-- Mirrors feedback_audit_events from Phase QB. Used by the per-brief
-- view's timeline rail to show: submitted → (suggestions set) → approved
-- → (Mac pulled) → (re-rendered + queued draft).
-- ====================================================================
CREATE TABLE IF NOT EXISTS trend_brief_audit_events (
    id              TEXT PRIMARY KEY,
    brief_id        TEXT NOT NULL,                      -- FK -> trend_brief_pending(id)
    ts              INTEGER NOT NULL,
    actor           TEXT NOT NULL,                      -- 'pipeline' | 'admin' | 'mac_puller' | 'system'
    actor_label     TEXT,                               -- admin email / hostname
    event_kind      TEXT NOT NULL,                      -- submitted | suggestions_set | approved | rejected | mac_pulled | rerender_ok | rerender_fail
    detail_json     TEXT,
    FOREIGN KEY (brief_id) REFERENCES trend_brief_pending(id)
);

CREATE INDEX IF NOT EXISTS idx_trend_brief_audit_brief ON trend_brief_audit_events(brief_id, ts);
