#!/usr/bin/env bash
# =====================================================================
# scripts/_lib_admin_auth.sh — canonical admin-auth resolver
# =====================================================================
# Source from any operator script that needs admin Basic Auth:
#
#   source "$(dirname "$0")/_lib_admin_auth.sh"
#   resolve_admin_auth   # sets MZ_ADMIN_USER + MZ_ADMIN_PASS
#
# Eliminates the recurring "password not in Keychain → 401 → ask user"
# failure pattern documented in the user's 2026-05-19 directive:
#   "can we fucking get this password bullshit right and fixed?"
#
# The function:
#   1. Hardcodes ADMIN_USER to chris.mabini@gmail.com (matches the value
#      set by scripts/_reset_admin_password_node.sh line 61). Do NOT
#      default to "admin" — that has been the wrong value for months.
#   2. Resolves the password through a deterministic fallback chain:
#        a. macOS Keychain entry 'mountzara-admin-password'
#        b. pbpaste (clipboard — §9.8.1 ad-hoc paste convention)
#        c. ADMIN_PASS_ENV environment variable
#   3. Pre-flights the resolved credentials against /api/posts/_admin
#      (an existing admin-only endpoint) so a wrong password fails loud
#      with a specific diagnostic instead of cascading into "all admin
#      endpoints are returning 401" confusion.
#   4. Self-heals: if the password came from clipboard or env, writes
#      it into Keychain so the next session hits the fast path with no
#      user involvement.
# =====================================================================

# The single source of truth for the admin username.
export MZ_ADMIN_USER_CANONICAL="chris.mabini@gmail.com"

resolve_admin_auth() {
    local base_url="${1:-https://mountzara.com}"

    MZ_ADMIN_USER="${ADMIN_USER:-$MZ_ADMIN_USER_CANONICAL}"

    local source="keychain"
    MZ_ADMIN_PASS="$(security find-generic-password -s mountzara-admin-password -w 2>/dev/null || true)"

    if [ -z "$MZ_ADMIN_PASS" ]; then
        MZ_ADMIN_PASS="$(pbpaste 2>/dev/null || true)"
        source="pbpaste"
    fi
    if [ -z "$MZ_ADMIN_PASS" ] && [ -n "${ADMIN_PASS_ENV:-}" ]; then
        MZ_ADMIN_PASS="$ADMIN_PASS_ENV"
        source="env"
    fi
    if [ -z "$MZ_ADMIN_PASS" ]; then
        echo "ERROR (admin auth resolver): no password in Keychain, clipboard, or env." >&2
        echo "  Either copy the password to clipboard and re-run, or:" >&2
        echo "    security add-generic-password -s mountzara-admin-password -a '$MZ_ADMIN_USER' -w 'YOUR_PW' -U" >&2
        return 1
    fi

    # Pre-flight against a known admin-gated endpoint.
    local http
    http=$(curl -sS -o /dev/null -u "$MZ_ADMIN_USER:$MZ_ADMIN_PASS" \
        -w '%{http_code}' "$base_url/api/posts/_admin?kind=blog")
    if [ "$http" != "200" ]; then
        echo "ERROR (admin auth resolver): pre-flight returned HTTP $http (expected 200)." >&2
        echo "  User: $MZ_ADMIN_USER  |  Password source: $source  |  Length: ${#MZ_ADMIN_PASS}" >&2
        echo "  Most likely: ADMIN_PASS_HASH was rotated on Cloudflare Pages and no local cache matches." >&2
        echo "  Run: bash scripts/_reset_admin_password_node.sh   # rotates fresh + syncs everywhere" >&2
        return 2
    fi

    # Self-heal Keychain if the password came from a non-Keychain source.
    if [ "$source" != "keychain" ]; then
        security add-generic-password -s mountzara-admin-password \
            -a "$MZ_ADMIN_USER" -w "$MZ_ADMIN_PASS" \
            -j "MountZara admin (auto-cached from $source)" -U 2>/dev/null || true
        echo "  ✓ admin auth resolved via $source + self-healed Keychain"
    else
        echo "  ✓ admin auth resolved via Keychain"
    fi

    export MZ_ADMIN_USER MZ_ADMIN_PASS
    return 0
}
