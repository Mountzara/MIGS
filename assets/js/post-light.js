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

    // Pale accent TEXT is the second half of the dark-theme problem, and the
    // one the first version missed (2026-09-15, caught by the contrast gate at
    // 1.27:1 on live briefs). The grounds went to paper, but colours written
    // for a dark ground stayed: amber-300 on the mechanism cards' "Read the
    // full abstract" and PMID chips, salmon on the gap-section heading. They
    // are literals, not variables, so the palette above cannot reach them.
    //
    // Hue carries meaning here — amber IS "mechanism, not clinical evidence" —
    // so the fix darkens rather than replaces: keep hue and saturation, force
    // lightness down to a level that reads on paper. Only `color:` is touched;
    // the same amber as a 4%-alpha background or a border is exactly right.
    // Darken any text colour that cannot carry itself on paper.
    //
    // The first version tested LIGHTNESS ("is it pale?") and so let through
    // #2997FF — a saturated mid-blue, luminance 0.31, therefore "not pale" —
    // which renders at 2.68:1 on the cream card ground at 11px. Five live
    // headings on W29 read that way. Lightness was the wrong question:
    // contrast is the question, so this measures it directly against the
    // ground the text will actually sit on, and walks lightness down until
    // the colour clears, preserving hue and saturation so the design's
    // meaning survives (amber = mechanism, blue = a data label).
    var PAPER_RGB = [251, 250, 248], CARD_RGB = [244, 241, 236];   // page ground, card ground
    function _lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function _lum(c) { return 0.2126 * _lin(c[0]) + 0.7152 * _lin(c[1]) + 0.0722 * _lin(c[2]); }
    function _ratio(a, b) { var la = _lum(a), lb = _lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
    function _hsl(r, g, b) {
        var R = r / 255, G = g / 255, B = b / 255;
        var mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, h = 0, l = (mx + mn) / 2;
        if (d) {
            if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0));
            else if (mx === G) h = (B - R) / d + 2;
            else h = (R - G) / d + 4;
            h *= 60;
        }
        var s = d ? d / (1 - Math.abs(2 * l - 1) || 1) : 0;
        return [h, Math.min(1, s), l];
    }
    function _rgb(h, s, l) {
        var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
        var t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
              : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return [Math.round((t[0] + m) * 255), Math.round((t[1] + m) * 255), Math.round((t[2] + m) * 255)];
    }
    function darkenIfPale(r, g, b) {
        // Judge against the WORSE of the two grounds a post paints on.
        var worst = _ratio([r, g, b], PAPER_RGB) < _ratio([r, g, b], CARD_RGB) ? PAPER_RGB : CARD_RGB;
        if (_ratio([r, g, b], worst) >= 4.6) return null;          // already carries itself
        var hsl = _hsl(r, g, b), out = null;
        // An achromatic colour carries no meaning to preserve — white and the
        // near-greys are body text that lost its dark ground, so they go to
        // ink rather than to the first grey that happens to clear the bar.
        if (hsl[1] < 0.12) return INK;
        for (var l = Math.min(hsl[2], 0.5); l >= 0.08; l -= 0.01) {
            var cand = _rgb(hsl[0], hsl[1], l);
            if (_ratio(cand, worst) >= 4.6) { out = cand; break; }
        }
        if (!out) out = [26, 23, 38];                              // fall back to ink
        var hex = function (v) { return v.toString(16).padStart(2, '0'); };
        return '#' + hex(out[0]) + hex(out[1]) + hex(out[2]);
    }

    // Parse any CSS colour literal this codebase actually uses.
    function parseColor(v) {
        v = String(v || '').trim();
        let m = v.match(/^#([0-9a-f]{3})$/i);
        if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
        m = v.match(/^#([0-9a-f]{6})$/i);
        if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
        m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i);
        if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
        if (/^white$/i.test(v)) return [255, 255, 255, 1];
        if (/^black$/i.test(v)) return [0, 0, 0, 1];
        return null;
    }

    // Does this rule paint a ground DARK enough that light text belongs on it?
    // "Has a background" is too crude: the mechanism card's own background is
    // amber at 4% alpha, so its text still effectively sits on paper and must
    // be darkened. Only a substantially opaque, genuinely dark ground earns
    // the right to keep light text.
    function rulePaintsDarkGround(body) {
        const decls = String(body || '').match(/background(?:-color)?\s*:\s*([^;]+)/gi) || [];
        for (const d of decls) {
            const val = d.replace(/^[^:]*:\s*/, '').trim();
            if (/gradient|url\(/i.test(val)) {
                const inner = val.match(/(#[0-9a-f]{3,6}|rgba?\([^)]*\))/gi) || [];
                for (const c of inner) {
                    const p = parseColor(c);
                    if (p && p[3] >= 0.5 && _lum(p) < 0.45) return true;
                }
                continue;
            }
            const first = (val.match(/(#[0-9a-f]{3,6}|rgba?\([^)]*\)|white|black)/i) || [])[0];
            const p = parseColor(first);
            if (p && p[3] >= 0.5 && _lum(p) < 0.45) return true;
        }
        return false;
    }

    function darkenColorDecls(css, darkGround) {
        return css.replace(/(^|[;{\s])color\s*:\s*(#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|white\b)/gi,
            (m, pre, val) => {
                if (darkGround) return m;                 // light text on a dark chip is correct
                const p = parseColor(val);
                if (!p || p[3] === 0) return m;
                const dark = darkenIfPale(p[0], p[1], p[2]);
                return dark ? pre + 'color: ' + dark : m;
            });
    }

    // Walk rule by rule so each declaration is judged with its own ground in
    // view, rather than treating the stylesheet as one flat string.
    function darkenStylesheet(css) {
        return css.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, sel, body) =>
            sel + '{' + darkenColorDecls(body, rulePaintsDarkGround(body)) + '}');
    }

    function darkenInlineStyles(host) {
        host.querySelectorAll('[style*="color"]').forEach((el) => {
            const before = el.getAttribute('style') || '';
            const after = darkenColorDecls(before, rulePaintsDarkGround(before));
            if (after !== before) el.setAttribute('style', after);
        });
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
