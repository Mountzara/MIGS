# -*- coding: utf-8 -*-
"""
w23_w24_offtopic_manifest.py — off-topic papers identified by individual
title+abstract review in the draft posts blog-2026-W23 and blog-2026-W24.

WHY A MANUAL MANIFEST: the §1.2b subspecialty-relevance gate passes nearly all
of these because the newer pipeline writes an auto-generated "Monday-clinic
framing" sentence into each card that name-drops gynecologic terms (e.g.
"Every cesarean scar reorganizes…", "mediators traditional gynecology rarely…")
to justify the paper's inclusion. That framing is exactly the classification
artifact the gate strips for cite labels — but here it lives in the card body,
so the keyword anchors match and the gate is blind. A human title+abstract read
is the only reliable filter, as it was for the W20 rhinoplasty paper.

Each entry: PMID -> short reason. Adjudicated by reading the verbatim abstract.
Borderline-but-kept papers are NOT listed here.
"""

W23_OFFTOPIC = {
    "42210897": "dermatology — cosmetic outcome of postsurgical facial scars",
    "42195168": "dermatology — surgical excision/adjuvant therapy for keloids",
    "42195064": "pediatric nephrology/urology — kidney scarring after febrile UTI",
    "42187001": "plastic surgery — skin retraction after laser liposuction/lipolysis",
    "42183685": "dermatology — silicone gels for hypertrophic scars",
    "42216342": "plastic surgery — anterolateral thigh free-flap ICG perfusion",
    "42204046": "urology — robotic prostate-cancer surgery (eye-hand coordination)",
    "42196473": "neurosurgery — fluorescent probes for glioblastoma/brain tumors",
    "42192608": "ophthalmology — ICG angiography/eplerenone, central serous chorioretinopathy",
    "42213691": "GI oncology/epidemiology — BMI trajectories and gastric-cancer risk",
    "42216386": "ophthalmology — amniotic membrane for fat-adherence syndrome",
    "42212370": "dermatology/plastic — epigenetics of cutaneous-fibrosis scar formation",
    "42195251": "general surgery — contrast timing in small-bowel obstruction",
    "42192607": "ophthalmology — anti-VEGF response analysis (135 eyes)",
    "42178533": "ENT/surgical oncology — EpCAM NIR antibodies in head & neck SCC",
    "42213185": "veterinary — rFSH/eCG ovarian response in guinea pig",
    "42204934": "men's health — testosterone replacement + exercise in hypogonadal men",
    "42181197": "endocrine genetics — INSR-variant hyperinsulinemic hypoglycemia syndromes",
    "42208006": "general oncology — broad early-onset-cancer survivorship review (not gyn-specific)",
}

W24_OFFTOPIC = {
    "42226083": "dermatology/plastic — MSC exosomal miR-29a-3p for hypertrophic scar",
    "42220969": "neurology/neurosurgery — MRgFUS thalamotomy for essential tremor",
    "42220967": "neurology/neurosurgery — tremor recurrence after MRgFUS thalamotomy",
    "42223723": "plastic surgery — breast-reconstruction decision-making (breast cancer)",
    "42222069": "musculoskeletal/osteoimmunology — whole-body-vibration bone remodeling",
    "42237957": "publishing notice — Expression of Concern (not a research study)",
    "42223563": "breast-cancer epidemiology — estrogen exposure & breast-cancer subtype",
}
