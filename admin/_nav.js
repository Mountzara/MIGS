// =====================================================================
// /admin/_nav.js — shared admin section navigation
// =====================================================================
// Injects a horizontal section nav at the top of every /admin/* page so
// the operator can move seamlessly between Posts, Patients, Scheduling,
// Triage, Messages, Education, and Analytics. Active link is highlighted
// based on the current pathname.
//
// To pick this up on a new admin page, just add:
//     <script src="/admin/_nav.js"></script>
// near the top of the <body>. The script handles its own styling +
// injection point.
//
// §3.10 Apple-glass purple, sticky to top, mobile-friendly horizontal
// scroll on narrow viewports, prefers-reduced-motion override.
// =====================================================================

(function () {
    if (window.__mzAdminNavInstalled) return;
    window.__mzAdminNavInstalled = true;

    const SECTIONS = [
        { key: 'dashboard',  label: 'Dashboard',    href: '/admin/',            match: /^\/admin\/?$/           },
        { key: 'patients',   label: 'Patients',     href: '/admin/patients/',   match: /^\/admin\/(patients|cases)\b/ },
        { key: 'briefings',  label: 'Briefings',    href: '/admin/briefings/',  match: /^\/admin\/briefings\b/  },
        { key: 'scheduling', label: 'Scheduling',   href: '/admin/scheduling/', match: /^\/admin\/scheduling\b/ },
        { key: 'triage',     label: 'Triage',       href: '/admin/triage/',     match: /^\/admin\/triage\b/     },
        { key: 'messages',   label: 'Messages',     href: '/admin/messages/',   match: /^\/admin\/messages\b/   },
        { key: 'billing',    label: 'Billing',      href: '/admin/billing/',    match: /^\/admin\/billing\b/    },
        { key: 'analytics',  label: 'Analytics',    href: '/admin/analytics/',  match: /^\/admin\/analytics\b/  },
    { key: 'membership', label: 'Membership',   href: '/admin/membership/', match: /^\/admin\/membership\b/ },
        { key: 'education',  label: 'Education',    href: '/admin/education/',  match: /^\/admin\/education\b/  },
        { key: 'content',    label: 'Content',      href: '/admin/content/',    match: /^\/admin\/content\b/    },
        { key: 'carousels',  label: 'Carousels',    href: '/admin/carousels/',  match: /^\/admin\/carousels\b/  },
        { key: 'trendbriefs',label: 'Trend Briefs', href: '/admin/trend-briefs/', match: /^\/admin\/trend-briefs\b/ },
        { key: 'compliance', label: 'Compliance',   href: '/admin/compliance/', match: /^\/admin\/compliance\b/ },
        { key: 'feedback',   label: 'Feedback',     href: '/admin/feedback/',   match: /^\/admin\/feedback\b/   },
        { key: 'debug',      label: 'Debug',        href: '/admin/debug/sessions/', match: /^\/admin\/debug\b/  },
    ];

    const STYLE = `
        .mz-admin-section-nav {
            position: sticky; top: 0; z-index: 999;
            background: rgba(7, 7, 10, 0.86);
            backdrop-filter: blur(22px) saturate(165%);
            -webkit-backdrop-filter: blur(22px) saturate(165%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding: 10px clamp(16px, 4vw, 32px);
        }
        .mz-admin-section-nav .mz-asn-inner {
            display: flex; align-items: center; gap: 8px;
            max-width: 1280px; margin: 0 auto;
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(167, 139, 250, 0.4) transparent;
        }
        .mz-admin-section-nav .mz-asn-inner::-webkit-scrollbar { height: 4px; }
        .mz-admin-section-nav .mz-asn-inner::-webkit-scrollbar-thumb { background: rgba(167, 139, 250, 0.4); border-radius: 2px; }
        .mz-admin-section-nav .mz-asn-brand {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 11px; font-weight: 700;
            letter-spacing: 0.20em; text-transform: uppercase;
            color: rgba(167, 139, 250, 0.95);
            padding: 6px 12px;
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            margin-right: 6px;
            white-space: nowrap;
            text-decoration: none;
            transition: color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-brand:hover { color: #ffffff; }
        .mz-admin-section-nav .mz-asn-link {
            font: inherit;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 999px;
            padding: 6px 14px;
            color: rgba(245, 245, 247, 0.72);
            font-size: 12.5px;
            font-weight: 500;
            letter-spacing: 0.02em;
            text-decoration: none;
            white-space: nowrap;
            transition: transform 0.18s, background 0.18s, border-color 0.18s, color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-link:hover {
            transform: translateY(-1px);
            color: #ffffff;
            border-color: rgba(167, 139, 250, 0.45);
            background: rgba(167, 139, 250, 0.06);
        }
        .mz-admin-section-nav .mz-asn-link.active {
            background: rgba(167, 139, 250, 0.16);
            border-color: rgba(167, 139, 250, 0.55);
            color: rgba(167, 139, 250, 0.98);
        }
        .mz-admin-section-nav .mz-asn-spacer { flex: 1; }
        .mz-admin-section-nav .mz-asn-right {
            display: inline-flex; align-items: center; gap: 10px;
            font-size: 11px; color: rgba(245, 245, 247, 0.42);
            white-space: nowrap;
        }
        .mz-admin-section-nav .mz-asn-portal-link {
            font-size: 11.5px;
            color: rgba(167, 139, 250, 0.85);
            text-decoration: none;
            padding: 4px 10px;
            border-radius: 6px;
            transition: background 0.18s, color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-portal-link:hover {
            background: rgba(167, 139, 250, 0.10);
            color: #ffffff;
        }
        .mz-admin-section-nav .mz-asn-signout {
            font-size: 11.5px;
            color: rgba(245, 245, 247, 0.55);
            text-decoration: none;
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(255, 255, 255, 0.02);
            transition: background 0.18s, color 0.18s, border-color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-signout:hover {
            background: rgba(239, 68, 68, 0.10);
            color: rgba(252, 165, 165, 0.95);
            border-color: rgba(239, 68, 68, 0.40);
        }
        @media (max-width: 640px) {
            .mz-admin-section-nav .mz-asn-brand {
                font-size: 10px;
                padding: 5px 10px;
            }
            .mz-admin-section-nav .mz-asn-right { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            .mz-admin-section-nav * { transition: none !important; }
        }
    `;

    function build() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        const path = window.location.pathname;
        const nav = document.createElement('nav');
        nav.className = 'mz-admin-section-nav';
        nav.setAttribute('aria-label', 'Admin section navigation');

        const linksHtml = SECTIONS.map((s) => {
            const active = s.match.test(path);
            return `<a class="mz-asn-link${active ? ' active' : ''}" href="${s.href}">${s.label}</a>`;
        }).join('');

        nav.innerHTML = `
            <div class="mz-asn-inner">
                <a class="mz-asn-brand" href="/admin/" aria-label="Admin home">⌥ Mount Zara · Admin</a>
                ${linksHtml}
                <span class="mz-asn-spacer"></span>
                <span class="mz-asn-right">
                    <a class="mz-asn-portal-link" href="/portal/" target="_blank" rel="noopener">View member portal →</a>
                    <a class="mz-asn-signout" href="/admin/_signout" title="Drop the cached admin credentials. Use when leaving an unattended Mac.">Sign out</a>
                </span>
            </div>
        `;

        // Inject as the first element of <body> so it sits above any
        // page-specific layout.
        document.body.insertBefore(nav, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();

// =====================================================================
// SHARED ADMIN AUTH (2026-06-12) — automatic Basic-auth for /api calls
// =====================================================================
// Root cause of "the admin doesn't work": /admin/* is Basic-auth-gated by
// functions/admin/_middleware.js, but the browser does NOT re-send that
// Authorization header to /api/v1/admin/* or /api/posts (a different URL
// prefix → different protection space, RFC 7617). Only the Content and
// Trend-Briefs SPAs sent an explicit header; the other ~11 admin pages sent
// none, so every API call 401'd and the page looked broken.
//
// This installs ONE fetch interceptor (loaded on every page via _nav.js) that
// attaches `Authorization: Basic <cached>` to same-origin admin API requests
// and reprompts once on 401 — fixing all pages at once, without touching each
// page's own fetch helper. Pages that already set their own Authorization
// header are passed through untouched (we never override a caller's header,
// and never reprompt on their behalf).
(function () {
    if (window.__mzAdminAuthInstalled) return;
    window.__mzAdminAuthInstalled = true;
    var KEY = 'mz_admin_basic';
    var declined = false;          // user cancelled the prompt → stop auto-prompting
    function cached() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
    var EKEY = 'mz_admin_email';
    function lastEmail() { try { return sessionStorage.getItem(EKEY) || 'chris.mabini@gmail.com'; } catch (e) { return 'chris.mabini@gmail.com'; } }
    // On-theme glass credential modal — replaces the native window.prompt the
    // Basic-auth fetch interceptor used to fire. Same mechanism (base64 user:pass
    // cached in sessionStorage); only the UI changed. Returns a Promise<string|null>.
    function credModal(defaultEmail) {
        return new Promise(function (resolve) {
            if (!document.getElementById('mz-admin-cred-style')) {
                var st = document.createElement('style');
                st.id = 'mz-admin-cred-style';
                st.textContent =
                  '.mz-cred-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(8,8,10,.55);backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);}' +
                  '.mz-cred-card{width:min(92%,400px);background:linear-gradient(155deg,rgba(48,48,58,.62),rgba(16,16,22,.66));backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%);border:1px solid rgba(255,255,255,.14);border-radius:22px;box-shadow:0 40px 120px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.22);padding:30px 28px 26px;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Avenir Next",sans-serif;}' +
                  '.mz-cred-card h2{margin:0 0 4px;font-size:18px;font-weight:600;}' +
                  '.mz-cred-card p{margin:0 0 6px;font-size:13px;color:rgba(255,255,255,.55);}' +
                  '.mz-cred-card label{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);margin:16px 0 6px;}' +
                  '.mz-cred-card input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;color:#fff;font-size:15px;outline:none;}' +
                  '.mz-cred-card input:focus{border-color:rgba(167,139,250,.7);background:rgba(255,255,255,.09);}' +
                  '.mz-cred-row{display:flex;gap:10px;margin-top:22px;}' +
                  '.mz-cred-row button{flex:1;border:none;border-radius:12px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;}' +
                  '.mz-cred-cancel{background:rgba(255,255,255,.08);color:#fff;}' +
                  '.mz-cred-go{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;}';
                document.head.appendChild(st);
            }
            var ov = document.createElement('div'); ov.className = 'mz-cred-ov';
            var card = document.createElement('form'); card.className = 'mz-cred-card';
            card.innerHTML = '<h2>Mount&nbsp;Zara — Admin</h2><p>Sign in to continue.</p>' +
                '<label>Email</label><input type="email" autocomplete="username">' +
                '<label>Password</label><input type="password" autocomplete="current-password">' +
                '<div class="mz-cred-row"><button type="button" class="mz-cred-cancel">Cancel</button><button type="submit" class="mz-cred-go">Sign in</button></div>';
            ov.appendChild(card); document.body.appendChild(ov);
            var email = card.querySelector('input[type=email]');
            var pass = card.querySelector('input[type=password]');
            email.value = defaultEmail || '';
            (email.value ? pass : email).focus();
            function done(val) { try { ov.remove(); } catch (e) {} resolve(val); }
            card.querySelector('.mz-cred-cancel').addEventListener('click', function () { done(null); });
            ov.addEventListener('click', function (e) { if (e.target === ov) done(null); });
            document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(null); } });
            card.addEventListener('submit', function (e) {
                e.preventDefault();
                var u = email.value.trim(), p = pass.value;
                if (!u || !p) { done(null); return; }
                try { sessionStorage.setItem(EKEY, u); } catch (x) {}
                done(btoa(u + ':' + p));
            });
        });
    }
    async function ensure(force) {
        if (!force) { var c = cached(); if (c) return c; }
        if (declined && !force) return null;
        var b = await credModal(lastEmail());
        if (!b) { declined = true; return null; }
        try { sessionStorage.setItem(KEY, b); } catch (e) {}
        declined = false;
        return b;
    }
    function isAdminAPI(url) {
        try {
            var u = new URL(url, location.origin);
            return u.origin === location.origin && /^\/api\/(v1\/admin|posts)\b/.test(u.pathname);
        } catch (e) { return false; }
    }
    var orig = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (!isAdminAPI(url)) return orig(input, init);
        init = init || {};
        var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || undefined);
        var hadAuth = headers.has('Authorization');   // caller manages its own auth
        if (!hadAuth) {
            var c = cached(); if (!c) c = await ensure(false);
            if (c) headers.set('Authorization', 'Basic ' + c);
        }
        var res = await orig(input, Object.assign({}, init, { headers: headers }));
        if (res.status === 401 && !hadAuth && !declined) {
            try { sessionStorage.removeItem(KEY); } catch (e) {}
            var c2 = await ensure(true);
            if (c2) { headers.set('Authorization', 'Basic ' + c2); res = await orig(input, Object.assign({}, init, { headers: headers })); }
        }
        return res;
    };
    // Shared sign-out other pages can call.
    window.mzAdminSignOut = function () { try { sessionStorage.removeItem(KEY); } catch (e) {} declined = false; };
    // Read-only peek at cached creds for passive features (the freshness
    // banner below) that must NEVER trigger the credential modal on load.
    window.mzAdminCachedCreds = cached;
})();

// ---------------------------------------------------------------------
// Content-pipeline freshness banner (2026-07-02). The weekly autogen died
// silently after W24 and nothing surfaced it — this makes staleness and
// pending-approval pile-ups impossible to miss on ANY admin page. Passive:
// runs only when admin creds are already cached this session (never
// prompts), fails silent, dismissible per session.
// ---------------------------------------------------------------------
(function () {
    var DISMISS_KEY = 'mz_freshness_dismissed';
    function show(data) {
        if (!data || !data.problems || !data.problems.length) return;
        var bar = document.createElement('div');
        bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:sticky;top:0;z-index:400;background:rgba(120,53,15,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(251,146,60,0.5);color:#fdba74;font:600 12.5px/1.45 "Avenir Next","Avenir",system-ui,sans-serif;padding:9px 16px;display:flex;gap:12px;align-items:flex-start;';
        var n = data.problems.length;
        var newest = data.kinds && data.kinds.evidence && data.kinds.evidence.newest_published;
        var head = document.createElement('div');
        head.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
        head.innerHTML = '&#9888;&#65039; Content pipeline: ' + n + ' issue' + (n === 1 ? '' : 's') +
            (newest ? ' &mdash; newest weekly post is ' + newest.age_days + ' days old' : '') +
            '. <u>Details</u>';
        var list = document.createElement('div');
        list.style.cssText = 'display:none;margin-top:7px;font-weight:400;color:rgba(253,230,200,0.92);white-space:pre-line;';
        list.textContent = data.problems.map(function (p) { return '• ' + p; }).join('\n');
        head.appendChild(list);
        head.addEventListener('click', function () { list.style.display = list.style.display === 'none' ? 'block' : 'none'; });
        var x = document.createElement('button');
        x.textContent = '×';
        x.setAttribute('aria-label', 'Dismiss for this session');
        x.style.cssText = 'background:none;border:none;color:#fdba74;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;';
        x.addEventListener('click', function () {
            try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
            bar.remove();
        });
        bar.appendChild(head); bar.appendChild(x);
        document.body.insertBefore(bar, document.body.firstChild);
    }
    function check() {
        try { if (sessionStorage.getItem(DISMISS_KEY)) return; } catch (e) {}
        var creds = (typeof window.mzAdminCachedCreds === 'function') ? window.mzAdminCachedCreds() : null;
        if (!creds) return;   // not signed in this session — stay silent, never prompt
        fetch('/api/posts/_admin/freshness', { headers: { Authorization: 'Basic ' + creds } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(show)
            .catch(function () { /* banner is best-effort */ });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
    else check();
})();
