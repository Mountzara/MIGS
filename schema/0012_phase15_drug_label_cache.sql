-- =====================================================================
-- 0012_phase15_drug_label_cache.sql
-- =====================================================================
-- Phase 15 — Medication AE / SE detection.
--
-- openFDA drug label cache. Per CLAUDE.md §3.6 every drug-label claim
-- the briefing surfaces must trace to a logged validated-API response.
-- We cache full label payloads keyed by the normalized drug name so a
-- patient with multiple meds doesn't blow the Worker subrequest budget,
-- and so a 30-day window of briefings re-uses identical label evidence.
--
-- The label JSON is large but compresses well; we store it as TEXT.
-- Lookup pattern: normalize the patient-typed med name (lowercase, strip
-- punctuation, lemmatize common dose suffixes), check cache, on miss
-- hit https://api.fda.gov/drug/label.json?search=openfda.brand_name:"<x>"
-- (or generic_name as fallback), record the set_id from the response,
-- store JSON + fetched_at, return.
--
-- TTL: 30 days. openFDA label data is updated on FDA approval cycles
-- and we don't need real-time freshness; the cache prevents drift across
-- a single review window.
-- =====================================================================

CREATE TABLE IF NOT EXISTS drug_label_cache (
    -- Normalized lookup key (lowercase, no punctuation, no dose suffix)
    drug_key             TEXT PRIMARY KEY,                     -- e.g. 'ozempic', 'metformin'
    -- The patient-facing name the search resolved to.
    canonical_brand_name TEXT,
    canonical_generic_name TEXT,
    -- openFDA's stable identifier for the label document.
    set_id               TEXT,
    -- The search query field we ultimately matched on.
    matched_on           TEXT,                                 -- 'brand_name' | 'generic_name' | 'substance_name' | 'no_match'
    -- Full label JSON. Large; pulled lazily by engine when needed.
    label_json           TEXT,
    -- When we fetched + when this row should be considered stale.
    fetched_at           INTEGER NOT NULL,                      -- ms epoch
    ttl_days             INTEGER NOT NULL DEFAULT 30,
    -- For diagnostics: HTTP status + duration of the openFDA call.
    last_http_status     INTEGER,
    last_duration_ms     INTEGER,
    -- Did the API return zero results? We cache the "no match" outcome too
    -- so we don't re-hit openFDA for unrecognized drug names on every render.
    not_found            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_drug_label_cache_fetched
    ON drug_label_cache(fetched_at);
