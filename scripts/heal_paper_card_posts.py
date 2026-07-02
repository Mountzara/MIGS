#!/usr/bin/env python3
"""
heal_paper_card_posts.py — convert a stale "paper-card" auto-draft post
into the canonical mz-cite-card format, DOM-level (bs4), losslessly.

Context: the MountZaraResearchDigest pipeline regressed (2026-05-26) and
emitted W23/W24/W25 in a stripped paper-card scaffold (own nav +
cinematic-intro + paper-card articles) instead of the canonical
mz-cite-card renderer the site expects. This tool re-skins such a post:
reuses a KNOWN-GOOD canonical post's <style> + openDeepDive script,
drops the redundant fixed scaffold, converts each paper-card into an
mz-cite-card (design badge, title, meta, DO+CBG/MIGS lens, abstract
<details>, PubMed link fixed from DOI→PMID, deep-dive trigger), and
preserves EVERY deep-dive modal and PMID verbatim.

Usage:
  python3 scripts/heal_paper_card_posts.py --reference-id blog-2026-W21 \
      --in stale.json --out healed.json            # convert one file
  python3 scripts/heal_paper_card_posts.py --reference-id blog-2026-W21 \
      --in stale.json --print-stats                # validate only

Writing the healed object to R2 (operator, needs CF creds sourced):
  curl -X PUT ".../r2/buckets/mountzara-content/objects/posts/<id>.json" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --data-binary @healed.json

Validated 2026-07-02 on the live W23/W24/W25 corpus: 0 paper-cards out,
all modal ids + PMIDs preserved, deploy-gate clean, renders canonically.
"""
import argparse, json, re, sys, urllib.request
from bs4 import BeautifulSoup

def fetch_reference_style(reference_id):
    url = f"https://mountzara.com/api/posts/{reference_id}"
    with urllib.request.urlopen(url, timeout=30) as r:
        d = json.loads(r.read().decode())
    p = d.get("post", d)
    ref = BeautifulSoup(p["body_html"], "html.parser")
    if ref.find("style") is None or ref.count("mz-cite-card") == 0:
        sys.exit(f"reference {reference_id} is not a canonical mz-cite-card post")
    return str(ref.find("style")), str(ref.find("script"))

def pmid_from_card(card):
    for el in card.find_all(attrs={"onclick": True}):
        m = re.search(r"openDeepDive\('dd-(\d+)'", el.get("onclick", ""))
        if m: return m.group(1)
    for el in card.find_all(attrs={"aria-controls": True}):
        m = re.search(r"dd-(\d+)", el.get("aria-controls", ""))
        if m: return m.group(1)
    a = card.select_one("a")
    if a:
        m = re.search(r"PMID\s+(\d+)", a.get_text())
        if m: return m.group(1)
    return None

def convert_card(soup, card):
    pmid = pmid_from_card(card)
    title = card.select_one("h3.title, h3")
    citation = card.select_one(".citation")
    badges = card.select_one(".badges")
    design = None
    if badges:
        b = badges.select_one(".badge:not(.size)") or badges.select_one(".badge")
        if b: design = b.get_text(" ", strip=True)
    abstract_blocks = card.select(".abstract-block")
    lens = card.select_one(".lens-callout")
    new = soup.new_tag("article", **{"class": "mz-cite-card"})
    if pmid: new["id"] = "mz-cite-%s" % pmid
    head = soup.new_tag("div", **{"class": "mz-cite-head"})
    dspan = soup.new_tag("span", **{"class": "mz-cite-design"}); dspan.string = design or "Peer-reviewed study"
    head.append(dspan); new.append(head)
    if title:
        h3 = soup.new_tag("h3", **{"class": "mz-cite-title"})
        for c in list(title.contents): h3.append(c)
        new.append(h3)
    if citation:
        pm = soup.new_tag("p", **{"class": "mz-cite-meta"})
        for c in list(citation.contents): pm.append(c)
        new.append(pm)
    if lens:
        lt = lens.select_one(".lens-text")
        if lt:
            fits = soup.new_tag("p", **{"class": "mz-cite-fits"})
            strong = soup.new_tag("strong"); strong.string = "DO + CBG/MIGS lens: "; fits.append(strong)
            for c in list(lt.contents): fits.append(c)
            new.append(fits)
    if abstract_blocks:
        det = soup.new_tag("details", **{"class": "mz-abstract"})
        summ = soup.new_tag("summary"); summ.string = "Read the full abstract"; det.append(summ)
        for ab in abstract_blocks:
            for c in list(ab.contents): det.append(c)
        new.append(det)
    actions = soup.new_tag("div", **{"class": "mz-cite-actions"})
    if pmid:
        a = soup.new_tag("a", **{"class": "mz-cite-pmid", "href": "https://pubmed.ncbi.nlm.nih.gov/%s/" % pmid,
                                 "target": "_blank", "rel": "noopener noreferrer"})
        a.string = "PubMed · PMID %s ↗" % pmid; actions.append(a)
        btn = soup.new_tag("button", **{"class": "mz-deepdive-trigger", "type": "button",
                                        "onclick": "openDeepDive('dd-%s')" % pmid,
                                        "aria-haspopup": "dialog", "aria-controls": "dd-%s" % pmid})
        btn.string = "Open deep dive · journal-club analysis"; actions.append(btn)
    new.append(actions)
    card.replace_with(new)
    return pmid

def convert(body_html, canon_style, canon_script):
    soup = BeautifulSoup(body_html, "html.parser")
    old = soup.find("style")
    canon = BeautifulSoup(canon_style, "html.parser").find("style")
    (old.replace_with(canon) if old else soup.insert(0, canon))
    for sel in ["nav.main-nav", ".cinematic-intro", ".progress-bar", ".scroll-progress"]:
        for el in soup.select(sel): el.decompose()
    for card in soup.select("article.paper-card"): convert_card(soup, card)
    if not soup.select_one(".mz-post-wrap"):
        wrap = soup.new_tag("div", **{"class": "mz-post-wrap"})
        movers = [ch for ch in soup.find_all(recursive=False) if ch.name not in ("style", "script", "dialog")]
        if movers:
            movers[0].insert_before(wrap)
            for m in movers: wrap.append(m.extract())
    for sec in soup.select(".topic-section, section"):
        cl = sec.get("class") or []
        if "mz-post-wrap" in cl or any(c.startswith("mz-") for c in cl): continue
        sec["class"] = list(dict.fromkeys(list(cl) + ["mz-post-section"]))
    for sc in soup.find_all("script"): sc.decompose()
    soup.append(BeautifulSoup(canon_script, "html.parser").find("script"))
    return str(soup)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference-id", default="blog-2026-W21")
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out")
    ap.add_argument("--print-stats", action="store_true")
    a = ap.parse_args()
    style, script = fetch_reference_style(a.reference_id)
    d = json.load(open(a.inp)); post = d.get("post", d)
    before = post["body_html"]
    after = convert(before, style, script)
    def dds(h): return sorted(set(re.findall(r'dialog[^>]*id="(dd-\d+)"', h)) | set(re.findall(r"id=\"(dd-\d+)\"", h)))
    def pm(h): return sorted(set(re.findall(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", h)) | set(re.findall(r"openDeepDive\('dd-(\d+)'", h)))
    canonical = after.count("mz-cite-card") > 0 and after.count("paper-card") == 0
    lost = set(pm(before)) - set(pm(after))
    print(f"paper-card {before.count('paper-card')}→{after.count('paper-card')} | "
          f"mz-cite-card {before.count('mz-cite-card')}→{after.count('mz-cite-card')} | "
          f"PMIDs lost={sorted(lost)[:5]} | canonical={canonical}", file=sys.stderr)
    if not canonical or lost:
        sys.exit("REFUSING to write: conversion not lossless/canonical")
    if a.out and not a.print_stats:
        post["body_html"] = after
        json.dump(post, open(a.out, "w"))
        print(a.out)

if __name__ == "__main__":
    main()
