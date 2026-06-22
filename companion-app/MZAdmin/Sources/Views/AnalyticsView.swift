import SwiftUI

@MainActor
final class AnalyticsModel: ObservableObject {
    @Published var data: AdminAnalytics?
    @Published var windowDays: Int = 30
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    func reload() async {
        isLoading = true; error = nil
        do { data = try await api.analytics(windowDays: windowDays) }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }
}

struct AnalyticsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: AnalyticsModel
    init(auth: AuthStore) { _model = StateObject(wrappedValue: AnalyticsModel(auth: auth)) }

    private let kpiColumns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    windowPicker
                    if model.isLoading && model.data == nil {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else if let d = model.data {
                        kpiGrid(d)
                        intakeFunnel(d)
                        triageBreakdown(d)
                        appointmentsBreakdown(d)
                        messagingActivity(d)
                        auditSignals(d)
                    } else {
                        ContentUnavailableView("Analytics unavailable",
                            systemImage: "chart.bar",
                            description: Text("No analytics returned for this window."))
                    }
                }
                .padding(16)
            }
            .navigationTitle("Analytics")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        }
        .task { await model.reload() }
    }

    private var windowPicker: some View {
        Picker("Window", selection: $model.windowDays) {
            Text("14 d").tag(14)
            Text("30 d").tag(30)
            Text("90 d").tag(90)
        }
        .pickerStyle(.segmented)
        .onChange(of: model.windowDays) { _, _ in Task { await model.reload() } }
    }

    @ViewBuilder
    private func kpiGrid(_ d: AdminAnalytics) -> some View {
        if let t = d.totals {
            LazyVGrid(columns: kpiColumns, spacing: 10) {
                kpi("Patients", t.patients ?? 0, icon: "person.2", accent: Theme.accentSoft)
                kpi("Upcoming appts", t.appointmentsUpcoming ?? 0, icon: "calendar", accent: Theme.green)
                kpi("Unread msgs", t.messagesUnreadForClinician ?? 0, icon: "envelope.badge",
                    accent: (t.messagesUnreadForClinician ?? 0) > 0 ? Theme.amber : Theme.accentSoft)
                kpi("Intakes pending", t.intakesInProgress ?? 0, icon: "doc.text", accent: Theme.amber)
                kpi("Symptoms / window", t.symptomEntriesWindow ?? 0, icon: "waveform.path.ecg", accent: Theme.accentSoft)
                kpi("Documents", t.documents ?? 0, icon: "folder", accent: Theme.accentSoft)
            }
        }
    }

    private func kpi(_ label: String, _ value: Int, icon: String, accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon).foregroundStyle(accent)
                Spacer()
            }
            Text("\(value)").font(.system(size: 28, weight: .semibold))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    @ViewBuilder
    private func intakeFunnel(_ d: AdminAnalytics) -> some View {
        if let f = d.intakeFunnel {
            card("Intake funnel", icon: "doc.text") {
                rowKV("Started", "\(f.started ?? 0)")
                rowKV("In progress", "\(f.inProgress ?? 0)")
                rowKV("Submitted", "\(f.submitted ?? 0)")
                rowKV("Reviewed", "\(f.reviewed ?? 0)")
            }
        }
    }

    @ViewBuilder
    private func triageBreakdown(_ d: AdminAnalytics) -> some View {
        if let t = d.triage {
            card("Triage", icon: "stethoscope") {
                rowKV("Total", "\(t.total ?? 0)")
                rowKV("Pending", "\(t.pending ?? 0)",
                      accent: (t.pending ?? 0) > 0 ? Theme.amber : nil)
                rowKV("Released", "\(t.released ?? 0)")
                rowKV("Booked", "\(t.booked ?? 0)")
                if let mr = t.manualReviewRequired, mr > 0 {
                    rowKV("Manual review", "\(mr)", accent: Theme.red)
                }
                if let urg = t.byUrgency, !urg.isEmpty {
                    Divider().padding(.vertical, 4)
                    Text("By urgency").font(.caption).foregroundStyle(.secondary)
                    ForEach(urg) { k in
                        rowKV(k.urgency?.capitalized ?? "—", "\(k.count)")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func appointmentsBreakdown(_ d: AdminAnalytics) -> some View {
        if let a = d.appointments {
            card("Appointments", icon: "calendar") {
                if let s = a.byStatus, !s.isEmpty {
                    Text("Status").font(.caption).foregroundStyle(.secondary)
                    ForEach(s) { k in rowKV(k.status?.capitalized ?? "—", "\(k.count)") }
                }
                if let v = a.byVisitType, !v.isEmpty {
                    Divider().padding(.vertical, 4)
                    Text("Visit type").font(.caption).foregroundStyle(.secondary)
                    ForEach(v) { k in rowKV(prettyVisitKey(k.visitType ?? "—"), "\(k.count)") }
                }
            }
        }
    }

    @ViewBuilder
    private func messagingActivity(_ d: AdminAnalytics) -> some View {
        if let m = d.messagingActivity {
            card("Messaging activity", icon: "bubble.left.and.bubble.right") {
                rowKV("Messages / window", "\(m.messagesWindow ?? 0)")
                rowKV("Clinician replies", "\(m.clinicianRepliesWindow ?? 0)")
                rowKV("Threads with unread", "\(m.threadsWithUnread ?? 0)",
                      accent: (m.threadsWithUnread ?? 0) > 0 ? Theme.amber : nil)
                if let oldest = m.oldestUnreadThreadMs, oldest > 0 {
                    rowKV("Oldest unread", fmtEpoch(oldest))
                }
            }
        }
    }

    @ViewBuilder
    private func auditSignals(_ d: AdminAnalytics) -> some View {
        if let a = d.auditSignals, let actions = a.byAction, !actions.isEmpty {
            card("Audit activity", icon: "shield.lefthalf.filled") {
                rowKV("Events / window", "\(a.eventsWindowTotal ?? 0)")
                Divider().padding(.vertical, 4)
                Text("Top actions").font(.caption).foregroundStyle(.secondary)
                ForEach(actions.prefix(8)) { k in
                    rowKV(k.action ?? "—", "\(k.count)")
                }
            }
        }
    }

    @ViewBuilder
    private func card<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func rowKV(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.subheadline.weight(.medium)).foregroundStyle(accent ?? .primary)
        }
    }
}
