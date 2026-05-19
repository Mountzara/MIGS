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
        { key: 'scheduling', label: 'Scheduling',   href: '/admin/scheduling/', match: /^\/admin\/scheduling\b/ },
        { key: 'triage',     label: 'Triage',       href: '/admin/triage/',     match: /^\/admin\/triage\b/     },
        { key: 'messages',   label: 'Messages',     href: '/admin/messages/',   match: /^\/admin\/messages\b/   },
        { key: 'billing',    label: 'Billing',      href: '/admin/billing/',    match: /^\/admin\/billing\b/    },
        { key: 'analytics',  label: 'Analytics',    href: '/admin/analytics/',  match: /^\/admin\/analytics\b/  },
        { key: 'education',  label: 'Education',    href: '/admin/education/',  match: /^\/admin\/education\b/  },
        { key: 'content',    label: 'Content',      href: '/admin/content/',    match: /^\/admin\/content\b/    },
        { key: 'carousels',  label: 'Carousels',    href: '/admin/carousels/',  match: /^\/admin\/carousels\b/  },
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
