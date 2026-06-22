import SwiftUI

@MainActor
final class DebugModel: ObservableObject {
    @Published var events: [DebugSessionEvent] = []
    @Published var summary: [String: DebugSessionLabelSummary] = [:]
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    func reload() async {
        isLoading = true; error = nil
        do {
            let resp = try await api.listDebugSessions(limit: 200)
            events = resp.events
            summary = resp.summary ?? [:]
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }
}

struct DebugView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: DebugModel
    init(auth: AuthStore) { _model = StateObject(wrappedValue: DebugModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !model.summary.isEmpty { summarySection }
                    eventsSection
                }
                .padding(16)
            }
            .navigationTitle("Debug")
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

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Per-label summary", systemImage: "tag")
                .font(.subheadline.weight(.semibold))
            ForEach(Array(model.summary.keys.sorted()), id: \.self) { key in
                if let s = model.summary[key] {
                    HStack {
                        Text(key).font(.subheadline)
                        Spacer()
                        Text("\(s.count ?? 0) hit\((s.count ?? 0) == 1 ? "" : "s")").font(.caption)
                            .foregroundStyle(.secondary)
                        if let e = s.errors, e > 0 {
                            Text("\(e) err").font(.caption2.bold()).foregroundStyle(Theme.red)
                        }
                        if let b = s.blocked, b > 0 {
                            Text("\(b) blk").font(.caption2.bold()).foregroundStyle(Theme.amber)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var eventsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Recent traces", systemImage: "list.bullet.rectangle")
                .font(.subheadline.weight(.semibold))
            if model.isLoading && model.events.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
            } else if model.events.isEmpty {
                Text("No trace events captured.").font(.caption).foregroundStyle(.tertiary)
            } else {
                ForEach(model.events.prefix(150)) { e in DebugRowView(event: e) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }
}

private struct DebugRowView: View {
    let event: DebugSessionEvent
    private var dotColor: Color {
        switch event.outcome {
        case "error": return Theme.red
        case "blocked": return Theme.amber
        default: return Theme.green
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(dotColor).frame(width: 7, height: 7).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    if let r = event.route { Text(r).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle) }
                    if let s = event.statusCode { Text("HTTP \(s)").font(.caption2).foregroundStyle(.secondary) }
                    Spacer()
                    if let ts = event.ts { Text(fmtEpoch(ts)).font(.caption2).foregroundStyle(.tertiary) }
                }
                HStack(spacing: 8) {
                    if let l = event.inviteLabel { Text(l) }
                    if let o = event.outcome { Text("· \(o)").foregroundStyle(dotColor) }
                    if let n = event.note, !n.isEmpty {
                        Text("· \(n)").lineLimit(1).truncationMode(.middle)
                    }
                }.font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
