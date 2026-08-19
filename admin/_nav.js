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
        { key: 'visits',     label: 'Visit Summaries', href: '/admin/visits/',  match: /^\/admin\/visits\b/     },
        { key: 'orders',     label: 'Orders & Results', href: '/admin/orders/', match: /^\/admin\/orders\b/     },
        { key: 'referrals',  label: 'Referrals',    href: '/admin/referrals/', match: /^\/admin\/referrals\b/ },
        { key: 'gfe',        label: 'Estimates',    href: '/admin/gfe/',       match: /^\/admin\/gfe\b/       },
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
// ---------------------------------------------------------------------
// ONE SIGN-IN FOR THE WHOLE BACKEND (2026-08-19)
// ---------------------------------------------------------------------
// This file used to install a fetch interceptor that popped its OWN glass
// credential modal before any /api/v1/admin call, cached base64
// user:pass in sessionStorage, and defaulted the username to an EMAIL
// ADDRESS — which the server never accepts, because it compares against
// ADMIN_USER. So signing in meant two prompts, two different usernames,
// and a second one that could not succeed as offered.
//
// It is gone. Authenticating the page load now mints a signed, HttpOnly
// admin session cookie (functions/_lib/admin_session.js), and the admin
// API accepts it — so same-origin fetches are already authenticated and
// need no header, no modal, and no credentials in sessionStorage.
//
// Do not reintroduce a client-side credential prompt here. If an admin
// fetch returns 401, the session has expired: reload, and the middleware
// challenges once.
(function () {
    if (window.__mzAdminAuthInstalled) return;
    window.__mzAdminAuthInstalled = true;
    // Sign-out is a server action now — it must clear the cookie, which
    // script cannot touch (HttpOnly, by design).
    window.mzAdminSignOut = function () {
        try { sessionStorage.removeItem('mz_admin_basic'); } catch (e) {}
        location.href = '/admin/_signout';
    };
    // Passive features (the freshness banner below) used this to decide
    // whether credentials existed before firing a background fetch. With a
    // cookie session the answer is simply "the page loaded, so yes".
    window.mzAdminCachedCreds = function () { return 'session'; };
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
