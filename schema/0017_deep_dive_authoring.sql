-- ====================================================================
-- 0017_deep_dive_authoring.sql
-- Phase QG — per-PMID deep-dive journal-club authoring queue
-- ====================================================================
-- Per CLAUDE.md §3.9 (NO-heuristic clinical content — 2026-05-20):
-- every §3.9 12-section deep-dive modal on any journal-club surface
-- (trend briefs, CBG/MIGS Monday Mornings, future evidence briefs)
-- requires clinician peer-review authorship for 12 of its 13 sections.
-- (Section #4 — verbatim PubMed abstract — is auto-filled per §3.7.)
--
-- Prior to Phase QG the only authoring path was a per-week per-PMID
-- shell pipeline (prep_w21_deep_dive_bundle.py → Cowork → apply patch),
-- discoverable only from the CLI.  Every queued trend brief has 6–15
-- unique PMIDs needing this treatment — across the 5 briefs queued
-- 2026-05-26 that's ~37 unique PMIDs, none authored.
--
-- This table tracks the per-PMID authoring state across ALL journal-
-- club surfaces.  Surface-agnostic by design — `surface_kind` +
-- `surface_key` identify which renderer consumes the authored content.
--
-- Privacy posture: cite-card metadata is published peer-reviewed
-- literature (PubMed PMIDs).  NOT PHI.  BAA-not-gated per §12.2.
-- ====================================================================

CREATE TABLE IF NOT EXISTS deep_dive_authoring (
    -- Composite primary key: "<surface_kind>:<surface_key>:<pmid>".
    -- Example for a trend brief PMID:
    --   "trend_brief:2026-05-26__joint-hypermobility-and-pots-are-more-common-in-endometriosi:34899597"
    -- Example for a Monday Morning PMID:
    --   "monday_morning:W21:38234567"
    id                      TEXT PRIMARY KEY,
    surface_kind            TEXT NOT NULL,             -- 'trend_brief' | 'monday_morning' | future
    surface_key             TEXT NOT NULL,             -- brief_id | week_label
    pmid                    TEXT NOT NULL,

    -- Paper metadata (denormalized from sidecar / verified_pmids.json
    -- so the UI can render the PMID list without re-fetching).
    paper_title             TEXT,
    paper_journal           TEXT,
    paper_year              INTEGER,
    paper_design            TEXT,                      -- e.g. 'meta-analysis' / 'RCT' / 'cohort'

    -- State machine:
    --   pending           — no work yet; default for every newly-discovered PMID
    --   bundle_requested  — admin clicked "Materialize Cowork bundle"; Mac puller will pick up
    --   bundle_ready      — Mac side materialized the .bundle.md + clipboard trigger; awaiting Cowork session
    --   patch_uploaded    — Cowork session emitted patch.json; admin uploaded via /patch endpoint
    --   authored          — apply_deep_dive_patch.py merged content into the surface's storage
    --                       (override.json for trend briefs, deep_dive_content.json for Monday Mornings)
    status                  TEXT NOT NULL DEFAULT 'pending',
    status_reason           TEXT,

    -- R2 artifact references (under mountzara-content/deep-dive-authoring/<id>/)
    bundle_r2_key           TEXT,
    bundle_local_path       TEXT,
    patch_r2_key            TEXT,

    -- The authored 13-section content (mirror of what apply_*_patch
    -- writes into the surface storage).  Persisted here too so the
    -- queue UI can show authored status + re-export if the local
    -- working-tree gets corrupted.
    content_json            TEXT,

    -- Timestamps (epoch ms)
    bundle_requested_at     INTEGER,
    bundle_requested_by     TEXT,                      -- admin user
    bundle_ready_at         INTEGER,
    patch_uploaded_at       INTEGER,
    patch_uploaded_by       TEXT,
    authored_at             INTEGER,
    pulled_at               INTEGER,                   -- Mac orchestrator last successfully pulled this row

    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dd_surface     ON deep_dive_authoring(surface_kind, surface_key);
CREATE INDEX IF NOT EXISTS idx_dd_status      ON deep_dive_authoring(status, surface_kind);
CREATE INDEX IF NOT EXISTS idx_dd_pmid        ON deep_dive_authoring(pmid);
CREATE INDEX IF NOT EXISTS idx_dd_authored    ON deep_dive_authoring(authored_at) WHERE authored_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dd_bundle_req  ON deep_dive_authoring(bundle_requested_at) WHERE bundle_requested_at IS NOT NULL;


-- ====================================================================
-- deep_dive_audit_events — append-only state-change log per PMID
-- ====================================================================
CREATE TABLE IF NOT EXISTS deep_dive_audit_events (
    id              TEXT PRIMARY KEY,
    authoring_id    TEXT NOT NULL,                     -- FK -> deep_dive_authoring(id)
    ts              INTEGER NOT NULL,
    actor           TEXT NOT NULL,                     -- 'admin' | 'pipeline' | 'mac_puller' | 'cowork'
    actor_label     TEXT,
    event_kind      TEXT NOT NULL,                     -- discovered | prep_requested | bundle_materialized | patch_uploaded | authored | rerender_passed
    detail_json     TEXT,
    FOREIGN KEY (authoring_id) REFERENCES deep_dive_authoring(id)
);

CREATE INDEX IF NOT EXISTS idx_dd_audit ON deep_dive_audit_events(authoring_id, ts);
