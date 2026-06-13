import SwiftUI

@MainActor
final class TriageModel: ObservableObject {
    @Published var rows: [TriageRow] = []
    @Published var visitTypes: [VisitType] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var busyIDs: Set<String> = []

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var pending: [TriageRow] { rows.filter { !$0.isReleased } }

    func reload() async {
        isLoading = true; error = nil
        do {
            async let r = api.listTriage(status: "pending")
            async let vt = api.visitTypes()
            rows = try await r
            visitTypes = try await vt
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func save(_ id: String, _ ovr: TriageOverride) async -> Bool {
        await run(id) { try await self.api.saveTriage(id: id, ovr) }
    }
    func release(_ id: String, visitType: String, durationMin: Int) async -> Bool {
        await run(id) { try await self.api.releaseTriage(id: id, finalVisitType: visitType, finalDurationMin: durationMin) }
    }
    private func run(_ id: String, _ op: @escaping () async throws -> Void) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        do { try await op(); await reload(); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }

    func label(for key: String) -> String {
        visitTypes.first { $0.key == key }?.label ?? prettyVisitKey(key)
    }
}

struct TriageView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: TriageModel
    @State private var selected: TriageRow?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: TriageModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.rows.isEmpty {
                    ProgressView("Loading triage…")
                } else if model.pending.isEmpty {
                    ContentUnavailableView("All caught up",
                        systemImage: "checkmark.seal",
                        description: Text("No appointment requests are awaiting review."))
                } else {
                    List(model.pending) { row in
                        Button { selected = row } label: { TriageRowView(row: row, model: model) }
                            .buttonStyle(.plain)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Triage")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { row in
                TriageDetailView(row: row, model: model)
            }
        }
        .task { await model.reload() }
    }
}

private struct TriageRowView: View {
    let row: TriageRow
    let model: TriageModel
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(row.aiUrgency == "urgent" ? Theme.red : Theme.accentSoft)
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.patientName ?? "Patient").font(.body.weight(.medium))
                HStack(spacing: 8) {
                    Text(model.label(for: row.aiVisitType))
                    Text("\(row.aiDurationMin)m")
                    if row.aiUrgency == "urgent" {
                        Text("URGENT").font(.caption2.bold()).foregroundStyle(Theme.red)
                    }
                }.font(.caption).foregroundStyle(.secondary)
                if let h = row.hoursPending {
                    Text("waiting \(Int(h))h").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
