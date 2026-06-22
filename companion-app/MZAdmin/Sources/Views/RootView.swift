import SwiftUI

struct RootView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        ZStack {
            Theme.base.ignoresSafeArea()
            if auth.isAuthenticated {
                MainTabs(auth: auth)
            } else {
                LoginView()
            }
        }
        #if os(iOS)
        .task(id: auth.isAuthenticated) {
            // Once signed in, bind auth so token registration POSTs can authenticate,
            // then ask for notification permission + register for remote notifications.
            guard auth.isAuthenticated else { return }
            PushNotifications.shared.bind(authStore: auth)
            await PushNotifications.shared.requestAndRegister()
        }
        #endif
        // OS-27 Rule 28: index non-PHI surfaces (posts / trend briefs /
        // carousels) into the Spotlight semantic index so Siri can answer
        // from the operator's queue on-device. PHI tabs (Messages / Triage /
        // Patients) are NEVER indexed — see CLAUDE.md §6.
        .task(id: auth.isAuthenticated) {
            if #available(macOS 15.0, iOS 17.0, *) {
                guard auth.isAuthenticated, let token = auth.basicToken else { return }
                await AdminSpotlight.indexAll(api: AdminAPI(token: token))
            }
        }
    }
}

/// The signed-in shell: one tab per admin surface. Posts (review/approve),
/// Triage (appointment-request review), Messages (secure patient threads),
/// and Schedule (upcoming appointments).
struct MainTabs: View {
    let auth: AuthStore

    var body: some View {
        TabView {
            PostListView(auth: auth)
                .tabItem { Label("Posts", systemImage: "doc.text") }
            TriageView(auth: auth)
                .tabItem { Label("Triage", systemImage: "stethoscope") }
            MessagesView(auth: auth)
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right") }
            ScheduleView(auth: auth)
                .tabItem { Label("Schedule", systemImage: "calendar") }
            PatientsView(auth: auth)
                .tabItem { Label("Patients", systemImage: "person.2") }
            TrendBriefsView(auth: auth)
                .tabItem { Label("Briefs", systemImage: "chart.line.uptrend.xyaxis") }
            FeedbackView(auth: auth)
                .tabItem { Label("Feedback", systemImage: "ellipsis.bubble") }
            CarouselsView(auth: auth)
                .tabItem { Label("Carousels", systemImage: "rectangle.stack") }
            AnalyticsView(auth: auth)
                .tabItem { Label("Analytics", systemImage: "chart.bar") }
            BriefingsView(auth: auth)
                .tabItem { Label("Briefings", systemImage: "list.bullet.clipboard") }
            EducationView(auth: auth)
                .tabItem { Label("Education", systemImage: "book") }
            ComplianceView(auth: auth)
                .tabItem { Label("Compliance", systemImage: "doc.badge.gearshape") }
            DebugView(auth: auth)
                .tabItem { Label("Debug", systemImage: "ladybug") }
        }
        .tint(Theme.accentSoft)
    }
}

#Preview {
    RootView().environmentObject(AuthStore())
}
