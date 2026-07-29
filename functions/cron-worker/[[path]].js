/**
 * Block public access to cron-worker/ source.
 *
 * pages_build_output_dir is "." (wrangler.toml), so every committed file in
 * the repo root is uploaded to the Pages asset bundle. cron-worker/ is a
 * STANDALONE Worker — deployed on its own via `cd cron-worker && npx wrangler
 * deploy`, because Pages Functions cannot take cron triggers — so it is not
 * site content, but it was still being served: `.js` is a served extension.
 *
 * Publishing it exposed the D1 table inventory (auth_sessions,
 * magic_link_tokens, audit_log, billing and triage tables) and the shape of
 * the backup / NPS-dispatch endpoints. No secrets were exposed — the source
 * only references env.PIPELINE_TOKEN and env.MANUAL_BACKUP_TOKEN, whose
 * values live in Wrangler secrets.
 *
 * Note: `.assetsignore` does NOT work here. It is a Workers Static Assets
 * feature; Cloudflare Pages ignores it (verified 2026-07-28 — the file
 * deployed and cron-worker/index.js kept serving). Pages Functions take
 * precedence over static assets, so this is the mechanism that actually
 * works. Nothing on the site references these paths.
 */
export function onRequest() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noai, noimageai, nosnippet, noarchive",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
