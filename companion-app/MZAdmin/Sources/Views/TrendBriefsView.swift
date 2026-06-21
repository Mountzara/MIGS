import SwiftUI

@MainActor
final class TrendBriefsModel: ObservableObject {
    @Published var briefs: [TrendBrief] = []
    @Published var includeDone: Bool = false
    @Published var isLoading = false
    @Published var error: String?
    @Published var busyIDs: Set<String> = []

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var pending: [TrendBrief] { briefs.filter(\.isPending) }
    var approved: [TrendBrief] { briefs.filter(\.isApproved) }
    var rejected: [TrendBrief] { briefs.filter(\.isRejected) }

    func reload() async {
        isLoading = true; error = nil
        do { briefs = try await api.listTrendBriefs(includeDone: includeDone) }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func approve(_ id: String, _ body: TrendBriefApproveBody) async -> Bool {
        await run(id) { try await self.api.approveTrendBrief(id: id, body) }
    }
    func reject(_ id: String, reason: String) async -> Bool {
        await run(id) { try await self.api.rejectTrendBrief(id: id, reason: reason) }
    }
    private func run(_ id: String, _ op: @escaping () async throws -> Void) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        do { try await op(); await reload(); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }
}

struct TrendBriefsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: TrendBriefsModel
    @State private var selected: TrendBrief?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: TrendBriefsModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.briefs.isEmpty {
                    ProgressView("Loading trend briefs…")
                } else if model.briefs.isEmpty {
                    ContentUnavailableView("Queue is clear",
                        systemImage: "checkmark.seal",
                        description: Text("No trend briefs waiting for review."))
                } else {
                    List {
                        section("Pending review", model.pending, badge: model.pending.count)
                        section("Approved", model.approved)
                        section("Rejected", model.rejected)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Trend briefs")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { brief in
                TrendBriefDetailView(brief: brief, model: model)
            }
        }
        .task { await model.reload() }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [TrendBrief], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { b in
                    Button { selected = b } label: { TrendBriefRowView(brief: b) }
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

private struct TrendBriefRowView: View {
    let brief: TrendBrief
    private var dotColor: Color {
        switch brief.status {
        case "approved": return Theme.green
        case "rejected": return Theme.red
        default: return Theme.amber
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(brief.claimText ?? brief.slug ?? brief.id)
                    .font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    if let d = brief.briefDate { Text(d) }
                    if let inf = brief.influencer, !inf.isEmpty { Text("· \(inf)") }
                    if let pass = brief.auditPassCount, let fail = brief.auditFailCount {
                        Text("· audit \(pass)/\(pass + fail)")
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
