/* Extracted from index.html 2026-08-08.
   Measured in real WebKit (Safari's engine): shipping this 249 KB of
   JavaScript INLINE forced Safari to parse and compile the whole thing
   before any of it could run, so the opening animation did not begin for
   ~9 seconds and the page sat frozen. As an external deferred file it
   compiles off the critical path and is cached across visits. */

        // Orchestrated reveal sequence:
        //   1. Page loader visible while critical assets download
        //   2. Loader fades out
        //   3. Hero animation plays (already in DOM, just becomes visible)
        //   4. Text content cascades in Apple-style
        //   5. Background image fades out when user scrolls past sticky sections
        const heroVideo = document.getElementById('heroVideo');
        const heroContent = document.querySelector('.hero-content-delayed');
        const pageLoader = document.getElementById('pageLoader');
        const heroBgStage = document.getElementById('heroBgStage');
        // 2026-06-11 — corrected from a stale 6762ms (161 frames) to the
        // ACTUAL duration of hero-animation-hd-v2.mp4: 193 frames ≈ 8042ms.
        // The stale value fired the Ken Burns zoom ~1.3s BEFORE the drawing
        // finished, so the slow zoom started mid-draw instead of on the
        // settled final frame (user: "supposed to have a ken burns subtle
        // effect"). Text-cascade delay derives from this, so fixing the
        // constant restores both to their intended ~55%-through timing.
        const ANIMATION_DURATION_MS = 8042; // 193 frames @ ~24fps (measured)

        function preloadImageURL(url) {
            // Use fetch instead of new Image() — we want the bytes in the HTTP
            // cache but NOT decoded yet, so the animation only begins when the
            // real <img> element gets the src attribute.
            return fetch(url, { cache: 'force-cache', mode: 'no-cors' })
                .then(r => r.blob())
                .catch(() => {});
        }

        function waitForFonts() {
            if (document.fonts && document.fonts.ready) {
                return document.fonts.ready;
            }
            return Promise.resolve();
        }

        // 2026-06-25 — Hero text must "come together literally the millisecond
        // before the drawing animation ends" (user). So instead of appearing at
        // 55% and sitting fully-formed for ~2.2s while the line-art keeps
        // 2026-06-25 — FIXED START TIMING: text begins 2.5s into the animation
        // even if the drawing is still going, so the reader isn't staring at a
        // blank screen for 6+ seconds. The cascade span is unchanged (1420ms
        // from stagger + transition), but instead of being end-anchored to the
        // 8042ms animation finish, it starts early and plays over the drawing.
        const HERO_REVEAL_SPAN_MS = 420 + 1000; // max stagger + transition (kept for clarity)
        const HERO_TEXT_DELAY_MS = 2500; // Start text 2.5s in, even if drawing still going

        // iOS backdrop-filter activation kick for the hero glass. See the call
        // site in startHeroSequence() for the full rationale. Forces WebKit/iOS
        // to RE-SAMPLE the backdrop behind the hero glass cards (which it does
        // not do on load without a scroll), so the frost actually appears on
        // iPhone instead of rendering as a flat panel. Non-destructive: the blur
        // nudge is imperceptible (20px↔21px) and the scroll nudge is 1px at the
        // very top of the page.
        function kickHeroGlass() {
            const els = [document.querySelector('.hero-sub'),
                         document.querySelector('.hero-meta')];
            els.forEach(el => {
                if (!el) return;
                // A real filter-value change forces iOS to recompute the backdrop.
                el.style.webkitBackdropFilter = 'saturate(180%) blur(21px)';
                el.style.backdropFilter = 'saturate(180%) blur(21px)';
                // force a reflow so the nudge takes effect as its own frame
                void el.offsetHeight;
                requestAnimationFrame(() => {
                    // clear inline → fall back to the CSS value (blur 20px); the
                    // change re-triggers a backdrop recompute, now sampling the
                    // painted drawing.
                    el.style.webkitBackdropFilter = '';
                    el.style.backdropFilter = '';
                });
            });
            // Scroll-repaint nudge: only at the very top, invisible 1px bounce,
            // mirrors the scroll that makes the lower cards' glass activate.
            if (window.scrollY === 0) {
                window.scrollTo(0, 1);
                requestAnimationFrame(() => window.scrollTo(0, 0));
            }
        }

        // ===== 2026-08-08e — PHONES DO NOT DEPEND ON VIDEO AUTOPLAY =====
        // Reported repeatedly: on iPhone the drawing "freezes and requires a
        // click". That is the OS refusing programmatic video playback (Low
        // Power Mode / Reduce Motion / Auto-Play Video off) — every retry a
        // script can make is refused too, so no amount of poll tuning fixes
        // it. Animated IMAGES carry no such policy: they run unconditionally,
        // with no gesture. On touch devices the hero therefore uses the
        // animated WebP of the same drawing as its PRIMARY source and the
        // <video> is never asked to play.
        //
        // The URL also lost its `?v=` + Date.now() cache-buster, which was
        // defeating a year-long immutable cache and re-downloading 1.2 MB on
        // EVERY page open — on cellular that alone reads as a frozen hero.
        const HERO_ANIM_WEBP = 'https://mountzara.com/media/hero-animation-lite-v1.webp';
        const HERO_LAST_FRAME = 'https://mountzara.com/media/hero-last-frame-v3.webp';
        const HERO_TOUCH = (window.matchMedia
            && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
            || (navigator.maxTouchPoints || 0) > 0;
        // start the download immediately on touch so the loader has something
        // to wait for and the swap paints instantly
        let heroWebpPreload = null;
        if (HERO_TOUCH) {
            try {
                if (HERO_TOUCH) {           // image IS the hero on touch
                    heroWebpPreload = new Image(); heroWebpPreload.src = HERO_ANIM_WEBP;
                } else {
                    // desktop fallback warmer: bytes only, no 400MP decode
                    fetch(HERO_ANIM_WEBP, { cache: 'force-cache' }).catch(() => {});
                }
            } catch (e) {}
        }
        function swapHeroToAnimatedWebp() {
            const live = document.getElementById('heroVideo');
            if (!live || live.tagName !== 'VIDEO' || live.dataset.heroEnded === '1') return;
            const img = document.createElement('img');
            img.className = live.className;
            img.id = live.id;
            img.alt = '';
            img.decoding = 'async';
            img.src = HERO_ANIM_WEBP;
            if (live.parentNode) live.parentNode.replaceChild(img, live);
            // settle on the final frame and start Ken Burns, mirroring the
            // video 'ended' path
            setTimeout(() => {
                const cur = document.getElementById('heroVideo');
                if (!cur || cur.tagName !== 'IMG') return;
                cur.src = HERO_LAST_FRAME;
                cur.classList.add('ken-burns');
                cur.dataset.heroEnded = '1';
            }, 8400);
        }

        // The hero text cascade, callable on its own. The early bootstrap
        // starts the drawing before this script exists, so the cascade needs
        // to be runnable without going through the video branch.
        function runHeroTextCascade() {
            // 2026-08-09b — the early bootstrap in index.html is the ONLY
            // owner of the opening choreography (two racing writers produced
            // the half-revealed state in the user's recording: monogram up at
            // 3.5s, headline at 12s). This late-script path exists solely as
            // a safety net for the no-bootstrap case.
            if (window.__mzHeroStarted || window.__mzHeroTextRan) return;
            window.__mzHeroTextRan = true;
            const hc = document.querySelector('.hero-content-delayed');
            if (hc) hc.classList.add('visible');
            setTimeout(() => {
                const titleEl = document.querySelector('.hero-title');
                if (titleEl) titleEl.classList.add('in');
            }, 900);
        }

        function startHeroSequence() {
            if (!heroVideo || !heroContent) return;
            heroVideo.classList.add('playing');
            // the early bootstrap above already started the drawing; this
            // function now only runs the text cascade and the settle logic
            if (window.__mzHeroStarted) {
                runHeroTextCascade();
                return;
            }
            // Touch device: go straight to the animated image. No play(), no
            // retry poll, no dependence on an autoplay permission we cannot
            // win. The text cascade below is unchanged.
            if (HERO_TOUCH) {
                swapHeroToAnimatedWebp();
            }
            // Legacy <img data-src=...> branch retained for forward
            // compatibility — currently a no-op (hero is now <video>).
            const url = heroVideo.dataset.src;
            if (url) {
                heroVideo.src = url;
            }
            // 2026-05-27 v4 — video plays smoothly with H.264 (the previous
            // <video> attempt failed because WebM was first and Safari
            // software-decoded VP9 slowly, missing the autoplay window).
            // If play() truly rejects (autoplay blocked on user's browser),
            // swap to <img src=hero-animation-lite-v1.webp> so they never see a
            // play button overlay. The WebP at full 1920x1080 is the
            // bulletproof fallback that worked in v3.
            if (heroVideo.tagName === 'VIDEO' && !HERO_TOUCH) {
                heroVideo.muted = true;
                heroVideo.defaultMuted = true;
                heroVideo.playsInline = true;
                heroVideo.setAttribute('webkit-playsinline', 'true');
                // 2026-05-27 — REWIND TO FRAME 1 before play(). Even with
                // the autoplay attribute removed, some browsers may have
                // started preload-decoding and advanced currentTime. We
                // force currentTime=0 so the drawing animation always
                // starts from the beginning at the exact moment the
                // loader fades out — not somewhere in the middle.
                try { heroVideo.pause(); } catch (e) {}
                try { heroVideo.currentTime = 0; } catch (e) {}
                // Pause on the final frame when the drawing animation completes,
                // so it settles like the original single-shot WebP instead of
                // looping. Flag it finished so the interaction-recovery handler
                // never restarts it (that restart was the "keeps replaying after
                // it's done" bug).
                heroVideo.addEventListener('ended', () => {
                    if (Number.isFinite(heroVideo.duration)) {
                        heroVideo.currentTime = Math.max(0, heroVideo.duration - 0.04);
                    }
                    heroVideo.pause();
                    heroVideo.dataset.heroEnded = '1';
                    // Start Ken Burns at the TRUE settle moment (the frame the
                    // drawing actually finished on), not on a fixed timer that
                    // can drift from the real video length.
                    heroVideo.classList.add('ken-burns');
                    // 2026-07-22 PERF — a settled <video> is still a live,
                    // full-viewport, screen-blended video layer that the
                    // compositor pays for on EVERY scrolled frame (desktop
                    // "drag reveal" jank). 1.4s after the drawing completes,
                    // swap it for the static last-frame image (same id +
                    // classes, so blend/filter/Ken-Burns CSS carry over and
                    // the look is pixel-identical — it's the frame the video
                    // stopped on). Image layers are far cheaper to composite.
                    setTimeout(() => { try { swapHeroToPoster(); } catch (e) {} }, 1400);
                }, { once: true });
                // 2026-06-25 — Static last-frame poster fallback ONLY on a
                // genuine media load FAILURE — never on a blocked or slow
                // autoplay. The previous code swapped to this poster whenever
                // play() rejected OR the video had not advanced 0.3s within
                // 900ms; on perfectly healthy browsers that fired on a slightly
                // slow start and replaced the <video> with the COMPLETED drawing
                // image, so the user saw the finished art with no animation
                // ("the animation does not animate, it already appears"). A
                // merely-blocked autoplay is instead recovered on first
                // interaction by recoverPausedVideos, which leaves the video at
                // frame 1 (not the final frame) until then. Only a real
                // decode/network error warrants the static image.
                let heroPosterSwapped = false;
                function swapHeroToPoster() {
                    const live = document.getElementById('heroVideo');
                    if (heroPosterSwapped || !live || live.tagName !== 'VIDEO') return;
                    heroPosterSwapped = true;
                    const fallback = document.createElement('img');
                    fallback.className = live.className;
                    fallback.id = live.id;
                    fallback.alt = '';
                    fallback.decoding = 'async';
                    // v3 (2026-08-11): lossless WebP built from the VIDEO'S OWN rendered
                    // pixels at the settle frame (duration - 0.04s), captured in WebKit.
                    // v2 was extracted from the source art and rendered measurably
                    // brighter than the video (the mp4 carries bt2020/smpte2084 tags, so
                    // Safari tone-maps it; a plain sRGB still can't match by math alone).
                    // The owner saw the settle shift color and wants the video's purple
                    // kept — measured video-vs-v3 diff in WebKit: 0 (was max 28/255).
                    fallback.src = 'https://mountzara.com/media/hero-last-frame-v3.webp';
                    if (live.parentNode) live.parentNode.replaceChild(fallback, live);
                }
                // Fires only when ALL <source> candidates fail to load.
                heroVideo.addEventListener('error', () => {
                    // 2026-08-09 — a failed video used to swap in the FINISHED
                    // drawing instantly (observed on production when a cached
                    // entry errored): the one path left that skipped "the
                    // drawing plays". The animated image draws itself and then
                    // settles, so the sequence holds even on media failure.
                    try { swapHeroToAnimatedWebp(); } catch (e) { swapHeroToPoster(); }
                });
                // Kick off playback. A blocked autoplay leaves the video paused
                // at frame 1; recoverPausedVideos retries it on the first
                // tap/scroll. We deliberately do NOT swap to the poster here.
                const playPromise = heroVideo.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    // 2026-08-08b — USE the rejection instead of swallowing it.
                    // A refused autoplay rejects within milliseconds, but the
                    // poll below needed ~1.1s of strikes to notice, so a frozen
                    // first frame sat on screen that whole time (measured).
                    // A rejection can also be a transient AbortError from the
                    // pause -> seek -> play sequence, so retry once and only
                    // fall back if the drawing genuinely has not moved.
                    playPromise.catch(() => {
                        try { new Image().src = HERO_ANIM_WEBP; } catch (e) {}
                        retryHeroPlay();
                        setTimeout(() => {
                            const v = document.getElementById('heroVideo');
                            if (v && v.tagName === 'VIDEO' && v.dataset.heroEnded !== '1'
                                && (v.paused || v.currentTime <= 0.04)) {
                                swapHeroToAnimatedWebp();
                            }
                        }, 400);
                    });
                }
                // 2026-07-13 — Reliability net: that single play() rejects
                // silently if it lost the user-activation window or fired a beat
                // before the media was decodable, leaving the hero blank at frame
                // 1 until a tap (a "no animation" report we could not reproduce
                // server-side). Retry play() the instant the video is actually
                // ready (canplay/loadeddata) and whenever the tab returns to the
                // foreground — a muted+playsinline video is permitted to start in
                // all three cases, so this recovers an early/blocked start WITHOUT
                // waiting for user interaction. Strictly additive: the `!v.paused`
                // guard means it never runs against a video that is already
                // advancing, so healthy playback and the deliberate
                // start-after-loader timing are untouched.
                const retryHeroPlay = () => {
                    const v = document.getElementById('heroVideo');
                    if (!v || v.tagName !== 'VIDEO' || !v.paused) return;
                    // NEVER restart a FINISHED hero. The 'ended' handler seeks
                    // to the final frame, which itself fires 'canplay' — without
                    // this guard that event re-entered here, play() wrapped the
                    // clip to 0, and the 8s drawing replayed in an endless loop
                    // (2026-07-22 regression). Mid-play resumes (tab switch)
                    // still work: heroEnded is only set at the true end.
                    if (v.dataset.heroEnded === '1') return;
                    const pr = v.play();
                    if (pr && typeof pr.catch === 'function') pr.catch(() => {});
                };
                heroVideo.addEventListener('canplay', retryHeroPlay);
                heroVideo.addEventListener('loadeddata', retryHeroPlay);
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) retryHeroPlay();
                });
                // 2026-07-22 — DETERMINED AUTO-START. The event-based retries
                // above have a hole: on a repeat visit the media is fully
                // cached, so canplay/loadeddata fired BEFORE these listeners
                // attached and never fire again — if the single play() above
                // rejected (iOS pause→seek→play race), the drawing froze at
                // frame 1 until a tap ("animation only works when I click").
                // A muted playsinline video may legally start WITHOUT user
                // interaction at any time, so poll briefly until playback
                // actually advances, then stop. Bounded (20 × 300ms) and
                // self-cancelling on success, finish, or poster swap.
                // 2026-07-22b — if the poll can't get the video moving within
                // ~2.4s, the OS itself is refusing video autoplay (iOS Low
                // Power Mode, Reduce Motion, or Auto-Play Video Previews off —
                // all block EVERY programmatic play(), retries included).
                // Animated IMAGES are exempt from those policies, so we swap
                // to the animated WebP of the same drawing (v3's bulletproof
                // path): it plays unconditionally, no tap required. At the
                // ~8s mark it settles onto the static final frame and Ken
                // Burns starts — mirroring the video 'ended' path exactly.
                // HERO_ANIM_WEBP / swapHeroToAnimatedWebp now live at top level
                // (see above startHeroSequence) so the touch path can use them
                // without going through the video branch at all.
                // 2026-08-08b — MEASURED ON FILM: with autoplay refused the hero
                // sat frozen on frame 1 for many seconds before the animated
                // WebP took over, which is exactly the "animation is off" the
                // reader sees. Strikes now start the swap after ~0.9s of
                // ready-but-not-advancing, and the WebP is warmed on the FIRST
                // strike so the swap paints immediately.
                // ===== 2026-08-08f — STALL WATCHDOG (reproduced defect) =====
                // The auto-start poll below stops the moment playback begins.
                // If anything pauses the drawing AFTER that — Low Power Mode
                // engaging mid-play, a decode stall, the tab backgrounding, a
                // cellular buffer starving — nothing was watching, so the hero
                // sat frozen at that frame until the reader tapped the page.
                // That is exactly the "freezes, requires me to click" report,
                // and it is a hole in this code, not a device policy: it
                // reproduces on a normal desktop browser by pausing the video
                // at t=1.2s (it then stayed at 1.2s indefinitely).
                // This watchdog runs for the whole drawing: if currentTime
                // stops advancing while the clip is unfinished, resume it; if
                // resuming does not take, fall back to the animated image,
                // which needs no permission and cannot stall.
                let lastSeen = -1, stalls = 0;
                const stallWatch = setInterval(() => {
                    const v = document.getElementById('heroVideo');
                    if (!v || v.tagName !== 'VIDEO' || v.dataset.heroEnded === '1') {
                        clearInterval(stallWatch); return;
                    }
                    if (Number.isFinite(v.duration) && v.currentTime >= v.duration - 0.12) {
                        clearInterval(stallWatch); return;      // finished normally
                    }
                    const advanced = v.currentTime > lastSeen + 0.05;
                    lastSeen = Math.max(lastSeen, v.currentTime);
                    if (advanced || v.currentTime <= 0.04) { stalls = 0; return; }
                    stalls++;
                    if (stalls === 1 || stalls === 2) {
                        const pr = v.play();
                        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
                    } else if (stalls >= 3) {
                        clearInterval(stallWatch);
                        swapHeroToAnimatedWebp();
                    }
                }, 500);

                let autoStartTries = 0;  // ticks where media is READY yet refuses to advance
                let autoStartTicks = 0;  // every tick, ready or still buffering
                const autoStartPoll = setInterval(() => {
                    const v = document.getElementById('heroVideo');
                    const done = !v || v.tagName !== 'VIDEO' ||
                        v.dataset.heroEnded === '1' ||
                        (!v.paused && v.currentTime > 0.05);
                    if (done) { clearInterval(autoStartPoll); return; }
                    autoStartTicks++;
                    // 2026-08-08 — a strike against video autoplay only counts
                    // when the media is READY to play (readyState >= 3) yet
                    // still not advancing: that is an OS policy block (Low
                    // Power Mode / Reduce Motion / Auto-Play previews off) and
                    // the animated WebP is the right answer. readyState < 3
                    // just means BUFFERING on a slow network — bailing to the
                    // equally-undownloaded WebP at a flat 2.4s was part of the
                    // cold-cache "all out of timing and sync" bug.
                    if (v.readyState >= 2) autoStartTries++;
                    if (autoStartTries === 1) {
                        // trouble brewing — warm the browser cache so the swap
                        // moments later starts the animation instantly
                        try { new Image().src = HERO_ANIM_WEBP; } catch (e) {}
                    }
                    if (autoStartTries >= 3 || autoStartTicks >= 16) {
                        clearInterval(autoStartPoll);
                        swapHeroToAnimatedWebp();
                        return;
                    }
                    retryHeroPlay();
                }, 300);
            }
            // 2026-08-08 — the text cascade and the Ken-Burns fallback used
            // to run on timers anchored to startHeroSequence(); on a slow
            // network the drawing could still be buffering when they fired
            // ("all out of timing and sync"). Both are now anchored to the
            // moment the animation is ACTUALLY advancing — video playing past
            // frame 1, or the element swapped to an <img> (poster or animated
            // WebP, which starts the instant it attaches) — with a bounded
            // fallback so the text can never be stranded invisible.
            function whenHeroAnimating(cb) {
                let fired = false;
                const fire = () => { if (!fired) { fired = true; cb(); } };
                const iv = setInterval(() => {
                    const cur = document.getElementById('heroVideo');
                    if (!cur || cur.tagName !== 'VIDEO' ||
                        cur.dataset.heroEnded === '1' ||
                        (!cur.paused && cur.currentTime > 0.05)) {
                        clearInterval(iv); fire();
                    }
                }, 120);
                setTimeout(() => { clearInterval(iv); fire(); }, 12000);
            }
            whenHeroAnimating(() => {
            // Cascade hero text in Apple-style — past the animation midpoint
            // so the visual sequence has time to establish before the
            // overlay appears.
            setTimeout(() => {
                heroContent.classList.add('visible');
                // 2026-06-25 — Reveal the hero title's word-stagger in lockstep
                // with the block cascade so ALL text appears together "literally
                // the millisecond before the animation ends" (user request). The
                // title is deliberately NOT revealed at load (excluded from the
                // IntersectionObserver and the fling-proof safety net below), so
                // this is the ONLY place it gets `.in`. The 5 title words stagger
                // 0.05–0.25s and finish ~1350ms after this fires; the block
                // cascade (meta = nth-child 4, +420ms + 1000ms) finishes ~1420ms
                // after — both land at ≈8041ms, 1ms before the 8042ms animation.
                const titleEl = document.querySelector('.hero-title');
                if (titleEl) titleEl.classList.add('in');
                // 2026-06-25 — iOS hero-glass kick. On iPhone, backdrop-filter
                // frequently does NOT activate until a scroll/repaint occurs.
                // The scrolled-to cards (and the pinned pill) get that repaint
                // when the user scrolls to them, so their frost works — but the
                // HERO glass is shown on load with no scroll, so iOS samples an
                // empty/not-yet-painted backdrop and the card renders flat. We
                // force a backdrop re-sample once the drawing has painted by
                // (a) nudging the blur radius on the hero glass (a real filter
                // change forces WebKit to recompute the backdrop) and (b) a 1px
                // scroll nudge (invisible at the top) that triggers the same
                // repaint path the other cards rely on. Runs a few times to
                // catch the video's first painted frames.
                kickHeroGlass();
                setTimeout(kickHeroGlass, 600);
                setTimeout(kickHeroGlass, 1500);
            }, HERO_TEXT_DELAY_MS);
            // Ken Burns after the animation finishes — a mop-up only: the
            // video 'ended' handler and the WebP settle path are the primary
            // triggers; this covers a missed 'ended', timed from the TRUE
            // animation start rather than from startHeroSequence().
            setTimeout(() => {
                const liveHero = document.getElementById('heroVideo');
                if (liveHero) liveHero.classList.add('ken-burns');
            }, ANIMATION_DURATION_MS + 400);
            });
        }

        function hideLoader() {
            if (!pageLoader) return;
            pageLoader.classList.add('hidden');
            setTimeout(() => pageLoader.classList.add('removed'), 800);
        }

        // 2026-08-08 — READINESS-GATED LOADER (user: "allow the progress
        // loading when page opens and loads until entire page is ready to
        // execute — it seems all out of timing and sync"). The previous gate
        // raced fonts against a flat 1600ms timer and NEVER waited on the
        // hero media itself (heroVideo.dataset.src is null on the <video>
        // hero, so preloadImageURL was a no-op). On a cold cache the loader
        // dropped at 1.6s with nothing buffered: play() stalled, the
        // auto-start poll misread the buffering as an OS autoplay block and
        // bailed to the (equally undownloaded) animated WebP, and the text
        // cascade + Ken Burns ran on blind timers — visibly out of sync.
        // Now the loader holds until the hero can actually play through
        // (readyState >= 3 / canplaythrough), fonts get a bounded slot, and
        // a hard cap keeps the worst case well below the old 10s font-gate
        // bug: fast repeat visits get a ~0.7s brand moment, a normal first
        // visit starts in sync and fully dressed at 1–3s, and only truly
        // slow cellular rides the loader to the cap.
        const LOADER_MIN_MS = 700;      // never a subliminal flash
        const FONT_WAIT_CAP_MS = 1200;  // typography may never hold the page
        // 2026-08-08b — MEASURED ON FILM. Waiting for canplaythrough
        // (readyState 4 = the whole clip buffered) held the loader 3.4s on a
        // 1.5 Mbps connection and up to the 6.5s cap on slower ones: the
        // reader stared at a spinner while nothing happened. The drawing only
        // needs its FIRST FRAME to begin; the rest streams while it plays.
        // Gate on readyState >= 2 (HAVE_CURRENT_DATA) with a hard 1.5s cap.
        const HERO_WAIT_CAP_MS = 1500;  // absolute worst-case loader time
        const HERO_READY_STATE = 2;     // HAVE_CURRENT_DATA — first frame decodable
        function delayMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
        function waitForHeroMedia() {
            // On touch the hero IS the animated WebP, so wait for that image.
            if (HERO_TOUCH) {
                if (!heroWebpPreload) return Promise.resolve();
                if (heroWebpPreload.complete) return Promise.resolve();
                return new Promise(resolve => {
                    heroWebpPreload.addEventListener('load', resolve, { once: true });
                    heroWebpPreload.addEventListener('error', resolve, { once: true });
                });
            }
            const v = document.getElementById('heroVideo');
            if (!v || v.tagName !== 'VIDEO' || v.readyState >= HERO_READY_STATE) return Promise.resolve();
            return new Promise(resolve => {
                // interval + events: canplaythrough may already have fired on
                // a cached repeat visit before this listener attaches, and a
                // poster/WebP swap replaces the element entirely — the poll
                // catches every path the events can miss.
                const iv = setInterval(() => {
                    const cur = document.getElementById('heroVideo');
                    if (!cur || cur.tagName !== 'VIDEO' || cur.readyState >= HERO_READY_STATE) {
                        clearInterval(iv); resolve();
                    }
                }, 100);
                v.addEventListener('loadeddata', () => { clearInterval(iv); resolve(); }, { once: true });
                v.addEventListener('error', () => { clearInterval(iv); resolve(); }, { once: true });
            });
        }
        Promise.all([
            Promise.race([waitForHeroMedia(), delayMs(HERO_WAIT_CAP_MS)]),
            Promise.race([waitForFonts(), delayMs(FONT_WAIT_CAP_MS)]),
            delayMs(LOADER_MIN_MS)
        ]).then(() => {
            // ONE CURTAIN OWNER (2026-08-11, owner's spec): when the in-body
            // bootstrap runs it owns the loader and the whole opening — this
            // chain touching hideLoader() raced it and lifted the curtain
            // before the video was buffered. Only the no-bootstrap fallback
            // path may act here.
            if (window.__mzHeroStarted) return;
            hideLoader();
            setTimeout(startHeroSequence, 250);
        });

        // LOW POWER MODE resilience for autoplay videos.
        // iOS Low Power Mode blocks autoplay (the hero and the four
        // .video-preview loops sit paused even though play() was issued).
        // iOS DOES permit play() inside a user-gesture handler even in Low
        // Power Mode, so on the first interaction we retry every paused
        // autoplay video once. Passive + { once:true } so it never costs
        // scroll performance and never fights a deliberate user pause.
        function recoverPausedVideos() {
            document.querySelectorAll('video').forEach(v => {
                const isHero = v.id === 'heroVideo';
                const wantsAutoplay = v.autoplay || isHero ||
                                      v.classList.contains('video-preview');
                if (!wantsAutoplay || !v.paused || v.tagName !== 'VIDEO') return;
                // 2026-08-08 PERF — reels are IO-gated now: never wake a
                // preview that is far offscreen (its IO pauses it on exit; a
                // first-gesture play here would immediately fight that and
                // restart the download the preload=none change deferred).
                if (v.classList.contains('video-preview')) {
                    const r = v.getBoundingClientRect();
                    if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) return;
                }
                // Never RESTART the hero once it has played: if it finished
                // (flagged in the 'ended' handler) or already advanced past
                // frame 1, calling play() on a finished clip seeks it back to 0
                // and replays the whole 8s drawing on the first post-animation
                // scroll/tap (user: "the animation keeps replaying"). Only kick
                // it when it genuinely never started (autoplay was blocked).
                if (isHero && (v.dataset.heroEnded === '1' || v.currentTime > 0.3)) return;
                const p = v.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            });
        }
        ['touchstart', 'pointerdown', 'click', 'scroll', 'keydown'].forEach(ev =>
            window.addEventListener(ev, recoverPausedVideos, { once: true, passive: true }));

        // 2026-08-08 PERF — pause the infinite decorative animations (reel
        // waveforms, AI-badge pulse rings) while off-screen. NOT an
        // IntersectionObserver: the carousel init clones/moves cards after
        // load, so per-element observers end up tracking stale nodes and
        // clones inherit a baked-in class (verified: badge in-viewport but
        // still flagged). A throttled scroll sampler over a fresh
        // querySelectorAll always sees the live DOM; ~26 rect reads at most
        // 4x/second is negligible.
        (function () {
            let animTick = 0;
            function sampleAnimVisibility() {
                const now = performance.now();
                if (now - animTick < 250) return;
                animTick = now;
                const vh = window.innerHeight;
                document.querySelectorAll('.rl-wave, .ai-badge').forEach((el) => {
                    const r = el.getBoundingClientRect();
                    const off = r.bottom < -vh * 0.25 || r.top > vh * 1.25;
                    el.classList.toggle('mz-offscreen', off);
                });
            }
            window.addEventListener('scroll', () => requestAnimationFrame(sampleAnimVisibility), { passive: true });
            window.addEventListener('resize', () => requestAnimationFrame(sampleAnimVisibility), { passive: true });
            setTimeout(sampleAnimVisibility, 1200);
            setTimeout(sampleAnimVisibility, 4000);
        })();

        // Fade out persistent bg after user scrolls past the pinned showcase
        if (heroBgStage) {
            const pinnedShowcase = document.querySelector('.pinned-showcase');
            const fadeTrigger = () => {
                const trigger = pinnedShowcase
                    ? pinnedShowcase.offsetTop + pinnedShowcase.offsetHeight - window.innerHeight * 0.5
                    : window.innerHeight * 3;
                if (window.scrollY > trigger) {
                    heroBgStage.classList.add('faded');
                } else {
                    heroBgStage.classList.remove('faded');
                }
            };
            window.addEventListener('scroll', fadeTrigger, { passive: true });
            fadeTrigger();
        }

        // Contact modal
        const contactModalEl = document.getElementById('contactModal');
        function openContactModal() {
            window.__mzPrevFocus = document.activeElement;
            contactModalEl.classList.add('open');
            document.body.style.overflow = 'hidden';
            const btn = contactModalEl.querySelector('.contact-modal-close');
            if (btn) btn.focus();
        }
        function closeContactModal() {
            contactModalEl.classList.remove('open');
            document.body.style.overflow = '';
            if (window.__mzPrevFocus && document.contains(window.__mzPrevFocus)) window.__mzPrevFocus.focus();
            window.__mzPrevFocus = null;
        }
        contactModalEl.addEventListener('click', e => {
            if (e.target === contactModalEl) closeContactModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && contactModalEl.classList.contains('open')) closeContactModal();
        });

        async function copyEmail() {
            const email = document.getElementById('contactEmail').textContent.trim();
            const btn = document.getElementById('copyEmailBtn');
            const label = btn.querySelector('.copy-label');
            try {
                await navigator.clipboard.writeText(email);
            } catch {
                const t = document.createElement('textarea');
                t.value = email;
                document.body.appendChild(t);
                t.select();
                try { document.execCommand('copy'); } catch {}
                document.body.removeChild(t);
            }
            btn.classList.add('copied');
            label.textContent = 'Copied';
            setTimeout(() => {
                btn.classList.remove('copied');
                label.textContent = 'Copy';
            }, 1800);
        }

        function toggleResearch(button) {
            const item = button.parentElement;
            item.classList.toggle('open');
        }

        function toggleMenu() {
            const panel = document.getElementById('navLinks');
            const open = panel.classList.toggle('open');
            const btn = document.querySelector('.mobile-toggle');
            if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        // ----------------------------------------------------------
        // Desktop "More" group (2026-08-20)
        // ----------------------------------------------------------
        // The menu itself opens purely in CSS, on :hover and on
        // :focus-within, so it works with JS disabled and is reachable by
        // keyboard without a keydown handler. What CSS cannot do is keep
        // aria-expanded truthful, and a button that permanently announces
        // "collapsed" while its menu is on screen is worse for a screen
        // reader than no attribute at all. This mirrors the real state.
        //
        // The click handler exists for pointers that are neither hover nor
        // keyboard — a trackpad user who taps rather than dwells, and touch
        // laptops — where hover fires and immediately cancels.
        (function initNavMore() {
            const group = document.querySelector('.nav-more');
            if (!group) return;
            const btn = group.querySelector('.nav-more-btn');
            if (!btn) return;
            const sync = (state) => btn.setAttribute('aria-expanded', state ? 'true' : 'false');

            group.addEventListener('mouseenter', () => sync(true));
            group.addEventListener('mouseleave', () => { if (!group.contains(document.activeElement)) sync(false); });
            group.addEventListener('focusin', () => sync(true));
            group.addEventListener('focusout', () => {
                // focusout fires before the new element receives focus, so
                // defer the check or every arrow-down through the menu would
                // read as a close.
                setTimeout(() => { if (!group.contains(document.activeElement)) sync(false); }, 0);
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const nowOpen = group.classList.toggle('open');
                sync(nowOpen);
            });
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                group.classList.remove('open');
                sync(false);
            });
            document.addEventListener('click', (e) => {
                if (group.contains(e.target)) return;
                group.classList.remove('open');
                sync(false);
            });
        })();

        // Close mobile menu when link clicked. This covers the links inside
        // the flattened "More" sub-list too — they are descendants of
        // .nav-links, so leaving the panel open after a jump would hide the
        // section the user just navigated to behind the panel.
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.addEventListener('click', () => {
                document.getElementById('navLinks').classList.remove('open');
                const btn = document.querySelector('.mobile-toggle');
                if (btn) btn.setAttribute('aria-expanded', 'false');
            });
        });

        // Cache-key rotation 2026-08-20a: the first deploy of this file hit a
        // poisoned CDN edge (the previous body served under the new ?v= key).
        // scripts/deploy-prod.sh detects that and requires a fresh key rather
        // than letting a stale bundle sit behind a correct-looking hash.
        // ==========================================================
        // Reading sheet — relocate long copy out of the scan layer
        // ==========================================================
        // The homepage carries roughly 4,000 words. Most of it is good
        // writing in the wrong place: paragraphs set at 15px inside a
        // four-up card grid, where the measure is short, the leading is
        // tight and the reader is trying to SCAN, not read.
        //
        // This lifts any element marked [data-read] out of its card and
        // into #mz-read, where prose gets the room it needs. The card keeps
        // its illustration, its headline and its one-line proof, and gains
        // a "Read more" control.
        //
        // Deliberate properties:
        //   * The copy stays authored in the page HTML. It is moved at
        //     runtime, not fetched, so it is present for crawlers, for
        //     Reader Mode, and for anyone with JS disabled — who simply
        //     sees the original card with the paragraph still in it.
        //   * Nothing is deleted. innerHTML is preserved verbatim,
        //     including links and citation markers.
        //   * <dialog> does the focus trap, the ESC handling and the
        //     inert-background work; hand-rolling those is where the other
        //     modals on this page accumulated their bugs.
        (function initReadingSheet() {
            const dlg = document.getElementById('mz-read');
            if (!dlg) return;
            const elTitle = document.getElementById('mz-read-title');
            const elEyebrow = document.getElementById('mz-read-eyebrow');
            const elBody = document.getElementById('mz-read-body');
            const scroll = dlg.querySelector('.mz-read-scroll');

            const blocks = document.querySelectorAll('[data-read]');
            if (!blocks.length) return;

            // Group by host card so a card with two paragraphs gets one
            // button, not two.
            const hosts = new Map();
            blocks.forEach(node => {
                const host = node.closest('[data-read-title]');
                if (!host) return;              // unhosted: leave it on the page
                if (!hosts.has(host)) hosts.set(host, []);
                hosts.get(host).push(node);
            });

            hosts.forEach((nodes, host) => {
                const html = nodes.map(n => n.outerHTML).join('');
                nodes.forEach(n => n.remove());

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mz-read-btn';
                btn.setAttribute('aria-haspopup', 'dialog');
                btn.innerHTML = (host.getAttribute('data-read-cta') || 'Read more') +
                                '<span aria-hidden="true">\u2192</span>';
                host.appendChild(btn);

                btn.addEventListener('click', (e) => {
                    // Cards are sometimes themselves clickable (role=button,
                    // or an <a>). Do not let the card's own handler fire too.
                    e.preventDefault();
                    e.stopPropagation();
                    elTitle.textContent = host.getAttribute('data-read-title') || '';
                    const eyebrow = host.getAttribute('data-read-eyebrow') || '';
                    elEyebrow.textContent = eyebrow;
                    elEyebrow.hidden = !eyebrow;
                    elBody.innerHTML = html;
                    if (scroll) scroll.scrollTop = 0;
                    if (typeof dlg.showModal === 'function') dlg.showModal();
                    else dlg.setAttribute('open', '');
                    document.body.style.overflow = 'hidden';
                });
            });

            const close = () => {
                if (typeof dlg.close === 'function' && dlg.open) dlg.close();
                else dlg.removeAttribute('open');
            };
            dlg.querySelector('[data-mz-read-close]')?.addEventListener('click', close);
            // Backdrop click. A <dialog>'s click target is the dialog itself
            // when the backdrop is hit, so compare against the content box
            // rather than trusting e.target === dlg alone.
            dlg.addEventListener('click', (e) => {
                const box = dlg.getBoundingClientRect();
                const outside = e.clientX < box.left || e.clientX > box.right ||
                                e.clientY < box.top  || e.clientY > box.bottom;
                if (outside) close();
            });
            dlg.addEventListener('close', () => { document.body.style.overflow = ''; });
        })();

        // ==========================================================
        // Evidence + Care Path modal — patient + clinician resource
        // Sections: intro · who · services · what to expect · FAQ · published literature
        // Source: patient-facing portions of the office's integrated OMT protocol
        //   (Sections 4–6 of the master document). Technique sequencing, dosing,
        //   decision algorithms, and billing details are intentionally not published.
        // ==========================================================
        const EVIDENCE = {
            'womens-health': {
                title: 'OMT for Women\'s Health',
                intro: 'For dysmenorrhea, sacral imbalance, and visceral-somatic patterns rooted in the pelvis, the literature increasingly supports defined OMT protocols combining muscle energy, myofascial release, and counterstrain across a structured number of sessions — adjunct to, not replacing, gynecologic management.',
                litLead: 'Across randomized controlled trials and a systematic review, structured osteopathic protocols for primary dysmenorrhea consistently reduce both pain intensity and the number of painful days — and the effect builds across menstrual cycles rather than fading. The strongest signal comes from multi-session courses timed to the pre-menstrual and early-menstrual window. What this means for your care: OMT here is a measurable, repeatable structural layer added to hormonal and anti-inflammatory management — reaching the spinal, sacral, and fascial contributors those medications alone cannot.',
                whoItsFor: 'Women whose menstrual pain, ovulatory pain, low back and sacral pain, or visceral-somatic patterns are not fully addressed by hormonal therapy, NSAIDs, and lifestyle measures alone. Manual osteopathic care is offered as one layer of a fully multimodal plan — your contraceptive or hormonal management, anti-inflammatories, and any procedural or surgical care you may need remain the foundation; the manual work is added to address the structural and neurological substrate those treatments alone cannot reach.',
                servicesIntro: 'A focused selection of evidence-supported osteopathic techniques. The specific combination, sequencing, and dosing are individualized at your first visit after a structured osteopathic structural examination — generalized names below describe the categories of work used in this care path.',
                whatYouOffer: [
                    { name: 'Spinal manipulation at the uterine sympathetic levels', desc: 'Gentle high-velocity, low-amplitude techniques at the lower thoracic and upper lumbar segments where the sympathetic nerves to the uterus originate. Addresses the spinal-cord amplification of menstrual pain signals.' },
                    { name: 'Sacroiliac mobilization', desc: 'Treats sacral torsion and SI joint dysfunction that contribute to menstrual back pain and altered uterosacral-ligament tension. A double-blind randomized trial showed a single bilateral SI manipulation produced immediate, significant menstrual pain reduction with measurable release of the body\'s own serotonin and catecholamines.' },
                    { name: 'Lumbar muscle-energy and articulatory work', desc: 'Restores motion at L1–L2 — the most commonly restricted segment in women with menstrual pain. Uses gentle isometric contractions rather than thrust techniques when preferred.' },
                    { name: 'Pelvic diaphragm release', desc: 'External technique that reduces resting tension in the pelvic floor muscles. Common contributor to ovulatory pain, mid-cycle pelvic heaviness, and post-menstrual achiness.' },
                    { name: 'Iliopsoas and quadratus lumborum release', desc: 'The deep hip flexors and side-back muscles often hold sustained tension that pulls the pelvis into a forward tilt — a frequently missed contributor to lower abdominal and groin pain mimicking visceral pain.' },
                    { name: 'Chapman reflex point treatment', desc: 'Gentle rotary pressure on small lymphatic-reflex points associated with the uterus and ovaries. Reduces sympathetic tone and improves the local lymphatic drainage thought to contribute to congestive symptoms.' },
                    { name: 'Vagal-modulating breathwork', desc: 'A 4-7-8 breathing pattern (4-second inhale, 7-second hold, 8-second exhale) for 5 minutes — taught at the first visit as a home practice. Activates parasympathetic tone through the vagus nerve and reduces the autonomic component of cyclic pain.' }
                ],
                whatToExpect: {
                    before: 'Hydrate well — 16–24 oz of water in the two hours before the visit. Wear loose two-piece clothing (scrubs, leggings, or athletic wear). Take any anti-inflammatory you\'re prescribed 60–90 minutes before. Continue all other medications normally. Empty your bladder right before the visit. Sessions can be performed at any phase of the menstrual cycle; for cyclic dysmenorrhea, sessions are often intentionally timed around the pre-menstrual and early menstrual window for greatest effect.',
                    during: 'Sessions are 30 minutes. You\'ll move between supine, side-lying, and seated positions. Most techniques are gentle — sustained pressure, slow stretches, breath-coordinated mobilization. Spinal manipulation, when used, produces a brief sensation and sometimes an audible pop; pain reduction occurs whether or not a pop is heard. Every technique can be paused or modified — speak up at any point.',
                    after: 'Drink 16+ oz of water within an hour. A 20–30 minute gentle walk supports the lymphatic and visceral gains. Avoid heavy lifting, high-intensity exercise, or new yoga poses for 24 hours. Heat applied to the lower abdomen has shown equivalence to ibuprofen for menstrual pain in head-to-head trials. Mild soreness lasting 24–48 hours is normal — similar to delayed-onset soreness after a new workout.',
                    course: 'For primary dysmenorrhea, the published Ruffini protocol uses five 30-minute sessions across consecutive cycles, with two sessions timed to the pre-menstrual and early menstrual window. Most patients begin to notice change between sessions 3 and 5. Responders move to a brief maintenance phase or care on a per-cycle basis as needed.'
                },
                faqs: [
                    { q: 'How is OMT different from a massage?', a: 'Massage focuses on broad muscle relaxation. OMT is diagnostic and targeted — a structured osteopathic structural examination identifies specific somatic dysfunctions at specific spinal segments and tissue regions, and each technique is selected for the specific finding. Visceral, Chapman, and spinal manipulation work address neurological and fascial layers that massage does not target.' },
                    { q: 'Is OMT the same as chiropractic?', a: 'There is overlap — both use spinal manipulation. The key distinctions: OMT is performed by a fully licensed physician who integrates manipulation into complete medical management, including prescribing, procedures, and surgery when needed, and uses a broader range of techniques (visceral, fascial, cranial, Chapman point) in addition to spinal thrust. Chiropractors specialize in spinal manipulation but do not prescribe medications or perform medical procedures.' },
                    { q: 'Is OMT covered by insurance?', a: 'Yes — OMT is billed under standard CPT codes that most commercial plans, Medicare, and Medicaid cover, when documented with the appropriate diagnoses. The office visit and the manipulation are billed separately. Coverage varies by plan; the office can verify benefits before your first session.' },
                    { q: 'How long until I feel a difference?', a: 'For cyclic menstrual pain, the published five-session protocol showed approximately a 63% reduction in average menstrual pain by the end of the course (Ruffini 2018 RCT). Most patients notice change by the third or fourth session. Soreness during the first one or two sessions is normal and not a reason to discontinue.' },
                    { q: 'Will I still need my other medications?', a: 'Yes — OMT is layered on top of your existing plan, not a replacement. The published trials all combined OMT with standard care (NSAIDs, hormonal therapy as indicated). The published heat-therapy data showing equivalence to ibuprofen still applies; many patients in this care path use NSAIDs strategically (pre-emptive dosing 1–2 days before period onset) and heat therapy at body temperature.' },
                    { q: 'Is OMT safe?', a: 'Yes, with appropriate screening. Published gynecologic OMT trials report no serious adverse events. The most common side effect — mild post-session soreness for 24–48 hours — occurs in 10–25% of sessions. High-velocity techniques are modified or avoided in patients with osteoporosis, suspected pregnancy without confirmation, active anticoagulation, or significant disc disease at the target level. Your medical history is reviewed before any thrust technique.' }
                ],
                studies: [
                    {
                        title: 'Effectiveness of osteopathic treatment in women with primary dysmenorrhea: A randomised controlled trial',
                        authors: 'Pelegrini AHM, Vidal-Robayo MC, Pico-Espinosa OJ, et al.',
                        journal: 'Int J Osteopath Med',
                        year: '2025',
                        pmid: '40325740',
                        finding: 'Recent RCT confirming that a structured osteopathic treatment protocol significantly reduced pain intensity and duration in women with primary dysmenorrhea compared with control — reinforcing a multi-session protocol across menstrual cycles as clinically meaningful.',
                    },
                    {
                        title: 'Osteopathic Manipulative Treatment in Dysmenorrhea: A Systematic Review',
                        authors: 'Donà G, Esposito G, Bortolami V, et al.',
                        journal: 'Healthcare (Basel)',
                        year: '2024',
                        pmid: '38389612',
                        finding: 'Systematic review of OMT for dysmenorrhea finding consistent reductions in pain duration, pain intensity, and analgesic use across multiple studies — a small but growing literature supporting protocolized osteopathic care.',
                    },
                    {
                        title: 'Osteopathic Manipulative Treatment of Primary Dysmenorrhea and Related Factors: A Randomized Controlled Trial',
                        authors: 'Zecchillo D, Acquati A, Aquino A, et al.',
                        journal: 'Int J Med Res Health Sci',
                        year: '2017',
                        pmid: 'Osteopathic Manipulative Treatment of Primary Dysmenorrhea Zecchillo',
                        finding: 'RCT randomizing 72 women to treatment vs. control over three menstrual cycles. Five osteopathic treatments produced statistically significant reductions in pain intensity and number of days in pain — establishing a feasible clinical protocol.',
                    },
                ],
            },
            pregnancy: {
                title: 'OMT in Pregnancy',
                intro: 'Two large randomized controlled trials (Licciardone 2010, Hensel 2015 — the PROMOTE study) and a 2017 systematic review have established that osteopathic manipulative treatment significantly reduces low back and pelvic girdle pain in pregnancy, and slows the functional decline most women experience in the third trimester.',
                litLead: 'Two large obstetrics-journal RCTs (PROMOTE and Licciardone) and a 2017 meta-analysis (Franke) establish that pregnancy-modified OMT slows the back-specific functional decline most women hit in the third trimester and reduces low-back and pelvic-girdle pain — with no serious adverse events across hundreds of enrolled patients. What this means for your care: there is real, high-quality evidence that gentle, position-modified manual care is both safe and effective for the musculoskeletal strain of pregnancy and the residual pelvic-girdle pain of postpartum recovery.',
                whoItsFor: 'Pregnant patients with low back pain, sacroiliac pain, pelvic girdle pain, sciatic symptoms, round-ligament pain, or postural strain — particularly in the second and third trimesters as the pelvis adapts to the growing uterus. Also appropriate for postpartum patients with pubic symphysis dysfunction, sacroiliac instability, and residual pelvic-girdle pain that persists beyond 6 weeks. Pregnancy-modified positioning and a defined safety profile guide every session.',
                servicesIntro: 'Pregnancy-modified osteopathic care. High-velocity techniques at the sacrum and lumbar spine are avoided after roughly 16 weeks; supine positioning is limited after 20 weeks. Deep visceral abdominal work is not performed. The selected techniques below are the safe, evidence-supported pregnancy options.',
                whatYouOffer: [
                    { name: 'Side-lying lumbar and pelvic mobilization', desc: 'Gentle articulatory mobilization in the side-lying position — avoids inferior vena cava compression and is safe in any trimester. Addresses the segmental restriction that drives third-trimester back pain.' },
                    { name: 'Sacroiliac muscle-energy techniques', desc: 'Patient uses her own muscle contractions, against the operator\'s counterforce, to restore SI joint motion. No thrust, no risk to the pregnancy. Highly effective for pelvic-girdle pain.' },
                    { name: 'Pubic symphysis balancing', desc: 'Gentle muscle-energy and balanced ligamentous tension techniques for pubic symphysis dysfunction — common late in pregnancy and a frequent contributor to "walking pain."' },
                    { name: 'Suboccipital and upper-cervical release', desc: 'Reduces tension headaches that often emerge during pregnancy and addresses the postural strain of carrying weight forward. Performed seated or in modified supine.' },
                    { name: 'External pelvic diaphragm release (modified positioning)', desc: 'Gentle external work that reduces pelvic floor tension contributing to perineal pressure and urinary frequency — performed in side-lying for pregnancy comfort and safety.' },
                    { name: 'Counterstrain at tender points', desc: 'Indirect technique that positions the body away from the painful direction and holds for 90 seconds — works with the body rather than against it. Useful for round-ligament and AIIS tender points in pregnancy.' },
                    { name: 'Postpartum sacroiliac and pubic symphysis work', desc: 'For patients with residual pelvic-girdle pain after delivery — the same techniques used in pregnancy, now with the full range of supine positioning restored. Many patients experience meaningful improvement within 2–3 postpartum visits.' }
                ],
                whatToExpect: {
                    before: 'Hydrate well — pregnancy increases fluid needs. Wear loose, comfortable two-piece clothing that accommodates a growing abdomen. Bring a pillow or bolster if you prefer a particular support configuration. Continue your prenatal vitamins and any prescribed medications. If you\'ve been told to limit time on your back, mention it before the session and we\'ll plan positioning accordingly.',
                    during: 'Sessions are 30 minutes. Most work is in the side-lying or modified seated position after 20 weeks. No thrust techniques at the sacrum or lumbar spine after 16 weeks. No deep visceral abdominal work. The PROMOTE trial protocol — seven sessions over nine weeks in the third trimester — is the published reference. Movements are slow and deliberate; you control the pace.',
                    after: 'Drink water. Light walking is encouraged. Avoid prolonged sitting; stand and walk for a few minutes every hour for the rest of the day. Mild soreness for 24–48 hours is normal. Watch for any new bleeding, persistent contractions, or decreased fetal movement — those would warrant immediate evaluation with your OB and are reasons to call the office.',
                    course: 'The PROMOTE protocol used seven sessions over nine weeks beginning in the late second or early third trimester. Sessions may continue weekly until delivery, then resume postpartum at the 4–6 week mark for residual pelvic-girdle pain. The published meta-analysis (Franke 2017) supports moderate-quality evidence for medium-sized improvements in both pain and functional status during and after pregnancy.'
                },
                faqs: [
                    { q: 'Is OMT safe during pregnancy?', a: 'Yes, with pregnancy-modified positioning and a defined safety profile. The PROMOTE trial enrolled 400 third-trimester women without serious adverse events. High-velocity techniques are avoided at the sacrum and lumbar spine after 16 weeks; supine positioning is limited after 20 weeks; deep visceral abdominal work is not performed. These adaptations are standard.' },
                    { q: 'Can it help with sciatica or pelvic-girdle pain?', a: 'Yes — these are exactly the patterns most studied. The PROMOTE and Licciardone trials both targeted back-specific functional decline and pain progression in pregnancy, and both showed significant improvement compared to usual care alone. Side-lying lumbar work and sacroiliac muscle-energy techniques are the primary tools.' },
                    { q: 'Will manipulation cause early labor?', a: 'There is no evidence in any published pregnancy OMT trial that osteopathic treatment is associated with preterm labor or other obstetric complications. The pregnancy-modified techniques used in this care path are specifically designed to avoid mechanical pressure on the uterus.' },
                    { q: 'What if I have a high-risk pregnancy?', a: 'Some high-risk situations — placenta previa, active threatened preterm labor, severe preeclampsia — warrant deferral or a modified plan in close coordination with your OB. The structural exam and pre-session medication review will identify these. You don\'t need to know in advance whether OMT is right for your pregnancy — that\'s part of the initial visit.' },
                    { q: 'When do I start, and how long do sessions last?', a: 'Most pregnancy patients benefit most from sessions starting in the late second or third trimester, when symptoms peak. The PROMOTE protocol used seven sessions over nine weeks. Sessions are 30 minutes. Some patients with earlier-onset back pain begin in the second trimester; the structural exam helps decide.' },
                    { q: 'What about postpartum recovery?', a: 'Postpartum sessions typically begin at the 4–6 week mark, after you\'ve been cleared at your OB postpartum visit. Common targets: residual pubic symphysis or sacroiliac dysfunction, abdominal-wall myofascial pain, postural strain from feeding, and post-cesarean fascial restriction. The 2017 systematic review covers pregnancy and postpartum back pain together.' }
                ],
                studies: [
                    {
                        title: 'Pregnancy Research on Osteopathic Manipulation Optimizing Treatment Effects: A Randomized Controlled Trial (PROMOTE)',
                        authors: 'Hensel KL, Buchanan S, Brown SK, Rodriguez M, Cruser dA.',
                        journal: 'Am J Obstet Gynecol',
                        year: '2015',
                        pmid: '25068560',
                        finding: 'RCT of 400 women in their third trimester randomized to usual care, usual care + OMT, or usual care + placebo ultrasound (seven treatments over nine weeks). OMT produced clinically and statistically significant improvements in pain progression and back-related functional deterioration compared with usual care alone.',
                    },
                    {
                        title: 'Osteopathic manipulative treatment of back pain and related symptoms during pregnancy: a randomized controlled trial',
                        authors: 'Licciardone JC, Buchanan S, Hensel KL, King HH, Fulda KG, Stoll ST.',
                        journal: 'Am J Obstet Gynecol',
                        year: '2010',
                        pmid: '19766977',
                        finding: 'RCT of 144 subjects comparing usual obstetric care, usual care + OMT, and usual care + sham ultrasound. The OMT group experienced significantly less deterioration in back-specific functioning (Roland-Morris Disability Questionnaire) during pregnancy.',
                    },
                    {
                        title: 'Osteopathic manipulative treatment for low back and pelvic girdle pain during and after pregnancy: A systematic review and meta-analysis',
                        authors: 'Franke H, Franke JD, Belz S, Fryer G.',
                        journal: 'J Bodyw Mov Ther',
                        year: '2017',
                        pmid: '29037623',
                        finding: 'Meta-analysis pooling multiple RCTs concluded that moderate-quality evidence supports a medium-sized effect of OMT in decreasing pain and increasing functional status in pregnant and postpartum women with low back pain.',
                    },
                ],
            },
            'post-op': {
                title: 'OMT for Post-Operative Recovery',
                intro: 'Post-operative recovery — particularly after cesarean and laparoscopic gynecologic surgery — involves fascial restrictions, adhesions, and viscerosomatic patterns that linger long after wound healing. The evidence base shows osteopathic manipulative therapy can meaningfully improve quality of life and reduce recurrent pain after surgery.',
                litLead: 'The post-operative evidence is newer but specific: gentle superficial mobilization beginning around postoperative day 14 (the MOVENDOP protocol, Comptour 2025) and a visceral/fascial protocol for recurrent pain after endometriosis excision (Alboni 2024) each show benefit added to standard recovery — within timing rules that protect the surgical repair. The learning here: osteopathic care after gynecologic surgery is about sequencing. What is safe in week one differs from week six, and the literature supports a staged, surgeon-coordinated plan rather than a one-size protocol.',
                whoItsFor: 'Patients recovering from cesarean delivery, laparoscopic gynecologic surgery, endometriosis excision, hysterectomy, or pelvic-floor reconstruction. Especially valuable for: recurrent pelvic pain after endometriosis excision; persistent deep dyspareunia after surgery; abdominal-wall trigger points along the incision; post-cesarean fascial restriction limiting trunk rotation and core engagement; post-laparoscopic shoulder, neck, or diaphragm pain from residual gas insufflation patterns.',
                servicesIntro: 'Postoperative osteopathic care follows a defined timeline. Deep visceral abdominal work and high-velocity techniques in the surgical region are withheld for at least 6 weeks. Superficial abdominal mobilization and scar work can begin from postoperative day 14 with surgeon clearance per the MOVENDOP protocol (Comptour 2025). Suboccipital, thoracic, and upper-extremity work are permissible immediately when desired.',
                whatYouOffer: [
                    { name: 'MOVENDOP-style superficial abdominal mobilization', desc: 'Gentle, surface-level abdominal mobilization beginning ~2 weeks after surgery. Reduces adhesion-related dysfunction and improves quality-of-life scores in published trial data (Comptour, PLoS One 2025) — both pre-operatively and post-operatively.' },
                    { name: 'Surgical scar mobilization', desc: 'Direct myofascial work along the incision and adjacent fascia, beginning once the wound is fully closed. Restores skin glide, reduces adhesion-related pulling sensations, and addresses abdominal-wall trigger points that can develop directly under or beside the scar.' },
                    { name: 'Pelvic diaphragm release for post-surgical hypertonus', desc: 'External technique addressing the protective pelvic floor guarding that develops after pelvic surgery. Reduces deep dyspareunia, pelvic heaviness, and pelvic-floor "freeze" patterns that can persist for months after a procedure.' },
                    { name: 'Diaphragm and rib cage mobilization', desc: 'Particularly useful after laparoscopy — residual carbon-dioxide insufflation patterns can produce referred pain to the shoulders, neck, and posterior diaphragm for weeks. Mobilizing the rib cage and the central tendon of the diaphragm shortens that recovery window.' },
                    { name: 'Broad ligament and visceral mobilization (after 6 weeks)', desc: 'Once full healing is established, gentle visceral mobilization frees the post-surgical fascial restriction and visceral adhesion patterns most associated with recurrent pelvic pain and deep dyspareunia after endometriosis excision (Alboni 2024).' },
                    { name: 'Suboccipital and upper-cervical release', desc: 'Addresses the postural strain of altered movement patterns during recovery and modulates the descending pain-control pathways from the brainstem. Performed in any positioning the patient finds comfortable.' },
                    { name: 'Pre-operative osteopathic optimization (when applicable)', desc: 'For patients planning a known elective gynecologic surgery, a small number of pre-operative sessions optimize fascial mobility and reduce baseline pelvic floor tension. The MOVENDOP protocol established benefit when osteopathic work bracketed surgery on both sides.' },
                    { name: 'Coordinated pelvic floor PT referral', desc: 'OMT is layered on top of, not in place of, pelvic floor physical therapy. Referral and shared planning with a pelvic floor PT — particularly for internal trigger-point work and biofeedback — is standard in the postoperative phase.' }
                ],
                whatToExpect: {
                    before: 'Bring your operative report or know the procedure date and what was done. Hydrate well. Wear two-piece clothing that allows access to your back and abdomen without disturbing incision sites. Continue any prescribed pain medication on its normal schedule. If you have surgical-site concerns (drainage, increasing redness, fever), call the office before the session — the visit may be deferred until those are evaluated.',
                    during: 'Sessions are 30 minutes. Early-recovery sessions (week 2–6 after surgery) focus on accessible regions — suboccipital, thoracic, rib cage, diaphragm — plus superficial abdominal mobilization with full surgeon clearance. Deeper visceral and HVLA work in the surgical region is deferred until ~6 weeks after surgery. The pace is slower and gentler than baseline pelvic pain care — your body is still healing.',
                    after: 'Light walking remains the cornerstone of postoperative recovery — 20–30 minutes after each session supports lymphatic and visceral mobility gains. Hydrate. Avoid heavy lifting or any restriction your surgeon has placed on your activity, regardless of how good the session felt. Mild soreness is normal; significant pain at the surgical site is a reason to call.',
                    course: 'Typical course: weekly sessions for 4–8 weeks beginning in the second postoperative week, then transition to per-symptom care. For patients with recurrent pelvic pain after endometriosis excision, the Alboni 2024 visceral/fascial protocol used 6–8 sessions to produce significant reduction in recurrent pain and deep dyspareunia. The schedule is individualized to your surgery, your recovery, and your surgeon\'s clearance.'
                },
                faqs: [
                    { q: 'When can I start OMT after surgery?', a: 'Accessible regions (neck, upper back, rib cage, diaphragm) can be addressed within the first 1–2 weeks. Superficial abdominal mobilization begins around postoperative day 14 with surgeon clearance. Deep visceral and broad-ligament work, plus any high-velocity techniques in the lumbar or sacral region, are deferred to roughly the 6-week mark. The structural exam at your first visit confirms what\'s appropriate for your specific surgery.' },
                    { q: 'Why am I still in pain months after my surgery?', a: 'Surgical pathology and post-surgical pain are not the same thing. Endometriosis excision removes the disease, but the central sensitization built up before surgery, the protective pelvic floor guarding, the fascial restriction along scar lines, and the abdominal-wall trigger points that develop under the incision can all persist after the disease itself is gone. The 2017 Daraï study of 46 patients with deep colorectal endometriosis — including post-operative patients — showed significant quality-of-life improvement with osteopathic therapy. The Alboni 2024 study specifically addressed recurrent pelvic pain after endometriosis surgery.' },
                    { q: 'Will OMT disrupt my surgical repair?', a: 'No — when performed within the protocol\'s timing rules. High-velocity and deep visceral techniques are withheld until full healing is established (~6 weeks). The MOVENDOP-style gentle superficial mobilization that begins around postoperative day 14 has explicit published evidence of safety and benefit when added to standard postoperative care.' },
                    { q: 'How does this work with pelvic floor PT?', a: 'They\'re complementary, not redundant. Pelvic floor PT directly addresses the internal pelvic floor muscles through internal manual therapy, biofeedback, and dilator work — that\'s the cornerstone of post-surgical recovery for many patients. OMT adds the structural layer above: rib cage, diaphragm, lumbar spine, sacroiliac joints, abdominal wall, scar, and broad ligament. The two are routinely combined.' },
                    { q: 'Can OMT before surgery improve recovery?', a: 'There is published evidence that osteopathic abdominal mobilization performed pre-operatively (in addition to post-operatively) improves quality of life and reduces adhesion-related dysfunction (Comptour MOVENDOP 2025). For planned elective gynecologic surgery, a small number of pre-operative sessions can be incorporated into your overall plan.' }
                ],
                studies: [
                    {
                        title: 'Impact of osteopathic manipulative therapy in patients with deep colorectal endometriosis: A classification based on symptoms and quality of life',
                        authors: 'Daraï C, Deboute O, Zacharopoulou C, Laas E, Canlorbe G, Belghiti J, et al.',
                        journal: 'Gynecol Obstet Fertil Senol',
                        year: '2017',
                        pmid: '28869181',
                        finding: 'Prospective study of 46 patients with colorectal endometriosis. Significant improvement in both physical and mental component summaries of quality of life was observed after a course of osteopathic manipulative therapy, including in post-operative patients.',
                    },
                    {
                        title: 'Osteopathy for Endometriosis and Chronic Pelvic Pain — A Pilot Study',
                        authors: 'Schwerla F, Wirthwein P, Rütz M, Resch KL.',
                        journal: 'Forsch Komplementmed',
                        year: '2016',
                        pmid: '27681520',
                        finding: 'Pilot study of 28 women with chronic pelvic pain and painful pelvic floor muscle tightness — many with post-surgical adhesion patterns. After standardized osteopathic treatment, 17 of 28 reported symptom improvement; among the endometriosis subgroup, 10 of 14 improved.',
                    },
                    {
                        title: 'Osteopathic manipulative treatment in gynecology and obstetrics: A systematic review',
                        authors: 'Ruffini N, D\'Alessandro G, Cardinali L, Frondaroli F, Cerritelli F.',
                        journal: 'Complement Ther Med',
                        year: '2016',
                        pmid: '27261985',
                        finding: 'Systematic review of 24 studies covering 1,840 participants across pregnancy-related back pain, postpartum recovery, dysmenorrhea, perimenopausal symptoms, and pelvic pain. OMT is supported as an adjunct to standard care across multiple recovery contexts.',
                    },
                ],
            },
            'pelvic-pain': {
                title: 'OMT for Pelvic Pain & Endometriosis',
                intro: 'Chronic pelvic pain is multifactorial — viscerosomatic, fascial, and musculoskeletal contributions are common, and endometriosis-associated pain often persists even after surgical excision. Randomized trials, systematic reviews, and clinical literature support manual osteopathic therapy as an adjunct to standard gynecologic care.',
                litLead: 'For chronic pelvic pain and endometriosis-associated pain, randomized trials (Zota 2023, Muñoz-Gómez 2023) and an updated systematic review support OMT as one layer of a multimodal plan — addressing the viscerosomatic, fascial, and musculoskeletal contributors that imaging alone can\'t see, alongside pelvic-floor physical therapy and medical management. What this means for your care: manual osteopathic work targets the structural and neurological substrate of persistent pelvic pain — including pain that lingers after excision surgery — complementing, never replacing, the gynecologic and surgical care that remains the foundation.',
                whoItsFor: 'Women with chronic pelvic pain of any cause: endometriosis, adenomyosis, painful intercourse (dyspareunia, both entry and deep), pelvic floor hypertonicity, vulvodynia and provoked vestibulodynia, persistent pain after endometriosis excision, post-surgical adhesion patterns, abdominal-wall myofascial trigger points, and the centrally-sensitized pain that develops over months or years of unaddressed symptoms. OMT is offered as one layer of a fully multimodal plan — hormonal therapy, neuromodulators, pelvic floor physical therapy, behavioral pain care, and any procedural or surgical work you may need remain the foundation; the manual osteopathic care is added to address the structural and neurological substrate those treatments alone cannot reach.',
                servicesIntro: 'A comprehensive catalogue of evidence-supported osteopathic techniques used in this care path. The specific combination, sequencing, and frequency are individualized after a structured osteopathic structural examination at the first visit — generalized names below describe the categories of work, not the patient-specific plan.',
                whatYouOffer: [
                    { name: 'Spinal manipulation at the sympathetic levels (T12–L2)', desc: 'Gentle high-velocity, low-amplitude techniques at the lower thoracic and upper lumbar segments — where the sympathetic nerves to the uterus, fallopian tubes, and ovaries originate. Reduces the spinal-cord amplification of pelvic pain signals that drives viscerosomatic facilitation in chronic pelvic pain.' },
                    { name: 'Bilateral sacroiliac mobilization', desc: 'Treats sacral torsion and SI joint dysfunction, normalizing the S2–S4 parasympathetic outflow that supplies the bladder, rectum, and pelvic floor. The Molins-Cubero 2014 double-blind RCT showed a single bilateral SI manipulation produced immediate pain reduction with measurable release of the body\'s own serotonin and catecholamines — the body\'s natural pain-reducing chemicals.' },
                    { name: 'Pelvic diaphragm release', desc: 'External technique targeting the levator-ani region. Reduces the resting tension in the pelvic floor muscles that contributes to deep dyspareunia, pelvic heaviness, and the protective "freeze" pattern many patients develop. Works alongside (not in place of) pelvic floor physical therapy.' },
                    { name: 'Broad ligament and visceral mobilization', desc: 'Gentle fascial techniques that free restriction around the uterus, ovaries, and surrounding ligaments — common in endometriosis, post-surgical adhesions, and chronic inflammation. Helps restore the small, normal motions visceral organs make with breathing and movement, which the Muñoz-Gómez 2023 trial linked to significant improvements in endometriosis-specific quality of life.' },
                    { name: 'Iliopsoas and quadratus lumborum release', desc: 'The deep hip flexors and side-back muscles often hold sustained tension in chronic pelvic pain, pulling the pelvis into a forward tilt that shortens and pre-tensions the pelvic floor at rest. Counterstrain and muscle-energy techniques release these without aggravating active pain.' },
                    { name: 'Abdominal wall myofascial work', desc: 'For Carnett-positive trigger points (pain that increases when you lift your head, indicating a muscle-wall source rather than a deeper visceral source). Sustained pressure and myofascial release deactivate trigger points. Refractory points can be supplemented with a trigger-point injection as a separate procedure.' },
                    { name: 'Chapman reflex point treatment', desc: 'Small tender lymphatic-reflex points associated with the female reproductive organs. Gentle rotary pressure for 30–60 seconds per point reduces sympathetic tone and improves the local lymphatic drainage that contributes to pelvic congestion.' },
                    { name: 'Suboccipital and upper cervical work', desc: 'The base of the skull (the OAA region) influences the vagus nerve and the descending pain-modulating pathways from the brainstem. In centrally-sensitized patients, addressing upper cervical tension reduces the supraspinal amplification of pelvic pain.' },
                    { name: 'Vagal-modulating breathwork', desc: 'A 4-7-8 breathing pattern (4-second inhale, 7-second hold, 8-second exhale) for 5 minutes — taught at the first visit as a home practice. Activates parasympathetic tone via the vagus nerve and reduces the autonomic component of chronic pain. Evidence-based replacement for older cranial autonomic techniques.' },
                    { name: 'Coordinated multimodal management', desc: 'OMT is integrated with the full pharmacologic ladder (NSAIDs, neuromodulators, hormonal suppression, vaginal muscle relaxants, H1/H2 antihistamines for mast-cell phenotypes), pelvic floor PT, cognitive-behavioral therapy referral, high-frequency TENS, and procedural escalation pathways (trigger-point injections, botulinum toxin for refractory levator hypertonicity). Surgery remains available when indicated and is fully coordinated with this care path.' }
                ],
                whatToExpect: {
                    before: 'Hydrate well — 16–24 oz of water in the two hours before your appointment. Wear loose two-piece clothing (scrubs, leggings, or athletic wear). Eat a light snack but not a heavy meal. If you take a prescribed NSAID like naproxen or ibuprofen as part of your plan, take it 60–90 minutes before the session for best tolerability. Continue all your other medications normally — your hormonal therapy, nerve-pain medication, muscle relaxants, and antihistamines all work synergistically with the manual care. Empty your bladder right before the visit. Patients with prior pelvic or sexual trauma can request trauma-informed pacing — please mention this before the session so positioning, draping, and consent steps can be adjusted in advance.',
                    during: 'Sessions are 30 minutes. You\'ll move between supine, side-lying, and seated positions. Most techniques are gentle — sustained pressure, slow stretches, breath-coordinated mobilization. Spinal manipulation, when used, produces a brief sensation and sometimes an audible pop, but should not be sharp or painful — if it is, the technique is modified immediately. Speak up at any point: every technique can be paused, adjusted, or substituted. Occasional emotional release during pelvic-region work is recognized and supported — it is not a sign that something is wrong.',
                    after: 'Drink 16+ oz of water within an hour. A 20–30 minute gentle walk supports lymphatic and visceral mobility gains. Avoid heavy lifting, high-intensity exercise, hot yoga, or new Pilates poses for 24 hours. Heat applied to the lower abdomen or sacrum at body temperature works as well as ibuprofen for pelvic pain in a head-to-head trial (Akin, Obstet Gynecol 2001). Mild soreness for 24–48 hours is normal — similar to delayed-onset soreness after a new workout. It is not a sign to stop treatment. Continue your home program between sessions: daily breathwork, high-frequency TENS as prescribed, magnesium glycinate, and heat as needed.',
                    course: 'The published Muñoz-Gómez 2023 endometriosis protocol uses one 30-minute session per week for 8 weeks, with formal pain and quality-of-life reassessment at week 4 and at week 8. Most patients begin to notice meaningful change between sessions 4 and 6. Improvements were sustained at one-month follow-up in the published trial. Responders move to a monthly maintenance phase; non-responders at week 8 escalate per a predefined branch: a GnRH antagonist trial if not yet used, trigger-point injections, botulinum toxin for refractory levator hypertonicity, multidisciplinary pain-center referral, and surgical re-evaluation for selected patients.'
                },
                faqs: [
                    { q: 'Is OMT the same as chiropractic?', a: 'There is overlap — both use spinal manipulation. The key distinctions: OMT is performed by a fully licensed physician (DO or MD with additional training) who integrates manipulation into complete medical management, including prescribing, procedures, and surgery when needed. OMT also uses a broader range of techniques than typical chiropractic — visceral, fascial, cranial, Chapman point, and muscle-energy work in addition to thrust techniques. Chiropractors specialize in spinal manipulation but do not prescribe medications or perform medical procedures. Both have evidence for spinal pain; OMT specifically has randomized-trial evidence in pelvic pain and dysmenorrhea.' },
                    { q: 'Why OMT if I\'m already in pelvic floor PT?', a: 'They\'re complementary, not redundant. PFPT directly addresses the levator-ani and obturator-internus muscles through internal manual therapy, biofeedback, and dilator/down-training — that\'s the cornerstone of treatment, and you stay in PT. OMT adds the layer above: the lower thoracic and upper lumbar spine where the sympathetic nerves to the uterus connect, the sacroiliac joints, the iliopsoas pulling the pelvis forward, the broad-ligament fascia, and the upper cervical region modulating central pain control. FitzGerald 2012 showed a 59% response with PFPT; OMT addresses the upstream contributors PFPT internal work cannot directly reach.' },
                    { q: 'How long until I feel a difference?', a: 'Mild soreness during the first 2–3 sessions is normal and not a reason to stop. Meaningful pain change typically emerges between sessions 4 and 6 (around weeks 4–6 of the 8-week protocol). Full effect is assessed at week 8. In the Muñoz-Gómez 2023 endometriosis trial, improvements were sustained at one-month follow-up.' },
                    { q: 'What if it doesn\'t work?', a: 'About 20–40% of patients are partial- or non-responders to a structured OMT course in the published literature. If you\'re a non-responder at week 8, there are predefined escalation paths: a GnRH antagonist trial if not yet used, trigger-point injections for refractory trigger points, botulinum toxin for resistant pelvic floor hypertonicity, multidisciplinary pain-center referral, and — for selected patients — surgical re-evaluation for new or missed structural disease. You don\'t hit a dead end at week 8; the plan branches.' },
                    { q: 'I had endometriosis excision and I\'m still in pain. Will OMT help?', a: 'Possibly, yes. Excision removes the disease itself but does not address the central sensitization, the protective pelvic floor guarding, the fascial restriction along surgical and adhesion lines, the broad-ligament tension, or the abdominal-wall trigger points that can persist after surgery. The Alboni 2024 study specifically targeted recurrent pelvic pain and deep dyspareunia after endometriosis surgery with a visceral/fascial osteopathic protocol and showed significant reduction in both. The Daraï 2017 study showed significant quality-of-life improvement in post-operative patients with deep colorectal endometriosis.' },
                    { q: 'Is OMT covered by insurance?', a: 'Yes — OMT is billed under standard CPT codes that most commercial plans, Medicare, and Medicaid cover, when documented with the appropriate diagnoses. The office visit and the manipulation are billed separately. Coverage varies by plan; the office can verify benefits before your first session.' },
                    { q: 'Is OMT safe in centrally sensitized patients?', a: 'Yes, with adapted pacing. In centrally sensitized patients with allodynia at treatment sites, sessions begin with the lowest-intensity techniques only — gentle myofascial release and vagal breathwork — and grade up over the protocol. Cognitive-behavioral therapy is integrated early, ideally before starting OMT, when this phenotype is present. Pain flare in the first 24–48 hours occurs in 5–15% of sessions and is managed with the same NSAID, heat, and breathwork used between sessions.' },
                    { q: 'I have a trauma history. Can I still do this?', a: 'Yes — and the care path is designed to accommodate it. Patients with prior pelvic or sexual trauma can request trauma-informed pacing, and we coordinate with pain psychology or CBT before initiating internal-adjacent pelvic work when a trauma history is identified. Treatment sessions can be paused and pacing adjusted at any time. Emotional release during pelvic-region work is recognized as a physiological response, not a sign that something is wrong.' }
                ],
                studies: [
                    {
                        title: 'Effectiveness of a Manual Therapy Protocol in Women with Pelvic Pain Due to Endometriosis: A Randomized Clinical Trial',
                        authors: 'Zota L, Stroescu C, Tomescu LF, et al.',
                        journal: 'J Clin Med',
                        year: '2023',
                        pmid: '37176750',
                        finding: 'RCT of 41 women with endometriosis-associated pelvic pain. The manual therapy group showed significant improvement in pain intensity, perceived powerlessness, lumbar mobility, and physical quality-of-life scores compared with placebo.',
                    },
                    {
                        title: 'The Role of Osteopathic Care in Gynaecology and Obstetrics: An Updated Systematic Review',
                        authors: 'Bagagiolo D, Rosa D, Borrelli F.',
                        journal: 'Healthcare (Basel)',
                        year: '2022',
                        pmid: '36011223',
                        finding: 'Updated systematic review confirming a positive effect of osteopathic care on pregnancy-related pain and a growing body of evidence for benefit in dysmenorrhea, infertility-related conditions, and chronic pelvic pain — including endometriosis-associated pain.',
                    },
                    {
                        title: 'Osteopathic Manipulative Treatment of Chronic Pelvic Pain Due to High-Tone Pelvic Floor Dysfunction',
                        authors: 'Wallace SL, Miller LD, Mishra K.',
                        journal: 'Osteopathic Family Physician',
                        year: '2023',
                        pmid: 'OMT chronic pelvic pain high-tone pelvic floor dysfunction Wallace',
                        finding: 'Clinical review supporting manual therapy as effective treatment for chronic pelvic pain with high-tone pelvic floor dysfunction. Osteopathic physicians are uniquely positioned to identify viscerosomatic reflexes and provide patient-centered manual care.',
                    },
                ],
            },
        };

        const evidenceModalEl = document.getElementById('evidenceModal');
        const evidenceModalTitleEl = document.getElementById('evidenceModalTitle');
        const evidenceModalIntroEl = document.getElementById('evidenceModalIntro');
        const evidenceModalLitLeadEl = document.getElementById('evidenceModalLitLead');
        const evidenceModalStudiesEl = document.getElementById('evidenceModalStudies');
        const evidenceModalCardEl = document.getElementById('evidenceModalCard');

        function pubmedUrl(pmid) {
            // For non-numeric (journal-only) refs, link to a PubMed search
            if (/^\d+$/.test(pmid)) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
            return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(pmid)}`;
        }

        // Helper: simple HTML-escape for user-facing strings
        function _esc(s) {
            return String(s ?? '').replace(/[&<>"']/g, c => (
                { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
            ));
        }
        // Helper: show/hide a section element by id
        function _toggleSection(id, show) {
            const el = document.getElementById(id);
            if (!el) return;
            el.hidden = !show;
        }

        function openEvidenceModal(key) {
            const data = EVIDENCE[key];
            if (!data) return;

            // Title + intro
            evidenceModalTitleEl.textContent = data.title;
            evidenceModalIntroEl.textContent = data.intro;

            // Section: Who this care path is for
            const hasWho = !!data.whoItsFor;
            _toggleSection('evidenceModalWhoSection', hasWho);
            if (hasWho) {
                document.getElementById('evidenceModalWho').textContent = data.whoItsFor;
            }

            // Section: What this care path offers (services grid + optional intro)
            const services = Array.isArray(data.whatYouOffer) ? data.whatYouOffer : [];
            _toggleSection('evidenceModalServicesSection', services.length > 0);
            if (services.length > 0) {
                const introEl = document.getElementById('evidenceModalServicesIntro');
                if (data.servicesIntro) {
                    introEl.textContent = data.servicesIntro;
                    introEl.hidden = false;
                } else {
                    introEl.hidden = true;
                }
                document.getElementById('evidenceModalServices').innerHTML = services.map(s => `
                    <div class="evidence-service-item">
                        <h5 class="evidence-service-name">${_esc(s.name)}</h5>
                        <p class="evidence-service-desc">${_esc(s.desc)}</p>
                    </div>
                `).join('');
            }

            // Section: What to expect (before / during / after + optional course note)
            const expect = data.whatToExpect || null;
            _toggleSection('evidenceModalExpectSection', !!expect);
            if (expect) {
                const cols = [
                    { label: 'Before your session', body: expect.before },
                    { label: 'During the session',   body: expect.during },
                    { label: 'After the session',    body: expect.after  },
                ].filter(c => c.body);
                document.getElementById('evidenceModalExpect').innerHTML = cols.map(c => `
                    <div class="evidence-expect-col">
                        <p class="evidence-expect-col-label">${_esc(c.label)}</p>
                        <p class="evidence-expect-col-body">${_esc(c.body)}</p>
                    </div>
                `).join('');
                const courseEl = document.getElementById('evidenceModalCourse');
                if (expect.course) {
                    courseEl.textContent = expect.course;
                    courseEl.hidden = false;
                } else {
                    courseEl.hidden = true;
                }
            }

            // Section: Common questions
            const faqs = Array.isArray(data.faqs) ? data.faqs : [];
            _toggleSection('evidenceModalFaqSection', faqs.length > 0);
            if (faqs.length > 0) {
                document.getElementById('evidenceModalFaqs').innerHTML = faqs.map(f => `
                    <div class="evidence-faq-item">
                        <p class="evidence-faq-q">${_esc(f.q)}</p>
                        <p class="evidence-faq-a">${_esc(f.a)}</p>
                    </div>
                `).join('');
            }

            // Section: Published literature — promoted to the top of the page,
            // with a per-population lead-in and redesigned, numbered study cards.
            if (data.litLead) {
                evidenceModalLitLeadEl.textContent = data.litLead;
                evidenceModalLitLeadEl.hidden = false;
            } else {
                evidenceModalLitLeadEl.hidden = true;
            }
            const studies = Array.isArray(data.studies) ? data.studies : [];
            evidenceModalStudiesEl.innerHTML = studies.map((s, i) => `
                <article class="evidence-study">
                    <div class="evidence-study-index" aria-hidden="true">${i + 1}</div>
                    <div class="evidence-study-main">
                        <div class="evidence-study-badges">
                            <span class="evidence-study-journal">${_esc(s.journal)}</span>
                            <span class="evidence-study-year">${_esc(s.year)}</span>
                        </div>
                        <h4 class="evidence-study-title">${_esc(s.title)}</h4>
                        <div class="evidence-study-meta"><span>${_esc(s.authors)}</span></div>
                        <p class="evidence-study-finding">${_esc(s.finding)}</p>
                        <a class="evidence-study-link" href="${pubmedUrl(s.pmid)}" target="_blank" rel="noopener noreferrer">
                            View on PubMed
                            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 9l7-7M8 2h4v4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </a>
                    </div>
                </article>
            `).join('');

            evidenceModalEl.classList.add('open');
            evidenceModalEl.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            // Scroll the card to top in case a prior open scrolled it
            if (evidenceModalCardEl) evidenceModalCardEl.scrollTop = 0;
        }
        function closeEvidenceModal() {
            evidenceModalEl.classList.remove('open');
            evidenceModalEl.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
        // Bind evidence modal to population cards
        document.querySelectorAll('.population-card[data-evidence]').forEach(card => {
            card.addEventListener('click', () => {
                const key = card.getAttribute('data-evidence');
                openEvidenceModal(key);
            });
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const key = card.getAttribute('data-evidence');
                    openEvidenceModal(key);
                }
            });
            card.addEventListener('mousemove', e => {
                const r = card.getBoundingClientRect();
                card.style.setProperty('--mx', `${e.clientX - r.left}px`);
                card.style.setProperty('--my', `${e.clientY - r.top}px`);
            });
        });
        // Bind evidence modal to evidence base cards
        document.querySelectorAll('.evidence-card[data-evidence]').forEach(card => {
            card.addEventListener('click', () => {
                const key = card.getAttribute('data-evidence');
                openEvidenceModal(key);
            });
            card.addEventListener('mousemove', e => {
                const r = card.getBoundingClientRect();
                card.style.setProperty('--mx', `${e.clientX - r.left}px`);
                card.style.setProperty('--my', `${e.clientY - r.top}px`);
            });
        });
        document.getElementById('evidenceModalClose')?.addEventListener('click', closeEvidenceModal);
        evidenceModalEl?.addEventListener('click', e => {
            if (e.target === evidenceModalEl) closeEvidenceModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && evidenceModalEl?.classList.contains('open')) closeEvidenceModal();
        });

        // ==========================================================
        // OMT Care-Path Modal — Six-pillar framework / 8-week trajectory /
        // standard-of-care backbone deep-dives, opened from clickable
        // .carepath-card[data-omt-modal="..."] in the OMT section.
        // ==========================================================
        const OMT_MODAL_DATA = {
            philosophy: {
                eyebrow: 'Whole-Person Philosophy',
                title: 'Treating the whole person — body, mind, and structure.',
                intro: 'Four threads weave through every consultation: the osteopathic tenet of body unity, the role of manual therapy in women\'s health, anatomy-grounded surgical planning, and continued mastery of advanced modalities.',
                body: `
                    <div class="pillars-grid">
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">01</span>
                        <h4 class="pillar-title">Whole-Person Care</h4>
                        <p class="pillar-content">The osteopathic tenet &mdash; body, mind, and spirit work as a unit, with structure and function inseparably linked &mdash; shapes every consultation. Symptoms are read against the whole person, not against a single diagnosis label.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">02</span>
                        <h4 class="pillar-title">OMT in Women's Health</h4>
                        <p class="pillar-content">Manual techniques applied to pelvic floor dysfunction, dysmenorrhea, sacral imbalance, post-cesarean adhesions, broad ligament tension, and post-op recovery. OMT complements pharmacologic and surgical care &mdash; it does not replace either.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">03</span>
                        <h4 class="pillar-title">Structural Integration</h4>
                        <p class="pillar-content">An anatomy-fellowship-trained surgeon understands how scar, fascia, and visceral mobility shape surgical outcomes. That structural reading informs operative planning AND post-op rehabilitation, not just the OR.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">04</span>
                        <h4 class="pillar-title">Continued Mastery</h4>
                        <p class="pillar-content">Ongoing training in the Fascial Distortion Model (FDM), Osteopathic Cranial techniques, and the SAAO Convocation. The CBG/MIGS surgeon&rsquo;s manual-therapy toolkit keeps growing.</p>
                      </article>
                    </div>
                `,
            },
            techniques: {
                eyebrow: 'The Techniques',
                title: 'Hands-on, evidence-aligned modalities.',
                intro: 'Trained across the four core osteopathic manipulative techniques. Each one is chosen and combined for the patient in front of me — not by protocol.',
                body: `
                    <div class="pillars-grid">
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">FDM</span>
                        <h4 class="pillar-title">Fascial Distortion Model</h4>
                        <p class="pillar-content">A precise diagnostic and treatment framework targeting six specific fascial distortion patterns &mdash; particularly powerful for acute pain, restricted range of motion, and post-surgical adhesions.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">ME</span>
                        <h4 class="pillar-title">Muscle Energy</h4>
                        <p class="pillar-content">A direct, active technique using the patient&rsquo;s own muscle contractions against precise counterforce &mdash; restoring sacral mechanics, pelvic alignment, and lumbar function safely in pregnancy.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">CS</span>
                        <h4 class="pillar-title">Counterstrain</h4>
                        <p class="pillar-content">An indirect, gentle positional release method ideal for tender points, post-operative bodies, and patients in too much pain for direct techniques &mdash; calming the nervous system as it works.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">MFR</span>
                        <h4 class="pillar-title">Myofascial Release</h4>
                        <p class="pillar-content">Sustained pressure into restrictive fascial patterns &mdash; addressing scar tissue, chronic pelvic floor tension, abdominal wall restrictions, and the visceral-somatic dysfunctions central to pelvic pain.</p>
                      </article>
                    </div>
                `,
            },
            carepath: {
                eyebrow: 'The Care Path',
                title: 'Services &mdash; start to finish.',
                intro: 'A complete walk-through of the osteopathic + CBG/MIGS care offered, from the first consult through surgical recovery &mdash; for patients and the clinicians who refer to them.',
                body: `
                    <div class="pillars-grid">
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">01</span>
                        <h4 class="pillar-title">Who I see</h4>
                        <p class="pillar-content">Patients with cyclic pelvic pain, dysmenorrhea, suspected or biopsy-confirmed endometriosis, fibroids, adenomyosis, post-cesarean scar discomfort, isthmocele, Asherman&rsquo;s syndrome, chronic pelvic pain not yet attributed, fertility patients carrying somatic-dysfunction signs, and patients pursuing pre- or post-operative osteopathic optimization. Adults of all ages; complex cases welcome.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">02</span>
                        <h4 class="pillar-title">Services</h4>
                        <p class="pillar-content">Osteopathic structural evaluation, OMT (muscle energy, myofascial release, counterstrain, balanced ligamentous tension, visceral mobilization, cranial when indicated), minimally-invasive gynecologic surgical consultation (laparoscopic excision of endometriosis, hysteroscopic management of intracavitary pathology, vNOTES, robotic-assisted hysterectomy, fertility-preserving reconstructive work), and the integration of the two &mdash; pre-operative somatic preparation, post-operative recovery support, and longitudinal follow-up.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">03</span>
                        <h4 class="pillar-title">What to Expect</h4>
                        <p class="pillar-content">A first visit runs 60&ndash;90 minutes &mdash; a focused history, full structural exam, discussion of any imaging or prior records, and a clear plan you leave with in writing. OMT-only visits run 30&ndash;45 minutes. Surgical consultations include the diagnostic workup, candid risk/benefit, alternatives, and the recovery picture. Most patients see meaningful change inside 3&ndash;6 visits when an OMT course is indicated; surgical patients get pre-op optimization, day-of communication, and structured post-op follow-up.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">04</span>
                        <h4 class="pillar-title">FAQ</h4>
                        <p class="pillar-content"><strong>Will OMT replace my surgery?</strong> No &mdash; it complements it. OMT addresses the somatic and visceral patterns that surgery alone cannot reach. <strong>Is OMT painful?</strong> Most techniques are gentle; you stay in control of pressure and pace. <strong>Insurance?</strong> OMT codes (98925&ndash;98929) are widely covered; surgical care is billed through standard pathways. <strong>How is this different from PT?</strong> OMT is physician-delivered, diagnostic, and integrates with your medical/surgical plan. <strong>Do you take new patients?</strong> Yes, with referral or self-referral; complex cases get priority scheduling.</p>
                      </article>
                    </div>
                `,
            },
            pillars: {
                eyebrow: 'The Integrated Framework',
                title: 'Six pillars, layered with intent.',
                intro: 'Pelvic pain is rarely one disease. It is a layered, multi-system problem — and the women I see in clinic deserve a treatment plan that is just as layered. Every patient gets all six pillars considered; the osteopathic structural layer does not replace the medical, hormonal, procedural, behavioral, or surgical pathways — it addresses the viscerosomatic substrate the other five cannot reach.',
                body: `
                    <div class="pillars-grid">
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">01</span>
                        <h4 class="pillar-title">Osteopathic Structural Layer</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Viscerosomatic reflex modulation; segmental dorsal-horn inhibition at T10&ndash;L2 and S2&ndash;S4; fascial restriction release; periaqueductal-gray descending inhibition.</p>
                        <p class="pillar-content"><strong>Components.</strong> An 8-week course of OAA HVLA, T12&ndash;L1 HVLA, bilateral sacroiliac HVLA, abdominal visceral mobilization, broad ligament mobilization, external pelvic diaphragm release, 4-7-8 vagal-modulating breathwork, and Chapman reflex point treatment. Cranial CV-4 omitted per the 2017 systematic review showing heterogeneous autonomic effects.</p>
                        <p class="pillar-cite">Mu&ntilde;oz-G&oacute;mez, <em>J Clin Med</em> 2023;12:3310 (RCT, n=41, PMID 37176750) &middot; Molins-Cubero, <em>Pain Med</em> 2014;15(9):1455&ndash;1463 (double-blind RCT, n=40, PMID 24666560) &middot; Ruffini, <em>J Bodyw Mov Ther</em> 2018 (RCT, n=31) &middot; FitzGerald, <em>J Urol</em> 2012;187(6):2113&ndash;2118 (Level I, PMID 22503015).</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">02</span>
                        <h4 class="pillar-title">Pharmacologic Ladder</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Peripheral COX inhibition; central sensitization control via tricyclic and gabapentinoid neuromodulators; smooth-muscle spasm relief; mast-cell-mediated neurogenic inflammation suppression; reversal of atrophic vaginitis.</p>
                        <p class="pillar-content"><strong>Components.</strong> NSAIDs first-line for primary dysmenorrhea (NNT&thinsp;~2&ndash;3). Neuromodulators (amitriptyline, nortriptyline, gabapentin, pregabalin, duloxetine) for centrally sensitized pain. Vaginal diazepam, cyclobenzaprine, baclofen, tizanidine for hypertonic pelvic floor. H1/H2 antihistamines for mast-cell-driven endometriosis pain. Topical lidocaine 5%, compounded creams, vaginal estrogen for vestibular and atrophic surfaces.</p>
                        <p class="pillar-cite">ACOG Practice Bulletin 218 (PMID 32080045) &middot; ACOG CPG 11 Endometriosis 2026 &middot; Marjoribanks, <em>Cochrane Database Syst Rev</em> 2015 (NSAIDs for dysmenorrhoea, CD001751) &middot; Mantha, <em>AJOG Glob Rep</em> 2023;3:100274 (H1 antihistamines).</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">03</span>
                        <h4 class="pillar-title">Hormonal Suppression</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Ovulation suppression; decidualization and atrophy of ectopic implants; endometrial prostaglandin reduction.</p>
                        <p class="pillar-content"><strong>Components.</strong> Continuous combined hormonal contraceptives, norethindrone acetate 5&thinsp;mg, the 52&thinsp;mg LNG-IUD (Mirena/Liletta), DMPA, etonogestrel implant, and oral GnRH antagonists (elagolix; relugolix combination therapy) with estradiol/norethindrone add-back to mitigate bone-mineral-density loss. Long-term combined oral contraceptive use is effective in reducing endometrioma recurrence and reducing dysmenorrhea severity.</p>
                        <p class="pillar-cite">ACOG CPG 11 (2026) &middot; ESHRE guideline 2022 &middot; Elaris EM-I and EM-II trials &middot; Zakhari 2021 (PMID 33020832) &middot; Vercellini 2023 (PMID 36948440).</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">04</span>
                        <h4 class="pillar-title">Procedural Interventions</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Direct mechanical or chemical deactivation of refractory trigger points; sustained neuromuscular relaxation of hypertonic pelvic floor; targeted regional anesthesia.</p>
                        <p class="pillar-content"><strong>Components.</strong> Trigger point injection with bupivacaine&thinsp;0.25% &plusmn; triamcinolone, levator ani injection, abdominal wall TPI at Carnett-positive points, onabotulinumtoxinA 100&ndash;300 units to a refractory levator, pudendal nerve block, and supervised vaginal dilator therapy. Procedures are sequenced behind manual and pharmacologic work, not in front of them.</p>
                        <p class="pillar-cite">FitzGerald, <em>J Urol</em> 2012 (PMID 22503015) &middot; EAU CPP Guidelines &middot; multiple RCTs cited in ACOG PB 218.</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">05</span>
                        <h4 class="pillar-title">Behavioral &amp; Rehabilitative</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Myofascial trigger-point deactivation through pelvic floor physical therapy; pain reappraisal and catastrophizing reduction through cognitive-behavioral therapy; spinal gate-control analgesia via high-frequency TENS.</p>
                        <p class="pillar-content"><strong>Components.</strong> Pelvic floor PT 1&ndash;2x/week for 12&ndash;16 sessions, CBT for chronic pain (telehealth or in-person), sex therapy and couples counseling where indicated, pain psychology, and high-frequency TENS at 80&ndash;100&thinsp;Hz. PFPT addresses the levator and obturator directly; OMT addresses the upstream segmental, fascial, visceral, and autonomic contributors. The two are complementary, not redundant.</p>
                        <p class="pillar-cite">FitzGerald 2012 (Level I, PMID 22503015) &middot; Evans HaPPI RCT, <em>Hum Reprod Open</em> 2026 (telehealth CBT, n=334) &middot; Han, <em>Cochrane Database Syst Rev</em> 2024 (TENS for primary dysmenorrhoea, CD013331, PMID 39037764).</p>
                      </article>
                      <article class="pillar-card frame-card">
                        <span class="pillar-num">06</span>
                        <h4 class="pillar-title">Surgical Pathway</h4>
                        <p class="pillar-mech"><strong>Mechanism.</strong> Excision of structural disease; vestibulectomy where indicated; presacral neurectomy in highly selected cases; definitive management of adenomyosis when reproductive goals are complete.</p>
                        <p class="pillar-content"><strong>Components.</strong> Diagnostic and operative laparoscopy with excision of endometriosis (excision is superior to drainage and ablation for endometriomas), adhesiolysis where adhesions are causing symptoms, hysteroscopic management of intracavitary pathology, vNOTES and robotic-assisted approaches where appropriate, and fertility-preserving reconstructive work. Routine laparoscopic adhesiolysis is <em>not</em> recommended for chronic pelvic pain in isolation.</p>
                        <p class="pillar-cite">ACOG CPG 11 (2026) &middot; Bafort, <em>Cochrane Database Syst Rev</em> 2020 (PMID 33095458) &middot; ACOG PB 218 (PMID 32080045).</p>
                      </article>
                    </div>
                `,
            },
            trajectory: {
                eyebrow: 'The Treatment Trajectory + Standard of Care',
                title: 'An 8-week course, calibrated to what the literature actually shows.',
                intro: 'For endometriosis-associated pelvic pain, non-cyclic chronic pelvic pain, dyspareunia, and myofascial pain, the course is one 30-minute OMT session weekly for 8 weeks. For primary or secondary dysmenorrhea, the course is one session weekly for 5 weeks, with sessions 4 and 5 timed to the pre-menstrual and early menstrual window per Ruffini 2018. Patients are formally re-evaluated at weeks 4, 8, and 12, and meaningful gains typically emerge between sessions 4 and 6 — not session 1. The 8-week course is layered onto, never in place of, the ACOG-anchored standard of care for endometriosis, chronic pelvic pain, and dysmenorrhea (below).',
                body: `
                    <div class="trajectory-rail">
                      <article class="traj-card frame-card">
                        <span class="traj-week">Weeks 1&ndash;3</span>
                        <h4 class="traj-title">Adjustment</h4>
                        <p class="traj-body">Mild post-session soreness for 24&ndash;48&thinsp;h is expected and is the most common adverse event &mdash; similar to delayed-onset muscle soreness after new exercise. Pain scores often look flat. Body is adjusting to manipulation. Focus on home program adherence and on the concurrent pharmacologic, hormonal, and PFPT work that the OMT layer sits on top of.</p>
                      </article>
                      <article class="traj-card frame-card">
                        <span class="traj-week">Week 4</span>
                        <h4 class="traj-title">Mid-Protocol Reassessment</h4>
                        <p class="traj-body">Formal VAS and EHP-30 quality-of-life reassessment. Early responders typically show 10&ndash;20% improvement by this point. Neuromodulator titration is reviewed. Some patients are still flat at week 4 &mdash; the literature shows the inflection point is sessions 4&ndash;6, so this is not the moment to abandon course.</p>
                      </article>
                      <article class="traj-card frame-card">
                        <span class="traj-week">Weeks 6&ndash;8</span>
                        <h4 class="traj-title">Inflection &amp; Endpoint</h4>
                        <p class="traj-body">The majority of patients show 30&ndash;60% VAS reduction and meaningful functional gain at the end of the 8-week protocol. Ruffini 2018 reported a 63% reduction in NRS pain in primary dysmenorrhea. Molins-Cubero 2014 reported immediate significant VAS reduction (p=0.003) after a single bilateral global sacroiliac HVLA. FitzGerald 2012 reported a 59% response rate for pelvic floor myofascial PT versus 26% for global massage in IC/BPS. Full outcome battery is run at week 8.</p>
                      </article>
                      <article class="traj-card frame-card">
                        <span class="traj-week">Week 12</span>
                        <h4 class="traj-title">One-Month Durability</h4>
                        <p class="traj-body">Improvements sustained at one month post-protocol per Mu&ntilde;oz-G&oacute;mez 2023. Responders &mdash; defined as &ge;30% VAS reduction or &ge;10-point EHP-30 improvement &mdash; transition to maintenance OMT monthly for 3 sessions, then as-needed. Non-responders are escalated: GnRH antagonist if not already in use, trigger-point injection series, onabotulinumtoxinA for refractory levator hypertonia, multidisciplinary pain center referral, or surgical re-evaluation.</p>
                      </article>
                    </div>
                    <h4 style="font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:rgba(var(--glow-purple),0.92);margin:28px 0 12px 0">The standard-of-care backbone &mdash; Level A</h4>
                    <div class="soc-grid">
                      <div class="soc-block frame-card">
                        <div class="soc-header"><span class="soc-tag">Endometriosis</span><span class="soc-grade">Level A</span></div>
                        <ul class="soc-list">
                          <li>Transvaginal ultrasonography is the imaging modality of choice when assessing the presence of endometriosis.</li>
                          <li>Medical suppressive therapy improves pain symptoms; recurrence rates remain high after the medication is discontinued.</li>
                          <li>Conservative surgical treatment provides significant short-term pain improvement; recurrence rates are also significant.</li>
                          <li>Medical suppressive therapy (OCs, GnRH agonists) for endometriosis-associated infertility is ineffective.</li>
                          <li>Surgical management of endometriosis-related infertility improves pregnancy rates, though the magnitude is uncertain.</li>
                          <li>Excision of an endometrioma is superior to simple drainage and ablation of the cyst wall.</li>
                          <li>When GnRH-agonist therapy is continued, add-back therapy reduces or eliminates bone loss and hypoestrogenic symptoms without reducing efficacy.</li>
                        </ul>
                        <p class="soc-anchors">Anchored to ACOG Clinical Practice Guideline No. 11 (2026); UpToDate: Endometriosis. Landmark meta-analyses: Vercellini 2023 (PMID 36948440); Guerriero 2018 (PMID 29154402); Bafort 2020 Cochrane (PMID 33095458); Zakhari 2021 (PMID 33020832).</p>
                      </div>
                      <div class="soc-block frame-card">
                        <div class="soc-header"><span class="soc-tag">Chronic Pelvic Pain</span><span class="soc-grade">Level A</span></div>
                        <ul class="soc-list">
                          <li>Routine laparoscopic adhesiolysis is <em>not</em> recommended solely for chronic pelvic pain.</li>
                          <li>Transvaginal ultrasound is first-line imaging for assessing endometriosis as a cause of pelvic pain.</li>
                          <li>Medical suppressive therapy (combined oral contraceptives, progestins, GnRH agonists) improves endometriosis-related pain.</li>
                        </ul>
                        <p class="soc-anchors">Anchored to ACOG Practice Bulletin 218: Chronic Pelvic Pain (PMID 32080045). Recent evidence: Salmeri 2024 on uterine contractility (PMID 39067674); Min 2025 on cesarean-scar niche and pelvic pain (PMID 40680988); Marvi 2022 on mode of delivery and dyspareunia (PMID 34231435).</p>
                      </div>
                      <div class="soc-block frame-card">
                        <div class="soc-header"><span class="soc-tag">Dysmenorrhea</span><span class="soc-grade">Level A</span></div>
                        <ul class="soc-list">
                          <li>NSAIDs are effective first-line treatment for primary dysmenorrhea.</li>
                          <li>Combined hormonal contraceptives effectively treat dysmenorrhea.</li>
                        </ul>
                        <p class="soc-anchors">Anchored to ACOG dysmenorrhea guidance. Systematic-review support: Marjoribanks Cochrane 2015 (NSAIDs, CD001751); Sharghi 2019 (PMID 30521155); Earl 2021 Cochrane (nifedipine, PMID 34921554); Ruffini 2016 systematic review of OMT in gynecology and obstetrics (PMID 27261985).</p>
                      </div>
                    </div>
                `,
            },
            literature: {
                eyebrow: 'Evidence & Literature',
                title: 'Evidence-based care, tailored to each patient.',
                intro: 'Whole-person osteopathic care — structure and function as one — matched to the patient in front of me and grounded in peer-reviewed evidence. Each population below opens its own literature review: what the published studies actually show, and what it means for your care.',
                body: `
                    <div class="populations-grid">
                      <div class="population-card" data-evidence="womens-health" role="button" tabindex="0" aria-label="View Women's Health OMT evidence">
                        <div class="pop-tag">Foundational Care</div>
                        <h4>Women's Health</h4>
                        <p>For dysmenorrhea, sacral imbalance, low back pain, and visceral-somatic patterns rooted in the pelvis. Manual therapy as a complement to gynecologic management &mdash; not a replacement for it.</p>
                        <div class="pop-modalities"><span class="pop-mod">Muscle Energy</span><span class="pop-mod">Myofascial Release</span><span class="pop-mod">Counterstrain</span></div>
                        <span class="pop-evidence-cta">See what the literature and evidence says <span class="arrow">&rarr;</span></span>
                      </div>
                      <div class="population-card" data-evidence="pregnancy" role="button" tabindex="0" aria-label="View Pregnancy OMT evidence">
                        <div class="pop-tag">Antepartum &amp; Postpartum</div>
                        <h4>Pregnant Patients</h4>
                        <p>Safe, gentle techniques for round ligament pain, sacroiliac dysfunction, sciatica, and pubic symphysis discomfort. Indirect approaches preferred during pregnancy; targeted release postpartum to support recovery.</p>
                        <div class="pop-modalities"><span class="pop-mod">Counterstrain</span><span class="pop-mod">Muscle Energy (modified)</span><span class="pop-mod">Myofascial Release</span></div>
                        <span class="pop-evidence-cta">See what the literature and evidence says <span class="arrow">&rarr;</span></span>
                      </div>
                      <div class="population-card" data-evidence="post-op" role="button" tabindex="0" aria-label="View Post-Operative OMT evidence">
                        <div class="pop-tag">Recovery</div>
                        <h4>Post-Operative Patients</h4>
                        <p>Reducing the burden of post-cesarean and post-laparoscopic adhesions, restoring abdominal-wall fascial mobility, and easing the diaphragmatic and visceral patterns that linger after surgery.</p>
                        <div class="pop-modalities"><span class="pop-mod">Myofascial Release</span><span class="pop-mod">FDM</span><span class="pop-mod">Counterstrain</span></div>
                        <span class="pop-evidence-cta">See what the literature and evidence says <span class="arrow">&rarr;</span></span>
                      </div>
                      <div class="population-card" data-evidence="pelvic-pain" role="button" tabindex="0" aria-label="View Pelvic Pain and Endometriosis OMT evidence">
                        <div class="pop-tag">Chronic Pain</div>
                        <h4>Pelvic Pain</h4>
                        <p>For endometriosis, pelvic floor dysfunction, vulvodynia, and post-surgical chronic pain &mdash; addressing the layered fascial, somatic, and viscerosomatic contributors that imaging alone can&rsquo;t see.</p>
                        <div class="pop-modalities"><span class="pop-mod">FDM</span><span class="pop-mod">Myofascial Release</span><span class="pop-mod">Muscle Energy</span><span class="pop-mod">Counterstrain</span></div>
                        <span class="pop-evidence-cta">See what the literature and evidence says <span class="arrow">&rarr;</span></span>
                      </div>
                    </div>
                `,
            },
        };
        const omtModalEl = document.getElementById('omtModal');
        const omtModalEyebrowEl = document.getElementById('omtModalEyebrow');
        const omtModalTitleEl = document.getElementById('omtModalTitle');
        const omtModalIntroEl = document.getElementById('omtModalIntro');
        const omtModalBodyEl = document.getElementById('omtModalBody');
        const omtModalCardEl = document.getElementById('omtModalCard');
        // Attach the evidence-modal click handlers to any .population-card[data-evidence]
        // inside a freshly-rendered modal body (the populations modal injects four
        // population-cards dynamically, so the page-load forEach over those cards
        // misses them). Safe to call repeatedly — re-binding doesn't double-fire.
        function wirePopulationCardsInside(container) {
            if (!container) return;
            container.querySelectorAll('.population-card[data-evidence]').forEach(card => {
                if (card.__mzWired) return;
                const k = card.getAttribute('data-evidence');
                // Stamp a peer-reviewed study count badge from the EVIDENCE data
                // (kept accurate automatically as studies are added/removed).
                const n = (EVIDENCE[k] && Array.isArray(EVIDENCE[k].studies)) ? EVIDENCE[k].studies.length : 0;
                if (n && !card.querySelector('.pop-evidence-count')) {
                    const badge = document.createElement('div');
                    badge.className = 'pop-evidence-count';
                    badge.textContent = n + (n === 1 ? ' peer-reviewed study' : ' peer-reviewed studies');
                    card.insertBefore(badge, card.firstChild);
                }
                const handler = (e) => {
                    if (e && e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
                    if (e && e.preventDefault) e.preventDefault();
                    // Close the OMT modal first so the evidence modal stacks visually.
                    closeOmtModal();
                    openEvidenceModal(k);
                };
                card.addEventListener('click', handler);
                card.addEventListener('keydown', handler);
                card.__mzWired = true;
            });
        }

        function openOmtModal(key) {
            const data = OMT_MODAL_DATA[key];
            if (!data || !omtModalEl) return;
            omtModalEyebrowEl.textContent = data.eyebrow;
            omtModalTitleEl.textContent = data.title;
            omtModalIntroEl.textContent = data.intro;
            omtModalBodyEl.innerHTML = data.body;
            // The literature hub injects .population-card[data-evidence]
            // sub-cards dynamically. Bind their evidence-modal handlers now.
            if (key === 'literature' || key === 'populations') wirePopulationCardsInside(omtModalBodyEl);
            omtModalEl.classList.add('open');
            omtModalEl.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            if (omtModalCardEl) omtModalCardEl.scrollTop = 0;
            window.__mzPrevFocus = document.activeElement;
            document.getElementById('omtModalClose')?.focus();
        }
        function closeOmtModal() {
            omtModalEl.classList.remove('open');
            omtModalEl.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (window.__mzPrevFocus && document.contains(window.__mzPrevFocus)) window.__mzPrevFocus.focus();
            window.__mzPrevFocus = null;
        }
        // Selector covers both: legacy .carepath-card[data-omt-modal] (none
        // remain after the 2026-05-16 refactor) AND the new .bento-card[data-omt-modal]
        // inside the consolidated OMT bento grid.
        document.querySelectorAll('[data-omt-modal]').forEach(card => {
            const key = card.getAttribute('data-omt-modal');
            card.addEventListener('click', () => openOmtModal(key));
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openOmtModal(key);
                }
            });
        });
        document.getElementById('omtModalClose')?.addEventListener('click', closeOmtModal);
        omtModalEl?.addEventListener('click', e => {
            if (e.target === omtModalEl) closeOmtModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && omtModalEl?.classList.contains('open')) closeOmtModal();
        });

        // ==========================================================
        // Apps detail modal — data-driven, single modal for all apps
        // ==========================================================
        const APPS = {
            clinical: {
                tone: 'accent',
                tag: 'Flagship · Clinical AI Engine',
                title: 'MountZara Clinical AI',
                tagline: 'A private clinical evidence engine — indexes your surgical literature, synthesizes meta-analyses, and detects conflicts across ACOG, AAGL, ASRM, and ESHRE guidelines. All on-device.',
                platforms: ['Native macOS', 'Base AI on-device · Apple foundation-model framework', 'Optional Claude API for elevated reasoning', 'Auto PHI redaction — HIPAA-compliant', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
                description: 'Drop in a PDF — a journal article, a society guideline, your clinical notes — and MountZara Clinical AI indexes every citation down to the page, paragraph, and sentence. Then ask it anything. It runs a hybrid full-text and semantic search across up to 30 citations, synthesizes a meta-analysis with pooled outcomes, I² heterogeneity, and confidence intervals, then surfaces any evidence conflicts with AI-generated resolutions. Base reasoning runs locally on the Apple foundation-model framework (iOS 27) — no internet required. For deeper synthesis on complex queries, users can optionally connect a Claude API key per query. Any text sent to the optional API is auto-redacted on-device first — patient identifiers, MRNs, names, dates — so no PHI ever leaves the machine, whether you stay local or use the cloud option.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>', title: 'Deep PDF indexing', desc: 'Every citation stored with its exact document, page, paragraph, and sentence. Hover any citation for an instant AI synthesis — 1–2 seconds.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>', title: 'Meta-analysis engine', desc: 'Pools statistics across indexed studies: sample size, outcomes, confidence intervals, I² heterogeneity, and study-design quality breakdown — publication-ready.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7z"/></svg>', title: 'Evidence conflict detection', desc: 'Knowledge graph builder flags contradictions across your indexed literature and generates AI resolutions citing both sources.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>', title: 'Surgical video analysis', desc: 'Upload operative footage — the app processes frames with on-device vision models and synthesizes clinical findings into indexed evidence.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h6l3-9 3 18 3-9h3"/></svg>', title: 'PubMed landmark search', desc: 'Query PubMed E-utilities directly for RCTs, guidelines, and society recommendations across ACOG, AAGL, SGO, ASRM, ESGE, ESHRE, FIGO, and WHO.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>', title: 'Base AI on-device · optional Claude API · auto PHI redaction', desc: 'The Apple foundation-model framework (iOS 27) runs the base reasoning loop fully on-device. Users can optionally connect a Claude API key per query for elevated synthesis on complex literature. Either way, an on-device redaction pass strips all patient identifiers before any external call — PHI never leaves the machine. HIPAA-compliant by design.' },
                ],
                useCases: [
                    { title: 'Pre-op literature review', desc: 'Drop in 5 papers on isthmocele repair approaches, ask "what does the evidence say about robotic vs. laparoscopic outcomes?" — get a synthesized meta-analysis with citations in seconds.' },
                    { title: 'Clinical literature prep', desc: 'Index your entire reading list, then query by topic, procedure, or complication to build evidence-grounded clinical references.' },
                    { title: 'Manuscript background writing', desc: 'Ask "what are the contradictions in the ICG endometriosis literature?" — the conflict detector surfaces opposing findings with direct citation links for your introduction section.' },
                ],
                tech: ['Native Swift / SwiftUI', 'Apple foundation-model framework (iOS 27, on-device)', 'PubMed E-utilities API', 'Hybrid full-text + semantic search', 'Meta-analysis engine (I², CI, pooled outcomes)', 'Knowledge graph + conflict detection'],
            },
            abog: {
                tone: 'warm',
                tag: 'Board Prep · 101 ABOG Categories',
                title: 'ABOG Case List Manager',
                tagline: 'All 101 ABOG categories pre-loaded. Import a hospital chart PDF — on-device AI auto-redacts all PHI before analysis, then extracts, categorizes, and maps the case. Then simulates your oral boards with Whisper-transcribed voice answers.',
                platforms: ['Native macOS', 'Base AI on-device · AI PDF extraction', 'Optional Claude API for elevated reasoning', 'Auto PHI redaction — HIPAA-compliant', 'Voice oral exam simulation', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
                description: 'The ABOG Certifying Examination requires 101 case categories — 30 Obstetric, 32 Gynecology, 39 Office Practice — tracked to an exact format with required fields for each type. This app has every category pre-loaded with its required fields, keywords, and validation rules. Upload a scanned hospital chart — before any analysis begins, on-device AI automatically redacts all patient-identifiable information (names, MRNs, dates of birth, addresses) so no PHI is stored or transmitted. After de-identification, the AI extracts the clinical narrative, suggests the applicable categories with confidence scores, and populates the fields. When your list is built, the Oral Exam Simulator plays examiner, records your voice answer with Whisper, transcribes it, and evaluates it against model answers — with "Model Answer," "Answers to Avoid," and a deep ACOG guideline dive for each question.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h12"/></svg>', title: 'All 101 ABOG categories', desc: '30 OB + 32 GYN + 39 Office Practice categories pre-loaded with required fields, keywords, and validation — exactly as ABOG publishes them.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>', title: 'AI PDF chart extraction', desc: 'Upload a scanned hospital chart — AI parses the clinical narrative, extracts diagnosis, procedure, pathology, and EBL, then suggests the applicable ABOG categories with per-category confidence scores.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7z"/></svg>', title: 'ACOG guideline comparison', desc: 'For any case, AI compares your clinical management against the relevant ACOG Practice Bulletin and generates detailed feedback on alignment and gaps.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>', title: 'Voice oral exam simulator', desc: 'The examiner presents your case and asks 3–4 board-style questions. You answer by voice — Whisper transcribes, AI evaluates, and you get a Model Answer, Answers to Avoid, and an ACOG Deep Dive.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18M9 17v-6M13 17v-3M17 17V9"/></svg>', title: 'Category coverage dashboard', desc: 'Deadline tracker (July 1 – June 30 collection, July 31 submission, October exam) with readiness assessment, category gap analysis, and quality flags for incomplete or critical cases.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', title: 'ABOG portal export', desc: 'Generate a submission-ready export formatted for the ABOG online portal. De-identified, validated, complete.' },
                ],
                useCases: [
                    { title: 'The resident building from day one', desc: 'Start logging cases from PGY-4 with the exact categorization ABOG requires — so submission day is a click, not a crisis.' },
                    { title: 'The physician with varied cases', desc: 'Cases from different practice settings each tagged to their source and mapped to the correct category — even when the same CPT code applies to two different ABOG buckets.' },
                    { title: 'The candidate six weeks out', desc: 'Run the oral exam simulator on your actual submitted cases. Hear a board-style question, answer out loud, get instant AI feedback — and know which ACOG bullets your examiner will cite.' },
                ],
                tech: ['Native Swift / SwiftUI', 'AI PDF extraction (Claude Code CLI)', 'Whisper on-device transcription', 'ACOG knowledge base (indexed)', '101 ABOG category engine', 'Category confidence scoring', 'Duplicate detection', 'De-identification service', 'ABOG portal export'],
            },
            transcription: {
                tone: 'accent',
                tag: 'Mac · iPhone · Apple Watch',
                title: 'Medical Transcription',
                tagline: 'Record any encounter on Mac, iPhone, or Watch. Whisper transcribes and de-identifies on-device — no audio or PHI leaves the device, ever. Structures into a CBG/MIGS-subspecialist SOAP note, then auto-generates billing/coding analysis, medico-legal documentation flags, patient education summaries, and point-of-care guideline support — all grounded in the Counsel knowledge base, which cites primary source documents (no AI hallucination).',
                platforms: ['macOS + iOS + watchOS', 'On-device Whisper — audio never uploaded', 'Base AI on-device · Optional Claude API', 'Counsel KB — source-grounded, no hallucination', 'Auto PHI redaction — HIPAA-compliant', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>',
                description: 'Start recording with ⌘⇧R on Mac, or tap Record on your iPhone or Apple Watch. Whisper — a custom fork with an iOS 18 BNNS fix — transcribes on-device in real time, then immediately de-identifies the transcript (names, MRNs, dates of birth, addresses) before any further processing. No audio file is ever uploaded; no PHI leaves the device. The de-identified transcript is structured into a SOAP note tailored to the GYN and CBG/MIGS subspecialist workflow — subjective, objective, assessment, and plan written at subspecialty level. From the structured note, the app auto-generates: (1) billing and coding analysis with AI-flagged missed opportunities for higher-level E&M coding; (2) medico-legal compliance recommendations and inline documentation edits; (3) a patient education summary written at patient reading level, specific to that encounter. Every guideline reference, treatment recommendation, and patient counseling line is grounded in the <strong>Counsel knowledge base</strong> — a curated, indexed library of primary source documents (ACOG Practice Bulletins, AAGL Position Statements, ESHRE guidelines, ASRM, ASCCP, CDC, and landmark trial PDFs) with every claim cited back to the exact source page, paragraph, and sentence. The AI cannot return an answer that isn\'t backed by an indexed citation — no general-LLM hallucination. Operative note templates, OB calculators, breast workup decision trees (BI-RADS → ACOG workup path), ASCCP cervical screening risk stratification, COC switching with VTE assessment, and a LARC reference tool are all built in. Copy the structured note with ⌘⇧C and paste straight into your EMR.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>', title: 'On-device Whisper — fully private', desc: 'Custom Whisper fork (BNNS sampling fix for iOS 18) transcribes on Mac, iPhone, and Watch. Audio never leaves the device. De-identifies the transcript automatically before any further processing — HIPAA-aligned.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v2H9zM9 13h6v2H9z"/></svg>', title: 'GYN/MIGS subspecialist SOAP notes', desc: 'De-identified transcript structures into a SOAP note written at CBG/MIGS subspecialty level — tailored for endometriosis, fibroids, menopausal hormone therapy, infertility, pelvic floor, and complex MIS encounters. Op note templates for laparoscopic and hysteroscopic procedures. ICD-10/CPT suggestions built in.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7z"/></svg>', title: 'Billing & coding analysis', desc: 'AI reviews the structured note and flags missed opportunities for higher-level E&M coding, suggests appropriate CPT modifiers, and surfaces documentation gaps that could impact reimbursement.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', title: 'Medico-legal documentation review', desc: 'AI scans the generated note for documentation compliance issues — missing informed consent elements, under-documented risk counseling, ambiguous language — and offers inline edits to strengthen the medico-legal record.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>', title: 'Counsel knowledge base — source-grounded, not hallucinated', desc: 'Every guideline reference, treatment recommendation, and patient counseling sentence is anchored in the Counsel knowledge base — a curated, indexed library of primary source PDFs (ACOG Practice Bulletins, AAGL Position Statements, ESHRE/ASRM/ASCCP guidelines, CDC, landmark trials). Every claim is cited back to the exact source document, page, paragraph, and sentence. The AI cannot return an answer that isn\'t backed by an indexed citation — this is what makes it different from general-purpose LLMs that are prone to hallucination.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', title: 'Patient education summaries', desc: 'Auto-generates a plain-language patient summary from the SOAP note — diagnosis explanation, treatment plan, follow-up instructions — written at an appropriate reading level for that specific encounter. Every counseling sentence is grounded in the Counsel knowledge base with source citations attached.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>', title: 'Point-of-care guideline support', desc: 'Counsel-grounded guideline logic from ACOG, AAGL, CDC, ESHRE, ASRM, and ASCCP — endometriosis staging and management, fibroid treatment algorithms, menopausal hormone therapy (MHT) risk stratification, infertility workup, ASCCP cervical screening, BI-RADS breast workup, COC switching, and LARC selection. Tap any recommendation to see the underlying source page.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/></svg>', title: 'Premade MIGS clinical templates', desc: 'Pre-built encounter templates for the most common CBG/MIGS complaints and scenarios — endometriosis, fibroids (symptomatic and surgical), pelvic pain, menopausal hormone therapy consult, infertility workup, abnormal uterine bleeding, and hysteroscopic or laparoscopic procedure types — each pre-referenced with ACOG, AAGL, ESHRE, and landmark MIGS trial citations.' },
                ],
                useCases: [
                    { title: 'Clinic day documentation', desc: 'Record 15-minute visits as you go — Whisper transcribes live, SOAP note auto-structures at subspecialty level, billing flags surface before the patient reaches checkout, and ⌘⇧C copies the note to your EMR.' },
                    { title: 'Any GYN encounter — routine to complex', desc: 'From a 15-minute well-woman visit to a multi-hour consult for endometriosis or fibroids, the app structures every SOAP at subspecialist depth, pulls the relevant guideline (ACOG, AAGL, ESHRE, ASRM, ASCCP, CDC) for the specific complaint directly from the Counsel knowledge base — each recommendation cited back to its source — and generates a patient education summary written for that encounter: abnormal bleeding, pelvic pain, MHT counseling, infertility workup, contraception switching, cervical screening, breast complaint, endometriosis, fibroids, or anything else on the schedule. No hallucinated guidelines, no general-knowledge approximations.' },
                    { title: 'Operative note — brief in, full formal report out', desc: 'Between cases, dictate only what matters: intra-op findings, key technique decisions, instruments used, complications, EBL. Pick a premade op template (TLH, robotic myomectomy, operative hysteroscopy, diagnostic laparoscopy) or your own custom base template. The AI interjects your dictated findings into the right sections — exposure, dissection, hemostasis, closure — and generates a complete, properly-formatted operative report at attending-level depth. ICD-10/CPT coded, medico-legal checked, ready to paste before the next patient is prepped.' },
                ],
                tech: ['Native Swift', 'Whisper (custom fork, BNNS fix)', 'macOS + iOS + watchOS', 'On-device de-identification engine', 'Counsel KB (source-grounded, citation-anchored — no hallucination)', 'ASCCP 2023 guideline logic', 'BI-RADS / ACOG decision trees', 'COC + VTE risk engine', 'AAGL/ESHRE endometriosis logic', 'Billing/coding analysis engine', 'Medico-legal compliance review', 'Patient education summary generator', 'Live Activity recording widget'],
            },
            research: {
                tone: 'violet',
                tag: 'Study Management · Manuscript Writing',
                title: 'MZ Research Suite',
                tagline: 'From PICO question to published manuscript — participant tracking, custom case report forms, statistical analysis, surgical image archive, and a reference engine that auto-validates every citation.',
                platforms: ['Native macOS', 'Base AI on-device for design + analysis', 'Optional Claude API for elevated reasoning', 'Auto PHI redaction — HIPAA-compliant', 'SwiftData persistence · Full audit trail', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M11 7v4l3 2"/></svg>',
                description: 'MZ Research Suite manages a clinical study from the first PICO question to the final manuscript. Create the study, upload your protocol, and AI generates the PICO-formatted hypothesis and identifies primary outcome columns. Build a custom case report form — drag in sections (demographics, surgical findings, pathology, biopsy) and define fields with validation rules. Enroll participants, enter data with a full audit trail on every edit, then run descriptive stats, t-tests, chi-square, ANOVA, and correlation analyses with publication-ready output tables. The manuscript editor pre-generates an abstract from your study design; the reference engine auto-detects every citation in your text and validates it against your library — flagging missing or unused references before submission.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>', title: 'AI study design wizard', desc: 'Upload your protocol or describe your clinical question — AI generates a PICO-formatted hypothesis, identifies primary and secondary outcome columns, and drafts the study design framework.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4zM4 8h16M8 4v16"/></svg>', title: 'Custom case report form builder', desc: 'Drag in sections (demographics, surgical findings, pathology, biopsy) and define field types, validation rules, and required status. AI auto-assigns icons and colors by field name pattern.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', title: 'Participant tracking + audit trail', desc: 'Enroll participants (ICG-001 format), track status (screening/enrolled/active/completed/withdrawn), and log every data modification with timestamp and user — IRB-ready audit trail built in.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18M9 17v-6M13 17v-3M17 17V9"/></svg>', title: 'Statistical engine', desc: 'Descriptive stats, t-tests, chi-square, ANOVA, correlation — computed with publication-ready output tables and figure generation. No export to SPSS required.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4"/></svg>', title: 'Manuscript editor + reference validation', desc: 'AI pre-generates your abstract from your study design. As you write, the reference tracking engine detects every in-text citation and validates it against your library — flagging missing and unused references in real time.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>', title: 'Surgical image archive', desc: 'Store intraoperative and pathology images linked to specific participants. Add annotations, organ classification, and finding type. PubMed search pulls landmark references directly into your library.' },
                ],
                useCases: [
                    { title: 'Designing a retrospective cohort study', desc: 'Upload your IRB protocol → AI maps PICO → build a custom CRF with demographic, surgical, and pathology sections → enroll participants from your case list → run descriptive stats → draft your Methods and Results with AI assistance.' },
                    { title: 'Managing multiple active IRBs', desc: 'Each study is isolated with its own participants, forms, analyses, and manuscript. Audit trail on every edit. Switch between an active RCT and a retrospective cohort without crossing data.' },
                    { title: 'Writing a peer-reviewed journal submission', desc: 'Manuscript editor pre-fills the abstract from your study design. Write the introduction, methods, results, and discussion — reference engine catches every missing citation before you hit submit.' },
                ],
                tech: ['Native Swift / SwiftUI', 'SwiftData (modern persistence)', 'Statistical engine (t-test, ANOVA, chi-square, correlation)', 'PubMed E-utilities API', 'Reference tracking engine', 'Vancouver / Harvard / Chicago citation styles', 'Encrypted data store', 'Full audit trail', 'Figure generation'],
            },
            video: {
                tone: 'dark',
                tag: 'Video Analysis · AI Pipeline',
                title: 'Surgical Video Archive',
                tagline: 'Analyze your operative videos with AI — transcript, OCR, intra-op findings, technique notes, and procedure tags — generating a structured AI report formatted the way surgeons actually want to see the data.',
                platforms: ['Native macOS + iPad', 'Base AI on-device for video analysis', 'Optional Claude API for elevated reasoning', 'Auto PHI redaction — HIPAA-compliant', 'Integrated with MountZara Clinical AI', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8l-6 4 6 4z"/></svg>',
                description: 'Surgical Video Archive manages your personal operative recordings with AI-powered analysis, tightly integrated with MountZara Clinical AI. Upload any video you own or have rights to analyze — an integrated pipeline transcribes the audio, runs OCR on screen overlays, and routes the combined signal through the MountZara Clinical AI engine. The AI generates a structured surgical report formatted the way surgeons actually want to see the data: indication and pre-op findings, anatomic landmarks, dissection plane and energy device used, intra-op findings and any complications, technique notes, estimated blood loss, repair / closure details, procedure tags, and a confidence score. Natural language smart search interprets queries ("hysterectomy with bladder injury") into surgical concepts and returns matching cases. Every analyzed video automatically syncs into MountZara Clinical AI — your video evidence and literature index share one unified queryable knowledge base.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', title: 'Personal video library', desc: 'Upload operative recordings you own or have rights to analyze. Organize by procedure type, date, and custom tags — with full metadata tracking and version history.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>', title: 'Natural language smart search', desc: 'Type "hysterectomy with bladder injury" — the MountZara Clinical AI engine interprets the query into surgical procedure categories, anatomic terms, and related techniques, then returns ranked matches from your archive.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7z"/></svg>', title: 'AI surgical report — surgeon-formatted', desc: 'Audio transcription + screen-overlay OCR feed into the MountZara Clinical AI engine, which synthesizes a structured operative report the way surgeons want to see it: indication, anatomy, dissection plane, energy device, intra-op findings, complications, technique notes, EBL, closure, tags, and a confidence score (0–1).' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>', title: 'User-owned video archive', desc: 'Manage all your operative recordings — personal cases, consented patient videos, and educational content you have rights to use — in one searchable, analyzable library.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>', title: 'Feedback-loop re-analysis', desc: 'If an analysis misses the key finding, add a note ("focus on the uterine artery ligation technique") and re-run — MountZara Clinical AI incorporates your feedback in the next synthesis.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>', title: 'Clinical knowledge base sync', desc: 'AI Hub Sync tab pushes analyzed video evidence into MountZara Clinical AI — your operative footage and your literature index share the same queryable knowledge base.' },
                ],
                useCases: [
                    { title: 'Building a personal CBG/MIGS curriculum', desc: 'Upload your operative recordings, run AI analysis on each video, and build a searchable archive of tagged techniques — your own private surgical education platform.' },
                    { title: 'Prepping a conference video submission', desc: 'Upload your operative recording, trigger analysis to verify the clinical narrative and tags are accurate, then use the findings to write your video abstract — the same workflow behind the Golden Hysteroscope submission.' },
                    { title: 'Technique comparison across cases', desc: 'Smart-search "robotic isthmocele repair ICG" → pull all matching videos → compare technique variations across your personal archived cases side by side.' },
                ],
                tech: ['Native Swift / SwiftUI (macOS + iPad)', 'Integrated MountZara Clinical AI engine', 'Video analysis pipeline (audio transcription + OCR)', 'Smart search with query interpretation', 'Confidence scoring (0–1)', 'Encrypted video storage', 'Unified knowledge base sync'],
            },
            videoannotator: {
                tone: 'purple',
                tag: 'iPad · Patient Education',
                title: 'Video and PACS Medical Imaging Viewer and Annotation',
                tagline: 'A patient education tool for the exam room. Load a patient\'s imaging or surgical video, draw and annotate in real time with Apple Pencil, and walk through anatomy, pathology, and treatment plans together — making medicine visual and understandable.',
                platforms: ['Native iPadOS', 'iPad-optimized for bedside use', 'PencilKit integration', 'DICOM parsing engine', 'On-device only — no PHI transmission', 'In Beta Testing'],
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><rect x="2" y="6" width="10" height="8" rx="1"/></svg>',
                description: 'VideoAnnotator is a patient education tool built for the exam room and bedside. Load a patient\'s CT, MRI, ultrasound, or surgical video directly on the iPad, then annotate it live with Apple Pencil as you explain what you\'re seeing. Circle a fibroid on an MRI. Trace the path of a planned dissection on a pelvic CT. Draw arrows showing where endometriosis was excised in a post-op video. Measure a lesion in real time and show the patient exactly what the numbers mean. This is what technology should do — close the gap between clinical expertise and patient understanding, turning complex medical imaging into a shared visual conversation. The app parses DICOM imaging natively (CT, MRI, ultrasound, X-ray) and plays surgical video with frame-perfect scrubbing, measurement overlays, and object tracking. Everything stays on the iPad — no cloud uploads, no PHI transmission. Built for the physician-patient encounter, where trust is built through clarity.',
                features: [
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>', title: 'Live annotation with Apple Pencil', desc: 'Draw directly on a patient\'s imaging or surgical video as you explain it — circle a fibroid, trace a dissection plane, highlight anatomy. Turn a static scan into a shared visual conversation.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M3 21L21 3"/><circle cx="12" cy="12" r="9"/></svg>', title: 'Measure and show in real time', desc: 'Add calibrated measurements directly on the screen — show a patient the size of their lesion, the distance between structures, or the angle of planned entry. Numbers with context patients can understand.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>', title: 'Native DICOM viewer', desc: 'Load CT, MRI, ultrasound, and X-ray directly from PACS exports or USB drives. Window/level controls, multi-planar views, and series navigation — medical imaging rendered the way it should be, at the bedside.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M22 8l-6 4 6 4z"/></svg>', title: 'Surgical video playback', desc: 'Show patients their own operative recordings — walk through what was found, what was excised, what was preserved. Frame-perfect scrubbing lets you pause at the exact moment that matters.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>', title: 'Object tracking across frames', desc: 'Mark an anatomic structure or pathology once, and the tracker follows it through the video — showing movement, location, and spatial relationships patients can follow visually.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', title: 'Built for the physician-patient encounter', desc: 'Turn the iPad toward the patient, draw as you explain, pause to answer questions. This is technology serving the relationship — not replacing it, not complicating it, but making the medicine visual and understandable.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>', title: 'Project-based organization', desc: 'Save annotated encounters as projects — pre-op consult with imaging annotations, post-op video review, treatment plan walkthroughs. Build a library of visual explanations you can reference across similar cases.' },
                    { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L3 7v6c0 5 4 9 9 10 5-1 9-5 9-10V7z"/></svg>', title: 'On-device only — no cloud, no PHI transmission', desc: 'All imaging and video stays on the iPad. No uploads, no external servers, no third-party access. HIPAA-compliant by design — privacy through architecture, not policy.' },
                ],
                useCases: [
                    { title: 'Pre-op consult with complex imaging', desc: 'Load the patient\'s pelvic MRI showing a deep infiltrating endometriosis nodule. Circle the lesion, measure its depth, trace the planned dissection path with Apple Pencil. Turn "we\'ll need to excise this" into a visual map the patient can understand and reference later.' },
                    { title: 'Post-op video review at follow-up', desc: 'Show the patient their own operative recording at the two-week follow-up. Pause at the moment you excised the lesion, draw to show what was removed, what was preserved, and why they\'re healing the way they are. Replace "it went well" with visual proof.' },
                    { title: 'Explaining a treatment plan at the bedside', desc: 'Load a CT showing a large fibroid burden. Annotate each fibroid, measure the uterus, draw the planned myomectomy approach. When the patient asks "can you show me where?" — you already are.' },
                    { title: 'Counseling on incidental findings', desc: 'A routine ultrasound shows an adnexal mass. Load the images, annotate the concerning features, measure the septations and solid components, and walk through the differential and next steps together — turning anxiety into informed understanding.' },
                ],
                tech: ['Native Swift / SwiftUI (iPadOS)', 'PencilKit canvas integration', 'DICOM parsing engine', 'Object tracking', 'Video playback', 'Measurement overlays', 'Annotation engine', 'Project management', 'Thumbnail scrubber'],
            },
        };

        const appModalEl = document.getElementById('appModal');
        const appModalScroll = document.getElementById('appModalScroll');

        function populateAppModal(key) {
            const app = APPS[key];
            if (!app) return;
            document.getElementById('appModalHero').setAttribute('data-tone', app.tone || '');
            document.getElementById('appModalIcon').innerHTML = app.icon;
            document.getElementById('appModalTag').textContent = app.tag;
            document.getElementById('appModalTitle').textContent = app.title;
            document.getElementById('appModalTagline').textContent = app.tagline;
            document.getElementById('appModalPlatforms').innerHTML = app.platforms
                .map(p => `<span class="platform-pill">${p}</span>`).join('');
            document.getElementById('appModalDescription').textContent = app.description;
            document.getElementById('appModalFeatures').innerHTML = app.features
                .map(f => `
                    <div class="feature-tile">
                        <div class="feature-tile-icon">${f.icon}</div>
                        <h4>${f.title}</h4>
                        <p>${f.desc}</p>
                    </div>`).join('');
            document.getElementById('appModalUseCases').innerHTML = app.useCases
                .map(u => `
                    <div class="usecase-row">
                        <span class="usecase-marker"></span>
                        <div>
                            <strong>${u.title}</strong>
                            <p>${u.desc}</p>
                        </div>
                    </div>`).join('');
            document.getElementById('appModalTech').innerHTML = app.tech
                .map(t => `<span class="tech-pill">${t}</span>`).join('');
        }

        function openAppModal(key) {
            populateAppModal(key);
            appModalEl.classList.add('open');
            document.body.style.overflow = 'hidden';
            if (appModalScroll) appModalScroll.scrollTop = 0;
            window.__mzPrevFocus = document.activeElement;
            appModalEl.querySelector('.app-modal-close')?.focus();
        }
        function closeAppModal() {
            appModalEl.classList.remove('open');
            document.body.style.overflow = '';
            if (window.__mzPrevFocus && document.contains(window.__mzPrevFocus)) window.__mzPrevFocus.focus();
            window.__mzPrevFocus = null;
        }
        appModalEl.addEventListener('click', e => {
            if (e.target === appModalEl) closeAppModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && appModalEl.classList.contains('open')) closeAppModal();
        });
        // Wire up every app card via event delegation
        document.querySelectorAll('.app-card-v2[data-app]').forEach(card => {
            const key = card.getAttribute('data-app');
            const open = () => openAppModal(key);
            card.addEventListener('click', open);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });

        // ==========================================================
        // Domain Modal — Surgical Excellence card deep-dives.
        // KB-anchored patient-centered content per §0.8.1.
        // Content lives in window.DOMAIN_MODAL_DATA (set below).
        // ==========================================================
        const domainModalEl    = document.getElementById('domainModal');
        const domainModalScroll = document.getElementById('domainModalScroll');
        const domainModalTag    = document.getElementById('domainModalTag');
        const domainModalTitle  = document.getElementById('domainModalTitle');
        const domainModalTagline= document.getElementById('domainModalTagline');
        const domainModalBody   = document.getElementById('domainModalBody');

        function renderDomainSection(s) {
            const eyebrow = s.eyebrow ? `<div class="app-modal-section-eyebrow">${s.eyebrow}</div>` : '';
            const title   = s.title   ? `<h3 class="app-modal-section-title">${s.title}</h3>` : '';
            let inner = '';
            if (s.lead) inner += `<p class="app-modal-section-lead">${s.lead}</p>`;
            if (s.body) inner += s.body;
            if (s.stats && s.stats.length) {
                inner += '<div class="dm-stats">' +
                    s.stats.map(st => `
                        <div class="dm-stat">
                            <span class="dm-stat-num">${st.num}</span>
                            <p class="dm-stat-label">${st.label}</p>
                            ${st.source ? `<div class="dm-stat-source">${st.source}</div>` : ''}
                        </div>`).join('') + '</div>';
            }
            if (s.rba) {
                inner += '<div class="dm-rba">' +
                    ['expectant','medical','surgical'].filter(k => s.rba[k]).map(k => {
                        const c = s.rba[k];
                        // Editorial, patient-friendly taglines for the three
                        // management paths (the clinical terms — expectant / medical
                        // / surgical — read as jargon). Phrased to generalize across
                        // all seven practice areas. The per-card `sub` keeps the
                        // specific clinical approach for the referring-clinician read.
                        const label = { expectant:'When no treatment may make sense', medical:'Medications for when treatment is needed', surgical:'When nothing else works and surgical treatment is an option' }[k];
                        const sub   = { expectant:'Watchful, structured monitoring', medical:'Medicine to quiet symptoms', surgical:'A procedure to address the cause' }[k];
                        return `<div class="dm-rba-col">
                            <h4>${label}</h4>
                            <div class="dm-rba-sub">${c.sub || sub}</div>
                            ${c.intro ? `<p>${c.intro}</p>` : ''}
                            ${c.items && c.items.length ? `<ul>${c.items.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
                            ${c.note ? `<p style="font-size:13px;color:#ffffff;margin-top:10px;">${c.note}</p>` : ''}
                        </div>`;
                    }).join('') + '</div>';
            }
            if (s.timeline && s.timeline.length) {
                inner += '<div class="dm-timeline">' +
                    s.timeline.map(t => `
                        <div class="dm-timeline-step">
                            <div class="dm-timeline-stage">${t.stage}</div>
                            <div class="dm-timeline-body"><p>${t.body}</p></div>
                        </div>`).join('') + '</div>';
            }
            if (s.qa && s.qa.length) {
                inner += '<div class="dm-qa">' +
                    s.qa.map(it => `
                        <div class="dm-qa-item">
                            <h4 class="dm-qa-q">${it.q}</h4>
                            <p class="dm-qa-a">${it.a}</p>
                        </div>`).join('') + '</div>';
            }
            if (s.refs && s.refs.length) {
                inner += '<ol class="dm-refs">' +
                    s.refs.map(r => `<li>${r.cite}${r.pmid ? ` <a href="https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/" target="_blank" rel="noopener">PubMed</a><span class="dm-ref-pmid">PMID ${r.pmid}</span>` : ''}</li>`).join('') + '</ol>';
            }
            return `<section class="app-modal-section">${eyebrow}${title}${inner}</section>`;
        }

        function populateDomainModal(slug) {
            const d = (window.DOMAIN_MODAL_DATA || {})[slug];
            if (!d) {
                domainModalTitle.textContent = 'Coming soon';
                domainModalTag.textContent = '';
                domainModalTagline.textContent = 'Patient-centered details for this area are being finalized.';
                domainModalBody.innerHTML = '';
                return;
            }
            domainModalTag.textContent = d.tag || '';
            domainModalTitle.textContent = d.title;
            domainModalTagline.textContent = d.tagline || '';
            domainModalBody.innerHTML = (d.sections || []).map(renderDomainSection).join('');
        }

        function openDomainModal(slug) {
            populateDomainModal(slug);
            domainModalEl.classList.add('open');
            domainModalEl.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            if (domainModalScroll) domainModalScroll.scrollTop = 0;
            window.__mzPrevFocus = document.activeElement;
            domainModalEl.querySelector('.app-modal-close')?.focus();
        }
        function closeDomainModal() {
            domainModalEl.classList.remove('open');
            domainModalEl.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            if (window.__mzPrevFocus && document.contains(window.__mzPrevFocus)) window.__mzPrevFocus.focus();
            window.__mzPrevFocus = null;
        }
        // Make functions reachable from inline handlers
        window.openDomainModal  = openDomainModal;
        window.closeDomainModal = closeDomainModal;

        // Outside-click + Escape to close
        domainModalEl.addEventListener('click', e => {
            if (e.target === domainModalEl) closeDomainModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && domainModalEl.classList.contains('open')) closeDomainModal();
        });

        // Wire each domain-card via event delegation (click + keyboard Enter/Space)
        document.querySelectorAll('.domain-card[data-domain]').forEach(card => {
            const slug = card.getAttribute('data-domain');
            const open = () => openDomainModal(slug);
            card.addEventListener('click', open);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        });

        // ==========================================================
        // Surgical Practice — unified hub-expand mosaic (Phase QD)
        // ==========================================================
        (function initSurgicalHub() {
            const hub = document.getElementById('surgical-hub');
            if (!hub) return;
            const tiles = Array.from(hub.querySelectorAll('.hub-tile[data-category]'));
            const panel = hub.querySelector('.surgical-hub-panel');
            const panelInner = panel ? panel.querySelector('.hub-panel-inner') : null;
            const closeBtn = panel ? panel.querySelector('.hub-panel-close') : null;
            const sourceContainer = document.querySelector('.hub-content-source');
            if (!tiles.length || !panel || !panelInner || !sourceContainer) return;

            let activeKey = null;

            function setActive(key) {
                if (!key) return closePanel();
                if (activeKey === key) return closePanel();
                const sourceArticle = sourceContainer.querySelector(`article[data-category="${key}"]`);
                if (!sourceArticle) {
                    console.warn('surgical-hub: no source content for category', key);
                    return;
                }
                // 2026-05-27 — if the source article has EXACTLY ONE domain
                // CTA, skip the inline expand-panel and open the full
                // domain modal directly. Tiles with multiple CTAs
                // (hysterectomy → mis+vnotes, hysteroscopy → operative+
                // in-office, adhesiolysis → adhesiolysis+cross-specialty)
                // still use the inline panel so the user can pick which
                // sub-domain to open. User feedback: "the cards should
                // open to a modal, the modal should be a new full page
                // modal, not the modal that opens below the 7 cards".
                const ctas = sourceArticle.querySelectorAll('.domain-cta-btn[data-domain]');
                if (ctas.length === 1 && typeof window.openDomainModal === 'function') {
                    const slug = ctas[0].getAttribute('data-domain');
                    // Reset tile state so no .active sticks on the previously
                    // chosen tile while the user is in the full-page modal.
                    closePanel();
                    window.openDomainModal(slug);
                    return;
                }
                // Multi-CTA path — fall through to the inline expand-panel.
                // Clone the article so the source-of-truth stays intact for re-renders.
                const clone = sourceArticle.cloneNode(true);
                panelInner.innerHTML = '';
                panelInner.appendChild(clone);
                // Wire the CTA buttons inside the clone to openDomainModal.
                clone.querySelectorAll('.domain-cta-btn[data-domain]').forEach(btn => {
                    const slug = btn.getAttribute('data-domain');
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (typeof window.openDomainModal === 'function') {
                            window.openDomainModal(slug);
                        }
                    });
                });
                // Update tile states.
                tiles.forEach(t => {
                    const k = t.getAttribute('data-category');
                    if (k === key) {
                        t.classList.add('active');
                        t.classList.remove('dimmed');
                        t.setAttribute('aria-selected', 'true');
                    } else {
                        t.classList.remove('active');
                        t.classList.add('dimmed');
                        t.setAttribute('aria-selected', 'false');
                    }
                });
                panel.hidden = false;
                panel.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden'; // prevent body scroll when modal open
                activeKey = key;
                // 2026-06-26 — removed scrollIntoView (panel is now a fixed overlay, not inline)
            }

            function closePanel() {
                panel.hidden = true;
                panel.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = ''; // restore body scroll
                panelInner.innerHTML = '';
                tiles.forEach(t => {
                    t.classList.remove('active');
                    t.classList.remove('dimmed');
                    t.setAttribute('aria-selected', 'false');
                });
                activeKey = null;
            }

            tiles.forEach(t => {
                const key = t.getAttribute('data-category');
                t.addEventListener('click', () => setActive(key));
                t.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(key); }
                    else if (e.key === 'Escape' && activeKey) { e.preventDefault(); closePanel(); }
                });
            });
            if (closeBtn) {
                closeBtn.addEventListener('click', closePanel);
            }
            // Outside-click closes (click on backdrop, not on card)
            panel.addEventListener('click', e => {
                if (e.target === panel) closePanel();
            });
            // Escape anywhere closes the panel when one is open.
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && activeKey) closePanel();
            });

            // ----------------------------------------------------------
            // Safety-stat count-up on first scroll-into-view
            // ----------------------------------------------------------
            const safetyGrid = document.querySelector('.safety-grid[data-count-trigger]');
            if (safetyGrid && 'IntersectionObserver' in window) {
                const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                const obs = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (!entry.isIntersecting) return;
                        obs.unobserve(entry.target);
                        // For each numeric stat, animate from 0 -> target over ~1.4s.
                        entry.target.querySelectorAll('[data-count-target]').forEach(el => {
                            const target = parseInt(el.getAttribute('data-count-target'), 10);
                            const prefix = el.getAttribute('data-count-prefix') || '';
                            const suffix = el.getAttribute('data-count-suffix') || '';
                            if (reduceMotion || !Number.isFinite(target)) {
                                el.innerHTML = `${prefix}${target}${suffix}`;
                                return;
                            }
                            const duration = 1400;
                            const t0 = performance.now();
                            function step(now) {
                                const p = Math.min(1, (now - t0) / duration);
                                // ease-out cubic
                                const eased = 1 - Math.pow(1 - p, 3);
                                const val = Math.round(target * eased);
                                el.innerHTML = `${prefix}${val}${suffix}`;
                                if (p < 1) requestAnimationFrame(step);
                            }
                            requestAnimationFrame(step);
                        });
                        // For Zero stats, fade them in with a brief upward float
                        // so the section feels animated even without a counter.
                        entry.target.querySelectorAll('[data-count-text]').forEach((el, i) => {
                            if (reduceMotion) return;
                            el.style.opacity = '0';
                            el.style.transform = 'translateY(8px)';
                            el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                            setTimeout(() => {
                                el.style.opacity = '1';
                                el.style.transform = 'none';
                            }, 80 + i * 80);
                        });
                    });
                }, { threshold: 0.35 });
                obs.observe(safetyGrid);
            }
        })();

        // ==========================================================
        // Evidence cards — staggered reveal + cursor glow
        // ==========================================================
        (function initEvidenceCards() {
            const cards = document.querySelectorAll('.evidence-card');
            if (!cards.length) return;
            cards.forEach((c, i) => c.style.setProperty('--si', i));
            if ('IntersectionObserver' in window) {
                const obs = new IntersectionObserver((entries) => {
                    entries.forEach(e => {
                        if (e.isIntersecting) {
                            e.target.classList.add('in');
                            obs.unobserve(e.target);
                        }
                    });
                }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
                cards.forEach(c => obs.observe(c));
            } else {
                cards.forEach(c => c.classList.add('in'));
            }
            cards.forEach(card => {
                card.addEventListener('pointermove', e => {
                    const r = card.getBoundingClientRect();
                    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
                    card.style.setProperty('--my', `${e.clientY - r.top}px`);
                });
            });
        })();

        // ==========================================================
        // Surgical Focus cards — staggered reveal + cursor glow
        // ==========================================================
        (function initSurgicalCards() {
            const cards = document.querySelectorAll('.surgical-card');
            if (!cards.length) return;
            cards.forEach((c, i) => c.style.setProperty('--si', i));
            if ('IntersectionObserver' in window) {
                const obs = new IntersectionObserver((entries) => {
                    entries.forEach(e => {
                        if (e.isIntersecting) {
                            e.target.classList.add('in');
                            obs.unobserve(e.target);
                        }
                    });
                }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
                cards.forEach(c => obs.observe(c));
            } else {
                cards.forEach(c => c.classList.add('in'));
            }
            cards.forEach(card => {
                card.addEventListener('pointermove', e => {
                    const r = card.getBoundingClientRect();
                    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
                    card.style.setProperty('--my', `${e.clientY - r.top}px`);
                });
            });
        })();

        // ==========================================================
        // Education Timeline — scroll-driven line fill + dot activation
        // ==========================================================
        (function initTimeline() {
            const timeline = document.querySelector('.timeline');
            if (!timeline) return;
            const rows = Array.from(timeline.querySelectorAll('.timeline-row'));
            if (!rows.length) return;

            let ticking = false;

            function update() {
                ticking = false;
                const rect = timeline.getBoundingClientRect();
                const winH = window.innerHeight;
                // Anchor point: ~55% down the viewport. The line fills based on
                // how far past this anchor the timeline has scrolled.
                const anchor = winH * 0.55;
                const start = rect.top;       // top of timeline relative to viewport
                const total = rect.height;    // height of full timeline
                // Distance from timeline top to anchor (negative when not yet reached)
                const passed = anchor - start;
                const progress = Math.max(0, Math.min(1, passed / total));
                timeline.style.setProperty('--timeline-progress', progress.toFixed(4));

                // Activate each row when its dot crosses the anchor
                rows.forEach(row => {
                    const r = row.getBoundingClientRect();
                    const dotY = r.top + 36; // matches CSS dot top
                    if (dotY <= anchor + 10) {
                        row.classList.add('tl-active');
                    } else {
                        row.classList.remove('tl-active');
                    }
                });
            }

            function onScroll() {
                if (!ticking) {
                    requestAnimationFrame(update);
                    ticking = true;
                }
            }

            window.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', onScroll, { passive: true });
            update();
        })();

        // ==========================================================
        // Apple Vision Pro–style scroll system (rewritten for polish)
        // ==========================================================
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // -- 1) Reveal coverage: tag every meaningful content element --
        // "blur" = section-defining headlines (rare, slower-feeling)
        // "scale" = visual cards (subtle pop)
        // "up"   = text blocks, list items (slide-up)
        const revealMap = [
            { sel: '.section-eyebrow', kind: 'up' },
            { sel: '.section-headline', kind: 'blur' },
            { sel: '.section-sub', kind: 'up' },
            { sel: '.about-text-block', kind: 'up' },
            { sel: '.about-grid > *', kind: 'up' },
            { sel: '.metric-card', kind: 'scale' },
            { sel: '.bento-card', kind: 'scale' },
            { sel: '.bento-grid > *', kind: 'scale' },
            { sel: '.domain-card', kind: 'scale' },
            { sel: '.domain-grid > *', kind: 'scale' },
            { sel: '.app-card-v2', kind: 'scale' },
            { sel: '.app-card', kind: 'scale' },
            { sel: '.apps-bento > *', kind: 'scale' },
            { sel: '.apps-arch-item', kind: 'up' },
            { sel: '.apps-arch > *', kind: 'up' },
            { sel: '.award-tile', kind: 'scale' },
            { sel: '.award-card', kind: 'scale' },
            { sel: '.awards-grid > *', kind: 'scale' },
            { sel: '.surgery-pillar', kind: 'up' },
            { sel: '.research-pillar', kind: 'up' },
            { sel: '.pillar-card', kind: 'up' },
            { sel: '.feature-card', kind: 'scale' },
            { sel: '.fellowship-card', kind: 'scale' },
            { sel: '.omm-card', kind: 'up' },
            { sel: '.education-item', kind: 'up' },
            { sel: '.research-list > *', kind: 'up' },
            { sel: '.research-item', kind: 'up' },
            { sel: '.research-card', kind: 'up' },
            { sel: '.pub-item', kind: 'up' },
            { sel: '.research-video-block', kind: 'scale' },
            { sel: '.excellence-quote', kind: 'fade' },
            { sel: '.aagl-accepted-banner', kind: 'scale' },
            { sel: '.aagl-stat', kind: 'up' },
            { sel: 'blockquote', kind: 'fade' },
            { sel: '.cite', kind: 'up' },
            { sel: '.contact-cta', kind: 'scale' },
            { sel: '.email-row', kind: 'up' },
            { sel: '.cta-row', kind: 'up' },
            // Osteopathic section
            { sel: '.population-card', kind: 'scale' },
            { sel: '.populations-grid > *', kind: 'up' },
            { sel: '.technique-cell', kind: 'up' },
            { sel: '.techniques-grid > *', kind: 'up' },
            { sel: '.pop-mod', kind: 'fade' },
            { sel: '.omm-quote-block', kind: 'fade' },
            { sel: '.sub-eyebrow', kind: 'up' },
            { sel: '.sub-headline', kind: 'blur' },
            { sel: '.sub-sub', kind: 'up' },
            { sel: '.sub-section', kind: 'up' },
            // Education timeline
            { sel: '.timeline-row', kind: 'up' },
            { sel: '.timeline > *', kind: 'up' },
            // Excellence cite + research extras
            { sel: '.excellence-cite-divider', kind: 'fade' },
            { sel: '.aagl-divider', kind: 'fade' },
            // Coverage gaps (2026-06-11 audit): elements that previously
            // never revealed — about stats, safety record, hub tiles,
            // identity cards, curriculum cards/CTA.
            { sel: '.stats-row > *', kind: 'up' },
            { sel: '.safety-eyebrow', kind: 'up' },
            { sel: '.safety-card', kind: 'scale' },
            { sel: '.surgical-hub-eyebrow', kind: 'up' },
            { sel: '.hub-tile', kind: 'scale' },
            { sel: '.identity-card', kind: 'scale' },
            { sel: '.curriculum-card', kind: 'scale' },
            { sel: '.curriculum-grid > *', kind: 'scale' },
            { sel: '.curriculum-cta-inner', kind: 'up' },
        ];
        revealMap.forEach(({ sel, kind }) => {
            document.querySelectorAll(sel).forEach((el) => {
                // Don't re-tag if already set by a previous (more specific) match
                if (el.hasAttribute('data-reveal')) return;
                // Skip elements inside the hero or pinned showcase (those have their own choreography)
                if (el.closest('.hero, .pinned-showcase')) return;
                el.setAttribute('data-reveal', kind);
                // Stagger only across direct siblings inside grids/rows so cascading feels natural
                const parent = el.parentElement;
                if (parent && parent.children.length > 1 && parent.children.length <= 8) {
                    const sibIdx = Array.prototype.indexOf.call(parent.children, el);
                    if (sibIdx > 0) el.setAttribute('data-stagger', String(Math.min(sibIdx, 6)));
                }
            });
        });

        // -- 2) Word-level reveal on hero title only --
        function splitWords(el) {
            if (!el || el.dataset.split === '1') return;
            if (el.children.length > 0) return; // skip if has <br> or other markup
            const text = el.textContent;
            el.innerHTML = text.split(/(\s+)/).map(t =>
                t.trim() ? `<span class="word-mask"><span class="w">${t}</span></span>` : ' '
            ).join('');
            el.classList.add('word-reveal');
            el.dataset.split = '1';
        }
        const heroTitle = document.querySelector('.hero-title');
        if (heroTitle && !reduceMotion) splitWords(heroTitle);

        // 2026-05-27 v6 — line-spanning gradient: compute per-word CSS vars
        // so each .w shows its slice of a single shared gradient sized to
        // the parent headline's full width. Without this, each .w renders
        // its own white→purple sweep INSIDE the word (user feedback: "the
        // gradient you applied is per word, not the entire line of words
        // uniformly"). Re-runs on resize.
        function applyLineSpanGradient(parent) {
            if (!parent) return;
            const words = parent.querySelectorAll('.w');
            if (!words.length) return;
            const pRect = parent.getBoundingClientRect();
            const totalW = pRect.width;
            words.forEach(w => {
                const wRect = w.getBoundingClientRect();
                const xFromParentLeft = wRect.left - pRect.left;
                w.style.setProperty('--w-x', xFromParentLeft + 'px');
                w.style.setProperty('--w-total', totalW + 'px');
            });
        }
        // Allow layout to settle after splitWords before measuring.
        if (heroTitle) {
            requestAnimationFrame(() => applyLineSpanGradient(heroTitle));
            let _resizeT = null;
            window.addEventListener('resize', () => {
                clearTimeout(_resizeT);
                _resizeT = setTimeout(() => applyLineSpanGradient(heroTitle), 80);
            });
            // 2026-08-20 — Avenir Next lands AFTER the rAF measurement on a
            // cold cache: every word reflows to its real metrics but --w-x /
            // --w-total still describe the fallback-font layout. Re-measure
            // once the webfonts are actually in.
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => applyLineSpanGradient(heroTitle));
            }
            // 2026-08-20 — Chrome 151 ghost-glyph fix (CONFIRMED root cause,
            // reproduced live on Chrome 151.0.7922.170 / macOS 15.6 arm64).
            // The PARENT h1 carries its own background-clip:text gradient as
            // the pre-split first-paint fallback (see .hero-title in
            // home.css). After splitWords, the h1's only direct text is the
            // whitespace between .word-mask spans, so that parent layer
            // should paint nothing — but Chrome 151 paints the parent's
            // descendant-glyph clip mask at collapsed offsets, compositing a
            // ghost copy of EVERY word at the line start ("Aasaisrion...").
            // Verified in the owner's console: killing only the parent
            // background cleared the garble instantly while the per-word
            // gradient slices kept rendering correctly. So: once the split
            // has happened (the .w slices own the gradient from here on),
            // drop the parent's now-redundant copy. Inline style — the
            // locked .hero-title / .word-reveal CSS rules are untouched, and
            // the pre-split fallback still paints on browsers with JS off,
            // reduced motion (no split), or before this script runs.
            if (heroTitle.dataset.split === '1') {
                heroTitle.style.background = 'none';
            }
            // 2026-08-20 — Chrome ghost-glyph hygiene. `.word-reveal .w` carries
            // `will-change: transform, opacity` (locked CSS — do not edit it),
            // which keeps EVERY word promoted to its own GPU layer forever.
            // Each layer holds a rasterized copy of its background-clip:text
            // glyphs; when Chrome re-lays-out the line mid-flight (font swap,
            // scroll-fade opacity writes from tick()) a stale raster can be
            // composited at a stale offset. Releasing will-change AFTER the
            // entrance settles demotes the layers and forces one clean
            // repaint. NOT the root cause of the 2026-08-20 ghost (that was
            // the parent gradient above — live testing proved the .w layers
            // innocent), but kept as defense-in-depth: five permanent GPU
            // layers for a run-once entrance is waste regardless. The
            // entrance itself still runs fully promoted, so the choreography
            // (hero_animation.lock) is untouched.
            heroTitle.addEventListener('transitionend', (e) => {
                if (!e.target.classList || !e.target.classList.contains('w')) return;
                if (e.propertyName !== 'transform') return;
                const words = heroTitle.querySelectorAll('.w');
                const settled = [...words].every(w =>
                    getComputedStyle(w).transform === 'none' ||
                    getComputedStyle(w).transform === 'matrix(1, 0, 0, 1, 0, 0)');
                if (settled) words.forEach(w => { w.style.willChange = 'auto'; });
            });
        }

        // -- 3) IntersectionObserver: fire reveal when element top crosses 85% viewport --
        // rootMargin -15% on the bottom means: trigger when element enters the top 85% of viewport
        // = element is comfortably visible before the animation runs, so by the time user reads it,
        //   it has already settled. Threshold 0 = "any pixel inside the trimmed root counts".
        const reveals = document.querySelectorAll('[data-reveal], .word-reveal');
        if (reduceMotion) {
            // 2026-08-12 — Reduce Motion now gets a real scroll reveal, not an
            // instant dump. The previous branch added .in to EVERYTHING at
            // load, so an RM user (the owner browses with RM on) saw no appear
            // effect at all: "not doing the appear/scroll effect when
            // scrolling down the page anymore". The accessibility contract is
            // no MOTION, not no transitions: the RM CSS block strips
            // transform/filter and keeps an opacity-only fade, and this branch
            // now drives .in from the same IntersectionObserver geometry as
            // the normal path. The 2026-07-22 guarantee still stands — nothing
            // may EVER stay invisible under RM — via the MutationObserver
            // sweep, which now OBSERVES JS-built cards instead of instantly
            // revealing them, plus the same unobserve-on-reveal behavior.
            const rmObs = new IntersectionObserver((entries) => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        e.target.classList.add(e.target.classList.contains('reveal') ? 'visible' : 'in');
                        rmObs.unobserve(e.target);
                    }
                });
            }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
            const rmWatch = () => {
                document.querySelectorAll(
                    '[data-reveal]:not(.in), .word-reveal:not(.in), .evidence-card:not(.in), .surgical-card:not(.in), .reveal:not(.visible)'
                ).forEach(el => {
                    if (el.classList.contains('hero-title')) return; // owned by the bootstrap
                    if (!el.dataset.rmObserved) { el.dataset.rmObserved = '1'; rmObs.observe(el); }
                });
            };
            rmWatch();
            new MutationObserver(rmWatch).observe(document.body, { childList: true, subtree: true });
            // Safety net: anything already scrolled past (or missed during a
            // fast fling) is revealed by a periodic sweep — the RM promise
            // that no content stays hidden survives the observer change.
            setInterval(() => {
                // r.top < innerHeight covers both "on screen now" AND "flung
                // past above" — an element the user scrolled beyond must be
                // visible when they scroll back up. Only content still below
                // the fold stays hidden, waiting for its observer fade.
                const pastOrVisible = (el) => el.getBoundingClientRect().top < window.innerHeight;
                const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 60;
                document.querySelectorAll('[data-reveal]:not(.in), .word-reveal:not(.in), .evidence-card:not(.in), .surgical-card:not(.in)').forEach(el => {
                    if (el.classList.contains('hero-title')) return;
                    if (atBottom || pastOrVisible(el)) el.classList.add('in');
                });
                document.querySelectorAll('.reveal:not(.visible)').forEach(el => {
                    if (atBottom || pastOrVisible(el)) el.classList.add('visible');
                });
            }, 900);
        } else {
            const revealObs = new IntersectionObserver((entries) => {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        e.target.classList.add('in');
                        revealObs.unobserve(e.target);
                    }
                });
            // 2026-06-11 — bottom margin loosened from -22% to -8% (matching the
            // sibling observers above). On short mobile viewports the -22% trim
            // meant elements in the bottom ~22% of the final scroll position
            // never crossed the trigger line and stayed stuck at opacity:0
            // (user: "elegant appear is not working in mobile view"). -8% reveals
            // them as soon as they're genuinely on screen.
            }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
            // 2026-06-25 — Do NOT observe the hero title here. It is in the
            // viewport on load, so the observer would add `.in` immediately and
            // the title's word-stagger would settle BEFORE the hero text
            // cascade begins (user: "'passion for women's health.' comes up
            // when page opens, then the rest appears WAY after"). The title's
            // `.in` is instead added inside startHeroSequence's setTimeout, in
            // lockstep with `.hero-content-delayed.visible`, so the title and
            // subtitle reveal together, finishing 1ms before the animation ends.
            reveals.forEach(el => {
                if (!el.classList.contains('hero-title')) revealObs.observe(el);
            });
            // FLING-PROOF SAFETY NET — nothing must ever stay invisible.
            // IntersectionObserver can MISS elements during a fast scroll: an
            // element flung past between the observer's sample frames never
            // reports isIntersecting and would stay stuck at opacity:0 (user on
            // iPhone: "only some show, some don't"). The old net only fired at
            // the exact page bottom AND only covered [data-reveal] — so cards
            // (.evidence-card/.surgical-card) and .word-reveal flung past were
            // never recovered. This rAF-throttled scroll pass reveals ANY
            // reveal-eligible element that has entered the viewport, across all
            // four mechanisms (.in for data-reveal/word-reveal/cards, .visible
            // for .reveal), plus a hard sweep at the bottom. The CSS stagger
            // still plays because it keys off the .in/.visible class.
            // 2026-06-25 — exclude .hero-title from the fling-proof safety net
            // for the same reason it is excluded from the observer above: its
            // reveal is owned exclusively by startHeroSequence's setTimeout so
            // it stays synchronized with the subtitle. (Its block-level
            // visibility is ALSO gated solely on that setTimeout via
            // `.hero-content-delayed.visible`, so excluding it here introduces
            // no new way for it to stay hidden.)
            const REVEAL_IN = '[data-reveal]:not(.in), .word-reveal:not(.in):not(.hero-title), '
                            + '.evidence-card:not(.in), .surgical-card:not(.in)';
            const REVEAL_VIS = '.reveal:not(.visible)';
            let revealTick = false;
            const revealVisible = () => {
                revealTick = false;
                const vh = window.innerHeight;
                const atBottom = window.scrollY + vh
                    >= document.documentElement.scrollHeight - 4;
                document.querySelectorAll(REVEAL_IN).forEach(el => {
                    if (atBottom || el.getBoundingClientRect().top < vh * 0.95) {
                        el.classList.add('in');
                        revealObs.unobserve(el);
                    }
                });
                document.querySelectorAll(REVEAL_VIS).forEach(el => {
                    if (atBottom || el.getBoundingClientRect().top < vh * 0.95) {
                        el.classList.add('visible');
                    }
                });
            };
            // 2026-06-24 — HARDENED reveal triggers. A scroll-ONLY net left
            // sections permanently blank on iOS Safari: during a momentum
            // fling Safari coalesces/delays `scroll` events, so the rAF pass
            // sampled a stale position and never crossed the trigger line —
            // the headline/eyebrow/paragraph stayed at opacity:0 forever
            // (user: "the autoappear when scrolling" is broken; blank About
            // section on iPhone). Fix: also trigger on the gestures that DO
            // fire continuously during a real scroll (wheel on desktop,
            // touchmove on mobile) and on `scrollend` (fires once iOS momentum
            // settles), plus a short self-stopping poll as a hard backstop so
            // no element that has entered the viewport can stay hidden. None
            // of these reveal below-fold content early, so the staggered
            // scroll animation is preserved everywhere it already worked.
            const queueReveal = () => {
                if (!revealTick) { revealTick = true; requestAnimationFrame(revealVisible); }
            };
            window.addEventListener('scroll', queueReveal, { passive: true });
            window.addEventListener('wheel', queueReveal, { passive: true });
            window.addEventListener('touchmove', queueReveal, { passive: true });
            window.addEventListener('scrollend', revealVisible, { passive: true });
            window.addEventListener('resize', queueReveal, { passive: true });
            window.addEventListener('orientationchange', () => setTimeout(revealVisible, 80));
            // run after first paint and again as fonts/layout settle, so
            // anything already on screen (or above it) can't be left hidden.
            requestAnimationFrame(revealVisible);
            [400, 1200, 2500].forEach(ms => setTimeout(revealVisible, ms));
            // Self-stopping backstop poll — catches any element the observer
            // AND every gesture handler somehow missed (the historical
            // "only some show, some don't" iPhone bug). Cheap: the selectors
            // shrink to empty as elements reveal, and getBoundingClientRect is
            // only called on the not-yet-revealed set. Stops itself the moment
            // nothing reveal-eligible remains in/above the viewport, or after a
            // generous cap, so it never costs idle battery.
            let revealPolls = 0;
            const revealPoll = setInterval(() => {
                revealVisible();
                const remaining = document.querySelectorAll(REVEAL_IN).length
                                + document.querySelectorAll(REVEAL_VIS).length;
                if (remaining === 0 || ++revealPolls > 120) clearInterval(revealPoll);
            }, 250);
        }

        // -- 4) Single rAF-throttled scroll handler for hero / progress / ambient / pinned --
        const heroEl = document.querySelector('.hero');
        const heroInner = document.querySelector('.hero-inner');
        const monogramStage = document.querySelector('.monogram-stage');
        const scrollBar = document.getElementById('scrollProgressBar');
        const ambient = document.getElementById('ambientGlow');
        const pinnedSection = document.querySelector('.pinned-showcase');
        const pinnedFrames = pinnedSection ? Array.from(pinnedSection.querySelectorAll('.pinned-frame')) : [];
        const pinnedBg = pinnedSection ? pinnedSection.querySelector('.pinned-bg') : null;
        const cinematicIntro = document.getElementById('cinematicIntro');

        // -- Identity Map (mobile navigator) --
        // Added 2026-05-25 per Identity-Map redesign Option A. Provides a
        // horizontally-scrolling chooser of 5 identity sections (Surgery,
        // Research, Apps, Osteopathy, Education) above the long-form
        // content. Scroll-spy below highlights the active card + pip based
        // on which identity section is currently in the viewport sweet
        // spot. Desktop renders the same row as a static 5-col grid; the
        // scroll-spy logic still runs (cheap), so the active card lifts
        // wherever the user is on the page.
        const identityCards = Array.from(document.querySelectorAll('.identity-card'));
        const identityPips = Array.from(document.querySelectorAll('.identity-pip'));
        const identitySections = identityCards
            .map(card => {
                const id = card.getAttribute('data-identity');
                const el = id ? document.getElementById(id) : null;
                return el ? { id, el, card } : null;
            })
            .filter(Boolean);
        let lastIdentityActive = null;

        let lastPinnedIdx = -1;
        let ticking = false;
        let heroAnimationComplete = false;

        // Research cards use tap-to-open video modal (see openVideoModal function)


        function tick() {
            const y = window.scrollY;
            const winH = window.innerHeight;
            const docH = document.documentElement.scrollHeight;

            // -- Hero: gentle parallax + fade tied directly to scroll position --
            // Fades out as user scrolls down the first viewport, and back in when
            // they scroll back up to the top.
            //
            // 2026-05-21 — fade window shifted later. Previous range (25% → 95%
            // of viewport height) started fading the hero almost as soon as the
            // user nudged the page, so on iPhone Pro Max the MZ wordmark, uterine
            // drawing, and CTAs were translucent before the reader had a chance
            // to take them in. New range (60% → 110%) keeps the hero opaque
            // through the first 60% of viewport scroll and finishes the fade
            // just after the user has fully scrolled past it. Per user mobile
            // audit 2026-05-21: "content fades before I can read it".
            //
            // 2026-06-25 — DO NOT apply opacity to the entire .hero-inner parent,
            // because opacity < 1 on a parent creates a backdrop root that kills
            // backdrop-filter on iOS Safari children (.hero-sub, .hero-meta glass
            // cards). Instead, apply fade only to NON-glass children (monogram,
            // title). The glass cards stay at full opacity so their frost works
            // during scroll. User: "when scrolling up where the opacity loses glass
            // effect when scrolling midway" — this was caused by heroInner.style.opacity.
            if (heroEl && heroInner && !reduceMotion) {
                const fadeStart = winH * 0.60;
                const fadeEnd = winH * 1.10;
                const t = Math.max(0, Math.min(1, (y - fadeStart) / (fadeEnd - fadeStart)));
                const opacity = 1 - t;
                // Apply opacity fade ONLY to non-glass children (monogram, title)
                const heroTitle = heroInner.querySelector('.hero-title');
                if (heroTitle) heroTitle.style.opacity = opacity.toFixed(3);
                // Subtle parallax: hero text drifts up slightly with scroll (slower than page)
                // 2026-06-25 — use 2D translateY, NOT translate3d. translate3d/translateZ
                // force a GPU compositing layer (the classic promotion hack), which makes
                // the backdrop-filter children frost an empty promoted layer instead of the
                // FIXED drawing → "not glass".
                // CRITICAL: at the top (ty≈0) emit literal `none`, NOT translateY(0px).
                // translateY(0) computes to matrix(1,0,0,1,0,0) — an IDENTITY MATRIX, which
                // iOS Safari STILL treats as a backdrop root and which flattens the
                // .hero-sub / .hero-meta backdrop-filter to a dead flat fill. (This is the
                // exact reason [data-reveal].in settles to `transform: none` rather than an
                // identity transform.) Only promote the layer once the user actually scrolls.
                const ty = -y * 0.08;
                heroInner.style.transform = (Math.abs(ty) < 0.05)
                    ? 'none'
                    : `translateY(${ty.toFixed(1)}px)`;
                if (monogramStage) {
                    const mScale = 1 - t * 0.04;
                    monogramStage.style.opacity = (1 - t).toFixed(3);
                    monogramStage.style.transform = `translate3d(0, ${(-y * 0.02).toFixed(1)}px, 0) scale(${mScale.toFixed(3)})`;
                }
            }

            // -- Cinematic video backdrop: fade out as user scrolls past hero,
            //    pause video once it's fully covered to free up GPU. --
            if (cinematicIntro) {
                // Persist the video as a fixed background through the hero AND the
                // entire pinned showcase. Pinned showcase is 300vh tall and starts
                // right after the hero (~100vh), so we keep the video at full opacity
                // until roughly y = pinnedSection.bottom - winH, then fade across one
                // viewport.
                let fadeStart, fadeEnd;
                if (pinnedSection) {
                    const pinTop = pinnedSection.offsetTop;
                    const pinHeight = pinnedSection.offsetHeight;
                    fadeStart = pinTop + pinHeight - winH * 1.4;
                    fadeEnd   = pinTop + pinHeight - winH * 0.4;
                } else {
                    fadeStart = winH * 0.55;
                    fadeEnd   = winH * 1.05;
                }
                const range = Math.max(1, fadeEnd - fadeStart);
                const t = Math.max(0, Math.min(1, (y - fadeStart) / range));
                cinematicIntro.style.opacity = (1 - t).toFixed(3);

                // Cinematic gradient backdrop fades with scroll (CSS animation handles movement)
            }

            // -- Scroll progress bar --
            if (scrollBar) {
                const total = docH - winH;
                scrollBar.style.width = (total > 0 ? Math.min(y / total, 1) * 100 : 0) + '%';
            }

            // -- Ambient glow follows scroll position --
            if (ambient && !reduceMotion) {
                const total = docH - winH;
                const p = total > 0 ? Math.min(y / total, 1) : 0;
                ambient.style.setProperty('--ambient-y', (35 + p * 30) + '%');
            }

            // Research cards are static - no scroll effects

            // -- Pinned showcase frame switcher REMOVED 2026-06-25 --
            // The 300vh sticky scroll-swap was replaced by two normal-flow
            // blocks that each scroll-reveal via data-reveal="up" (see CSS).
            // No per-frame JS needed anymore; .pinned-bg is display:none.

            // -- Identity Map scroll-spy --
            // Each candidate identity section has its top measured against
            // the viewport midpoint. The section whose top is just above
            // midpoint (but closest to it) is the "active" one. Midpoint
            // anchoring (rather than "first section intersecting top") is
            // more forgiving on long sections: a reader who is two-thirds
            // through #surgical and approaching #research will see the
            // navigator switch right when #research's top crosses the
            // viewport midpoint, not the instant its top touches the
            // viewport. Cheap — ~5 getBoundingClientRect calls per rAF.
            if (identitySections.length) {
                const midpoint = winH * 0.45;
                let activeId = null;
                let bestTop = -Infinity;
                for (const { id, el } of identitySections) {
                    const top = el.getBoundingClientRect().top;
                    if (top <= midpoint && top > bestTop) {
                        bestTop = top;
                        activeId = id;
                    }
                }
                // If we haven't scrolled into any identity section yet
                // (still on hero / about / identity-map itself), default
                // to surgical (first card) so the navigator never looks
                // empty.
                if (!activeId && identitySections.length) {
                    activeId = identitySections[0].id;
                }
                if (activeId !== lastIdentityActive) {
                    identityCards.forEach(card => {
                        card.classList.toggle('is-active', card.getAttribute('data-identity') === activeId);
                    });
                    identityPips.forEach(pip => {
                        pip.classList.toggle('active', pip.getAttribute('data-target') === activeId);
                    });
                    lastIdentityActive = activeId;
                }
            }

            ticking = false;
        }
        function onScroll() {
            if (!ticking) {
                requestAnimationFrame(tick);
                ticking = true;
            }
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });
        tick();

        // ============================================================
        // Pinned-showcase scroll-snap controller (2026-06-25)
        // ------------------------------------------------------------
        // User request: the two mission frames ("The Foundation" /
        // "The Innovation") should each take exactly ONE scroll/swipe
        // stroke to land on — REGARDLESS OF VELOCITY. A hard flick must
        // not blow past a frame; two strokes total traverse both.
        //
        // CSS scroll-snap alone can't do this: a fast flick still skips
        // past mandatory snap points to a far one. So we hijack the
        // gesture ONLY while the showcase is in view and animate scrollY
        // to the adjacent frame, swallowing every other wheel/touch event
        // of that same flick (busy-lock) — that is what makes it
        // velocity-independent. Outside the zone, scrolling is 100% native.
        //
        // Snap stops (top-aligned; each frame is exactly one viewport tall
        // so top-align == centred): [escape-up, Foundation, Innovation,
        // escape-down]. The escape anchors (hero bottom / About top) let a
        // stroke at either end RELEASE out of the zone instead of trapping
        // the reader. Geometry is recomputed live per gesture, so resize /
        // orientation / dynamic-URL-bar changes need no cache busting.
        //
        // Disabled under prefers-reduced-motion (plain native scroll), and
        // a no-op if fewer than two frames exist. Coexists with tick() and
        // the reveal system: our programmatic scroll fires real 'scroll'
        // events, so parallax + data-reveal entrances run normally.
        (function initPinnedSnap() {
            // 2026-07-22 — RETIRED, replaced by native CSS scroll-snap (see
            // .pinned-frame scroll-snap-align). The custom wheel/touch hijack
            // preventDefault-ed every gesture in its zone and swallowed ALL
            // input during each 680ms animation + 200ms cooldown ("busy"
            // lock) — users on both desktop and mobile experienced this as
            // scrolling that stalls, stutters, or dies entirely, and one-
            // snap-per-swipe killed native momentum on iOS. Native snap is
            // momentum-preserving, unhijackable, and identical across
            // devices. The pinned visual design is unchanged.
            return;
            /* eslint-disable no-unreachable */
            if (reduceMotion) return;
            const frames = pinnedFrames;
            if (!frames || frames.length < 2) return;
            const aboutEl = document.getElementById('about');

            const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
            // Document-absolute LAYOUT top via the offsetParent chain — deliberately
            // NOT getBoundingClientRect, which would bake any CSS transform on the
            // frame (e.g. a reveal slide) into the rect and make the snap stop drift.
            // offsetTop/offsetParent ignore transforms, so the stop is the frame's
            // true resting layout position regardless of any entrance animation.
            const absTop = (el) => { let t = 0; for (let n = el; n; n = n.offsetParent) t += n.offsetTop; return Math.round(t); };

            const FRAME_LO = 1, FRAME_HI = frames.length; // inclusive frame-stop index range

            // Ordered snap stops in document space: [hero-escape, ...frames, About-
            // escape]. Returns null when the page is too short / frames aren't
            // meaningfully separated, so the controller NEVER hijacks a degenerate
            // layout (which would otherwise trap the reader behind preventDefault).
            function snapStops() {
                const wh = window.innerHeight;
                const maxY = Math.max(0, (document.documentElement.scrollHeight || 0) - wh);
                if (maxY < wh * 0.5) return null;                       // page barely scrolls — bail
                const fy = frames.map(f => clamp(absTop(f), 0, maxY));
                for (let i = 1; i < fy.length; i++) {                   // force strict monotonic stops
                    if (fy[i] <= fy[i - 1]) fy[i] = fy[i - 1] + 1;
                }
                if (fy[fy.length - 1] - fy[0] < wh * 0.5) return null;  // frames collapsed together — bail
                const above = clamp(fy[0] - wh, 0, maxY);
                const below = clamp(aboutEl ? absTop(aboutEl) : (fy[fy.length - 1] + wh), 0, maxY);
                return [above].concat(fy, [below]);
            }
            // In the active zone? From half a viewport before the first frame to
            // half a viewport after the last. Bounds are INCLUSIVE so a gesture that
            // lands exactly on a float/rounded boundary is still captured (never
            // falls through to native scroll and "sticks").
            function inZone(stops, y) {
                if (!stops) return false;
                const wh = window.innerHeight;
                return y >= (stops[FRAME_LO] - wh * 0.5) && y <= (stops[FRAME_HI] + wh * 0.5);
            }
            // Nearest FRAME stop (indices 1..n only) — never an escape anchor, so
            // "advance by one" can't accidentally treat the hero/About escape as the
            // current position and double-step or stall.
            function nearestFrameIndex(stops, y) {
                let best = FRAME_LO, bd = Infinity;
                for (let i = FRAME_LO; i <= FRAME_HI; i++) {
                    const d = Math.abs(stops[i] - y);
                    if (d < bd) { bd = d; best = i; }
                }
                return best;
            }
            // First gesture in the zone (arriving): a downward gesture lands on the
            // first frame at/after y (→ Foundation from the hero); if already past
            // the last frame, RELEASE down to About. Upward lands on the last frame
            // at/before y (→ Innovation coming up from About); if already above the
            // first frame, RELEASE up to the hero. This both guarantees "first stroke
            // lands ON the component" and never snaps you backwards when you're
            // trying to leave the zone at its edge.
            function entryTarget(stops, y, dir) {
                if (dir > 0) {
                    for (let i = FRAME_LO; i <= FRAME_HI; i++) if (stops[i] >= y - 2) return i;
                    return stops.length - 1;   // below every frame, heading down → About
                } else {
                    for (let i = FRAME_HI; i >= FRAME_LO; i--) if (stops[i] <= y + 2) return i;
                    return 0;                  // above every frame, heading up → hero
                }
            }

            let busy = false;        // animating or in post-animation cooldown
            let wasInZone = false;   // were we in the zone on the previous gesture?
            let lastWheelT = 0;      // timestamp of last wheel event that triggered a snap

            // settleEl: when the target is a FRAME, its element — so that if the
            // viewport height changes mid-flight (iOS URL-bar collapse shifts every
            // svh-sized box above the showcase, hence the frame's layout top), we
            // land on its CURRENT position instead of a stale coordinate.
            function animateTo(targetY, settleEl) {
                const html = document.documentElement;
                const startY = window.scrollY;
                const maxY = Math.max(0, (html.scrollHeight || 0) - window.innerHeight);
                targetY = clamp(targetY, 0, maxY);
                const dist = targetY - startY;
                busy = true;
                // CRITICAL: the page sets `html { scroll-behavior: smooth }`, which
                // would make EVERY per-rAF window.scrollTo() below animate on its
                // own and fight our easing (motion stalls / overshoots). Neutralise
                // it inline for the duration, then restore. Inline `auto` overrides
                // the stylesheet's `smooth` across all engines, so each step is an
                // instant jump and OUR cubic easing drives the motion.
                const prevSB = html.style.scrollBehavior;
                html.style.scrollBehavior = 'auto';
                const settle = () => {
                    if (settleEl) {  // re-land precisely in case geometry shifted mid-animation
                        const m = Math.max(0, (html.scrollHeight || 0) - window.innerHeight);
                        window.scrollTo(0, clamp(absTop(settleEl), 0, m));
                    }
                    html.style.scrollBehavior = prevSB;
                };
                if (Math.abs(dist) < 2) {           // already there — still hold the lock briefly
                    settle();
                    setTimeout(() => { busy = false; }, 200);
                    return;
                }
                const dur = 680;
                const t0 = performance.now();
                const ease = p => (p < 0.5) ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
                (function step(now) {
                    const p = Math.min(1, (now - t0) / dur);
                    window.scrollTo(0, Math.round(startY + dist * ease(p)));
                    if (p < 1) { requestAnimationFrame(step); }
                    else { settle(); setTimeout(() => { busy = false; }, 240); } // cooldown absorbs flick inertia
                })(t0);
            }

            function chooseTarget(stops, y, dir) {
                if (!wasInZone) return entryTarget(stops, y, dir);
                return clamp(nearestFrameIndex(stops, y) + dir, 0, stops.length - 1);
            }
            function snapTo(stops, target) {
                const isFrame = target >= FRAME_LO && target <= FRAME_HI;
                animateTo(stops[target], isFrame ? frames[target - FRAME_LO] : null);
            }

            // ---- Wheel (desktop mouse / trackpad) ----
            window.addEventListener('wheel', (e) => {
                if (reduceMotion) return;
                const stops = snapStops();
                const y = window.scrollY;
                if (!inZone(stops, y)) { wasInZone = false; return; }   // native scroll outside the zone
                e.preventDefault();                                     // hold control + block flick accumulation
                if (busy) return;
                // Debounce: a heavy flick fires multiple wheel events in ~10-30ms; treat
                // them as one gesture to prevent skipping two frames in a single stroke.
                const now = performance.now();
                if (now - lastWheelT < 150) return;                     // cluster rapid events
                lastWheelT = now;
                if (Math.abs(e.deltaY) < 1) { wasInZone = true; return; }
                const dir = e.deltaY > 0 ? 1 : -1;
                const target = chooseTarget(stops, y, dir);
                wasInZone = true;
                snapTo(stops, target);
            }, { passive: false });

            // ---- Touch (iPad / mobile) ----
            // Only a single-finger gesture that STARTS inside the zone can snap.
            // Requiring start-in-zone prevents a swipe begun in the hero/About from
            // false-snapping when momentum carries scrollY across the boundary; the
            // multi-touch guard lets native pinch-zoom pass straight through.
            let tStartY = null, tConsumed = false;
            window.addEventListener('touchstart', (e) => {
                tStartY = null; tConsumed = false;
                if (reduceMotion || busy) return;
                if (e.touches && e.touches.length > 1) return;          // pinch / multi-touch → leave to native
                const t = e.touches && e.touches[0];
                if (!t) return;
                if (!inZone(snapStops(), window.scrollY)) return;       // gesture must originate in the zone
                tStartY = t.clientY;
            }, { passive: true });
            window.addEventListener('touchmove', (e) => {
                if (reduceMotion || tStartY === null) return;
                if (e.touches && e.touches.length > 1) { tStartY = null; return; } // second finger → release to pinch-zoom
                const t = e.touches && e.touches[0];
                if (!t) return;
                const stops = snapStops();
                const y = window.scrollY;
                if (!inZone(stops, y)) { wasInZone = false; return; }   // crossed out of zone → native scroll
                e.preventDefault();                                     // suppress native scroll within the zone
                if (busy || tConsumed) return;
                const dy = tStartY - t.clientY;                         // +dy = finger up = intent to go down
                if (Math.abs(dy) < 8) return;                           // ignore micro-jitter / taps
                const dir = dy > 0 ? 1 : -1;
                const target = chooseTarget(stops, y, dir);
                wasInZone = true;
                tConsumed = true;                                       // one snap per swipe
                snapTo(stops, target);
            }, { passive: false });
            const endTouch = () => { tStartY = null; tConsumed = false; };
            window.addEventListener('touchend', endTouch, { passive: true });
            window.addEventListener('touchcancel', endTouch, { passive: true }); // system interrupt → clear stale state

            // ---- Keyboard (space / arrows / page) ----
            window.addEventListener('keydown', (e) => {
                if (reduceMotion || busy) return;
                const tgt = e.target;
                const tag = (tgt && tgt.tagName) || '';
                // Don't steal Space/arrows from form fields or focusable controls.
                if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(tag) || (tgt && tgt.isContentEditable)) return;
                const stops = snapStops();
                const y = window.scrollY;
                if (!inZone(stops, y)) { wasInZone = false; return; }
                let dir = 0;
                if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Spacebar') dir = 1;
                else if (e.key === 'ArrowUp' || e.key === 'PageUp') dir = -1;
                if (!dir) return;
                e.preventDefault();
                const target = chooseTarget(stops, y, dir);
                wasInZone = true;
                snapTo(stops, target);
            });
        })();

        // ============================================================
        // Identity Map "See all" trigger + full-screen sheet modal
        // (Commit 2 — 2026-05-26). Each .mz-see-all-trigger button has
        // data-sheet-section pointing at a grid class with
        // data-mobile-overflow="N". On mobile only, cards N+1..end are
        // hidden by CSS (:nth-of-type rule). Clicking the trigger clones
        // the grid into the .mz-sheet dialog and strips the overflow
        // attribute so the cloned children all render.
        // ============================================================
        function initSeeAllSheet() {
            const triggers = Array.from(document.querySelectorAll('.mz-see-all-trigger'));
            const sheet = document.getElementById('mz-sheet');
            const sheetContent = document.getElementById('mz-sheet-content');
            if (!sheet || !sheetContent) return;

            // For each trigger, count the actual children of its target
            // grid. If count > overflow threshold, populate the count
            // label and reveal the trigger (remove hidden attr). Else
            // leave it hidden — the section already fits without trim.
            triggers.forEach(btn => {
                const sectionClass = btn.getAttribute('data-sheet-section');
                if (!sectionClass) return;
                const grid = document.querySelector('.' + sectionClass);
                if (!grid) return;
                const overflow = parseInt(grid.getAttribute('data-mobile-overflow') || '0', 10);
                const label = grid.getAttribute('data-mobile-overflow-label') || 'cards';
                const childCount = grid.children.length;
                if (childCount <= overflow) {
                    // Nothing trimmed — leave trigger hidden, nothing for sheet to add.
                    return;
                }
                const countSpan = btn.querySelector('[data-mz-count-target]');
                if (countSpan) {
                    countSpan.textContent = ' ' + childCount + ' ' + label;
                }
                btn.removeAttribute('hidden');
                btn.addEventListener('click', () => openSheet(sectionClass));
            });

            function openSheet(sectionClass) {
                const grid = document.querySelector('.' + sectionClass);
                if (!grid) return;
                // Pull the closest <section> ancestor for header/eyebrow context
                const section = grid.closest('section');
                let titleHtml = '';
                if (section) {
                    const eyebrow = section.querySelector('.section-eyebrow');
                    const headline = section.querySelector('.section-headline');
                    if (eyebrow) titleHtml += '<span class="section-eyebrow">' + eyebrow.textContent + '</span>';
                    if (headline) titleHtml += '<h2 class="section-headline" id="mz-sheet-title">' + headline.innerHTML + '</h2>';
                }
                // Clone the grid; strip the overflow attribute so CSS
                // :nth-of-type hide rule no longer matches the clone.
                const cloned = grid.cloneNode(true);
                cloned.removeAttribute('data-mobile-overflow');
                cloned.removeAttribute('data-mobile-overflow-label');
                sheetContent.innerHTML = titleHtml;
                sheetContent.appendChild(cloned);
                if (typeof sheet.showModal === 'function') {
                    sheet.showModal();
                } else {
                    sheet.setAttribute('open', '');
                }
                document.body.style.overflow = 'hidden';
            }

            function closeSheet() {
                if (sheet.hasAttribute('open')) {
                    if (typeof sheet.close === 'function') sheet.close();
                    else sheet.removeAttribute('open');
                }
                sheetContent.innerHTML = '';
                document.body.style.overflow = '';
            }

            // Wire close affordances: × button, ESC key, click on backdrop
            sheet.querySelectorAll('[data-mz-sheet-close]').forEach(b => {
                b.addEventListener('click', closeSheet);
            });
            sheet.addEventListener('click', (e) => {
                // dialog's ::backdrop bubbles click as if from the dialog itself;
                // only close if the click target IS the dialog (i.e. backdrop), not a child
                if (e.target === sheet) closeSheet();
            });
            sheet.addEventListener('cancel', (e) => {
                // ESC fires 'cancel' on <dialog>; let default close happen, then clean up
                setTimeout(closeSheet, 0);
            });
        }
        // The <dialog id="mz-sheet"> lives at the end of body, AFTER this
        // script tag. We must defer initialization until DOM is fully parsed,
        // otherwise getElementById('mz-sheet') returns null and the whole
        // initializer early-returns silently. 2026-05-26 fix.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initSeeAllSheet);
        } else {
            initSeeAllSheet();
        }

        // ============================================================
        // Mobile horizontal-swipe carousels per section
        // (Identity Map Commit 3 — 2026-05-26). Each grid with
        // [data-mobile-carousel] gets:
        //   1. A dynamically-built pip indicator strip below it
        //   2. A scroll listener that updates the active pip
        //   3. Click handlers on pips that scroll the matching card
        //      into view
        // Only active on viewport ≤ 640px via matchMedia. Desktop layouts
        // unchanged.
        // ============================================================
        function initMobileCarousels() {
            const grids = Array.from(document.querySelectorAll('[data-mobile-carousel]'));
            if (!grids.length) return;
            const mq = window.matchMedia('(max-width: 640px)');
            grids.forEach(grid => {
                // Build a <nav class="mz-grid-pips"> right after the grid
                const cards = Array.from(grid.children).filter(el => el.nodeType === 1);
                if (cards.length < 2) return;  // No pips needed for ≤1 card
                let pips = grid.nextElementSibling;
                if (!pips || !pips.classList.contains('mz-grid-pips')) {
                    pips = document.createElement('nav');
                    pips.className = 'mz-grid-pips';
                    pips.setAttribute('aria-label',
                        'Scroll position for ' +
                        (grid.getAttribute('data-mobile-carousel') || 'cards'));
                    cards.forEach((card, i) => {
                        const pip = document.createElement('button');
                        pip.type = 'button';
                        pip.className = 'mz-grid-pip';
                        pip.setAttribute('aria-label', 'Show item ' + (i + 1));
                        pip.dataset.index = String(i);
                        if (i === 0) pip.classList.add('active');
                        pip.addEventListener('click', () => {
                            card.scrollIntoView({
                                behavior: mq.matches ? 'smooth' : 'auto',
                                block: 'nearest',
                                inline: 'center'
                            });
                        });
                        pips.appendChild(pip);
                    });
                    grid.parentNode.insertBefore(pips, grid.nextSibling);
                }
                // Scroll listener — picks the card whose center is
                // closest to the grid's scroll-container midpoint.
                let pending = false;
                function updateActive() {
                    pending = false;
                    if (!mq.matches) return;  // Desktop — no carousel, no pips active state
                    const gridRect = grid.getBoundingClientRect();
                    const mid = gridRect.left + gridRect.width / 2;
                    let bestIdx = 0;
                    let bestDelta = Infinity;
                    cards.forEach((c, i) => {
                        const r = c.getBoundingClientRect();
                        const cMid = r.left + r.width / 2;
                        const d = Math.abs(cMid - mid);
                        if (d < bestDelta) { bestDelta = d; bestIdx = i; }
                    });
                    const pipEls = pips.children;
                    for (let i = 0; i < pipEls.length; i++) {
                        pipEls[i].classList.toggle('active', i === bestIdx);
                    }
                }
                grid.addEventListener('scroll', () => {
                    if (!pending) {
                        pending = true;
                        requestAnimationFrame(updateActive);
                    }
                }, { passive: true });
                // Initial state + on resize (e.g. mobile→desktop rotate)
                updateActive();
                mq.addEventListener('change', updateActive);
            });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initMobileCarousels);
        } else {
            initMobileCarousels();
        }

        // Video modal functions
        // Force the research-card video previews to autoplay reliably across
        // browsers — especially iOS Safari, which otherwise overlays a native
        // "tap to play" button on top of any <video autoplay> element whose
        // playback hasn't actually started yet (the visible second play-button
        // some users were seeing). Strategy: call .play() explicitly on load,
        // again whenever the element enters the viewport, and once on the
        // first user interaction as a last-resort fallback for autoplay-blocking
        // policies.
        (function ensureVideoPreviewsAutoplay() {
            // 2026-08-08 PERF — the reels are now preload="none" with NO
            // autoplay attribute: with preload=auto+autoplay all four mp4s
            // (10.0 MB combined) downloaded at page open ~18 viewports above
            // them, competing with the hero the loader waits on, and then sat
            // in "playing" state while offscreen. Playback (and therefore the
            // download) starts only when a reel approaches the viewport, and
            // pauses again when it leaves.
            const nearViewport = (v) => {
                const r = v.getBoundingClientRect();
                return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
            };
            const tryPlay = (v) => {
                if (!v || !v.paused) return;
                const p = v.play();
                if (p && typeof p.then === 'function') {
                    p.catch(() => { /* autoplay blocked — handled by fallback below */ });
                }
            };
            const playAll = () => document.querySelectorAll('.video-preview').forEach(v => {
                if (nearViewport(v)) tryPlay(v);
            });

            // Initial pass once the DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', playAll, { once: true });
            } else {
                playAll();
            }

            // Play as previews approach the viewport; PAUSE when they leave
            // (four simultaneous decoders for invisible video was measured
            // compositor load and battery drain on phones).
            if ('IntersectionObserver' in window) {
                // 2026-08-08b — preload="none" means the element holds NO data,
                // so play() alone does nothing (user: "autoplay of the surgical
                // thumbnails is not working"). On approach: switch preload,
                // load(), then play as soon as it is playable — and keep a
                // first-touch retry for browsers that refuse until a gesture.
                const wake = (v) => {
                    if (v.dataset.mzWoken === '1') { tryPlay(v); return; }
                    v.dataset.mzWoken = '1';
                    v.muted = true; v.playsInline = true; v.loop = true;
                    v.setAttribute('playsinline', '');
                    v.setAttribute('webkit-playsinline', '');
                    // load() RESETS currentTime to 0 and re-initialises the
                    // element, so only call it when there is genuinely nothing
                    // buffered (preload="none"/HAVE_NOTHING). Calling it on an
                    // element that already has data restarts the reel from 0.
                    try {
                        v.preload = 'auto';
                        if (v.readyState < 2) v.load();
                    } catch (e) {}
                    ['loadeddata', 'canplay', 'canplaythrough'].forEach((ev) =>
                        v.addEventListener(ev, () => tryPlay(v), { once: true }));
                    tryPlay(v);
                    // poll briefly: cached media can fire its events before we listen
                    let n = 0;
                    const iv = setInterval(() => {
                        if (++n > 12 || (!v.paused && v.currentTime > 0.05)) { clearInterval(iv); return; }
                        tryPlay(v);
                    }, 300);
                };
                const io = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) wake(entry.target);
                        else if (!entry.target.paused) entry.target.pause();
                    });
                }, { threshold: 0, rootMargin: '75% 0% 75% 0%' });
                document.querySelectorAll('.video-preview').forEach((v) => io.observe(v));
                // Single resume entry point for anything that pauses the reels
                // wholesale (the video modal does, to free the decoder). Without
                // this the reels stayed paused FOREVER after a modal was opened
                // and closed — closeVideoModal never restarted them.
                window.__mzWakePreviews = () => {
                    document.querySelectorAll('.video-preview').forEach((v) => {
                        if (nearViewport(v)) wake(v);
                    });
                };
                // ALWAYS LOOPING (owner directive 2026-08-12). The reels are
                // decorative loops: whenever one is near the viewport it must be
                // running, full stop. Two ways it could stop and never restart —
                // a play() that resolved but stalled (paused === false with the
                // clock frozen, which is exactly what the two-observer conflict
                // produced), and `loop` being cleared. A 2s watchdog re-asserts
                // loop and restarts anything near the viewport whose clock has
                // not moved since the last tick. Off-screen reels are still left
                // paused — four decoders running for content nobody can see was
                // measured battery drain — but nothing IN view can stay dead.
                const lastT = new WeakMap();
                setInterval(() => {
                    if (document.hidden) return;
                    document.querySelectorAll('.video-preview').forEach((v) => {
                        if (!nearViewport(v)) return;
                        if (!v.loop) v.loop = true;
                        if (!v.muted) v.muted = true;
                        const prev = lastT.get(v);
                        const now = v.currentTime;
                        lastT.set(v, now);
                        const stalled = prev !== undefined && now === prev;
                        if (v.paused || stalled) {
                            if (v.readyState < 2) { try { v.load(); } catch (e) {} }
                            const p = v.play();
                            if (p && typeof p.then === 'function') p.catch(() => {});
                        }
                    });
                }, 2000);
                // first real interaction unblocks any policy-held reel in view
                ['touchstart', 'pointerdown', 'scroll'].forEach((ev) =>
                    window.addEventListener(ev, () => {
                        document.querySelectorAll('.video-preview').forEach((v) => {
                            if (nearViewport(v)) wake(v);
                        });
                    }, { once: true, passive: true }));
            }

            // Fallback: one-time user interaction unblocks autoplay everywhere
            const onFirstInteract = () => {
                playAll();
                document.removeEventListener('touchstart', onFirstInteract, true);
                document.removeEventListener('click', onFirstInteract, true);
                document.removeEventListener('scroll', onFirstInteract, true);
            };
            document.addEventListener('touchstart', onFirstInteract, { capture: true, passive: true });
            document.addEventListener('click', onFirstInteract, { capture: true });
            document.addEventListener('scroll', onFirstInteract, { capture: true, passive: true });
        })();

        function openVideoModal(videoSrc, element) {
            const modal = document.getElementById('videoModal');
            const video = document.getElementById('modalVideo');
            if (!modal || !video) return;

            // Pause every research-card auto-preview so we don't have
            // overlapping audio (they're muted, but pausing them also
            // saves CPU and keeps the visual focus on the modal).
            document.querySelectorAll('.video-preview').forEach((v) => {
                try { v.pause(); } catch (e) { /* ignore */ }
            });

            video.src = videoSrc;
            modal.classList.add('active');
            video.play().catch(() => {});

            // Prevent body scroll
            document.body.style.overflow = 'hidden';

            window.__mzPrevFocus = document.activeElement;
            video.focus();
        }

        function closeVideoModal() {
            const modal = document.getElementById('videoModal');
            const video = document.getElementById('modalVideo');
            if (!modal || !video) return;
            // No-op when already closed — the global Escape handler calls this
            // unconditionally, and focus restore must not fire for other modals.
            if (!modal.classList.contains('active')) return;

            video.pause();
            video.src = '';
            modal.classList.remove('active');
            // Restart the research reels the modal paused (see openVideoModal).
            try { if (window.__mzWakePreviews) window.__mzWakePreviews(); } catch (e) {}

            // Restore body scroll
            document.body.style.overflow = '';

            if (window.__mzPrevFocus && document.contains(window.__mzPrevFocus)) window.__mzPrevFocus.focus();
            window.__mzPrevFocus = null;

            // Resume the muted auto-previews on the cards.
            document.querySelectorAll('.video-preview').forEach((v) => {
                v.play().catch(() => {});
            });
        }

        // Close modal on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeVideoModal();
            }
        });

        // 2026-08-12 — initVideoPreviews (a SECOND IntersectionObserver over
        // .video-preview, threshold 0.25) is DELETED. Its own 2026-08-08
        // comment already said "the IntersectionObserver below owns everything
        // else", but its observer was never actually removed, so two observers
        // owned the same four reels with incompatible geometry: the surviving
        // one uses threshold 0 + rootMargin 75% (wake early, before the reel
        // scrolls in), this one used threshold 0.25 with no margin. In the band
        // between those thresholds one observer called play() while the other
        // called pause() on the same element, every scroll frame.
        //
        // Measured on the live page with play/pause/load instrumented:
        // 8 PAUSE calls against only 2 play calls across the four reels —
        // 4 pauses from the surviving observer's own leave-branch and 4 from
        // this one — leaving reels 3 and 4 paused outright and reels 1 and 2
        // unpaused with currentTime pinned at 0.00. The identical file in an
        // isolated page played normally (clock 4.02s -> 7.03s), which is what
        // ruled out the media and pointed here.
        //
        // ONE owner now: the wake()/IntersectionObserver block above. Do not
        // reintroduce a second observer, play loop, or pause() over
        // .video-preview anywhere in this file.

        // Defensive: only re-expose if defined (avoids ReferenceError that
        // would halt every script that runs after this line; the
        // toggleFeatureSound function was removed in an earlier refactor
        // but this stale window assignment was missed). 2026-05-26.
        if (typeof toggleFeatureSound === 'function') {
            window.toggleFeatureSound = toggleFeatureSound;
        }

        // ============================================================
        // Research-card preview autoplay guard
        // ------------------------------------------------------------
        // Chrome's autoplay heuristics can quietly refuse to play
        // multiple muted videos that are below the fold on first paint.
        // We watch each <video.video-preview> with an IntersectionObserver
        // and call .play() explicitly when ≥25% of the card enters the
        // viewport.
        //
        // The <source> files are pre-cut 30-second "reels" (three 10-second
        // segments concatenated at 2:00/4:00/5:00 of each master video, or
        // 0:20/1:00/1:40 for the shorter arcuate case). They start at 0,
        // so no seeking is needed — just trigger playback.
        // ============================================================
        (function () {
            const previews = document.querySelectorAll('video.video-preview');
            if (!previews.length || !('IntersectionObserver' in window)) return;

            function tryPlay(v) {
                const p = v.play();
                if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required; we'll retry on next intersection */ });
            }

            const io = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    if (e.isIntersecting && e.target.paused) tryPlay(e.target);
                }
            }, { threshold: 0.25 });

            previews.forEach((v) => {
                io.observe(v);
                // Try once on DOM ready too — handles the case where the user lands
                // already scrolled into the research section (e.g. via #anchor).
                if (v.getBoundingClientRect().top < window.innerHeight) tryPlay(v);
            });
        })();
    