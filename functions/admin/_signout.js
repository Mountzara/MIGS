// =====================================================================
// /admin/_signout — drop cached admin Basic Auth credentials
// =====================================================================
// HTTP Basic Auth has no real "log out" — the browser caches credentials
// per-realm and re-sends them automatically. The standard workaround is
// to return a 401 with a DIFFERENT realm than the one the credentials
// were entered against. The browser, seeing an unfamiliar realm, drops
// the cached cred and (depending on the visit pattern) prompts again.
//
// We return a small HTML page so the operator gets a friendly message
// instead of just a 401, AND the Set-Cookie strip below clears any
// patient session cookie that happens to be present in the same browser
// (clinicians who tested portal flows in the same window can sometimes
// pick one up).
// =====================================================================

export async function onRequest({ request, env }) {
    // Built first, then the admin-session cookie is appended before return.
    const clearAdmin = (await import("../_lib/admin_session.js")).clearAdminSessionCookie();
    // Always return 401 with a new realm. The browser clearing happens
    // because the realm differs from "Mount Zara Admin" used everywhere
    // else; the cache is keyed by (origin, realm).
    const resp = new Response(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Signed out · Mount Zara Admin</title>
    <meta name="robots" content="noindex, nofollow">
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        html, body {
            margin: 0; padding: 0;
            background:
                radial-gradient(ellipse 80% 60% at 50% -10%, rgba(167, 139, 250, 0.18), transparent 60%),
                #120b22;
            color: #ffffff;
            font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
            -webkit-font-smoothing: antialiased;
        }
        .card {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 14px;
            padding: 36px 40px;
            text-align: center;
            backdrop-filter: blur(28px) saturate(165%);
            -webkit-backdrop-filter: blur(28px) saturate(165%);
            max-width: 420px;
        }
        .eyebrow {
            font-size: 11px; font-weight: 700;
            letter-spacing: 0.22em; text-transform: uppercase;
            color: rgba(167, 139, 250, 0.95);
            margin-bottom: 14px;
        }
        h1 {
            font-weight: 200;
            font-size: 30px;
            letter-spacing: -0.02em;
            color: #ffffff;
            margin: 0 0 12px 0;
        }
        p {
            font-size: 14.5px; line-height: 1.6;
            color: #ffffff;
            margin: 0 0 18px 0;
        }
        a.btn {
            display: inline-block;
            text-decoration: none;
            font-size: 13.5px; font-weight: 500;
            color: rgba(167, 139, 250, 0.98);
            background: rgba(167, 139, 250, 0.12);
            border: 1px solid rgba(167, 139, 250, 0.45);
            border-radius: 9px;
            padding: 10px 18px;
            transition: transform 0.18s, background 0.18s, color 0.18s;
        }
        a.btn:hover {
            transform: translateY(-1px);
            color: #ffffff;
            background: rgba(167, 139, 250, 0.22);
        }
        a.btn.secondary {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.12);
            margin-left: 8px;
        }
        a.btn.secondary:hover { color: #ffffff; }
        .small {
            margin-top: 22px;
            font-size: 11.5px;
            color: #ffffff;
            line-height: 1.55;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="eyebrow">Signed out</div>
        <h1>You're signed out of the admin.</h1>
        <p>Your browser has dropped the cached admin credentials. Close this tab when you're done, or click below to sign back in.</p>
        <a class="btn" href="/admin/_login">Sign back in</a>
        <a class="btn secondary" href="/">Go home</a>
        <div class="small">
            If the next admin page still loads without prompting, fully quit and reopen your browser to be certain — some browsers stubbornly cache Basic Auth credentials per-window.
        </div>
    </div>
</body>
</html>`, {
        status: 401,
        headers: {
            // Different realm = different protection space per RFC 7617 §2.2,
            // so the browser will not re-send the cached "Mount Zara Admin"
            // credentials. Visiting /admin/ afterwards triggers a fresh
            // prompt.
            "WWW-Authenticate": 'Basic realm="Mount Zara Admin — Signed out", charset="UTF-8"',
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            // Strip any member portal session cookie that might be in the
            // same browser. Idempotent if no cookie present.
            // Signing out must kill the ADMIN SESSION as well, or the
            // cookie keeps the backend open after the operator believes
            // they have left. A second Set-Cookie needs Headers.append,
            // so the response is rebuilt below.
            "set-cookie": "mz_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
    });
    resp.headers.append("Set-Cookie", clearAdmin);
    return resp;
}
