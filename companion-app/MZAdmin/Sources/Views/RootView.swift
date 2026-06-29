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

/// The signed-in shell: one tab per admin surface. The TabView `selection`
/// is bound to NotificationRouter so a tapped push can deep-link to its tab.
struct MainTabs: View {
    let auth: AuthStore
    @ObservedObject private var router = NotificationRouter.shared

    var body: some View {
        TabView(selection: $router.selectedTab) {
            PostListView(auth: auth).tag(AdminTab.posts)
                .tabItem { Label("Posts", systemImage: "doc.text") }
            AssistantView(auth: auth).tag(AdminTab.assistant)
                .tabItem { Label("Assistant", systemImage: "sparkles") }
            TriageView(auth: auth).tag(AdminTab.triage)
                .tabItem { Label("Triage", systemImage: "stethoscope") }
            MessagesView(auth: auth).tag(AdminTab.messages)
                .tabItem { Label("Messages", systemImage: "bubble.left.and.bubble.right") }
            ScheduleView(auth: auth).tag(AdminTab.schedule)
                .tabItem { Label("Schedule", systemImage: "calendar") }
            PatientsView(auth: auth).tag(AdminTab.patients)
                .tabItem { Label("Patients", systemImage: "person.2") }
            TrendBriefsView(auth: auth).tag(AdminTab.briefs)
                .tabItem { Label("Briefs", systemImage: "chart.line.uptrend.xyaxis") }
            FeedbackView(auth: auth).tag(AdminTab.feedback)
                .tabItem { Label("Feedback", systemImage: "ellipsis.bubble") }
            CarouselsView(auth: auth).tag(AdminTab.carousels)
                .tabItem { Label("Carousels", systemImage: "rectangle.stack") }
            AnalyticsView(auth: auth).tag(AdminTab.analytics)
                .tabItem { Label("Analytics", systemImage: "chart.bar") }
            BriefingsView(auth: auth).tag(AdminTab.briefings)
                .tabItem { Label("Briefings", systemImage: "list.bullet.clipboard") }
            EducationView(auth: auth).tag(AdminTab.education)
                .tabItem { Label("Education", systemImage: "book") }
            ComplianceView(auth: auth).tag(AdminTab.compliance)
                .tabItem { Label("Compliance", systemImage: "doc.badge.gearshape") }
            DebugView(auth: auth).tag(AdminTab.debug)
                .tabItem { Label("Debug", systemImage: "ladybug") }
            BillingView(auth: auth).tag(AdminTab.billing)
                .tabItem { Label("Billing", systemImage: "creditcard") }
        }
        .tint(Theme.accentSoft)
    }
}

/// The admin tabs — used both for the TabView selection and to route a tapped
/// push notification to the right surface.
enum AdminTab: Hashable {
    case posts, assistant, triage, messages, schedule, patients, briefs, feedback
    case carousels, analytics, briefings, education, compliance, debug, billing

    /// Contract for the push-notification `type` field → tab. No backend
    /// sender exists yet; this DEFINES the mapping the sender should target.
    init?(notificationType: String?) {
        switch notificationType?.lowercased() {
        case "assistant", "ask", "ai":        self = .assistant
        case "post", "evidence", "blog":      self = .posts
        case "triage", "appointment_request": self = .triage
        case "message", "thread":             self = .messages
        case "appointment", "schedule":       self = .schedule
        case "patient", "case":               self = .patients
        case "trend_brief", "brief":          self = .briefs
        case "feedback":                      self = .feedback
        case "carousel":                      self = .carousels
        case "briefing":                      self = .briefings
        case "education":                     self = .education
        case "compliance":                    self = .compliance
        case "billing", "claim":              self = .billing
        default:                              return nil
        }
    }
}

/// Bridges a tapped push notification ({type, id}) to the tab shell. The
/// iOS AppDelegate writes here; MainTabs binds its TabView selection to it.
@MainActor
final class NotificationRouter: ObservableObject {
    static let shared = NotificationRouter()
    @Published var selectedTab: AdminTab = .posts
    /// Record id from the payload — seam for future record-level deep links.
    @Published var pendingRecordID: String?
    private init() {}

    /// Switch to the tab for `type` (ignored if `type` is unknown).
    func handle(type: String?, id: String?) {
        guard let tab = AdminTab(notificationType: type) else { return }
        pendingRecordID = id
        selectedTab = tab
    }
}

#Preview {
    RootView().environmentObject(AuthStore())
}
