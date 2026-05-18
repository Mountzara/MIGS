#!/usr/bin/env bash
# One-off comprehensive health sweep — invoked from osascript via bash.
# Safe to delete after the sweep run.
set -e
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
source /Users/beans/.config/mountzara/cf-creds.env
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')

echo '=== R2 backup cron firing? ==='
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/mountzara-backups/objects" \
  -G --data-urlencode 'per_page=5' --data-urlencode 'prefix=d1/' \
  > /tmp/_mz_backups.json
python3 -c '
import json
d=json.load(open("/tmp/_mz_backups.json"))
if not d.get("success"):
    print(" API error:", d.get("errors"))
else:
    r = d["result"]
    objs = r if isinstance(r, list) else r.get("objects", [])
    print(" found:", len(objs))
    for o in objs[:5]:
        print(" ", o.get("key","?"), "  ", o.get("size",0), "bytes  ", o.get("uploaded",""))
'

echo ''
echo '=== admin/cases/[patient_id]/whats-new endpoint ==='
JANE=$(curl -sS -u "$ADMIN_USER:$ADMIN_PASS" 'https://mountzara.com/api/v1/admin/patients' \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
ps=d.get("patients") or d.get("results") or []
print(next((p["id"] for p in ps if p.get("first_name")=="Jane"), ""))')
echo " Jane Doe id: $JANE"
if [ -n "$JANE" ]; then
  curl -sS -u "$ADMIN_USER:$ADMIN_PASS" "https://mountzara.com/api/v1/admin/cases/$JANE/whats-new" -w '\nHTTP %{http_code}\n' | head -c 800
fi

echo ''
echo '=== KB anchoring verifier (all 12 education pages) ==='
cd /Users/beans/Developer/MountZara/MIGS
PASS=0; FAIL=0; FAILED_LIST=()
for slug in endometriosis chronic-pelvic-pain abnormal-uterine-bleeding adenomyosis dysmenorrhea fibroids menopause pcos ovarian-masses postoperative-recovery contraception pregnancy-loss; do
  if python3 scripts/verify_kb_anchoring.py "education/$slug/index.html" > /tmp/_mz_kb.out 2>&1; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    FAILED_LIST+=("$slug")
  fi
done
echo " KB-anchored education pages: $PASS / 12"
if [ ${#FAILED_LIST[@]} -gt 0 ]; then echo " FAIL: ${FAILED_LIST[*]}"; fi

echo ''
echo '=== git sync status ==='
git fetch origin --quiet
git rev-list --left-right --count HEAD...origin/HEAD | awk '{print " local ahead: "$1"   behind: "$2}'
echo " uncommitted files: $(git status --short | wc -l | tr -d ' ')"
