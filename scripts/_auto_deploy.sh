#!/bin/bash
# Auto-deploy:
#   1. Starts wrangler login with --browser=false so it just prints the URL
#   2. Grabs the URL from the log and opens it in Chrome (where the user has a Cloudflare session)
#   3. Polls for ~/.config/.wrangler/config/default.toml indicating successful auth
#   4. Runs the deploy script automatically on success

set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
export TERM=dumb
cd /Users/beans/Developer/MountZara/MIGS

LOG=/tmp/auto_deploy.log
DONE=/tmp/auto_deploy.done
LOGIN_LOG=/tmp/auto_deploy.wrangler_login.log
: > "$LOG" ; : > "$LOGIN_LOG"
rm -f "$DONE"

date "+==> %F %T start" >> "$LOG"

# Start wrangler login in background. --browser=false means it WON'T try to open a browser
# itself; it just prints the URL and waits for the callback.
nohup npx wrangler login --browser=false > "$LOGIN_LOG" 2>&1 &
LOGIN_PID=$!
echo "==> wrangler login PID $LOGIN_PID (browser disabled, callback on localhost:8976)" >> "$LOG"

# Wait for the OAuth URL to appear in the login log
URL=""
for i in $(seq 1 30); do
  if grep -q 'https://dash.cloudflare.com/oauth2/auth' "$LOGIN_LOG" 2>/dev/null; then
    URL=$(grep -o 'https://dash.cloudflare.com/oauth2/auth[^ ]*' "$LOGIN_LOG" | head -1)
    break
  fi
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "==> FAILED to find OAuth URL in login log" >> "$LOG"
  tail -20 "$LOGIN_LOG" >> "$LOG"
  echo "FAIL_NO_URL" > "$DONE"
  exit 1
fi

echo "==> got OAuth URL, opening in Chrome" >> "$LOG"
echo "$URL" >> "$LOG"

# Open the URL EXPLICITLY in Chrome (not the default browser)
open -a "Google Chrome" "$URL" 2>>"$LOG"

# Bring Chrome to the front so the user sees it
osascript -e 'tell application "Google Chrome" to activate' 2>>"$LOG"

# Poll for auth — wrangler writes ~/.config/.wrangler/config/default.toml on success.
# wrangler login has its own ~2-minute internal timeout; we poll until either auth
# completes OR the login process dies.
echo "==> waiting up to 110s for OAuth approval..." >> "$LOG"
for i in $(seq 1 22); do
  if [ -f "$HOME/.config/.wrangler/config/default.toml" ]; then
    echo "==> AUTH complete after ${i}x5s" >> "$LOG"
    break
  fi
  if ! kill -0 "$LOGIN_PID" 2>/dev/null; then
    echo "==> login process died before auth file appeared" >> "$LOG"
    tail -20 "$LOGIN_LOG" >> "$LOG"
    echo "FAIL_LOGIN_DIED" > "$DONE"
    exit 1
  fi
  sleep 5
done

if [ ! -f "$HOME/.config/.wrangler/config/default.toml" ]; then
  echo "==> auth timeout, killing login" >> "$LOG"
  kill "$LOGIN_PID" 2>/dev/null
  echo "FAIL_TIMEOUT" > "$DONE"
  exit 1
fi

# Verify
echo "==> wrangler whoami:" >> "$LOG"
npx wrangler whoami >> "$LOG" 2>&1

# Run the deploy script
echo "==> running deploy-video-previews.sh" >> "$LOG"
bash /Users/beans/Developer/MountZara/MIGS/scripts/deploy-video-previews.sh >> "$LOG" 2>&1
RC=$?
echo "==> deploy exit=$RC" >> "$LOG"

[ "$RC" = "0" ] && echo "OK" > "$DONE" || echo "FAIL_DEPLOY rc=$RC" > "$DONE"
