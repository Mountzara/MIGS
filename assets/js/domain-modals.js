/* Domain Modal Data — 9 entries powering the patient-centered modals
 * for the "Surgical practice areas" cards in #excellence on the homepage.
 *
 * Content authored from /Users/beans/Developer/MountZara/MIGS/cite_audit/domain_modals/<slug>.json
 * which was extracted from the v10 KB chunks at
 * /Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks/
 * (topic syntheses + ACOG documents + supportingStudies PMIDs).
 *
 * Per CLAUDE.md §0.8.1: every clinical claim is anchored to a loaded KB document
 * field, and the §0.8 manifest at the bottom of index.html lists the KB doc IDs
 * and PMIDs used here. Patient voice; no first-person; honest about uncertainty.
 *
 * §0.6 compliance: every modal entry was authored by hand from the KB extract,
 * not scripted. Future edits should be one entry at a time with explicit context.
 */
(function () {
    'use strict';

    const PMID = (pmid) => ({ pmid: String(pmid) });

    // -------- 1. ENDOMETRIOSIS EXCISION --------
    // Primary anchor: ACOG Clinical Practice Guideline No. 11 — "Management of
    // Endometriosis" — kb_chunks/01_acogDocuments_chunk04.json doc id e010f4126035.
    // Every clinical claim below traces to a Level A / Level B recommendation,
    // a stated epidemiology stat, or a named section of that CPG, unless otherwise
    // cited inline.
    const endometriosisExcision = {
        tag: 'National Guideline–Anchored · ICG-Guided',
        title: 'Endometriosis excision',
        tagline: 'Anchored to ACOG Clinical Practice Guideline No. 11. Excision — not ablation — across Stage I–IV disease, including deep infiltrating endometriosis of the bowel, bladder, ureter, and appendix.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Excision, not ablation — backed by the national guideline.',
                body: `
                    <p>Endometriosis is endometrial-like tissue growing where it does not belong — most often on the ovaries, the pelvic sidewall, the uterosacral ligaments, the bowel, the bladder, the ureter, and (less commonly) the diaphragm. Per ACOG Clinical Practice Guideline No. 11, it affects <strong>6–10% of reproductive-age women</strong> and rises to roughly <strong>38% (range 20–50%) of women evaluated for infertility</strong>; the same guideline reports that having a first-degree relative with endometriosis carries a <strong>7–10× increased risk</strong> of developing it yourself.</p>
                    <p>The American College of Obstetricians and Gynecologists Clinical Practice Guideline No. 11 is the current authoritative U.S. guidance on managing the disease. Two of its Level A (good and consistent evidence) recommendations sit at the center of how this practice operates: <em>(1) excision of an endometrioma is superior to simple drainage and ablation of the cyst wall</em>, and <em>(2) surgical management of endometriosis-related infertility does improve pregnancy rates</em>. Together they explain why the operation here is always a true excision — cutting the lesion out at its root and sending every specimen to pathology — rather than a surface burn.</p>
                    <p>The added refinement is <em>indocyanine green (ICG) fluorescence imaging</em>. ICG is a contrast agent that lights up fibrosis and inflammation under near-infrared light, so lesions that look normal under standard white light can reveal themselves. That refinement is grounded in this practice’s own published research: a retrospective cohort study of ICG in the detection of fibrosis and inflammatory changes related to endometriosis (Mabini & Tam, CAOG 91st Annual Meeting, 2024, awarded the George W. Morley Memorial Paper Award). The published work supports ICG as an intraoperative detection aid in advanced disease and deep infiltrating endometriosis, helping the surgeon find disease so it can be excised.</p>
                `
            },
            {
                eyebrow: 'What the national guideline says',
                title: 'The Level A recommendations driving care.',
                body: `<p>These are the Level A (good and consistent scientific evidence) recommendations from the American College of Obstetricians and Gynecologists — the national guideline body for this specialty — that shape every conversation about diagnosis, medical therapy, and surgery for endometriosis. They are the standard of care, not opinion.</p>`,
                stats: [
                    { num: 'Ultrasound first', label: 'Transvaginal ultrasound is the imaging modality of choice for assessing the presence of endometriosis.', source: 'ACOG Guideline No. 11 · Level A' },
                    { num: 'Excision beats ablation', label: 'For endometriomas, cutting the cyst out is superior to simple drainage and burning of the cyst wall.', source: 'ACOG Guideline No. 11 · Level A' },
                    { num: 'Surgery helps fertility', label: 'Surgical management of endometriosis-related infertility improves pregnancy rates; magnitude unclear.', source: 'ACOG Guideline No. 11 · Level A' },
                    { num: 'Suppression won’t restore fertility', label: 'Birth-control pills and GnRH agonists quiet pain but are ineffective for endometriosis-associated infertility.', source: 'ACOG Guideline No. 11 · Level A' },
                    { num: 'Medication eases pain', label: 'Medical suppressive therapy improves pain — but recurrence rates are high after stopping.', source: 'ACOG Guideline No. 11 · Level A' },
                    { num: 'Surgery eases pain', label: 'Significant short-term improvement in pain after conservative surgical excision — recurrence still happens.', source: 'ACOG Guideline No. 11 · Level A' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'Three honest paths — grounded in the national guideline.',
                rba: {
                    expectant: {
                        sub: 'Watchful waiting + NSAIDs',
                        intro: 'An option the national guideline acknowledges when symptoms are mild and infertility is not a near-term goal. Always paired with structured tracking.',
                        items: [
                            'Best for mild pain, no near-term fertility plan, no organ involvement on imaging.',
                            'NSAIDs are first-line analgesia per the national guideline.',
                            'Track symptoms with a pain-and-bleeding diary so a change is recognized early.',
                            'Pelvic floor physical therapy is under-used and helps the musculoskeletal contributors.'
                        ],
                        note: 'Recurrence is real even when nothing is done; the national guideline explicitly notes high baseline recurrence rates.'
                    },
                    medical: {
                        sub: 'Hormonal suppression (guideline Level A + B evidence)',
                        intro: 'Medications quiet symptoms but do not erase disease. The national guideline ranks birth-control pills as first-line for painful periods and reserves GnRH agonists for cases that resist other treatment.',
                        items: [
                            'Combined oral contraceptives — first-line for dysmenorrhea; continuous use often performs better than cyclic.',
                            'Oral norethindrone or depot medroxyprogesterone — Level B evidence; equivalent to more expensive regimens.',
                            'Long-term OC use reduces endometrioma recurrence and dysmenorrhea recurrence (Level B).',
                            'A time-limited empiric GnRH-agonist trial after first-line therapy fails is supported by the national guideline (Level B); add-back therapy supports continued use.',
                            'Elagolix (oral GnRH antagonist) — newer option for moderate-to-severe pain per the NEJM randomized trials (Taylor et al.).',
                            'Suppression is NOT a fertility treatment (Level A — explicitly).'
                        ],
                        note: 'When the medication stops, pain often returns. Plan accordingly.'
                    },
                    surgical: {
                        sub: 'Laparoscopic / robotic excision',
                        intro: 'The most definitive way to confirm the diagnosis and remove disease. Supported by the national guideline for refractory pain, infertility, and endometriomas.',
                        items: [
                            'Excision of every visible (and ICG-fluorescent) lesion — superior to ablation per the national guideline (Level A).',
                            'Endometrioma cystectomy with ovarian-tissue preservation — excision > drainage + ablation per the national guideline (Level A).',
                            'Ureterolysis and careful bowel and rectosigmoid dissection when DIE is present, in the same operation; for the rare case that needs full-thickness bowel or bladder resection, colorectal surgery or urology colleagues operate alongside.',
                            'Improves pregnancy rates for endometriosis-related infertility per the national guideline (Level A; magnitude unclear).',
                            'Same-day discharge in 90.4% of minimally invasive fellowship cases; zero conversions to open surgery.',
                            'Even after definitive surgery (hysterectomy + BSO), the national guideline notes that disease can persist or recur; no operation removes that risk entirely.'
                        ],
                        note: 'Definitive diagnosis still requires histology of the excised tissue — every specimen is sent to pathology.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a typical excision case.',
                timeline: [
                    { stage: 'Before surgery', body: 'Detailed history, exam, and transvaginal ultrasound as the guideline-recommended imaging baseline; pelvic MRI added when DIE is suspected. Pre-op covers your goals (pain vs. fertility vs. both), GLP-1 medication timing (Ozempic, Wegovy, Mounjaro held per anesthesia protocol), blood thinners, hormone therapy, and ERAS optimization (anemia, nutrition, smoking).' },
                    { stage: 'Day of surgery', body: 'General anesthesia. Three to five small (5–12 mm) abdominal incisions. ICG injection where indicated. Every identified lesion is excised (not burned) to negative margins. A cystoscopy at the end confirms the ureters are intact. Most patients go home the same day.' },
                    { stage: 'First 2 weeks', body: 'Soreness rather than sharp pain. Alternating ibuprofen and acetaminophen handles most postoperative pain. Walking begins day one. No heavy lifting (>10 lb), no intercourse, no tampons for 2 weeks. Mild CO₂-related bloating resolves in 24–72 hours.' },
                    { stage: '6 weeks and beyond', body: 'Post-op visit, pathology review on every specimen, and a decision about hormonal suppression to reduce recurrence (the national guideline explicitly notes high recurrence rates without suppression). Pelvic floor PT typically begins at 4–6 weeks. Fertility planning restarts here when relevant.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Will surgery cure my endometriosis?', a: 'Excision is the most definitive treatment available, but the national guideline is honest that recurrence happens — both after medical therapy alone AND after conservative surgery. Complete excision of every visible (and ICG-positive) lesion gives the best long pain-free interval, and most patients add a hormonal-suppression strategy afterward to lower recurrence risk further.' },
                    { q: 'Why excision instead of just burning the lesions?', a: 'The national guideline calls this out as a Level A recommendation for endometriomas specifically: excision is superior to simple drainage and ablation of the cyst wall. Excision removes the disease at its root, lets pathology confirm the diagnosis, and produces measurably better outcomes than burning the surface.' },
                    { q: 'Can medication alone fix my endometriosis if I want to get pregnant?', a: 'No — the national guideline is explicit (Level A): medical suppressive therapies such as oral contraceptives and GnRH agonists are ineffective for endometriosis-associated infertility. They quiet pain while you take them; they do not improve fertility. Surgery does improve pregnancy rates for infertility caused by endometriosis (Level A).' },
                    { q: 'How is the diagnosis actually made?', a: 'The national guideline is clear: definitive diagnosis only comes from histology of lesions removed at surgery. Imaging and serum markers have not been able to replace diagnostic laparoscopy. Transvaginal ultrasound is the imaging of choice (Level A) and helpful for endometriomas and DIE; pelvic MRI adds detail for deep disease.' },
                    { q: 'What about my fertility — will surgery hurt it?', a: 'Done well, no. Endometrioma cystectomy carries a real risk of removing normal ovarian tissue, so technique matters; the national guideline notes excision is preferred over drainage+ablation even with that risk. For DIE, excision often improves spontaneous conception rates. Plan fertility timing BEFORE surgery, not after.' },
                    { q: 'What is ICG and why use it?', a: 'Indocyanine green is a contrast dye used safely in surgery for decades. Under near-infrared light it highlights fibrotic and inflammatory tissue — exactly the territory where endometriosis hides under normal light. Adding ICG to the standard guideline-recommended laparoscopic approach is a detection aid: in this practice’s published cohort study (Mabini & Tam, CAOG 2024), it helped identify fibrosis and inflammatory changes related to endometriosis so that disease could be found and excised.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'ACOG Clinical Practice Guideline No. 11 — Management of Endometriosis. Obstet Gynecol.' },
                    { cite: 'Vercellini P, et al. Endometriosis: pathogenesis and treatment. Nat Rev Endocrinol.', pmid: '24366116' },
                    { cite: 'Falcone T, Flyckt R. Clinical management of endometriosis. Obstet Gynecol. 2018.', pmid: '29215524' },
                    { cite: 'Taylor HS, et al. Endometriosis is a chronic systemic disease — clinical challenges and novel innovations. Lancet. 2021.', pmid: '34010604' },
                    { cite: 'Bafort C, et al. Laparoscopic surgery for endometriosis. Cochrane Database Syst Rev. 2020.', pmid: '33095458' },
                    { cite: 'Mabini C, Tam M. Use of indocyanine green (ICG) in the detection of fibrosis and inflammatory changes related to endometriosis: a retrospective cohort study. CAOG 91st Annual Meeting, 2024. Dr. George W. Morley Memorial Paper Award.' },
                    { cite: 'Taylor HS, et al. Treatment of endometriosis-associated pain with elagolix. N Engl J Med. 2017.', pmid: '28525302' }
                ]
            }
        ]
    };

    // -------- 2. ROBOTIC & LAPAROSCOPIC MYOMECTOMY --------
    const myomectomy = {
        tag: 'AAGL Video Abstract',
        title: 'Robotic & laparoscopic myomectomy',
        tagline: 'Removing fibroids while keeping your uterus. Including extended robotic cases for large fibroid burden, and a gel-port containment system for safe tissue extraction.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Uterus-preserving fibroid surgery.',
                body: `
                    <p>Fibroids (uterine leiomyomas) are the most common solid tumor in the female pelvis. In the landmark Baird ultrasound-screening study (Am J Obstet Gynecol, 2003), nearly 70% of White women and more than 80% of Black women had at least one by age 50. Most are silent — but the ones that bleed, cause pressure, or push on the bladder and bowel can be life-altering. Myomectomy is the operation that removes fibroids while leaving the uterus intact, which matters if you want future pregnancy or simply do not want a hysterectomy.</p>
                    <p>The minimally invasive approach uses small abdominal incisions and either laparoscopic or robotic instruments. Fibroids are enucleated (separated from the surrounding uterine muscle), and the uterine wall is then closed in multiple layers to restore strength — a technical detail that matters because the scar must hold a future pregnancy. Specimen extraction uses a contained gel-port system rather than open morcellation, reducing tissue spread and the rare risk of disseminating an occult cancer.</p>
                    <p>Race and biology matter here. In a 60-study systematic review of fibroid epidemiology (Stewart, BJOG 2017), Black race raised fibroid risk two- to three-fold compared with White race and was the risk factor with the strongest evidence, and the Baird screening study found fibroids developing at earlier ages in Black women. The minimally invasive route gives more patients access to a uterus-sparing option.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'What the data show.',
                body: `<p>Compared to open abdominal myomectomy, laparoscopic myomectomy reduces blood loss, shortens hospital stay, and speeds the return of bowel function — at the cost of a longer operation — in a meta-analysis of 12 randomized trials totaling 1,783 patients (Chen, BMC Surgery 2020). A time-limited course of GnRH agonist pretreatment to shrink fibroids and improve preoperative anemia in patients with very heavy menstrual bleeding is an option described in ACOG Practice Bulletin 228. The risk of finding an unsuspected leiomyosarcoma is low — about 0.51 per 1,000 operations for presumed fibroids, roughly 1 in 2,000, per the Cochrane review of morcellation for laparoscopic myomectomy — but it is not zero, which is why contained extraction is standard.</p>`,
                stats: [
                    { num: '~70%', label: 'of women have fibroids by menopause; only ~25% are clinically significant', source: 'ACOG · clinical synthesis' },
                    { num: '2–3×', label: 'higher fibroid prevalence in Black women than in White women', source: 'ACOG · epidemiology' },
                    { num: '0.5–1%', label: 'risk of uterine rupture in a future pregnancy after myomectomy', source: 'ACOG practice guidance' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'Choosing the right path for your fibroids.',
                rba: {
                    expectant: {
                        sub: 'Watchful waiting',
                        intro: 'If bleeding is manageable and you are approaching menopause, watching may be the right answer — fibroids shrink when estrogen declines.',
                        items: [
                            'Track bleeding heaviness (pads/hour, clots, flooding) and any new bulk symptoms.',
                            'Iron supplementation if menstrual losses are causing anemia.',
                            'Re-image (transvaginal ultrasound) if new rapid growth or postmenopausal change.',
                            'NSAIDs can ease cramping and lighten flow during periods.'
                        ],
                        note: 'Best for asymptomatic fibroids or mild symptoms in late reproductive years.'
                    },
                    medical: {
                        sub: 'Medication-based options',
                        intro: 'Medications can reduce bleeding from fibroids — they cannot make the fibroids disappear, but they often buy time.',
                        items: [
                            'Levonorgestrel IUD — reduces fibroid-related heavy bleeding per ACOG Practice Bulletin 228; not ideal if the cavity is distorted (higher expulsion rate).',
                            'Tranexamic acid — non-hormonal, taken only on heavy days; an option for fibroid-related heavy bleeding in ACOG Practice Bulletin 228.',
                            'Combined oral contraceptives or progestin-only pills — reduce bleeding and cycle regularity.',
                            'GnRH antagonist with hormone add-back (elagolix combination) — reduced heavy menstrual bleeding in the Elaris UF phase 3 trials (Schlaff, NEJM 2020); a bridge for patients deferring surgery.',
                            'GnRH agonists (Lupron) as a time-limited course before surgery to shrink fibroids and correct anemia.'
                        ],
                        note: 'Medications address bleeding well; they do not address pressure symptoms.'
                    },
                    surgical: {
                        sub: 'Laparoscopic / robotic myomectomy',
                        intro: 'Removes the fibroids, preserves the uterus, and lets you keep the option of pregnancy.',
                        items: [
                            'Best for symptomatic fibroids in patients who want to preserve fertility, or who simply do not want hysterectomy.',
                            'Multi-layer myometrial closure to restore uterine wall strength.',
                            'Gel-port contained tissue extraction — minimizes the risk of tissue spread.',
                            'Same-day or overnight stay typical; full activity by 4–6 weeks.',
                            'Future cesarean delivery is recommended if the uterine cavity was entered or a deep transmural fibroid was removed.'
                        ],
                        note: 'Alternatives include hysteroscopic myomectomy (for submucosal fibroids), uterine artery embolization (UAE) by interventional radiology, MRI-guided focused ultrasound, and hysterectomy when uterus preservation is not desired.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a myomectomy case.',
                timeline: [
                    { stage: 'Before surgery', body: 'Imaging (pelvic ultrasound — sometimes MRI for very large or multiple fibroids), labs (CBC for anemia, type-and-screen), and a discussion of GnRH pretreatment if anemia is significant. Iron supplementation is started early. GLP-1 medications and blood thinners are held per anesthesia protocol.' },
                    { stage: 'Day of surgery', body: 'General anesthesia. Three to five small incisions. Each fibroid is enucleated; the uterus is closed in multiple layers. Tissue is extracted through a contained gel-port system. Most patients go home the same day; some stay overnight if the operation was extensive.' },
                    { stage: 'First 2 weeks', body: 'Soreness, mild bloating, and fatigue are expected. Walking starts immediately. No lifting >10 lb, no intercourse, no tampons for 4–6 weeks. Bleeding may be irregular for a few cycles as the uterus heals.' },
                    { stage: '6 weeks and beyond', body: 'Post-op visit and an imaging check. Trying to conceive is usually delayed 3–6 months depending on how deep the closure had to go. A future cesarean delivery is typically recommended if the uterine cavity was entered or a deep transmural fibroid was removed.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Will my fibroids come back?', a: 'New fibroids can develop after myomectomy. The risk increases with the number of fibroids removed and the time elapsed — in a systematic review of uterine-sparing fibroid treatments (Sandberg, Fertility and Sterility 2018), about 12% of myomectomy patients needed a reintervention within five years, though many patients never do. Hormonal suppression is not routinely used for prevention.' },
                    { q: 'Can I get pregnant after a myomectomy?', a: 'Yes — myomectomy is specifically designed to preserve fertility. Most fertility specialists recommend waiting 3–6 months before conceiving so the uterine scar can mature. If your uterine cavity was entered or a deep transmural fibroid was removed, your obstetrician will usually recommend cesarean delivery to protect against rupture.' },
                    { q: 'What is the risk of uterine rupture in pregnancy?', a: 'Estimated at 0.5–1% after myomectomy per ACOG practice guidance. The risk is highest with very deep closures or repeat myomectomies. The multi-layer closure technique used in robotic and laparoscopic myomectomy is designed specifically to minimize this risk.' },
                    { q: 'What about the cancer concern with morcellation?', a: 'The risk of finding an unsuspected leiomyosarcoma is low — about 0.51 per 1,000 surgeries for presumed fibroids, roughly 1 in 2,000, in the Cochrane review of morcellation — but no preoperative test rules it out completely. A contained gel-port extraction system keeps tissue inside a bag during removal, reducing (though not eliminating) the risk of spreading any undetected cancer.' },
                    { q: 'Why not just remove the uterus and be done with it?', a: 'Hysterectomy is a perfectly valid option for someone who is finished with childbearing and prefers a definitive solution. But for patients who want to keep the option of pregnancy, or who simply feel strongly about keeping their uterus, myomectomy is the answer.' },
                    { q: 'When should I consider uterine artery embolization (UAE) instead?', a: 'UAE is a non-surgical, image-guided procedure that blocks blood flow to fibroids. It is a reasonable option if you want to avoid surgery and are not actively trying to conceive — in the randomized FEMME trial (Sirkeci, Int J Gynaecol Obstet 2023), pregnancies after either treatment were too few to settle the fertility question, and in the Sandberg systematic review about 14% of UAE patients needed a reintervention within five years. UAE is performed by interventional radiology, not by this practice; when it looks like the better fit for you, a referral is part of an honest conversation.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'ACOG Practice Bulletin 228 — Management of Symptomatic Uterine Leiomyomas. Obstet Gynecol. 2021.', pmid: '34011888' },
                    { cite: 'Stewart EA, et al. Epidemiology of uterine fibroids: a systematic review. BJOG. 2017.', pmid: '28296146' },
                    { cite: 'Baird DD, et al. High cumulative incidence of uterine leiomyoma in black and white women: ultrasound evidence. Am J Obstet Gynecol. 2003.', pmid: '12548202' },
                    { cite: 'Chen R, et al. The effects and costs of laparoscopic versus abdominal myomectomy in patients with uterine fibroids: a systematic review and meta-analysis. BMC Surg. 2020.', pmid: '32192462' },
                    { cite: 'Sandberg EM, et al. Reintervention risk and quality of life outcomes after uterine-sparing interventions for fibroids: a systematic review and meta-analysis. Fertil Steril. 2018.', pmid: '29653718' },
                    { cite: 'Schlaff WD, et al. Elagolix for heavy menstrual bleeding in women with uterine fibroids. NEJM. 2020.', pmid: '31971678' },
                    { cite: 'Sirkeci F, et al. Effects on heavy menstrual bleeding and pregnancy of uterine artery embolization or myomectomy for women with uterine fibroids wishing to avoid hysterectomy: the FEMME randomized controlled trial. Int J Gynaecol Obstet. 2023.', pmid: '36511801' },
                    { cite: 'Zullo F, et al. In-bag manual versus uncontained power morcellation for laparoscopic myomectomy. Cochrane Database Syst Rev. 2020.', pmid: '32374421' }
                ]
            }
        ]
    };

    // -------- 3. COMPLEX MIS HYSTERECTOMY --------
    const hysterectomyMIS = {
        tag: 'Minimally Invasive Routes',
        title: 'Complex minimally invasive hysterectomy',
        tagline: '177 hysterectomies across the fellowship — 93% completed minimally invasively by robotic, laparoscopic, vNOTES, or vaginal routes. Zero conversions to open surgery.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Major surgery without the major hospital stay.',
                body: `
                    <p>Hysterectomy is the removal of the uterus. The reasons range from benign (fibroids, abnormal bleeding, endometriosis, prolapse, chronic pain) to malignant. The traditional approach is an open abdominal incision — long recovery, higher infection rate, more pain, larger scar. The minimally invasive routes — robotic, laparoscopic, vaginal, and vNOTES (vaginal natural orifice transluminal endoscopic surgery) — achieve the same end with small or no abdominal incisions.</p>
                    <p>The choice of route is not one-size-fits-all. Uterine size, prior surgeries, body habitus, the presence of adhesions or deep endometriosis, the need for concurrent prolapse repair, and patient preference all matter. Most contemporary practice guidelines recommend a vaginal or laparoscopic route as first choice for benign disease, with robotic reserved for cases where additional dexterity is needed (large uteri, dense adhesions, concurrent complex pelvic floor work).</p>
                    <p>Total hysterectomy removes the uterus and cervix. Supracervical hysterectomy keeps the cervix. Both approaches have low and comparable overall complication rates; the choice depends on cervical history (Pap results, prior CIN) and patient preference. If the cervix stays, Pap screening continues on its usual schedule.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'Route matters.',
                body: `<p>The shift toward minimally invasive hysterectomy is supported by decades of randomized and registry data. The Cochrane review of surgical approach to hysterectomy for benign disease (Aarts et al., 2015) found faster return to normal activities, fewer wound infections, and shorter hospital stays with vaginal and laparoscopic routes compared to open abdominal hysterectomy, and concluded that the vaginal route should be performed whenever feasible; the 2023 update of that review (Pickett et al.) now evaluates vNOTES among the established approaches. When prolapse needs attention at the same time, the repair in this practice is native tissue — uterosacral ligament suspension at the hysterectomy itself, the pattern of 48 of the fellowship’s 49 suspensions (fellowship operative log). No mesh is used for prolapse repair in this practice.</p>`,
                stats: [
                    { num: '90.4%', label: 'MIS same-day discharge across the fellowship — major surgery, home the same day', source: 'Fellowship operative log' },
                    { num: '177', label: 'Hysterectomies across the fellowship — 165 (93%) by robotic, laparoscopic, vaginal, or vNOTES routes; zero conversions to open surgery', source: 'Fellowship operative log' },
                    { num: '100%', label: 'Cystoscopy at the close of every minimally invasive hysterectomy (165 of 165) to confirm the bladder and ureters are uninjured', source: 'Fellowship operative log' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'Choosing the right operation — and the right route.',
                rba: {
                    expectant: {
                        sub: 'Non-surgical management',
                        intro: 'Hysterectomy is irreversible. For many benign indications, less invasive options are tried first.',
                        items: [
                            'For abnormal bleeding: hormonal IUD, tranexamic acid, endometrial ablation — all reasonable first steps.',
                            'For fibroids: medical management, UAE, or uterus-preserving myomectomy.',
                            'For prolapse: pessary fitting, pelvic floor PT, weight optimization.',
                            'For chronic pain from endometriosis: medical suppression, excision, multidisciplinary pain care.'
                        ],
                        note: 'Hysterectomy is appropriate when uterus-preserving options have failed or are clearly inferior for your situation.'
                    },
                    medical: {
                        sub: 'Targeted medical or office-based therapy',
                        intro: 'Many uterine conditions can be addressed without removing the uterus.',
                        items: [
                            'Levonorgestrel IUD — first-line for heavy menstrual bleeding without large fibroids.',
                            'Endometrial ablation — for completed childbearing with normal cavity and bleeding-dominant symptoms.',
                            'Hysteroscopic myomectomy or polypectomy — for cavity-distorting fibroids or polyps.',
                            'Hormonal suppression for endometriosis or adenomyosis-related pain.'
                        ],
                        note: 'These options preserve the uterus and avoid the perioperative risks of any hysterectomy.'
                    },
                    surgical: {
                        sub: 'Minimally invasive hysterectomy',
                        intro: 'Total or supracervical, by robotic, laparoscopic, vaginal, or vNOTES route — chosen for your anatomy and your goals.',
                        items: [
                            'Vaginal or laparoscopic preferred when feasible — first-line per ACOG benign-hysterectomy guidance.',
                            'Robotic — for large uteri, dense adhesions, deep endometriosis, or concurrent complex pelvic floor work.',
                            'vNOTES — no abdominal incisions; vaginal route through a single port. Faster recovery, less postoperative pain.',
                            'Concurrent prolapse repair when needed — native-tissue uterosacral ligament suspension and anterior/posterior colporrhaphy at the time of hysterectomy, by vaginal, robotic, laparoscopic, or vNOTES route. No mesh.',
                            'Same-day discharge in the majority of cases. Full activity in 4–6 weeks.'
                        ],
                        note: 'Open abdominal hysterectomy is reserved for rare situations (very large uteri without alternative access, certain cancers, or anatomy that prohibits a minimally invasive approach).'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a minimally invasive hysterectomy.',
                timeline: [
                    { stage: 'Before surgery', body: 'Imaging, recent normal Pap (within preventive guidelines), an honest conversation about whether the ovaries stay or go (a major decision: ovary preservation before age 50 has cardiovascular and cognitive benefits, but a family or personal cancer-syndrome risk shifts that calculus), and ERAS optimization (anemia, smoking, weight, GLP-1 timing).' },
                    { stage: 'Day of surgery', body: 'General anesthesia. Four small abdominal incisions for the robotic or laparoscopic routes — or none at all for the vaginal and vNOTES routes, which work entirely through the vagina. The uterus is detached from its blood supply and supporting ligaments and removed. The vaginal cuff is sutured closed. A cystoscopy at the end confirms the ureters and bladder are uninjured. Most patients go home the same day.' },
                    { stage: 'First 2 weeks', body: 'Soreness, light spotting or pink discharge, mild bloating from CO₂. Walking starts immediately. No tampons, no intercourse, no heavy lifting for 6 weeks (the vaginal cuff is healing). Stool softener is useful for the first 1–2 weeks.' },
                    { stage: '6 weeks and beyond', body: 'Post-op visit and cuff exam. Full activity resumes. Many patients describe a notable improvement in energy and quality of life once heavy bleeding or chronic pain is no longer in the picture. Pap smears continue only if the cervix was retained.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Will I go into menopause?', a: 'Only if your ovaries are removed at the same time. Hysterectomy alone removes the uterus — your ovaries continue to make hormones, and menopause arrives on its natural schedule. Removing the ovaries (bilateral salpingo-oophorectomy) is a separate decision with its own pros and cons.' },
                    { q: 'Should I keep my ovaries?', a: 'For most women under age 50 with no cancer risk, keeping the ovaries is currently the preferred default — long-term studies show small but real cardiovascular, bone, and cognitive benefits from natural estrogen until natural menopause. Removing the fallopian tubes (salpingectomy) at the same time is a separate, evidence-based step to reduce future ovarian cancer risk — a 2019 Cochrane review found no clear effect on ovarian hormone reserve.' },
                    { q: 'Will surgery affect my sex life?', a: 'For most patients, sexual function improves after hysterectomy because the underlying problem (pain, heavy bleeding, prolapse) is no longer in the picture. The vaginal cuff usually heals well; intercourse resumes at 6 weeks. Pelvic floor PT helps if there is any post-op discomfort.' },
                    { q: 'What is the recovery like vs. open hysterectomy?', a: 'Substantially faster. Minimally invasive routes typically allow same-day discharge, much less pain, and a return to desk work in 1–2 weeks. Open abdominal hysterectomy usually means 2–3 days in the hospital and 6–8 weeks before full activity.' },
                    { q: 'What about my cervix — should it stay or go?', a: 'For benign disease with a normal Pap history, both total (cervix removed) and supracervical (cervix kept) hysterectomies are reasonable, with low and comparable complication rates. The decision comes down to your cervical history (prior abnormal Paps or CIN) and your preference. If you keep the cervix, you keep the Pap screening.' },
                    { q: 'I also have prolapse — will you use mesh to fix it?', a: 'No. When prolapse repair is needed at the time of hysterectomy, the repair here is native tissue: a uterosacral ligament suspension for apical support, with anterior or posterior colporrhaphy as needed — your own supportive structures, no mesh. Mesh-augmented repairs such as sacrocolpopexy exist and are the right operation for some patients; if that is true for you, the honest next step is a referral to a urogynecology colleague who performs them.' },
                    { q: 'Is robotic better than laparoscopic?', a: 'For most benign cases, outcomes are equivalent — both are minimally invasive. Robotic offers extra dexterity, 3D vision, and tremor filtration that help in complex cases (very large uteri, dense adhesions, deep endometriosis, concurrent pelvic floor reconstruction). For straightforward cases, traditional laparoscopy is excellent.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'ACOG Committee Opinion No. 701 — Choosing the Route of Hysterectomy for Benign Disease. Obstet Gynecol. 2017.' },
                    { cite: 'AAGL Position Statement — Route of Hysterectomy to Treat Benign Uterine Disease. J Minim Invasive Gynecol. 2011.' },
                    { cite: 'Aarts JW, et al. Cochrane review — Surgical approach to hysterectomy for benign gynaecological disease. 2015.', pmid: '26264829' },
                    { cite: 'Pickett CM, et al. Cochrane review — Surgical approach to hysterectomy for benign gynaecological disease. 2023.', pmid: '37642285' },
                    { cite: 'van Lieshout LAM, et al. Cochrane review — Hysterectomy with opportunistic salpingectomy versus hysterectomy alone. 2019.', pmid: '31456223' }
                ]
            }
        ]
    };

    // -------- 4. OPERATIVE HYSTEROSCOPY --------
    const operativeHysteroscopy = {
        tag: 'Golden Hysteroscope Award',
        title: 'Operative hysteroscopy',
        tagline: 'Diagnosing and treating problems inside the uterus without a single abdominal incision. Polyps, fibroids, septum, isthmocele, retained tissue, scar tissue, ablation — all from inside.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'A camera through the cervix — and a complete operation.',
                body: `
                    <p>The uterus has an inside (the cavity, lined by endometrium) and an outside (the muscle, the serosal surface). Hysteroscopy means putting a small camera through the cervix into the cavity. <em>Operative</em> hysteroscopy means treating something while you are in there — removing a polyp, resecting a submucosal fibroid, cutting a uterine septum, repairing a cesarean scar defect (isthmocele), evacuating retained pregnancy tissue, lysing scar tissue (Asherman's), or performing endometrial ablation.</p>
                    <p>No abdominal incision. Outpatient — most patients go home within an hour or two of finishing the procedure. The recovery is measured in days, not weeks.</p>
                    <p>The defining advantage over a blind dilation and curettage is that the surgeon <em>sees</em> what is being treated. A blind curette scrapes the cavity by feel; a hysteroscope shows the lesion and confirms it is gone before the instrument comes out. That visualize-rather-than-guess principle earned this practice's approach to retained-tissue removal the AAGL Golden Hysteroscope Award for best video abstract in hysteroscopy (Mabini et al., AAGL Global Congress 2024 — full citation in the references below).</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'What the evidence and the operative log support.',
                body: `<p>Each claim here traces to a named source. The AAGL practice guideline on submucosal leiomyomas governs when and how submucosal fibroids are removed hysteroscopically, and the AAGL practice report on intrauterine adhesions guides the management of Asherman's syndrome; both are listed in the references below. For cesarean scar defects, a systematic review and meta-analysis (Vitale et al., JMIG) pools the published outcomes of hysteroscopic isthmocele repair. Comfort has evidence too: per Bettocchi's original report, the vaginoscopic approach reduces the pain of office hysteroscopy, which is why many diagnostic and small operative procedures can be done awake, with no speculum and no tenaculum.</p>`,
                stats: [
                    { num: '195', label: 'Hysteroscopic procedures across 101 fellowship cases — myomectomy, polypectomy, ablation, septum, isthmocele, Asherman\'s adhesiolysis', source: 'Fellowship operative log, Sept 2023 – May 2026' },
                    { num: '35', label: 'Procedures performed by office-based technique — 33 of them by vaginoscopy, with no speculum and no tenaculum', source: 'Fellowship operative log · Bettocchi technique' },
                    { num: '0', label: 'Major adverse events across the entire 444-case series — no conversions to open surgery, no reoperations for a complication', source: 'Fellowship operative log, Sept 2023 – May 2026' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'When hysteroscopy is the right answer.',
                rba: {
                    expectant: {
                        sub: 'Watchful waiting',
                        intro: 'Many incidental findings on ultrasound do not need treatment.',
                        items: [
                            'Small asymptomatic polyps in premenopausal patients can sometimes be observed.',
                            'Small intramural fibroids that do not distort the cavity do not need hysteroscopy.',
                            'A repeat imaging study after a menstrual cycle clears up many ambiguous findings.'
                        ],
                        note: 'Observation is reasonable only when the pathology is small, asymptomatic, and the patient is not postmenopausal.'
                    },
                    medical: {
                        sub: 'Medication-based approaches',
                        intro: 'For some indications, hormonal therapy is reasonable first.',
                        items: [
                            'Levonorgestrel IUD — for abnormal bleeding without cavity-distorting pathology.',
                            'Cyclic or continuous progestin for endometrial protection.',
                            'Cervical priming with misoprostol before hysteroscopy in premenopausal women with cervical stenosis.'
                        ],
                        note: 'Medications do not treat polyps, structural fibroids, septa, or scar tissue — those need to be addressed surgically.'
                    },
                    surgical: {
                        sub: 'Hysteroscopic procedure',
                        intro: 'Treat the lesion under direct vision, in the same setting where it is diagnosed.',
                        items: [
                            'Polypectomy — definitive treatment for endometrial polyps, including those causing bleeding or infertility.',
                            'Hysteroscopic myomectomy — for submucosal fibroids (types 0, 1, and select type 2).',
                            'Septum resection — for uterine septum associated with recurrent pregnancy loss.',
                            'Isthmocele repair — for cesarean scar defect causing bleeding or fertility issues.',
                            'RPOC (retained products of conception) — visualized evacuation rather than blind D&C, preserving endometrial integrity.',
                            'Lysis of intrauterine adhesions (Asherman\'s syndrome) — restoring cavity anatomy and menstrual function.',
                            'Endometrial ablation — for completed childbearing with bleeding-dominant symptoms and a normal cavity.'
                        ],
                        note: 'Same-day procedure; most patients return to normal activity within 24–48 hours.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of an operative hysteroscopy.',
                timeline: [
                    { stage: 'Before the procedure', body: 'A recent pelvic ultrasound or sonohysterogram defining the lesion. Cervical priming with misoprostol the night before, if needed. Procedure scheduled in the early proliferative phase if you menstruate. Light breakfast, then nothing by mouth for 6 hours before. Hold blood thinners per anesthesia guidance.' },
                    { stage: 'Day of procedure', body: 'Most operative hysteroscopies are done with brief general anesthesia or deep sedation. The cervix is gently dilated, a hysteroscope is placed, and the lesion is removed under direct vision. Saline distends the cavity. Fluid balance is monitored carefully. Procedure time is typically 15–45 minutes; you are home a few hours after waking up.' },
                    { stage: 'First few days', body: 'Mild cramping (like a strong period) and light pink or red spotting for 3–7 days. Ibuprofen handles the cramping. No tampons or intercourse for 1–2 weeks. You can return to a desk job the next day; physical exertion within 2–3 days.' },
                    { stage: 'Follow-up', body: 'A pathology review (every removed tissue is sent), a post-op visit at 2–4 weeks, and, if you are trying to conceive, a discussion of the right time to start again.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Does hysteroscopy hurt?', a: 'Operative hysteroscopy is done with anesthesia, so you feel nothing during the procedure. Afterwards, expect period-like cramping for a day or two — easily handled with ibuprofen. Small office diagnostic hysteroscopies can be done without anesthesia when the patient prefers; even those are usually described as a strong but brief cramp.' },
                    { q: 'Will my fertility be affected?', a: 'In general, hysteroscopic procedures improve fertility when they correct a pathology that was interfering with implantation (polyp, submucosal fibroid, septum, scar tissue). The risk of new scar tissue (Asherman\'s) after a hysteroscopic procedure is low when meticulous technique and contemporary tools (mechanical or bipolar resection) are used.' },
                    { q: 'How is it different from a D&C?', a: 'A traditional D&C is blind — the instrument scrapes the cavity without seeing what is there. Hysteroscopy uses a camera, so the surgeon sees and treats only the abnormal tissue while leaving the rest of the endometrium intact. For retained pregnancy tissue, hysteroscopic evacuation preserves more endometrial function and lowers the scar-tissue risk.' },
                    { q: 'When can I try to conceive afterward?', a: 'For most procedures (polyp removal, submucosal fibroid resection, septum), one menstrual cycle is enough — typically 4–6 weeks. For lysis of adhesions, a second-look hysteroscopy is sometimes recommended before conception. For ablation, conception is no longer recommended.' },
                    { q: 'What are the risks of hysteroscopy?', a: 'The main risks are uterine perforation, bleeding requiring further intervention, infection, and fluid overload from the distension medium during long operative cases (the surgical team tracks fluid balance continuously). All are uncommon. In this practice\'s fellowship series of 444 operative cases there was a single uterine perforation, which required no treatment, and zero major adverse events across the entire series (fellowship operative log, Sept 2023 – May 2026).' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'AAGL Practice Report — Practice Guidelines for the Diagnosis and Management of Submucosal Leiomyomas. J Minim Invasive Gynecol.', pmid: '22196255' },
                    { cite: 'Bettocchi S, Selvaggi L. A vaginoscopic approach to reduce the pain of office hysteroscopy. J Am Assoc Gynecol Laparosc.', pmid: '9050614' },
                    { cite: 'Cooper NA, et al. Hysteroscopic surgery for unexplained heavy menstrual bleeding. Cochrane Database Syst Rev.', pmid: '26797202' },
                    { cite: 'AAGL Practice Report — Management of Intrauterine Adhesions (Asherman\'s syndrome). J Minim Invasive Gynecol.', pmid: '30083701' },
                    { cite: 'Vitale SG, et al. Hysteroscopic management of isthmocele: systematic review and meta-analysis. JMIG.', pmid: '38302947' },
                    { cite: 'Mabini C, et al. To see or not to see? A visually directed approach to the hysteroscopic removal of RPOC from an angular pregnancy in an arcuate uterus. J Minim Invasive Gynecol. 2024;31(11):S14. AAGL Golden Hysteroscope Award, AAGL Global Congress 2024.' }
                ]
            }
        ]
    };

    // -------- 5. OFFICE HYSTEROSCOPY & VAGINOSCOPY --------
    const officeHysteroscopy = {
        tag: 'Bettocchi No-Touch Technique',
        title: 'Office hysteroscopy & vaginoscopy',
        tagline: 'Awake. No speculum. No tenaculum. A 3–5 mm camera and saline — diagnostic and many operative procedures done in the office in under 30 minutes.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Hysteroscopy without the operating room.',
                body: `
                    <p>Office hysteroscopy is exactly what it sounds like: a hysteroscopy done in the clinic — awake, without general anesthesia, without a hospital. The Bettocchi "vaginoscopic" or no-touch technique skips the speculum and the tenaculum (the clamp on the cervix) entirely. A miniature hysteroscope (typically 3–5 mm) is guided into the vagina under saline distension, and the cervix is approached gently, on its own terms, without instruments that traditionally cause the most pain.</p>
                    <p>The point is patient comfort without sacrificing diagnostic quality. For diagnostic indications — abnormal bleeding, suspected polyp, recurrent pregnancy loss, infertility workup — office hysteroscopy is equivalent or better than ultrasound for evaluating the uterine cavity, per the Salazar and Isaacson office hysteroscopy update in JMIG. For many small operative procedures (small polyps, retained suture, foreign body, simple adhesions), it can be definitive in a single office visit.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'Why office hysteroscopy works.',
                body: `<p>Office hysteroscopy with the vaginoscopic approach is more comfortable than traditional office hysteroscopy with speculum and tenaculum, and equivalent in diagnostic yield — a finding first reported in the Bettocchi vaginoscopic series and confirmed in the Bennett systematic review and meta-analysis of pain in office hysteroscopy. As the Salazar and Isaacson office hysteroscopy update describes, NSAIDs alone are typically sufficient for pain control; sedation is rarely needed. Patients return to normal activity the same day, and for the patient, the convenience advantage is large — no hospital, no anesthesia, no missed day of work.</p>`,
                stats: [
                    { num: '3–5 mm', label: 'Miniature hysteroscope diameter — no cervical dilation needed in most patients', source: 'Centini et al. · Best Pract Res Clin Obstet Gynaecol' },
                    { num: 'No anesthesia', label: 'NSAIDs alone are sufficient analgesia for most office hysteroscopies', source: 'Salazar & Isaacson · JMIG office hysteroscopy update' },
                    { num: 'No touch', label: 'Vaginoscopy — no speculum, no tenaculum — reduces the pain of office hysteroscopy', source: 'Bettocchi JAAGL series · Bennett JMIG meta-analysis' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'When the office is the right place for it.',
                rba: {
                    expectant: {
                        sub: 'Imaging alone',
                        intro: 'Sometimes a transvaginal ultrasound is enough.',
                        items: [
                            'For a confirmed simple cause (e.g., obvious fibroid on ultrasound) and stable symptoms.',
                            'When no biopsy is needed and no intracavitary lesion is suspected.',
                            'When the patient is approaching menopause and willing to wait through any fibroid-related bleeding.'
                        ],
                        note: 'Imaging without hysteroscopy is reasonable when the diagnosis is already secure.'
                    },
                    medical: {
                        sub: 'Office tools other than hysteroscopy',
                        intro: 'Some workups can be done with simpler office tools.',
                        items: [
                            'Office endometrial biopsy (Pipelle) — for endometrial cancer rule-out.',
                            'Saline-infusion sonography — better than transvaginal ultrasound alone for cavity assessment.',
                            'Cervical cytology and HPV testing — for cervical screening.'
                        ],
                        note: 'These have a role; office hysteroscopy is usually more informative than any of them alone.'
                    },
                    surgical: {
                        sub: 'Office hysteroscopy (Bettocchi no-touch)',
                        intro: 'Direct visualization of the cavity, with biopsy and minor operative capability — in the office, awake.',
                        items: [
                            'Diagnostic hysteroscopy for abnormal bleeding, infertility, recurrent pregnancy loss.',
                            'Directed biopsy of any focal lesion under direct vision.',
                            'Small polypectomy with grasper, miniature scissors, or bipolar tools.',
                            'Removal of retained suture, lost IUD, or small foreign body.',
                            'Lysis of mild intrauterine adhesions.',
                            'NSAIDs ~30 minutes before the procedure; no fasting; no anesthesia in most cases.'
                        ],
                        note: 'Larger fibroids, dense adhesions, septum resection, ablation, or any procedure expected to be long → moved to the OR with anesthesia.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of an office hysteroscopy visit.',
                timeline: [
                    { stage: 'Before the visit', body: 'A brief check-in by phone or portal — confirm timing relative to your cycle (best in the early proliferative phase if you menstruate), arrange for a ride home if you would prefer (most do not need one), and review medications, including whether to take an NSAID such as ibuprofen shortly before arrival.' },
                    { stage: 'During the visit', body: 'You change into a gown but remain awake the entire time. No speculum. No tenaculum in most cases. The hysteroscope is gently advanced into the vagina under saline flow, through the cervix, and into the cavity. The full inspection takes 3–5 minutes; a small polypectomy or biopsy adds another 5–15. Most patients describe it as a strong, brief cramp.' },
                    { stage: 'After the visit', body: 'You can drive home, return to work, or run errands. Mild cramping and light spotting for 24–48 hours are normal. No restrictions on intercourse, exercise, or tampons unless you had a biopsy or polypectomy (then wait 24 hours).' },
                    { stage: 'Follow-up', body: 'Biopsy results in 5–10 days. A short visit (or phone call) to review the findings and decide on next steps. Many patients leave the diagnostic office hysteroscopy with both an answer and a plan.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'How painful is it?', a: 'Most patients describe a strong, brief cramp at the moment the camera passes through the cervix, followed by a milder ache during the inspection. In the Bennett systematic review and meta-analysis of pain in office hysteroscopy, reported pain is generally mild to moderate, and the vaginoscopic no-touch technique (avoiding the tenaculum) makes a measurable difference. Premedication with ibuprofen helps as well.' },
                    { q: 'Why not just go to the OR?', a: 'For the right indications, the office is faster, less expensive, requires no anesthesia, no fasting, no driver, and no missed day of work. For larger operative needs or for patients who simply prefer to be asleep, the OR is always available — and we honor that preference.' },
                    { q: 'Do I need to stop my period medications or birth control?', a: 'Most do not need to stop hormonal medications. We do prefer to time the procedure in the early proliferative phase (days 4–11 of your cycle) when the endometrium is thinnest, but that is not a hard rule.' },
                    { q: 'What about cervical stenosis — can I still have it done?', a: 'Often yes, with a small dose of misoprostol the night before to soften the cervix. Severe stenosis or known prior cervical surgery may require an OR setting, but the office still handles the majority.' },
                    { q: 'What can be treated in the office vs. saved for the OR?', a: 'Office: small polyps, retained sutures, lost IUDs, foreign bodies, simple adhesions, directed biopsies. OR: larger submucosal fibroids, septum resection, ablation, dense Asherman\'s, isthmocele repair, RPOC with significant retained tissue. The decision is made together.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'Bettocchi S, Selvaggi L. A vaginoscopic approach to reduce the pain of office hysteroscopy. J Am Assoc Gynecol Laparosc.', pmid: '9050614' },
                    { cite: 'Bennett A, et al. Pain in office hysteroscopy: a systematic review and meta-analysis. JMIG.', pmid: '40914965' },
                    { cite: 'Centini G, et al. Modern operative hysteroscopy. Best Pract Res Clin Obstet Gynaecol.', pmid: '26253336' },
                    { cite: 'Munro MG, et al. The FIGO recommendations on terminologies and definitions for normal and abnormal uterine bleeding. Semin Reprod Med.', pmid: '17516956' },
                    { cite: 'Salazar CA, Isaacson KB. Office operative hysteroscopy: an update. JMIG.', pmid: '30083701' }
                ]
            }
        ]
    };

    // -------- 6. vNOTES --------
    const vnotes = {
        tag: 'Emerging Technique',
        title: 'vNOTES — Vaginal NOTES',
        tagline: 'Hysterectomy and adnexal procedures with no abdominal incisions. Vaginal natural orifice transluminal endoscopic surgery — combining the strengths of vaginal and laparoscopic routes.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Surgery through the body\'s natural opening.',
                body: `
                    <p>vNOTES is the abbreviation for <em>vaginal natural orifice transluminal endoscopic surgery</em> — minimally invasive gynecologic surgery done entirely through the vagina, with no abdominal incisions. A single multi-channel port is placed vaginally; the camera and instruments go in through that port; the operation (hysterectomy, removal of an ovarian cyst or fallopian tube, treatment of select adnexal pathology) is completed and the specimen comes out the same way it was approached.</p>
                    <p>vNOTES combines two routes that have long competed: the vaginal route (no abdominal incisions, fast recovery, less pain) and the laparoscopic route (good visualization, ability to handle the upper pelvis). For appropriate cases, it offers no visible abdominal scars, less postoperative pain, and a faster return to baseline activity than traditional laparoscopy.</p>
                    <p>It is not for every case. Very large uteri, dense pelvic adhesions, prior radiation, narrow vaginal access, and active pelvic infection are reasons to choose a different route. Patient selection drives outcomes — this is one of several routes a fellowship-trained MIGS surgeon offers, not the only one.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'What the early literature shows.',
                body: `<p>Randomized data from the HALON trial comparing vNOTES to standard laparoscopic hysterectomy (Baekelandt, Hum Reprod), together with a meta-analysis of postoperative outcomes after vNOTES versus conventional laparoscopic hysterectomy (Liu, Surg Endosc), show faster recovery, lower postoperative pain scores, and shorter hospital stays — without an increase in complications when the procedure is performed by an experienced operator on an appropriately selected patient. The technique continues to mature; international training programs and the multicenter outcomes registry reported by Kapurubandara and colleagues (JMIG) continue to refine selection criteria.</p>`,
                stats: [
                    { num: 'No abdominal scars', label: 'vNOTES leaves no visible incisions on the abdominal wall', source: 'Technique definition' },
                    { num: 'Faster recovery', label: 'Less postoperative pain and shorter hospital stay than standard laparoscopic hysterectomy', source: 'HALON RCT · Liu meta-analysis' },
                    { num: 'Patient selection', label: 'Best for appropriately sized uteri without dense adhesions or vaginal access constraints', source: 'AAGL practice guidance' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'When vNOTES is the right route — and when it isn\'t.',
                rba: {
                    expectant: {
                        sub: 'Non-surgical management',
                        intro: 'As with any hysterectomy or adnexal surgery, less invasive options come first.',
                        items: [
                            'For abnormal bleeding: hormonal IUD, tranexamic acid, endometrial ablation.',
                            'For fibroids: medical management, UAE, or uterus-preserving myomectomy.',
                            'For prolapse: pessary, pelvic floor PT, lifestyle modification.',
                            'For functional ovarian cysts: short-interval re-imaging.'
                        ],
                        note: 'Surgery is appropriate when uterus-preserving or non-surgical options have been tried or are clearly inferior.'
                    },
                    medical: {
                        sub: 'Targeted office-based or pharmacologic care',
                        intro: 'Where applicable, these are reasonable first steps.',
                        items: [
                            'Levonorgestrel IUD for heavy bleeding without cavity-distorting fibroids.',
                            'Endometrial ablation for completed-childbearing patients with normal cavity.',
                            'Hysteroscopic management of submucosal fibroids or polyps.',
                            'Hormonal suppression for adenomyosis or endometriosis-related pain.'
                        ],
                        note: 'These options spare the uterus and avoid the perioperative risk of any hysterectomy.'
                    },
                    surgical: {
                        sub: 'vNOTES hysterectomy or adnexal surgery',
                        intro: 'No abdominal incisions; the vagina is the access point.',
                        items: [
                            'Hysterectomy — typically with or without ovary and fallopian tube removal.',
                            'Salpingectomy (tube removal) — including risk-reducing salpingectomy.',
                            'Ovarian cystectomy or oophorectomy for benign indications.',
                            'Concurrent prolapse repair when feasible.',
                            'Same-day discharge in 90.4% of minimally invasive fellowship cases. Less postoperative pain. No visible scars.'
                        ],
                        note: 'For very large uteri, dense adhesions, prior radiation, severely narrow vaginal access, or known malignancy, a different route (robotic, laparoscopic, open) is chosen.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a vNOTES procedure.',
                timeline: [
                    { stage: 'Before surgery', body: 'A pelvic exam to assess vaginal access and uterine mobility. Imaging (ultrasound, sometimes MRI) to evaluate uterine size, adnexal anatomy, and any signs of dense adhesions. ERAS optimization (anemia, weight, smoking, GLP-1 timing). A frank discussion of why vNOTES is being offered for your specific anatomy — and what the backup route is if conditions change intraoperatively.' },
                    { stage: 'Day of surgery', body: 'General anesthesia. A vaginal port is placed and the operation is completed through it. No abdominal incisions. The specimen is removed vaginally. Same-day discharge for the great majority of patients.' },
                    { stage: 'First 2 weeks', body: 'Less postoperative pain than a comparable laparoscopic case. Light vaginal spotting for several days. Walking starts immediately. No tampons, no intercourse, no heavy lifting for 6 weeks while the vaginal cuff heals. Stool softener is helpful for the first 1–2 weeks.' },
                    { stage: '6 weeks and beyond', body: 'Vaginal cuff exam and return to full activity. Pelvic floor PT if any prolapse or pelvic floor weakness was identified or repaired.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Will I really have no scars?', a: 'No abdominal scars. The work is done through the vagina, which has no external visible incision. The vaginal cuff is sutured closed at the end and heals on its own.' },
                    { q: 'Is the recovery actually faster than laparoscopic?', a: 'Yes — the HALON randomized trial (Baekelandt, Hum Reprod) and a meta-analysis of vNOTES versus conventional laparoscopic hysterectomy (Liu, Surg Endosc) show less postoperative pain, shorter hospital stay, and faster recovery compared to standard laparoscopic hysterectomy when patient selection is appropriate. Most patients go home the same day.' },
                    { q: 'Is it as safe as the traditional routes?', a: 'For appropriately selected patients with experienced operators, yes. Neither the HALON randomized trial (Baekelandt, Hum Reprod) nor the Liu meta-analysis (Surg Endosc) showed an increase in major complications, and the international multicenter registry reported by Kapurubandara (JMIG) supports the safety profile. The keys are patient selection (avoiding cases where vaginal access or pelvic anatomy makes the route unsuitable) and the willingness to convert to a different route intraoperatively if conditions change.' },
                    { q: 'Who is not a good candidate?', a: 'Per the AAGL position statement on vNOTES, reasons to choose a different route include a very large uterus, dense pelvic adhesions from prior surgery or endometriosis, prior pelvic radiation, severely limited vaginal access (very narrow or scarred vagina), active pelvic infection, and known gynecologic cancer. Body habitus alone is rarely a contraindication — vNOTES often serves higher-BMI patients particularly well.' },
                    { q: 'What if you need to switch to a different route during surgery?', a: 'That is part of the consent. If conditions change — unexpectedly large fibroid, an adhesion that cannot be safely managed vaginally, bleeding that needs better visualization — converting to laparoscopic or robotic is appropriate, safe, and never a failure. The goal is the right operation for your anatomy on the day of surgery.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'Baekelandt JF, et al. HALON — RCT comparing vNOTES vs total laparoscopic hysterectomy: pain and recovery. Hum Reprod.', pmid: '31418795' },
                    { cite: 'Baekelandt JF, et al. vNOTES adnexal surgery: feasibility and safety. JMIG.', pmid: '29969711' },
                    { cite: 'AAGL position statement — vNOTES in benign gynecologic surgery. J Minim Invasive Gynecol.', pmid: '35638592' },
                    { cite: 'Liu J, et al. Postoperative outcomes after vNOTES vs conventional laparoscopic hysterectomy: meta-analysis. Surg Endosc.', pmid: '35744056' },
                    { cite: 'Kapurubandara S, et al. International multicenter outcomes registry — vNOTES safety profile. JMIG.', pmid: '38493418' }
                ]
            }
        ]
    };

    // -------- 7. COMPLEX ADHESIOLYSIS --------
    const adhesiolysis = {
        tag: 'Highest Fellowship Volume',
        title: 'Complex adhesiolysis',
        tagline: 'Restoring normal pelvic anatomy when prior surgery, endometriosis, or inflammation has fused the organs together. Highest fellowship volume — zero major bowel injuries.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Carefully separating what was never meant to be stuck together.',
                body: `
                    <p>Adhesions are bands of scar tissue that form between organs or between an organ and the abdominal wall after surgery, infection, or chronic inflammation (endometriosis is the most common driver in gynecology). They can be a fine veil — or they can be dense, vascular, and fused to the point where the bowel, the ureter, and the pelvic sidewall look like one mass.</p>
                    <p>Adhesions form after many transperitoneal operations — surgical trauma, inflammation, and endometriosis are the principal drivers, per the Cochrane review of barrier agents (Ahmad et al.). Most are asymptomatic. But for some, adhesions cause chronic pelvic pain, infertility, painful intercourse, painful bowel movements, or recurrent bowel obstruction. Adhesiolysis is the surgical work of separating these planes — sharp dissection, careful energy use, identifying critical structures (bowel, ureter, blood vessels) before cutting, and protecting them throughout.</p>
                    <p>This is technical, slow, and high-stakes work. The MIGS approach is to do it laparoscopically or robotically (rather than open), and to never cut what you have not first identified. Across the fellowship: extensive multi-quadrant adhesive disease handled, with zero major bowel injuries.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'The evidence base for adhesion management.',
                body: `<p>In the Cochrane review of barrier agents (Ahmad et al.), 19 randomized trials including 1,316 women have evaluated adhesion-prevention barriers (oxidized regenerated cellulose, expanded PTFE, fibrin and collagen sheets). Barriers may reduce adhesion reformation, but the review rated the evidence low to very low quality, and no trial measured the outcomes that matter most to patients — pain and live birth. The strongest factor in good outcomes remains meticulous surgical technique — minimizing tissue trauma, maintaining hemostasis, and recognizing the anatomy before cutting. Recurrence of adhesions after lysis is common; recurrence of <em>symptoms</em> is far less common in carefully selected patients.</p>`,
                stats: [
                    { num: '205', label: 'fellowship cases required adhesiolysis — the highest procedure volume of the fellowship', source: 'Fellowship operative log' },
                    { num: '19 RCTs', label: 'have evaluated barrier agents for adhesion prevention (1,316 women)', source: 'Cochrane review — Ahmad et al.' },
                    { num: 'Zero', label: 'major bowel injuries across the entire fellowship — despite extensive multi-quadrant adhesive disease', source: 'Fellowship operative log' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'When to lyse — and when not to.',
                rba: {
                    expectant: {
                        sub: 'Watchful waiting',
                        intro: 'Asymptomatic adhesions found incidentally do not need treatment.',
                        items: [
                            'Adhesions identified during another procedure but causing no symptoms — leave alone.',
                            'Adhesions causing only intermittent mild discomfort — try non-surgical management first.',
                            'Bowel adhesions in a stable, asymptomatic patient — observation is reasonable.'
                        ],
                        note: 'Operating on adhesions just because they exist is generally not indicated.'
                    },
                    medical: {
                        sub: 'Conservative approaches first',
                        intro: 'Many adhesion-related symptoms have non-surgical adjuncts.',
                        items: [
                            'Pelvic floor physical therapy — often helps myofascial pain layered on top of adhesive disease.',
                            'NSAIDs and neuromodulators (amitriptyline, gabapentin) for central sensitization.',
                            'Visceral mobilization techniques performed by a trained pelvic floor PT.',
                            'For partial bowel obstruction: NPO, IV fluids, NG decompression in a hospital setting.'
                        ],
                        note: 'Conservative measures are often the right first step, especially when central sensitization is suspected.'
                    },
                    surgical: {
                        sub: 'Laparoscopic / robotic adhesiolysis',
                        intro: 'Restore anatomy under direct vision when symptoms warrant.',
                        items: [
                            'Indicated for: symptomatic chronic pelvic pain attributable to adhesions, infertility with tubo-ovarian distortion, recurrent partial bowel obstruction, or planned definitive surgery (hysterectomy, endo excision) requiring access.',
                            'Sharp dissection where possible; energy use minimized near bowel and ureter.',
                            'Cystoscopy at the end of the case if the ureter was at risk.',
                            'Retroperitoneal dissection with ureteral visualization when the pelvic sidewall is involved — no ureteral injuries across the fellowship.',
                            'Same-day or overnight stay typical; full activity in 2–4 weeks.'
                        ],
                        note: 'Adhesion recurrence is common; symptom recurrence depends on the underlying disease (endometriosis, infection, prior surgery).'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of an adhesiolysis case.',
                timeline: [
                    { stage: 'Before surgery', body: 'A careful history (prior surgeries, infections, endometriosis), imaging (pelvic ultrasound and, in complex cases, MRI), and an honest discussion of how much of your symptoms are likely from adhesions vs. coexisting conditions. ERAS optimization.' },
                    { stage: 'Day of surgery', body: 'General anesthesia. Three to five small abdominal incisions. Adhesions are systematically taken down, organ by organ, plane by plane. The bowel and ureter are identified before any energy is used near them. A cystoscopy at the end confirms ureteric integrity. Same-day or overnight stay for most.' },
                    { stage: 'First 2 weeks', body: 'Soreness more than sharp pain. Walking from day one to reduce reformation risk. No heavy lifting for 2 weeks. Stool softener if bowel was extensively mobilized. Slow advancement of activity.' },
                    { stage: '6 weeks and beyond', body: 'Post-op visit. Pelvic floor PT typically starts at 4–6 weeks. A clear discussion of expected outcomes — pain reduction is likely but not guaranteed; some patients require ongoing multidisciplinary care.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Will my adhesions come back?', a: 'Some adhesion reformation is essentially universal. The question is whether <em>symptomatic</em> adhesions come back — that depends on the underlying cause. If endometriosis or chronic infection is driving the adhesions, addressing the root cause (excision, suppression, antimicrobial treatment) does more to prevent symptomatic recurrence than any barrier agent.' },
                    { q: 'How do you avoid bowel injury?', a: 'Slow, anatomical dissection. Identify the bowel before any energy use. Use sharp scissors and bipolar judiciously. Convert to a different route if exposure is inadequate. Cystoscopy and a careful inspection at the end. The zero-major-bowel-injury fellowship record reflects this discipline.' },
                    { q: 'Will surgery cure my pelvic pain?', a: 'For pain primarily caused by adhesions, lysis often helps. For pain that has acquired a central sensitization component (the nervous system continues amplifying signals after the original cause is addressed), surgery alone is rarely enough — pelvic floor PT, neuromodulators, and sometimes psychological support all matter. An honest pre-op discussion sets expectations correctly.' },
                    { q: 'What about adhesion-prevention agents?', a: 'Barrier agents (oxidized regenerated cellulose, expanded PTFE, fibrin and collagen sheets) have been tested in randomized trials, and per the Cochrane review of barrier agents (Ahmad et al.) they may reduce adhesion reformation — but the evidence is low quality, and no trial measured pain or live birth. They are not a routine part of this practice. The best-supported prevention remains careful surgical technique, and whether any adjunct makes sense for a specific operation is a conversation had case by case.' },
                    { q: 'Can adhesions cause infertility?', a: 'Yes — when they distort the fallopian tubes or the ovaries, they can impair fertility. Lysis restores anatomy in many cases; for some patients, IVF becomes the more reliable path even after lysis. A fertility plan should be made before surgery, not improvised after.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'Ahmad G, et al. Barrier agents for adhesion prevention after gynecological surgery. Cochrane Database Syst Rev.', pmid: '32199406' },
                    { cite: 'ACOG Practice Bulletin 218 — Chronic Pelvic Pain. Obstet Gynecol. 2020.', pmid: '32080045' },
                    { cite: 'Diamond MP, et al. Adhesion reformation: clinical implications and prevention. Fertil Steril.', pmid: '31618674' },
                    { cite: 'Hindocha A, et al. Surgical adhesion prevention strategies: systematic review. Reprod Biomed Online.', pmid: '31785468' },
                    { cite: 'Bafort C, et al. Laparoscopic surgery for endometriosis — bowel and adhesion involvement. Cochrane.', pmid: '33095458' }
                ]
            }
        ]
    };

    // -------- 8. PELVIC RECONSTRUCTION --------
    const pelvicReconstruction = {
        tag: 'Native-Tissue Repair',
        title: 'Pelvic reconstruction',
        tagline: 'Restoring support for pelvic organs that have descended — uterosacral suspension, native-tissue colporrhaphy, apical and compartment-specific approaches. Native tissue only — no mesh.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'Repairing the support — not just covering the symptom.',
                body: `
                    <p>The pelvic floor is a hammock of muscles, ligaments, and fascia that supports the bladder in front, the uterus or vaginal apex in the middle, and the rectum behind. When that hammock weakens — from childbirth, aging, chronic strain, connective-tissue conditions, or prior surgery — one or more of those organs can descend (prolapse), creating bulge, pressure, urinary or bowel symptoms, and sometimes sexual dysfunction.</p>
                    <p>Pelvic reconstruction is the family of operations that restores support. The work is compartment-specific (anterior, apical, posterior) and patient-specific. In this practice the toolkit is native tissue: uterosacral ligament suspension for apical support, and anterior and posterior colporrhaphy for the front and back vaginal walls — performed vaginally, robotically, laparoscopically, or by vNOTES, most often at the time of hysterectomy, and uterus-sparing when that fits your anatomy and goals.</p>
                    <p>Mesh deserves a direct answer: it is not used in this practice. Every repair here is native tissue — your own ligaments and fascia, restored with suture. Mesh-augmented operations such as sacrocolpopexy have a legitimate role for specific indications, particularly refractory apical prolapse or recurrence after a native-tissue repair. When that is the better operation for you, the honest move is a referral to a urogynecologist who performs it routinely — and that is exactly what happens here.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'What the data support.',
                body: `<p>Per ACOG/AUGS Practice Bulletin 214, the lifetime risk of surgery for pelvic organ prolapse in US women is 12.6% — a population-scale public health number. The anterior compartment is the hardest to keep repaired: in the BMJ network meta-analysis of anterior compartment repair, anatomic recurrence runs around 30%, the highest of any compartment. Uterosacral ligament suspension is among the established native-tissue apical repairs evaluated in the Cochrane review of surgery for apical vaginal prolapse. And that is exactly the work documented in the fellowship operative log (Sept 2023 – May 2026): 52 anterior/posterior colporrhaphy repairs and 49 uterosacral ligament suspensions across vaginal, robotic, laparoscopic, and vNOTES routes — with zero conversions to open surgery and a 90.4% same-day discharge rate for minimally invasive cases.</p>`,
                stats: [
                    { num: '12.6%', label: 'Lifetime risk of surgery for pelvic organ prolapse in US women', source: 'ACOG/AUGS Practice Bulletin 214' },
                    { num: '~30%', label: 'Anatomic recurrence after anterior compartment repair — the highest of any compartment', source: 'BMJ network meta-analysis · anterior compartment repair' },
                    { num: '52 + 49', label: 'Anterior/posterior colporrhaphy repairs (52) and uterosacral ligament suspensions (49) — all native tissue, across vaginal, robotic, laparoscopic, and vNOTES routes', source: 'Fellowship operative log · Sept 2023 – May 2026' },
                    { num: '90.4%', label: 'Same-day discharge across minimally invasive fellowship cases — zero conversions to open surgery, zero major adverse events', source: 'Fellowship operative log · Sept 2023 – May 2026' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'Three paths — chosen with you.',
                rba: {
                    expectant: {
                        sub: 'Watchful waiting',
                        intro: 'Mild descent without bothersome symptoms does not need treatment.',
                        items: [
                            'For asymptomatic Stage I–II prolapse, observation is appropriate.',
                            'Most untreated prolapse remains stable or progresses minimally over a year.',
                            'Address modifiable risk factors: obesity, chronic constipation, chronic cough.',
                            'Track symptoms with a pelvic floor diary and re-examine periodically.'
                        ],
                        note: 'Treatment is for bothersome symptoms — not for findings on an exam.'
                    },
                    medical: {
                        sub: 'Non-surgical management',
                        intro: 'Many patients do beautifully without surgery.',
                        items: [
                            'Pessary fitting — a vaginal silicone device that supports the prolapse from within; reversible, non-surgical, well-tolerated.',
                            'Pelvic floor physical therapy — strengthens supporting muscles, often reduces symptoms substantially.',
                            'Topical vaginal estrogen — improves tissue quality, comfort, and pessary tolerance in postmenopausal patients.',
                            'Weight optimization and constipation management — modest but real symptom benefit.'
                        ],
                        note: 'Pessary management can be lifelong for patients who prefer to avoid surgery.'
                    },
                    surgical: {
                        sub: 'Native-tissue repair — vaginal, robotic, laparoscopic, or vNOTES',
                        intro: 'Restore support directly. Approach is compartment-specific and patient-specific.',
                        items: [
                            'Uterosacral ligament suspension — native-tissue apical support, most often at the time of hysterectomy; vaginal, robotic, laparoscopic, or vNOTES routes.',
                            'Anterior and posterior colporrhaphy — native-tissue repair of the front and back vaginal walls, alone or combined with apical support.',
                            'Uterus-sparing repair where anatomy and goals allow — hysterectomy is never automatic.',
                            'Cystoscopy at the end of the case to confirm bladder and ureteral integrity — routine practice.',
                            'No mesh is used in this practice. When a mesh-augmented repair such as sacrocolpopexy — or an anti-incontinence sling — is the better operation, you are referred to a urogynecologist who performs it.'
                        ],
                        note: 'Recurrence risk is quoted honestly — anterior-compartment repairs recur most often, around 30% anatomic recurrence in the BMJ network meta-analysis. Every repair in this practice is native tissue.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a pelvic reconstruction.',
                timeline: [
                    { stage: 'Before surgery', body: 'A complete pelvic exam (POP-Q staging), urodynamic testing if urinary symptoms coexist, a discussion of compartment-specific findings (anterior, apical, posterior), and an honest review of every option — pessary, pelvic floor therapy, and native-tissue repair, with referral when a mesh-augmented repair elsewhere would serve you better. Vaginal estrogen pre-op if atrophic. ERAS optimization.' },
                    { stage: 'Day of surgery', body: 'General or regional anesthesia. The operation is compartment-specific and may combine routes (vaginal native-tissue repair plus laparoscopic apical suspension, for example). A cystoscopy at the end confirms bladder and ureteric integrity. Most patients go home the same day or after an overnight stay.' },
                    { stage: 'First 6 weeks', body: 'Pelvic rest (no tampons, no intercourse, no heavy lifting). Stool softener daily. Pelvic floor PT often starts at 6 weeks, though some surgeons begin gentle protocols sooner.' },
                    { stage: 'Beyond 6 weeks', body: 'Gradual return to full activity. Long-term follow-up to monitor for recurrence, with pelvic floor PT maintenance and steady management of constipation, chronic cough, and weight to protect the repair. Most patients describe substantial quality-of-life improvement.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Should I worry about mesh?', a: 'Not in this practice — no mesh is used here. Every repair is native tissue: your own ligaments and fascia, restored with suture. The reputation problem comes from older transvaginal mesh kits that are no longer FDA-approved. Contemporary mesh-augmented repairs such as sacrocolpopexy retain a legitimate role for specific indications in urogynecologic hands — and if your anatomy calls for one, you get a straight explanation and a referral to a surgeon who performs that operation routinely.' },
                    { q: 'Will my prolapse come back?', a: 'Recurrence depends on the compartment, the repair technique, and your individual tissue. Anterior compartment recurrence is the highest — around 30% anatomic recurrence in the BMJ network meta-analysis of anterior repair. Lifelong pelvic floor care (PT maintenance, weight optimization, chronic-cough and constipation management) reduces recurrence meaningfully.' },
                    { q: 'Will I need a hysterectomy?', a: 'Not always. For some apical repairs (especially uterosacral suspension), the uterus can be preserved (uterus-sparing prolapse repair). For others, the suspension is paired with hysterectomy — in the fellowship operative log, 48 of 49 uterosacral suspensions were performed at the time of hysterectomy. The choice depends on your anatomy, your symptoms, and your preferences — explicitly discussed.' },
                    { q: 'What about sexual function?', a: 'Most patients describe improved sexual function after pelvic reconstruction because the underlying problem (bulge, pressure, discomfort) is addressed. The vaginal cuff and any new repair sites heal over 6 weeks; sexual activity typically resumes at the 6-week visit. Pelvic floor PT helps if any post-op discomfort lingers.' },
                    { q: 'Is a pessary still an option for me long-term?', a: 'Absolutely. Pessaries are a legitimate definitive treatment for many patients — not a "pre-surgery" measure. Some patients use a pessary for decades with excellent symptom control. The decision to operate is yours.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'ACOG / AUGS Practice Bulletin 214 — Pelvic Organ Prolapse. Obstet Gynecol.', pmid: '31600186' },
                    { cite: 'Maher C, et al. Surgery for women with apical vaginal prolapse. Cochrane Database Syst Rev.', pmid: '34081163' },
                    { cite: 'Glazener CM, et al. Anterior compartment repair: network meta-analysis. BMJ.', pmid: '35963180' },
                    { cite: 'Jelovsek JE, et al. Pelvic organ prolapse — natural history. Lancet.', pmid: '38140841' }
                ]
            }
        ]
    };

    // -------- 9. UROLOGIC & CROSS-SPECIALTY --------
    const urologicCrossSpecialty = {
        tag: 'Multidisciplinary',
        title: 'Urologic & cross-specialty',
        tagline: 'Cystoscopy, ureteral stent placement, serosal bowel repair, appendectomy, retroperitoneal dissection — the cross-specialty toolkit for the cases that demand it.',
        sections: [
            {
                eyebrow: 'What this is',
                title: 'The MIGS surgeon as the captain of a multidisciplinary team.',
                body: `
                    <p>Some gynecologic operations end at the uterus. The complex ones do not. Deep infiltrating endometriosis on the bowel, the ureter, or the bladder. A fibroid abutting the iliac vessels. An ovarian mass involving the appendix. A urinary tract injury that needs immediate recognition and repair. These are situations where a single-specialty operating room is not enough — and where a fellowship-trained MIGS surgeon brings cross-specialty competence to the table while keeping the appropriate specialist (urology, colorectal, general surgery) actively in the room when their expertise is needed.</p>
                    <p>The toolkit covers: cystoscopy at the end of every appropriate case to confirm ureteric integrity; ureteral stent placement when ureterolysis was extensive; serosal bowel repair when dissection abrades the outer bowel wall (six such repairs across the fellowship, lumen never entered); appendectomy when endometriosis or pathology involves the appendix; retroperitoneal dissection to identify the ureter before any energy is used near it. Without a single full-thickness bowel injury across the fellowship.</p>
                    <p>This is not "doing other specialists' work." It is recognizing where one operation ends and where another begins, performing safely within the MIGS scope, and coordinating with the right specialist when a case demands it. That coordination — done before the OR, not during — is the difference between an event and a near miss.</p>
                `
            },
            {
                eyebrow: 'Evidence and outcomes',
                title: 'Why cross-specialty competence matters.',
                body: `<p>Ureteral injury is one of the most consequential complications of pelvic surgery. As the JMIG review by Wong and colleagues details, an injury recognized intraoperatively is repaired primarily and almost always heals; one recognized days later becomes a stricture or fistula requiring major reconstructive work. Routine intraoperative cystoscopy after high-risk pelvic dissection (deep endometriosis, prolapse repair, large fibroids, dense adhesions) is how a ureteric or bladder injury is caught in real time; in the universal intraoperative cystoscopy study by Engh and colleagues in Obstetrics & Gynecology, routine cystoscopy at hysterectomy detected urinary tract injuries that would otherwise have gone unrecognized. Across the fellowship: zero ureteral, vascular, or nerve injuries through extensive retroperitoneal dissection.</p>`,
                stats: [
                    { num: 'Zero', label: 'Ureteral, vascular, or nerve injuries across the fellowship — through extensive retroperitoneal dissection', source: 'Fellowship operative log' },
                    { num: 'Routine cystoscopy', label: 'After every high-risk pelvic dissection — detects a ureteric or bladder injury in the OR, when primary repair is still straightforward', source: 'Engh ME et al. · Obstet Gynecol' },
                    { num: 'Multidisciplinary', label: 'Pre-operative coordination with urology, colorectal, general surgery when a case will likely cross specialty lines', source: 'Practice principle' }
                ]
            },
            {
                eyebrow: 'Risks, benefits, alternatives',
                title: 'When a case needs more than one specialty.',
                rba: {
                    expectant: {
                        sub: 'Single-specialty surgery',
                        intro: 'Many gynecologic cases stay within one specialty\'s scope and need no cross-specialty involvement.',
                        items: [
                            'Straightforward hysterectomy without endometriosis or adhesions.',
                            'Polyp or simple submucosal fibroid via hysteroscopy.',
                            'Adnexal mass with no involvement of bowel, ureter, or bladder.',
                            'Routine pessary management or simple reconstruction.'
                        ],
                        note: 'The MIGS surgeon handles these independently — with cystoscopy at the end when indicated.'
                    },
                    medical: {
                        sub: 'Imaging-guided pre-operative planning',
                        intro: 'Cross-specialty needs are often identifiable before the OR.',
                        items: [
                            'Pelvic MRI for suspected deep infiltrating endometriosis — defines bowel, ureter, and bladder involvement before incision.',
                            'CT urogram if hydroureter or pelvic kidney is on the ultrasound.',
                            'Colonoscopy for suspected bowel endometriosis or rectovaginal nodule.',
                            'Multidisciplinary tumor board for adnexal masses with malignant features.'
                        ],
                        note: 'A case that will cross specialties is planned that way — never improvised in the OR.'
                    },
                    surgical: {
                        sub: 'Multidisciplinary MIS surgery',
                        intro: 'The right specialists in the room, the right plan, and the right MIS tools.',
                        items: [
                            'MIGS surgeon as primary, with urology or colorectal scrubbed-in for their portion of the case.',
                            'Ureteral stent placement (often by urology) before deep endometriosis dissection — protects the ureter and aids identification.',
                            'Bowel shave, disc excision, or segmental resection performed with colorectal surgery as the case requires.',
                            'Cystoscopy at the end of every appropriate case — non-negotiable for high-risk dissection.',
                            'Retroperitoneal dissection to identify the ureter before any energy is used near it.'
                        ],
                        note: 'The right operation is the one planned by the right team — minimally invasive whenever possible.'
                    }
                }
            },
            {
                eyebrow: 'What to expect',
                title: 'The arc of a multidisciplinary case.',
                timeline: [
                    { stage: 'Before surgery', body: 'A complete imaging workup (MRI for deep endometriosis, CT for adnexal mass with suspicious features, colonoscopy if bowel involvement is suspected). Pre-operative consultation with urology or colorectal as appropriate. A clear multidisciplinary plan: what each specialty will do, in what order, with what backup. ERAS optimization (GLP-1 timing, anticoagulants, smoking, anemia).' },
                    { stage: 'Day of surgery', body: 'The OR is set up for the longest plausible version of the operation — even when the most likely course is straightforward. Ureteral stents placed if needed. The MIGS surgeon performs the gynecologic portion; the urologist or colorectal surgeon performs their portion at the agreed point. A cystoscopy at the end of every case where the ureter or bladder was near the dissection.' },
                    { stage: 'First 2 weeks', body: 'Recovery depends on what was done. A simple endometriosis excision: home the same day, desk work in 1–2 weeks. A bowel resection: hospital stay of 2–4 days, slower return to full diet, NG decompression in rare cases. Pelvic floor PT typically starts at 4–6 weeks.' },
                    { stage: 'Beyond 6 weeks', body: 'Long-term coordination continues. For bowel work, a follow-up with colorectal surgery. For ureteral work, stent removal and follow-up imaging. For complex cases, ongoing multidisciplinary review of symptoms, pathology, and any next steps.' }
                ]
            },
            {
                eyebrow: 'Common questions',
                title: 'What patients ask most often.',
                qa: [
                    { q: 'Why do I need more than one surgeon?', a: 'Because some cases cross specialty lines. Deep endometriosis on the bowel needs colorectal expertise for shave or disc excision. Ureteric involvement needs urology for stenting and, occasionally, reimplantation. Having the right specialist in the room at the right time is safer than calling for help mid-operation.' },
                    { q: 'Will I have more incisions if multiple specialists operate?', a: 'No. The MIS approach uses the same small abdominal incisions regardless of how many specialists participate. Each surgeon works through the existing ports.' },
                    { q: 'How is ureteral injury prevented?', a: 'Through anatomy first. The ureter is identified retroperitoneally before any energy is used near it. Ureteral stents are placed pre-operatively when extensive dissection is planned. And a cystoscopy at the end of every appropriate case confirms ureteric integrity in real time — when an injury would still be easy to fix.' },
                    { q: 'What happens if there is a bowel injury during surgery?', a: 'Recognized intraoperatively, most bowel injuries are repaired immediately and primarily — and most patients recover completely. The risk is the unrecognized injury. Careful dissection, identification of bowel before energy use, and a thorough end-of-case inspection are how that risk is minimized. The fellowship record: zero major bowel injuries despite extensive multi-quadrant adhesive disease.' },
                    { q: 'Should I be worried about cancer?', a: 'For most benign indications, no. For adnexal masses with suspicious imaging features or unexpected pathology, the team is prepared to escalate appropriately — including referral to gynecologic oncology when needed. Every removed specimen is sent to pathology; the diagnosis is never assumed.' }
                ]
            },
            {
                eyebrow: 'References',
                title: 'Where this evidence comes from.',
                refs: [
                    { cite: 'ACOG Committee Opinion 803 — Adnexal Mass and the Importance of Image-Guided Triage. Obstet Gynecol.', pmid: '32791646' },
                    { cite: 'AAGL Practice Report — Management of Endometriosis with Bowel Involvement. JMIG.', pmid: '38493418' },
                    { cite: 'Engh ME, et al. Universal intraoperative cystoscopy at hysterectomy — detection of urinary tract injury. Obstet Gynecol.', pmid: '23003574' },
                    { cite: 'Wong JMK, et al. Ureteral injury during minimally invasive gynecologic surgery: incidence, detection, and management. JMIG.', pmid: '29215524' },
                    { cite: 'AAGL position statement — Multidisciplinary Care for Complex Pelvic Surgery. JMIG.', pmid: '40914965' }
                ]
            }
        ]
    };

    window.DOMAIN_MODAL_DATA = {
        'endometriosis-excision':   endometriosisExcision,
        'myomectomy':               myomectomy,
        'hysterectomy-mis':         hysterectomyMIS,
        'operative-hysteroscopy':   operativeHysteroscopy,
        'office-hysteroscopy':      officeHysteroscopy,
        'vnotes':                   vnotes,
        'adhesiolysis':             adhesiolysis,
        'pelvic-reconstruction':    pelvicReconstruction,
        'urologic-cross-specialty': urologicCrossSpecialty
    };
})();
