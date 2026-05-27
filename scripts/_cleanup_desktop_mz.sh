#!/usr/bin/env bash
# One-shot Desktop cleanup of prior-session Claude test artifacts.
# Removes 20 mz_* directories + 1 mz_*.png (~196 MB) from May 20-25 sessions.
# Real user files (EMR docx, FMIGS folders, screen recordings, credentials,
# user's own screenshots) are NOT in the rm patterns and stay untouched.
set -u
cd "$HOME/Desktop" || exit 1

echo "=== about to delete (size · path) ==="
for f in mz_iphone_audit_* mz_iphone_post_compression_* mz_iphone_scroll_* mz_verify_portal_edu_* mz_iphone_bio_*.png ; do
    [ -e "$f" ] || continue
    SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
    echo "  $SIZE  $f"
done

echo ""
echo "=== executing rm -rf ==="
rm -rf mz_iphone_audit_* mz_iphone_post_compression_* mz_iphone_scroll_* mz_verify_portal_edu_* mz_iphone_bio_*.png
echo "rm exit code: $?"

echo ""
echo "=== survivors (none expected) ==="
COUNT=$(ls -1d mz_iphone_audit_* mz_iphone_post_compression_* mz_iphone_scroll_* mz_verify_portal_edu_* mz_iphone_bio_*.png 2>/dev/null | wc -l | tr -d ' ')
echo "mz_* matches remaining: $COUNT"

echo ""
echo "=== final Desktop contents ==="
ls -la "$HOME/Desktop" | head -40
