# GitHub OAuth Device Flow — Autonomous Push

Per task #46. Replaces the previous "manual `git push` from operator
terminal" pattern with a Keychain-cached OAuth token that future Claude
sessions can use to push to `Mountzara/MIGS` without operator intervention.

## What this gives you

- One-time interactive enrollment per device (15 min).
- Subsequent `git push` calls are silent — token comes from macOS Keychain
  via the standard `osxkeychain` credential helper.
- Token is scoped to a specific GitHub OAuth App you control — revocable
  per-app at https://github.com/settings/applications without affecting
  other tokens or PATs.

## One-time setup (operator)

### 1. Create the GitHub OAuth App

For organization-scoped (recommended, since the repo is `Mountzara/MIGS`):

- Visit `https://github.com/organizations/Mountzara/settings/applications/new`

For personal-account-scoped (works too, just owned by your user not the org):

- Visit `https://github.com/settings/applications/new`

Fill in:

| Field             | Value                                         |
| ----------------- | --------------------------------------------- |
| Application name  | `Mount Zara — Autonomous Push`                |
| Homepage URL      | `https://mountzara.com`                       |
| Callback URL      | `https://mountzara.com` (unused, but required) |

Click **Register application**.

On the new app's page:

1. Scroll to **Device Flow** → check **Enable Device Flow**.
2. Copy the **Client ID** (top of the page, format `Iv1.xxxxxxxxxxxxxxxx`).

### 2. Stash the Client ID in Keychain

```
security add-generic-password \
    -a mountzara-github-oauth-client-id \
    -s mountzara-github-oauth-client-id \
    -w '<paste_client_id_here>'
```

### 3. Run the device-flow authorization

```
./scripts/github_device_flow_auth.sh
```

The script will:

1. Open your browser to `https://github.com/login/device`.
2. Print an 8-character `user_code` (`XXXX-XXXX`).
3. You paste the code in the browser, approve the app, and close the tab.
4. The script polls until GitHub returns an access token, caches it in
   Keychain under `mountzara-github-oauth-token`, registers it with the
   `osxkeychain` git credential helper, and verifies the token by
   fetching `https://api.github.com/user`.

After this completes, your `git push origin main` (or any other branch)
works without prompting for credentials.

## Subsequent pushes

From an active Claude session:

```
./scripts/git_push.sh                       # push current branch to origin
./scripts/git_push.sh origin main           # push current branch to origin/main
./scripts/git_push.sh origin feature-x      # push current branch to origin/feature-x
```

Or just call git directly — the osxkeychain credential helper handles it:

```
git push origin main
```

## Revoking access

### Soft revoke (just this device)

```
security delete-generic-password \
    -a mountzara-github-oauth-token \
    -s mountzara-github-oauth-token

printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain erase
```

The token is still valid on the GitHub side, but it's no longer cached
on this Mac.

### Hard revoke (every device the OAuth app has authorized)

Visit `https://github.com/settings/applications`, find "Mount Zara —
Autonomous Push", click the menu, choose **Revoke**. Every device using
that app's token immediately loses access.

To rotate, re-run `./scripts/github_device_flow_auth.sh` after revocation.

## Scoping recommendation

When approving the OAuth App, GitHub will ask which repositories you
want to grant access to. Choose **Only select repositories** → just
`Mountzara/MIGS`. This way, even if the token leaks, the blast radius
is limited to this one repo (no access to other Mountzara org repos,
no access to your personal repos).

## Security notes

- The token is stored in macOS Keychain — encrypted at rest with the
  user-account login keychain key. An attacker would need to unlock your
  Mac OR extract the keychain via `security` from a logged-in shell.
- The osxkeychain credential helper supplies the token to git over
  localhost; the token never appears in command-line history or in
  shell environment variables.
- Per §4.2 of CLAUDE.md, the token is never committed to git, never
  printed to chat, and never written to a file outside Keychain.

## Why device flow over a PAT?

A classic personal access token (PAT) works for `git push` too and is
simpler — but:

- A PAT is one long-lived credential. Compromise = re-rotate-and-update
  everywhere it's used.
- A device-flow OAuth token is scoped per OAuth App. Revoking the app
  invalidates every token issued by it, atomically.
- OAuth Apps support fine-grained per-repo access controls; PATs are
  user-wide (or via fine-grained PATs, more limited but still tied to
  the user account).
- Device flow is the GitHub-recommended pattern for headless / CLI
  agents — the same flow Docker, gh CLI, and GitHub Copilot CLI use.
