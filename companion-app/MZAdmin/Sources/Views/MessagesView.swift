import SwiftUI

@MainActor
final class MessagesModel: ObservableObject {
    @Published var threads: [MessageThread] = []
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }
    private var seq = 0   // stale-response guard (mirrors the web fix)

    func reload() async {
        let mine = (seq &+ 1); seq = mine
        isLoading = true; error = nil
        do {
            let t = try await api.listThreads()
            guard mine == seq else { return }       // a newer reload superseded this
            threads = t.sorted { ($0.lastMessageAt ?? 0) > ($1.lastMessageAt ?? 0) }
        } catch {
            guard mine == seq else { return }
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        if mine == seq { isLoading = false }
    }
}

struct MessagesView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: MessagesModel
    @State private var selected: MessageThread?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: MessagesModel(auth: auth)) }

    var unreadTotal: Int { model.threads.reduce(0) { $0 + ($1.unreadCount ?? 0) } }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.threads.isEmpty {
                    ProgressView("Loading messages…")
                } else if model.threads.isEmpty {
                    ContentUnavailableView("No conversations",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Patient message threads will appear here."))
                } else {
                    List(model.threads) { thread in
                        Button { selected = thread } label: { ThreadRowView(thread: thread) }
                            .buttonStyle(.plain)
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Messages")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { thread in
                ThreadView(thread: thread, auth: auth, onChange: { Task { await model.reload() } })
            }
        }
        .task { await model.reload() }
    }
}

private struct ThreadRowView: View {
    let thread: MessageThread
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.patientName).font(.body.weight(.medium))
                    if let n = thread.unreadCount, n > 0 {
                        Text("\(n)").font(.caption2.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Theme.accent, in: Capsule())
                    }
                }
                Text(thread.subject).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if let p = thread.lastMessagePreview, !p.isEmpty {
                    Text(p).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let badge = slaBadge(thread) {
                    Text(badge.text).font(.caption2.bold()).foregroundStyle(badge.color)
                }
                Text(fmtEpoch(thread.lastMessageAt, dateStyle: .short, timeStyle: .short))
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }

    private func slaBadge(_ t: MessageThread) -> (text: String, color: Color)? {
        if t.slaBreached == true { return ("SLA BREACHED", Theme.red) }
        guard let due = t.slaDueAt else { return nil }
        let remaining = Double(due) - Date().timeIntervalSince1970 * 1000
        if remaining <= 0 { return ("OVERDUE", Theme.red) }
        let hours = remaining / 3_600_000
        let label = hours >= 1 ? "reply in \(Int(hours))h" : "reply in \(Int(remaining/60_000))m"
        if t.urgency == "urgent" || hours < 2 { return (label, Theme.red) }
        if hours < 24 { return (label, Theme.amber) }
        return (label, Theme.accentSoft)
    }
}
