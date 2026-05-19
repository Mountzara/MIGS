#!/usr/bin/env bash
# §3.10 regression-risk audit — confirms the live mountzara.com mirrors the
# local working tree we just committed. Run after every static-asset deploy.
set -euo pipefail

echo '=== LIVE SITE CONSISTENCY (mountzara.com) ==='
echo ''
echo '[apex HEAD]'
curl -sS -I https://mountzara.com/ | head -1

echo ''
echo '[apex / sample greps]'
HTML=$(curl -sS https://mountzara.com/)
printf '   %-32s : %s\n' '#6d28d9 (purple primary)'      "$(printf '%s' "$HTML" | grep -c '#6d28d9' || true)"
printf '   %-32s : %s\n' '--glow-purple (var)'            "$(printf '%s' "$HTML" | grep -c -- '--glow-purple' || true)"
printf '   %-32s : %s\n' 'rgba(167, 139, 250 (soft purp)' "$(printf '%s' "$HTML" | grep -c 'rgba(167, 139, 250' || true)"
echo ''
echo '   FORBIDDEN blues — must each be 0:'
for tok in '#0066cc' '#0a84ff' '#3b82f6' '#2563eb'; do
    n=$(printf '%s' "$HTML" | grep -c "$tok" || true)
    if [ "$n" = '0' ]; then
        printf '   ✓  %-30s : 0\n' "$tok"
    else
        printf '   ✗  %-30s : %s  REGRESSION\n' "$tok" "$n"
    fi
done

echo ''
printf '   %-32s : %s\n' "'Nunito Sans'"                   "$(printf '%s' "$HTML" | grep -c "Nunito Sans" || true)"
printf '   %-32s : %s\n' "'Avenir Next'"                   "$(printf '%s' "$HTML" | grep -c "Avenir Next" || true)"
printf '   %-32s : %s\n' "linkedin.com/in/mzllc"           "$(printf '%s' "$HTML" | grep -c "linkedin.com/in/mzllc" || true)"
printf '   %-32s : %s\n' '/evidence/ nav link'             "$(printf '%s' "$HTML" | grep -c 'href="/evidence/' || true)"
printf '   %-32s : %s\n' '/trending/ nav link'             "$(printf '%s' "$HTML" | grep -c 'href="/trending/' || true)"
printf '   %-32s : %s\n' 'heroKenBurnsSlow 45s'            "$(printf '%s' "$HTML" | grep -c 'heroKenBurnsSlow 45s' || true)"
printf '   %-32s : %s\n' 'backdrop blur(28px) sat(180%)'   "$(printf '%s' "$HTML" | grep -c 'backdrop-filter: blur(28px) saturate(180%)' || true)"
printf '   %-32s : %s\n' 'monogram refs (loader + nav)'    "$(printf '%s' "$HTML" | grep -c 'monogram' || true)"
printf '   %-32s : %s\n' 'rpoc-arcuate video card'         "$(printf '%s' "$HTML" | grep -c 'rpoc-arcuate' || true)"
printf '   %-32s : %s\n' 'openVideoModal fn'               "$(printf '%s' "$HTML" | grep -c 'openVideoModal' || true)"

echo ''
echo '[about/ HEAD + bio opacity:0 stagger]'
ABOUT=$(curl -sS https://mountzara.com/about/)
echo "  about/ size: $(printf '%s' "$ABOUT" | wc -c | xargs) chars"
printf '   %-32s : %s\n' "'opacity: 0' initial states"     "$(printf '%s' "$ABOUT" | grep -c 'opacity: 0' || true)"

echo ''
echo '[admin/ HEAD with Basic Auth]'
ADMIN_PASS=$(security find-generic-password -s mountzara-admin-password -w)
ADMIN_USER=$(grep '^Username:' ~/Desktop/MountZara_Admin_Credentials.txt | sed 's/^Username: *//')
curl -sS -I -u "$ADMIN_USER:$ADMIN_PASS" https://mountzara.com/admin/ | head -1

echo ''
echo '[curriculum/cbg-migs/ HEAD]'
curl -sS -I https://mountzara.com/curriculum/cbg-migs/ | head -1

echo ''
echo '[evidence/ HEAD]'
curl -sS -I https://mountzara.com/evidence/ | head -1

echo ''
echo '[trending/ HEAD]'
curl -sS -I https://mountzara.com/trending/ | head -1

echo ''
echo '[portal/ HEAD — should be admin-gated Coming Soon for public]'
curl -sS -I https://mountzara.com/portal/ | head -1

echo ''
echo '✓ §3.10 live-site regression audit complete.'
