import SwiftUI

@MainActor
final class FeedbackModel: ObservableObject {
    @Published var feedback: [Feedback] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var busyIDs: Set<String> = []

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var pending: [Feedback] { feedback.filter(\.isPending) }
    var approved: [Feedback] { feedback.filter(\.isApproved) }
    var implemented: [Feedback] { feedback.filter(\.isImplemented) }
    var declined: [Feedback] { feedback.filter(\.isDeclined) }

    func reload() async {
        isLoading = true; error = nil
        do { feedback = try await api.listFeedback(statuses: ["new", "ai_analyzed", "approved", "implemented", "rejected", "wont_fix"]) }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func approve(_ id: String, note: String?) async -> Bool {
        await run(id) { try await self.api.approveFeedback(id: id, note: note) }
    }
    func reject(_ id: String, reason: String?, kind: String) async -> Bool {
        await run(id) { try await self.api.rejectFeedback(id: id, reason: reason, kind: kind) }
    }
    private func run(_ id: String, _ op: @escaping () async throws -> Void) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        do { try await op(); await reload(); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }
}

struct FeedbackView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: FeedbackModel
    @State private var selected: Feedback?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: FeedbackModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.feedback.isEmpty {
                    ProgressView("Loading feedback…")
                } else if model.feedback.isEmpty {
                    ContentUnavailableView("No feedback yet",
                        systemImage: "ellipsis.bubble",
                        description: Text("Beta-tester submissions will appear here."))
                } else {
                    List {
                        section("Awaiting review", model.pending, badge: model.pending.count)
                        section("Approved (queued)", model.approved)
                        section("Implemented", model.implemented)
                        section("Declined", model.declined)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Feedback")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { fb in
                FeedbackDetailView(item: fb, model: model)
            }
        }
        .task { await model.reload() }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [Feedback], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { f in
                    Button { selected = f } label: { FeedbackRowView(item: f) }
                        .buttonStyle(.plain)
                }
            } header: {
                HStack {
                    Text(title)
                    if let badge, badge > 0 {
                        Text("\(badge)").font(.caption2.bold())
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Theme.amber.opacity(0.22), in: Capsule())
                            .foregroundStyle(Theme.amber)
                    }
                }
            }
        }
    }
}

private struct FeedbackRowView: View {
    let item: Feedback
    private var dotColor: Color {
        switch item.status {
        case "approved": return Theme.green
        case "implemented": return Theme.accentSoft
        case "rejected", "wont_fix": return Theme.red
        default: return Theme.amber
        }
    }
    private var severityColor: Color {
        switch item.severity {
        case "urgent", "high": return Theme.red
        case "medium": return Theme.amber
        default: return Theme.accentSoft
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.commentText ?? "(no comment)")
                    .font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    if let t = item.feedbackType { Text(t.capitalized) }
                    if let s = item.severity {
                        Text(s.uppercased()).foregroundStyle(severityColor)
                    }
                    if let r = item.route, !r.isEmpty {
                        Text(r).lineLimit(1).truncationMode(.middle)
                    }
                    if item.hasScreenshot == true {
                        Image(systemName: "camera").font(.caption2)
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
