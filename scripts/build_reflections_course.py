#!/usr/bin/env python3
"""Mount Zara's Reflections — course generator (Phase 1).

Renders the /learn/ surfaces from per-topic course manifests:

    education/<topic>/course.json   →   learn/index.html            (catalog)
                                        learn/<topic>/index.html    (course home)
                                        learn/<topic>/<m>/<lesson>/index.html

The manifest IS the pedagogy contract (SYSTEM_MAP §8.0.0.0c): every lesson
carries a lived-experience `opening`, one or more `teaching` blocks whose
HTML is LIFTED from the already-approved education surfaces (citations and
popovers ride along), a private `reflection` prompt (client-side only, never
transmitted), an optional knowledge `check` whose wrong answers are real
myths with grounded corrections, and one `action` the reader can add to
their questions-for-your-visit list. scripts/audit_course_schema.py enforces
the shape at deploy; the generated pages inherit every site-wide gate
(canvas, light-text, text-width, no-dosing, disclaimers) automatically
because they are ordinary routes.

Progress and the questions list live in localStorage — per-visitor, never
sent anywhere. Content rule: teaching text comes from the approved library;
this generator NEVER authors clinical prose.

  python3 scripts/build_reflections_course.py            # regenerate all
"""
import html as html_mod
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DISCLAIMER = (
    '<div class="mz-eddisclaimer" role="note">'
    '<strong>Educational information — not medical advice.</strong> '
    'Everything in this course is general education, drawn from this practice’s '
    'reviewed patient library. It is not a diagnosis, a treatment recommendation, or a '
    'substitute for care from your own clinician, and reading it does not create a '
    'physician–patient relationship. Decisions about testing, medications, or surgery '
    'belong in a private conversation between you and your doctor.</div>'
)

BASE_CSS = """
:root {
    --paper:#FBFAF8; --card:#FFFFFF; --ink:#1A1726; --ink-2:#4A4658; --mute:#6E6A7C;
    --hair:#E9E5EE; --violet:#6d28d9; --violet-deep:#3d1478; --wash:#F4F0FB;
    --good:#047857; --radius:14px;
}
* { box-sizing:border-box; margin:0; }
html { background-color:#FBFAF8; }
body { background:var(--paper); color:var(--ink);
    font-family:'Avenir Next','Nunito Sans',-apple-system,system-ui,sans-serif;
    font-size:16.5px; line-height:1.65; }
a { color:var(--violet); }
.wrap { max-width:880px; margin:0 auto; padding:28px 22px 90px; }
.topbar { display:flex; align-items:center; gap:14px; padding:14px 22px; border-bottom:1px solid var(--hair);
    background:rgba(251,250,248,.92); position:sticky; top:0; backdrop-filter:blur(10px); z-index:5; }
.topbar a.home { font-weight:700; letter-spacing:.08em; color:var(--ink); text-decoration:none; font-size:14px; }
.topbar .crumb { color:var(--mute); font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.eyebrow { font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--violet); margin:26px 0 8px; }
h1 { font-family:'Fraunces','Avenir Next',Georgia,serif; font-weight:600;
    font-size:clamp(28px,5vw,40px); line-height:1.14; padding-bottom:.08em;
    background:linear-gradient(118deg,#3d1478 0%,#6d28d9 55%,#8b5cf6 100%);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
    color:var(--violet-deep); text-wrap:balance; margin-bottom:10px; }
h2 { font-family:'Fraunces','Avenir Next',Georgia,serif; font-weight:600; font-size:24px;
    line-height:1.2; margin:34px 0 10px; text-wrap:balance; }
p { margin:0 0 14px; }
.dek { font-size:18px; color:var(--ink-2); max-width:64ch; }
.mz-eddisclaimer { max-width:72ch; margin:40px auto 8px; padding:15px 19px; background:var(--wash);
    border:1px solid var(--hair); border-radius:12px; color:var(--ink-2); font-size:13.5px; line-height:1.6; }
.mz-eddisclaimer strong { color:var(--ink); }
.mod-list { list-style:none; padding:0; margin:22px 0; counter-reset:m; display:flex; flex-direction:column; gap:10px; }
.mod-list li { counter-increment:m; }
.mod-list a { position:relative; display:block; padding:15px 16px 15px 60px; border:1px solid var(--hair);
    background:var(--card); border-radius:var(--radius); text-decoration:none; color:var(--ink); }
.mod-list a::before { content:counter(m,decimal-leading-zero); position:absolute; left:16px; top:16px;
    font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:19px; color:var(--violet); }
.mod-list .m-name { font-weight:700; display:block; }
.mod-list .m-what { color:var(--ink-2); font-size:14.5px; display:block; margin-top:2px; }
.mod-list .m-done { position:absolute; right:14px; top:16px; font-size:12.5px; color:var(--good); font-weight:700; }
.opening { font-family:'Fraunces','Avenir Next',Georgia,serif; font-size:18px; color:var(--ink);
    background:var(--wash); border:1px solid var(--hair); border-left:3px solid var(--violet);
    border-radius:12px; padding:16px 18px; margin:20px 0 22px; }
.teach { margin:0 0 8px; }
.teach h3 { font-size:17px; font-weight:700; margin:22px 0 8px; }
.teach ul, .teach ol { margin:0 0 14px; padding-left:22px; }
.teach li { margin-bottom:7px; }
.reflect { border:1.5px dashed var(--violet); border-radius:12px; padding:13px 17px; margin:24px 0; color:var(--ink-2); }
.reflect .r-tag { display:block; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--violet); margin-bottom:4px; }
.check { border:1px solid var(--hair); border-radius:12px; padding:16px 18px; margin:24px 0; background:var(--card); }
.check .q { font-weight:700; margin-bottom:10px; }
.check button.opt { display:block; width:100%; text-align:left; font:inherit; color:var(--ink-2);
    background:var(--paper); border:1px solid var(--hair); border-radius:10px; padding:10px 13px;
    margin-bottom:8px; cursor:pointer; }
.check button.opt[data-state="right"] { border-color:var(--good); color:var(--good); font-weight:700; }
.check button.opt[data-state="wrong"] { border-color:#B91C1C; color:#B91C1C; }
.check .why { display:none; margin-top:10px; padding:12px 14px; background:var(--wash);
    border-radius:10px; color:var(--ink-2); font-size:14.5px; }
.check .why .src { display:block; margin-top:8px; font-size:12.5px; color:var(--mute); }
.action { display:flex; flex-wrap:wrap; gap:12px; align-items:center; border:1px solid var(--hair);
    background:var(--card); border-radius:12px; padding:14px 16px; margin:24px 0; }
.action .a-text { flex:1 1 260px; color:var(--ink-2); }
.action .a-text strong { color:var(--ink); }
.action button { font:inherit; font-weight:600; font-size:14px; color:var(--violet);
    background:#fff; border:1.5px solid var(--violet); border-radius:999px; padding:8px 16px; cursor:pointer; }
.action button[disabled] { color:var(--good); border-color:var(--good); cursor:default; }
.lesson-nav { display:flex; justify-content:space-between; gap:12px; margin:34px 0 0; }
.lesson-nav a { text-decoration:none; font-weight:600; font-size:14.5px; padding:10px 16px;
    border:1px solid var(--hair); border-radius:999px; background:var(--card); color:var(--ink); }
.side-note { color:var(--mute); font-size:13px; margin-top:6px; }
.qlist { list-style:none; padding:0; margin:18px 0; display:flex; flex-direction:column; gap:8px; }
.qlist li { border:1px solid var(--hair); background:var(--card); border-radius:10px; padding:11px 14px;
    display:flex; gap:10px; align-items:baseline; }
.qlist li button { margin-left:auto; font:inherit; font-size:12.5px; color:var(--mute); background:none; border:none; cursor:pointer; }
.progress-line { color:var(--mute); font-size:13.5px; margin:6px 0 0; }
.pending-owner { border:1px dashed #D97706; background:rgba(245,158,11,.07); color:#92400E;
    border-radius:12px; padding:13px 16px; margin:20px 0; font-size:14.5px; }
sup.mz-ref { position:relative; font-size:11px; }
sup.mz-ref a { text-decoration:none; font-weight:700; }
sup.mz-ref .mz-ref-pop { position:absolute; bottom:130%; left:50%; transform:translateX(-50%);
    width:min(330px,80vw); background:rgba(255,255,255,0.98); border:1px solid var(--hair);
    border-radius:10px; box-shadow:0 10px 30px rgba(26,23,38,.14); padding:12px 14px;
    visibility:hidden; opacity:0; transition:opacity .15s ease; z-index:20; font-size:12.5px; line-height:1.5; text-align:left; }
sup.mz-ref:hover .mz-ref-pop, sup.mz-ref:focus-within .mz-ref-pop { visibility:visible; opacity:1; }
.mz-ref-pop-title { display:block; font-weight:600; color:var(--ink); margin-bottom:3px; }
.mz-ref-pop-meta { display:block; color:var(--mute); margin-bottom:6px; }
.mz-ref-pop-finding { display:block; color:var(--ink-2); border-top:1px solid var(--hair); padding-top:6px; }
@media (max-width:560px){ .wrap { padding:20px 16px 80px; } }
"""

LESSON_JS = """
(function () {
    'use strict';
    var COURSE = document.body.getAttribute('data-course');
    var LESSON = document.body.getAttribute('data-lesson');
    function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
    function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
    // ---- progress: mark this lesson seen ----
    if (COURSE && LESSON) {
        var seen = load('mzr-seen-' + COURSE, {});
        seen[LESSON] = Date.now();
        store('mzr-seen-' + COURSE, seen);
    }
    // ---- knowledge check ----
    document.querySelectorAll('.check').forEach(function (c) {
        var why = c.querySelector('.why');
        c.querySelectorAll('button.opt').forEach(function (b) {
            b.addEventListener('click', function () {
                c.querySelectorAll('button.opt').forEach(function (x) {
                    x.dataset.state = (x.dataset.right === '1') ? 'right' : (x === b ? 'wrong' : '');
                });
                if (why) why.style.display = 'block';
            });
        });
    });
    // ---- questions-for-your-visit builder ----
    document.querySelectorAll('.action button[data-q]').forEach(function (b) {
        var list = load('mzr-questions-' + COURSE, []);
        if (list.indexOf(b.dataset.q) !== -1) { b.disabled = true; b.textContent = 'Added \\u2713'; }
        b.addEventListener('click', function () {
            var l = load('mzr-questions-' + COURSE, []);
            if (l.indexOf(b.dataset.q) === -1) { l.push(b.dataset.q); store('mzr-questions-' + COURSE, l); }
            b.disabled = true; b.textContent = 'Added \\u2713';
        });
    });
    // ---- questions page ----
    var qhost = document.getElementById('mzr-qlist');
    if (qhost) {
        var render = function () {
            var l = load('mzr-questions-' + COURSE, []);
            qhost.innerHTML = '';
            if (!l.length) { qhost.innerHTML = '<li>No questions saved yet \\u2014 add them from any lesson\\u2019s \\u201cbring this to your visit\\u201d row.</li>'; return; }
            l.forEach(function (q, i) {
                var li = document.createElement('li');
                var s = document.createElement('span'); s.textContent = (i + 1) + '. ' + q; li.appendChild(s);
                var rm = document.createElement('button'); rm.textContent = 'remove';
                rm.addEventListener('click', function () { l.splice(i, 1); store('mzr-questions-' + COURSE, l); render(); });
                li.appendChild(rm); qhost.appendChild(li);
            });
        };
        render();
        var pr = document.getElementById('mzr-print'); if (pr) pr.addEventListener('click', function () { window.print(); });
    }
    // ---- course-home progress marks ----
    document.querySelectorAll('[data-module-lessons]').forEach(function (el) {
        var lessons = el.getAttribute('data-module-lessons').split(',');
        var seen2 = load('mzr-seen-' + COURSE, {});
        var done = lessons.filter(function (s) { return seen2[s]; }).length;
        if (done > 0) {
            var mark = el.querySelector('.m-done');
            if (mark) mark.textContent = done + '/' + lessons.length;
        }
    });
})();
"""

def page(title, crumb, body, course="", lesson=""):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_mod.escape(title)} · Mount Zara's Reflections</title>
<meta name="robots" content="index, follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,530;9..144,600&display=swap">
<style>{BASE_CSS}</style>
</head>
<body data-course="{html_mod.escape(course)}" data-lesson="{html_mod.escape(lesson)}">
<nav class="topbar"><a class="home" href="/">MOUNT ZARA</a><span class="crumb">{crumb}</span></nav>
<main class="wrap">
{body}
{DISCLAIMER}
</main>
<script>{LESSON_JS}</script>
<style id="mz-canvas-guard">html{{background-color:#FBFAF8}}</style>
</body>
</html>
"""

def public_source(s):
    """Reader-facing source line: strip internal file paths, keep the citation."""
    s = re.sub(r"\S*index\.html\s*(?:·|—|-)?\s*", "", str(s or "")).strip(" ·—-")
    return s or "the practice's reviewed endometriosis library"

def esc(s):
    return html_mod.escape(str(s or ""), quote=True)

def render_lesson(course, mod, lesson, prev_url, next_url):
    b = []
    b.append(f'<p class="eyebrow">Module {mod["n"]} of 6 · {esc(mod["title"])}</p>')
    b.append(f'<h1>{esc(lesson["title"])}</h1>')
    if lesson.get("opening"):
        b.append(f'<div class="opening">{lesson["opening"]}</div>')
    if lesson.get("tone_owner_pending"):
        b.append('<div class="pending-owner"><strong>A note from the practice:</strong> '
                 'Dr. Mabini is writing this lesson’s guidance in his own words. '
                 'The sourced material below is the starting point; his voice is coming.</div>')
    for t in lesson.get("teaching", []):
        # Lifted citation markers point at the LIBRARY page's reference list —
        # lesson pages carry the hover popovers (self-contained) but not the
        # reference apparatus, so the tap-through lands on the full citation.
        t = re.sub(r'href="#(ref-\d+|mz-ref-\d+)"',
                   f'href="/education/{course["topic"]}/#\\1"', t)
        # data-r drives the LIBRARY page's tap-toggle JS against its own
        # reference list; lesson pages have neither, and the citation-
        # integrity gate rightly requires any data-r to resolve on-page.
        t = re.sub(r'\s+data-r="ref-\d+"', "", t)
        b.append(f'<div class="teach">{t}</div>')
    if lesson.get("reflection"):
        b.append('<div class="reflect"><span class="r-tag">Just for you — never sent anywhere</span>'
                 f'{esc(lesson["reflection"])}</div>')
    chk = lesson.get("check")
    if chk:
        opts = ""
        for opt in chk["options"]:
            right = '1' if opt.get("right") else '0'
            opts += f'<button type="button" class="opt" data-right="{right}">{esc(opt["text"])}</button>'
        b.append('<div class="check"><div class="q">Check your understanding</div>'
                 + opts +
                 f'<div class="why">{esc(chk["explanation"])}'
                 f'<span class="src">Source: {esc(public_source(chk["source"]))}</span></div></div>')
    act = lesson.get("action")
    if act:
        b.append('<div class="action"><div class="a-text"><strong>Bring this to your visit.</strong> '
                 f'{esc(act["text"])}</div>'
                 f'<button type="button" data-q="{esc(act["question"])}">Add to my questions</button></div>')
    nav = '<div class="lesson-nav">'
    nav += f'<a href="{prev_url}">← Previous</a>' if prev_url else '<span></span>'
    nav += f'<a href="{next_url}">Next →</a>' if next_url else f'<a href="../../your-questions/">Your questions →</a>'
    nav += '</div>'
    b.append(nav)
    crumb = f'<a href="/learn/">Reflections</a> · <a href="/learn/{course["topic"]}/">{esc(course["title"])}</a> · Module {mod["n"]}'
    return page(lesson["title"], crumb, "\n".join(b), course["topic"], f'{mod["n"]}-{lesson["slug"]}')

def render_course_home(course):
    b = [f'<p class="eyebrow">Mount Zara’s Reflections · a guided course</p>',
         f'<h1>{esc(course["title"])}</h1>',
         f'<p class="dek">{esc(course["dek"])}</p>',
         '<p class="progress-line">Free and open. Your progress and your questions list stay on this device — nothing you do here is sent anywhere.</p>',
         '<ol class="mod-list">']
    for mod in course["modules"]:
        first = mod["lessons"][0]
        lessons_attr = ",".join(f'{mod["n"]}-{l["slug"]}' for l in mod["lessons"])
        b.append(f'<li data-module-lessons="{lessons_attr}">'
                 f'<a href="{mod["n"]}/{first["slug"]}/">'
                 f'<span class="m-name">{esc(mod["title"])}</span>'
                 f'<span class="m-what">{esc(mod["what"])}</span>'
                 f'<span class="m-done"></span></a></li>')
    b.append('</ol>')
    b.append('<p class="side-note">Prefer the full reference guide? The complete '
             f'<a href="/education/{course["topic"]}/">{esc(course["title"])} library page</a> '
             'has every citation and abstract this course draws from.</p>')
    crumb = '<a href="/learn/">Reflections</a>'
    return page(course["title"], crumb, "\n".join(b), course["topic"])

def render_questions(course):
    b = ['<p class="eyebrow">Your visit, prepared</p>',
         '<h1>Your questions</h1>',
         '<p class="dek">Everything you saved while moving through the course — in your pocket for the appointment. This list lives only on this device.</p>',
         '<ul class="qlist" id="mzr-qlist"></ul>',
         '<p><button type="button" id="mzr-print" class="opt" style="font:inherit;font-weight:600;color:#6d28d9;background:#fff;border:1.5px solid #6d28d9;border-radius:999px;padding:9px 18px;cursor:pointer;">Print / save as PDF</button></p>']
    crumb = f'<a href="/learn/">Reflections</a> · <a href="/learn/{course["topic"]}/">{esc(course["title"])}</a>'
    return page("Your questions", crumb, "\n".join(b), course["topic"])

def render_catalog(courses):
    b = ['<p class="eyebrow">Mount Zara’s Reflections</p>',
         '<h1>Understand your body. Arrive prepared.</h1>',
         '<p class="dek">Free, guided courses on the conditions this practice treats — built from its reviewed patient library, one honest step at a time. No sign-up, no tracking: your progress stays on your device.</p>',
         '<ol class="mod-list">']
    for c in courses:
        b.append(f'<li><a href="{c["topic"]}/">'
                 f'<span class="m-name">{esc(c["title"])}</span>'
                 f'<span class="m-what">{esc(c["dek"])}</span></a></li>')
    b.append('</ol>')
    b.append('<p class="side-note">More conditions are on the way — each course goes through the same clinical review as everything else on this site.</p>')
    return page("Mount Zara's Reflections", "Reflections", "\n".join(b))

def main():
    courses = []
    for topic in sorted(os.listdir(os.path.join(ROOT, "education"))):
        mpath = os.path.join(ROOT, "education", topic, "course.json")
        if not os.path.exists(mpath):
            continue
        course = json.load(open(mpath, encoding="utf-8"))
        course["topic"] = topic
        courses.append(course)
        base = os.path.join(ROOT, "learn", topic)
        os.makedirs(base, exist_ok=True)
        open(os.path.join(base, "index.html"), "w", encoding="utf-8").write(render_course_home(course))
        qdir = os.path.join(base, "your-questions")
        os.makedirs(qdir, exist_ok=True)
        open(os.path.join(qdir, "index.html"), "w", encoding="utf-8").write(render_questions(course))
        flat = [(m, l) for m in course["modules"] for l in m["lessons"]]
        for i, (m, l) in enumerate(flat):
            d = os.path.join(base, str(m["n"]), l["slug"])
            os.makedirs(d, exist_ok=True)
            prev_url = f'../../{flat[i-1][0]["n"]}/{flat[i-1][1]["slug"]}/' if i > 0 else f'../../'
            next_url = f'../../{flat[i+1][0]["n"]}/{flat[i+1][1]["slug"]}/' if i + 1 < len(flat) else None
            open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(
                render_lesson(course, m, l, prev_url, next_url))
        print(f"  {topic}: {len(course['modules'])} modules, {len(flat)} lessons")
    os.makedirs(os.path.join(ROOT, "learn"), exist_ok=True)
    open(os.path.join(ROOT, "learn", "index.html"), "w", encoding="utf-8").write(render_catalog(courses))
    print(f"catalog: {len(courses)} course(s)")

main()
