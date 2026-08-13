-- ====================================================================
-- 0028_notification_outbox.sql
-- Outbound notification transport — the missing keystone (2026-08-12)
-- ====================================================================
-- The platform had NO email transport of any kind. A grep for
-- resend|sendgrid|mailchannels|smtp|postmark across functions/ returned
-- zero files. functions/_lib/auth.js::issueMagicLink() minted and stored
-- a sign-in token but never delivered it; _lib/messaging.js wrote a
-- message and notified nobody.
--
-- The owner found it the only way anyone could: "the messaging system -
-- i tried it and it doesn't notify members via their email of the
-- message to login - they would never know". The same absent layer
-- silently disabled magic-link sign-in, appointment confirmations, visit
-- links, intake reminders and invoice notices.
--
-- This table is the durable record behind functions/_lib/notify.js.
-- EVERY notification is written here — delivered, failed, or queued
-- because no provider is configured yet. Nothing is ever silently
-- dropped, which is precisely the failure mode that hid the original
-- bug: a send path that fails quietly is indistinguishable from one that
-- was never built.
--
-- status:
--   'sent'          handed to the provider successfully
--   'failed'        provider rejected or errored (see error, retryable)
--   'unconfigured'  NOTIFY_PROVIDER / NOTIFY_API_KEY / NOTIFY_FROM unset;
--                   queued so it can be flushed once credentials exist
--
-- PHI: body_text/body_html are content-free by construction — templates in
-- notify.js carry no clinical detail, only "sign in to read it" plus a
-- link, and sanitizeForEmail() throws if clinical text reaches them. This
-- table is therefore safe to inspect operationally, but it does contain
-- email addresses (identifiers) and is treated as PHI-adjacent.
-- ====================================================================

CREATE TABLE IF NOT EXISTS notification_outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email    TEXT    NOT NULL,
    template    TEXT    NOT NULL,
    subject     TEXT    NOT NULL,
    body_text   TEXT,
    body_html   TEXT,
    patient_id  TEXT,
    status      TEXT    NOT NULL CHECK (status IN ('sent', 'failed', 'unconfigured')),
    error       TEXT,
    attempts    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    sent_at     TEXT
);

-- Operational queries: "what is stuck?" and "what did we send this patient?"
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
    ON notification_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_patient
    ON notification_outbox (patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_template
    ON notification_outbox (template, created_at);
