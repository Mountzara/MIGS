// =====================================================================
// brand.js — the practice's visual identity, in one place
// =====================================================================
// Extracted from MZ_Signature.html (his own email signature), so email
// templates, the portal and the membership pages all render the same
// practice rather than threeapproximations of it.
//
// The mark is available two ways because email clients differ: inline SVG
// stays sharp at any zoom and is what Apple Mail renders through WebKit;
// the PNG is the fallback for clients that strip SVG (notably Outlook).
// =====================================================================

export const BRAND = {
    plum:   "#5A2350",       // the accent throughout the signature
    ink:    "#16161c",       // body text
    muted:  "#6b6b78",       // secondary text
    hair:   "#e4e4ec",       // rules and borders
    paper:  "#fafafc",       // page ground
    white:  "#ffffff",
    font:   "'Helvetica Neue', Helvetica, Arial, sans-serif",
    mark_svg: "/assets/brand/mz-signature-mark.svg",
    mark_png: "/assets/brand/mz-signature-mark.png",
};

export const SIGNATURE = {
    name:        "Christopher Z. Mabini, DO, MSAEd",
    title:       "Fellowship-Trained Complex Benign Gynecologic (CBG) Surgeon",
    title_note:  "(formerly MIGS)",
    email:       "cmabini@mountzara.com",
    phone:       "(714) 944-8584",
    site:        "mountzara.com",
    lines: [
        "Women\u2019s Health \u00b7 Complex Benign Gynecology",
        "Minimally Invasive Gynecologic Surgery",
        "Clinical AI Software \u00b7 Education",
        "Osteopathic Manual Therapy",
    ],
};

/** The signature block as email-safe HTML, matching his own. */
export function signatureHtml({ absoluteBase = "https://mountzara.com" } = {}) {
    const B = BRAND, S = SIGNATURE;
    return `<table cellpadding="0" cellspacing="0" border="0" style="font:13px/1.6 ${B.font};color:${B.ink};">
  <tr><td style="padding-bottom:10px;">
    <img src="${absoluteBase}${B.mark_png}" width="150" height="60" alt="Mount Zara" style="display:block;border:0;">
  </td></tr>
  <tr><td style="font-weight:600;color:${B.ink};">${S.name}</td></tr>
  <tr><td style="color:${B.muted};padding-bottom:8px;">${S.title} ${S.title_note}</td></tr>
  <tr><td style="color:${B.muted};padding-bottom:8px;">
    <a href="mailto:${S.email}" style="color:${B.plum};text-decoration:none;">${S.email}</a>
    &nbsp;|&nbsp; ${S.phone} &nbsp;|&nbsp;
    <a href="https://${S.site}" style="color:${B.plum};text-decoration:none;">${S.site}</a>
  </td></tr>
  <tr><td style="color:${B.muted};font-size:12px;border-top:1px solid ${B.hair};padding-top:8px;">
    ${S.lines.join("<br>")}
  </td></tr>
</table>`;
}

export default { BRAND, SIGNATURE, signatureHtml };
