#!/usr/bin/env python3
"""Generate /curriculum/cbg-migs/index.html from the FMIGS curriculum JSON.

This is the curriculum-page analogue of the education-page generators.
Reads `assets/curriculum/fmigs-cbg-migs.json` (which was extracted from
the source .doc by _extract_fmigs_curriculum.py) and renders a single
HTML page that:
  - opens with the abstract verbatim
  - shows the architecture as a 16-chapter TOC
  - renders each chapter with curated section narratives
  - inlines lists and key blocks where the source structures them
  - links to the source .doc for full download
  - includes a curriculum source manifest comment at the bottom
    (analogous to the §0.8.1 KB-anchor manifest in education pages)
"""
import json
import re
from pathlib import Path
from html import escape

REPO = Path("/Users/beans/Developer/MountZara/MIGS")
JSON = REPO / "assets" / "curriculum" / "fmigs-cbg-migs.json"
OUT = REPO / "curriculum" / "cbg-migs" / "index.html"

# Map chapter number -> presentation slot.
# - 'hero_abstract': ch 1 — verbatim Abstract block becomes the page lede.
# - 'narrative': render as section with section sub-blocks listed.
# - 'rotations': special handling (Clinical Rotations) — site list + summary.
# - 'didactics': special handling (Didactics) — list activities + monthly map.
# - 'research': special handling (Research Training) — module list.
# - 'compressed': render as collapsible <details> with bullets (long chapters).
CH_PRESENT = {
    1:  "hero_abstract",
    2:  "narrative",
    3:  "narrative",
    4:  "compressed",  # 26 sections of stakeholder bullets
    5:  "narrative",
    6:  "narrative",
    7:  "narrative",
    8:  "narrative",
    9:  "narrative",
    10: "narrative",
    11: "rotations",
    12: "didactics",
    13: "research",
    14: "narrative",
    15: "narrative",
    16: "compressed",  # Assessment Package — 41 sections, 2053 blocks
}


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60]


def render_block(b: dict) -> str:
    text = escape(b["text"])
    if b["kind"] == "list_item":
        return f'<li>{text}</li>'
    return f'<p>{text}</p>'


def render_section_narrative(s: dict, max_blocks: int = 99) -> str:
    """A section that renders as a heading + body. Blocks may be a mix of
    paragraphs and list items; we group consecutive list items into <ul>."""
    if not s.get("blocks"):
        return ""
    heading = escape(s["heading"]).rstrip(":")
    parts = [f'<h4>{heading}</h4>']
    in_list = False
    n = 0
    for b in s["blocks"]:
        if n >= max_blocks:
            break
        if b["kind"] == "list_item":
            if not in_list:
                parts.append("<ul>")
                in_list = True
            parts.append(f'<li>{escape(b["text"])}</li>')
        else:
            if in_list:
                parts.append("</ul>")
                in_list = False
            parts.append(f'<p>{escape(b["text"])}</p>')
        n += 1
    if in_list:
        parts.append("</ul>")
    return "\n".join(parts)


def render_chapter_narrative(c: dict) -> str:
    """Generic narrative chapter render: chapter heading + per-section blocks."""
    parts = []
    parts.append(f'<section class="ch" id="ch-{c["number"]}">')
    parts.append(f'<div class="ch-num">Chapter {c["number"]}</div>')
    parts.append(f'<h3>{escape(c["title"])}</h3>')
    for s in c["sections"]:
        # Skip the implicit "Overview" heading-label — its body becomes lead text.
        if s["heading"] == "Overview":
            for b in s["blocks"]:
                if b["kind"] == "list_item":
                    parts.append(f'<ul><li>{escape(b["text"])}</li></ul>')
                else:
                    parts.append(f'<p class="ch-lead">{escape(b["text"])}</p>')
        else:
            parts.append('<div class="sec">')
            parts.append(render_section_narrative(s))
            parts.append('</div>')
    parts.append("</section>")
    return "\n".join(parts)


def render_chapter_compressed(c: dict) -> str:
    """Chapters with many sections render as a <details> with section names + first-block summaries."""
    parts = []
    parts.append(f'<section class="ch" id="ch-{c["number"]}">')
    parts.append(f'<div class="ch-num">Chapter {c["number"]}</div>')
    parts.append(f'<h3>{escape(c["title"])}</h3>')

    # Show first overview as lead
    for s in c["sections"][:1]:
        if s["heading"] == "Overview":
            for b in s["blocks"][:2]:
                parts.append(f'<p class="ch-lead">{escape(b["text"])}</p>')

    parts.append(f'<details class="ch-expand"><summary>Expand the {len(c["sections"])} sub-sections</summary>')
    for s in c["sections"]:
        if s["heading"] == "Overview":
            continue
        heading = escape(s["heading"]).rstrip(":")
        parts.append(f'<div class="sec-compact"><strong>{heading}</strong>')
        # Show first block of each as the summary
        if s["blocks"]:
            first = s["blocks"][0]
            txt = escape(first["text"])
            if len(first["text"]) > 280:
                txt = txt[:280] + "…"
            parts.append(f' — <span class="sec-snippet">{txt}</span>')
        parts.append("</div>")
    parts.append("</details>")
    parts.append("</section>")
    return "\n".join(parts)


def render_chapter_rotations(c: dict) -> str:
    """Clinical Rotations chapter — show overview + Year 1 + Year 2 + per-site sub-headings as cards."""
    parts = []
    parts.append(f'<section class="ch" id="ch-{c["number"]}">')
    parts.append(f'<div class="ch-num">Chapter {c["number"]}</div>')
    parts.append(f'<h3>{escape(c["title"])}</h3>')
    for s in c["sections"][:6]:
        if s["heading"] == "Overview":
            for b in s["blocks"][:4]:
                parts.append(f'<p class="ch-lead">{escape(b["text"])}</p>')
        else:
            parts.append('<div class="sec">')
            parts.append(render_section_narrative(s, max_blocks=10))
            parts.append('</div>')
    # Site cards — pull any section whose heading mentions a hospital name.
    site_sections = [s for s in c["sections"] if any(k in s["heading"] for k in ("Hospital", "St.", "Saint", "Thorek", "UIC"))]
    if site_sections:
        parts.append('<h4>Hospital sites</h4>')
        parts.append('<div class="site-grid">')
        for s in site_sections[:8]:
            parts.append(f'<div class="site-card"><strong>{escape(s["heading"])}</strong>')
            if s["blocks"]:
                snippet = escape(s["blocks"][0]["text"][:240])
                parts.append(f'<p>{snippet}…</p>')
            parts.append("</div>")
        parts.append("</div>")
    parts.append("</section>")
    return "\n".join(parts)


def render_chapter_didactics(c: dict) -> str:
    """Didactics chapter — list activities + monthly didactic structure."""
    parts = []
    parts.append(f'<section class="ch" id="ch-{c["number"]}">')
    parts.append(f'<div class="ch-num">Chapter {c["number"]}</div>')
    parts.append(f'<h3>{escape(c["title"])}</h3>')
    activities_keep = {
        "Resident MIGS Didactics and Skills Labs",
        "Case Conferences",
        "Simulation Labs",
        "Journal Clubs and Research Meetings",
        "Conferences and Continuing Medical Education (CME)",
    }
    for s in c["sections"]:
        if s["heading"] == "Overview":
            for b in s["blocks"][:2]:
                parts.append(f'<p class="ch-lead">{escape(b["text"])}</p>')
        elif s["heading"] in activities_keep:
            parts.append('<div class="sec">')
            parts.append(render_section_narrative(s, max_blocks=6))
            parts.append('</div>')

    # Show monthly didactic plan as a 24-tile grid (months Aug-Jul × 2 years)
    month_sections = [s for s in c["sections"] if re.match(r"^[A-Z][a-z]+ \(Y[12]\)", s["heading"])]
    if month_sections:
        parts.append('<h4>Monthly didactic plan</h4>')
        parts.append('<p class="ch-note">24-month independent didactic plan — each month centers on a focused topic with assigned readings, SurgeryU videos, simulation training, case-based learning, and end-of-month assessment.</p>')
        parts.append('<div class="month-grid">')
        for s in month_sections[:24]:
            heading = escape(s["heading"]).replace(" (Y1)", "").replace(" (Y2)", "")
            year = "Y2" if "(Y2)" in s["heading"] else "Y1"
            parts.append(f'<div class="month-tile {year.lower()}"><span class="month-year">{year}</span><span class="month-name">{heading}</span></div>')
        parts.append('</div>')
    parts.append("</section>")
    return "\n".join(parts)


def render_chapter_research(c: dict) -> str:
    """Research Training chapter — show module list."""
    parts = []
    parts.append(f'<section class="ch" id="ch-{c["number"]}">')
    parts.append(f'<div class="ch-num">Chapter {c["number"]}</div>')
    parts.append(f'<h3>{escape(c["title"])}</h3>')
    for s in c["sections"][:1]:
        if s["heading"] == "Overview":
            for b in s["blocks"][:2]:
                parts.append(f'<p class="ch-lead">{escape(b["text"])}</p>')
    # Modules
    module_sections = [s for s in c["sections"] if re.match(r"^\d+\.\s+", s["heading"]) or "Module" in s["heading"]]
    if module_sections:
        parts.append('<h4>Research training modules</h4>')
        parts.append('<div class="module-grid">')
        for s in module_sections[:6]:
            heading = escape(s["heading"])
            parts.append(f'<div class="module-card"><strong>{heading}</strong>')
            if s["blocks"]:
                snippet = escape(s["blocks"][0]["text"][:200])
                parts.append(f'<p>{snippet}…</p>')
            parts.append("</div>")
        parts.append("</div>")
    parts.append("</section>")
    return "\n".join(parts)


def chapter_dispatch(c: dict) -> str:
    mode = CH_PRESENT.get(c["number"], "narrative")
    if mode == "hero_abstract":
        return ""  # rendered into hero, skip in body
    if mode == "compressed":
        return render_chapter_compressed(c)
    if mode == "rotations":
        return render_chapter_rotations(c)
    if mode == "didactics":
        return render_chapter_didactics(c)
    if mode == "research":
        return render_chapter_research(c)
    return render_chapter_narrative(c)


def main():
    data = json.loads(JSON.read_text())
    abstract = data["chapters"][0]["sections"][0]["blocks"][0]["text"]
    chapters_body = "\n".join(chapter_dispatch(c) for c in data["chapters"])

    # TOC
    toc_items = "\n".join(
        f'<a href="#ch-{c["number"]}" class="toc-item"><span class="toc-num">{c["number"]:02d}</span><span class="toc-title">{escape(c["title"])}</span></a>'
        for c in data["chapters"]
    )

    # Manifest comment (analogous to §0.8.1 KB-anchor manifest)
    manifest = {
        "source_doc": data["source_doc"],
        "source_path": data["source_path_in_repo"],
        "title": data["title"],
        "version": data["version"],
        "extracted_chapters": [c["title"] for c in data["chapters"]],
        "stats": data["stats"],
    }
    manifest_block = "<!-- curriculum source manifest -->\n<!-- " + json.dumps(manifest, indent=2) + " -->"

    html = HTML_TEMPLATE.format(
        title=escape(data["title"]),
        author=escape(data["author"]),
        institution=escape(data["institution"]),
        version=escape(data["version"]),
        abstract=escape(abstract),
        toc_items=toc_items,
        chapters_body=chapters_body,
        manifest_block=manifest_block,
        chapter_count=data["stats"]["chapters"],
        section_count=data["stats"]["sections"],
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html)
    print(f"wrote {OUT}  ({len(html):,} bytes)")


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>FMIGS Curriculum — {title} · Mount Zara</title>
    <meta name="description" content="Full curriculum design for the Fellowship in Minimally Invasive Gynecologic Surgery (FMIGS) at PRIME Illinois Saint Francis Hospital. Context analysis, stakeholders, needs assessment, goals, monthly didactic plan, clinical rotations across 5 sites, assessment design. By Christopher Z. Mabini, DO, MSAEd.">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="canonical" href="https://mountzara.com/curriculum/cbg-migs/">
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700&display=swap" rel="stylesheet">
    <style>
:root {{
    --bg-base: #07070a;
    --bg-card: rgba(255, 255, 255, 0.04);
    --border: rgba(255, 255, 255, 0.10);
    --fg-strong: #ffffff;
    --fg-mid: rgba(245, 245, 247, 0.84);
    --fg-soft: rgba(245, 245, 247, 0.62);
    --fg-dim: rgba(245, 245, 247, 0.42);
    --accent: #6d28d9;
    --accent-soft: #a78bfa;
    --glow-purple: 167, 139, 250;
}}
* {{ box-sizing: border-box; }}
html {{ scroll-behavior: smooth; }}
html, body {{
    margin: 0; padding: 0;
    background:
        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--glow-purple), 0.14), transparent 60%),
        var(--bg-base);
    color: var(--fg-mid);
    font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    line-height: 1.6;
}}
a {{ color: var(--accent-soft); text-decoration: none; transition: color 0.2s; }}
a:hover {{ color: var(--fg-strong); }}

.site-nav {{
    position: sticky; top: 0; z-index: 100;
    background: rgba(7, 7, 10, 0.86);
    backdrop-filter: blur(22px) saturate(165%);
    -webkit-backdrop-filter: blur(22px) saturate(165%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px clamp(16px, 4vw, 32px);
}}
.site-nav .inner {{ display: flex; align-items: center; gap: 14px; max-width: 1100px; margin: 0 auto; }}
.site-nav .brand {{ font-size: 13px; font-weight: 700; letter-spacing: 0.20em; text-transform: uppercase; color: rgba(var(--glow-purple), 0.95); }}
.site-nav .crumb {{ font-size: 12.5px; color: var(--fg-dim); }}
.site-nav .right-actions {{ margin-left: auto; display: flex; gap: 10px; align-items: center; }}
.site-nav .right-actions a {{ font-size: 12.5px; color: var(--fg-soft); }}
.site-nav .right-actions a:hover {{ color: var(--fg-strong); }}
.site-nav .cta {{
    background: rgba(var(--glow-purple), 0.16);
    border: 1px solid rgba(var(--glow-purple), 0.55);
    color: var(--accent-soft) !important;
    padding: 5px 14px; border-radius: 999px;
    font-weight: 500; transition: all 0.2s;
}}
.site-nav .cta:hover {{ background: rgba(var(--glow-purple), 0.26); color: #fff !important; transform: translateY(-1px); }}

.wrap {{ max-width: 1040px; margin: 0 auto; padding: clamp(28px, 5vw, 56px) clamp(18px, 5vw, 32px) 96px; }}
@keyframes mzRise {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: translateY(0); }} }}

.eyebrow {{ font-size: 11px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(var(--glow-purple), 0.95); margin-bottom: 14px; }}
.hero {{ margin-bottom: clamp(32px, 6vw, 56px); animation: mzRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }}
.hero h1 {{ font-weight: 200; font-size: clamp(30px, 5vw, 46px); letter-spacing: -0.022em; line-height: 1.08; color: var(--fg-strong); margin: 0 0 18px 0; max-width: 28ch; }}
.hero .author-line {{ font-size: 14px; color: var(--fg-soft); margin-bottom: 22px; }}
.hero .author-line strong {{ color: var(--fg-strong); font-weight: 500; }}

.abstract-block {{ padding: 26px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; backdrop-filter: blur(28px) saturate(165%); -webkit-backdrop-filter: blur(28px) saturate(165%); }}
.abstract-block .lbl {{ font-size: 10.5px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(var(--glow-purple), 0.95); margin-bottom: 12px; }}
.abstract-block p {{ font-size: 15.5px; line-height: 1.7; color: var(--fg-mid); margin: 0; }}

.download-row {{ display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 8px 0; }}
.dl-btn {{ display: inline-flex; align-items: center; gap: 8px; background: rgba(var(--glow-purple), 0.14); border: 1px solid rgba(var(--glow-purple), 0.45); color: var(--accent-soft); padding: 9px 18px; border-radius: 999px; font-size: 13.5px; font-weight: 500; transition: all 0.22s ease; }}
.dl-btn:hover {{ background: rgba(var(--glow-purple), 0.24); color: #fff; transform: translateY(-2px); }}

.toc {{ margin: 36px 0; padding: 24px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; }}
.toc h2 {{ margin: 0 0 14px 0; font-size: 16px; font-weight: 500; color: var(--fg-strong); letter-spacing: -0.005em; }}
.toc-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; }}
.toc-item {{ display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; border-radius: 10px; color: var(--fg-soft); transition: all 0.18s ease; font-size: 13.5px; }}
.toc-item:hover {{ background: rgba(var(--glow-purple), 0.08); color: var(--fg-strong); }}
.toc-num {{ font-size: 11px; font-weight: 600; color: var(--accent-soft); min-width: 22px; letter-spacing: 0.04em; }}
.toc-title {{ flex: 1; }}

.ch {{ margin: clamp(36px, 6vw, 56px) 0; animation: mzRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }}
.ch-num {{ font-size: 10.5px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(var(--glow-purple), 0.95); margin-bottom: 6px; }}
.ch h3 {{ font-weight: 300; font-size: clamp(22px, 3.2vw, 30px); letter-spacing: -0.014em; line-height: 1.18; color: var(--fg-strong); margin: 0 0 18px 0; }}
.ch-lead {{ font-size: 16px; line-height: 1.65; color: var(--fg-mid); margin: 0 0 16px 0; max-width: 70ch; }}
.ch h4 {{ margin: 28px 0 8px 0; color: var(--fg-strong); font-weight: 500; font-size: 16.5px; letter-spacing: -0.005em; }}
.ch p {{ font-size: 14.5px; line-height: 1.65; color: var(--fg-mid); margin: 0 0 12px 0; max-width: 72ch; }}
.ch ul {{ margin: 0 0 14px 0; padding-left: 22px; }}
.ch li {{ font-size: 14.5px; line-height: 1.6; color: var(--fg-mid); margin-bottom: 6px; }}

.sec {{ margin: 18px 0; padding: 20px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; transition: border-color 0.22s ease, background 0.22s ease; }}
.sec:hover {{ border-color: rgba(var(--glow-purple), 0.32); background: rgba(var(--glow-purple), 0.03); }}
.sec h4 {{ margin-top: 0; }}

.ch-expand {{ margin-top: 14px; padding: 16px 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }}
.ch-expand summary {{ cursor: pointer; color: var(--accent-soft); font-weight: 500; font-size: 14px; padding: 4px 0; outline: none; }}
.ch-expand summary:hover {{ color: var(--fg-strong); }}
.sec-compact {{ padding: 10px 0; font-size: 14px; line-height: 1.55; color: var(--fg-mid); border-top: 1px solid rgba(255,255,255,0.05); }}
.sec-compact:first-of-type {{ border-top: none; padding-top: 14px; }}
.sec-compact strong {{ color: var(--fg-strong); font-weight: 500; }}
.sec-snippet {{ color: var(--fg-soft); font-size: 13.5px; }}

.site-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 14px 0; }}
.site-card {{ padding: 16px; background: rgba(var(--glow-purple), 0.05); border: 1px solid rgba(var(--glow-purple), 0.22); border-radius: 12px; }}
.site-card strong {{ display: block; color: var(--fg-strong); font-weight: 500; font-size: 14.5px; margin-bottom: 6px; }}
.site-card p {{ font-size: 13px; line-height: 1.55; color: var(--fg-soft); margin: 0; }}

.month-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 12px; }}
.month-tile {{ padding: 12px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; display: flex; align-items: baseline; gap: 8px; transition: all 0.22s ease; }}
.month-tile:hover {{ transform: translateY(-2px); border-color: rgba(var(--glow-purple), 0.45); }}
.month-tile.y2 {{ background: rgba(var(--glow-purple), 0.06); border-color: rgba(var(--glow-purple), 0.28); }}
.month-year {{ font-size: 10px; font-weight: 700; color: var(--accent-soft); letter-spacing: 0.08em; }}
.month-name {{ font-size: 13px; color: var(--fg-strong); }}

.module-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-top: 14px; }}
.module-card {{ padding: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; }}
.module-card strong {{ display: block; color: var(--fg-strong); font-weight: 500; font-size: 15px; margin-bottom: 6px; }}
.module-card p {{ font-size: 13px; line-height: 1.55; color: var(--fg-soft); margin: 0; }}

.ch-note {{ font-size: 13px; color: var(--fg-soft); font-style: italic; margin: 4px 0 14px 0; }}

.cta-block {{ margin-top: clamp(48px, 7vw, 72px); padding: clamp(28px, 4vw, 40px); background: linear-gradient(135deg, rgba(var(--glow-purple), 0.08), rgba(var(--glow-purple), 0.04)); border: 1px solid rgba(var(--glow-purple), 0.32); border-radius: 18px; backdrop-filter: blur(28px) saturate(165%); text-align: center; }}
.cta-block h3 {{ margin: 0 0 10px 0; color: var(--fg-strong); font-weight: 300; font-size: clamp(20px, 2.8vw, 26px); letter-spacing: -0.012em; }}
.cta-block p {{ margin: 0 0 22px 0; color: var(--fg-mid); font-size: 15px; max-width: 56ch; margin-left: auto; margin-right: auto; }}
.cta-block a.btn {{ display: inline-flex; align-items: center; gap: 8px; background: rgba(var(--glow-purple), 0.22); border: 1px solid rgba(var(--glow-purple), 0.55); color: var(--fg-strong); padding: 12px 26px; border-radius: 999px; font-weight: 500; font-size: 14.5px; transition: all 0.22s ease; }}
.cta-block a.btn:hover {{ background: rgba(var(--glow-purple), 0.34); transform: translateY(-2px); }}

.foot {{ margin-top: 56px; padding-top: 26px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 12.5px; color: var(--fg-dim); }}
.foot a {{ color: var(--fg-soft); }}

@media (prefers-reduced-motion: reduce) {{
    *, *::before, *::after {{
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
    }}
}}
a:focus-visible, .dl-btn:focus-visible, .toc-item:focus-visible, .ch-expand summary:focus-visible, .cta-block a.btn:focus-visible {{
    outline: 2px solid rgba(var(--glow-purple), 0.75); outline-offset: 2px; border-radius: 8px;
}}
.skip-link {{ position: absolute; left: -9999px; top: 8px; background: rgba(var(--glow-purple), 0.95); color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 200; }}
.skip-link:focus {{ left: 16px; }}
    </style>
</head>
<body>
    <a href="#main" class="skip-link">Skip to main content</a>

    <nav class="site-nav" aria-label="Primary">
        <div class="inner">
            <a href="/" class="brand">Mount Zara</a>
            <span class="crumb">· <a href="/curriculum/" style="color: inherit;">Curriculum Consulting</a> · CBG/MIGS Fellowship</span>
            <div class="right-actions">
                <a href="/curriculum/">All Curricula</a>
                <a href="mailto:info@mountzara.com" class="cta">Engage</a>
            </div>
        </div>
    </nav>

    <main id="main" class="wrap">

        <header class="hero">
            <div class="eyebrow">Curriculum Design Case Study · Fellowship · 2-year</div>
            <h1>{title}</h1>
            <p class="author-line">
                <strong>{author}</strong> · {institution} · {version} · {chapter_count} chapters, {section_count} sections
            </p>
            <div class="download-row">
                <a class="dl-btn" href="/assets/curriculum/fmigs-curriculum-2024-v3.doc" download>
                    Download source .doc (1.2 MB)
                </a>
                <a class="dl-btn" href="/assets/curriculum/fmigs-cbg-migs.json" target="_blank" rel="noopener">
                    View structured JSON outline
                </a>
            </div>
        </header>

        <div class="abstract-block">
            <div class="lbl">Abstract</div>
            <p>{abstract}</p>
        </div>

        <nav class="toc" aria-labelledby="toc-heading">
            <h2 id="toc-heading">Architecture — full {chapter_count}-chapter outline</h2>
            <div class="toc-grid">
                {toc_items}
            </div>
        </nav>

        {chapters_body}

        <div class="cta-block">
            <h3>This is what a complete curriculum design package looks like.</h3>
            <p>If your fellowship, residency, or training program needs this level of architecture — built from the same end-to-end instructional-design methodology — let's talk about scope.</p>
            <a href="mailto:info@mountzara.com?subject=Curriculum%20design%20consult%20(FMIGS%20reference)" class="btn">Email info@mountzara.com →</a>
        </div>

        <div class="foot">
            <p>
                Christopher Z. Mabini, DO, MSAEd — Inaugural FMIGS Fellow at PRIME Illinois Saint Francis Hospital.
                Source document: <code>FMIGS Curriculum 2024 V3 7-24-25.doc</code> (v3, July 2025).
                <a href="/curriculum/">All curricula</a> · <a href="/about/">About</a> · <a href="/cv/#curriculum">CV</a>
            </p>
        </div>

    </main>

    {manifest_block}
</body>
</html>
"""


if __name__ == "__main__":
    main()
