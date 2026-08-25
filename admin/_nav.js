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

    // -----------------------------------------------------------------
    // GROUPED NAVIGATION (2026-08-19)
    // -----------------------------------------------------------------
    // Twenty equal-weight tabs in one row is not navigation, it is a
    // wall — the operator has to read all twenty to find one, and a
    // half-empty install then reads as "nothing works" because nothing
    // says what any tab is FOR. Seven groups, each opening to its pages
    // with a one-line description. Nothing was removed or renamed; the
    // hierarchy that always existed is now visible.
    //
    // Adding a page: put it in the group it belongs to. If it fits none
    // of them, that is a signal about the page, not about this list.
    const GROUPS = [
        { key: 'home', label: 'Dashboard', href: '/admin/', match: /^\/admin\/?$/, items: [] },
        { key: 'patients', label: 'Patients', match: /^\/admin\/(patients|cases|briefings)\b/, items: [
            { label: 'Patient roster',  href: '/admin/patients/',  desc: 'Everyone in the practice' },
            { label: 'Pre-visit briefings', href: '/admin/briefings/', desc: 'What to know before you walk in' },
        ]},
        { key: 'clinical', label: 'Clinical', match: /^\/admin\/(triage|orders|referrals|visits)\b/, items: [
            { label: 'Triage review',   href: '/admin/triage/',    desc: 'New intakes waiting on you' },
            { label: 'Orders & results',href: '/admin/orders/',    desc: 'Labs, imaging, and what came back' },
            { label: 'Referrals',       href: '/admin/referrals/', desc: 'Who you refer to, and who covers them' },
            { label: 'Visit summaries', href: '/admin/visits/',    desc: 'After-visit notes to approve' },
        ]},
        { key: 'schedule', label: 'Schedule', match: /^\/admin\/scheduling\b/, items: [
            { label: 'Scheduling',      href: '/admin/scheduling/', desc: 'Availability and booked visits' },
        ]},
        { key: 'messages', label: 'Messages', match: /^\/admin\/messages\b/, items: [
            { label: 'Patient messages', href: '/admin/messages/', desc: 'Secure inbox' },
        ]},
        { key: 'money', label: 'Money', match: /^\/admin\/(billing|gfe|membership)\b/, items: [
            { label: 'Insurance billing', href: '/admin/billing/', desc: 'Claims, coding, ERAs' },
            { label: 'Good faith estimates', href: '/admin/gfe/',  desc: 'Required for self-pay patients' },
            { label: 'Membership',        href: '/admin/membership/', desc: 'Interest and tiers' },
        ]},
        { key: 'content', label: 'Content', match: /^\/admin\/(content|education|carousels|trend-briefs)\b/, items: [
            { label: 'Posts & pages',   href: '/admin/content/',    desc: 'Site writing' },
            { label: 'Patient education', href: '/admin/education/', desc: 'Condition libraries' },
            { label: 'Carousels',       href: '/admin/carousels/',  desc: 'Homepage imagery' },
            { label: 'Trend briefs',    href: '/admin/trend-briefs/', desc: 'Evidence review queue' },
        ]},
        { key: 'system', label: 'System', match: /^\/admin\/(analytics|compliance|feedback|debug)\b/, items: [
            { label: 'Analytics',       href: '/admin/analytics/',  desc: 'Volume, NPS, outcomes' },
            { label: 'Compliance',      href: '/admin/compliance/', desc: 'Signatures and attestations' },
            { label: 'Feedback',        href: '/admin/feedback/',   desc: 'What patients said' },
            { label: 'Sessions & debug',href: '/admin/debug/sessions/', desc: 'Technical traces' },
        ]},
    ];

    const STYLE = `
        .mz-admin-section-nav {
            position: sticky; top: 0; z-index: 999;
            background: rgba(251, 250, 248, 0.92);
            backdrop-filter: blur(22px) saturate(165%);
            -webkit-backdrop-filter: blur(22px) saturate(165%);
            border-bottom: 1px solid #E9E5EE;
            padding: 10px clamp(16px, 4vw, 32px);
        }
        .mz-admin-section-nav .mz-asn-inner {
            display: flex; align-items: center; gap: 8px;
            max-width: 1280px; margin: 0 auto;
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: #6d28d9 transparent;
        }
        .mz-admin-section-nav .mz-asn-inner::-webkit-scrollbar { height: 4px; }
        .mz-admin-section-nav .mz-asn-inner::-webkit-scrollbar-thumb { background: rgba(167, 139, 250, 0.4); border-radius: 2px; }
        .mz-admin-section-nav .mz-asn-brand {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 11px; font-weight: 700;
            letter-spacing: 0.20em; text-transform: uppercase;
            color: #6d28d9;
            padding: 6px 12px;
            border-right: 1px solid #E9E5EE;
            margin-right: 6px;
            white-space: nowrap;
            text-decoration: none;
            transition: color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-brand:hover { color: #1A1726; }
        .mz-admin-section-nav .mz-asn-link {
            font: inherit;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid #E9E5EE;
            border-radius: 999px;
            padding: 6px 14px;
            color: #4A4658;
            font-size: 12.5px;
            font-weight: 500;
            letter-spacing: 0.02em;
            text-decoration: none;
            white-space: nowrap;
            transition: transform 0.18s, background 0.18s, border-color 0.18s, color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-link:hover {
            transform: translateY(-1px);
            color: #1A1726;
            border-color: #6d28d9;
            background: rgba(167, 139, 250, 0.06);
        }
        .mz-admin-section-nav .mz-asn-link.active {
            background: rgba(167, 139, 250, 0.16);
            border-color: #6d28d9;
            color: #6d28d9;
        }
        .mz-admin-section-nav .mz-asn-spacer { flex: 1; }
        .mz-admin-section-nav .mz-asn-right {
            display: inline-flex; align-items: center; gap: 10px;
            font-size: 11px; color: #6E6A7C;
            white-space: nowrap;
        }
        .mz-admin-section-nav .mz-asn-portal-link {
            font-size: 11.5px;
            color: #6d28d9;
            text-decoration: none;
            padding: 4px 10px;
            border-radius: 6px;
            transition: background 0.18s, color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-portal-link:hover {
            background: rgba(167, 139, 250, 0.10);
            color: #1A1726;
        }
        .mz-admin-section-nav .mz-asn-signout {
            font-size: 11.5px;
            color: #6E6A7C;
            text-decoration: none;
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid #E9E5EE;
            background: rgba(255, 255, 255, 0.72);
            transition: background 0.18s, color 0.18s, border-color 0.18s;
        }
        .mz-admin-section-nav .mz-asn-signout:hover {
            background: rgba(239, 68, 68, 0.10);
            color: rgba(252, 165, 165, 0.95);
            border-color: rgba(239, 68, 68, 0.40);
        }
        .mz-admin-section-nav .mz-asn-group { position: relative; display: inline-flex; }
        .mz-admin-section-nav .mz-asn-trigger {
            font: inherit; cursor: pointer; background: none; border: none;
            display: inline-flex; align-items: center; gap: 5px;
        }
        .mz-admin-section-nav .mz-asn-caret { font-size: 9px; opacity: .6; }
        .mz-admin-section-nav .mz-asn-menu {
            display: none; position: absolute; top: calc(100% + 8px); left: 0;
            min-width: 268px; z-index: 1000; padding: 7px;
            background: rgba(255, 255, 255, 0.97);
            backdrop-filter: blur(26px) saturate(170%);
            -webkit-backdrop-filter: blur(26px) saturate(170%);
            border: 1px solid #E9E5EE; border-radius: 14px;
            box-shadow: 0 26px 70px rgba(0,0,0,0.6);
        }
        .mz-admin-section-nav .mz-asn-group.open .mz-asn-menu { display: block; }
        .mz-admin-section-nav .mz-asn-item {
            display: block; padding: 9px 12px; border-radius: 9px;
            text-decoration: none; color: #1A1726;
        }
        .mz-admin-section-nav .mz-asn-item:hover { background: rgba(167,139,250,0.16); }
        .mz-admin-section-nav .mz-asn-item.current { background: rgba(167,139,250,0.22); }
        .mz-admin-section-nav .mz-asn-item-label { display: block; font-size: 13px; }
        .mz-admin-section-nav .mz-asn-item-desc {
            display: block; font-size: 11px; margin-top: 2px; color: #6E6A7C;
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

        const linksHtml = GROUPS.map((g) => {
            const active = g.match.test(path);
            if (!g.items.length) {
                return `<a class="mz-asn-link${active ? ' active' : ''}" href="${g.href}">${g.label}</a>`;
            }
            const menu = g.items.map((it) => {
                const cur = path.indexOf(it.href) === 0;
                return `<a class="mz-asn-item${cur ? ' current' : ''}" href="${it.href}">
                    <span class="mz-asn-item-label">${it.label}</span>
                    <span class="mz-asn-item-desc">${it.desc}</span></a>`;
            }).join('');
            return `<span class="mz-asn-group${active ? ' active' : ''}">
                <button type="button" class="mz-asn-link mz-asn-trigger${active ? ' active' : ''}"
                        aria-expanded="false">${g.label}<span class="mz-asn-caret">▾</span></button>
                <span class="mz-asn-menu">${menu}</span></span>`;
        }).join('');

        nav.innerHTML = `
            <div class="mz-asn-inner">
                <a class="mz-asn-brand" href="/admin/" aria-label="Admin home">⌥ Mount Zara · Admin</a>
                ${linksHtml}
                <span class="mz-asn-spacer"></span>
                <span class="mz-asn-right">
                    <a class="mz-asn-portal-link" href="/portal/" target="_blank" rel="noopener" title="Opens the patient-facing portal. While the public launch flag is off, your admin session is what lets you through the pre-launch gate.">Preview patient portal →</a>
                    <a class="mz-asn-signout" href="/admin/_signout" title="Drop the cached admin credentials. Use when leaving an unattended Mac.">Sign out</a>
                </span>
            </div>
        `;

        // Inject as the first element of <body> so it sits above any
        // page-specific layout.
        document.body.insertBefore(nav, document.body.firstChild);

        // Click to open, click anywhere to close, Escape to dismiss. Hover
        // menus are a trap on a trackpad and unusable on an iPad, and this
        // console gets used on both.
        nav.addEventListener('click', (e) => {
            const trigger = e.target.closest('.mz-asn-trigger');
            const group = trigger && trigger.closest('.mz-asn-group');
            const wasOpen = group && group.classList.contains('open');
            nav.querySelectorAll('.mz-asn-group.open').forEach((g) => {
                g.classList.remove('open');
                const t = g.querySelector('.mz-asn-trigger');
                if (t) t.setAttribute('aria-expanded', 'false');
            });
            if (group && !wasOpen) {
                group.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                e.stopPropagation();
            }
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.mz-asn-group')) {
                nav.querySelectorAll('.mz-asn-group.open').forEach((g) => g.classList.remove('open'));
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') nav.querySelectorAll('.mz-asn-group.open').forEach((g) => g.classList.remove('open'));
        });
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
        bar.style.cssText = 'position:sticky;top:0;z-index:400;background:rgba(120,53,15,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(251,146,60,0.5);color: #92400E;font:600 12.5px/1.45 "Avenir Next","Avenir",system-ui,sans-serif;padding:9px 16px;display:flex;gap:12px;align-items:flex-start;';
        var n = data.problems.length;
        var newest = data.kinds && data.kinds.evidence && data.kinds.evidence.newest_published;
        var head = document.createElement('div');
        head.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
        head.innerHTML = '&#9888;&#65039; Content pipeline: ' + n + ' issue' + (n === 1 ? '' : 's') +
            (newest ? ' &mdash; newest weekly post is ' + newest.age_days + ' days old' : '') +
            '. <u>Details</u>';
        var list = document.createElement('div');
        list.style.cssText = 'display:none;margin-top:7px;font-weight:400;color: #92400E;white-space:pre-line;';
        list.textContent = data.problems.map(function (p) { return '• ' + p; }).join('\n');
        head.appendChild(list);
        head.addEventListener('click', function () { list.style.display = list.style.display === 'none' ? 'block' : 'none'; });
        var x = document.createElement('button');
        x.textContent = '×';
        x.setAttribute('aria-label', 'Dismiss for this session');
        x.style.cssText = 'background:none;border:none;color: #92400E;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;';
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
