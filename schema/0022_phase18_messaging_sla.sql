-- ====================================================================
-- 0022_phase18_messaging_sla.sql
-- Phase 18 — Sprint 2 R8: asynchronous-messaging response-window SLA
-- ====================================================================
-- Joshi & Welch (2023) — commit to a response window and meet it.
-- Mount Zara's windows: URGENT = close of the next business day;
-- NON-URGENT = within 48 business hours (close of the second business
-- day). Computed in functions/_lib/messaging.js::computeSlaDueAt using
-- America/Chicago business days (Mon–Fri, close 17:00 CT).
--
-- Clock semantics:
--   * Patient-originated thread/reply  -> sla_due_at set (clock running).
--   * Clinician reply                  -> sla_due_at cleared (clock met).
--   * sla_breached flips to 1 by the 15-minute mountzara-cron sweep when
--     sla_due_at < now; surfaced in /admin/messages/ + audit-logged.
--
-- Times are INTEGER ms epoch, consistent with message_threads'
-- last_message_at / created_at / updated_at columns.
--
-- NOTE: ALTER TABLE ADD COLUMN is NOT idempotent — apply exactly once
-- at the sprint-close deploy, BEFORE the code push:
--   wrangler d1 execute mountzara-clinical --remote \
--       --file=schema/0022_phase18_messaging_sla.sql
-- ====================================================================
ALTER TABLE message_threads ADD COLUMN urgency TEXT NOT NULL DEFAULT 'non_urgent'
    CHECK (urgency IN ('urgent','non_urgent'));
ALTER TABLE message_threads ADD COLUMN sla_due_at INTEGER;
ALTER TABLE message_threads ADD COLUMN sla_breached INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_threads_sla_due
    ON message_threads(sla_due_at)
    WHERE sla_breached = 0 AND sla_due_at IS NOT NULL;
