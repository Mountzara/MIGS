#!/usr/bin/env python3
"""Voice sweep — portal + operational UI copy.

Replaces "Dr. Mabini" in patient-facing operational copy (portal pages, modal
copy, button labels) with intentional, clinician-neutral language. Keeps the
bio/about/cv pages, publication author bylines, footer copyright, admin sign-in
greeting, and JS sender-label code paths untouched (those are appropriate uses).

§0.6 compliant: explicit per-file pattern list with surrounding-context anchors,
backup before write, one file per loop iteration, audit log of every change.
"""
import os
import shutil
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# {file_path_relative: [(old_substring, new_substring), ...]}
# Each pattern carries enough surrounding context to be unique within the file.
PORTAL_SWAPS = {
    "portal/index.html": [
        ("Conversations with Dr. Mabini.", "Conversations with your clinician."),
        ("Track pain, bleeding, sleep, cycle, mood — Dr. Mabini reviews your trends before every visit.",
         "Track pain, bleeding, sleep, cycle, mood — your clinician reviews your trends before every visit."),
        ("Imaging discs, outside records, AAGL reports, and anything Dr. Mabini sends back to you.",
         "Imaging discs, outside records, AAGL reports, and anything the clinician sends back to you."),
        ("Primers from Dr. Mabini", "Patient primers"),
        ("Your intake categorization is in for Dr. Mabini to confirm.",
         "Your intake categorization is in for clinician review."),
        ("Dr. Mabini will reach out directly to confirm what visit type fits best.",
         "The clinician will reach out directly to confirm what visit type fits best."),
        ("Send Dr. Mabini a non-urgent question or pre-visit update anytime.",
         "Send a non-urgent question or pre-visit update anytime."),
        ("Even one symptom is helpful — Dr. Mabini reviews your trend before every visit.",
         "Even one symptom is helpful — your clinician reviews your trend before every visit."),
        ("Dr. Mabini is publishing primers — they will appear here.",
         "Primers are being published — they will appear here."),
        ("Dr. Mabini has lined up reading for you. Click in to start.",
         "Reading has been lined up for you. Click in to start."),
        ("$('edu-title').textContent = 'Primers from Dr. Mabini';",
         "$('edu-title').textContent = 'Patient primers';"),
        ("status === 'reviewed' ? 'Reviewed by Dr. Mabini' : 'Submitted'",
         "status === 'reviewed' ? 'Reviewed by your clinician' : 'Submitted'"),
    ],
    "portal/education/index.html": [
        ("Primers from Dr. Mabini", "Patient primers"),
        ("Anything Dr. Mabini has assigned to you sits at the top.",
         "Anything assigned to you sits at the top."),
        ("No primers in this view yet. Dr. Mabini is building the library.",
         "No primers in this view yet. The library is being built."),
        ("how osteopathic care fits in, and the questions Dr. Mabini gets most often",
         "how osteopathic care fits in, and the most common patient questions"),
        ("The four overlapping layers of CPP (organs, pelvic floor, nerves, fascia), how Dr. Mabini works them up",
         "The four overlapping layers of CPP (organs, pelvic floor, nerves, fascia), how each is worked up"),
        ("Assigned by Dr. Mabini", "Assigned to you"),
        ("Once you've read this through, tap Mark complete so Dr. Mabini sees you finished it.",
         "Once you've read this through, tap Mark complete so your clinician sees you finished it."),
    ],
    "portal/appointments/book/index.html": [
        ("Book your visit with Dr. Mabini", "Book your visit"),
        ("Your intake is in for clinician review. We'll release slots as soon as Dr. Mabini reviews.",
         "Your intake is in for clinician review. Slots release as soon as it's reviewed."),
        ("Your intake needs manual review. Dr. Mabini will reach out with a slot directly.",
         "Your intake needs manual review. The clinician will reach out with a slot directly."),
        ("(adjusted from ${escapeHtml(visitTypeLabel(t.ai_visit_type))} by Dr. Mabini)",
         "(adjusted from ${escapeHtml(visitTypeLabel(t.ai_visit_type))} by your clinician)"),
        ("Your triage requires manual review. Dr. Mabini will reach out directly.",
         "Your triage requires manual review. The clinician will reach out directly."),
    ],
    "portal/documents/index.html": [
        ("Imaging reports, prior records, pre-op forms — upload anything you want Dr. Mabini to see.",
         "Imaging reports, prior records, pre-op forms — upload anything you want your clinician to see."),
    ],
    "portal/intake/index.html": [
        ("'I authorize evaluation and any treatment Dr. Mabini and I agree on after discussion.'",
         "'I authorize evaluation and any treatment my clinician and I agree on after discussion.'"),
        ("'Specific questions for Dr. Mabini'", "'Specific questions for your clinician'"),
        ("'Intake submitted. Dr. Mabini and the office will review it before your visit.'",
         "'Intake submitted. The clinician and the office will review it before your visit.'"),
    ],
    "portal/messages/index.html": [
        ("Messages with Dr. Mabini", "Secure messages with your clinician"),
        ("Messages are encrypted at rest and visible only to Dr. Mabini and authorized staff.",
         "Messages are encrypted at rest and visible only to your clinician and authorized staff."),
        ("? 'You' : 'Dr. Mabini'", "? 'You' : 'Your clinician'"),
        ("? 'Dr. Mabini'", "? 'Your clinician'"),
    ],
    "portal/symptoms/index.html": [
        ("Anything you leave blank stays blank — log only what matters today. Dr. Mabini reviews these trends before every visit, so the data shapes the conversation.",
         "Anything you leave blank stays blank — log only what matters today. Your clinician reviews these trends before every visit, so the data shapes the conversation."),
        ('placeholder="Anything you want Dr. Mabini to know in context',
         'placeholder="Anything you want your clinician to know in context'),
    ],
}


def sweep_file(rel_path, swaps):
    path = os.path.join(REPO, rel_path)
    if not os.path.exists(path):
        return None
    txt = open(path).read()
    orig = txt
    n_changes = 0
    misses = []
    for old, new in swaps:
        c = txt.count(old)
        if c:
            txt = txt.replace(old, new)
            n_changes += c
        else:
            misses.append(old[:70])
    if txt == orig:
        return {"path": rel_path, "changes": 0, "misses": misses}
    backup = path + ".pre-voice-sweep.html"
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
    open(path, "w").write(txt)
    # Count remaining Mabini occurrences
    remaining = len(re.findall(r"Mabini", txt))
    return {"path": rel_path, "changes": n_changes, "misses": misses, "remaining": remaining, "backup": backup}


def main():
    print("Portal + operational voice sweep")
    print("=" * 70)
    for rel_path, swaps in PORTAL_SWAPS.items():
        r = sweep_file(rel_path, swaps)
        if r is None:
            print(f"  ❌ {rel_path}: file not found")
            continue
        if r["changes"] == 0:
            print(f"  {rel_path}: no changes (patterns didn't match — review needed)")
            for m in r["misses"]:
                print(f"    miss: '{m}...'")
            continue
        print(f"  ✓ {rel_path}: {r['changes']} swaps, {r.get('remaining', 0)} Mabini occurrences remaining")
        if r["misses"]:
            for m in r["misses"]:
                print(f"    miss: '{m}...'")


if __name__ == "__main__":
    main()
