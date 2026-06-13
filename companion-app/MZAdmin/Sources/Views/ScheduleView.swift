import SwiftUI

@MainActor
final class ScheduleModel: ObservableObject {
    @Published var appointments: [Appointment] = []
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    func reload() async {
        isLoading = true; error = nil
        let cal = Calendar.current
        let from = Date()
        let to = cal.date(byAdding: .day, value: 30, to: from) ?? from
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        do {
            appointments = try await api.listAppointments(from: f.string(from: from), to: f.string(from: to))
                .sorted { $0.startsAt < $1.startsAt }
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    /// Group upcoming appointments by calendar day for a sectioned list.
    var byDay: [(day: String, items: [Appointment])] {
        let f = DateFormatter(); f.dateStyle = .full; f.timeStyle = .none
        let groups = Dictionary(grouping: appointments) {
            f.string(from: Date(timeIntervalSince1970: Double($0.startsAt) / 1000))
        }
        return groups.keys.sorted { (groups[$0]?.first?.startsAt ?? 0) < (groups[$1]?.first?.startsAt ?? 0) }
            .map { (day: $0, items: groups[$0] ?? []) }
    }
}

struct ScheduleView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: ScheduleModel

    init(auth: AuthStore) { _model = StateObject(wrappedValue: ScheduleModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.appointments.isEmpty {
                    ProgressView("Loading schedule…")
                } else if model.appointments.isEmpty {
                    ContentUnavailableView("Nothing scheduled",
                        systemImage: "calendar",
                        description: Text("No appointments in the next 30 days."))
                } else {
                    List {
                        ForEach(model.byDay, id: \.day) { group in
                            Section(group.day) {
                                ForEach(group.items) { appt in AppointmentRow(appt: appt) }
                            }
                        }
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Schedule")
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

private struct AppointmentRow: View {
    let appt: Appointment
    private var statusColor: Color {
        switch appt.status {
        case "cancelled": return Theme.red
        case "completed": return Theme.green
        default: return Theme.accentSoft
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 2) {
                Text(fmtEpoch(appt.startsAt, dateStyle: .none, timeStyle: .short))
                    .font(.callout.weight(.semibold))
                if let d = appt.durationMin { Text("\(d)m").font(.caption2).foregroundStyle(.tertiary) }
            }
            .frame(width: 64, alignment: .leading)
            Rectangle().fill(statusColor).frame(width: 3).cornerRadius(2)
            VStack(alignment: .leading, spacing: 3) {
                Text(appt.patientName).font(.body.weight(.medium))
                HStack(spacing: 8) {
                    Text(prettyVisitKey(appt.visitType))
                    if let m = appt.modality { Label(m, systemImage: m == "telehealth" ? "video" : "person") }
                    if appt.status != "scheduled" { Text(appt.status.capitalized).foregroundStyle(statusColor) }
                }.font(.caption).foregroundStyle(.secondary)
                if let cc = appt.chiefComplaintSummary, !cc.isEmpty {
                    Text(cc).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.vertical, 3)
    }
}
