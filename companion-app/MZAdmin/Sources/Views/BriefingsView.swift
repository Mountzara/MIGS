import SwiftUI

@MainActor
final class BriefingsModel: ObservableObject {
    @Published var briefings: [Briefing] = []
    @Published var range: String = "day"           // "day" | "week"
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    func reload() async {
        isLoading = true; error = nil
        do { briefings = try await api.listBriefings(range: range == "week" ? "week" : nil) }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }
}

struct BriefingsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: BriefingsModel
    init(auth: AuthStore) { _model = StateObject(wrappedValue: BriefingsModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Picker("Range", selection: $model.range) {
                    Text("Today").tag("day")
                    Text("This week").tag("week")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.top, 8)
                .onChange(of: model.range) { _, _ in Task { await model.reload() } }

                Group {
                    if model.isLoading && model.briefings.isEmpty {
                        ProgressView("Loading briefings…")
                    } else if model.briefings.isEmpty {
                        ContentUnavailableView("Nothing scheduled", systemImage: "calendar",
                            description: Text("No visits in this window."))
                    } else {
                        List(model.briefings) { b in BriefingRowView(briefing: b) }
                        #if os(macOS)
                        .listStyle(.inset)
                        #else
                        .listStyle(.insetGrouped)
                        #endif
                    }
                }
            }
            .navigationTitle("Pre-visit briefings")
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
}

private struct BriefingRowView: View {
    let briefing: Briefing
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(briefing.patientName ?? "Patient").font(.body.weight(.medium))
                if briefing.hasNewSinceLastView == true {
                    Text("NEW").font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.amber.opacity(0.22), in: Capsule())
                        .foregroundStyle(Theme.amber)
                }
                Spacer()
                if let starts = briefing.startsAt { Text(fmtEpoch(starts)).font(.caption).foregroundStyle(.secondary) }
            }
            HStack(spacing: 8) {
                if let v = briefing.visitType { Text(prettyVisitKey(v)) }
                if let m = briefing.modality { Text("· \(m)") }
            }.font(.caption).foregroundStyle(.secondary)
            if let s = briefing.summary, !s.isEmpty {
                Text(s).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
}
