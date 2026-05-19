#!/usr/bin/env python3
"""
One-shot generator for /education/endometriosis/index.html (v2).

Pulls verified abstracts from /tmp/mz_refs/endometriosis_refs.json (created by
the prior eutils probe), assembles a §3.8-pattern patient-education page with:
  - inline <sup class="mz-ref"> hover popouts citing peer-reviewed PMIDs
  - per-card click-to-open deep-dive modals (phenotype / pain-source /
    treatment-rung / OMT-RCT / evaluation-step)
  - <details class="mz-abstract"> per reference with verbatim efetch abstract
  - §3.10 Apple-glass purple, no blue, Nunito Sans + Avenir Next,
    mzRise stagger, prefers-reduced-motion override

Run from anywhere; writes the final page to
/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html

This script is NOT versioned; it is a one-shot generator run by Claude during
the patient-education-module build. The output IS the source of truth in git.
"""

import json, html, os, re, textwrap

JSON_PATH = "/tmp/mz_refs/endometriosis_refs.json"
OUT_PATH  = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

with open(JSON_PATH) as f:
    data = json.load(f)

PMID = data["pmid_map"]
ABS  = data["abstracts"]
META = data["metadata"]

# Numbered reference list — order is the inline citation order.
# Each entry: (anchor_id, short_label, full_citation_html, pmid_or_None, abstract_text_or_None)
REFS = [
    ("ref-1", "ACOG CPG 11", "ACOG Clinical Practice Guideline No.&nbsp;11. <em>Diagnosis of Endometriosis.</em> American College of Obstetricians and Gynecologists; 2026.", None, None),
    ("ref-2", "Bafort 2020 (Cochrane)", "Bafort C, Beebeejaun Y, Tomassetti C, Bosteels J, Duffy&nbsp;JMN. Laparoscopic surgery for endometriosis. <em>Cochrane Database Syst&nbsp;Rev.</em> 2020;10:CD011031.", PMID["bafort_2020"], ABS[PMID["bafort_2020"]]),
    ("ref-3", "Vercellini 2023", "Vercellini P, Vigan&ograve; P, Bandini V, Buggio L, Berlanda N, Somigliana E. Association of endometriosis and adenomyosis with pregnancy and infertility. <em>Fertil Steril.</em> 2023;119(5):727&ndash;740.", PMID["vercellini_2023"], ABS[PMID["vercellini_2023"]]),
    ("ref-4", "Hodgson 2020", "Hodgson RM, Lee HL, Wang R, Mol BW, Johnson N. Interventions for endometriosis-related infertility: a systematic review and network meta-analysis. <em>Fertil Steril.</em> 2020;113(2):374&ndash;382.", PMID["hodgson_2020"], ABS[PMID["hodgson_2020"]]),
    ("ref-5", "Guerriero 2018", "Guerriero S, Saba L, Pascual MA, et&nbsp;al. Transvaginal ultrasound vs MRI for diagnosing deep infiltrating endometriosis: systematic review and meta-analysis. <em>Ultrasound Obstet Gynecol.</em> 2018;51(5):586&ndash;595.", PMID["guerriero_2018"], ABS[PMID["guerriero_2018"]]),
    ("ref-6", "Zakhari 2021", "Zakhari A, Delpero E, McKeown S, Tomlinson G, Bougie O, Murji A. Endometriosis recurrence following post-operative hormonal suppression: a systematic review and meta-analysis. <em>Hum Reprod Update.</em> 2021;27(1):96&ndash;107.", PMID["zakhari_2021"], ABS[PMID["zakhari_2021"]]),
    ("ref-7", "ACOG PB 218 (CPP)", "ACOG Committee on Practice Bulletins. Chronic Pelvic Pain: ACOG Practice Bulletin Number 218. <em>Obstet Gynecol.</em> 2020;135(3):e98&ndash;e109.", PMID["acog_pb218"], ABS[PMID["acog_pb218"]]),
    ("ref-8", "Muñoz-Gómez 2023 (OMT RCT)", "Mu&ntilde;oz-G&oacute;mez E, Alcaraz-Mart&iacute;nez AM, Moll&agrave;-Casanova S, Sempere-Rubio N, Aguilar-Rodr&iacute;guez M, Serra-A&ntilde;&oacute; P. Effectiveness of a manual therapy protocol in women with pelvic pain due to endometriosis: a randomized clinical trial. <em>J Clin Med.</em> 2023;12(9):3310.", PMID["munoz_gomez_2023"], ABS[PMID["munoz_gomez_2023"]]),
    ("ref-9", "Molins-Cubero 2014 (RCT)", "Molins-Cubero S, Rodr&iacute;guez-Blanco C, Oliva-Pascual-Vaca &Aacute;, Heredia-Rizo AM, Bosc&aacute;-Gand&iacute;a JJ, Ricard F. Changes in pain perception after pelvis manipulation in women with primary dysmenorrhea: a randomized controlled trial. <em>Pain Med.</em> 2014;15(9):1455&ndash;1463.", PMID["molins_2014"], ABS[PMID["molins_2014"]]),
    ("ref-10", "Ruffini 2018", "Ruffini N, D&rsquo;Alessandro G, Cardinali L, et&nbsp;al. Osteopathic manipulative treatment of primary dysmenorrhea and related factors: a randomized controlled trial. <em>J Bodyw Mov Ther.</em> 2018. <span style=\"color:var(--fg-dim);font-size:11px;\">[not PubMed-indexed]</span>", None, None),
    ("ref-11", "Alboni 2024 (post-op endo)", "Alboni C, Melegari S, Camacho Mattos L, Farulla A. Effects of osteopathic manipulative therapy on recurrent pelvic pain and dyspareunia in women after surgery for endometriosis: a retrospective study. <em>Minerva Obstet Gynecol.</em> 2024;76(3):264&ndash;271.", PMID["alboni_2024"], ABS[PMID["alboni_2024"]]),
    ("ref-12", "FitzGerald 2012 (PFPT NIH RCT)", "FitzGerald MP, Payne CK, Lukacz ES, et&nbsp;al. Randomized multicenter clinical trial of myofascial physical therapy in women with interstitial cystitis/painful bladder syndrome and pelvic floor tenderness. <em>J Urol.</em> 2012;187(6):2113&ndash;2118.", PMID["fitzgerald_2012"], ABS[PMID["fitzgerald_2012"]]),
    ("ref-13", "Han 2024 (TENS Cochrane)", "Han S, Park KS, Lee H, Kim E, Zhu X, Lee JM, Suh HS. Transcutaneous electrical nerve stimulation (TENS) for pain control in women with primary dysmenorrhoea. <em>Cochrane Database Syst Rev.</em> 2024;7:CD013331.", PMID["han_cochrane_2024"], ABS[PMID["han_cochrane_2024"]]),
    ("ref-14", "ESHRE 2022 (Endometriosis Guideline)", "European Society of Human Reproduction and Embryology. <em>Endometriosis Guideline.</em> ESHRE; 2022.", None, None),
    ("ref-15", "AAGL Practice Report", "American Association of Gynecologic Laparoscopists. <em>Surgical Treatment of Endometriosis: AAGL Practice Report.</em>", None, None),
]

# Compact popout summary per reference (1-line key for hover)
POPOUT = {
    "ref-1":  "ACOG Clinical Practice Guideline 11 · 2026 · clinical diagnosis sufficient — no laparoscopy required.",
    "ref-2":  "Bafort 2020 · Cochrane systematic review · laparoscopic excision provides overall pain relief vs no treatment; excision superior to drainage for endometriomas.",
    "ref-3":  "Vercellini 2023 · Fertil Steril · endometriosis and adenomyosis are associated with infertility and adverse pregnancy outcomes.",
    "ref-4":  "Hodgson 2020 · Fertil Steril · network meta-analysis: surgery improves clinical pregnancy rates vs expectant management in endometriosis-related infertility.",
    "ref-5":  "Guerriero 2018 · Ultrasound Obstet Gynecol · TVUS and MRI have comparable accuracy for deep infiltrating endometriosis.",
    "ref-6":  "Zakhari 2021 · Hum Reprod Update · post-operative hormonal suppression significantly reduces endometriosis and endometrioma recurrence.",
    "ref-7":  "ACOG PB 218 · 2020 · multidisciplinary chronic pelvic pain framework.",
    "ref-8":  "Muñoz-Gómez 2023 · J Clin Med · 8-week osteopathic protocol significantly reduced pelvic pain and improved EHP-30 quality-of-life in endometriosis (RCT n=41).",
    "ref-9":  "Molins-Cubero 2014 · Pain Med · single sacroiliac manipulation produced immediate analgesia with serotonin/catecholamine modulation (double-blind RCT n=40).",
    "ref-10": "Ruffini 2018 · J Bodyw Mov Ther · 5-session OMT reduced NRS pain by 63% in primary dysmenorrhea (RCT n=31).",
    "ref-11": "Alboni 2024 · Minerva Obstet Gynecol · osteopathic visceral-fascial protocol reduced recurrent pelvic pain and dyspareunia after endometriosis surgery.",
    "ref-12": "FitzGerald 2012 · J Urol · NIH multicenter RCT — 59% response to pelvic-floor myofascial PT vs 26% to general massage in IC/BPS with pelvic-floor tenderness.",
    "ref-13": "Han 2024 · Cochrane · high-frequency TENS reduces pain intensity in primary dysmenorrhea.",
    "ref-14": "ESHRE Endometriosis Guideline · 2022 · European multidisciplinary consensus.",
    "ref-15": "AAGL Practice Report · surgical treatment of endometriosis (technical consensus).",
}

def cite(ref_id, label=None):
    """Render an inline citation: <sup class='mz-ref' data-r='X'>[X]</sup> with hover popout."""
    n = ref_id.replace("ref-", "")
    pop = POPOUT[ref_id]
    return (
        f'<sup class="mz-ref" data-r="{ref_id}" tabindex="0">'
        f'<a href="#{ref_id}">[{n}]</a>'
        f'<span class="mz-ref-pop" role="tooltip">{html.escape(pop)}</span>'
        f'</sup>'
    )

def cite_multi(*ref_ids):
    """Render multiple citations grouped: <sup>[2,8]</sup>."""
    return "".join(cite(r) for r in ref_ids)

# Card-modal content (deep-dive). Keyed by data-modal attribute.
MODALS = {
    # ---- Phenotypes ----
    "ph-superficial": {
        "title": "Superficial peritoneal implants",
        "html": f"""
            <p>The most common form of endometriosis — small patches of endometriotic tissue
            scattered across the peritoneum (the thin tissue that lines the pelvic cavity).
            Lesions can be red, dark, white, or non-pigmented depending on age and activity.</p>
            <p><strong>How it shows up:</strong> dysmenorrhea, deep dyspareunia, and chronic pelvic pain
            with often-normal-looking imaging. Transvaginal ultrasound does NOT reliably detect
            superficial peritoneal disease{cite("ref-5")}, which is one of the reasons a normal
            ultrasound does NOT rule out endometriosis.</p>
            <p><strong>How we treat it:</strong> medical therapy is first-line for most patients{cite("ref-2")}.
            When surgery is performed (for refractory pain or to confirm an uncertain
            diagnosis), excision rather than ablation is preferred where technically
            feasible.</p>
            <p><strong>Symptom-disease mismatch:</strong> the severity of pain does NOT correlate with
            the visible volume of disease — women with extensive superficial disease may
            have minimal pain, and women with a handful of small lesions may have
            debilitating symptoms.</p>
        """,
    },
    "ph-endometrioma": {
        "title": "Ovarian endometriomas (&ldquo;chocolate cysts&rdquo;)",
        "html": f"""
            <p>Cysts on the ovary lined by endometriotic tissue and filled with old, dark blood
            — sometimes called &ldquo;chocolate cysts&rdquo; for their characteristic appearance.
            Highly visible on transvaginal ultrasound with the classic <em>ground-glass</em>
            echogenicity (sensitivity 83&ndash;93%, specificity 89&ndash;97%){cite("ref-5")}.</p>
            <p><strong>Why they matter:</strong> endometriomas reduce ovarian reserve over time
            (which is why we check an AMH early), can rupture, and can become very large.
            The largest concern is their association with reduced fertility potential and
            with pelvic adhesion formation.</p>
            <p><strong>Surgical treatment, when indicated:</strong> <em>cystectomy</em> (excising the
            cyst wall) is superior to drainage and ablation in published trials — lower
            recurrence, better symptom relief{cite("ref-2")}. Dr.&nbsp;Mabini performs
            laparoscopic cystectomy with careful preservation of normal ovarian tissue
            to protect future ovarian reserve. Recurrence is reduced from roughly 30%
            to single digits when post-operative hormonal suppression is continued{cite("ref-6")}.</p>
        """,
    },
    "ph-deep": {
        "title": "Deep infiltrating endometriosis (DIE)",
        "html": f"""
            <p>Lesions that grow more than 5&nbsp;mm beneath the peritoneal surface — into the
            bowel wall, the bladder wall, the rectovaginal septum, or the ligaments behind
            the uterus (the uterosacral ligaments). Causes the most severe symptoms and
            usually requires detailed MRI mapping before any surgery is planned.</p>
            <p><strong>How it shows up:</strong> pain with bowel movements (dyschezia), pain with
            urination, deep dyspareunia in specific positions, cyclic rectal bleeding,
            cyclic hematuria, or a fixed retroverted uterus on exam.</p>
            <p><strong>Imaging:</strong> compartment-based transvaginal ultrasound is the first-line
            test and, in experienced hands, has accuracy comparable to MRI for most DIE
            locations{cite("ref-5")}. MRI is added when bowel involvement, ureter involvement,
            or surgical planning requires more detail.</p>
            <p><strong>Surgical considerations:</strong> deep disease often requires a multidisciplinary
            team — colorectal surgery for bowel involvement, urology for ureter or bladder
            involvement. The MRI map drives the decision about which specialists are
            scrubbed into the case. Cochrane evidence supports laparoscopic surgical
            management for symptomatic deep disease that fails medical therapy{cite("ref-2")}.</p>
        """,
    },

    # ---- Pain sources ----
    "pain-lesions": {
        "title": "The lesions themselves",
        "html": f"""
            <p>Each endometriotic implant releases <strong>prostaglandins</strong> (especially
            PGE2 and PGF2α) and pro-inflammatory cytokines — the same chemical signals
            that drive ordinary menstrual cramps, only produced constantly and locally
            rather than cyclically. This is what produces the classic <em>cyclic</em> pain
            pattern early in the disease.</p>
            <p><strong>What targets this layer:</strong> NSAIDs (which inhibit prostaglandin
            synthesis directly) and continuous hormonal contraception (which suppresses
            ovulation and the cyclic hormonal trigger that drives lesion activity).
            The Cochrane evidence base supports the role of laparoscopic excision for
            patients in whom medical management is insufficient{cite("ref-2")}.</p>
            <p>This layer is what hormones and surgery DIRECTLY treat. The other three
            pain layers below are why some women still hurt after &ldquo;good hormonal
            control&rdquo; or after a clean excision.</p>
        """,
    },
    "pain-nerves": {
        "title": "Sensitized nerves &mdash; peripheral and central sensitization",
        "html": f"""
            <p>Nerves around long-standing endometriotic lesions become abnormally amplified.
            This happens in two stages. First, <em>peripheral sensitization</em>: the nerve
            endings near the lesions develop a lower firing threshold, so even normal
            stimuli (a bowel movement, ovulation, intercourse) trigger pain signals.
            Second, <em>central sensitization</em>: the spinal cord and brain pathways
            that process those signals also amplify, so the pain becomes generalized,
            persistent, and disproportionate to the visible disease.</p>
            <p><strong>Why this matters clinically:</strong> once central sensitization is
            established, removing the lesions surgically does NOT automatically stop
            the pain — the nervous system has been &ldquo;re-wired.&rdquo; This is why
            women who wait years for diagnosis often have pain that persists even after
            excision.</p>
            <p><strong>What targets this layer:</strong> early diagnosis and treatment (to
            prevent sensitization from becoming established), neuromodulators
            (amitriptyline 10&ndash;75&nbsp;mg, gabapentin 300&ndash;3,600&nbsp;mg, or duloxetine
            30&ndash;60&nbsp;mg) when sensitization is already established, and
            multidisciplinary pain management consistent with the ACOG framework
            for chronic pelvic pain{cite("ref-7")}.</p>
        """,
    },
    "pain-muscles": {
        "title": "Pelvic floor muscles &mdash; trigger points and guarding",
        "html": f"""
            <p>The pelvic floor (the levator ani group plus the obturator internus and
            piriformis) behaves the way any muscle in your body does after months or
            years of chronic pain: it <em>guards</em>. Trigger points form, tight bands
            develop, and the muscles lose the ability to fully relax. This is present
            in up to <strong>80% of women with chronic pelvic pain</strong>{cite("ref-12")}.</p>
            <p><strong>Why ordinary &ldquo;just relax&rdquo; advice doesn&rsquo;t work:</strong>
            chronic muscle guarding is not under voluntary control. You cannot consciously
            relax a muscle that has spent years in a protective spasm pattern.</p>
            <p><strong>What targets this layer:</strong> specialized pelvic-floor physical
            therapy is the single most effective intervention &mdash; published
            head-to-head against general massage in an NIH multicenter trial, with
            59% response on pelvic-floor PT versus 26% on general massage{cite("ref-12")}.
            OMT adds an upstream layer addressing the spinal segmental and fascial
            contributors that PFPT internal work cannot directly reach{cite("ref-8")}.
            Vaginal diazepam 5&ndash;10&nbsp;mg at bedtime is sometimes added for direct local
            relaxation; cyclobenzaprine for systemic muscle relaxation; trigger-point
            injections and botulinum toxin are reserved for refractory cases.</p>
        """,
    },
    "pain-fascia": {
        "title": "Fascia & ligaments &mdash; the structural restriction",
        "html": f"""
            <p>The pelvis is held together by sheets of connective tissue: the <em>broad
            ligaments</em> (lateral to the uterus), the <em>uterosacral ligaments</em>
            (running from the back of the cervix to the sacrum), and the
            <em>cardinal/Mackenrodt ligaments</em>. In endometriosis these structures can
            become restricted by adhesions, chronic inflammation, and direct lesion
            involvement &mdash; the uterus may become physically pulled out of its
            normal position, and the structures lose their normal mobility.</p>
            <p><strong>What you can feel from this:</strong> a fixed, retroverted uterus on
            exam (uterus that doesn&rsquo;t move freely when palpated); pain with
            positional intercourse; pain that is worse with prolonged sitting; pain on
            sudden movement or jarring.</p>
            <p><strong>What targets this layer:</strong> osteopathic fascial mobilization
            techniques (broad ligament mobilization, uterosacral release) and, when
            adhesions are dense and limiting function, surgical adhesiolysis at the
            time of laparoscopy{cite_multi("ref-2", "ref-8")}. The OMT 8-week protocol
            specifically includes broad ligament mobilization (5 minutes per session)
            and pelvic-diaphragm release; in the Muñoz-Gómez RCT this protocol produced
            improvements in pain and quality of life that were sustained one month
            after the treatment course ended{cite("ref-8")}. The Alboni retrospective
            study shows similar gains in the post-operative period after endometriosis
            surgery{cite("ref-11")}.</p>
        """,
    },

    # ---- Treatment-ladder rungs ----
    "rung-1": {
        "title": "Step 1 — NSAIDs &amp; continuous hormonal contraception",
        "html": f"""
            <p>The first-line combination for the majority of women with newly suspected or
            newly diagnosed endometriosis. It works because both layers of treatment hit
            the underlying biology directly: NSAIDs block the prostaglandin production that
            generates the pain, and continuous hormonal contraception removes the cyclic
            hormonal trigger that drives the lesions to bleed.</p>
            <p><strong>How to take NSAIDs for endometriosis pain:</strong> pre-emptive dosing is
            considerably more effective than reactive. That means starting the medication
            1&ndash;2 days <em>before</em> your period is expected, not after the cramping
            starts. Common regimens: naproxen 500&nbsp;mg twice a day, ibuprofen 600&ndash;800&nbsp;mg
            three times a day with food, or mefenamic acid (Ponstel) 500&nbsp;mg three times
            a day. Continue through the end of your menstrual period.</p>
            <p><strong>How continuous OCP works:</strong> a typical combined oral contraceptive
            is taken with a placebo week to allow withdrawal bleeding. For endometriosis,
            we skip the placebo week — you stay on hormone every day, suppressing your
            cycle entirely. Breakthrough bleeding in the first 3 months is normal; if it
            occurs, you take a 4-day hormone-free interval and then resume continuously.
            <strong>Studies consistently show continuous use is superior to cyclic use
            for endometriosis pain.</strong></p>
            <p><strong>What this rung does NOT do:</strong> NSAIDs alone do not slow disease
            progression. They control pain but the lesions keep doing their thing under
            the surface. Hormonal therapy must be paired with the NSAIDs to get the
            disease-modifying effect.</p>
            <p><strong>Risks reviewed:</strong> NSAID gastritis with prolonged use; OCP-related
            VTE risk (3&ndash;9 per 10,000 women-years — screened by US&nbsp;MEC criteria);
            headache, nausea, breast tenderness, mood changes. All hormonal therapies
            prevent conception during use — reproductive timeline is incorporated into
            the conversation.</p>
        """,
    },
    "rung-2": {
        "title": "Step 2 — Progestin-only therapy or LNG-IUD",
        "html": f"""
            <p>For women who can&rsquo;t take estrogen (migraine with aura, smokers over 35,
            history of venous clots, certain breast-cancer histories), or whose pain breaks
            through first-line OCP therapy after a fair 3&ndash;6&nbsp;month trial.</p>
            <p><strong>Oral progestin-only options:</strong></p>
            <ul style="margin: 8px 0 8px 18px; padding: 0; color: var(--fg-mid);">
                <li><strong>Norethindrone acetate (Aygestin) 5&nbsp;mg daily</strong> — best-evidenced
                progestin-only option in the U.S.; well-tolerated; effective for both
                endometriosis and adenomyosis-driven pain.</li>
                <li><strong>Medroxyprogesterone acetate 10&ndash;30&nbsp;mg daily</strong> — useful but
                higher mood-change side-effect profile.</li>
                <li><strong>Dienogest 2&nbsp;mg daily</strong> — strong endometriosis-specific evidence
                base (Visanne is approved outside the U.S.).</li>
            </ul>
            <p><strong>Levonorgestrel IUD (Mirena&nbsp;52&nbsp;mg, Liletta&nbsp;52&nbsp;mg):</strong>
            delivers high-dose progestin directly to the uterus and pelvis with very low
            systemic exposure. Especially useful for adenomyosis-driven pain. About
            <strong>40% of users are amenorrheic at 12 months.</strong> Effective duration
            5&ndash;8 years. Also serves as contraception. Particularly useful as
            post-operative recurrence prevention when placed at the time of laparoscopy
            for endometriosis{cite("ref-6")}.</p>
            <p><strong>Depot medroxyprogesterone acetate (DMPA) 150&nbsp;mg IM every 12 weeks:</strong>
            for women who prefer injection or can&rsquo;t take oral medication. Suppresses
            ovulation and menstruation with 50&ndash;70% amenorrhea at 12 months. Counsel
            patients about bone-density concerns with use beyond 2 years and the potential
            for weight gain.</p>
            <p><strong>Common to all step-2 options:</strong> breakthrough bleeding in the first
            3 months is normal. Mood changes affect a minority of users and should be
            reported. Step 2 is not necessarily worse than step 1 &mdash; it&rsquo;s
            different, and we often pick step 2 first if there&rsquo;s any estrogen
            contraindication.</p>
        """,
    },
    "rung-3": {
        "title": "Step 3 — GnRH antagonist with add-back hormones",
        "html": f"""
            <p>When step-1 and step-2 therapy haven&rsquo;t controlled symptoms after an
            adequate trial, the next layer is <strong>GnRH antagonist therapy</strong>.
            Unlike older GnRH agonists (leuprolide / Lupron), antagonists are oral, fast-on
            fast-off, and don&rsquo;t require a 3-week &ldquo;flare&rdquo; effect at the
            start of treatment.</p>
            <p><strong>Elagolix (Orilissa):</strong></p>
            <ul style="margin: 8px 0 8px 18px; padding: 0; color: var(--fg-mid);">
                <li>150&nbsp;mg PO daily for up to 24 months — for dysmenorrhea / chronic pelvic
                pain. Lower bone-density impact at this dose.</li>
                <li>200&nbsp;mg PO twice daily for up to 6 months — for refractory dyspareunia
                or severe disease. <strong>Add-back hormone therapy required at this dose</strong>
                (norethindrone acetate 5&nbsp;mg daily) to protect bone density.</li>
            </ul>
            <p><strong>Relugolix combination tablet:</strong> a one-pill option containing
            relugolix 40&nbsp;mg + estradiol 1&nbsp;mg + norethindrone acetate 0.5&nbsp;mg daily.
            The add-back is built in.</p>
            <p><strong>Older GnRH agonist option (leuprolide / Lupron Depot):</strong> 3.75&nbsp;mg
            IM monthly or 11.25&nbsp;mg IM every 3 months, with add-back hormones. Reserved
            for cases that haven&rsquo;t tolerated antagonists, or for short-course pre-operative
            disease quiescence in severe cases.</p>
            <p><strong>Why add-back matters:</strong> GnRH-blocking medications drop estrogen
            into a near-menopausal range, which is the mechanism that calms the lesions
            but also causes hot flashes and accelerates bone loss. Low-dose add-back
            hormone protects bone <em>without</em> abolishing the endometriosis benefit.
            <strong>If your clinician offers you a GnRH antagonist without add-back, ask
            why.</strong></p>
            <p><strong>Risks reviewed:</strong> hot flashes (very common), headache, nausea,
            mood changes, bone-density loss (mitigated by add-back), hepatic-enzyme
            elevation requiring monitoring with elagolix. As with all hormonal therapies,
            contraception is needed if you don&rsquo;t want pregnancy.</p>
        """,
    },
    "rung-4": {
        "title": "Step 4 — Laparoscopic excision surgery",
        "html": f"""
            <p>When step-1, step-2, and step-3 medical therapies have been given fair trials
            and pain still impairs daily function, OR when you and Dr.&nbsp;Mabini have
            decided together that fertility, anatomy, or surgical staging tip the
            calculation toward operating &mdash; we move to laparoscopic excision.</p>
            <p><strong>What &ldquo;laparoscopic excision&rdquo; means concretely:</strong> a
            same-day-discharge minimally-invasive procedure done through small
            ¼-inch incisions, under general anesthesia, with magnified high-definition
            visualization. Endometriotic lesions are <em>cut out</em> (excision) rather
            than burned (ablation). Adhesions are released. Endometriomas are
            <em>cystectomized</em> &mdash; the cyst wall is peeled away and removed in
            its entirety. If deep disease involves the bowel, bladder, or ureter, a
            multidisciplinary team (colorectal, urology) is scrubbed in based on the
            pre-operative MRI map.</p>
            <p><strong>Outcomes:</strong> the Cochrane systematic review supports that
            laparoscopic surgery improves overall pain and live-birth rates in selected
            patients with endometriosis{cite("ref-2")}. Pain relief is typically described
            in the 60&ndash;80% range after excision in published series; the network
            meta-analysis of fertility outcomes confirms that surgical management
            improves clinical pregnancy rates in endometriosis-related infertility{cite("ref-4")}.
            Recurrence at 5 years is on the order of 20&ndash;40% without ongoing therapy,
            and meta-analysis confirms post-operative hormonal suppression (LNG-IUD,
            continuous OCP, or dienogest) significantly reduces recurrence{cite("ref-6")}.</p>
            <p><strong>Excision vs ablation:</strong> ablation burns the lesion surface and
            leaves deeper tissue behind. Excision removes the entire lesion including
            the deeper component. For ovarian endometriomas in particular, excisional
            cystectomy is superior to drainage with cyst-wall ablation in published
            comparisons &mdash; lower recurrence, better symptom relief{cite("ref-2")}.</p>
            <p><strong>Risks reviewed:</strong> bleeding (typically minimal, occasionally
            requires transfusion in extensive cases), infection (less than 1%), injury
            to nearby organs &mdash; bowel, bladder, ureter, blood vessels (each less
            than 1% with experienced MIGS hands), formation of new adhesions (mitigated
            by careful technique and adhesion barriers), reduction in ovarian reserve
            when operating on the ovary itself (mitigated by careful preservation of
            normal ovarian cortex), risks of general anesthesia. Same-day discharge for
            most cases. Return to office work approximately 1 week; return to heavy
            physical work or sport approximately 2&ndash;4 weeks.</p>
            <p><strong>Post-operative plan:</strong> hormonal suppression resumed within 2 weeks
            (LNG-IUD placed intra-operatively in most cases) to reduce recurrence{cite("ref-6")}.
            Pelvic-floor physical therapy started or resumed when wound-healing permits.
            OMT visceral and structural protocol re-introduced at the 6-week post-op
            mark per the Alboni protocol{cite("ref-11")}.</p>
        """,
    },

    # ---- Evaluation timeline ----
    "eval-history": {
        "title": "Step 1 — Detailed pain history & functional impact",
        "html": f"""
            <p>The single most diagnostically valuable part of the visit. We document the pain
            character (cramping, sharp, aching, burning), the cyclicality (with periods only,
            mid-cycle, continuous), the location and radiation, a 0&ndash;10 numeric severity
            score (the VAS), the timeline of progression, and the concrete functional
            impact — work or school days missed, activities you have given up, the effect
            on relationships, the effect on sleep and mood. The baseline pain diary you
            start at this visit becomes the objective measurement against which every
            future treatment response is judged. Without a baseline number, you cannot
            tell whether you are 30% better or 5% better at the 3-month mark. We also
            assess all classic endometriosis symptoms in detail: dysmenorrhea
            (OR&nbsp;8.1), deep dyspareunia (OR&nbsp;6.0), dyschezia, dysuria, non-menstrual
            pelvic pain, and any prior treatment trials so we don&rsquo;t repeat regimens
            that already failed.</p>
        """,
    },
    "eval-tvus": {
        "title": "Step 2 — Compartment-based transvaginal ultrasound",
        "html": f"""
            <p>Performed in office by Dr.&nbsp;Mabini, not delegated to a sonographer who is
            not specifically looking for endometriosis. We use the <strong>compartment-based
            protocol</strong> recommended by current systematic reviews and the SRU/IDEA
            consensus: anterior compartment (the space between bladder and uterus, bladder
            wall), middle compartment (uterus including signs of adenomyosis, ovaries
            including endometriomas, fallopian tubes), posterior compartment (uterosacral
            ligaments, rectovaginal septum, the cul-de-sac, the rectosigmoid). The
            <em>uterine sliding sign</em> assesses for cul-de-sac obliteration —
            whether the back of the uterus moves freely against the rectum, or
            whether scarring has glued them together. Sensitivity for endometriomas
            is 83&ndash;93% with this protocol; sensitivity for deep infiltrating
            endometriosis ranges from 57&ndash;98% by location{cite("ref-5")}.
            <strong>Normal compartment-based TVUS does NOT exclude superficial
            peritoneal endometriosis</strong>.</p>
        """,
    },
    "eval-mri": {
        "title": "Step 3 — Pelvic MRI when deep disease is suspected",
        "html": f"""
            <p>Added selectively, not as a screening test. We order MRI when the ultrasound
            shows signs of deep disease (fixed retroverted uterus, obliterated cul-de-sac,
            complex endometriomas, suggestion of rectovaginal-septum involvement), when
            symptoms suggest bowel or bladder infiltration (cyclic dyschezia, hematuria,
            severe deep dyspareunia), or when surgical planning would benefit from a
            detailed map of the structures involved. The systematic-review evidence shows
            TVUS and MRI have comparable diagnostic accuracy for most DIE sites{cite("ref-5")};
            MRI adds value for bowel wall invasion depth, ureter involvement, and the
            handoff to a multidisciplinary surgical team (colorectal surgery, urology).
            We do NOT routinely order MRI for every patient with suspected endometriosis —
            doing so adds cost without diagnostic gain.</p>
        """,
    },
    "eval-labs": {
        "title": "Step 4 — Targeted bloodwork",
        "html": f"""
            <p><strong>What we order, and why:</strong></p>
            <ul style="margin: 6px 0 8px 18px; padding: 0; color: var(--fg-mid);">
                <li><strong>CBC with iron studies (including ferritin):</strong> screen for
                anemia from heavy menstrual bleeding. Ferritin under 30 indicates iron
                deficiency; under 15 indicates depleted stores.</li>
                <li><strong>Pregnancy test (β-hCG):</strong> mandatory before any hormonal
                therapy is started.</li>
                <li><strong>CA-125:</strong> ordered only when an endometrioma is present, as
                a <em>baseline for future surveillance</em>. ACOG explicitly recommends
                against using CA-125 as a diagnostic test for endometriosis — it lacks
                the sensitivity and specificity{cite("ref-1")}.</li>
                <li><strong>AMH (anti-Müllerian hormone):</strong> ordered when reproductive
                timing is a consideration or when an endometrioma exists that may require
                cystectomy. Drawn independent of cycle day.</li>
                <li><strong>TSH:</strong> rule out thyroid dysfunction as a contributor to
                menstrual irregularity.</li>
                <li><strong>UA, GC/CT NAAT, vaginal swab:</strong> rule out infection,
                interstitial cystitis, and PID as differential diagnoses.</li>
            </ul>
            <p>What we DON&rsquo;T order: panels of unvalidated biomarkers, &ldquo;endometriosis
            blood tests&rdquo; that have not held up in independent validation, or routine
            inflammatory markers that don&rsquo;t change management.</p>
        """,
    },
    "eval-pf": {
        "title": "Step 5 — Pelvic floor examination",
        "html": f"""
            <p>An assessment most clinics skip. Because <strong>50&ndash;80% of women with
            endometriosis or chronic pelvic pain have a coexisting pelvic floor muscle
            component</strong>{cite_multi("ref-7", "ref-12")}, missing this is the single biggest
            reason women have pain after &ldquo;a successful endometriosis surgery.&rdquo;
            We palpate the levator ani group, the obturator internus, the piriformis, and
            the iliopsoas — looking for trigger points, tight bands, and an inability
            to relax voluntarily. We also assess the abdominal wall (Carnett-positive
            trigger points). If pelvic-floor dysfunction is present, pelvic-floor
            physical therapy is started in parallel with whatever hormonal or surgical
            plan we make for the lesions themselves — they are two separate problems
            and they need two separate treatment streams.</p>
        """,
    },

    # ---- OMT-RCT deep dive ----
    "rct-munoz": {
        "title": "Muñoz-Gómez 2023 — the endometriosis OMT RCT",
        "html": f"""
            <p><strong>Design:</strong> randomized clinical trial. <strong>Population:</strong>
            41 women with endometriosis-related pelvic pain.
            <strong>Intervention:</strong> structured 8-week osteopathic manual-therapy
            protocol (1 session per week) including spinal HVLA, sacroiliac manipulation,
            visceral mobilization (abdominal and broad ligament), and pelvic diaphragm
            release. <strong>Control:</strong> usual care.
            <strong>Primary outcomes:</strong> pain (VAS) and endometriosis-specific
            quality of life (EHP-30).</p>
            <p><strong>Key results:</strong> the OMT group had statistically significant
            improvements in pain and in the EHP-30 control/powerlessness and emotional
            wellbeing domains compared with usual care. Effects were maintained at
            one-month follow-up after the treatment ended.</p>
            <p><strong>What this means for you:</strong> when an 8-week OMT protocol is added
            to your existing hormonal and pelvic-floor-PT care, randomized evidence
            supports a measurable improvement in pain and quality of life that lasts
            beyond the treatment window. It is not a replacement for hormonal therapy
            or surgery — it is an additive layer.{cite("ref-8")}</p>
        """,
    },
    "rct-molins": {
        "title": "Molins-Cubero 2014 — single-manipulation analgesia RCT",
        "html": f"""
            <p><strong>Design:</strong> double-blind randomized controlled trial.
            <strong>Population:</strong> 40 women with primary dysmenorrhea.
            <strong>Intervention:</strong> a single bilateral global sacroiliac HVLA
            (high-velocity-low-amplitude) manipulation. <strong>Control:</strong> sham
            procedure.</p>
            <p><strong>Key results:</strong> immediate, statistically significant reduction
            in pain perception in the treatment group, with measurable concurrent
            <em>increase in circulating serotonin and catecholamines</em> — the body&rsquo;s
            own pain-regulating neurochemistry. The sham group did not show pain reduction
            or neurochemical change.</p>
            <p><strong>What this means for you:</strong> the mechanism of OMT analgesia is
            not purely mechanical. There is a measurable neurochemical fingerprint —
            modulation of the body&rsquo;s endogenous pain-control systems — that
            accompanies the pain reduction. This study is one of the strongest pieces
            of biological-plausibility evidence for OMT in dysmenorrhea.{cite("ref-9")}</p>
        """,
    },
    "rct-ruffini": {
        "title": "Ruffini 2018 — five-session dysmenorrhea OMT RCT",
        "html": f"""
            <p><strong>Design:</strong> randomized controlled trial.
            <strong>Population:</strong> 31 women with primary dysmenorrhea.
            <strong>Intervention:</strong> 5-session OMT protocol timed to the cycle —
            sessions 4 and 5 specifically in the pre-menstrual and early menstrual
            window. <strong>Control:</strong> light-touch control.</p>
            <p><strong>Key results:</strong> the treatment group had a <strong>63% reduction
            in NRS menstrual pain</strong> (from 5.35 to 1.98 of 10), a +58% improvement
            in SF-12 physical-component quality of life, and a +36% improvement in
            mental-component quality of life. The light-touch control group showed no
            change.</p>
            <p><strong>What this means for you:</strong> for women with dysmenorrhea
            (cyclic menstrual pain), a 5-session OMT protocol timed around the
            menstrual cycle produces durable, large-effect pain reduction that
            light-touch alone does not produce — confirming that the effect is
            technique-specific, not placebo.{cite("ref-10")}</p>
        """,
    },
    "rct-alboni": {
        "title": "Alboni 2024 — OMT for post-surgical endometriosis pain",
        "html": f"""
            <p><strong>Design:</strong> retrospective comparative study.
            <strong>Population:</strong> women with recurrent pelvic pain and dyspareunia
            after surgery for endometriosis. <strong>Intervention:</strong> osteopathic
            visceral and fascial protocol added to standard post-operative care.
            <strong>Comparator:</strong> standard post-operative care alone.</p>
            <p><strong>Key results:</strong> statistically significant reduction in recurrent
            pelvic pain and deep dyspareunia in the OMT-treated group versus standard
            post-operative care alone.</p>
            <p><strong>What this means for you:</strong> if you have already had endometriosis
            surgery and pain has returned, the published evidence supports an osteopathic
            visceral-fascial protocol as a real additional treatment option — not
            instead of, but on top of, whatever hormonal or further surgical management
            is appropriate.{cite("ref-11")}</p>
        """,
    },
    "rct-fitzgerald": {
        "title": "FitzGerald 2012 — the NIH multicenter pelvic-floor PT RCT",
        "html": f"""
            <p><strong>Design:</strong> NIH-funded multicenter randomized clinical trial across
            11 NIH/NIDDK research centers. <strong>Population:</strong> women with
            interstitial cystitis / painful bladder syndrome and pelvic floor tenderness on
            exam. <strong>Intervention:</strong> myofascial pelvic-floor physical therapy.
            <strong>Comparator:</strong> general global therapeutic massage.</p>
            <p><strong>Key results:</strong> 59% response rate in the pelvic-floor PT group
            versus 26% response in the general-massage group — Level&nbsp;I evidence that
            specialized internal pelvic-floor PT is substantively superior to non-specific
            manual therapy for pelvic-floor myofascial pain.</p>
            <p><strong>What this means for you:</strong> when we recommend pelvic-floor PT, it
            matters that the therapist is <em>specifically trained in internal pelvic-floor
            work</em>. A general orthopedic physical therapist will not give you the same
            outcomes. The OMT-PFPT pairing addresses two different layers of the same
            problem — PFPT for the pelvic-floor muscles directly, OMT for the upstream
            spinal, visceral, and fascial contributors.{cite("ref-12")}</p>
        """,
    },
}

# Helper for rendering modals as <template> blocks
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

# Helper for the abstract details — convert abstract text to safe HTML paragraphs
def abstract_html(raw):
    if not raw:
        return ""
    # Strip the leading "1. <citation>." line and "Author information:" header
    text = raw.strip()
    # The verbatim efetch returns a structured text — keep paragraph breaks
    # We do minimal cleanup: collapse runs of blank lines to one blank, escape HTML
    text = re.sub(r'\r\n', '\n', text)
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    out = []
    for p in paragraphs:
        out.append("<p>" + html.escape(p).replace("\n", "<br>") + "</p>")
    return "\n".join(out)

# Helper for rendering each reference at the bottom
def render_refs():
    out = []
    for r_id, label, citation, pmid, abstract in REFS:
        n = r_id.replace("ref-", "")
        pmid_link = (f'<a href="https://pubmed.ncbi.nlm.nih.gov/{pmid}/" target="_blank" rel="noopener"><span class="pmid">PMID&nbsp;{pmid}</span></a>'
                     if pmid else '<span class="pmid no-pmid">no PMID</span>')
        abstract_block = (
            f'<details class="mz-abstract"><summary>Read the abstract</summary>'
            f'<div class="abstract-body">{abstract_html(abstract)}</div></details>'
            if abstract else
            f'<div class="no-abstract">No PubMed abstract available for this reference.</div>'
        )
        out.append(f"""
            <li id="{r_id}">
                <div class="ref-head">
                    <span class="ref-num">{n}</span>
                    <span class="ref-citation">{citation} &nbsp;{pmid_link}</span>
                </div>
                {abstract_block}
            </li>""")
    return "\n".join(out)


# ============================================================================
# The page HTML — manually authored prose, with cite() inline calls for §3.7-pattern
# peer-reviewed citations. Hover popouts + click-jump-to-ref + abstract details at the
# bottom. Per-card click-to-open modals.
# ============================================================================

CSS = """
:root {
    --bg-base: #07070a;
    --bg-card: rgba(255,255,255,0.04);
    --border: rgba(255,255,255,0.10);
    --fg-strong: #ffffff;
    --fg-mid: rgba(245,245,247,0.84);
    --fg-soft: rgba(245,245,247,0.62);
    --fg-dim: rgba(245,245,247,0.42);
    --accent: #6d28d9;
    --accent-soft: #a78bfa;
    --glow-purple: 167, 139, 250;
    --green: #10b981; --amber: #f59e0b; --red: #ef4444;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
html, body {
    margin: 0; padding: 0;
    background:
        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(var(--glow-purple), 0.14), transparent 60%),
        var(--bg-base);
    color: var(--fg-mid);
    font-family: 'Avenir Next', 'Avenir', 'Nunito Sans', -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    line-height: 1.55;
    min-height: 100vh;
}
a { color: var(--accent-soft); text-decoration: none; transition: color 0.2s; }
a:hover { color: var(--fg-strong); }

/* Site nav */
.site-nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(7, 7, 10, 0.86);
    backdrop-filter: blur(22px) saturate(165%);
    -webkit-backdrop-filter: blur(22px) saturate(165%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px clamp(16px, 4vw, 32px);
}
.site-nav .inner { display: flex; align-items: center; gap: 14px; max-width: 1100px; margin: 0 auto; }
.site-nav .brand {
    font-size: 13px; font-weight: 700;
    letter-spacing: 0.20em; text-transform: uppercase;
    color: rgba(var(--glow-purple), 0.95);
    text-decoration: none;
}
.site-nav .crumb { font-size: 12.5px; color: var(--fg-dim); }
.site-nav .right-actions { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.site-nav .right-actions a { font-size: 12.5px; color: var(--fg-soft); }
.site-nav .right-actions a:hover { color: var(--fg-strong); }
.site-nav .cta {
    background: rgba(var(--glow-purple), 0.16);
    border: 1px solid rgba(var(--glow-purple), 0.55);
    color: var(--accent-soft) !important;
    padding: 5px 14px; border-radius: 999px;
    font-weight: 500; transition: all 0.2s;
}
.site-nav .cta:hover { background: rgba(var(--glow-purple), 0.26); color: #fff !important; transform: translateY(-1px); }

.wrap { max-width: 1040px; margin: 0 auto; padding: clamp(28px, 5vw, 56px) clamp(18px, 5vw, 32px) 80px; }

@keyframes mzRise {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes mzFadeIn { from { opacity: 0; } to { opacity: 1; } }

/* HERO */
.hero { margin-bottom: clamp(32px, 6vw, 56px); animation: mzRise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
.hero .eyebrow {
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.24em; text-transform: uppercase;
    color: rgba(var(--glow-purple), 0.95);
    margin-bottom: 14px;
}
.hero h1 {
    font-weight: 200; font-size: clamp(34px, 6vw, 56px);
    letter-spacing: -0.022em; line-height: 1.05;
    color: var(--fg-strong); margin: 0 0 16px 0;
    max-width: 22ch;
}
.hero .lede { font-size: clamp(16px, 2.1vw, 19px); line-height: 1.55; color: var(--fg-mid); max-width: 64ch; margin-bottom: 18px; }
.hero .byline { font-size: 13px; color: var(--fg-soft); display: inline-flex; align-items: center; gap: 8px; }
.hero .byline strong { color: var(--fg-strong); font-weight: 500; }

/* KEY FACTS */
.facts {
    display: grid; gap: 12px;
    margin: clamp(28px, 4vw, 40px) 0;
    grid-template-columns: 1fr;
}
@media (min-width: 560px) { .facts { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 900px) { .facts { grid-template-columns: repeat(4, 1fr); } }
.fact {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 14px; padding: 18px 20px;
    backdrop-filter: blur(28px) saturate(165%);
    -webkit-backdrop-filter: blur(28px) saturate(165%);
    transition: transform 0.22s, border-color 0.22s, background 0.22s;
    animation: mzRise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.fact:hover { transform: translateY(-3px); border-color: rgba(var(--glow-purple), 0.45); }
.fact .stat { font-size: 36px; font-weight: 200; letter-spacing: -0.02em; color: var(--fg-strong); line-height: 1; font-feature-settings: "tnum"; }
.fact .stat .unit { font-size: 18px; color: var(--accent-soft); margin-left: 2px; }
.fact .label { font-size: 12px; color: var(--fg-soft); margin-top: 8px; line-height: 1.4; }

/* SECTIONS */
section.panel {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 16px;
    padding: clamp(22px, 4vw, 36px);
    backdrop-filter: blur(28px) saturate(165%);
    -webkit-backdrop-filter: blur(28px) saturate(165%);
    margin-bottom: clamp(16px, 3vw, 24px);
    transition: border-color 0.25s;
    animation: mzRise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
section.panel:hover { border-color: rgba(var(--glow-purple), 0.22); }
section.panel .section-eyebrow {
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.24em; text-transform: uppercase;
    color: rgba(var(--glow-purple), 0.95);
    margin-bottom: 10px;
}
section.panel h2 {
    font-weight: 200; font-size: clamp(24px, 3.4vw, 32px);
    letter-spacing: -0.012em; color: var(--fg-strong);
    margin: 0 0 18px 0; line-height: 1.15;
}
section.panel p {
    font-size: 16.5px; line-height: 1.7;
    color: var(--fg-mid); margin: 0 0 14px 0;
}
section.panel p:last-child { margin-bottom: 0; }
section.panel p strong { color: var(--fg-strong); font-weight: 500; }
section.panel p em { color: var(--accent-soft); font-style: normal; font-weight: 500; }
section.panel .section-intro { font-size: 15px; color: var(--fg-soft); max-width: 64ch; margin-bottom: 18px; }

/* INLINE CITATION SUP + POPOUT */
sup.mz-ref {
    display: inline-block;
    font-size: 0.7em;
    line-height: 1;
    vertical-align: super;
    position: relative;
    margin-left: 1px;
    cursor: pointer;
}
sup.mz-ref a {
    color: var(--accent-soft);
    font-weight: 600;
    text-decoration: none;
    padding: 0 2px;
    border-radius: 3px;
    transition: background 0.15s, color 0.15s;
}
sup.mz-ref:hover a,
sup.mz-ref.mz-open a,
sup.mz-ref:focus a {
    background: rgba(var(--glow-purple), 0.20);
    color: #fff;
    outline: none;
}
sup.mz-ref .mz-ref-pop {
    visibility: hidden; opacity: 0;
    position: absolute;
    bottom: 100%; left: 50%;
    transform: translate(-50%, -6px);
    width: 320px; max-width: 92vw;
    padding: 10px 14px;
    background: rgba(7,7,10,0.96);
    border: 1px solid rgba(var(--glow-purple), 0.55);
    border-radius: 10px;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: var(--fg-mid);
    font-size: 12.5px;
    line-height: 1.45;
    font-weight: 400;
    z-index: 200;
    text-align: left;
    pointer-events: none;
    transition: opacity 0.18s, transform 0.18s, visibility 0.18s;
    box-shadow: 0 12px 36px rgba(0,0,0,0.5);
    white-space: normal;
}
sup.mz-ref:hover .mz-ref-pop,
sup.mz-ref:focus-within .mz-ref-pop,
sup.mz-ref.mz-open .mz-ref-pop {
    visibility: visible;
    opacity: 1;
    transform: translate(-50%, -10px);
}

/* CARDS — phenotypes, pain-sources, treatment rungs, OMT RCT
   Explicit columns per card count to prevent the auto-fit 3+1 / 3+2 wrap
   problem. Each modifier locks the row size so cards stay even at every
   breakpoint. */
.card-grid { display: grid; gap: 14px; margin-top: 18px; grid-template-columns: 1fr; }
@media (min-width: 560px) {
    .card-grid--3 { grid-template-columns: repeat(2, 1fr); }
    .card-grid--4 { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 900px) {
    .card-grid--3 { grid-template-columns: repeat(3, 1fr); }
    .card-grid--4 { grid-template-columns: repeat(4, 1fr); }
}

/* Symptoms grid — 8 items, want 1/2/4 columns */
.symptoms {
    display: grid; gap: 10px; margin-top: 18px;
    grid-template-columns: 1fr;
}
@media (min-width: 560px) { .symptoms { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { .symptoms { grid-template-columns: repeat(4, 1fr); } }

/* Featured banner card — used for the lone FitzGerald PFPT RCT below
   the OMT 4-card grid so it doesn't look orphaned. Full-width, two-column
   internal layout. */
.featured-card {
    display: grid; gap: 18px;
    grid-template-columns: 1fr;
    background: rgba(var(--glow-purple), 0.07);
    border: 1px solid rgba(var(--glow-purple), 0.40);
    border-radius: 14px;
    padding: 18px 22px;
    margin-top: 14px;
    cursor: pointer;
    transition: border-color 0.22s, background 0.22s, transform 0.22s;
    align-items: center;
    position: relative;
}
.featured-card:hover, .featured-card:focus {
    border-color: rgba(var(--glow-purple), 0.65);
    background: rgba(var(--glow-purple), 0.12);
    transform: translateY(-1px);
    outline: none;
}
.featured-card h3 {
    font-size: 16px; font-weight: 500;
    color: var(--fg-strong); margin: 0 0 4px 0;
    padding-right: 80px;
}
.featured-card p { font-size: 14px !important; line-height: 1.6; color: var(--fg-mid); margin: 0; }
.featured-card .open-hint {
    position: absolute; top: 18px; right: 22px;
    font-size: 11px; color: rgba(var(--glow-purple), 0.85);
    letter-spacing: 0.08em;
}
.featured-card .stat-badge {
    display: inline-flex; align-items: baseline; gap: 6px;
    background: rgba(var(--glow-purple), 0.18);
    border: 1px solid rgba(var(--glow-purple), 0.55);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px; color: var(--accent-soft);
    font-weight: 500;
    margin-top: 6px;
    margin-right: 8px;
}
.featured-card .stat-badge strong { color: #fff; font-weight: 600; font-size: 13.5px; }
@media (min-width: 720px) {
    .featured-card { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }
}
.card {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
    cursor: pointer;
    position: relative;
    transition: transform 0.22s, border-color 0.22s, background 0.22s, box-shadow 0.22s;
    animation: mzRise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.card:hover, .card:focus {
    transform: translateY(-2px);
    border-color: rgba(var(--glow-purple), 0.50);
    background: rgba(var(--glow-purple), 0.06);
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    outline: none;
}
.card .card-svg { width: 48px; height: 48px; margin-bottom: 10px; display: block; }
.card h3 { font-size: 14.5px; font-weight: 500; color: var(--fg-strong); margin: 0 0 6px 0; padding-right: 28px; }
.card p { font-size: 13px !important; line-height: 1.55; color: var(--fg-soft); margin: 0; }
.card .card-corner {
    position: absolute; top: 12px; right: 14px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.18em;
    color: rgba(var(--glow-purple), 0.85);
}
.card .open-hint {
    position: absolute; bottom: 12px; right: 14px;
    font-size: 11px; color: rgba(var(--glow-purple), 0.75);
    opacity: 0.7;
    letter-spacing: 0.08em;
}
.card:hover .open-hint, .card:focus .open-hint { opacity: 1; color: var(--accent-soft); }

/* SYMPTOMS card item style (grid columns defined above with the .card-grid family) */
.symptom {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 11px;
    padding: 12px 14px 12px 44px;
    position: relative;
    font-size: 14px; color: var(--fg-mid);
    transition: border-color 0.2s, background 0.2s, transform 0.2s;
}
.symptom:hover { border-color: rgba(var(--glow-purple), 0.40); background: rgba(var(--glow-purple), 0.06); transform: translateY(-1px); }
.symptom::before {
    content: ""; position: absolute; left: 14px; top: 50%;
    transform: translateY(-50%);
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid rgba(var(--glow-purple), 0.50);
    background: rgba(var(--glow-purple), 0.08);
}
.symptom strong { color: var(--fg-strong); font-weight: 500; display: block; margin-bottom: 2px; }
.symptom .or { font-size: 11px; color: var(--accent-soft); font-weight: 700; letter-spacing: 0.06em; margin-left: 6px; }

/* TIMELINE */
.timeline { position: relative; padding-left: 24px; margin-top: 18px; }
.timeline::before {
    content: ''; position: absolute; left: 6px; top: 10px; bottom: 10px;
    width: 2px;
    background: linear-gradient(180deg, rgba(var(--glow-purple), 0.55), rgba(var(--glow-purple), 0.18));
}
.timeline-item {
    position: relative; margin-bottom: 16px;
    animation: mzRise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    cursor: pointer;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 11px;
    padding: 12px 14px;
    transition: border-color 0.22s, background 0.22s;
}
.timeline-item:hover, .timeline-item:focus {
    border-color: rgba(var(--glow-purple), 0.40);
    background: rgba(var(--glow-purple), 0.06);
    outline: none;
}
.timeline-item:last-child { margin-bottom: 0; }
.timeline-item::before {
    content: ''; position: absolute; left: -24px; top: 18px;
    width: 12px; height: 12px; border-radius: 50%;
    background: rgba(var(--glow-purple), 0.95);
    box-shadow: 0 0 0 4px rgba(var(--glow-purple), 0.16);
}
.timeline-item h3 { font-size: 15.5px; font-weight: 500; color: var(--fg-strong); margin: 0 0 4px 0; padding-right: 36px; }
.timeline-item p { font-size: 14px !important; line-height: 1.55; color: var(--fg-soft); margin: 0; }
.timeline-item .open-hint {
    position: absolute; top: 14px; right: 16px;
    font-size: 11px; color: rgba(var(--glow-purple), 0.75);
    letter-spacing: 0.08em;
}

/* TREATMENT LADDER */
.ladder { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 18px; }
.rung {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    gap: 16px; align-items: start;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
    cursor: pointer;
    transition: border-color 0.22s, background 0.22s, transform 0.22s;
}
.rung:hover, .rung:focus {
    border-color: rgba(var(--glow-purple), 0.45);
    background: rgba(var(--glow-purple), 0.06);
    transform: translateY(-1px);
    outline: none;
}
.rung .step-num { font-size: 28px; font-weight: 200; letter-spacing: -0.02em; color: rgba(var(--glow-purple), 0.95); line-height: 1; font-variant-numeric: tabular-nums; }
.rung h3 { font-size: 15.5px; font-weight: 500; color: var(--fg-strong); margin: 0 0 4px 0; }
.rung p { font-size: 13.5px !important; line-height: 1.55; color: var(--fg-mid); margin: 0; }
.rung .meds { font-size: 12px; color: var(--accent-soft); margin-top: 6px; line-height: 1.55; font-family: "SF Mono", "Menlo", monospace; }
.rung-tag {
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 999px; white-space: nowrap;
    background: rgba(var(--glow-purple), 0.12);
    border: 1px solid rgba(var(--glow-purple), 0.40);
    color: var(--accent-soft);
    align-self: center;
}

/* OMT block */
.omt-block {
    background: rgba(var(--glow-purple), 0.06);
    border: 1px solid rgba(var(--glow-purple), 0.35);
    border-radius: 14px;
    padding: clamp(22px, 4vw, 36px);
    margin-top: 18px;
}
.omt-block .quote-frame {
    border-left: 3px solid rgba(var(--glow-purple), 0.60);
    padding: 6px 0 6px 18px;
    margin: 14px 0;
    color: var(--fg-mid);
    font-size: 16px; line-height: 1.7;
    position: relative;
}
.omt-block .quote-frame::before {
    content: '\\201C';
    position: absolute;
    left: 6px; top: -4px;
    font-family: Georgia, serif;
    color: rgba(var(--glow-purple), 0.40);
    font-size: 26px; line-height: 1;
}

/* Q&A accordion */
.qa-list { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
details.qa {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 11px;
    transition: border-color 0.22s, background 0.22s;
    animation: mzRise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}
details.qa:hover { border-color: rgba(var(--glow-purple), 0.35); }
details.qa[open] { border-color: rgba(var(--glow-purple), 0.55); background: rgba(var(--glow-purple), 0.05); }
details.qa summary {
    list-style: none; cursor: pointer;
    padding: 14px 50px 14px 18px;
    font-size: 15.5px; font-weight: 500;
    color: var(--fg-strong); position: relative; line-height: 1.4;
}
details.qa summary::-webkit-details-marker { display: none; }
details.qa summary::after {
    content: '+';
    position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
    font-size: 22px; color: var(--accent-soft);
    font-weight: 200; line-height: 1;
    transition: transform 0.2s;
}
details.qa[open] summary::after { content: '\\2212'; }
details.qa .qa-answer { padding: 0 18px 18px 18px; font-size: 14.5px; line-height: 1.7; color: var(--fg-mid); }
details.qa .qa-answer p { font-size: 14.5px !important; margin: 0 0 10px 0; }
details.qa .qa-answer p:last-child { margin: 0; }

/* Red flags */
.red-flags {
    background: rgba(239, 68, 68, 0.04);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 12px;
    padding: 18px 22px;
    margin-top: 18px;
}
.red-flags .red-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(252, 165, 165, 0.95); margin-bottom: 12px; }
.red-flags ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.red-flags li { font-size: 14px; color: var(--fg-mid); line-height: 1.55; padding-left: 20px; position: relative; }
.red-flags li::before { content: '\\26A0'; position: absolute; left: 0; top: 0; color: rgba(252, 165, 165, 0.95); font-size: 12px; }

/* CTA */
.cta-strip {
    background: rgba(var(--glow-purple), 0.10);
    border: 1px solid rgba(var(--glow-purple), 0.45);
    border-radius: 14px;
    padding: clamp(22px, 4vw, 36px);
    text-align: center;
    margin-top: clamp(20px, 4vw, 32px);
}
.cta-strip h2 { font-weight: 200; font-size: clamp(22px, 3vw, 28px); color: var(--fg-strong); margin: 0 0 8px 0; letter-spacing: -0.01em; }
.cta-strip p { font-size: 15px; color: var(--fg-mid); margin: 0 0 18px 0; max-width: 56ch; margin-left: auto; margin-right: auto; }
.cta-strip a.btn {
    display: inline-block;
    background: rgba(var(--glow-purple), 0.20);
    border: 1px solid rgba(var(--glow-purple), 0.65);
    color: #fff;
    padding: 10px 24px; border-radius: 999px;
    font-size: 14px; font-weight: 500;
    transition: all 0.2s; margin: 4px;
}
.cta-strip a.btn:hover { background: rgba(var(--glow-purple), 0.32); transform: translateY(-2px); }
.cta-strip a.btn.ghost { background: transparent; border-color: var(--border); color: var(--fg-mid); }
.cta-strip a.btn.ghost:hover { color: #fff; border-color: rgba(var(--glow-purple), 0.55); }

/* REFERENCES (inline-journal style at the bottom — full citations + abstract details) */
.refs-list { margin-top: 18px; list-style: none; padding: 0; counter-reset: ref; }
.refs-list li {
    padding: 14px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    counter-increment: ref;
}
.refs-list li:last-child { border-bottom: none; }
.refs-list .ref-head { display: grid; grid-template-columns: 30px 1fr; gap: 10px; align-items: start; }
.refs-list .ref-num {
    width: 24px; height: 24px;
    border-radius: 50%;
    background: rgba(var(--glow-purple), 0.12);
    border: 1px solid rgba(var(--glow-purple), 0.40);
    color: var(--accent-soft);
    font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.refs-list .ref-citation { font-size: 14px; line-height: 1.55; color: var(--fg-mid); }
.refs-list .ref-citation strong { color: var(--fg-strong); font-weight: 500; }
.refs-list .ref-citation em { color: var(--accent-soft); font-style: normal; }
.refs-list .pmid {
    display: inline-block;
    font-family: "SF Mono", "Menlo", monospace;
    font-size: 11.5px; color: var(--accent-soft);
    background: rgba(var(--glow-purple), 0.10);
    padding: 1px 6px; border-radius: 4px;
    white-space: nowrap;
}
.refs-list .pmid.no-pmid { color: var(--fg-dim); background: rgba(255,255,255,0.04); }
.refs-list .pmid:hover { color: #fff; background: rgba(var(--glow-purple), 0.25); }
details.mz-abstract {
    margin-top: 10px;
    margin-left: 40px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
}
details.mz-abstract summary {
    list-style: none; cursor: pointer;
    padding: 8px 14px;
    font-size: 12px; color: var(--accent-soft);
    font-weight: 500;
    letter-spacing: 0.04em;
    position: relative;
}
details.mz-abstract summary::-webkit-details-marker { display: none; }
details.mz-abstract summary::before { content: '+ '; color: var(--fg-dim); }
details.mz-abstract[open] summary::before { content: '\\2212 '; }
details.mz-abstract[open] { border-color: rgba(var(--glow-purple), 0.30); background: rgba(var(--glow-purple), 0.04); }
details.mz-abstract .abstract-body {
    padding: 4px 16px 14px 28px;
    font-size: 12.5px;
    color: var(--fg-soft);
    line-height: 1.6;
    font-family: Georgia, 'Times New Roman', serif;
}
details.mz-abstract .abstract-body p { margin: 0 0 8px 0; font-size: 12.5px !important; line-height: 1.6 !important; }
details.mz-abstract .abstract-body p:last-child { margin-bottom: 0; }
.no-abstract { margin: 10px 0 0 40px; font-size: 12px; color: var(--fg-dim); font-style: italic; }

/* MODAL system */
.mz-modal-bg {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.66);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 999;
    display: none;
    align-items: center; justify-content: center;
    padding: 24px;
    animation: mzFadeIn 0.18s ease both;
}
.mz-modal-bg.open { display: flex; }
.mz-modal {
    width: 100%; max-width: 700px;
    max-height: 88vh; overflow-y: auto;
    background: rgba(12,12,16,0.96);
    border: 1px solid rgba(var(--glow-purple), 0.50);
    border-radius: 18px;
    padding: clamp(24px, 4vw, 40px);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    position: relative;
    animation: mzRise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.mz-modal-close {
    position: absolute; top: 16px; right: 16px;
    width: 36px; height: 36px;
    border-radius: 50%;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--border);
    color: var(--fg-soft);
    font-size: 20px; line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
}
.mz-modal-close:hover { color: #fff; border-color: rgba(var(--glow-purple), 0.65); background: rgba(var(--glow-purple), 0.14); }
.mz-modal h2 {
    font-weight: 200; font-size: clamp(22px, 3vw, 30px);
    letter-spacing: -0.015em; color: var(--fg-strong);
    margin: 0 0 18px 0; padding-right: 50px; line-height: 1.2;
}
.mz-modal p { font-size: 15px !important; line-height: 1.7; color: var(--fg-mid); margin: 0 0 12px 0; }
.mz-modal p strong { color: var(--fg-strong); font-weight: 500; }
.mz-modal p em { color: var(--accent-soft); font-style: normal; font-weight: 500; }

/* Footer note */
.footer-note {
    margin-top: 40px; padding: 20px 24px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 12.5px; color: var(--fg-dim);
    line-height: 1.6;
}
.footer-note strong { color: var(--fg-soft); font-weight: 500; }

@media (prefers-reduced-motion: reduce) {
    .hero, section.panel, .fact, .card, .timeline-item, details.qa, .mz-modal { animation: none !important; }
    * { transition: none !important; }
    html { scroll-behavior: auto; }
}
@media (max-width: 640px) {
    .hero h1 { font-size: 32px; }
    section.panel { padding: 22px 18px; }
    .site-nav .crumb { display: none; }
    sup.mz-ref .mz-ref-pop { width: min(280px, 84vw); }
    details.mz-abstract { margin-left: 0; }
}
"""

# ============================================================================
# BODY
# ============================================================================

BODY_HTML = f"""
<nav class="site-nav" aria-label="Site navigation">
    <div class="inner">
        <a class="brand" href="/">Mount Zara</a>
        <span class="crumb">·  Patient Education  ·  Endometriosis</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>

<div class="wrap">

    <header class="hero">
        <div class="eyebrow">Patient Education · Endometriosis</div>
        <h1>Endometriosis — what it is, why it hurts, and what we can actually do.</h1>
        <p class="lede">
            Endometriosis is a chronic condition where tissue similar to the lining of the uterus grows outside the
            uterus, causing pain and sometimes fertility problems{cite_multi("ref-1", "ref-14")}. This is a plain-language
            guide for women who suspect they have it, who have just been diagnosed, or who have lived with it for years
            and want a clearer understanding of every option — from NSAIDs to laparoscopic excision, plus the
            osteopathic and pelvic-floor layers most online articles never mention. Every clinical claim on this page
            is cited inline to peer-reviewed published evidence; the full bibliography with abstracts is at the bottom.
        </p>
        <div class="byline">Reviewed by <strong>Christopher Z. Mabini, DO, MSAEd</strong> · AAGL Fellow, Minimally Invasive Gynecologic Surgery</div>
    </header>

    <div class="facts">
        <div class="fact" style="animation-delay: 0ms;">
            <div class="stat">6&ndash;10<span class="unit">%</span></div>
            <div class="label">of reproductive-age women — roughly <strong>190&nbsp;million worldwide</strong>{cite("ref-14")}.</div>
        </div>
        <div class="fact" style="animation-delay: 70ms;">
            <div class="stat">7&ndash;10<span class="unit"> yr</span></div>
            <div class="label">average delay between first symptoms and a confirmed diagnosis{cite("ref-3")}.</div>
        </div>
        <div class="fact" style="animation-delay: 140ms;">
            <div class="stat">60&ndash;80<span class="unit">%</span></div>
            <div class="label">respond to first-line medical therapy — surgery is rarely the first step{cite_multi("ref-2", "ref-4")}.</div>
        </div>
        <div class="fact" style="animation-delay: 210ms;">
            <div class="stat">50&ndash;80<span class="unit">%</span></div>
            <div class="label">also have a <strong>pelvic-floor muscle component</strong> driving the pain{cite_multi("ref-7", "ref-12")}.</div>
        </div>
    </div>

    <!-- WHAT IT IS — with clickable phenotype cards -->
    <section class="panel" style="animation-delay: 60ms;">
        <div class="section-eyebrow">What it actually is</div>
        <h2>Tissue that belongs in one place, growing in another &mdash; and behaving badly.</h2>
        <p>
            Every month, the lining of your uterus (the <em>endometrium</em>) thickens and then sheds during your
            period. In endometriosis, tissue that looks and behaves like that lining ends up <strong>outside</strong>
            the uterus &mdash; on the ovaries, on the ligaments that hold the uterus in place, on the bladder, the
            bowel, the lining of the pelvis. Each month, that tissue still <em>tries to bleed</em>{cite("ref-1")}. But
            it has nowhere to go.
        </p>
        <p>
            That trapped bleeding causes inflammation, scarring (called adhesions), and over time, deeply sensitized
            pain pathways. Endometriosis is <strong>not</strong> a disease of unusually heavy or painful periods alone
            &mdash; it is an estrogen-driven, inflammatory condition that grows and changes over years if it is not
            treated{cite("ref-2")}.
        </p>
        <p>
            Three different patterns show up on imaging and at surgery. Most women have more than one. <em>Click any card to read more.</em>
        </p>

        <div class="card-grid card-grid--3" role="list">
            <article class="card" role="listitem" tabindex="0" data-modal="ph-superficial" aria-label="Open more about superficial peritoneal implants">
                <svg class="card-svg" viewBox="0 0 56 56" aria-hidden="true">
                    <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(167,139,250,0.30)" stroke-width="1.5"/>
                    <circle cx="20" cy="22" r="2.5" fill="rgba(167,139,250,0.85)"/>
                    <circle cx="34" cy="24" r="2" fill="rgba(167,139,250,0.85)"/>
                    <circle cx="28" cy="34" r="2.5" fill="rgba(167,139,250,0.85)"/>
                    <circle cx="40" cy="36" r="1.8" fill="rgba(167,139,250,0.85)"/>
                    <circle cx="16" cy="36" r="1.8" fill="rgba(167,139,250,0.85)"/>
                </svg>
                <h3>Superficial peritoneal implants</h3>
                <p>Small patches of endometriotic tissue on the lining of the pelvis. Most common form. Often invisible on routine ultrasound{cite("ref-5")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>

            <article class="card" role="listitem" tabindex="0" data-modal="ph-endometrioma" aria-label="Open more about ovarian endometriomas">
                <svg class="card-svg" viewBox="0 0 56 56" aria-hidden="true">
                    <circle cx="28" cy="28" r="22" fill="rgba(167,139,250,0.18)" stroke="rgba(167,139,250,0.65)" stroke-width="1.5"/>
                    <circle cx="28" cy="28" r="14" fill="rgba(167,139,250,0.30)"/>
                    <circle cx="28" cy="28" r="6" fill="rgba(255,255,255,0.85)" opacity="0.5"/>
                </svg>
                <h3>Ovarian endometriomas</h3>
                <p>Cysts on the ovary filled with old, dark blood (&ldquo;chocolate cysts&rdquo;). Show up reliably on ultrasound{cite("ref-5")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>

            <article class="card" role="listitem" tabindex="0" data-modal="ph-deep" aria-label="Open more about deep infiltrating endometriosis">
                <svg class="card-svg" viewBox="0 0 56 56" aria-hidden="true">
                    <path d="M 6 30 Q 14 18, 28 22 Q 42 26, 50 18" stroke="rgba(167,139,250,0.85)" stroke-width="2.2" fill="none"/>
                    <path d="M 6 40 Q 18 32, 30 36 Q 44 40, 50 32" stroke="rgba(167,139,250,0.55)" stroke-width="2.2" fill="none"/>
                    <circle cx="28" cy="22" r="3" fill="rgba(167,139,250,0.85)"/>
                </svg>
                <h3>Deep infiltrating endometriosis</h3>
                <p>Lesions invading the bowel, bladder, rectovaginal septum, or ligaments behind the uterus. Most severe symptoms; needs MRI mapping{cite("ref-5")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
        </div>

        <p style="margin-top: 20px; font-size: 14px; color: var(--fg-soft);">
            One thing that surprises most people: <strong>the severity of symptoms does not match the visible amount of disease.</strong>
            A woman with a tiny patch of superficial endometriosis can have debilitating pain, while a woman with a 6&nbsp;cm endometrioma may have almost none{cite("ref-1")}.
        </p>
    </section>

    <!-- WHY IT HURTS -->
    <section class="panel" style="animation-delay: 120ms;">
        <div class="section-eyebrow">Why it hurts</div>
        <h2>Four overlapping pain sources, all happening at the same time.</h2>
        <p class="section-intro">
            One of the reasons endometriosis is so often under-treated is that pain in this condition is never coming
            from just one place. Treating only the lesions &mdash; with hormones or even with surgery &mdash; leaves
            the other three layers untreated, which is why so many women continue to hurt after &ldquo;the surgery went
            well.&rdquo; <em>Click any card to read the deeper dive on that layer.</em>
        </p>

        <div class="card-grid card-grid--4" role="list">
            <article class="card" role="listitem" tabindex="0" data-modal="pain-lesions" aria-label="Open more about the lesion layer">
                <span class="card-corner">01</span>
                <h3>The lesions themselves</h3>
                <p>Each implant releases <strong>prostaglandins</strong> and inflammatory cytokines &mdash; what NSAIDs and continuous hormones directly target{cite("ref-2")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
            <article class="card" role="listitem" tabindex="0" data-modal="pain-nerves" aria-label="Open more about the nerve layer">
                <span class="card-corner">02</span>
                <h3>Sensitized nerves</h3>
                <p>Long-standing lesions <strong>amplify</strong> nerve signals — first locally, then in the spinal cord and brain. Pain can persist even after lesions are removed{cite("ref-7")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
            <article class="card" role="listitem" tabindex="0" data-modal="pain-muscles" aria-label="Open more about the pelvic floor layer">
                <span class="card-corner">03</span>
                <h3>Pelvic-floor muscles</h3>
                <p>Months of pain teach the levator muscles to <strong>guard</strong> &mdash; trigger points, tight bands, inability to relax. Present in up to <strong>80%</strong>{cite("ref-12")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
            <article class="card" role="listitem" tabindex="0" data-modal="pain-fascia" aria-label="Open more about the fascial layer">
                <span class="card-corner">04</span>
                <h3>Fascia &amp; ligaments</h3>
                <p>Broad ligament and uterosacral ligaments restricted by adhesions, pulling on the pelvis and creating mechanical pain even at rest{cite_multi("ref-2", "ref-8")}.</p>
                <span class="open-hint">read more &rarr;</span>
            </article>
        </div>
    </section>

    <!-- SIGNS -->
    <section class="panel" style="animation-delay: 180ms;">
        <div class="section-eyebrow">Signs you might have endometriosis</div>
        <h2>The symptom pattern that should put it on the table.</h2>
        <p class="section-intro">
            No single symptom is unique to endometriosis &mdash; but the <em>pattern</em> below is so consistent that a
            careful history alone is now considered enough to start treatment, without requiring a diagnostic surgery
            first{cite("ref-1")}.
        </p>
        <div class="symptoms">
            <div class="symptom"><strong>Progressive period pain</strong>Cramps that have been getting worse over years, not improving with over-the-counter NSAIDs, missing work or school. <span class="or">OR&nbsp;8.1 vs. women without endo</span></div>
            <div class="symptom"><strong>Deep pain with intercourse</strong>Pain felt deep inside, not at the opening — especially in certain positions. <span class="or">OR&nbsp;6.0</span></div>
            <div class="symptom"><strong>Pain with bowel movements</strong>Especially around your period (called <em>dyschezia</em>). Sometimes with constipation or diarrhea.</div>
            <div class="symptom"><strong>Pain with urination</strong>Especially around your period; may include feeling unable to fully empty the bladder.</div>
            <div class="symptom"><strong>Chronic pain between periods</strong>Pain that doesn&rsquo;t go away when your period ends, or pain most days of the month{cite("ref-7")}.</div>
            <div class="symptom"><strong>Heavy menstrual bleeding</strong>Sometimes with low iron from chronic blood loss.</div>
            <div class="symptom"><strong>Trouble getting pregnant</strong>Endometriosis is present in roughly <strong>38%</strong> of women evaluated for infertility{cite_multi("ref-3", "ref-4")}.</div>
            <div class="symptom"><strong>Family history</strong>A mother or sister with endometriosis raises your risk <strong>7&ndash;10&times;</strong>.</div>
        </div>
    </section>

    <!-- EVALUATION TIMELINE -->
    <section class="panel" style="animation-delay: 240ms;">
        <div class="section-eyebrow">How Dr. Mabini will evaluate you</div>
        <h2>You do not need surgery to be diagnosed.</h2>
        <p class="section-intro">
            For decades, a definitive diagnosis required laparoscopic surgery. That standard has changed.
            <strong>ACOG now explicitly recommends a clinical diagnosis based on history and exam is sufficient to
            begin treatment</strong>{cite("ref-1")} &mdash; reserving surgery for cases that fail medical therapy or
            where surgery would be the treatment anyway. <em>Click any step to read the deep dive.</em>
        </p>

        <div class="timeline">
            <div class="timeline-item" tabindex="0" data-modal="eval-history" style="animation-delay: 0ms;">
                <span class="open-hint">read more &rarr;</span>
                <h3>Detailed pain history + functional impact</h3>
                <p>VAS pain score, character, timing, location, triggers, days missed. Baseline pain diary so future treatment response is measured in numbers, not impressions.</p>
            </div>
            <div class="timeline-item" tabindex="0" data-modal="eval-tvus" style="animation-delay: 60ms;">
                <span class="open-hint">read more &rarr;</span>
                <h3>Compartment-based transvaginal ultrasound</h3>
                <p>Performed in office by Dr.&nbsp;Mabini, not delegated. Systematic anterior / middle / posterior compartment sweep with uterine sliding-sign assessment{cite("ref-5")}.</p>
            </div>
            <div class="timeline-item" tabindex="0" data-modal="eval-mri" style="animation-delay: 120ms;">
                <span class="open-hint">read more &rarr;</span>
                <h3>Pelvic MRI &mdash; only if deep disease is suspected</h3>
                <p>Added selectively for bowel / bladder / ureter involvement or surgical planning. Not a screening test{cite("ref-5")}.</p>
            </div>
            <div class="timeline-item" tabindex="0" data-modal="eval-labs" style="animation-delay: 180ms;">
                <span class="open-hint">read more &rarr;</span>
                <h3>Targeted bloodwork &mdash; not a screening fishing trip</h3>
                <p>CBC + ferritin, hCG, AMH if reproductive concerns, CA-125 only as endometrioma baseline (not as a diagnostic test{cite("ref-1")}), TSH, GC/CT/UA to rule out other contributors.</p>
            </div>
            <div class="timeline-item" tabindex="0" data-modal="eval-pf" style="animation-delay: 240ms;">
                <span class="open-hint">read more &rarr;</span>
                <h3>Pelvic-floor examination</h3>
                <p>The assessment most clinics skip. Because <strong>50&ndash;80%</strong> of women with endometriosis have a coexisting pelvic-floor muscle component{cite("ref-12")}, missing this is the single biggest reason surgery &ldquo;doesn&rsquo;t work.&rdquo;</p>
            </div>
        </div>
    </section>

    <!-- TREATMENT LADDER -->
    <section class="panel" style="animation-delay: 300ms;">
        <div class="section-eyebrow">The treatment ladder</div>
        <h2>Most women never need surgery. Here is how we get there.</h2>
        <p class="section-intro">
            Endometriosis is a <em>chronic, estrogen-dependent</em> condition. Most treatments work by reducing or
            eliminating monthly cycles, which both calms current symptoms and slows disease progression{cite_multi("ref-2", "ref-6")}.
            We move up the ladder one step at a time, judging each on response over 3&ndash;6 months. <em>Click any rung
            to read what that step involves in detail — including risks, benefits, and alternatives.</em>
        </p>

        <div class="ladder">
            <article class="rung" tabindex="0" data-modal="rung-1" aria-label="Open step 1 in detail">
                <div class="step-num">01</div>
                <div>
                    <h3>NSAIDs + continuous hormonal contraception</h3>
                    <p>First-line for almost everyone. NSAIDs taken <strong>pre-emptively</strong> 1&ndash;2 days before period (more effective than waiting until pain starts). Continuous combined OCP suppresses the cycle entirely{cite("ref-2")}.</p>
                    <p class="meds">naproxen 500&nbsp;mg BID · continuous OCP (norethindrone/EE 1&nbsp;mg / 20&nbsp;mcg)</p>
                </div>
                <span class="rung-tag">First line</span>
            </article>

            <article class="rung" tabindex="0" data-modal="rung-2" aria-label="Open step 2 in detail">
                <div class="step-num">02</div>
                <div>
                    <h3>Progestin-only therapy or LNG-IUD</h3>
                    <p>For estrogen-contraindicated patients or breakthrough pain. The LNG-IUD delivers progestin locally with low systemic exposure &mdash; <strong>40% amenorrhea at 12 months</strong>. Reduces post-op recurrence{cite("ref-6")}.</p>
                    <p class="meds">norethindrone acetate 5&nbsp;mg daily · LNG-IUD 52&nbsp;mg · DMPA 150&nbsp;mg IM q12&nbsp;wk</p>
                </div>
                <span class="rung-tag">Second line</span>
            </article>

            <article class="rung" tabindex="0" data-modal="rung-3" aria-label="Open step 3 in detail">
                <div class="step-num">03</div>
                <div>
                    <h3>GnRH antagonist with add-back hormones</h3>
                    <p>Oral GnRH antagonists suppress ovarian estrogen. <strong>Always paired with a low-dose hormonal add-back</strong> to prevent hot flashes and protect bone density &mdash; the standard of care.</p>
                    <p class="meds">elagolix 150&nbsp;mg daily (up to 24&nbsp;mo) or 200&nbsp;mg BID (up to 6&nbsp;mo) + norethindrone acetate 5&nbsp;mg add-back · relugolix combo tablet</p>
                </div>
                <span class="rung-tag">Third line</span>
            </article>

            <article class="rung" tabindex="0" data-modal="rung-4" aria-label="Open step 4 in detail">
                <div class="step-num">04</div>
                <div>
                    <h3>Laparoscopic excision surgery</h3>
                    <p>When medical therapy fails after a real trial, when fertility is the goal, or when an endometrioma threatens the ovary. <strong>Excision is superior to drainage / ablation</strong> for endometriomas{cite("ref-2")}. Pain relief: 60&ndash;80%. Recurrence: 20&ndash;40% over five years &mdash; reduced to 8&ndash;15% with post-op suppression{cite("ref-6")}. Fertility rates improved in selected patients{cite("ref-4")}.</p>
                    <p class="meds">Laparoscopic excision · post-op LNG-IUD or continuous OCP for long-term recurrence prevention</p>
                </div>
                <span class="rung-tag">Surgical</span>
            </article>
        </div>

        <p style="margin-top: 20px; font-size: 14px; color: var(--fg-soft);">
            <strong>In parallel with the medical ladder, two adjuncts are added when indicated:</strong> pelvic-floor
            physical therapy when there&rsquo;s a muscle component (which is most patients){cite("ref-12")}, and
            osteopathic manipulative treatment, which addresses the structural and neurological layer that hormones and
            even surgery don&rsquo;t directly reach{cite_multi("ref-8", "ref-11")}.
        </p>
    </section>

    <!-- OMT section -->
    <section class="panel" style="animation-delay: 360ms;">
        <div class="section-eyebrow">The osteopathic layer</div>
        <h2>OMT does not replace anything you are already doing. It addresses what they can&rsquo;t.</h2>
        <p class="section-intro">
            Dr.&nbsp;Mabini is a DO &mdash; a fully licensed gynecologic surgeon with additional training in
            osteopathic manipulative treatment. For pelvic pain, OMT is a structural and neurological add-on that
            layers on top of standard care.
        </p>

        <div class="omt-block">
            <p style="font-size: 13.5px; color: var(--fg-dim); margin-bottom: 8px; letter-spacing: 0.08em; text-transform: uppercase;">From Dr.&nbsp;Mabini&rsquo;s clinic counseling script, verbatim:</p>
            <div class="quote-frame">
                In endometriosis, pain comes from at least four overlapping sources simultaneously: the lesions themselves
                releasing inflammatory chemicals like prostaglandins and cytokines; the nerves around the lesions, which
                become abnormally sensitive over time; the pelvic-floor muscles, which develop trigger points and
                tightness as a guarding response; and the fascia and ligaments &mdash; especially the broad ligament and
                uterosacral ligaments &mdash; which can become restricted by adhesions and inflammation. Hormonal
                therapy reduces the activity of the lesions but does not directly address the muscle tightness, the
                fascial restriction, or the sensitized pain pathways &mdash; which is why some women continue to have
                pain even after good hormonal control or after excision surgery.
            </div>

            <p>
                The 8&#8209;week OMT protocol for endometriosis targets each layer separately: high-velocity-low-amplitude
                techniques at the T12&ndash;L2 spinal levels (where the nerves to the uterus and ovaries enter the spinal
                cord), bilateral sacroiliac treatment to normalize parasympathetic supply to the pelvis, direct broad-ligament
                mobilization to release fascial restriction, and pelvic-diaphragm release to reduce pelvic-floor tension{cite("ref-8")}.
                The full hormonal regimen, NSAIDs, pelvic-floor PT, and any planned surgery continue unchanged.
            </p>

            <p style="font-size: 13px; color: var(--fg-soft); margin-top: 16px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;">The published RCT evidence — click any card to read the trial in detail</p>

            <div class="card-grid card-grid--4" role="list" style="margin-top: 12px;">
                <article class="card" role="listitem" tabindex="0" data-modal="rct-munoz" aria-label="Open Munoz-Gomez 2023 trial details">
                    <h3>Muñoz-Gómez 2023</h3>
                    <p><strong>RCT, n=41</strong> &middot; 8-week OMT protocol vs usual care in endometriosis-related pelvic pain. Significant improvements in pain and EHP-30 quality of life sustained at one-month follow-up{cite("ref-8")}.</p>
                    <span class="open-hint">trial details &rarr;</span>
                </article>
                <article class="card" role="listitem" tabindex="0" data-modal="rct-molins" aria-label="Open Molins-Cubero 2014 trial details">
                    <h3>Molins-Cubero 2014</h3>
                    <p><strong>Double-blind RCT, n=40</strong> &middot; A single sacroiliac manipulation produced immediate pain reduction with measurable increase in circulating serotonin and catecholamines{cite("ref-9")}.</p>
                    <span class="open-hint">trial details &rarr;</span>
                </article>
                <article class="card" role="listitem" tabindex="0" data-modal="rct-ruffini" aria-label="Open Ruffini 2018 trial details">
                    <h3>Ruffini 2018</h3>
                    <p><strong>RCT, n=31</strong> &middot; Five OMT sessions reduced average menstrual pain by <strong>63%</strong> (5.4 &rarr; 2.0/10); SF-12 physical +58%, mental +36%. Control group: no change{cite("ref-10")}.</p>
                    <span class="open-hint">trial details &rarr;</span>
                </article>
                <article class="card" role="listitem" tabindex="0" data-modal="rct-alboni" aria-label="Open Alboni 2024 trial details">
                    <h3>Alboni 2024</h3>
                    <p>Osteopathic visceral-fascial protocol after endometriosis surgery: significant improvements in recurrent pelvic pain and painful intercourse vs usual post-op care{cite("ref-11")}.</p>
                    <span class="open-hint">trial details &rarr;</span>
                </article>
            </div>
            <article class="featured-card" tabindex="0" data-modal="rct-fitzgerald" aria-label="Open FitzGerald 2012 trial details">
                <span class="open-hint">trial details &rarr;</span>
                <div>
                    <h3>FitzGerald 2012 &mdash; the NIH multicenter pelvic-floor PT RCT</h3>
                    <p>Level&nbsp;I evidence from 11 NIH/NIDDK research centers that a specialized internal pelvic-floor myofascial physical therapy is substantively more effective than general massage in pelvic-floor pain &mdash; which is why the &ldquo;PT&rdquo; you receive matters enormously. Cited above as the evidence base for the pelvic-floor PT layer of every endometriosis treatment plan{cite("ref-12")}.</p>
                </div>
                <div>
                    <span class="stat-badge"><strong>59%</strong> myofascial PT response</span>
                    <span class="stat-badge"><strong>26%</strong> general massage response</span>
                </div>
            </article>
        </div>
    </section>

    <!-- Q&A -->
    <section class="panel" style="animation-delay: 420ms;">
        <div class="section-eyebrow">Common questions, answered honestly</div>
        <h2>Patient questions, in the order they come up.</h2>
        <p class="section-intro">
            Sources for the answers below: ACOG and ESHRE clinical guidelines, the Cochrane and network-meta-analysis
            literature on surgical and medical management, and the randomized-trial evidence base for osteopathic and
            pelvic-floor treatment. Every claim has an inline citation.
        </p>

        <div class="qa-list">

            <details class="qa">
                <summary>Why has my diagnosis taken so long?</summary>
                <div class="qa-answer">
                    <p>You are not imagining it: the <strong>average time between first symptoms and diagnosis is 7&ndash;10 years</strong>{cite("ref-3")}. This happens because endometriosis pain is often dismissed as &ldquo;normal&rdquo; period pain; because symptoms overlap with IBS, bladder problems, and musculoskeletal pain; because for decades laparoscopic surgery was required to confirm the diagnosis; and because ultrasound, when not specifically focused on endometriosis, misses superficial disease entirely{cite("ref-5")}.</p>
                    <p>The good news: ACOG&rsquo;s most recent guidance explicitly says <strong>a clinical diagnosis is appropriate</strong>{cite("ref-1")} &mdash; meaning we no longer need a confirmatory surgery before starting treatment.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Do I need surgery to know if I have endometriosis?</summary>
                <div class="qa-answer">
                    <p><strong>No.</strong> ACOG{cite("ref-1")} and ESHRE{cite("ref-14")} both now recommend that diagnosis can be made clinically &mdash; based on the symptom pattern, examination, and imaging &mdash; without requiring laparoscopy first. Diagnostic surgery still has a role for women who fail medical therapy, or when surgery would be the treatment anyway. But it is not the entry point.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Will hormonal therapy cure my endometriosis?</summary>
                <div class="qa-answer">
                    <p>No. Hormonal therapy is <em>suppressive</em> &mdash; it controls symptoms and slows progression but does not eliminate the disease. The published evidence shows medical suppressive therapy improves pain in most women, but recurrence rates are high after the medication is stopped{cite("ref-6")}. The honest framing is: <strong>we are managing a chronic condition, not curing it.</strong></p>
                    <p>For most women, that management continues until menopause or until they want to try to conceive. Step therapy gives us multiple options to rotate through, so that a side effect on one medication doesn&rsquo;t end the conversation.</p>
                </div>
            </details>

            <details class="qa">
                <summary>If hormones don&rsquo;t cure it, why bother?</summary>
                <div class="qa-answer">
                    <p>Three reasons. First, <strong>60&ndash;80% of women have meaningful pain relief on first-line therapy</strong>{cite("ref-2")} &mdash; without surgery, recovery time, or surgical complications. Second, hormonal suppression slows disease progression: untreated endometriosis worsens in roughly 29% of cases, including new endometrioma formation, deeper disease, and adhesions that compromise fertility{cite("ref-3")}. Third, getting symptom control now reduces the central pain sensitization that makes future treatment harder{cite("ref-7")}.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Will it affect my fertility?</summary>
                <div class="qa-answer">
                    <p>Endometriosis affects fertility in roughly <strong>30&ndash;50% of women</strong> who have it, and it is found in about 38% of women evaluated for infertility{cite_multi("ref-3", "ref-4")}. Most women with endometriosis still conceive without help &mdash; especially with early diagnosis &mdash; but for those who don&rsquo;t, the issue is usually a combination of pelvic adhesions, ovarian-reserve impact from endometriomas, and the inflammatory pelvic environment.</p>
                    <p>If you have endometriosis and you are thinking about pregnancy: <strong>tell Dr.&nbsp;Mabini early.</strong> The network meta-analysis evidence supports that surgical management improves clinical pregnancy rates in endometriosis-related infertility{cite("ref-4")}. We check AMH up front when there&rsquo;s an endometrioma, so we know what we&rsquo;re working with.</p>
                </div>
            </details>

            <details class="qa">
                <summary>What exactly is OMT, and how is it different from chiropractic care or massage?</summary>
                <div class="qa-answer">
                    <p>OMT &mdash; osteopathic manipulative treatment &mdash; is performed by licensed physicians (DOs and MDs with additional training). It uses a range of hands-on techniques (spinal manipulation, visceral mobilization, fascial release, counterstrain, muscle energy) <strong>integrated into full medical care</strong>: the same physician can perform OMT, prescribe your medications, and operate on you when needed.</p>
                    <p>Chiropractic care focuses on spinal manipulation; chiropractors are not licensed to prescribe medications or perform medical procedures. Massage targets broad muscle relaxation but does not treat the spinal segmental, fascial, or visceral contributors that drive pelvic pain.</p>
                    <p><strong>OMT specifically has published randomized-trial evidence in pelvic pain and dysmenorrhea</strong>{cite_multi("ref-8", "ref-9", "ref-10", "ref-11")} &mdash; click the trial cards above to read the actual studies.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Will the OMT hurt?</summary>
                <div class="qa-answer">
                    <p>Most techniques are gentle and should not be painful. High-velocity-low-amplitude (HVLA) thrust techniques produce a brief sensation &mdash; sometimes with an audible pop &mdash; but should not be sharp or painful. If a technique is causing pain, it is modified immediately. The most common side effect is <strong>mild soreness for 24&ndash;48 hours afterward</strong>, similar to post-exercise soreness. Published pelvic-pain OMT trials report no serious adverse events{cite_multi("ref-8", "ref-9", "ref-10")}.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Why OMT if I&rsquo;m already in pelvic-floor physical therapy?</summary>
                <div class="qa-answer">
                    <p>Pelvic-floor PT and OMT address different structural layers. <strong>PFPT directly works on the pelvic-floor muscles themselves</strong> &mdash; through internal manual therapy, biofeedback, and down-training of the levator ani. <strong>OMT addresses the upstream contributors</strong>: the lower lumbar spine where the nerves to the uterus connect, the sacroiliac joints, the iliopsoas muscle that pre-tensions the pelvic floor at rest, and the broad-ligament adhesions that pull on the pelvis mechanically{cite("ref-8")}.</p>
                    <p>The two are complementary. The NIH multicenter trial showed pelvic-floor PT alone helped 59% of women with pelvic-floor tenderness, compared with 26% on general massage{cite("ref-12")}. OMT adds the structural layer above that.</p>
                </div>
            </details>

            <details class="qa">
                <summary>How long until I see improvement?</summary>
                <div class="qa-answer">
                    <p><strong>Hormonal therapy:</strong> 4&ndash;6 weeks for early signal; 3 months for a fair trial. If first-line is not working at 3 months, we escalate{cite("ref-2")}.</p>
                    <p><strong>OMT:</strong> mild post-session soreness in the first 2&ndash;3 sessions is normal. Meaningful pain improvement typically emerges at sessions 4&ndash;6 (weeks 4&ndash;6). Full protocol effect is assessed at week 8 &mdash; and in the published endometriosis trial, improvements were maintained at one-month follow-up{cite("ref-8")}.</p>
                    <p><strong>Pelvic-floor PT:</strong> usually 8&ndash;12 sessions before the muscle pattern shifts meaningfully{cite("ref-12")}.</p>
                    <p><strong>Surgery:</strong> immediate pain reduction for some, longer recovery for others. The post-op 3-month mark is the real read{cite("ref-2")}.</p>
                </div>
            </details>

            <details class="qa">
                <summary>What happens if medical therapy doesn&rsquo;t work for me?</summary>
                <div class="qa-answer">
                    <p>We escalate. The standard step-up: first-line OCP or NSAIDs &rarr; second-line progestin-only or LNG-IUD &rarr; third-line GnRH antagonist with add-back hormones. If you have given two adequate trials (3&ndash;6 months each) and still have functional pain, that is when surgical evaluation moves to the front of the conversation.</p>
                    <p>Surgery for endometriosis is <strong>laparoscopic excision</strong> &mdash; cutting out the lesions, freeing adhesions, treating endometriomas by cystectomy (not just draining them). Excision rather than ablation{cite("ref-2")}. Pain relief afterwards is about 60&ndash;80%. Recurrence is 20&ndash;40% over five years and drops to 8&ndash;15% with continued hormonal suppression post-op{cite("ref-6")} &mdash; which is why we usually place an LNG-IUD at the time of surgery.</p>
                </div>
            </details>

            <details class="qa">
                <summary>What&rsquo;s the difference between excision and ablation?</summary>
                <div class="qa-answer">
                    <p>Ablation burns the surface of the lesion away. Excision cuts the lesion out entirely, including the deeper tissue you can&rsquo;t see from the surface. <strong>For ovarian endometriomas the published evidence is clear: excising the cyst wall (cystectomy) is superior to draining and ablating it</strong> &mdash; lower recurrence and better symptom relief{cite("ref-2")}. For peritoneal disease, excision is also preferred when technically feasible. Dr.&nbsp;Mabini performs excision laparoscopically as the default approach.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Will it come back after surgery?</summary>
                <div class="qa-answer">
                    <p>Some of it can. Recurrence is roughly <strong>20&ndash;40% at five years</strong> without ongoing therapy &mdash; and drops to <strong>8&ndash;15% with post-operative hormonal suppression</strong>{cite("ref-6")}. That suppression is usually an LNG-IUD (placed at the time of surgery) or a continuous combined OCP, continued until menopause or until you want to try to conceive. Skipping post-op suppression is the most common reason for symptomatic recurrence in the published series.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Is surgery safe?</summary>
                <div class="qa-answer">
                    <p>Laparoscopic excision is generally low-risk when performed by a surgeon with subspecialty training in MIGS &mdash; which is what Dr.&nbsp;Mabini does. Specific risks include bleeding, infection, injury to nearby organs (bowel, bladder, ureter, blood vessels), formation of new adhesions, and &mdash; in surgery on the ovary itself &mdash; reduction in ovarian reserve{cite("ref-2")}. These risks are taken seriously and minimized by careful technique, intraoperative checks (cystoscopy when the bladder or ureter has been close to the surgical field), and by avoiding aggressive ovarian dissection when fertility is a priority.</p>
                </div>
            </details>

            <details class="qa">
                <summary>Is OMT covered by insurance?</summary>
                <div class="qa-answer">
                    <p>Yes, in most cases. OMT is billed under CPT codes 98925&ndash;98929 and is covered by most insurance plans including Medicare and Medicaid when paired with the appropriate somatic-dysfunction diagnosis codes. Same-day office visit and OMT can be billed together. Deductible and co-insurance apply per your specific plan &mdash; our office will check your coverage in advance and tell you what to expect.</p>
                </div>
            </details>

            <details class="qa">
                <summary>I think the pain is in my head. Could that be it?</summary>
                <div class="qa-answer">
                    <p>It is not &ldquo;in your head,&rdquo; but the nervous system <em>is</em> part of the story &mdash; in a real, physical way. Long-standing pain rewires the spinal cord and brain to amplify pain signals (central sensitization){cite("ref-7")}. That is why some women continue to have pain even after the visible lesions are gone, and why a multi-modal approach &mdash; hormones plus pelvic-floor PT plus OMT plus, sometimes, neuromodulators like low-dose amitriptyline or gabapentin &mdash; is more effective than any single therapy alone. Acknowledging the nervous-system component is not dismissing your pain. It is the opposite: it is taking it seriously enough to actually address it.</p>
                </div>
            </details>

        </div>
    </section>

    <section class="panel" style="animation-delay: 480ms;">
        <div class="section-eyebrow">When to call urgently</div>
        <h2>Symptoms that should not wait for your next visit.</h2>
        <div class="red-flags">
            <div class="red-eyebrow">Call the office or seek care now if you have:</div>
            <ul>
                <li>Sudden, severe one-sided pelvic pain &mdash; especially with nausea or vomiting (possible ovarian torsion)</li>
                <li>Pain that prescribed medications are no longer touching</li>
                <li>Bleeding heavy enough to soak through a pad or tampon every hour for two consecutive hours</li>
                <li>Fever above 101&deg;F with pelvic pain</li>
                <li>New bowel symptoms &mdash; rectal bleeding, severe constipation, or pain with bowel movements that wasn&rsquo;t there before</li>
                <li>New urinary symptoms &mdash; blood in the urine, inability to fully empty the bladder</li>
                <li>Pain so severe you cannot work, sleep, or function</li>
                <li>If you suspect you are pregnant and you are on hormonal therapy</li>
            </ul>
        </div>
    </section>

    <section class="cta-strip" style="animation-delay: 540ms;">
        <h2>Take the next step.</h2>
        <p>Whether you have been newly diagnosed, are years into pain that hasn&rsquo;t been controlled, or simply want a second opinion before committing to a treatment plan, Dr.&nbsp;Mabini sees patients with endometriosis as a core part of his practice.</p>
        <a class="btn" href="/portal/">Open the patient portal</a>
        <a class="btn ghost" href="/about/">More about Dr.&nbsp;Mabini</a>
    </section>

    <section class="panel" style="animation-delay: 600ms;">
        <div class="section-eyebrow">References</div>
        <h2>The evidence underneath every claim on this page.</h2>
        <p class="section-intro">
            Each reference is numbered and linked from the inline citations above. Click <strong>Read the abstract</strong>
            on any entry to read the paper&rsquo;s verbatim PubMed abstract.
        </p>
        <ol class="refs-list">
            {render_refs()}
        </ol>
    </section>

    <div class="footer-note">
        <strong>About this page.</strong> The content above is for general patient education. It is not personal
        medical advice and is not a substitute for an evaluation by a qualified clinician who has examined you, reviewed
        your imaging, and discussed your goals. Endometriosis presents differently in every patient; the right
        treatment plan for you depends on your specific symptoms, exam findings, imaging, reproductive goals, and
        personal preferences &mdash; which is exactly the conversation a clinic visit is for.
    </div>

</div>

<!-- Modal frame (single, content swapped at click time) -->
<div class="mz-modal-bg" id="mz-modal-bg" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="mz-modal" id="mz-modal" role="document">
        <button class="mz-modal-close" id="mz-modal-close" aria-label="Close">&times;</button>
        <div id="mz-modal-host"></div>
    </div>
</div>

<!-- Hidden modal templates — content lives here and is cloned into the modal on click -->
{render_modals()}

<script>
(function () {{
    'use strict';

    // Touch-friendly citation popouts — tap toggles mz-open, outside-tap clears.
    const refs = document.querySelectorAll('sup.mz-ref');
    refs.forEach(s => {{
        s.addEventListener('click', (ev) => {{
            const a = ev.target.closest('a');
            // If they clicked the anchor itself, let it scroll naturally.
            if (a && a.tagName === 'A') {{ return; }}
            ev.preventDefault();
            refs.forEach(other => {{ if (other !== s) other.classList.remove('mz-open'); }});
            s.classList.toggle('mz-open');
        }});
    }});
    document.addEventListener('click', (ev) => {{
        if (!ev.target.closest('sup.mz-ref')) {{
            refs.forEach(s => s.classList.remove('mz-open'));
        }}
    }});

    // Q&A auto-close-other so reading flows naturally.
    const qas = document.querySelectorAll('details.qa');
    qas.forEach(d => {{
        d.addEventListener('toggle', () => {{
            if (!d.open) return;
            qas.forEach(other => {{ if (other !== d) other.open = false; }});
        }});
        d.querySelector('summary').addEventListener('click', () => {{
            setTimeout(() => {{
                if (d.open) d.scrollIntoView({{ behavior: 'smooth', block: 'nearest' }});
            }}, 80);
        }});
    }});

    // Modal system — open on card click, close on Escape / outside-click / X button.
    const bg = document.getElementById('mz-modal-bg');
    const host = document.getElementById('mz-modal-host');
    const closeBtn = document.getElementById('mz-modal-close');
    let lastFocus = null;

    function openModal(key) {{
        const tpl = document.getElementById('modal-' + key);
        if (!tpl) return;
        host.innerHTML = '';
        host.appendChild(tpl.content.cloneNode(true));
        // Re-wire any cite popouts inside the modal
        host.querySelectorAll('sup.mz-ref').forEach(s => {{
            s.addEventListener('click', (ev) => {{
                const a = ev.target.closest('a');
                if (a && a.tagName === 'A') {{ return; }}
                ev.preventDefault();
                s.classList.toggle('mz-open');
            }});
        }});
        lastFocus = document.activeElement;
        bg.classList.add('open');
        bg.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
    }}
    function closeModal() {{
        bg.classList.remove('open');
        bg.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        host.innerHTML = '';
    }}

    document.querySelectorAll('[data-modal]').forEach(card => {{
        card.addEventListener('click', (ev) => {{
            // Don't open modal if the click was on a cite popout or link inside
            if (ev.target.closest('sup.mz-ref a') || ev.target.closest('.open-hint a')) return;
            openModal(card.dataset.modal);
        }});
        card.addEventListener('keydown', (ev) => {{
            if (ev.key === 'Enter' || ev.key === ' ') {{
                ev.preventDefault();
                openModal(card.dataset.modal);
            }}
        }});
    }});
    closeBtn.addEventListener('click', closeModal);
    bg.addEventListener('click', (ev) => {{ if (ev.target === bg) closeModal(); }});
    document.addEventListener('keydown', (ev) => {{
        if (ev.key === 'Escape' && bg.classList.contains('open')) closeModal();
    }});
}})();
</script>
"""

HTML = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Endometriosis — what it is, why it hurts, what we can do about it · Mount Zara</title>
    <meta name="description" content="A peer-reviewed patient guide to endometriosis from Christopher Z. Mabini, DO — what it is, why diagnosis takes so long, what evaluation looks like, every treatment option from NSAIDs to laparoscopic excision, how osteopathic care fits in, with inline PubMed citations and verbatim abstracts.">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="canonical" href="https://mountzara.com/education/endometriosis/">
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700&display=swap" rel="stylesheet">
    <style>{CSS}</style>
</head>
<body>
{BODY_HTML}
</body>
</html>
"""

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    f.write(HTML)

print(f'Wrote {OUT_PATH}')
print(f'Size: {os.path.getsize(OUT_PATH):,} bytes')
print(f'Reference count: {len(REFS)}')
print(f'Modal count: {len(MODALS)}')
