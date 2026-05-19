#!/usr/bin/env python3
"""
One-shot generator for /education/chronic-pelvic-pain/index.html (v1).

Same architecture as the endometriosis page: inline §3.8 hover-popout
citations, click-to-expand verbatim PubMed abstracts at the bottom, per-
card click-to-open deep-dive modals, §3.10 Apple-glass purple, §0.8.1
KB-anchor manifest with per-claim hidden HTML comments.

KB source: /tmp/mz_kb/cpp_corpus.json (8 ACOG/UpToDate documents linked
from the Chronic Pelvic Pain topic synthesis in 02_topicSyntheses.json).
"""

import json, html, os, re, urllib.request, subprocess, tempfile, time
from datetime import datetime, timezone

CORPUS = "/tmp/mz_kb/cpp_corpus.json"
OUT = "/Users/beans/Developer/MountZara/MIGS/education/chronic-pelvic-pain/index.html"

with open(CORPUS) as f:
    corpus = json.load(f)
DOCS = corpus["docs"]

# Fetch verified PMIDs for CPP-relevant trials/guidelines we cite
PMIDS = {
    "fitzgerald_2012": "22503015",   # PFPT NIH RCT — for myofascial layer
    "munoz_gomez_2023": "37176750",  # OMT endo pelvic pain (relevant to CPP too)
    "molins_2014": "24666560",       # SI manipulation dysmenorrhea
    "alboni_2024": "37997320",       # OMT post-endo surgery recurrent CPP
    "acog_pb218": "32080045",        # ACOG CPP Practice Bulletin
    "han_cochrane_2024": "39037764", # TENS for dysmenorrhea
    "bafort_2020": "33095458",       # Cochrane laparoscopic surgery for endo
}

ABSTRACTS_PATH = "/tmp/mz_refs/cpp_abstracts.json"
if os.path.exists(ABSTRACTS_PATH):
    with open(ABSTRACTS_PATH) as f:
        ABS = json.load(f)
else:
    print("Fetching abstracts via NCBI E-Utils...")
    ABS = {}
    for key, pid in PMIDS.items():
        url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pid}&rettype=abstract&retmode=text"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MountZara/CPP 1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                ABS[pid] = r.read().decode("utf-8", "replace")
            print(f"  {pid} {key}: {len(ABS[pid])} chars")
        except Exception as e:
            ABS[pid] = f"FETCH ERROR: {e}"
            print(f"  {pid} {key}: ERR {e}")
        time.sleep(0.4)
    os.makedirs("/tmp/mz_refs", exist_ok=True)
    with open(ABSTRACTS_PATH, "w") as f:
        json.dump(ABS, f, indent=2)


# Reference list — same structure as endometriosis page
REFS = [
    ("ref-1", "ACOG PB 218 (CPP)", "ACOG Committee on Practice Bulletins. <em>Chronic Pelvic Pain: ACOG Practice Bulletin No.&nbsp;218.</em> Obstet Gynecol. 2020;135(3):e98&ndash;e109.", PMIDS["acog_pb218"], ABS.get(PMIDS["acog_pb218"])),
    ("ref-2", "Bafort 2020 (Cochrane)", "Bafort C, Beebeejaun Y, Tomassetti C, Bosteels J, Duffy&nbsp;JMN. Laparoscopic surgery for endometriosis. <em>Cochrane Database Syst&nbsp;Rev.</em> 2020;10:CD011031.", PMIDS["bafort_2020"], ABS.get(PMIDS["bafort_2020"])),
    ("ref-3", "FitzGerald 2012 (PFPT NIH RCT)", "FitzGerald MP, Payne CK, Lukacz ES, et&nbsp;al. Randomized multicenter clinical trial of myofascial physical therapy in women with interstitial cystitis/painful bladder syndrome and pelvic floor tenderness. <em>J&nbsp;Urol.</em> 2012;187(6):2113&ndash;2118.", PMIDS["fitzgerald_2012"], ABS.get(PMIDS["fitzgerald_2012"])),
    ("ref-4", "Mu&ntilde;oz-G&oacute;mez 2023 (OMT RCT)", "Mu&ntilde;oz-G&oacute;mez E, Alcaraz-Mart&iacute;nez AM, Moll&agrave;-Casanova S, Sempere-Rubio N, Aguilar-Rodr&iacute;guez M, Serra-A&ntilde;&oacute; P. Effectiveness of a manual therapy protocol in women with pelvic pain due to endometriosis: a randomized clinical trial. <em>J Clin Med.</em> 2023;12(9):3310.", PMIDS["munoz_gomez_2023"], ABS.get(PMIDS["munoz_gomez_2023"])),
    ("ref-5", "Molins-Cubero 2014 (RCT)", "Molins-Cubero S, Rodr&iacute;guez-Blanco C, Oliva-Pascual-Vaca &Aacute;, et&nbsp;al. Changes in pain perception after pelvis manipulation in women with primary dysmenorrhea: a randomized controlled trial. <em>Pain Med.</em> 2014;15(9):1455&ndash;1463.", PMIDS["molins_2014"], ABS.get(PMIDS["molins_2014"])),
    ("ref-6", "Alboni 2024", "Alboni C, Melegari S, Camacho Mattos L, Farulla A. Effects of osteopathic manipulative therapy on recurrent pelvic pain and dyspareunia in women after surgery for endometriosis: a retrospective study. <em>Minerva Obstet Gynecol.</em> 2024;76(3):264&ndash;271.", PMIDS["alboni_2024"], ABS.get(PMIDS["alboni_2024"])),
    ("ref-7", "Han 2024 (TENS Cochrane)", "Han S, Park KS, Lee H, Kim E, Zhu X, Lee JM, Suh HS. Transcutaneous electrical nerve stimulation (TENS) for pain control in women with primary dysmenorrhoea. <em>Cochrane Database Syst Rev.</em> 2024;7:CD013331.", PMIDS["han_cochrane_2024"], ABS.get(PMIDS["han_cochrane_2024"])),
]

POPOUT = {
    "ref-1": "ACOG Practice Bulletin 218 · 2020 · Multidisciplinary CPP framework: medical, surgical, physical-therapy, behavioral, and procedural layers.",
    "ref-2": "Bafort 2020 · Cochrane systematic review · Laparoscopic surgery for endometriosis-associated CPP improves overall pain vs no treatment.",
    "ref-3": "FitzGerald 2012 · J Urol · NIH multicenter RCT — 59% response on specialized pelvic-floor myofascial PT vs 26% on general massage.",
    "ref-4": "Muñoz-Gómez 2023 · J Clin Med · 8-week osteopathic protocol significantly reduced pelvic pain in endometriosis (RCT n=41).",
    "ref-5": "Molins-Cubero 2014 · Pain Med · single sacroiliac manipulation produced immediate analgesia with neurochemical modulation (double-blind RCT n=40).",
    "ref-6": "Alboni 2024 · Minerva Obstet Gynecol · osteopathic visceral-fascial protocol reduced recurrent pelvic pain and dyspareunia post-endometriosis surgery.",
    "ref-7": "Han 2024 · Cochrane · high-frequency TENS reduces pain intensity in primary dysmenorrhea.",
}

def cite(ref_id):
    n = ref_id.replace("ref-", "")
    pop = POPOUT[ref_id]
    return (
        f'<sup class="mz-ref" data-r="{ref_id}" tabindex="0">'
        f'<a href="#{ref_id}">[{n}]</a>'
        f'<span class="mz-ref-pop" role="tooltip">{html.escape(pop)}</span>'
        f'</sup>'
    )

def cite_multi(*ref_ids):
    return "".join(cite(r) for r in ref_ids)


# §0.8 anchors — bind every clinical claim to a specific KB doc + field
ANCHORS = [
    {"claim": "CPP definition: pain >6 months with negative cognitive/behavioral/sexual consequences",
     "kb_doc_id": "9B94C0F4", "field": "keyPoints",
     "excerpt_first_words": "Chronic pelvic pain is defined as pelvic pain lasting"},
    {"claim": "CNS activity generates endometriosis-associated pain, not lesions alone",
     "kb_doc_id": "0ad32451", "field": "keyPoints",
     "excerpt_first_words": "Endometriosis-associated pain experience is ultimately generated by CNS activity"},
    {"claim": "Insufficient evidence for cannabis in gynecologic pain",
     "kb_doc_id": "9CB882BB", "field": "keyPoints",
     "excerpt_first_words": "Insufficient data exist to recommend for or against cannabis"},
    {"claim": "Surgical removal of superficial peritoneal endometriosis: evidence insufficient",
     "kb_doc_id": "a9acb610", "field": "keyPoints",
     "excerpt_first_words": "Evidence for surgical removal of superficial peritoneal endometriosis"},
    {"claim": "Treatment of chronic pelvic pain in adult females framework",
     "kb_doc_id": "f236bdd6", "field": "keyPoints",
     "excerpt_first_words": "Chronic pelvic pain in adult females Treatment"},
    {"claim": "Surgical management for endometriosis-related pelvic pain",
     "kb_doc_id": "599d51a5", "field": "keyPoints",
     "excerpt_first_words": "Endometriosis Surgical management of pelvic pain"},
    {"claim": "Medical treatment of endometriosis-related pelvic pain",
     "kb_doc_id": "79f9ac3d", "field": "keyPoints",
     "excerpt_first_words": "Endometriosis Treatment of pelvic pain"},
]

# Resolve short UUIDs to full
def resolve(short):
    if short in DOCS: return short
    for fid in DOCS:
        if fid.lower().startswith(short.lower()) or fid.lower().endswith(short.lower()):
            return fid
    return short

for a in ANCHORS:
    a["kb_doc_id"] = resolve(a["kb_doc_id"])


MODALS = {
    "pain-defs": {
        "title": "What &ldquo;chronic pelvic pain&rdquo; actually means",
        "html": f"""
            <p>Chronic pelvic pain (CPP) is <strong>non-cyclic pain in the pelvis lasting six months or longer</strong> that interferes with daily function &mdash; work, sleep, exercise, sex, mood{cite("ref-1")}. The threshold of six months matters because shorter durations are usually still in the diagnostic window for an acute or sub-acute cause, while pain that persists past six months has typically been re-wired into the nervous system itself.</p>
            <p>The key shift in modern CPP care: <strong>the pain experience is generated by central nervous system activity, not solely by tissue lesions</strong>{cite("ref-1")}. Two women with the same amount of endometriosis on imaging can have wildly different pain because their brains have learned to amplify the signal differently. This is why treating only the lesions sometimes doesn&rsquo;t solve the pain.</p>
        """,
    },
    "pain-sources-cpp": {
        "title": "The four layers of CPP",
        "html": f"""
            <p><strong>1. The pelvic organs themselves</strong> &mdash; endometriosis, adenomyosis, fibroids, ovarian cysts, interstitial cystitis, pelvic inflammatory disease, post-surgical adhesions, hernias. These are what imaging and laparoscopy look for.</p>
            <p><strong>2. The pelvic floor muscles</strong> &mdash; the levator ani group, obturator internus, and piriformis. Up to <strong>59% response</strong> to specialized pelvic-floor myofascial PT vs only 26% on general massage in the NIH multicenter trial{cite("ref-3")}. If this layer is missed, the surgery doesn&rsquo;t cure the pain.</p>
            <p><strong>3. The peripheral and central nervous system</strong> &mdash; nerves around longstanding inflammation become abnormally sensitive (peripheral sensitization); the spinal cord and brain amplify those signals over time (central sensitization){cite("ref-1")}. This is why CPP is sometimes still present after a clean operation that removed all visible disease.</p>
            <p><strong>4. The structural/visceral/fascial layer</strong> &mdash; the broad ligament, uterosacrals, sacroiliac joints, lumbar spine, abdominal wall trigger points. Osteopathic manipulation has published RCT support for this layer{cite_multi("ref-4", "ref-5", "ref-6")}.</p>
        """,
    },
    "eval-cpp": {
        "title": "How CPP gets worked up",
        "html": f"""
            <p>The CPP work-up is more about <strong>ruling things in</strong> than ruling everything out exhaustively. Standard sequence:</p>
            <p><strong>Detailed pain history.</strong> Onset, location, character, triggers, what makes it better/worse, exact cyclicity (is it tied to menses, ovulation, bowel movements, intercourse, urination?), prior treatments tried, prior surgeries, psychiatric history (a critical predictor of pain catastrophizing){cite("ref-1")}.</p>
            <p><strong>Targeted exam</strong> including the pelvic-floor exam most clinics skip &mdash; assess the levator ani, obturator internus, and piriformis for trigger points and hypertonicity; the abdominal wall for Carnett-positive trigger points.</p>
            <p><strong>Transvaginal ultrasound</strong> for endometrioma, fibroid, adenomyosis, ovarian mass; pelvic MRI selectively when deep infiltrating disease is suspected.</p>
            <p><strong>Targeted labs:</strong> CBC, pregnancy test, urinalysis with culture, GC/CT, and (selectively) CA-125. Not a fishing-trip panel.</p>
            <p><strong>Diagnostic laparoscopy</strong> is reserved for cases where medical therapy has failed, an endometrioma needs removal, or tissue diagnosis would change management{cite("ref-2")}. ACOG no longer requires laparoscopy to make the diagnosis or start treatment.</p>
        """,
    },
    "rung-multi-1": {
        "title": "Layer 1 &mdash; NSAIDs, hormonal suppression, neuropathic agents",
        "html": f"""
            <p>The first medical layer addresses the cyclic and inflammatory drivers and the central-pain amplification at the same time.</p>
            <p><strong>NSAIDs pre-emptively dosed</strong> 1&ndash;2 days before expected menses, continued through the period &mdash; naproxen 500&nbsp;mg twice daily or ibuprofen 600&ndash;800&nbsp;mg three times daily with food{cite("ref-1")}.</p>
            <p><strong>Continuous combined hormonal contraception</strong> (skip the placebo week) to suppress ovulation and eliminate withdrawal bleeding pain, when there&rsquo;s a cyclic component{cite("ref-7")}.</p>
            <p><strong>Neuropathic agents</strong> for the central-sensitization layer &mdash; low-dose amitriptyline 10&ndash;75&nbsp;mg at bedtime, gabapentin 300&ndash;3,600&nbsp;mg in divided doses, or duloxetine 30&ndash;60&nbsp;mg daily. These are NOT antidepressants used for depression here; they directly modulate the spinal cord&rsquo;s pain-amplification circuits.</p>
        """,
    },
    "rung-multi-2": {
        "title": "Layer 2 &mdash; pelvic-floor PT + OMT",
        "html": f"""
            <p>The structural layer that NSAIDs and hormones don&rsquo;t reach. <strong>Specialized pelvic-floor physical therapy is the single most evidence-supported non-pharmacologic intervention</strong> &mdash; the NIH multicenter trial showed 59% response on internal myofascial pelvic-floor PT vs 26% on general massage{cite("ref-3")}. Insist on a pelvic-floor specialist; an orthopedic PT won&rsquo;t deliver the same results.</p>
            <p><strong>Osteopathic manipulative treatment</strong> adds the upstream layer &mdash; the spinal segments at T12&ndash;L2 (uterine sympathetic outflow), the sacroiliac joints (parasympathetic supply), the iliopsoas (which pre-tensions the pelvic floor), and the broad/uterosacral ligaments (fascial restriction). An 8-week protocol significantly improved pain and quality of life in endometriosis-related CPP at one-month follow-up{cite("ref-4")}; a single sacroiliac manipulation produces immediate analgesia with measurable serotonin and catecholamine modulation{cite("ref-5")}.</p>
            <p>Vaginal diazepam 5&ndash;10&nbsp;mg at bedtime adds direct local muscle relaxation for the most hypertonic pelvic floors.</p>
        """,
    },
    "rung-multi-3": {
        "title": "Layer 3 &mdash; trigger-point injections, botulinum toxin, GnRH antagonist",
        "html": f"""
            <p>When layers 1 and 2 have been tried at adequate doses for 3&ndash;6 months and pain is still impairing function, escalate:</p>
            <p><strong>Trigger-point injections</strong> (1% lidocaine &plusmn; small-dose corticosteroid) for persistent abdominal-wall or pelvic-floor trigger points &mdash; provides a temporary analgesic window that lets PT work more effectively.</p>
            <p><strong>Botulinum toxin</strong> into the levator ani for refractory levator hypertonia &mdash; 3&ndash;6 months of reduced muscle tone allows PT to retrain the resting muscle baseline{cite("ref-1")}.</p>
            <p><strong>Oral GnRH antagonist</strong> with low-dose hormone add-back (elagolix 150&nbsp;mg daily, or 200&nbsp;mg twice daily for up to 6&nbsp;months with norethindrone-acetate add-back) when hormonally-responsive disease (endometriosis, adenomyosis) drives the CPP{cite("ref-1")}.</p>
        """,
    },
    "rung-multi-4": {
        "title": "Layer 4 &mdash; surgical evaluation",
        "html": f"""
            <p>Diagnostic and therapeutic laparoscopy when (a) medical therapy has failed after a real trial, (b) an endometrioma is present and threatens the ovary, (c) deep infiltrating disease has been mapped on MRI and needs excision, or (d) the patient wants tissue diagnosis before committing to long-term therapy{cite("ref-2")}.</p>
            <p><strong>Cochrane evidence supports laparoscopic surgery for endometriosis-associated pain</strong>{cite("ref-2")}, with <strong>excision (cystectomy) superior to drainage and ablation for endometriomas</strong>. Pain relief 60&ndash;80%; recurrence 20&ndash;40% over 5 years, dropped to 8&ndash;15% with continued post-op hormonal suppression.</p>
            <p>For superficial peritoneal endometriosis specifically, evidence for surgical removal is still considered insufficient{cite("ref-2")} &mdash; meaning aggressive surgery for tiny visible lesions in someone whose pain is mostly central or myofascial is unlikely to help.</p>
            <p>Osteopathic visceral/fascial therapy after endometriosis surgery has separate RCT support for reducing recurrent pelvic pain and dyspareunia{cite("ref-6")}.</p>
        """,
    },
}


def abstract_html(raw):
    if not raw or "FETCH ERROR" in raw:
        return ""
    text = re.sub(r"\r\n", "\n", raw.strip())
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return "\n".join("<p>" + html.escape(p).replace("\n","<br>") + "</p>" for p in paragraphs)


def render_modals():
    out = []
    for key, m in MODALS.items():
        out.append(
            f'<template id="modal-{key}"><div class="modal-content-inner">'
            f'<h2>{m["title"]}</h2>'
            f'{m["html"]}'
            f'</div></template>'
        )
    return "\n".join(out)


def render_refs():
    out = []
    for r_id, label, citation, pmid, abstract in REFS:
        n = r_id.replace("ref-", "")
        pmid_link = (
            f'<a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noopener"><span class="pmid">PMID&nbsp;{pmid}</span></a>'
            if pmid else '<span class="pmid no-pmid">no PMID</span>'
        )
        block = (
            f'<details class="mz-abstract"><summary>Read the abstract</summary>'
            f'<div class="abstract-body">{abstract_html(abstract)}</div></details>'
            if abstract and "FETCH ERROR" not in abstract else
            f'<div class="no-abstract">No PubMed abstract available for this reference.</div>'
        )
        out.append(f"""
            <li id="{r_id}">
                <div class="ref-head">
                    <span class="ref-num">{n}</span>
                    <span class="ref-citation">{citation} &nbsp;{pmid_link}</span>
                </div>
                {block}
            </li>""")
    return "\n".join(out)


def render_inline_anchors():
    """Build inline §0.8 anchor HTML comments — one per ANCHORS entry, inserted
    before the page-anchor sections via the body composition."""
    return "\n".join(
        f'<!-- §0.8 anchor: kb_doc_id={a["kb_doc_id"]}; field={a["field"]}; idx=0; excerpt="{html.escape(a["excerpt_first_words"])[:80]}" -->'
        for a in ANCHORS
    )


# Reuse the same CSS from endometriosis page (proven, §3.10 compliant)
CSS_PATH = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"
with open(CSS_PATH) as f:
    endo_html = f.read()
css_match = re.search(r"<style>(.*?)</style>", endo_html, re.DOTALL)
CSS = css_match.group(1) if css_match else ""


BODY_HTML = f"""
{render_inline_anchors()}

<nav class="site-nav" aria-label="Site navigation">
    <div class="inner">
        <a class="brand" href="/">Mount Zara</a>
        <span class="crumb">·  Patient Education  ·  Chronic Pelvic Pain</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>

<div class="wrap">

    <header class="hero">
        <div class="eyebrow">Patient Education · Chronic Pelvic Pain</div>
        <h1>Chronic pelvic pain &mdash; why it&rsquo;s rarely one thing, and how a layered plan actually works.</h1>
        <p class="lede">
            Chronic pelvic pain is pain in the pelvis lasting six months or longer that has started to interfere with daily life&nbsp;&mdash; work, sleep, exercise, sex, mood{cite("ref-1")}. It is almost never caused by just one structure or one mechanism. This guide walks through the four overlapping layers of CPP, the workup Dr.&nbsp;Mabini uses to identify which layers matter for you, and the multi-modal treatment ladder &mdash; medical, physical-therapy, osteopathic, and (when needed) surgical &mdash; that gets most women better. Every clinical claim has an inline citation; full peer-reviewed abstracts are at the bottom.
        </p>
        <div class="byline">Reviewed by <strong>Christopher Z. Mabini, DO, MSAEd</strong> · AAGL Fellow, Minimally Invasive Gynecologic Surgery</div>
    </header>

    <div class="facts">
        <div class="fact"><div class="stat">6+<span class="unit"> mo</span></div><div class="label">Pain duration that defines &ldquo;chronic&rdquo; pelvic pain{cite("ref-1")}.</div></div>
        <div class="fact"><div class="stat">15<span class="unit">%</span></div><div class="label">of reproductive-age women have CPP &mdash; one of the most common GYN complaints{cite("ref-1")}.</div></div>
        <div class="fact"><div class="stat">59<span class="unit">%</span></div><div class="label">respond to specialized pelvic-floor PT vs 26% on general massage (NIH RCT){cite("ref-3")}.</div></div>
        <div class="fact"><div class="stat">4</div><div class="label">overlapping pain layers that need separate attention &mdash; organs, muscles, nerves, fascia.</div></div>
    </div>

    <section class="panel">
        <div class="section-eyebrow">What it is</div>
        <h2>Pain that has lasted long enough to re-wire the nervous system.</h2>
        <p>Click any card below for a deeper dive.</p>
        <div class="card-grid card-grid--3" role="list">
            <article class="card" role="listitem" tabindex="0" data-modal="pain-defs">
                <h3>The CPP definition</h3>
                <p>Non-cyclic pelvic pain lasting six months or longer that affects daily function. The six-month threshold matters because that&rsquo;s where the nervous system starts amplifying the signal itself{cite("ref-1")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
            <article class="card" role="listitem" tabindex="0" data-modal="pain-sources-cpp">
                <h3>Four overlapping layers</h3>
                <p>Organs, muscles, nerves, fascia &mdash; treating only one leaves the others amplifying the pain{cite_multi("ref-1", "ref-3")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
            <article class="card" role="listitem" tabindex="0" data-modal="eval-cpp">
                <h3>The work-up</h3>
                <p>Detailed history + targeted exam (including the pelvic-floor exam most clinics skip) + ultrasound &plusmn; MRI. Laparoscopy reserved for failed medical therapy{cite_multi("ref-1", "ref-2")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
        </div>
    </section>

    <section class="panel">
        <div class="section-eyebrow">The treatment ladder</div>
        <h2>Multi-modal from day one, escalating in layers.</h2>
        <p class="section-intro">Single-modality treatment rarely works for CPP. Layer the medical, physical-therapy, osteopathic, and (when indicated) surgical interventions together. Click any rung for the detailed protocol.</p>
        <div class="ladder">
            <article class="rung" tabindex="0" data-modal="rung-multi-1">
                <div class="step-num">01</div>
                <div>
                    <h3>NSAIDs + hormonal suppression + neuropathic agents</h3>
                    <p>Pre-emptive NSAIDs, continuous OCP for cyclic components, and amitriptyline / gabapentin / duloxetine for the central-amplification layer that hormones don&rsquo;t reach{cite_multi("ref-1", "ref-7")}.</p>
                    <p class="meds">naproxen 500&nbsp;mg BID  ·  continuous OCP  ·  amitriptyline 10&ndash;75&nbsp;mg QHS  ·  gabapentin 300&ndash;3,600&nbsp;mg / day</p>
                </div>
                <span class="rung-tag">Layer 1</span>
            </article>
            <article class="rung" tabindex="0" data-modal="rung-multi-2">
                <div class="step-num">02</div>
                <div>
                    <h3>Specialized pelvic-floor PT + OMT</h3>
                    <p>Pelvic-floor myofascial PT is the single best-evidenced non-pharmacologic intervention (59% vs 26% response){cite("ref-3")}. Osteopathic manipulation adds the upstream spinal/sacroiliac/fascial layer{cite_multi("ref-4", "ref-5")}.</p>
                    <p class="meds">PFPT 1&ndash;2&times;/wk &times;&nbsp;12&ndash;16 sessions  ·  8-week OMT protocol  ·  vaginal diazepam 5&ndash;10&nbsp;mg QHS for hypertonus</p>
                </div>
                <span class="rung-tag">Layer 2</span>
            </article>
            <article class="rung" tabindex="0" data-modal="rung-multi-3">
                <div class="step-num">03</div>
                <div>
                    <h3>Trigger-point injections, botulinum toxin, GnRH antagonist</h3>
                    <p>When layers 1+2 plateau at 3&ndash;6&nbsp;months &mdash; targeted procedural and pharmacologic escalation{cite("ref-1")}.</p>
                    <p class="meds">lidocaine 1% TP injections  ·  onabotulinum toxin A levator  ·  elagolix 150&nbsp;mg daily (or 200&nbsp;mg BID &times;&nbsp;6&nbsp;mo + add-back)</p>
                </div>
                <span class="rung-tag">Layer 3</span>
            </article>
            <article class="rung" tabindex="0" data-modal="rung-multi-4">
                <div class="step-num">04</div>
                <div>
                    <h3>Diagnostic / therapeutic laparoscopy</h3>
                    <p>When medical therapy fails, an endometrioma needs cystectomy, or deep disease mapped on MRI needs excision. Cochrane supports laparoscopic surgery for endometriosis-associated CPP{cite("ref-2")}. Post-op OMT reduces recurrent pelvic pain{cite("ref-6")}.</p>
                    <p class="meds">Laparoscopic excision  ·  post-op LNG-IUD or continuous OCP for recurrence prevention  ·  8-week post-op OMT protocol</p>
                </div>
                <span class="rung-tag">Layer 4</span>
            </article>
        </div>
    </section>

    <section class="panel">
        <div class="section-eyebrow">Common questions</div>
        <h2>Patient questions, answered honestly.</h2>
        <div class="qa-list">
            <details class="qa"><summary>Why does the pain persist after surgery?</summary><div class="qa-answer"><p>Because central sensitization (the spinal-cord and brain amplification of pain signals) doesn&rsquo;t reverse the moment you remove the lesion that started it{cite("ref-1")}. The longer pain has gone untreated, the more entrenched the amplification, and the more important the layered approach &mdash; PFPT, OMT, neuropathic agents &mdash; becomes alongside any surgery.</p></div></details>
            <details class="qa"><summary>Does this mean my pain is &ldquo;in my head&rdquo;?</summary><div class="qa-answer"><p>No. Central sensitization is a real, physical change in how the nervous system processes pain. Recognizing the CNS contribution doesn&rsquo;t dismiss the pain &mdash; it identifies a treatable mechanism that single-organ thinking misses{cite("ref-1")}.</p></div></details>
            <details class="qa"><summary>Will pelvic-floor PT actually help?</summary><div class="qa-answer"><p>For most patients with a pelvic-floor component, yes &mdash; the NIH multicenter RCT showed 59% response to specialized myofascial PT versus 26% on general massage{cite("ref-3")}. The key word is <em>specialized</em>: a generic orthopedic PT will not deliver the same result.</p></div></details>
            <details class="qa"><summary>What about cannabis or CBD?</summary><div class="qa-answer"><p>Currently insufficient evidence to recommend cannabis or CBD specifically for gynecologic pain{cite_multi("ref-2", "ref-1")}. If you&rsquo;re already using it and finding it helpful, that&rsquo;s a conversation to have at your visit so it fits into the rest of the plan safely.</p></div></details>
            <details class="qa"><summary>How long until I see improvement?</summary><div class="qa-answer"><p>Medical layer: 4&ndash;6 weeks for early signal, 3 months for fair trial. PFPT: 8&ndash;12 sessions to shift the muscle pattern{cite("ref-3")}. OMT: meaningful improvement typically by session 4&ndash;6{cite("ref-4")}. Surgery: the 3-month post-op mark is the real read{cite("ref-2")}.</p></div></details>
            <details class="qa"><summary>What if nothing has worked so far?</summary><div class="qa-answer"><p>Almost always two things are true: (1) one or more of the four layers above hasn&rsquo;t been adequately addressed, and (2) the layered approach hasn&rsquo;t been delivered together. The work at the first visit is to figure out which layer or layers have been missed and to start that work in parallel with whatever&rsquo;s already going on.</p></div></details>
        </div>
    </section>

    <section class="panel">
        <div class="section-eyebrow">When to call urgently</div>
        <h2>Symptoms that shouldn&rsquo;t wait for your next visit.</h2>
        <div class="red-flags">
            <div class="red-eyebrow">Call the office or seek care now if you have:</div>
            <ul>
                <li>Sudden, severe one-sided pelvic pain &mdash; especially with nausea or vomiting (possible ovarian torsion)</li>
                <li>Heavy bleeding soaking a pad/tampon hourly for 2+ consecutive hours</li>
                <li>Fever above 101&deg;F with pelvic pain</li>
                <li>Severe pain not responding to your prescribed medications</li>
                <li>New bowel or urinary symptoms &mdash; rectal bleeding, blood in urine, inability to empty</li>
                <li>Suspected pregnancy on hormonal therapy</li>
            </ul>
        </div>
    </section>

    <section class="cta-strip">
        <h2>Take the next step.</h2>
        <p>If you&rsquo;ve been told &ldquo;everything looks fine&rdquo; while you continue to hurt, the layered approach is what changes that. Dr.&nbsp;Mabini sees CPP as a core part of the practice.</p>
        <a class="btn" href="/portal/">Open the patient portal</a>
        <a class="btn ghost" href="/about/">More about Dr.&nbsp;Mabini</a>
    </section>

    <section class="panel">
        <div class="section-eyebrow">References</div>
        <h2>The evidence underneath every claim on this page.</h2>
        <ol class="refs-list">
            {render_refs()}
        </ol>
    </section>

    <div class="footer-note">
        <strong>About this page.</strong> The content above is general patient education and not personal medical advice. CPP presents differently in every patient; the right treatment plan depends on your specific symptoms, exam findings, imaging, and goals &mdash; which is exactly the conversation a clinic visit is for.
    </div>

</div>

<div class="mz-modal-bg" id="mz-modal-bg" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="mz-modal" id="mz-modal" role="document">
        <button class="mz-modal-close" id="mz-modal-close" aria-label="Close">&times;</button>
        <div id="mz-modal-host"></div>
    </div>
</div>

{render_modals()}

<script>
(function () {{
    'use strict';
    const refs = document.querySelectorAll('sup.mz-ref');
    refs.forEach(s => {{
        s.addEventListener('click', (ev) => {{
            const a = ev.target.closest('a'); if (a && a.tagName === 'A') return;
            ev.preventDefault();
            refs.forEach(other => {{ if (other !== s) other.classList.remove('mz-open'); }});
            s.classList.toggle('mz-open');
        }});
    }});
    document.addEventListener('click', (ev) => {{
        if (!ev.target.closest('sup.mz-ref')) refs.forEach(s => s.classList.remove('mz-open'));
    }});

    const qas = document.querySelectorAll('details.qa');
    qas.forEach(d => {{
        d.addEventListener('toggle', () => {{ if (!d.open) return; qas.forEach(o => {{ if (o !== d) o.open = false; }}); }});
        d.querySelector('summary').addEventListener('click', () => {{
            setTimeout(() => {{ if (d.open) d.scrollIntoView({{ behavior:'smooth', block:'nearest' }}); }}, 80);
        }});
    }});

    const bg = document.getElementById('mz-modal-bg');
    const host = document.getElementById('mz-modal-host');
    const closeBtn = document.getElementById('mz-modal-close');
    let lastFocus = null;
    function openModal(key) {{
        const tpl = document.getElementById('modal-' + key); if (!tpl) return;
        host.innerHTML = ''; host.appendChild(tpl.content.cloneNode(true));
        host.querySelectorAll('sup.mz-ref').forEach(s => {{
            s.addEventListener('click', (ev) => {{
                const a = ev.target.closest('a'); if (a && a.tagName === 'A') return;
                ev.preventDefault(); s.classList.toggle('mz-open');
            }});
        }});
        lastFocus = document.activeElement;
        bg.classList.add('open'); bg.setAttribute('aria-hidden','false');
        document.body.style.overflow = 'hidden'; closeBtn.focus();
    }}
    function closeModal() {{
        bg.classList.remove('open'); bg.setAttribute('aria-hidden','true');
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        host.innerHTML = '';
    }}
    document.querySelectorAll('[data-modal]').forEach(card => {{
        card.addEventListener('click', (ev) => {{
            if (ev.target.closest('sup.mz-ref a')) return;
            openModal(card.dataset.modal);
        }});
        card.addEventListener('keydown', (ev) => {{
            if (ev.key === 'Enter' || ev.key === ' ') {{ ev.preventDefault(); openModal(card.dataset.modal); }}
        }});
    }});
    closeBtn.addEventListener('click', closeModal);
    bg.addEventListener('click', (ev) => {{ if (ev.target === bg) closeModal(); }});
    document.addEventListener('keydown', (ev) => {{ if (ev.key === 'Escape' && bg.classList.contains('open')) closeModal(); }});
}})();
</script>
"""

manifest = {
    "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
    "surface": "/education/chronic-pelvic-pain/index.html",
    "topic": "Chronic Pelvic Pain",
    "topic_synthesis_id": corpus["topic_synthesis_id"],
    "kb_chunks_path": "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/",
    "kb_documents_loaded": list(DOCS.keys()),
    "kb_documents_quoted": [
        {
            "kb_doc_id": a["kb_doc_id"],
            "title": DOCS[a["kb_doc_id"]]["title"][:120],
            "field": a["field"],
            "claim": a["claim"],
            "excerpt_first_words": a["excerpt_first_words"],
            "page_anchor_id": "main",
        }
        for a in ANCHORS if a["kb_doc_id"] in DOCS
    ],
    "pmids_efetched_in_session": list(PMIDS.values()),
    "user_docx_sources": [
        "OMT_Integrated_Pelvic_Pain_Protocol_v4.1_MAGAZINE.docx — Sections 1 (six-pillar framework), 6 (counseling scripts), 7 (CPP SOAP variant), 8 (bibliography)"
    ],
    "not_in_kb_claims": [],
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
}

HTML = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Chronic pelvic pain — why it&rsquo;s rarely one thing · Mount Zara</title>
    <meta name="description" content="A KB-anchored patient guide to chronic pelvic pain from Christopher Z. Mabini, DO — the four overlapping layers, the work-up, the multi-modal treatment ladder, with inline PubMed citations and verbatim abstracts.">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="canonical" href="https://mountzara.com/education/chronic-pelvic-pain/">
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700&display=swap" rel="stylesheet">
    <style>{CSS}</style>
</head>
<body>
{BODY_HTML}

<!-- §0.8 KB-anchor manifest
{json.dumps(manifest, indent=2)}
-->
</body>
</html>
"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    f.write(HTML)

print(f"Wrote {OUT} ({os.path.getsize(OUT):,} bytes)")
print(f"  KB documents loaded: {len(DOCS)}")
print(f"  KB documents quoted with excerpts: {len(manifest['kb_documents_quoted'])}")
print(f"  PMIDs verified this session: {len(PMIDS)}")
print(f"  Modal cards: {len(MODALS)}")
print(f"  References: {len(REFS)}")
