// =====================================================================
// GET /api/v1/admin/trend-briefs/<id>/preview
// =====================================================================
// Returns the rendered body_html for the iframe preview in
// /admin/trend-briefs/.  Wraps the body_html in a minimal HTML shell
// that loads the same fonts + sets a transparent background so the
// brief renders identically to how it will appear once published to
// /evidence/.
//
// Admin-auth gated; never expose this to the public.
// =====================================================================

import { adminRoute, jsonError } from "../../../../../_lib/admin_api.js";

const PREVIEW_SHELL_PREFIX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Trend brief preview · Mount Zara Admin</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap" rel="stylesheet">
<style>
  :root {
    --accent: #6d28d9;
    --glow-purple: 167, 139, 250;
    --bg-base: #120b22;
    --fg-strong: #ffffff;
    --fg-mid: rgba(245, 245, 247, 0.88);
    --fg-soft: rgba(245, 245, 247, 0.62);
    --hairline: rgba(255, 255, 255, 0.08);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background:
      radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--glow-purple), 0.10), transparent 60%),
      var(--bg-base);
    color: var(--fg-mid);
    font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: "ss01", "cv11";
    line-height: 1.55;
  }
  .preview-shell { max-width: 920px; margin: 0 auto; padding: 28px 24px 100px; }
  .preview-banner {
    font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(var(--glow-purple), 0.92);
    padding: 10px 14px; border: 1px solid rgba(var(--glow-purple), 0.32);
    border-radius: 999px;
    display: inline-block; margin-bottom: 18px;
    background: rgba(var(--glow-purple), 0.07);
  }
</style>
</head>
<body>
<div class="preview-shell">
<div class="preview-banner">Admin preview · not the public render</div>
`;

const PREVIEW_SHELL_SUFFIX = `
</div>
</body>
</html>`;

export async function onRequestGet(ctx) {
    return adminRoute(ctx, async ({ env, params }) => {
        if (!env.CONTENT) return jsonError("server_error: CONTENT R2 bucket binding missing", 500);
        if (!env.DB)      return jsonError("server_error: DB binding missing", 500);

        const id = decodeURIComponent(String(params?.id || ""));
        if (!id) return jsonError("bad_id", 400);

        const row = await env.DB.prepare(
            "SELECT body_html_r2_key FROM trend_brief_pending WHERE id = ?"
        ).bind(id).first();
        if (!row) return jsonError("not_found", 404);

        let body = null;
        try {
            const obj = await env.CONTENT.get(row.body_html_r2_key);
            if (obj) body = await obj.text();
        } catch (e) {
            console.error("preview R2 get failed", { id, error: String(e) });
            return jsonError("r2_get_failed: " + String(e), 502);
        }
        if (!body) return jsonError("body_html_missing_in_r2", 404);

        const html = PREVIEW_SHELL_PREFIX + body + PREVIEW_SHELL_SUFFIX;
        return new Response(html, {
            status: 200,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                "x-robots-tag": "noindex, nofollow",
                "x-frame-options": "SAMEORIGIN",   // allow iframe within /admin/
                "referrer-policy": "strict-origin-when-cross-origin",
            },
        });
    });
}
