#!/bin/bash
# =====================================================================
# scripts/_backup_d1_to_r2.sh — D1 snapshot to R2 (operator-runnable)
# =====================================================================
# Per CLAUDE.md §11 Tier 7. Exports the mountzara-clinical D1 database
# to a UTC-dated R2 object in the dedicated mountzara-backups bucket.
# Daily snapshot + 14-rotation retention. Quarterly restore drill.
#
# What it does:
#   1. Run `wrangler d1 export` to produce a portable SQL dump.
#   2. Gzip the dump locally.
#   3. PUT the dump to r2://mountzara-backups/d1/<UTC-date>.sql.gz
#      (a separate R2 bucket from mountzara-phi so the same blast radius
#       can't take both out).
#   4. List the bucket, retain the 14 most-recent, delete older snapshots.
#
# Prereqs:
#   - CLOUDFLARE_API_TOKEN (already in macOS Keychain item
#     'mountzara-cloudflare-deploy-token').
#   - CLOUDFLARE_ACCOUNT_ID hardcoded from CLAUDE.md §9.0.
#   - A `mountzara-backups` R2 bucket. If it does not exist this script
#     creates it on first run.
#
# Run interactively:    scripts/_backup_d1_to_r2.sh
# Run via cron + at:    add a launchd or at-job that invokes this nightly.
# Run via Cloudflare cron-triggers: future Round B will provide a
#   Workers cron equivalent so we don't depend on the operator Mac being
#   awake. For now the operator-runnable form is enough for §11 Tier 7.
# =====================================================================
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export CLOUDFLARE_API_TOKEN=$(/usr/bin/security find-generic-password -s 'mountzara-cloudflare-deploy-token' -w)
export CLOUDFLARE_ACCOUNT_ID='8fbe127f640681ddd813aaf33b95507f'

DB='mountzara-clinical'
BUCKET='mountzara-backups'
RETENTION=14
DATE=$(/bin/date -u +%Y-%m-%d)
TS=$(/bin/date -u +%Y-%m-%dT%H-%M-%SZ)
TMPDIR=$(mktemp -d -t mz_d1_backup)
trap "rm -rf $TMPDIR" EXIT

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------
# Ensure the backup bucket exists.
# ---------------------------------------------------------------------
EXISTS=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("success", False))' 2>/dev/null)
if [ "$EXISTS" != "True" ]; then
    echo "[setup] Bucket $BUCKET does not exist — creating…"
    curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "{\"name\":\"$BUCKET\"}" | /usr/bin/python3 -m json.tool | head -10
fi

# ---------------------------------------------------------------------
# Export D1.
# ---------------------------------------------------------------------
DUMP="$TMPDIR/$DB-$TS.sql"
echo "[1/3] Exporting D1 $DB to $DUMP"
npx --yes wrangler@latest d1 export "$DB" --remote --output "$DUMP" 2>&1 | tail -5
if [ ! -s "$DUMP" ]; then
    echo "ERROR: D1 export produced empty file." >&2
    exit 1
fi
DUMPSIZE=$(/usr/bin/stat -f%z "$DUMP")
echo "  exported $DUMPSIZE bytes"

# Gzip.
gzip -9 "$DUMP"
DUMPGZ="$DUMP.gz"
GZSIZE=$(/usr/bin/stat -f%z "$DUMPGZ")
echo "  gzipped to $GZSIZE bytes"

# ---------------------------------------------------------------------
# Upload to R2.
# ---------------------------------------------------------------------
R2KEY="d1/$DATE.sql.gz"
echo "[2/3] Uploading to r2://$BUCKET/$R2KEY"
npx --yes wrangler@latest r2 object put "$BUCKET/$R2KEY" --file "$DUMPGZ" --content-type 'application/gzip' --remote 2>&1 | tail -3
echo "  uploaded"

# ---------------------------------------------------------------------
# Retention — keep most-recent N, drop older.
# ---------------------------------------------------------------------
echo "[3/3] Pruning to last $RETENTION snapshots"
LIST=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/objects?prefix=d1/&per_page=100" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
KEYS=$(echo "$LIST" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); objs=d.get("result",[]); objs.sort(key=lambda o: o.get("key",""), reverse=True); [print(o["key"]) for o in objs]')
TOTAL=$(echo "$KEYS" | grep -c . || echo 0)
echo "  $TOTAL snapshots present"
if [ "$TOTAL" -gt "$RETENTION" ]; then
    echo "$KEYS" | tail -n +$((RETENTION + 1)) | while read -r OLD; do
        if [ -n "$OLD" ]; then
            curl -sS -X DELETE "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/objects/$OLD" \
                -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" > /dev/null
            echo "  deleted $OLD"
        fi
    done
fi

echo
echo "Backup complete: r2://$BUCKET/$R2KEY ($GZSIZE bytes)"

# ---------------------------------------------------------------------
# Restore drill (operator runs manually):
#   1. Get the snapshot:
#        curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/objects/d1/<DATE>.sql.gz" \
#            -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | gunzip > /tmp/restore.sql
#   2. Create a scratch D1 (mountzara-clinical-restore) via wrangler.
#   3. wrangler d1 execute mountzara-clinical-restore --remote --file=/tmp/restore.sql
#   4. Validate row counts against the live DB. SELECT COUNT(*) per table.
#   5. Drop the scratch DB when done.
# Quarterly drill expected per §11 Tier 7.
# =====================================================================
