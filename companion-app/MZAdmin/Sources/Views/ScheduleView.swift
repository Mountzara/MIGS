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

    @Published var busyIDs: Set<String> = []

    /// PATCH an appointment, then refresh the window.
    @discardableResult
    func update(_ id: String, fields: [String: Any]) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        error = nil
        do {
            _ = try await api.updateAppointment(id: id, fields: fields)
            await reload()
            return true
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
            return false
        }
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
    @State private var selected: Appointment?

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
                                ForEach(group.items) { appt in
                                    Button { selected = appt } label: { AppointmentRow(appt: appt) }
                                        .buttonStyle(.plain)
                                }
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
            .navigationDestination(item: $selected) { appt in
                AppointmentDetailView(appt: appt, model: model)
            }
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
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3).contentShape(Rectangle())
    }
}

// MARK: - Detail

/// Full appointment detail + clinician actions (complete / no-show / cancel /
/// reschedule / change modality) via PATCH /api/v1/admin/appointments/<id>.
struct AppointmentDetailView: View {
    let appt: Appointment
    @ObservedObject var model: ScheduleModel
    @Environment(\.dismiss) private var dismiss

    @State private var showCancel = false
    @State private var cancelReason = ""
    @State private var showReschedule = false
    @State private var newStart = Date()

    private var current: Appointment { model.appointments.first { $0.id == appt.id } ?? appt }
    private var busy: Bool { model.busyIDs.contains(appt.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                detailCard
                if let dc = current.deviceCheck { deviceCheckCard(dc) }
                actions
            }
            .padding(16)
        }
        .navigationTitle("Appointment")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showCancel) { cancelSheet }
        .sheet(isPresented: $showReschedule) { rescheduleSheet }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                Text(fmtEpoch(current.startsAt, dateStyle: .medium, timeStyle: .short))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text(current.patientName).font(.title3.bold())
            Text(prettyVisitKey(current.visitType)).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14).glassCard()
    }

    private var statusBadge: some View {
        let color: Color = {
            switch current.status {
            case "completed": return Theme.green
            case "cancelled": return Theme.red
            case "no_show": return Theme.amber
            default: return Theme.accentSoft
            }
        }()
        return Text(current.status.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule()).foregroundStyle(color)
    }

    private var detailCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Details", systemImage: "info.circle").font(.subheadline.weight(.semibold))
            row("When", fmtEpoch(current.startsAt, dateStyle: .full, timeStyle: .short))
            if let d = current.durationMin { row("Duration", "\(d) min") }
            if let m = current.modality { row("Modality", m == "telehealth" ? "Telehealth" : "In person") }
            if let cc = current.chiefComplaintSummary, !cc.isEmpty { row("Chief complaint", cc) }
            if let cr = current.cancellationReason, !cr.isEmpty { row("Cancellation reason", cr, accent: Theme.red) }
            if let url = current.doxyRoomUrl, !url.isEmpty { row("Doxy room", url) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14).glassCard()
    }

    private func deviceCheckCard(_ dc: AppointmentDeviceCheck) -> some View {
        let ok = dc.status == "passed"
        return VStack(alignment: .leading, spacing: 8) {
            Label("Telehealth device check", systemImage: ok ? "checkmark.seal" : "exclamationmark.triangle")
                .font(.subheadline.weight(.semibold)).foregroundStyle(ok ? Theme.green : Theme.amber)
            row("Status", (dc.status ?? "—").capitalized, accent: ok ? Theme.green : Theme.amber)
            if let k = dc.networkKbps { row("Network", "\(k) kbps") }
            if let f = dc.failures, !f.isEmpty { row("Failures", f.joined(separator: ", "), accent: Theme.red) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14).glassCard()
    }

    private func row(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
            Text(value).font(.subheadline).foregroundStyle(accent ?? .primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
    }

    @ViewBuilder
    private var actions: some View {
        if current.status == "scheduled" || current.status == "rescheduled" {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    actionButton("Complete", "checkmark", Theme.green) { Task { await patch(["status": "completed"]) } }
                    actionButton("No-show", "person.fill.xmark", Theme.amber) { Task { await patch(["status": "no_show"]) } }
                }
                HStack(spacing: 10) {
                    actionButton("Reschedule", "calendar", Theme.accentSoft) {
                        newStart = Date(timeIntervalSince1970: Double(current.startsAt) / 1000)
                        showReschedule = true
                    }
                    actionButton("Cancel", "xmark", Theme.red) { cancelReason = ""; showCancel = true }
                }
                if let m = current.modality {
                    actionButton(m == "telehealth" ? "Switch to in-person" : "Switch to telehealth",
                                 "arrow.left.arrow.right", Theme.accentSoft) {
                        Task { await patch(["modality": m == "telehealth" ? "in_person" : "telehealth"]) }
                    }
                }
            }
            .disabled(busy)
            .overlay { if busy { ProgressView() } }
        }
    }

    private func actionButton(_ title: String, _ icon: String, _ tint: Color, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { Label(title, systemImage: icon).frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent).tint(tint).controlSize(.large)
    }

    private func patch(_ fields: [String: Any]) async {
        if await model.update(appt.id, fields: fields) { dismiss() }
    }

    private var cancelSheet: some View {
        NavigationStack {
            Form {
                Section("Cancellation reason") {
                    TextField("Why is this appointment being cancelled?", text: $cancelReason, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Cancel appointment")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { showCancel = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Cancel appt", role: .destructive) {
                        Task {
                            await patch(["status": "cancelled",
                                         "cancellation_reason": cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)])
                            showCancel = false
                        }
                    }.disabled(cancelReason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private var rescheduleSheet: some View {
        NavigationStack {
            Form {
                Section("New start time") {
                    DatePicker("Starts at", selection: $newStart, displayedComponents: [.date, .hourAndMinute])
                }
            }
            .navigationTitle("Reschedule")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { showReschedule = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let ms = Int(newStart.timeIntervalSince1970 * 1000)
                            await patch(["status": "rescheduled", "starts_at": ms])
                            showReschedule = false
                        }
                    }
                }
            }
        }
    }
}
