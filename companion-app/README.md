# MZ Admin — Mount Zara companion app (SwiftUI, iPhone + iPad + Mac)

A native SwiftUI **multiplatform** app (one codebase → iPhone, iPad, and Mac)
that controls the mountzara.com admin: review the draft queue, preview a post,
and **approve / publish** or **reject** it — anywhere. It talks to the same
admin API the web dashboard uses (`/api/posts/_admin`, `/approve`, `/reject`)
with the same HTTP Basic login, stored in the device Keychain.

> This was scaffolded in a Linux environment that has **no Xcode/Swift**, so it
> could not be compiled there. Everything is written to build cleanly on a Mac.
> Build it (and iterate) with Claude Code running **on your Mac** — see below.

## What works out of the box
- Sign in with the admin email + password (same as the web admin), kept in Keychain.
- Browse **Monday Mornings** (`kind=evidence`) and **Trend Briefs** (`kind=blog`),
  grouped **Pending review → Live → Rejected**, drafts first.
- Tap a post → see verdict, summary, topics, reference count, and a full
  rendered **HTML preview** (WKWebView).
- **Approve & publish** / **Reject** with one tap; the list refreshes and the
  change is live on mountzara.com immediately (the API rebuilds its index).
- Pull-to-refresh, dark theme + frosted-glass surfaces matching the site.

## Project layout
```
companion-app/
  MZAdmin.xcodeproj/              # COMMITTED, ready to open — no XcodeGen needed
  build-mac.sh                    # one-command CLI build (sim / mac / device)
  project.yml                     # XcodeGen spec (kept in sync; only needed to regenerate)
  MZAdmin/
    MZAdmin.entitlements          # macOS sandbox + outbound network (scoped to macOS)
    Sources/
      MZAdminApp.swift            # @main App
      Theme.swift                 # palette + glass card
      Models/
        Post.swift                # Codable models (mirror the API)
        AdminAPI.swift            # async URLSession client (Basic auth)
        AuthStore.swift           # Keychain-backed credentials
        AppModel.swift            # observable state + actions
      Views/
        RootView.swift LoginView.swift PostListView.swift
        PostDetailView.swift FlowLayout.swift
    Resources/
      Assets.xcassets/            # AppIcon (mz monogram) + AccentColor
```

## Build it (fastest path)
The Xcode project is **already committed** — no XcodeGen, no manual setup:

```bash
cd /path/to/MIGS/companion-app
open MZAdmin.xcodeproj         # then press ⌘R (pick iPhone simulator or My Mac)
# — or headless —
./build-mac.sh                 # iOS Simulator build (no signing required)
./build-mac.sh mac             # native macOS app
./build-mac.sh device          # real iPhone (set your Team in Xcode once first)
```

Pre-flight validation already done (on the Linux dev VM, Swift 5.10.1):
all 11 sources parse clean with the real Swift compiler, the data layer
(`Post.swift` + `AdminAPI.swift`) fully **type-checks**, and the
`.xcodeproj` was machine-verified (valid plist; every file reference
resolves; target/phases/configs correct). The SwiftUI views need the
macOS SDK to type-check, which only exists on a Mac — that's what ⌘B does.

## Build it on your Mac with Claude Code (recommended)
There is **no native Xcode plugin** for Claude Code — the supported, native path
is the Claude Code CLI in Terminal, which drives `xcodebuild`/`xcrun` to build and
run the app.

```bash
# 1) Install Claude Code on your Mac
curl -fsSL https://claude.ai/install.sh | bash      # or: brew install --cask claude-code

# 2) Open this repo and let Claude pre-allow the build tools
cd /path/to/MIGS/companion-app
claude
```
Then just ask Claude, e.g.:
- "run ./build-mac.sh and fix anything that fails"
- "build and run the iOS app in the simulator"
- "run the Mac app"
- "the approve button isn't refreshing — fix it and rebuild"

To skip the prompts, add to `~/.claude/settings.json`:
```json
{ "permissions": { "allow": ["Bash(xcodebuild *)", "Bash(xcrun *)", "Bash(swift *)", "Bash(xcodegen *)"] } }
```

## Regenerating the project (only if you restructure files)
The committed `.xcodeproj` already matches the sources. If you add/rename
files you can either add them in Xcode normally, or regenerate from spec:
```bash
brew install xcodegen
cd companion-app && xcodegen generate && open MZAdmin.xcodeproj
```

### Signing / entitlements
- Set your **Team** in Signing & Capabilities (Automatic). Simulator and
  macOS builds work with no team at all.
- The **Mac** build already carries `MZAdmin/MZAdmin.entitlements`
  (App Sandbox + *Outgoing Connections (Client)*), wired in via
  `CODE_SIGN_ENTITLEMENTS[sdk=macosx*]`. iOS needs nothing extra.
- All traffic is HTTPS to `mountzara.com`, so default App Transport Security passes.

## Extending it
The app is intentionally structured so the rest of the admin (scheduling,
messages, analytics, patients) drops in as new `Models/*API.swift` + `Views/*`
against the existing `/api/v1/admin/*` endpoints. `AdminAPI` already centralizes
auth + error handling.
