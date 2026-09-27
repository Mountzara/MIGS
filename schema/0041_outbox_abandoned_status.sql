-- =====================================================================
-- 0041_outbox_abandoned_status.sql — let the outbox record a send it gave up on
-- =====================================================================
-- WHY. `notification_outbox.status` was constrained to
-- ('sent','failed','unconfigured'), but two code paths write 'abandoned':
--
--   * _lib/notify.js — a recipient on the suppression list (hard bounce or
--     spam complaint) is recorded rather than sent;
--   * internal/notifications/flush.js — a row that has exhausted its
--     retries stops being retried.
--
-- Both INSERTs violated the CHECK, threw, and were swallowed — so a
-- suppressed message left NO RECORD AT ALL, and the retry loop filtered on
-- a status that could never exist. The failure was invisible in exactly
-- the place built to make failures visible.
--
-- SQLite cannot ALTER a CHECK, so the table is rebuilt. Row count here is
-- tiny (single digits) and the copy is exact.
-- =====================================================================

CREATE TABLE IF NOT EXISTS notification_outbox_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email    TEXT    NOT NULL,
    template    TEXT    NOT NULL,
    subject     TEXT    NOT NULL,
    body_text   TEXT,
    body_html   TEXT,
    patient_id  TEXT,
    status      TEXT    NOT NULL CHECK (status IN ('sent', 'failed', 'unconfigured', 'abandoned')),
    error       TEXT,
    attempts    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    sent_at     TEXT
);

INSERT INTO notification_outbox_new
    (id, to_email, template, subject, body_text, body_html, patient_id, status, error, attempts, created_at, sent_at)
SELECT id, to_email, template, subject, body_text, body_html, patient_id, status, error, attempts, created_at, sent_at
  FROM notification_outbox;

DROP TABLE notification_outbox;

ALTER TABLE notification_outbox_new RENAME TO notification_outbox;

CREATE INDEX IF NOT EXISTS idx_outbox_status ON notification_outbox(status, created_at DESC);
