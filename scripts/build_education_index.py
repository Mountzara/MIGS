#!/usr/bin/env python3
"""Keep the guide index honest: the "N sources cited · ~M min read" line on
every card of education/index.html is recomputed from the live guide files.

Each <a class="topic-card"> carries <span class="topic-meta"
data-topic-meta="<slug>">. This rewrites that span's text from the guide's
<li id="ref-N"> count and its stripped prose (230 words/min, floor of three
minutes), and fails if a guide directory has no card or a card has no guide,
so the index and the tree cannot drift apart silently.

    python3 scripts/build_education_index.py          # rewrite in place
    python3 scripts/build_education_index.py --check  # exit 1 if stale

Run it after any topic rewrite, then commit the index with the topic.
"""
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "education", "index.html")
WPM = 230


class Visible(HTMLParser):
    """Text a reader sees: no scripts, styles, templates, collapsed abstracts, chrome."""
    SKIP = ("script", "style", "template", "noscript", "details", "nav", "footer")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.out.append(data)


def meta_for(slug):
    src = open(os.path.join(ROOT, "education", slug, "index.html"), encoding="utf-8").read()
    refs = len(re.findall(r'<li id="ref-\d+">', src))
    body = re.sub(r'<span class="mz-ref-pop".*?</span></sup>', "</sup>", src, flags=re.S)
    v = Visible()
    v.feed(body)
    words = len(re.findall(r"[A-Za-z][A-Za-z'’-]+", " ".join(v.out)))
    return refs, max(3, round(words / WPM))


def main():
    check = "--check" in sys.argv
    html = open(INDEX, encoding="utf-8").read()
    cards = re.findall(r'data-topic-meta="([a-z-]+)"', html)
    dirs = sorted(d for d in os.listdir(os.path.join(ROOT, "education"))
                  if not d.startswith("_") and os.path.isfile(os.path.join(ROOT, "education", d, "index.html")))
    missing = sorted(set(dirs) - set(cards))
    extra = sorted(set(cards) - set(dirs))
    if missing or extra:
        print(f"education index: guides without a card {missing}; cards without a guide {extra}")
        return 1
    out = html
    changed = []
    for slug in cards:
        refs, mins = meta_for(slug)
        line = f"{refs} sources cited &middot; ~{mins} min read"
        pat = re.compile(r'(<span class="topic-meta" data-topic-meta="%s">)(.*?)(</span>)' % re.escape(slug), re.S)
        m = pat.search(out)
        if m.group(2) != line:
            changed.append(f"{slug}: {m.group(2)!r} -> {line!r}")
            out = out[:m.start(2)] + line + out[m.end(2):]
    if not changed:
        print(f"education index: {len(cards)} cards already current")
        return 0
    if check:
        print("education index: STALE\n  " + "\n  ".join(changed))
        return 1
    open(INDEX, "w", encoding="utf-8").write(out)
    print(f"education index: rewrote {len(changed)} card(s)\n  " + "\n  ".join(changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
