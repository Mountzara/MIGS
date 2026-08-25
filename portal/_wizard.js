// =====================================================================
// /portal/_wizard.js — onboarding wizard widget (Phase QC)
// =====================================================================
// Auto-injected into every portal HTML response by portal/_middleware.js.
// On page load:
//   1. fetch /api/v1/patient/wizard/state
//   2. if enabled && !all_done && !globally-snoozed && next_step exists
//      → auto-pop a small modal in the bottom-right showing that step
//      → "Go now" button click-navigates directly to step.cta_route
//      → "Skip" PATCHes wizard state with {step_key, skipped:true}
//      → "Remind me later" PATCHes with {step_key, snooze_for_ms: 24h}
//      → "Pause wizard" PATCHes {enabled:false}
//   3. small persistent purple progress chip bottom-left of every page
//      lets the patient open the wizard's "all-steps" panel whenever
//      they want (also gives them the on/off toggle)
//
// §3.10 Apple-glass purple, mzRise animation, prefers-reduced-motion
// override, focus-trap, Escape closes, body scroll-lock while modal open.
// =====================================================================
(function () {
    'use strict';

    if (window.__mzWizardInstalled) return;
    window.__mzWizardInstalled = true;

    // Don't try to load on routes where the user isn't authenticated
    // (signup, login, preview-grant) — the wizard endpoint requires a patient session.
    const route = window.location.pathname;
    const SKIP_PATHS = ["/portal/login", "/portal/signup", "/portal/magic-link", "/portal/preview-grant"];
    if (SKIP_PATHS.some((p) => route === p || route.startsWith(p + "/"))) return;

    const STYLE = `
        .mz-wz-chip {
            position: fixed;
            left: clamp(14px, 2vw, 22px);
            bottom: clamp(14px, 2vw, 22px);
            z-index: 9997;
            display: inline-flex; align-items: center; gap: 9px;
            padding: 9px 14px 9px 11px;
            font: 500 12.5px/1 'Avenir Next', 'Nunito Sans', system-ui, sans-serif;
            color: #1A1726;
            border: 1px solid rgba(167, 139, 250, 0.32);
            border-radius: 999px;
            background: rgba(251, 250, 248, 0.86);
            backdrop-filter: blur(18px) saturate(180%);
            -webkit-backdrop-filter: blur(18px) saturate(180%);
            box-shadow: 0 10px 22px -10px rgba(0, 0, 0, 0.5);
            cursor: pointer;
            transition: transform 0.2s, border-color 0.2s, background 0.2s;
        }
        .mz-wz-chip:hover, .mz-wz-chip:focus-visible {
            transform: translateY(-1px);
            border-color: rgba(167, 139, 250, 0.6);
            background: rgba(255, 255, 255, 0.92);
            outline: none;
        }
        .mz-wz-ring {
            width: 22px; height: 22px;
            border-radius: 50%;
            background:
                conic-gradient(rgba(167, 139, 250, 1) var(--mz-pct, 0%), rgba(255, 255, 255, 0.08) 0);
            display: inline-flex; align-items: center; justify-content: center;
            position: relative;
        }
        .mz-wz-ring::after {
            content: "";
            position: absolute;
            inset: 3px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.96);
        }
        .mz-wz-ring .mz-wz-pct {
            position: relative; z-index: 1;
            font-size: 8.5px; font-weight: 700; letter-spacing: 0.05em;
            color: rgba(167, 139, 250, 0.95);
        }

        .mz-wz-backdrop {
            position: fixed; inset: 0;
            background: rgba(7, 7, 10, 0.72);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.22s;
            display: flex; align-items: center; justify-content: center;
            padding: clamp(16px, 4vw, 32px);
        }
        .mz-wz-backdrop.mz-open { opacity: 1; }
        .mz-wz-modal {
            width: min(540px, 100%);
            max-height: min(86vh, 720px);
            display: flex; flex-direction: column;
            background:
                radial-gradient(ellipse 80% 60% at 50% -20%, rgba(167, 139, 250, 0.16), transparent 60%),
                rgba(14, 14, 19, 0.96);
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
        .mz-wz-backdrop.mz-open .mz-wz-modal { transform: none; opacity: 1; }
        .mz-wz-modal header {
            padding: 18px 22px 14px;
            border-bottom: 1px solid #E9E5EE;
        }
        .mz-wz-eyebrow {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 10.5px; font-weight: 700; letter-spacing: 0.22em;
            text-transform: uppercase;
            color: rgba(167, 139, 250, 0.95);
            margin-bottom: 8px;
        }
        .mz-wz-pulse {
            width: 7px; height: 7px; border-radius: 50%;
            background: rgba(167, 139, 250, 1);
            animation: mzWzPulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .mz-wz-modal h2 {
            margin: 0;
            font-size: 22px; font-weight: 300;
            letter-spacing: -0.012em; color: #1A1726;
        }
        .mz-wz-modal h2 em {
            font-style: normal;
            background: linear-gradient(180deg, rgba(167, 139, 250, 1), rgba(109, 40, 217, 1));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .mz-wz-progress {
            margin-top: 14px;
            height: 5px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 999px;
            overflow: hidden;
        }
        .mz-wz-progress .bar {
            height: 100%;
            background: linear-gradient(90deg, rgba(167, 139, 250, 1), rgba(109, 40, 217, 1));
            transition: width 0.4s;
            border-radius: 999px;
        }
        .mz-wz-progress-text {
            margin-top: 8px;
            font-size: 11.5px;
            color: #6E6A7C;
            letter-spacing: 0.06em;
        }

        .mz-wz-body { padding: 18px 22px; overflow-y: auto; }
        .mz-wz-blurb {
            font-size: 14.5px; line-height: 1.62;
            color: #1A1726;
            margin: 0 0 12px;
        }
        .mz-wz-time {
            font-size: 11.5px;
            color: #6E6A7C;
            margin-bottom: 18px;
        }

        .mz-wz-steplist { display: grid; gap: 8px; }
        .mz-wz-steprow {
            display: grid; grid-template-columns: 22px 1fr auto; gap: 12px;
            align-items: center;
            padding: 10px 14px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid #E9E5EE;
            border-radius: 10px;
            font-size: 13px;
            color: #1A1726;
            cursor: pointer;
            transition: background 0.18s, border-color 0.18s, transform 0.18s;
        }
        .mz-wz-steprow:hover {
            transform: translateY(-1px);
            border-color: rgba(167, 139, 250, 0.35);
            background: rgba(167, 139, 250, 0.06);
        }
        .mz-wz-steprow .dot {
            width: 16px; height: 16px;
            border-radius: 50%;
            border: 1.5px solid rgba(255, 255, 255, 0.20);
            display: inline-flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        .mz-wz-steprow.done .dot {
            border-color: rgba(74, 222, 128, 0.7);
            background: rgba(74, 222, 128, 0.15);
        }
        .mz-wz-steprow.done .dot::after {
            content: "\\2713";
            font-size: 10px;
            color: rgba(74, 222, 128, 0.95);
            font-weight: 700;
        }
        .mz-wz-steprow.skipped .dot {
            border-color: #4A4658;
            background: rgba(255, 255, 255, 0.04);
        }
        .mz-wz-steprow.skipped .title { text-decoration: line-through; opacity: 0.55; }
        .mz-wz-steprow.next {
            border-color: rgba(167, 139, 250, 0.6);
            background: rgba(167, 139, 250, 0.10);
        }
        .mz-wz-steprow .title { font-weight: 500; color: #1A1726; }
        .mz-wz-steprow .meta {
            font-size: 11.5px;
            color: #6E6A7C;
            letter-spacing: 0.04em;
        }
        .mz-wz-steprow .arrow {
            color: rgba(167, 139, 250, 0.7);
            font-size: 14px;
        }

        .mz-wz-actions {
            display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
            padding: 14px 22px 18px;
            border-top: 1px solid #E9E5EE;
            background: rgba(7, 7, 10, 0.42);
        }
        .mz-wz-btn {
            font: inherit; font-size: 13px; font-weight: 500;
            padding: 9px 16px;
            border-radius: 9px; cursor: pointer;
            border: 1px solid #E9E5EE;
            background: rgba(255, 255, 255, 0.04);
            color: #4A4658;
            transition: background 0.18s, color 0.18s, border-color 0.18s, transform 0.18s;
        }
        .mz-wz-btn:hover { transform: translateY(-1px); color: #1A1726; border-color: rgba(167, 139, 250, 0.45); }
        .mz-wz-btn.primary {
            background: linear-gradient(180deg, rgba(167, 139, 250, 1), rgba(109, 40, 217, 1));
            border-color: rgba(167, 139, 250, 0.6);
            color: #1A1726;
            font-weight: 500;
            padding: 10px 22px;
        }
        .mz-wz-btn.primary:hover { box-shadow: 0 12px 28px -8px rgba(109, 40, 217, 0.5); }
        .mz-wz-btn.subtle { background: transparent; border-color: transparent; color: #4A4658; }
        .mz-wz-btn.subtle:hover { color: #1A1726; }

        body.mz-wz-locked { overflow: hidden; }

        @keyframes mzWzPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.55); }
            50%      { box-shadow: 0 0 0 6px rgba(167, 139, 250, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
            .mz-wz-chip, .mz-wz-backdrop, .mz-wz-modal, .mz-wz-steprow, .mz-wz-btn, .mz-wz-pulse {
                transition: none !important; animation: none !important;
            }
        }
    `;

    const ICON_ARROW = '→';
    const ICON_X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    let state = null;
    let chip = null;
    let modal = null;
    let viewMode = "next";          // "next" (single-step modal) or "all" (full checklist)
    let lastFocused = null;
    let isOpen = false;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function findStep(key) {
        return state && state.steps ? state.steps.find((s) => s.key === key) : null;
    }

    function nextStep() {
        return state && state.next_step_key ? findStep(state.next_step_key) : null;
    }

    async function fetchState() {
        try {
            const r = await fetch('/api/v1/patient/wizard/state', { credentials: 'include' });
            if (!r.ok) return null;
            const data = await r.json();
            return data.wizard || null;
        } catch { return null; }
    }

    async function patchState(body) {
        try {
            const r = await fetch('/api/v1/patient/wizard/state', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!r.ok) return null;
            const data = await r.json();
            return data.wizard || null;
        } catch { return null; }
    }

    function buildChip() {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'mz-wz-chip';
        el.setAttribute('aria-label', 'Open setup wizard');
        el.style.setProperty('--mz-pct', '0%');
        el.innerHTML = `
            <span class="mz-wz-ring"><span class="mz-wz-pct">0</span></span>
            <span class="mz-wz-label">Set up your portal</span>
        `;
        el.addEventListener('click', () => { viewMode = "all"; render(); openModal(); });
        document.body.appendChild(el);
        return el;
    }

    function updateChip() {
        if (!chip || !state) return;
        chip.style.setProperty('--mz-pct', state.completion_pct + '%');
        const pctEl = chip.querySelector('.mz-wz-pct');
        if (pctEl) pctEl.textContent = state.completion_pct;
        const labelEl = chip.querySelector('.mz-wz-label');
        if (labelEl) {
            if (state.all_done) {
                labelEl.textContent = 'Setup complete';
            } else if (!state.enabled) {
                labelEl.textContent = 'Wizard paused — turn back on';
            } else {
                labelEl.textContent = `Set up your portal — ${state.completed_count}/${state.total}`;
            }
        }
    }

    function buildModal() {
        const bd = document.createElement('div');
        bd.className = 'mz-wz-backdrop';
        bd.setAttribute('role', 'dialog');
        bd.setAttribute('aria-modal', 'true');
        bd.setAttribute('aria-labelledby', 'mz-wz-title');
        bd.innerHTML = `
            <div class="mz-wz-modal">
                <header>
                    <span class="mz-wz-eyebrow"><span class="mz-wz-pulse" aria-hidden="true"></span><span id="mz-wz-eyebrow-text">Setup wizard</span></span>
                    <h2 id="mz-wz-title">Let&rsquo;s <em>finish setting up</em>.</h2>
                    <div class="mz-wz-progress" aria-hidden="true"><div class="bar" id="mz-wz-bar" style="width:0%"></div></div>
                    <p class="mz-wz-progress-text" id="mz-wz-progress-text">0 of 0 steps complete</p>
                </header>
                <div class="mz-wz-body" id="mz-wz-body"></div>
                <div class="mz-wz-actions" id="mz-wz-actions"></div>
            </div>
        `;
        bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(); });
        document.body.appendChild(bd);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeModal(); });
        return bd;
    }

    function renderHeader() {
        const eyebrow = document.getElementById('mz-wz-eyebrow-text');
        const titleEl = document.getElementById('mz-wz-title');
        const barEl = document.getElementById('mz-wz-bar');
        const txtEl = document.getElementById('mz-wz-progress-text');
        if (!state) return;
        if (viewMode === "next" && nextStep()) {
            eyebrow.textContent = `Next step (${state.completed_count + 1} of ${state.total})`;
            const ns = nextStep();
            titleEl.innerHTML = `<em>${esc(ns.title)}</em>`;
        } else if (state.all_done) {
            eyebrow.textContent = "All set";
            titleEl.innerHTML = `<em>You&rsquo;re all set up.</em>`;
        } else {
            eyebrow.textContent = "Setup wizard";
            titleEl.innerHTML = `Let&rsquo;s <em>finish setting up</em>.`;
        }
        barEl.style.width = state.completion_pct + '%';
        txtEl.textContent = state.completed_count + ' of ' + state.total + ' steps complete';
    }

    function renderBody() {
        const body = document.getElementById('mz-wz-body');
        if (!body || !state) return;
        if (viewMode === "next" && nextStep()) {
            const ns = nextStep();
            body.innerHTML = `
                <p class="mz-wz-blurb">${esc(ns.blurb)}</p>
                <p class="mz-wz-time">About ${esc(ns.time_estimate)} &middot; you can come back anytime</p>
            `;
        } else {
            body.innerHTML = `<div class="mz-wz-steplist">${state.steps.map((s) => `
                <div class="mz-wz-steprow ${s.completed ? 'done' : ''} ${s.skipped ? 'skipped' : ''} ${(!s.completed && !s.skipped && state.next_step_key === s.key) ? 'next' : ''}" data-key="${esc(s.key)}">
                    <span class="dot" aria-hidden="true"></span>
                    <span>
                        <span class="title">${esc(s.title)}</span><br>
                        <span class="meta">${esc(s.time_estimate)}${s.completed ? ' &middot; done' : (s.skipped ? ' &middot; skipped' : '')}</span>
                    </span>
                    <span class="arrow" aria-hidden="true">${s.completed ? '' : ICON_ARROW}</span>
                </div>
            `).join('')}</div>`;
            body.querySelectorAll('.mz-wz-steprow').forEach((row) => {
                row.addEventListener('click', () => {
                    const key = row.getAttribute('data-key');
                    const step = findStep(key);
                    if (step && !step.completed) {
                        navigateToStep(step);
                    }
                });
            });
        }
    }

    function renderActions() {
        const actions = document.getElementById('mz-wz-actions');
        if (!actions || !state) return;
        if (state.all_done) {
            actions.innerHTML = `
                <span style="font-size:12.5px; color: #4A4658;">Nice work. The wizard will stop showing itself.</span>
                <span style="flex:1"></span>
                <button class="mz-wz-btn" id="mz-wz-close">Close</button>
            `;
        } else if (viewMode === "next" && nextStep()) {
            const ns = nextStep();
            actions.innerHTML = `
                <button class="mz-wz-btn subtle" id="mz-wz-pause">Pause wizard</button>
                <span style="flex:1"></span>
                <button class="mz-wz-btn" id="mz-wz-skip">Skip this step</button>
                <button class="mz-wz-btn" id="mz-wz-snooze">Remind me later</button>
                <button class="mz-wz-btn" id="mz-wz-allsteps">See all steps</button>
                <button class="mz-wz-btn primary" id="mz-wz-go">${esc(ns.cta_label)}</button>
            `;
            document.getElementById('mz-wz-go').addEventListener('click', () => navigateToStep(ns));
            document.getElementById('mz-wz-skip').addEventListener('click', async () => {
                await patchState({ step_key: ns.key, skipped: true });
                state = await fetchState();
                render();
            });
            document.getElementById('mz-wz-snooze').addEventListener('click', async () => {
                await patchState({ step_key: ns.key, snooze_for_ms: 24 * 60 * 60 * 1000 });
                closeModal();
            });
            document.getElementById('mz-wz-allsteps').addEventListener('click', () => { viewMode = "all"; render(); });
            document.getElementById('mz-wz-pause').addEventListener('click', async () => {
                await patchState({ enabled: false });
                state = await fetchState();
                updateChip();
                closeModal();
            });
        } else {
            actions.innerHTML = `
                <button class="mz-wz-btn subtle" id="mz-wz-pause">${state.enabled ? 'Pause wizard' : 'Turn wizard on'}</button>
                <span style="flex:1"></span>
                <button class="mz-wz-btn" id="mz-wz-close">Close</button>
            `;
            document.getElementById('mz-wz-pause').addEventListener('click', async () => {
                await patchState({ enabled: !state.enabled });
                state = await fetchState();
                updateChip();
                render();
            });
        }
        const closeBtn = document.getElementById('mz-wz-close');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
    }

    function navigateToStep(step) {
        if (!step || !step.cta_route) return;
        // Use a hard navigation so /portal SPAs that don't share state
        // pick up cleanly. Tell the server we opened it so analytics tick.
        patchState({ bump_opened: true }).catch(() => {});
        window.location.href = step.cta_route;
    }

    function render() {
        if (!modal || !state) return;
        renderHeader();
        renderBody();
        renderActions();
        updateChip();
    }

    function openModal() {
        if (isOpen) return;
        isOpen = true;
        lastFocused = document.activeElement;
        document.body.classList.add('mz-wz-locked');
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('mz-open'));
        patchState({ bump_opened: true }).catch(() => {});
        // Focus the primary button if present.
        setTimeout(() => {
            const f = modal.querySelector('.mz-wz-btn.primary') || modal.querySelector('.mz-wz-btn');
            if (f) f.focus();
        }, 60);
    }

    function closeModal() {
        if (!isOpen) return;
        isOpen = false;
        modal.classList.remove('mz-open');
        setTimeout(() => { modal.style.display = 'none'; }, 250);
        document.body.classList.remove('mz-wz-locked');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    async function boot() {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        state = await fetchState();
        if (!state) return;             // not authenticated yet or endpoint not available — silent

        chip = buildChip();
        modal = buildModal();
        modal.style.display = 'none';
        updateChip();

        // Auto-pop the modal on the portal home (/portal/) if there's a
        // next step and not snoozed. Other routes only show the chip.
        if (state.should_auto_open && (route === '/portal' || route === '/portal/')) {
            viewMode = "next";
            render();
            // small delay so the page renders first
            setTimeout(() => openModal(), 400);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
