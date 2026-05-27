# mountzara.com — Autonomous Operation Guide

> ## 🛑 REQUIRED READING — `SYSTEM_MAP.md`
>
> Before ANY non-trivial edit to this repo, READ
> [`./SYSTEM_MAP.md`](./SYSTEM_MAP.md) first.
>
> It is the master atlas of every file, what depends on it, and what
> other files MUST be touched in the same change. It exists because
> three legacy-code regressions on 2026-05-26 (CSS corruption at line
> 5703 silently scoping site-wide rules inside `@media (prefers-reduced-motion)`,
> stale `toggleFeatureSound` reference at line 9854 throwing
> ReferenceError that halted every script after it, `initSeeAllSheet`
> IIFE running before end-of-body `<dialog>` was parsed) would all
> have been preventable with proper cross-file mapping in hand.
>
> Same pattern as `ABOGCaseListManager/SYSTEM_MAP.md` per global
> CLAUDE.md §10.11. **Update SYSTEM_MAP.md in the same commit when a
> file is added, renamed, deleted, or its responsibility changes.**

This site is fully autonomous. Claude can ship any change end-to-end with **zero user involvement** — code, deploy, R2 uploads, env vars, the whole pipeline.

## TL;DR — Two commands

```bash
# Deploy any code change (HTML/CSS/JS/Functions) to mountzara.com
./scripts/deploy-prod.sh "what changed"

# Upload a file to the R2 bucket (mountzara-media)
TOKEN=$(cat ~/.config/mountzara/upload-token.txt)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  --data-binary @/path/to/file.mp4 \
  "https://mountzara.com/upload/destination-key.mp4"
```

**Never** instruct the user to merge a PR, run wrangler locally, use the Cloudflare dashboard, or upload to R2 manually. The user's Mac is frequently out of disk space; if you push them to do anything locally it will fail and they will be furious.

## Architecture

| Concern | How |
|---|---|
| Static site | Cloudflare Pages project `mountzara` (account `8fbe127f640681ddd813aaf33b95507f`) |
| Production branch | `main` — but irrelevant; we deploy directly via Pages API |
| Code deploys | `scripts/deploy-prod.sh` runs `wrangler pages deploy` against the API token |
| Large media | R2 bucket `mountzara-media`, served at `mountzara.com/media/<key>` via Pages Function `functions/media/[[path]].js` |
| Media uploads | `mountzara.com/upload/<key>` (PUT, Bearer-auth) — Pages Function `functions/upload/[[path]].js` |
| Bindings | `MEDIA` → `mountzara-media` (R2). `UPLOAD_TOKEN` (secret env var) protects the upload endpoint. Both set on the Pages production deployment_config. |
| Credentials | `~/.config/mountzara/cf-creds.env` (CF API token + account ID), `~/.config/mountzara/upload-token.txt` (upload secret). Auto-sourced by `.claude/hooks/session-start.sh`. |

## Common operations

### Change site code, then deploy
```bash
# edit files
./scripts/deploy-prod.sh "fix mobile typography"
```
Verify with `curl -s "https://mountzara.com/?cb=$(date +%s)"`.

### Upload a file from a local path on this server
```bash
TOKEN=$(cat ~/.config/mountzara/upload-token.txt)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  --data-binary @./localfile.mp4 \
  "https://mountzara.com/upload/destkey.mp4"
```

### Upload a file the user has on their Mac
**Last-resort fallback only.** Give them this curl line:
```bash
curl -X PUT -H "Authorization: Bearer <token-from-upload-token.txt>" \
  --data-binary @"/full/path/to/file.mp4" \
  "https://mountzara.com/upload/destkey.mp4"
```
curl is built into macOS, uses no extra disk space, streams from the source file. No 300MB dashboard limit. Works on a Mac with 0 free disk because the file already exists on disk.

### List files in R2
```bash
source ~/.config/mountzara/cf-creds.env
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/mountzara-media/objects" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | python3 -m json.tool
```

### Delete a file from R2
```bash
source ~/.config/mountzara/cf-creds.env
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/mountzara-media/objects/<key>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

### Set/change a Pages env var
```bash
source ~/.config/mountzara/cf-creds.env
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/mountzara" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deployment_configs":{"production":{"env_vars":{"FOO":{"value":"bar","type":"secret_text"}}}}}'
```
Then redeploy with `./scripts/deploy-prod.sh` so the new var takes effect.

### Inspect deployment history
```bash
source ~/.config/mountzara/cf-creds.env
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/mountzara/deployments?per_page=5" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -m json.tool
```

## Site structure

- `index.html` — main landing page
- `about/index.html` — bio page (uses `../assets/images/headshot.jpg`)
- `assets/` — static assets (images, monogram). Path references from `about/` must be relative (`../assets/...`), not absolute (`/assets/...`) — absolute paths break on some mobile browsers in subdirectories.
- `functions/media/[[path]].js` — serves `/media/<key>` from R2 with HTTP Range support
- `functions/media/index.js` — debug endpoint at `/media/` listing bucket contents
- `functions/upload/[[path]].js` — auth'd PUT endpoint for adding files to R2
- `wrangler.toml` — declares the `MEDIA` R2 binding (also configured in dashboard via the deployment_config)
- `_redirects` — Pages routing rules

## Anti-patterns

- ❌ Do not instruct the user to clone the repo or run git/npm/wrangler locally.
- ❌ Do not use `git push` to feature branches expecting it to deploy. Deploys go through `scripts/deploy-prod.sh`.
- ❌ Do not put R2 binding config only in `wrangler.toml` — the Pages production env reads bindings from the dashboard / API, not from `wrangler.toml` (that's for `wrangler dev` only).
- ❌ Do not hyphenate large blocks of body copy (`hyphens: auto`) — it broke "AAGL-presented" mid-word in cards. Use `hyphens: manual`.
- ❌ Do not commit `~/.config/mountzara/*` — they're outside the repo on purpose.
