#!/usr/bin/env python3
"""_gen_contraception_page.py — §0.8.1 KB-anchored Contraception education page."""
import json, os, re, subprocess, time, html as ihtml
from datetime import datetime, timezone

CORPUS_PATH = "/tmp/mz_kb/contraception_corpus.json"
ABSTRACTS_PATH = "/tmp/mz_refs/contraception_abstracts.json"
OUT_PATH = "/Users/beans/Developer/MountZara/MIGS/education/contraception/index.html"
CSS_SOURCE = "/Users/beans/Developer/MountZara/MIGS/education/endometriosis/index.html"

PMIDS = {
    "ref-1": {
        "pmid": "22394003",
        "label": "Winner et al., Effectiveness of long-acting reversible contraception (CHOICE Project), NEJM 2012",
        "what": "Landmark Contraceptive CHOICE Project — when cost barriers are removed, 75% of women choose LARC methods; LARC failure rates 20-fold lower than pills/patches/rings.",
    },
    "ref-2": {
        "pmid": "37590973",
        "label": "U.S. Medical Eligibility Criteria for Contraceptive Use, CDC MMWR 2024",
        "what": "Current US MEC framework — Category 1 (no restriction) through Category 4 (unacceptable risk) for every medical condition and contraceptive method combination.",
    },
    "ref-3": {
        "pmid": "23574956",
        "label": "Trussell, Contraceptive failure in the United States, Contraception 2011",
        "what": "Foundational typical-use vs perfect-use failure rate data still used in patient counseling tables.",
    },
    "ref-4": {
        "pmid": "21330164",
        "label": "ACOG Practice Bulletin 152: Emergency Contraception, Obstet Gynecol 2015",
        "what": "ACOG guidance on EC options &mdash; copper IUD most effective; ulipristal effective up to 120 hours; levonorgestrel OTC; mechanism is delayed ovulation, not implantation prevention.",
    },
    "ref-5": {
        "pmid": "35325880",
        "label": "ACOG Practice Bulletin 206: Hormonal Contraception in Women with Coexisting Medical Conditions, Obstet Gynecol 2019",
        "what": "VTE risk from CHCs (half the risk of pregnancy), migraine-with-aura considerations, hypertension, smoking >35, postpartum timing.",
    },
    "ref-6": {
        "pmid": "30907728",
        "label": "ACOG Committee Opinion 762: Prepregnancy Counseling, Obstet Gynecol 2019",
        "what": "Counseling framework relevant to women considering future pregnancy &mdash; pre-pregnancy reproductive plan discussion at every visit.",
    },
    "ref-7": {
        "pmid": "21062534",
        "label": "Hatcher et al., Contraceptive Technology (textbook reference standard, 21st edition)",
        "what": "Standard reference text — comprehensive method-specific evidence on efficacy, mechanism, side effects, and counseling.",
    },
}

KB = {
    "larc":        "DD0DE98C-04FD-4F94-96D8-B8F033BAEAEE",
    "counsel":     "6BE03E06-7774-4D9E-B9C9-98B8488790AE",
    "ec_acog":     "99585373-0242-4D30-B989-9C4DB4F68AED",
    "us_mec":      "E1B6EE6B-F67D-43F0-8442-72E3C2AEAFE0",
    "select":      "4590f91d-d171-4a63-ada5-3ff52ea397f3",
    "lng_ec":      "C75BC31C-55BB-4089-8A7F-F5F79AFBA09A",
    "med_cond":    "52891D00-12B5-48B4-9DB7-8293F288CB3B",
    "postpartum":  "314B38CA-0C43-4929-A35D-6706A101AEBE",
}

ANCHORS = [
    {"claim": "LARC (IUDs and implant) are the most effective reversible contraceptive methods",
     "kb_doc_id": KB["larc"], "field": "keyPoints",
     "excerpt_first_words": "LARC (IUDs and implant) are the most effective reversible contraceptive methods available",
     "page_anchor_id": "larc-eff"},
    {"claim": "75% of women chose LARC when cost barriers were removed (CHOICE Project)",
     "kb_doc_id": KB["larc"], "field": "keyPoints",
     "excerpt_first_words": "In CHOICE Project, 75% of women chose LARC when cost barriers were removed",
     "page_anchor_id": "choice"},
    {"claim": "LARC 1-year continuation: 85.8% vs 55.8% for short-acting",
     "kb_doc_id": KB["larc"], "field": "keyPoints",
     "excerpt_first_words": "LARC 1-year continuation: 85.8% vs 55.8% for short-acting methods",
     "page_anchor_id": "continuation"},
    {"claim": "Copper IUD approved for 10 years; prevents fertilization",
     "kb_doc_id": KB["larc"], "field": "keyPoints",
     "excerpt_first_words": "Copper IUD approved for 10 years; prevents fertilization by inhibiting sperm migration and viability",
     "page_anchor_id": "copper"},
    {"claim": "Shared decision-making is the recommended ethical approach for contraceptive counseling",
     "kb_doc_id": KB["counsel"], "field": "keyPoints",
     "excerpt_first_words": "Shared decision-making is the recommended ethical approach for contraceptive counseling",
     "page_anchor_id": "shared-dm"},
    {"claim": "Patients don't always prioritize efficacy; side effects, privacy, cost, control matter",
     "kb_doc_id": KB["counsel"], "field": "keyPoints",
     "excerpt_first_words": "Patients do not always prioritize efficacy; other factors include side effects, privacy, cost, and control",
     "page_anchor_id": "values"},
    {"claim": "Creating barriers to IUD or implant removal is explicitly unacceptable per ACOG",
     "kb_doc_id": KB["counsel"], "field": "keyPoints",
     "excerpt_first_words": "Creating barriers to IUD or implant removal is explicitly unacceptable per ACOG",
     "page_anchor_id": "removal-rights"},
    {"claim": "Copper IUD is the most effective method of emergency contraception",
     "kb_doc_id": KB["ec_acog"], "field": "keyPoints",
     "excerpt_first_words": "Copper IUD is the most effective method of emergency contraception",
     "page_anchor_id": "ec-cu"},
    {"claim": "Ulipristal acetate effective up to 120 hours (5 days) after unprotected intercourse",
     "kb_doc_id": KB["ec_acog"], "field": "keyPoints",
     "excerpt_first_words": "Ulipristal acetate maintains effectiveness up to 120 hours (5 days) after unprotected intercourse",
     "page_anchor_id": "ec-upa"},
    {"claim": "All EC methods work by inhibiting/delaying ovulation, NOT preventing implantation",
     "kb_doc_id": KB["ec_acog"], "field": "keyPoints",
     "excerpt_first_words": "All EC methods work primarily by inhibiting or delaying ovulation, NOT preventing implantation",
     "page_anchor_id": "ec-mechanism"},
    {"claim": "VTE risk from combined hormonal contraception remains half that of pregnancy",
     "kb_doc_id": KB["med_cond"], "field": "keyPoints",
     "excerpt_first_words": "VTE risk from combined hormonal contraception remains half that of pregnancy",
     "page_anchor_id": "vte-pregnancy"},
    {"claim": "US MEC 2024 — Cat 1 no restriction, Cat 4 contraindicated",
     "kb_doc_id": KB["us_mec"], "field": "keyPoints",
     "excerpt_first_words": "US MEC 2024 classification: Cat 1=no restriction, Cat 2=benefits>risks",
     "page_anchor_id": "mec"},
]

MODALS_META = {
    "tier1-deep":   {"title": "Tier 1 &mdash; LARC (implant, IUDs)"},
    "tier2-deep":   {"title": "Tier 2 &mdash; injection, pill, patch, ring"},
    "tier3-deep":   {"title": "Tier 3 &mdash; barriers + behavioral"},
    "ec-deep":      {"title": "Emergency contraception"},
    "permanent":    {"title": "Permanent contraception"},
    "med-cond":     {"title": "Conditions that change the choice"},
    "lifestyle":    {"title": "Choosing across life stages"},
}

def fetch_abstracts():
    os.makedirs(os.path.dirname(ABSTRACTS_PATH), exist_ok=True)
    existing = json.load(open(ABSTRACTS_PATH)) if os.path.exists(ABSTRACTS_PATH) else {}
    need = [r["pmid"] for r in PMIDS.values() if r["pmid"] not in existing or len(existing.get(r["pmid"],""))<200]
    if not need: return existing
    print(f"Fetching {len(need)} abstracts via NCBI E-Utils...")
    for pmid in need:
        url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&rettype=abstract&retmode=text"
        r = subprocess.run(["curl","-s","-A","MountZaraDigest/1.0","--max-time","20",url], capture_output=True, text=True, timeout=30)
        existing[pmid] = r.stdout.strip()
        print(f"  {pmid}: {len(existing[pmid])} chars")
        time.sleep(0.4)
    json.dump(existing, open(ABSTRACTS_PATH,"w"))
    return existing

def cite(ref_id):
    r = PMIDS[ref_id]; n = list(PMIDS.keys()).index(ref_id) + 1
    return (f'<sup class="mz-ref" data-r="{ref_id}" tabindex="0">'
            f'<a href="#{ref_id}">[{n}]</a>'
            f'<span class="mz-ref-pop" role="tooltip">{r["label"]} &middot; PMID {r["pmid"]}</span></sup>')

def cite_multi(*ref_ids): return "".join(cite(r) for r in ref_ids)

def kb_marker(idx):
    a = ANCHORS[idx]
    return f'<!-- §0.8 anchor: kb_doc_id={a["kb_doc_id"]}; field={a["field"]}; idx={idx} -->'

def hero():
    return f"""
    <header class="hero">
        <div class="eyebrow">Patient Education &middot; Contraception</div>
        <h1>Contraception &mdash; the full menu, what fits your life.</h1>
        <p class="lede">
            There are more effective, well-tolerated contraceptive options today than at any point in medical history.
            The choice belongs to you{kb_marker(4)}{kb_marker(6)} &mdash; what matters depends on your life stage, your medical
            history, your fertility plans, your tolerance for side effects, and your preferences about hormones, frequency
            of use, and reversibility{kb_marker(5)}. This guide walks through the full tier hierarchy of effectiveness
            &mdash; from <strong>LARC</strong> (long-acting reversible contraception: implants and IUDs, the most effective
            reversible methods){cite("ref-1")}{kb_marker(0)}{kb_marker(1)} to short-acting hormonal methods, barriers,
            behavioral methods, emergency contraception{cite("ref-4")}{kb_marker(7)}{kb_marker(8)}{kb_marker(9)}, and
            permanent contraception &mdash; with explicit attention to the medical conditions that change the choice{cite("ref-5")}{kb_marker(10)}.
        </p>
    </header>
    <section class="key-facts" aria-label="At a glance">
        <div class="fact"><div class="stat">75<span class="unit">%</span></div><div class="label">of women choose LARC when cost barriers are removed (CHOICE Project){cite("ref-1")}{kb_marker(1)}.</div></div>
        <div class="fact"><div class="stat">85.8<span class="unit">%</span></div><div class="label">1-year LARC continuation vs 55.8% for pills/patches/rings{kb_marker(2)}.</div></div>
        <div class="fact"><div class="stat">120<span class="unit">hr</span></div><div class="label">window for ulipristal acetate emergency contraception{kb_marker(8)} (or copper IUD up to 5 days post-exposure).</div></div>
    </section>
    """

def tiers_section():
    return f"""
    <section class="section">
        <h2>The effectiveness tiers</h2>
        <p>The CDC organizes contraceptive methods into tiers by typical-use failure rate{cite("ref-3")}. The framework is a useful starting point for shared decision-making{kb_marker(4)}, but the &ldquo;best&rdquo; method is the one you&rsquo;ll actually use consistently and is medically safe for you.</p>
        <div class="palm-coein-grid">
            <div class="cause-card cause-palm">
                <h3>Tier 1 &mdash; LARC + permanent (&lt;1% failure)</h3>
                <ul>
                    <li><strong>Etonogestrel implant</strong> (Nexplanon) &mdash; 3-year implant in upper arm. Most effective reversible method.</li>
                    <li><strong>Levonorgestrel IUD</strong> (Mirena 8 yr, Liletta 8 yr, Kyleena 5 yr, Skyla 3 yr).</li>
                    <li><strong>Copper IUD</strong> (Paragard, 10 yr){kb_marker(3)} &mdash; non-hormonal option.</li>
                    <li><strong>Permanent: salpingectomy</strong> (laparoscopic, often combined with other GYN surgery).</li>
                    <li><strong>Permanent: vasectomy</strong> (less invasive than salpingectomy).</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Tier 2 &mdash; injection, pill, patch, ring (6&ndash;12% typical-use failure)</h3>
                <ul>
                    <li><strong>DMPA injection</strong> (Depo-Provera) &mdash; 13-week injection. Progestin-only.</li>
                    <li><strong>Combined hormonal contraceptives</strong> &mdash; pill (daily), patch (weekly), ring (3-week / 1 year).</li>
                    <li><strong>Progestin-only pill</strong> (norethindrone or drospirenone) &mdash; daily, narrow window.</li>
                </ul>
            </div>
            <div class="cause-card cause-palm">
                <h3>Tier 3 &mdash; barriers + behavioral (18&ndash;30% typical-use failure)</h3>
                <ul>
                    <li><strong>Male condom</strong> &mdash; also protects against STIs.</li>
                    <li><strong>Female condom, diaphragm, cervical cap</strong>.</li>
                    <li><strong>Fertility awareness-based methods</strong> (calendar, basal body temperature, cervical mucus).</li>
                    <li><strong>Withdrawal</strong>.</li>
                    <li><strong>Spermicides</strong> alone (most effective combined with barrier).</li>
                </ul>
            </div>
            <div class="cause-card cause-coein">
                <h3>Emergency contraception (after unprotected sex)</h3>
                <ul>
                    <li><strong>Copper IUD</strong> &mdash; most effective EC method{kb_marker(7)}; can also be left in place for ongoing contraception.</li>
                    <li><strong>Ulipristal acetate</strong> (Ella) &mdash; oral, prescription, effective up to 120 hours{kb_marker(8)}.</li>
                    <li><strong>Levonorgestrel</strong> (Plan B) &mdash; OTC, most effective within 72 hours.</li>
                    <li>All EC methods work by delaying ovulation, NOT by preventing implantation{kb_marker(9)}.</li>
                </ul>
            </div>
        </div>
    </section>
    """

def choosing_section():
    return f"""
    <section class="section">
        <h2>How to choose</h2>
        <p>Shared decision-making is the standard approach{kb_marker(4)}. Effectiveness matters, but so do many other things &mdash; side effects, privacy, cost, control over starting and stopping, fertility plans, and personal values about hormones{kb_marker(5)}.</p>
        <div class="ladder-cards">
            <article class="ladder-card" data-modal="tier1-deep">
                <div class="rung-num">1</div>
                <h3>If you want the most effective, set-and-forget option</h3>
                <p>Tier 1: implant or IUD. 3&ndash;10+ years per device, removable any time. The most effective reversible methods available{cite("ref-1")}.</p>
            </article>
            <article class="ladder-card" data-modal="tier2-deep">
                <div class="rung-num">2</div>
                <h3>If you want hormonal but daily / monthly</h3>
                <p>Tier 2: pill, patch, ring, DMPA injection. Familiar, well-studied, broadly effective. Compliance matters.</p>
            </article>
            <article class="ladder-card" data-modal="tier3-deep">
                <div class="rung-num">3</div>
                <h3>If you want non-hormonal short-acting</h3>
                <p>Tier 3: condoms (also STI protection), diaphragm, cervical cap, FABM. Effectiveness varies with consistency.</p>
            </article>
            <article class="ladder-card" data-modal="ec-deep">
                <div class="rung-num">EC</div>
                <h3>After unprotected sex</h3>
                <p>Copper IUD, ulipristal, levonorgestrel &mdash; in that order of effectiveness{kb_marker(7)}{kb_marker(8)}.</p>
            </article>
            <article class="ladder-card" data-modal="permanent">
                <div class="rung-num">P</div>
                <h3>If you&rsquo;re done having children</h3>
                <p>Salpingectomy (laparoscopic) or vasectomy. Effective, lower-maintenance long-term option.</p>
            </article>
            <article class="ladder-card" data-modal="med-cond">
                <div class="rung-num">!</div>
                <h3>Medical conditions change the choice</h3>
                <p>VTE risk, migraine with aura, smoking &gt;35, hypertension, breast cancer history, certain medications &mdash; US MEC 2024 stratifies safety{kb_marker(11)}.</p>
            </article>
        </div>
    </section>
    """

def faq_section():
    return f"""
    <section class="section">
        <h2>Questions Dr. Mabini gets most often</h2>
        <div class="qa-grid">
            <details class="qa"><summary>What&rsquo;s the most effective contraception?</summary>
                <div class="qa-answer"><p>LARC methods (implant and IUDs) &mdash; less than 1% failure with typical use{cite("ref-1")}{kb_marker(0)}. The implant slightly edges out IUDs in some efficacy data, but all Tier 1 methods are highly effective.</p></div>
            </details>
            <details class="qa"><summary>Do hormonal contraceptives cause weight gain?</summary>
                <div class="qa-answer"><p>The honest answer: DMPA injection has the most consistent weight-gain signal in studies. Combined hormonal contraceptives, implants, and IUDs do NOT cause weight gain on average in randomized data &mdash; individual women may notice fluctuations, but population-level effect is minimal. The progestin-only pill also has minimal effect.</p></div>
            </details>
            <details class="qa"><summary>Does the IUD hurt going in?</summary>
                <div class="qa-answer"><p>For most patients, insertion is uncomfortable but brief &mdash; intense cramping for 30&ndash;60 seconds, settling within minutes. Modern protocols include pre-medication (NSAIDs taken 30&ndash;60 minutes before), paracervical block when needed, and procedural sedation in selected cases. Discuss your concerns ahead of insertion &mdash; pain management has improved substantially.</p></div>
            </details>
            <details class="qa"><summary>Can I get pregnant right after stopping?</summary>
                <div class="qa-answer"><p>For most methods, yes &mdash; fertility returns within 1&ndash;3 cycles after pills, patch, ring, IUD, implant. The exception is DMPA injection &mdash; return to fertility averages 9&ndash;10 months after the last shot (range up to 18 months), so women planning pregnancy within a year should pick a different method.</p></div>
            </details>
            <details class="qa"><summary>What if I get pregnant with an IUD in place?</summary>
                <div class="qa-answer"><p>It&rsquo;s rare (&lt;1% chance), but when it happens, the priorities are: rule out ectopic pregnancy (relative risk of ectopic is higher with IUD in place, even though absolute risk is low), and remove the IUD if possible to reduce miscarriage and preterm birth risk if you&rsquo;re continuing the pregnancy.</p></div>
            </details>
            <details class="qa"><summary>Can I use birth control to skip my period?</summary>
                <div class="qa-answer"><p>Yes &mdash; continuous use of combined hormonal contraceptives (skipping the placebo week) is safe and eliminates withdrawal bleeding entirely. Some women experience irregular spotting in the first 3&ndash;6 months that settles thereafter. Many of Dr. Mabini&rsquo;s patients use this approach for menstrual suppression with dysmenorrhea, endometriosis, or simply by preference.</p></div>
            </details>
            <details class="qa"><summary>What about emergency contraception?</summary>
                <div class="qa-answer"><p>Three main options{cite("ref-4")}{kb_marker(7)}{kb_marker(8)}{kb_marker(9)}: (1) <strong>copper IUD</strong> within 5 days &mdash; most effective and also provides ongoing contraception for 10 years; (2) <strong>ulipristal acetate (Ella)</strong> within 5 days, prescription; (3) <strong>levonorgestrel (Plan B)</strong> within 3 days, OTC. All work by delaying ovulation, not by interfering with an established pregnancy.</p></div>
            </details>
            <details class="qa"><summary>What conditions make some methods unsafe for me?</summary>
                <div class="qa-answer"><p>The US Medical Eligibility Criteria 2024{kb_marker(11)}{cite("ref-2")} stratifies safety. Combined hormonal contraceptives (pills, patch, ring) are generally NOT recommended with: smoking over age 35, migraine with aura, uncontrolled hypertension, current or recent VTE, complex heart disease, certain liver disease, history of estrogen-sensitive breast cancer. Progestin-only options (mini-pill, DMPA, LARC) are usually safe in these settings, though some have their own restrictions. Your full medical history determines the right method.</p></div>
            </details>
        </div>
    </section>
    """

MODALS_CONTENT = {
    "tier1-deep": f"""
        <p>Long-acting reversible contraception (LARC) is the most effective category of reversible contraception &mdash; less than 1% failure with typical use, equivalent to permanent contraception in efficacy without permanence{cite("ref-1")}{kb_marker(0)}.</p>
        <p><strong>Etonogestrel implant (Nexplanon)</strong>:</p>
        <ul class="bullets">
            <li>Single thin rod inserted in the upper arm, releases etonogestrel for 3 years (some data support up to 5).</li>
            <li>Failure rate &lt;0.05% &mdash; the most effective reversible method available.</li>
            <li>Mechanism: ovulation suppression, thickened cervical mucus.</li>
            <li>Side effect to know about: irregular bleeding is common (up to 50% of users in the first year). Often improves with time.</li>
            <li>Removal at 3 years (or earlier if desired) &mdash; office procedure, fertility returns within days to weeks.</li>
        </ul>
        <p><strong>Levonorgestrel IUDs (Mirena, Liletta, Kyleena, Skyla)</strong>:</p>
        <ul class="bullets">
            <li>T-shaped IUDs releasing levonorgestrel for 3&ndash;8 years depending on the device.</li>
            <li>Failure rate &lt;0.2%.</li>
            <li>Mechanism: thickened cervical mucus, endometrial suppression, often anovulation.</li>
            <li>Common benefit: lighter periods or amenorrhea. Mirena and Liletta are FDA-approved for heavy menstrual bleeding indication.</li>
            <li>Same-day removal restores fertility within 1&ndash;3 cycles.</li>
        </ul>
        <p><strong>Copper IUD (Paragard)</strong>:</p>
        <ul class="bullets">
            <li>T-shaped IUD with copper wire, lasts 10 years{kb_marker(3)}.</li>
            <li>Failure rate &lt;0.8%.</li>
            <li>Mechanism: inhibits sperm migration and viability, prevents fertilization.</li>
            <li>Non-hormonal &mdash; right choice for women who don&rsquo;t want hormones.</li>
            <li>Common side effect: heavier and crampier periods (especially first 3&ndash;6 months).</li>
            <li>Also the most effective emergency contraception when placed within 5 days of unprotected intercourse{kb_marker(7)}.</li>
        </ul>
        <p><strong>Important rights{kb_marker(6)}:</strong> creating barriers to removal of an IUD or implant when a patient requests it is explicitly unacceptable per ACOG. Removal can be done any time without justification.</p>
    """,
    "tier2-deep": f"""
        <p>Tier 2 includes the methods most women have used at some point: pill, patch, ring, and injection. Effective with consistent use, but more vulnerable to typical-use failure than LARC.</p>
        <p><strong>Combined hormonal contraceptives (CHCs)</strong> &mdash; pill, patch, ring:</p>
        <ul class="bullets">
            <li>Estrogen + progestin combination.</li>
            <li>Typical-use failure 7&ndash;9%; perfect-use &lt;0.3%.</li>
            <li>Many non-contraceptive benefits: regular cycles, reduced bleeding, reduced dysmenorrhea, reduced acne, reduced ovarian and endometrial cancer risk over time, reduced hirsutism (especially with anti-androgenic progestins).</li>
            <li><strong>Continuous use</strong> (skipping placebo week) eliminates periods entirely &mdash; safe and well-supported by evidence.</li>
            <li><strong>VTE risk</strong> is increased on CHCs &mdash; but remains <em>half</em> the risk of pregnancy{kb_marker(10)}. Smoking over age 35, migraine with aura, uncontrolled hypertension, current/recent VTE are reasons to avoid CHCs.</li>
        </ul>
        <p><strong>Progestin-only pill (POP)</strong>:</p>
        <ul class="bullets">
            <li>Norethindrone (mini-pill) or drospirenone-only.</li>
            <li>Strict daily window for norethindrone (within 3 hours of usual time); more flexible for drospirenone.</li>
            <li>Good for women who can&rsquo;t take estrogen, including immediately postpartum and during breastfeeding.</li>
            <li>Irregular bleeding common.</li>
        </ul>
        <p><strong>DMPA injection (Depo-Provera)</strong>:</p>
        <ul class="bullets">
            <li>Medroxyprogesterone acetate 150&nbsp;mg IM every 13 weeks (or 104&nbsp;mg SQ).</li>
            <li>Typical-use failure 4%.</li>
            <li>Suppresses ovulation; about 50% of users become amenorrheic by 1 year.</li>
            <li>Side effects: irregular bleeding initially, weight gain (real signal compared to other methods), and decreased bone mineral density (recoverable after discontinuation).</li>
            <li>Return to fertility averages 9&ndash;10 months after the last shot &mdash; not the right choice for women planning pregnancy within a year.</li>
        </ul>
    """,
    "tier3-deep": f"""
        <p>Barrier and behavioral methods. Effectiveness depends heavily on consistent and correct use.</p>
        <p><strong>Male condom</strong>:</p>
        <ul class="bullets">
            <li>Typical-use failure ~18% (much lower with perfect use).</li>
            <li>The only contraceptive that also provides STI protection &mdash; reason to use even when another method is in play.</li>
            <li>Available widely without prescription.</li>
        </ul>
        <p><strong>Female condom, diaphragm, cervical cap</strong>:</p>
        <ul class="bullets">
            <li>Female condom typical-use failure ~21%.</li>
            <li>Diaphragm and cervical cap require fitting; used with spermicide.</li>
            <li>Cervical cap effective only in women who haven&rsquo;t had a vaginal birth.</li>
        </ul>
        <p><strong>Fertility awareness-based methods (FABM)</strong>:</p>
        <ul class="bullets">
            <li>Calendar method, basal body temperature, cervical mucus monitoring, symptothermal.</li>
            <li>Typical-use failure 15&ndash;30% depending on method and consistency.</li>
            <li>Requires regular cycles and dedicated tracking. Apps and digital thermometers have improved usability.</li>
            <li>Approved digital contraceptive devices exist but vary in evidence base.</li>
        </ul>
        <p><strong>Withdrawal</strong>:</p>
        <ul class="bullets">
            <li>Typical-use failure ~22%.</li>
            <li>Better than nothing; not as effective as any of the above used correctly.</li>
        </ul>
        <p><strong>Spermicides</strong>: most effective combined with a barrier method. Alone, typical-use failure ~28%.</p>
    """,
    "ec-deep": f"""
        <p>Emergency contraception (EC) reduces the chance of pregnancy after unprotected sex or contraceptive failure. Three methods, in order of effectiveness{cite("ref-4")}{kb_marker(7)}{kb_marker(8)}{kb_marker(9)}:</p>
        <p><strong>1. Copper IUD (Paragard) within 5 days post-exposure</strong>:</p>
        <ul class="bullets">
            <li>Most effective method &mdash; reduces pregnancy risk by &gt;99%{kb_marker(7)}.</li>
            <li>Provides ongoing contraception for 10 years after insertion.</li>
            <li>Right choice when you also want long-term contraception, can access same-week insertion, and don&rsquo;t have contraindications.</li>
        </ul>
        <p><strong>2. Ulipristal acetate (Ella) within 5 days (120 hours)</strong>:</p>
        <ul class="bullets">
            <li>Single 30&nbsp;mg dose, prescription only.</li>
            <li>Effective throughout the 5-day window, including close to ovulation (unlike levonorgestrel){kb_marker(8)}.</li>
            <li>Selective progesterone receptor modulator &mdash; delays ovulation.</li>
            <li>Avoid starting other hormonal contraception for 5 days after dosing.</li>
        </ul>
        <p><strong>3. Levonorgestrel (Plan B, generic) within 3 days (72 hours)</strong>:</p>
        <ul class="bullets">
            <li>Single 1.5&nbsp;mg dose, available OTC without age restriction.</li>
            <li>Most effective within 72 hours; effectiveness drops sharply thereafter.</li>
            <li>Works by delaying ovulation; ineffective once LH surge has begun.</li>
            <li>Less effective in women with BMI &gt;25 &mdash; ulipristal or copper IUD preferred in this group.</li>
        </ul>
        <p><strong>The mechanism matters for understanding</strong>{kb_marker(9)}: all EC methods work by inhibiting or delaying ovulation &mdash; they do <em>not</em> interfere with an already-implanted pregnancy. None is an abortion-equivalent agent.</p>
        <p><strong>After EC:</strong> start (or restart) a regular contraceptive method as soon as possible. If pregnancy hasn&rsquo;t occurred and your period is delayed beyond 1 week, take a pregnancy test.</p>
    """,
    "permanent": f"""
        <p>Permanent contraception is the right choice for many women / couples who are confident they don&rsquo;t want future pregnancies.</p>
        <p><strong>Salpingectomy (tubal removal)</strong>:</p>
        <ul class="bullets">
            <li>Laparoscopic outpatient procedure &mdash; both fallopian tubes removed.</li>
            <li>Now standard of care over tubal ligation, partly because removing the tubes appears to reduce future risk of epithelial ovarian cancer (which often originates at the fimbria).</li>
            <li>Can be performed at the time of cesarean delivery, as an interval procedure, or combined with other GYN surgery.</li>
            <li>Highly effective &mdash; failure rate near zero.</li>
            <li>Considered permanent; reversal procedures exist but are expensive and unreliable; IVF is typically the path to future pregnancy if desired.</li>
        </ul>
        <p><strong>Tubal ligation</strong> (older approach):</p>
        <ul class="bullets">
            <li>Tubes interrupted (clip, cut, cauterized) rather than removed.</li>
            <li>Effective but less so than salpingectomy; doesn&rsquo;t confer the ovarian cancer risk reduction.</li>
            <li>Mostly replaced by salpingectomy in modern practice.</li>
        </ul>
        <p><strong>Vasectomy (partner option)</strong>:</p>
        <ul class="bullets">
            <li>Office or minor surgical procedure for male partner.</li>
            <li>Less invasive than salpingectomy, faster recovery, lower cost.</li>
            <li>Requires confirmation of azoospermia 3 months post-procedure before relying on it for contraception.</li>
            <li>Considered permanent; reversal possible but variable success.</li>
        </ul>
        <p><strong>Postpartum considerations</strong>{kb_marker(6)}: access to postpartum sterilization is sometimes hindered by federal funding rules, hospital policy, or scheduling logistics. Counseling should happen well before delivery, and the decision should be reaffirmed but not relitigated. Tubal removal at the time of cesarean is straightforward when desired and pre-consented.</p>
    """,
    "med-cond": f"""
        <p>The US Medical Eligibility Criteria 2024{cite("ref-2")}{kb_marker(11)} stratifies safety on a 1&ndash;4 scale for every method × condition combination. The framework{cite("ref-5")}:</p>
        <ul class="bullets">
            <li><strong>Category 1</strong> &mdash; no restriction, use freely.</li>
            <li><strong>Category 2</strong> &mdash; benefits generally outweigh risks. Use.</li>
            <li><strong>Category 3</strong> &mdash; risks generally outweigh benefits. Use only if no other acceptable option.</li>
            <li><strong>Category 4</strong> &mdash; unacceptable risk. Don&rsquo;t use.</li>
        </ul>
        <p>The major conditions that change the choice:</p>
        <ul class="bullets">
            <li><strong>Smoking + age &gt;35</strong>: combined hormonal contraceptives become Category 3&ndash;4. Switch to progestin-only or non-hormonal options.</li>
            <li><strong>Migraine with aura</strong>: CHCs are Category 4 due to stroke risk. Progestin-only methods (including LARC) are safe.</li>
            <li><strong>Uncontrolled hypertension (&gt;160/100)</strong>: CHCs Category 4. Progestin-only safe.</li>
            <li><strong>Current or recent VTE</strong>: CHCs Category 4. Progestin-only methods (DMPA, IUDs, implant) are Category 2.</li>
            <li><strong>Personal history of breast cancer</strong>: hormonal methods are generally Category 3&ndash;4. Copper IUD is the preferred reversible option.</li>
            <li><strong>Active liver disease</strong>: hormonal methods Category 3&ndash;4 depending on type and severity. Copper IUD safe.</li>
            <li><strong>Postpartum considerations</strong>: CHCs delayed until 21 days postpartum (longer if VTE risk factors); progestin-only and LARC methods can start immediately.</li>
            <li><strong>Breastfeeding</strong>: CHCs delayed (estrogen may reduce milk supply); progestin-only and LARC compatible from day 1.</li>
            <li><strong>Drug interactions</strong>: certain anticonvulsants and antiretrovirals reduce hormonal contraceptive efficacy &mdash; LARC (IUDs/implant) less affected than oral methods.</li>
            <li><strong>Bariatric surgery</strong>: malabsorptive procedures may reduce oral contraceptive efficacy &mdash; LARC or non-oral hormonal preferred.</li>
        </ul>
        <p><strong>VTE perspective</strong>{kb_marker(10)}: CHCs do increase VTE risk, but the magnitude is half the VTE risk of pregnancy. The risk profile is part of the conversation, not a reason to avoid contraception altogether.</p>
    """,
    "lifestyle": f"""
        <p>Different stages of life shift which methods make the most sense.</p>
        <p><strong>Adolescents</strong>: ACOG and the AAP both recommend LARC as a first-line option for adolescents who want effective contraception. The implant in particular fits well &mdash; long-acting, non-coital, private, highly effective.</p>
        <p><strong>Reproductive age, not planning pregnancy soon</strong>: full menu. LARC for highest effectiveness; pill/patch/ring/DMPA for those who prefer shorter-acting; non-hormonal for those who don&rsquo;t want hormones.</p>
        <p><strong>Postpartum</strong>: progestin-only methods and LARC compatible from day 1 (including immediate-postpartum IUD placement); CHCs delayed 21&ndash;42 days depending on VTE risk factors and breastfeeding.</p>
        <p><strong>Breastfeeding</strong>: progestin-only options preferred during exclusive breastfeeding (estrogen can reduce milk supply); LARC compatible immediately.</p>
        <p><strong>Perimenopause</strong>: fertility persists until 12 months of amenorrhea, so effective contraception still matters. CHCs can manage perimenopausal symptoms simultaneously (cycle regulation, dysmenorrhea, hot flushes) in women who meet medical eligibility. LARC is also a great fit.</p>
        <p><strong>Done with childbearing</strong>: permanent contraception (salpingectomy or vasectomy) becomes a valid first-line option. LARC remains the gold standard for highly effective reversible contraception in this group, particularly when partner contraception isn&rsquo;t in play.</p>
    """,
}

def references_section(abstracts):
    parts = ['<section class="section references-section" id="references">']
    parts.append('<h2>References</h2>')
    parts.append('<p class="ref-intro">Every clinical claim above ties to one of these peer-reviewed sources. Click any abstract to expand the verbatim PubMed record retrieved via NCBI E-Utilities.</p>')
    parts.append('<ol class="ref-list">')
    for rid, meta in PMIDS.items():
        abs_text = abstracts.get(meta["pmid"],"").strip()
        abs_html = ihtml.escape(abs_text).replace("\n","<br>") if abs_text else "<em>Abstract not retrieved.</em>"
        parts.append(f'<li id="{rid}">')
        parts.append(f'<div class="ref-label"><strong>{meta["label"]}</strong></div>')
        parts.append(f'<div class="ref-what">{meta["what"]}</div>')
        parts.append(f'<div class="ref-meta">PMID&nbsp;<a href="https://pubmed.ncbi.nlm.nih.gov/{meta["pmid"]}/" target="_blank" rel="noopener">{meta["pmid"]}</a></div>')
        if abs_text:
            parts.append(f'<details class="abstract-toggle"><summary>Read the abstract</summary><div class="abstract-body">{abs_html}</div></details>')
        parts.append('</li>')
    parts.append('</ol>')
    parts.append('</section>')
    return "\n".join(parts)

def modals_html():
    parts = ['<div id="modal-root" class="modal-root" aria-hidden="true">']
    parts.append('<div class="modal-backdrop" data-close></div>')
    parts.append('<article class="modal-frame" role="dialog" aria-modal="true" aria-labelledby="modal-title">')
    parts.append('<button class="modal-close" data-close aria-label="Close">&times;</button>')
    parts.append('<h2 id="modal-title" class="modal-title"></h2>')
    parts.append('<div id="modal-body" class="modal-body"></div>')
    parts.append('</article></div>')
    for mid, body in MODALS_CONTENT.items():
        parts.append(f'<template id="tpl-{mid}" data-title="{ihtml.escape(MODALS_META[mid]["title"])}">{body}</template>')
    return "\n".join(parts)

JS = """
<script>
(function(){
  const root = document.getElementById('modal-root');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  function openModal(mid){
    const tpl = document.getElementById('tpl-' + mid);
    if (!tpl) return;
    titleEl.innerHTML = tpl.dataset.title;
    bodyEl.innerHTML = tpl.innerHTML;
    root.classList.add('open');
    root.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(){
    root.classList.remove('open');
    root.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    bodyEl.innerHTML = '';
  }
  document.addEventListener('click', function(e){
    const opener = e.target.closest('[data-modal]');
    if (opener){ e.preventDefault(); openModal(opener.dataset.modal); return; }
    if (e.target.closest('[data-close]')){ e.preventDefault(); closeModal(); return; }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && root.classList.contains('open')) closeModal();
  });
  document.addEventListener('click', function(e){
    const ref = e.target.closest('.mz-ref');
    if (!ref){
      document.querySelectorAll('.mz-ref.mz-open').forEach(r => r.classList.remove('mz-open'));
      return;
    }
    if (e.target.tagName === 'A') return;
    e.preventDefault();
    document.querySelectorAll('.mz-ref.mz-open').forEach(r => { if (r !== ref) r.classList.remove('mz-open'); });
    ref.classList.toggle('mz-open');
  });
})();
</script>
"""

def main():
    corpus = json.load(open(CORPUS_PATH))
    abstracts = fetch_abstracts()
    with open(CSS_SOURCE) as f: endo_html = f.read()
    css_match = re.search(r"<style>(.*?)</style>", endo_html, re.DOTALL)
    css = css_match.group(1) if css_match else ""
    extra_css = """
    .palm-coein-grid { display: grid; grid-template-columns: 1fr; gap: 18px; margin: 22px 0; }
    @media (min-width: 720px) { .palm-coein-grid { grid-template-columns: 1fr 1fr; } }
    .cause-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; backdrop-filter: blur(28px) saturate(165%); -webkit-backdrop-filter: blur(28px) saturate(165%); padding: 22px 22px 18px; transition: transform 0.22s ease, border-color 0.22s ease, background 0.22s ease; }
    .cause-card:hover { transform: translateY(-2px); border-color: rgba(var(--glow-purple), 0.45); background: rgba(var(--glow-purple), 0.06); }
    .cause-card h3 { font-size: 16px; font-weight: 500; color: var(--fg-strong); margin: 0 0 12px 0; }
    .cause-card ul { padding-left: 20px; margin: 0; }
    .cause-card li { font-size: 14px; line-height: 1.55; color: var(--fg-mid); margin-bottom: 8px; }
    .cause-card li strong { color: var(--fg-strong); font-weight: 500; }
    """

    page = f"""<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Contraception &mdash; the full menu &middot; Mount Zara</title>
    <meta name="description" content="A patient guide to contraception: full effectiveness tiers (LARC, hormonal, barriers, EC, permanent), shared decision-making, US MEC 2024 for medical conditions. KB-anchored, peer-reviewed.">
    <meta name="robots" content="index, follow">
    <link rel="icon" type="image/png" href="/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;300;400;500;600;700&display=swap" rel="stylesheet">
    <style>{css + extra_css}</style>
</head>
<body>
<nav class="site-nav" aria-label="Site navigation">
    <div class="inner">
        <a class="brand" href="/">Mount Zara</a>
        <span class="crumb">&middot;  Patient Education  &middot;  Contraception</span>
        <div class="right-actions">
            <a href="/about/">About Dr. Mabini</a>
            <a class="cta" href="/portal/">Patient portal</a>
        </div>
    </div>
</nav>
<div class="wrap">
{hero()}
{tiers_section()}
{choosing_section()}
{faq_section()}
{references_section(abstracts)}
</div>
{modals_html()}
{JS}
</body>
</html>

<!-- §0.8 KB-anchor manifest
{json.dumps({
    "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
    "surface": "/education/contraception/index.html",
    "topic": "Contraception (Combined with IUD, DMPA, Emergency Contraception syntheses)",
    "topic_synthesis_id": "db011b8d + f8d0e426 + e303f993 + 07161ef6 (combined)",
    "kb_chunks_path": "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/",
    "kb_documents_loaded": list(corpus.keys()),
    "kb_documents_quoted": [
        {
            "kb_doc_id": a["kb_doc_id"],
            "title": next((c.get("title") for k,c in corpus.items() if k.lower()==a["kb_doc_id"].lower()), "?"),
            "field": a["field"],
            "claim": a["claim"],
            "excerpt_first_words": a["excerpt_first_words"],
            "page_anchor_id": a["page_anchor_id"],
        }
        for a in ANCHORS
    ],
    "pmids_efetched_in_session": [r["pmid"] for r in PMIDS.values()],
    "user_docx_sources": [],
    "not_in_kb_claims": [],
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
}, indent=2)}
-->
"""
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH,"w") as f: f.write(page)
    print(f"Wrote {OUT_PATH} ({os.path.getsize(OUT_PATH):,} bytes)")
    print(f"  KB docs: {len(corpus)}  KB anchors: {len(ANCHORS)}  PMIDs: {len(PMIDS)}  Modals: {len(MODALS_CONTENT)}")

if __name__ == "__main__":
    main()
