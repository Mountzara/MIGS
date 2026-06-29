-- =====================================================================
-- 0026_kb_fts.sql — Knowledge-base full-text index for RAG grounding.
-- =====================================================================
-- A reusable retrieval surface (SQLite FTS5) so ANY backend Claude process
-- can ground its prompt in the master OB/GYN KB via functions/_lib/kb.js.
--
-- Populated out-of-band by scripts/kb_load_d1.py from the master kb_chunks
-- corpus (823 ACOG / FMIGS / UpToDate / AAGL reference docs). This is
-- reference knowledge — NOT PHI.
--
-- Columns: doc_id / source are UNINDEXED metadata; title + text are the
-- searchable fields. Rebuild by re-running the loader (it DROPs + recreates).
-- =====================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS kb_docs USING fts5(
    doc_id UNINDEXED,
    source UNINDEXED,
    title,
    text,
    tokenize = 'porter unicode61'
);
