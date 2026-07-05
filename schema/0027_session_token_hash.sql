-- 0027_session_token_hash.sql — close the D1 session-fallback gap
-- getSession's D1 fallback (KV miss) previously accepted a session on
-- session_id ALONE because auth_sessions carried no hash of the bearer
-- secret. This adds the column; createSession now writes the SHA-256 of
-- the token's secret half here (same value mirrored in KV), and the
-- fallback FAILS CLOSED when the stored hash is absent or mismatched.
-- Legacy rows (NULL token_hash) are rejected on KV miss — worst case a
-- 12-hour-TTL session re-authenticates once.
-- Apply: npx wrangler d1 execute mountzara-clinical --remote --file=schema/0027_session_token_hash.sql

ALTER TABLE auth_sessions ADD COLUMN token_hash TEXT;
