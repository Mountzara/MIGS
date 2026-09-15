/* =====================================================================
   assets/js/post-light.js — ink on paper for injected post bodies
   =====================================================================
   WHY (2026-09-15). Every stored brief (D1 posts.body_html) carries its
   own ~25 KB <style>, written for the old dark site:

       :root { --bg-base:#07070a; --fg-strong:#ffffff; --fg-mid:rgba(245,245,247,.86) … }
       html, body { background: …, var(--bg-base); color: var(--fg-mid); }

   A reader shell injects that HTML with innerHTML, which puts the
   stylesheet in the HOST document. Two things then happen: <body> is
   repainted near-black, and the post's :root redefines the host's own
   tokens (--fg-strong, --accent-soft, --bg-card …), so even the shell's
   title above the post goes dark-on-dark. No document-level fix — meta
   color-scheme, body color, a canvas guard on <html> — can reach this,
   because the dark rules arrive AFTER load, from the data.

   The gate that "passed" audited /evidence/ — the listing — and never
   opened a brief. The deploy gates now open every published brief; the
   repository's system map records the incident and the must-touch list.

   WHAT. For every <style> inside a [data-mz-post-scope] container, at
   load and whenever one lands (MutationObserver, which runs before paint
   — no dark flash):
     1. bare `html` / `body` / `html, body` rules are removed — a post has
        no business painting the document;
     2. `:root` is rescoped to the container, so the post keeps every
        variable it defines and the host keeps its own;
     3. a paper palette is set INLINE on the container for the variables
        the dark theme relies on. Inline custom properties beat the
        rescoped rule for everything inside; a definition the post sets on
        one of its own elements still wins for that subtree, which is
        correct — that is the post's local semantics, not its ground.
   Styles marked data-mz-keep are the shell's own and are never touched.
   A body/html colour guard with !important is added once, as a belt for
   any future post that marks its body rule !important.
   ===================================================================== */
(function () {
    'use strict';
    if (window.__mzPostLight) return;
    window.__mzPostLight = true;

    var PAPER = '#FBFAF8', INK = '#1A1726', SCOPE = '[data-mz-post-scope]';
    var LIGHT = {
        '--bg-base': 'transparent', '--bg': 'transparent', '--bg-soft': '#F4F0FB',
        '--bg-card': '#FFFFFF', '--bg-card-hover': '#F7F4FC',
        '--border-soft': 'rgba(26,23,38,0.12)', '--border-medium': 'rgba(26,23,38,0.20)',
        '--fg-strong': INK, '--fg-mid': 'rgba(26,23,38,0.88)',
        '--fg-soft': 'rgba(26,23,38,0.72)', '--fg-dim': 'rgba(26,23,38,0.62)',
        '--accent': '#6d28d9', '--accent-soft': '#5b21b6', '--accent-strong': '#4c1d95',
        '--glow-purple': '109, 40, 217',
        '--text-on-dark': INK, '--text-secondary-dark': 'rgba(26,23,38,0.72)',
        '--white': INK,
        '--gray-1': 'rgba(26,23,38,0.74)', '--gray-2': 'rgba(26,23,38,0.60)',
        '--gray-3': 'rgba(26,23,38,0.46)', '--gray-4': 'rgba(26,23,38,0.36)',
        '--gray-5': 'rgba(26,23,38,0.26)', '--gray-6': 'rgba(26,23,38,0.14)'
    };
    var uid = 0;

    function lighten(css, hostId) {
        return css
            // 1. drop document-level rules. Predecessor may be start, `}` or
            //    `{` (a rule nested in @media). `body.x {` and `html[…] {`
            //    do not match — the selector must end right before `{`.
            .replace(/(^|[{}])\s*(?:html|body)(?:\s*,\s*(?:html|body))?\s*\{[^{}]*\}/g, '$1')
            // 2. rescope :root to the container.
            .replace(/(^|[^\w-])(:root)(?![\w-])/g, '$1#' + hostId);
    }

    function paint(host) {
        if (!host || host.__mzLit) return;
        host.__mzLit = true;
        for (var k in LIGHT) if (Object.prototype.hasOwnProperty.call(LIGHT, k)) host.style.setProperty(k, LIGHT[k]);
        host.style.setProperty('color', INK);
        host.style.setProperty('background', 'transparent');
    }

    function process(styleEl) {
        if (!styleEl || styleEl.tagName !== 'STYLE' || styleEl.__mzLit) return;
        if (styleEl.hasAttribute('data-mz-keep')) return;
        var host = styleEl.closest ? styleEl.closest(SCOPE) : null;
        if (!host) return;                       // the shell's own styles are never touched
        styleEl.__mzLit = true;
        if (!host.id) host.id = 'mz-post-scope-' + (++uid);
        var css = styleEl.textContent || '';
        var lit = lighten(css, host.id);
        if (lit !== css) styleEl.textContent = lit;
        paint(host);
    }

    function scan(node) {
        if (!node || node.nodeType !== 1) return;
        var host = node.closest ? node.closest(SCOPE) : null;
        if (host) paint(host);                   // even a post with no <style> reads host tokens
        if (node.tagName === 'STYLE') { process(node); return; }
        var styles = node.querySelectorAll ? node.querySelectorAll('style') : [];
        for (var i = 0; i < styles.length; i++) process(styles[i]);
        var scopes = node.querySelectorAll ? node.querySelectorAll(SCOPE) : [];
        for (var j = 0; j < scopes.length; j++) paint(scopes[j]);
    }

    function guard() {
        if (document.getElementById('mz-post-light-guard')) return;
        var s = document.createElement('style');
        s.id = 'mz-post-light-guard';
        s.setAttribute('data-mz-keep', '');
        s.textContent = 'html,body{background-color:' + PAPER + '!important}body{color:' + INK + '!important}';
        (document.head || document.documentElement).appendChild(s);
    }

    // ORDER MATTERS, and it was the bug in the first draft (2026-09-15):
    // the observer was attached inside a DOMContentLoaded handler, and a
    // shell whose fetch resolves before that event had already injected
    // the post. The initial scan then found a <style> with no scope yet,
    // skipped it, and no mutation ever followed — one scan, forever dark,
    // on roughly half of page loads. So: observe FIRST, from the moment
    // this script runs; scan what already exists; and watch the scope
    // attribute itself, so a container stamped later is still caught.
    var observer = null;
    function onRecords(records) {
        for (var r = 0; r < records.length; r++) {
            var rec = records[r];
            if (rec.type === 'attributes') { scan(rec.target); continue; }
            if (rec.target && rec.target.nodeType === 1) {
                var host = rec.target.closest ? rec.target.closest(SCOPE) : null;
                if (host) paint(host);
            }
            for (var i = 0; i < rec.addedNodes.length; i++) scan(rec.addedNodes[i]);
        }
    }
    function start() {
        if (observer || !document.documentElement) return;
        observer = new MutationObserver(onRecords);
        observer.observe(document.documentElement, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['data-mz-post-scope']
        });
        guard();
        scan(document.documentElement);
    }
    start();                                                       // now — a head script sees <html>
    document.addEventListener('DOMContentLoaded', function () {   // belt: rescan once parsing is done
        start();
        scan(document.documentElement);
    });
})();
