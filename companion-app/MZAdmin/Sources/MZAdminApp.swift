import SwiftUI

/// Mount Zara — Admin Mission Control.
/// One SwiftUI codebase → iPhone, iPad, and Mac. Talks to the existing
/// mountzara.com admin API (HTTP Basic auth) to review/approve/reject drafts.
@main
struct MZAdminApp: App {
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .preferredColorScheme(.dark)
                .tint(Theme.accentSoft)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        #endif
    }
}
