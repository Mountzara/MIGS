import SwiftUI

@MainActor
final class PatientsModel: ObservableObject {
    @Published var patients: [Patient] = []
    @Published var query: String = ""
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    private var searchTask: Task<Void, Never>?
    private var latestSeq = 0
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    func reload() async { await fetch(seq: nil) }

    /// Debounced search — fires 300ms after the user stops typing.
    func scheduleSearch() {
        searchTask?.cancel()
        latestSeq += 1
        let mySeq = latestSeq
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if Task.isCancelled { return }
            await self?.fetch(seq: mySeq)
        }
    }

    /// `seq == nil` is an explicit reload (always applied). A debounced search
    /// passes its sequence number and its result is dropped if a newer search
    /// has since started — so a slow earlier fetch can't overwrite fresh data.
    private func fetch(seq: Int?) async {
        isLoading = true; error = nil
        do {
            let result = try await api.listPatients(query: query)
            guard seq == nil || seq == latestSeq else { return }
            patients = result
        } catch {
            guard seq == nil || seq == latestSeq else { return }
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        if seq == nil || seq == latestSeq { isLoading = false }
    }
}

struct PatientsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: PatientsModel
    @State private var selected: Patient?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: PatientsModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.patients.isEmpty {
                    ProgressView("Loading patients…")
                } else if model.patients.isEmpty {
                    ContentUnavailableView(
                        model.query.isEmpty ? "No patients yet" : "No matches",
                        systemImage: "person.2",
                        description: Text(model.query.isEmpty
                            ? "Patient records will appear here."
                            : "Try a different name or email."))
                } else {
                    List(model.patients) { p in
                        Button { selected = p } label: { PatientRowView(patient: p) }
                            .buttonStyle(.plain)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Patients")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .searchable(text: $model.query, prompt: "Search by name or email")
            .onChange(of: model.query) { _, _ in model.scheduleSearch() }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { p in
                PatientDetailView(patient: p, auth: auth)
            }
        }
        .task { await model.reload() }
    }
}

private struct PatientRowView: View {
    let patient: Patient
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.accentSoft.opacity(0.55))
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(patient.displayName).font(.body.weight(.medium))
                HStack(spacing: 8) {
                    Text(patient.email).lineLimit(1).truncationMode(.middle)
                    if let s = patient.status, s != "active" {
                        Text(s.uppercased()).font(.caption2.bold()).foregroundStyle(Theme.amber)
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
