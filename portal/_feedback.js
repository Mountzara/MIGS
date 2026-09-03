// =====================================================================
// /portal/_feedback.js — beta-tester feedback widget (Phase QB)
// =====================================================================
// Auto-injected into every portal HTML response by functions/portal/_middleware.js.
// Renders a floating purple/glass "Feedback" button bottom-right of every
// portal page; opens a modal with type / severity / comment / optional
// screenshot capture; POSTs to /api/v1/patient/feedback.
//
// Privacy invariants:
//   * NEVER reads form field values from the page. The screenshot is
//     user-explicit (they have to click "Capture screen") and uses the
//     browser's getDisplayMedia API which prompts the user for permission.
//   * The comment field IS captured verbatim because it's patient-volunteered.
//   * Auto-captured PHI-free context: route, viewport, document.referrer,
//     page-load timing, scroll percentage at submit time.
//
// design — Apple-glass purple, mzRise animation, prefers-reduced-motion
// respected, focus-visible ring, Escape closes modal, outside-click closes,
// scroll-locked body, accessible aria.
// =====================================================================
(function () {
    'use strict';

    if (window.__mzFeedbackInstalled) return;
    window.__mzFeedbackInstalled = true;

    const ICON_BUBBLE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const ICON_CAMERA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

    const STYLE = `
        .mz-fb-launcher {
            position: fixed;
            right: clamp(14px, 2vw, 22px);
            bottom: clamp(14px, 2vw, 22px);
            z-index: 9998;
            display: inline-flex; align-items: center; gap: 8px;
            padding: 11px 16px 11px 14px;
            font: 500 13px/1 'Avenir Next', 'Nunito Sans', system-ui, -apple-system, sans-serif;
            letter-spacing: 0.01em;
            color: #1A1726;
            border: 1px solid rgba(167, 139, 250, 0.45);
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(167, 139, 250, 0.95), rgba(109, 40, 217, 0.95));
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            box-shadow: 0 12px 30px -10px rgba(109, 40, 217, 0.55), 0 0 0 1px rgba(167, 139, 250, 0.35) inset;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
        }
        .mz-fb-launcher:hover, .mz-fb-launcher:focus-visible {
            transform: translateY(-2px);
            box-shadow: 0 18px 40px -10px rgba(109, 40, 217, 0.7), 0 0 0 1px rgba(167, 139, 250, 0.55) inset;
            outline: none;
        }
        .mz-fb-launcher svg { flex-shrink: 0; }

        .mz-fb-backdrop {
            position: fixed; inset: 0;
            background: rgba(7, 7, 10, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.22s ease;
            display: flex; align-items: center; justify-content: center;
            padding: clamp(16px, 4vw, 32px);
        }
        .mz-fb-backdrop.mz-open { opacity: 1; }

        .mz-fb-modal {
            width: min(560px, 100%);
            max-height: min(86vh, 720px);
            display: flex; flex-direction: column;
            background:
                radial-gradient(ellipse 80% 60% at 50% -20%, rgba(167, 139, 250, 0.12), transparent 60%),
                rgba(14, 14, 19, 0.94);
            border: 1px solid #E9E5EE;
            border-radius: 18px;
            backdrop-filter: blur(28px) saturate(180%);
            -webkit-backdrop-filter: blur(28px) saturate(180%);
            box-shadow: 0 40px 80px -20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(167, 139, 250, 0.18) inset;
            color: #1A1726;
            font-family: 'Avenir Next', 'Nunito Sans', system-ui, sans-serif;
            transform: translateY(8px) scale(0.985);
            opacity: 0;
            transition: opacity 0.22s, transform 0.22s;
            overflow: hidden;
        }
        .mz-fb-backdrop.mz-open .mz-fb-modal { transform: none; opacity: 1; }

        .mz-fb-modal header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 18px 22px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .mz-fb-modal header .eyebrow {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 10.5px; font-weight: 700; letter-spacing: 0.22em;
            text-transform: uppercase;
            color: rgba(167, 139, 250, 0.95);
        }
        .mz-fb-modal header .pulse {
            width: 7px; height: 7px; border-radius: 50%;
            background: rgba(167, 139, 250, 1);
            animation: mzFbPulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .mz-fb-modal h2 {
            margin: 6px 0 0; font-size: 19px; font-weight: 400;
            letter-spacing: -0.01em; color: #1A1726;
        }
        .mz-fb-close {
            background: #FFFFFF;
            border: 1px solid #E9E5EE;
            color: #4A4658;
            width: 32px; height: 32px; border-radius: 999px;
            display: inline-flex; align-items: center; justify-content: center;
            cursor: pointer;
            transition: background 0.18s, border-color 0.18s, color 0.18s;
        }
        .mz-fb-close:hover, .mz-fb-close:focus-visible {
            background: #FFFFFF;
            color: #1A1726;
            border-color: rgba(167, 139, 250, 0.45);
            outline: none;
        }
        .mz-fb-body {
            flex: 1; overflow-y: auto;
            padding: 18px 22px 22px;
        }
        .mz-fb-field { margin-bottom: 16px; }
        .mz-fb-field label {
            display: block;
            font-size: 11px; font-weight: 700;
            letter-spacing: 0.16em; text-transform: uppercase;
            color: #4A4658;
            margin-bottom: 8px;
        }
        .mz-fb-types, .mz-fb-severities {
            display: flex; flex-wrap: wrap; gap: 8px;
        }
        .mz-fb-chip {
            font: inherit;
            padding: 9px 14px;
            border-radius: 999px;
            background: #FFFFFF;
            border: 1px solid #E9E5EE;
            color: #4A4658;
            font-size: 13px; font-weight: 500;
            cursor: pointer;
            transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.18s;
        }
        .mz-fb-chip:hover { transform: translateY(-1px); color: #1A1726; border-color: rgba(167, 139, 250, 0.42); }
        .mz-fb-chip.active {
            background: rgba(167, 139, 250, 0.20);
            border-color: rgba(167, 139, 250, 0.6);
            color: #1A1726;
        }
        .mz-fb-textarea {
            width: 100%;
            padding: 12px 14px;
            background: #FFFFFF;
            border: 1px solid #E9E5EE;
            border-radius: 12px;
            color: #1A1726;
            font: inherit; font-size: 14px; line-height: 1.5;
            min-height: 100px;
            resize: vertical;
            transition: border-color 0.18s, background 0.18s;
        }
        .mz-fb-textarea:focus {
            outline: none;
            border-color: rgba(167, 139, 250, 0.55);
            background: #FFFFFF;
        }
        .mz-fb-screenshot {
            display: inline-flex; align-items: center; gap: 8px;
            background: #FFFFFF;
            border: 1px dashed rgba(167, 139, 250, 0.4);
            color: rgba(167, 139, 250, 0.95);
            padding: 9px 13px;
            border-radius: 10px;
            font-size: 12.5px; cursor: pointer;
            transition: background 0.18s, color 0.18s, border-color 0.18s;
        }
        .mz-fb-screenshot:hover { background: rgba(167, 139, 250, 0.08); color: #1A1726; border-style: solid; }
        .mz-fb-screenshot.has-image {
            border-style: solid; border-color: rgba(74, 222, 128, 0.45);
            color: rgba(74, 222, 128, 0.95);
            background: rgba(74, 222, 128, 0.08);
        }
        .mz-fb-preview-img {
            max-width: 100%;
            margin-top: 8px;
            border-radius: 10px;
            border: 1px solid #E9E5EE;
            display: block;
        }
        .mz-fb-context {
            font-size: 11px; color: #6E6A7C;
            margin-top: 4px; line-height: 1.55;
            font-family: 'JetBrains Mono', ui-monospace, "SF Mono", Menlo, monospace;
            word-break: break-all;
        }
        .mz-fb-actions {
            display: flex; align-items: center; gap: 10px;
            padding: 14px 22px 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(7, 7, 10, 0.42);
        }
        .mz-fb-submit {
            margin-left: auto;
            font: inherit;
            padding: 11px 22px;
            font-size: 14px; font-weight: 500;
            color: #1A1726;
            background: linear-gradient(180deg, rgba(167, 139, 250, 1), rgba(109, 40, 217, 1));
            border: 1px solid rgba(167, 139, 250, 0.55);
            border-radius: 10px;
            cursor: pointer;
            transition: transform 0.18s, box-shadow 0.18s, opacity 0.18s;
        }
        .mz-fb-submit:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -8px rgba(109, 40, 217, 0.5); }
        .mz-fb-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .mz-fb-status {
            font-size: 12.5px; color: #6E6A7C;
            flex: 1;
        }
        .mz-fb-status.ok { color: rgba(74, 222, 128, 0.92); }
        .mz-fb-status.err { color: rgba(248, 113, 113, 0.92); }

        body.mz-fb-locked { overflow: hidden; }

        @keyframes mzFbPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.55); }
            50%      { box-shadow: 0 0 0 6px rgba(167, 139, 250, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
            .mz-fb-launcher, .mz-fb-backdrop, .mz-fb-modal, .mz-fb-chip, .mz-fb-submit, .mz-fb-close {
                transition: none !important; animation: none !important;
            }
        }
        @media (max-width: 480px) {
            .mz-fb-launcher span.label { display: none; }
            .mz-fb-launcher { padding: 12px; }
        }
    `;

    // PHI-free context capture. NEVER reads form values.
    const ctx = {
        route: window.location.pathname,
        viewport: { w: window.innerWidth || 0, h: window.innerHeight || 0 },
        referrer: document.referrer ? new URL(document.referrer).pathname : null,
        page_load_ms: (window.performance && window.performance.timing && window.performance.timing.loadEventEnd)
            ? Math.max(0, window.performance.timing.loadEventEnd - window.performance.timing.navigationStart)
            : null,
    };

    let isOpen = false;
    let lastFocused = null;
    let selectedType = null;
    let selectedSeverity = null;
    let screenshotB64 = null;
    let screenshotMime = null;
    let busy = false;

    function buildLauncher() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mz-fb-launcher';
        btn.setAttribute('aria-label', 'Send feedback');
        btn.innerHTML = ICON_BUBBLE + '<span class="label">Feedback</span>';
        btn.addEventListener('click', open);
        document.body.appendChild(btn);
        return btn;
    }

    function buildModal() {
        const backdrop = document.createElement('div');
        backdrop.className = 'mz-fb-backdrop';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-labelledby', 'mz-fb-title');
        backdrop.innerHTML = `
            <div class="mz-fb-modal">
                <header>
                    <div>
                        <span class="eyebrow"><span class="pulse" aria-hidden="true"></span>Feedback &middot; Beta</span>
                        <h2 id="mz-fb-title">Tell us what you noticed</h2>
                    </div>
                    <button type="button" class="mz-fb-close" aria-label="Close">${ICON_X}</button>
                </header>
                <div class="mz-fb-body">
                    <div class="mz-fb-field">
                        <label>What kind of feedback?</label>
                        <div class="mz-fb-types">
                            <button type="button" class="mz-fb-chip" data-type="bug">Something broken</button>
                            <button type="button" class="mz-fb-chip" data-type="confusing">Confusing</button>
                            <button type="button" class="mz-fb-chip" data-type="suggestion">Suggestion</button>
                            <button type="button" class="mz-fb-chip" data-type="praise">Loved it</button>
                            <button type="button" class="mz-fb-chip" data-type="other">Other</button>
                        </div>
                    </div>
                    <div class="mz-fb-field" data-show-when="not-praise">
                        <label>How much is it bothering you?</label>
                        <div class="mz-fb-severities">
                            <button type="button" class="mz-fb-chip" data-sev="blocker">It blocks me</button>
                            <button type="button" class="mz-fb-chip" data-sev="annoying">Annoying</button>
                            <button type="button" class="mz-fb-chip" data-sev="nice_to_have">Nice to have</button>
                        </div>
                    </div>
                    <div class="mz-fb-field">
                        <label for="mz-fb-comment">What happened, in your own words?</label>
                        <textarea id="mz-fb-comment" class="mz-fb-textarea" rows="4"
                            placeholder="As much or as little detail as you want. Be honest &mdash; the more direct, the better."
                            maxlength="4000"></textarea>
                    </div>
                    <div class="mz-fb-field">
                        <label>Attach a screenshot (optional)</label>
                        <button type="button" class="mz-fb-screenshot" id="mz-fb-screenshot-btn">
                            ${ICON_CAMERA}<span class="label">Capture this screen</span>
                        </button>
                        <img class="mz-fb-preview-img" id="mz-fb-preview-img" style="display:none;" alt="Captured screenshot preview">
                    </div>
                    <p class="mz-fb-context">
                        page: ${escapeHtml(ctx.route)}<br>
                        viewport: ${ctx.viewport.w}&times;${ctx.viewport.h}
                    </p>
                </div>
                <div class="mz-fb-actions">
                    <span class="mz-fb-status" id="mz-fb-status"></span>
                    <button type="button" class="mz-fb-submit" id="mz-fb-submit" disabled>Send feedback</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        // Wire interactions.
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        backdrop.querySelector('.mz-fb-close').addEventListener('click', close);

        backdrop.querySelectorAll('[data-type]').forEach((b) => {
            b.addEventListener('click', () => {
                backdrop.querySelectorAll('[data-type]').forEach((x) => x.classList.remove('active'));
                b.classList.add('active');
                selectedType = b.getAttribute('data-type');
                updateSubmitState();
                // Hide severity for "praise".
                const sevWrap = backdrop.querySelector('[data-show-when="not-praise"]');
                if (selectedType === 'praise') { sevWrap.style.display = 'none'; selectedSeverity = null; backdrop.querySelectorAll('[data-sev]').forEach((x) => x.classList.remove('active')); }
                else sevWrap.style.display = '';
            });
        });
        backdrop.querySelectorAll('[data-sev]').forEach((b) => {
            b.addEventListener('click', () => {
                backdrop.querySelectorAll('[data-sev]').forEach((x) => x.classList.remove('active'));
                b.classList.add('active');
                selectedSeverity = b.getAttribute('data-sev');
                updateSubmitState();
            });
        });
        backdrop.querySelector('#mz-fb-comment').addEventListener('input', updateSubmitState);
        backdrop.querySelector('#mz-fb-screenshot-btn').addEventListener('click', captureScreen);
        backdrop.querySelector('#mz-fb-submit').addEventListener('click', submit);

        document.addEventListener('keydown', escClose);

        return backdrop;
    }

    function escClose(e) { if (e.key === 'Escape' && isOpen) close(); }

    function updateSubmitState() {
        if (!modal) return;
        const comment = modal.querySelector('#mz-fb-comment').value.trim();
        const submit = modal.querySelector('#mz-fb-submit');
        submit.disabled = !(selectedType && comment.length >= 4 && !busy);
    }

    function setStatus(msg, kind) {
        if (!modal) return;
        const el = modal.querySelector('#mz-fb-status');
        el.textContent = msg || '';
        el.className = 'mz-fb-status' + (kind ? ' ' + kind : '');
    }

    async function captureScreen() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            setStatus('Screen-capture not supported on this browser.', 'err');
            return;
        }
        setStatus('Pick "This Tab" in the picker that opens.', '');
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'never' },
                audio: false,
                preferCurrentTab: true,
            });
            const track = stream.getVideoTracks()[0];
            const imgCap = new ImageCapture(track);
            const bitmap = await imgCap.grabFrame();
            track.stop();
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const cctx = canvas.getContext('2d');
            cctx.drawImage(bitmap, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            screenshotMime = 'image/png';
            screenshotB64 = dataUrl.split(',')[1];
            const img = modal.querySelector('#mz-fb-preview-img');
            img.src = dataUrl;
            img.style.display = 'block';
            modal.querySelector('#mz-fb-screenshot-btn').classList.add('has-image');
            modal.querySelector('#mz-fb-screenshot-btn').innerHTML = ICON_CAMERA + '<span>Screenshot captured</span>';
            setStatus('Screenshot ready.', 'ok');
        } catch (err) {
            // User cancelled or denied — non-fatal.
            console.warn('feedback: screen capture cancelled/failed', err);
            setStatus('Screenshot skipped.', '');
        }
    }

    async function submit() {
        if (busy) return;
        busy = true;
        const submitBtn = modal.querySelector('#mz-fb-submit');
        const origText = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';
        submitBtn.disabled = true;
        setStatus('Sending feedback...', '');

        const comment = modal.querySelector('#mz-fb-comment').value.trim();
        // Pull recent session_trace events from window.__mzTrace if a future
        // version of the portal SPAs starts exposing them. PHI-free.
        const recentTraces = (window.__mzTrace && Array.isArray(window.__mzTrace) ? window.__mzTrace : [])
            .slice(-6)
            .map((t) => ({ action: t.action, route: t.route, outcome: t.outcome, ts: t.ts }));

        const payload = {
            route: ctx.route,
            viewport_width: ctx.viewport.w,
            viewport_height: ctx.viewport.h,
            feedback_type: selectedType,
            severity: selectedSeverity,
            comment_text: comment,
            detail: {
                referrer: ctx.referrer,
                page_load_ms: ctx.page_load_ms,
                scroll_pct: Math.round(((window.scrollY || 0) / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100),
                recent_traces: recentTraces,
            },
        };
        if (screenshotB64) {
            payload.screenshot_base64 = screenshotB64;
            payload.screenshot_mime = screenshotMime;
        }

        try {
            const resp = await fetch('/api/v1/patient/feedback', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                setStatus('Could not send: ' + (body.message || 'HTTP ' + resp.status), 'err');
                submitBtn.disabled = false;
                submitBtn.textContent = origText;
                busy = false;
                return;
            }
            const body = await resp.json();
            setStatus('Sent &mdash; thank you.', 'ok');
            setTimeout(() => {
                close();
                resetForm();
                busy = false;
                submitBtn.textContent = origText;
            }, 1100);
        } catch (e) {
            console.error('feedback submit threw', e);
            setStatus('Network error. Try again?', 'err');
            submitBtn.disabled = false;
            submitBtn.textContent = origText;
            busy = false;
        }
    }

    function resetForm() {
        if (!modal) return;
        modal.querySelectorAll('.mz-fb-chip').forEach((c) => c.classList.remove('active'));
        modal.querySelector('#mz-fb-comment').value = '';
        modal.querySelector('#mz-fb-preview-img').style.display = 'none';
        modal.querySelector('#mz-fb-preview-img').src = '';
        modal.querySelector('#mz-fb-screenshot-btn').classList.remove('has-image');
        modal.querySelector('#mz-fb-screenshot-btn').innerHTML = ICON_CAMERA + '<span>Capture this screen</span>';
        selectedType = null;
        selectedSeverity = null;
        screenshotB64 = null;
        screenshotMime = null;
        setStatus('', '');
        updateSubmitState();
    }

    function open() {
        if (isOpen) return;
        isOpen = true;
        lastFocused = document.activeElement;
        document.body.classList.add('mz-fb-locked');
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('mz-open'));
        // Refresh route in case of SPA navigation.
        ctx.route = window.location.pathname;
        const ctxEl = modal.querySelector('.mz-fb-context');
        if (ctxEl) ctxEl.innerHTML = `page: ${escapeHtml(ctx.route)}<br>viewport: ${window.innerWidth}&times;${window.innerHeight}`;
        // Focus the first chip for keyboard users.
        setTimeout(() => {
            const f = modal.querySelector('.mz-fb-chip');
            if (f) f.focus();
        }, 60);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        modal.classList.remove('mz-open');
        setTimeout(() => { modal.style.display = 'none'; }, 250);
        document.body.classList.remove('mz-fb-locked');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let modal;
    function install() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);
        buildLauncher();
        modal = buildModal();
        modal.style.display = 'none';
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
