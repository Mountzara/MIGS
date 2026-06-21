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
        }
        .tint(Theme.accentSoft)
    }
}

#Preview {
    RootView().environmentObject(AuthStore())
}
