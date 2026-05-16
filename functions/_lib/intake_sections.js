// =====================================================================
// functions/_lib/intake_sections.js — canonical 19-section keys
// =====================================================================
// Single source of truth for the section catalog used by the patient
// intake API and frontend wizard. Adding/renaming a section requires a
// change here AND a thoughtful look at the existing intake_section_data
// rows (since section_key is stored alongside section_number).
//
// Section 3 is "Office Use Only" — clinician-filled at the visit, not
// patient-facing. The frontend wizard skips it; the API rejects
// patient-side writes to it.
// =====================================================================

export const SECTIONS = [
    { n: 1,  key: "patient_information",          patient: true,  label: "Patient Information" },
    { n: 2,  key: "consent",                      patient: true,  label: "Consent" },
    { n: 3,  key: "office_use_only",              patient: false, label: "Office Use Only" },
    { n: 4,  key: "chief_gynecologic_complaint",  patient: true,  label: "Chief Gynecologic Complaint" },
    { n: 5,  key: "detailed_menstrual_history",   patient: true,  label: "Detailed Menstrual History" },
    { n: 6,  key: "previous_gyn_treatments",      patient: true,  label: "Previous Gyn Treatments" },
    { n: 7,  key: "previous_gyn_surgeries",       patient: true,  label: "Previous Gyn Surgeries" },
    { n: 8,  key: "fertility_and_pregnancy",      patient: true,  label: "Fertility & Pregnancy" },
    { n: 9,  key: "sexual_function",              patient: true,  label: "Sexual Function" },
    { n: 10, key: "relevant_imaging",             patient: true,  label: "Relevant Imaging" },
    { n: 11, key: "gi_gu_symptoms",               patient: true,  label: "GI / GU Symptoms" },
    { n: 12, key: "medical_history_eras",         patient: true,  label: "Medical History & ERAS" },
    { n: 13, key: "current_medications",          patient: true,  label: "Current Medications" },
    { n: 14, key: "allergies",                    patient: true,  label: "Allergies" },
    { n: 15, key: "family_gyn_history",           patient: true,  label: "Family Gyn History" },
    { n: 16, key: "social_history",               patient: true,  label: "Social History" },
    { n: 17, key: "mental_health_screening",      patient: true,  label: "Mental Health" },
    { n: 18, key: "social_determinants",          patient: true,  label: "Social Determinants" },
    { n: 19, key: "review_of_systems",            patient: true,  label: "Review of Systems" },
];

export function sectionByNumber(n) {
    return SECTIONS.find(s => s.n === Number(n)) || null;
}

export const PATIENT_SECTIONS = SECTIONS.filter(s => s.patient);

export const TOTAL_PATIENT_SECTIONS = PATIENT_SECTIONS.length;
