#!/usr/bin/env bash
# Quick check: what's in the R2 posts queue today + which kind they're tagged.
set -euo pipefail
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')

echo "== All posts =="
curl -sS -u "${ADMIN_USER}:${ADMIN_PASS}" 'https://mountzara.com/api/posts/?limit=100' 2>&1 \
    | python3 << 'PY'
import json, sys
d = json.load(sys.stdin)
posts = d.get("posts", [])
print(f"Total: {len(posts)}")
print()
print(f"{'kind':9s} {'status':10s} {'id':62s} | title")
print("-" * 130)
for p in posts:
    kind = p.get("kind", "?")
    status = p.get("status", "?")
    pid = p.get("id", "?")
    title = (p.get("title") or "")[:70]
    print(f"{kind:9s} {status:10s} {pid:62s} | {title}")

# Today filter
import datetime
today = datetime.date.today().isoformat()
today_posts = [p for p in posts if (p.get("created_at") or "").startswith(today) or (p.get("id","").find(today) >= 0)]
print()
print(f"== Posts whose id or created_at contains today ({today}) ==")
for p in today_posts:
    print(f"  {p.get('kind')}  {p.get('status')}  {p.get('id')}  {p.get('title','')[:80]}")
PY
