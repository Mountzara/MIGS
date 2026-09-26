/* =====================================================================
   mz-education.js — the shared runtime for /education/ (2026-09-26)
   =====================================================================
   Loaded with `defer` by every patient guide and the guide index. No
   dependencies, no network, nothing from a third party (the education
   CSP allows only same-origin scripts). Every query is null-guarded so
   the same file runs on a page that has none of a given component.

   What it does:
     1. nav — hamburger toggle + dismiss, the "More" group's aria state,
        and a runtime crumb for the /portal/ mirror (the HTML of the two
        mirrors is byte-identical; the only per-surface difference is
        decided here from location.pathname);
     2. reading-progress bar;
     3. reveal-on-scroll for [data-reveal] (IntersectionObserver plus a
        fling-proof sweep so nothing can stay hidden; everything is
        revealed at once under prefers-reduced-motion);
     4. citation popovers — tap toggles, outside-tap clears, and the
        geometry pass that flips a popover below its marker when there
        is no room above (also inside an open modal);
     5. Q&A accordion — one open at a time;
     6. the modal kit — every [data-modal="KEY"] opener clones
        <template id="modal-KEY"> into #mz-modal-host; opens on click,
        Enter and Space; closes on Escape, the scrim and the close
        button; traps focus; restores focus and body scroll on close.
   ===================================================================== */
(function () {
    'use strict';

    var doc = document;
    var root = doc.documentElement;
    if (!root.classList.contains('mz-js')) root.classList.add('mz-js');

    var reducedMotion = false;
    try { reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    // ------------------------------------------------------------------
    // 1. Navigation
    // ------------------------------------------------------------------
    function toggleMenu(force) {
        var panel = doc.getElementById('navLinks');
        if (!panel) return false;
        var open = typeof force === 'boolean'
            ? panel.classList.toggle('open', force)
            : panel.classList.toggle('open');
        var btn = doc.querySelector('.mobile-toggle');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return open;
    }
    window.toggleMenu = toggleMenu;

    function initNav() {
        var btn = doc.querySelector('.mobile-toggle');
        if (btn && !btn.hasAttribute('onclick')) {
            btn.addEventListener('click', function () { toggleMenu(); });
        }
        var panel = doc.getElementById('navLinks');
        if (panel) {
            panel.addEventListener('click', function (e) {
                if (!panel.classList.contains('open')) return;
                if (e.target.closest('a, .nav-cta')) toggleMenu(false);
            });
            doc.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && panel.classList.contains('open')) toggleMenu(false);
            });
        }
        // "More" group — opens in CSS on hover/focus-within; keep aria truthful.
        var group = doc.querySelector('.nav-more');
        var more = group ? group.querySelector('.nav-more-btn') : null;
        if (group && more) {
            var sync = function (state) { more.setAttribute('aria-expanded', state ? 'true' : 'false'); };
            group.addEventListener('mouseenter', function () { sync(true); });
            group.addEventListener('mouseleave', function () { if (!group.contains(doc.activeElement)) sync(false); });
            group.addEventListener('focusin', function () { sync(true); });
            group.addEventListener('focusout', function () {
                setTimeout(function () { if (!group.contains(doc.activeElement)) sync(false); }, 0);
            });
            more.addEventListener('click', function (e) {
                e.preventDefault();
                sync(group.classList.toggle('open'));
            });
            doc.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                group.classList.remove('open'); sync(false);
            });
            doc.addEventListener('click', function (e) {
                if (group.contains(e.target)) return;
                group.classList.remove('open'); sync(false);
            });
        }
        // Mark the current section of the site in the bar.
        var path = location.pathname || '/';
        doc.querySelectorAll('.nav-links a[href]').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (href === '/education/' && path.indexOf('/education/') === 0) a.setAttribute('aria-current', 'page');
        });
        // Portal mirror: same bytes, different door. The member copy is
        // reached from the portal, so the bar's action sends them back.
        if (path.indexOf('/portal/') === 0) {
            var cta = doc.querySelector('.nav-cta');
            if (cta) { cta.textContent = '← Back to the portal'; cta.setAttribute('href', '/portal/'); }
            var brandLink = doc.querySelector('.nav-brand');
            if (brandLink) brandLink.setAttribute('href', '/portal/');
        }
    }

    // ------------------------------------------------------------------
    // 2. Reading progress
    // ------------------------------------------------------------------
    function initProgress() {
        var bar = doc.getElementById('scrollProgressBar');
        if (!bar) return;
        var ticking = false;
        var paint = function () {
            ticking = false;
            var max = root.scrollHeight - window.innerHeight;
            var pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
            bar.style.width = pct.toFixed(2) + '%';
        };
        var queue = function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };
        window.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('resize', queue, { passive: true });
        paint();
    }

    // ------------------------------------------------------------------
    // 3. Reveal on scroll
    // ------------------------------------------------------------------
    function initReveal() {
        var all = doc.querySelectorAll('[data-reveal]');
        if (!all.length) return;
        var revealAll = function () { doc.querySelectorAll('[data-reveal]:not(.in)').forEach(function (el) { el.classList.add('in'); }); };
        if (reducedMotion || !('IntersectionObserver' in window)) { revealAll(); return; }

        var obs = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
            });
        }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
        all.forEach(function (el) { obs.observe(el); });

        // Fling-proof net: anything that has entered (or been scrolled past)
        // is revealed, and everything is revealed at the page bottom.
        var tick = false;
        var sweep = function () {
            tick = false;
            var vh = window.innerHeight;
            var atBottom = window.scrollY + vh >= root.scrollHeight - 4;
            doc.querySelectorAll('[data-reveal]:not(.in)').forEach(function (el) {
                if (atBottom || el.getBoundingClientRect().top < vh * 0.95) { el.classList.add('in'); obs.unobserve(el); }
            });
        };
        var queue = function () { if (!tick) { tick = true; requestAnimationFrame(sweep); } };
        window.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('wheel', queue, { passive: true });
        window.addEventListener('touchmove', queue, { passive: true });
        window.addEventListener('scrollend', sweep, { passive: true });
        window.addEventListener('resize', queue, { passive: true });
        window.addEventListener('orientationchange', function () { setTimeout(sweep, 80); });
        window.addEventListener('load', function () { sweep(); setTimeout(sweep, 1500); });
        requestAnimationFrame(sweep);
        [400, 1200, 2500].forEach(function (ms) { setTimeout(sweep, ms); });
        var polls = 0;
        var poll = setInterval(function () {
            sweep();
            if (!doc.querySelector('[data-reveal]:not(.in)') || ++polls > 120) clearInterval(poll);
        }, 250);
        // A hash landing (#ref-N) must never arrive on an invisible target.
        window.addEventListener('hashchange', function () { setTimeout(sweep, 50); });
        // Printing shows everything.
        window.addEventListener('beforeprint', revealAll);
    }

    // ------------------------------------------------------------------
    // 4. Citation popovers
    // ------------------------------------------------------------------
    function placePopover(sup) {
        var pop = sup.querySelector('.mz-ref-pop');
        if (!pop) return;
        pop.classList.remove('mz-flip', 'mz-edge-left', 'mz-edge-right');
        var r = sup.getBoundingClientRect();
        var h = pop.offsetHeight || 220;
        var w = pop.offsetWidth || Math.min(380, window.innerWidth * 0.92);
        // Below the marker when there is no room above (including the
        // fixed nav), and above only when that fits.
        var topLimit = 76;
        if (r.top - h < topLimit && (window.innerHeight - r.bottom) > (r.top - topLimit)) pop.classList.add('mz-flip');
        var centre = r.left + r.width / 2;
        if (centre - w / 2 < 8) pop.classList.add('mz-edge-left');
        else if (centre + w / 2 > window.innerWidth - 8) pop.classList.add('mz-edge-right');
    }
    function clearOpenPopovers(except) {
        doc.querySelectorAll('sup.mz-ref.mz-open').forEach(function (s) { if (s !== except) s.classList.remove('mz-open'); });
    }
    function initPopovers() {
        if (window.__mzPopFlip) return;
        window.__mzPopFlip = true;
        var supOf = function (t) { return t && t.closest ? t.closest('sup.mz-ref') : null; };
        // Tap on the marker area (not on the [N] link itself) toggles it open;
        // delegated, so markers cloned into a modal work without re-wiring.
        doc.addEventListener('click', function (ev) {
            var sup = supOf(ev.target);
            if (!sup) { clearOpenPopovers(null); return; }
            var a = ev.target.closest('a');
            if (a && sup.contains(a)) { setTimeout(function () { placePopover(sup); }, 0); return; }
            ev.preventDefault();
            ev.stopPropagation();
            clearOpenPopovers(sup);
            sup.classList.toggle('mz-open');
            placePopover(sup);
        }, true);
        doc.addEventListener('pointerover', function (ev) { var s = supOf(ev.target); if (s) placePopover(s); }, true);
        doc.addEventListener('focusin', function (ev) { var s = supOf(ev.target); if (s) placePopover(s); }, true);
        doc.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') clearOpenPopovers(null);
        });
    }

    // ------------------------------------------------------------------
    // 5. Q&A accordion
    // ------------------------------------------------------------------
    function initQA() {
        var qas = doc.querySelectorAll('details.qa');
        if (!qas.length) return;
        qas.forEach(function (d) {
            d.addEventListener('toggle', function () {
                if (!d.open) return;
                qas.forEach(function (o) { if (o !== d) o.open = false; });
            });
            var s = d.querySelector('summary');
            if (s) s.addEventListener('click', function () {
                setTimeout(function () {
                    if (d.open && !reducedMotion) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 80);
            });
        });
    }

    // ------------------------------------------------------------------
    // 6. Modal kit
    // ------------------------------------------------------------------
    function initModals() {
        var bg = doc.getElementById('mz-modal-bg');
        var host = doc.getElementById('mz-modal-host');
        var closeBtn = doc.getElementById('mz-modal-close');
        var openers = doc.querySelectorAll('[data-modal]');
        if (!bg || !host || !closeBtn) return;
        var frame = bg.querySelector('.mz-modal') || bg;
        var lastFocus = null;
        var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

        function isOpen() { return bg.classList.contains('open'); }

        function openModal(key, opener) {
            var tpl = doc.getElementById('modal-' + key);
            if (!tpl || !('content' in tpl)) return false;
            host.innerHTML = '';
            host.appendChild(tpl.content.cloneNode(true));
            var title = host.querySelector('h1, h2, h3');
            if (title) {
                if (!title.id) title.id = 'mz-modal-title';
                bg.setAttribute('aria-labelledby', title.id);
            } else {
                bg.removeAttribute('aria-labelledby');
            }
            lastFocus = opener || doc.activeElement;
            bg.classList.add('open');
            bg.setAttribute('aria-hidden', 'false');
            doc.body.classList.add('mz-modal-open');
            bg.scrollTop = 0;
            closeBtn.focus();
            return true;
        }
        function closeModal() {
            if (!isOpen()) return;
            clearOpenPopovers(null);
            bg.classList.remove('open');
            bg.setAttribute('aria-hidden', 'true');
            doc.body.classList.remove('mz-modal-open');
            host.innerHTML = '';
            if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (e) {} }
            lastFocus = null;
        }
        window.mzOpenModal = openModal;
        window.mzCloseModal = closeModal;

        openers.forEach(function (card) {
            if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
            if (!card.hasAttribute('role')) card.setAttribute('role', 'button');
            card.addEventListener('click', function (ev) {
                // A citation marker or a real link inside the card keeps its own job.
                if (ev.target.closest('sup.mz-ref') || ev.target.closest('a[href]')) return;
                openModal(card.getAttribute('data-modal'), card);
            });
            card.addEventListener('keydown', function (ev) {
                if (ev.target !== card) return;
                if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                    ev.preventDefault();
                    openModal(card.getAttribute('data-modal'), card);
                }
            });
        });
        closeBtn.addEventListener('click', closeModal);
        bg.addEventListener('click', function (ev) { if (ev.target === bg) closeModal(); });
        // A [N] marker inside the modal jumps to the reference list, so the modal steps aside.
        host.addEventListener('click', function (ev) {
            var a = ev.target.closest('a[href^="#ref-"]');
            if (a) setTimeout(closeModal, 0);
        });
        doc.addEventListener('keydown', function (ev) {
            if (!isOpen()) return;
            if (ev.key === 'Escape') {
                // First Escape closes an open popover inside the modal; the next closes the modal.
                if (host.querySelector('sup.mz-ref.mz-open')) { clearOpenPopovers(null); return; }
                ev.preventDefault();
                closeModal();
                return;
            }
            if (ev.key !== 'Tab') return;
            var items = Array.prototype.filter.call(frame.querySelectorAll(FOCUSABLE), function (el) {
                return el.offsetParent !== null || el === closeBtn;
            });
            if (!items.length) { ev.preventDefault(); closeBtn.focus(); return; }
            var first = items[0], last = items[items.length - 1];
            if (ev.shiftKey && (doc.activeElement === first || !frame.contains(doc.activeElement))) { ev.preventDefault(); last.focus(); }
            else if (!ev.shiftKey && (doc.activeElement === last || !frame.contains(doc.activeElement))) { ev.preventDefault(); first.focus(); }
        });
        // Focus that escapes the frame (e.g. a click on the scrim) is pulled back.
        doc.addEventListener('focusin', function (ev) {
            if (!isOpen()) return;
            if (!frame.contains(ev.target)) closeBtn.focus();
        });
    }

    function boot() {
        initNav();
        initProgress();
        initReveal();
        initPopovers();
        initQA();
        initModals();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
