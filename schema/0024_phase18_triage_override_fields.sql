-- =====================================================================
-- 0024 — Triage clinician-override: persist urgency / in-person / time-of-day
-- =====================================================================
-- The triage review UI (admin/triage/) lets the clinician override the AI's
-- urgency, in-person requirement, and preferred time-of-day, and the PATCH
-- endpoint validated those fields — but there were no columns to store them, so
-- the UPDATE silently dropped them ("save that doesn't save"). These additive,
-- nullable columns let the override persist (survive reload) alongside the
-- existing visit_type / duration / reason overrides. NULL = "AI value accepted".
--
-- Apply (idempotent only on first run — SQLite ADD COLUMN errors if it exists):
--   npx wrangler d1 execute mountzara-clinical --remote \
--       --file=schema/0024_phase18_triage_override_fields.sql
-- =====================================================================

ALTER TABLE appointment_triage ADD COLUMN clinician_override_urgency TEXT;                 -- 'urgent' | 'routine'
ALTER TABLE appointment_triage ADD COLUMN clinician_override_in_person_required INTEGER;   -- 0/1
ALTER TABLE appointment_triage ADD COLUMN clinician_override_preferred_time_of_day TEXT;   -- 'morning' | 'afternoon' | 'any'
