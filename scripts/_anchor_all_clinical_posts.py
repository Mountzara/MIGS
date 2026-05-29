#!/usr/bin/env python3
"""DEPRECATED — DO NOT INVOKE.

This script was a legacy KB anchor patcher from the pre-§0.8.1 verify_kb_anchoring.py codification era of the MountZara content
pipeline. The MountZara codebase audit on 2026-05-26 flagged it as a
fence-off candidate because it could produce content that violates the
latest CLAUDE.md §0.4.1 / §3.7.1 / §3.8 / §3.9 / §3.10 / §3.12 hard rules
if invoked today. Canonical replacement: scripts/verify_kb_anchoring.py (deploy-gate verifier, not a patcher — anchors live in cite_audit/page_anchors.json and are applied via scripts/cite_audit_apply.py).

If you have a reason to read this file (e.g. recover a prior render
shape, audit a pre-2026-05-26 intermediate state), open it in an editor
rather than executing it.

To restore execution, remove this guard AND ensure the file's output
passes `scripts/regression_audit.py --body-html` or `--post-json`
against the latest CLAUDE.md hard-rule set before any R2 PUT."""

import sys as _sys
_sys.stderr.write(
    "\n!! DEPRECATED LEGACY SCRIPT — refusing to run.\n"
    "!! See module docstring for the canonical replacement.\n"
    "!! File: /Users/beans/Developer/MountZara/MIGS/scripts/_anchor_all_clinical_posts.py\n\n"
)
_sys.exit(2)


"""
Inject §0.8.1 KB-anchor manifests into ALL shipped clinical posts in
mountzara-content R2. Writes posts/<id>.json directly via wrangler r2
object put (admin /api/posts PUT is broken with a separate 500 — that's
filed as task #193).

Posts handled:
  - blog-2026-W20  (MIGS Monday Morning) -- already done by _anchor_w20
  - evidence-2026-05-13-h1-and-h2-antihistamines-treat-endometriosis-pain
  - evidence-2026-05-13-glp-1-receptor-agonists-reduce-endometriosis-lesion-burden
  - evidence-2026-05-13-antihistamines-improve-menopausal-vasomotor-symptoms

For each post:
  1. Fetch via public GET /api/posts/<id>
  2. Walk KB topicSyntheses to find every endo / menopause / antihistamine /
     adjacent topic that's relevant
  3. Pull every PMID currently in pmids_cited (already-verified per §3.7)
  4. Build a §0.8 manifest and append to body_html
  5. wrangler r2 object put the updated post back
"""

import json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone

KB = "/Users/beans/Developer/MountZara/MountZaraMedicalTranscription/kb_chunks"

POSTS_AND_TOPIC_HINTS = {
    "evidence-2026-05-13-h1-and-h2-antihistamines-treat-endometriosis-pain": [
        ("Endometriosis", "endometriosis"),
        ("Chronic Pelvic Pain", "chronic pelvic pain"),
        ("Dysmenorrhea", "dysmenorrhea"),
    ],
    "evidence-2026-05-13-glp-1-receptor-agonists-reduce-endometriosis-lesion-burden": [
        ("Endometriosis", "endometriosis"),
        ("Chronic Pelvic Pain", "chronic pelvic pain"),
    ],
    "evidence-2026-05-13-antihistamines-improve-menopausal-vasomotor-symptoms": [
        ("Menopause", "menopause"),
        ("Preventive Health Screening", "preventive health"),
        ("Bone Loss and Osteoporosis", "bone loss"),
    ],
}

def fetch(id_):
    out = subprocess.check_output(
        ["curl", "-sS", "-A", "MountZara/§0.8 Anchor 1.0",
         f"https://mountzara.com/api/posts/{id_}"]
    )
    return json.loads(out)

def load_syn():
    with open(os.path.join(KB, "02_topicSyntheses.json")) as f:
        return json.load(f)

def find_synthesis(syn, term):
    term = term.lower()
    for t in syn:
        if term in (t.get("topicName", "").lower()):
            return t
    return None

def r2_put(key, file_path):
    res = subprocess.run(
        ["npx", "--yes", "wrangler@latest", "r2", "object", "put",
         f"mountzara-content/{key}",
         f"--file={file_path}",
         "--content-type=application/json",
         "--remote"],
        capture_output=True, text=True,
    )
    return res.returncode == 0, res.stdout + res.stderr


def main():
    syn = load_syn()
    results = []
    for post_id, hints in POSTS_AND_TOPIC_HINTS.items():
        print(f"\n=== {post_id} ===")
        try:
            post = fetch(post_id)
        except Exception as e:
            print(f"  FETCH FAILED: {e}")
            results.append((post_id, False, str(e)))
            continue
        body = post.get("body_html", "")
        kb_anchors = []
        for label, term in hints:
            t = find_synthesis(syn, term)
            if t:
                kb_anchors.append({
                    "label": label,
                    "topic_synthesis_id": t.get("id"),
                    "topicName": t.get("topicName"),
                    "related_document_count": len(t.get("relatedDocumentIds") or []),
                })
        manifest = {
            "spec": "§0.8.1 KB-anchor manifest (CLAUDE.md)",
            "post_id": post_id,
            "post_kind": post.get("kind"),
            "post_title": post.get("title"),
            "topic_groups_anchored": kb_anchors,
            "pmids_efetched_per_card": post.get("pmids_cited") or [],
            "pmid_count": len(post.get("pmids_cited") or []),
            "user_docx_sources": [],
            "not_in_kb_claims": [
                "Synthesis prose is written in the across-the-evidence voice; per-claim stats come from the verified PubMed efetch abstracts already in pmids_cited (§3.7).",
                "Mechanistic claims about histamine receptor signaling are mechanism-of-action narrative grounded in the per-card papers, not in the gynecology-focused JSON KB.",
            ],
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        body = re.sub(r"<!--\s*§0\.8 KB-anchor manifest[\s\S]*?-->", "", body)
        body = body.rstrip() + "\n\n<!-- §0.8 KB-anchor manifest\n" + json.dumps(manifest, indent=2) + "\n-->\n"
        post["body_html"] = body
        post["kb_entries_retrieved"] = [a["topic_synthesis_id"] for a in kb_anchors if a.get("topic_synthesis_id")]
        post["updated_at"] = datetime.now(timezone.utc).isoformat()
        # Write to temp and PUT to R2
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
            json.dump(post, tf, indent=2)
            tmp = tf.name
        ok, output = r2_put(f"posts/{post_id}.json", tmp)
        os.unlink(tmp)
        if ok:
            print(f"  ✓ uploaded. body now {len(body):,} chars, {len(kb_anchors)} KB topic anchors, {len(post.get('pmids_cited') or [])} PMIDs")
            results.append((post_id, True, None))
        else:
            print(f"  ✗ R2 PUT FAILED:\n{output[-400:]}")
            results.append((post_id, False, output[-200:]))

    print("\n=== SUMMARY ===")
    for pid, ok, err in results:
        print(f"  {'✓' if ok else '✗'} {pid}{' — ' + err if err else ''}")
    sys.exit(0 if all(r[1] for r in results) else 1)

if __name__ == "__main__":
    main()
