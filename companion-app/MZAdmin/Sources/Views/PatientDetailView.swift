import SwiftUI

@MainActor
final class PatientDetailModel: ObservableObject {
    @Published var detail: PatientDetailResponse?
    @Published var whatsNew: WhatsNewResponse?
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    let patientID: String
    init(auth: AuthStore, patientID: String) {
        self.auth = auth
        self.patientID = patientID
    }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    /// PATCH the patient's editable profile fields, then refresh.
    @discardableResult
    func updateProfile(_ fields: [String: Any]) async -> Bool {
        error = nil
        do {
            try await api.updatePatient(id: patientID, fields: fields)
            await reload()
            return true
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
            return false
        }
    }

    func reload() async {
        isLoading = true; error = nil
        do {
            async let d = api.patient(id: patientID)
            async let wn = api.caseWhatsNew(patientId: patientID)
            detail = try await d
            whatsNew = try? await wn   // tolerate whats-new failures separately
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func markViewed() async {
        do { try await api.markCaseViewed(patientId: patientID); await reload() }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct PatientDetailView: View {
    let patient: Patient
    let auth: AuthStore
    @StateObject private var model: PatientDetailModel
    @State private var showEdit = false

    init(patient: Patient, auth: AuthStore) {
        self.patient = patient
        self.auth = auth
        _model = StateObject(wrappedValue: PatientDetailModel(auth: auth, patientID: patient.id))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let wn = model.whatsNew { whatsNewPanel(wn) }
                summarySection
            }
            .padding(16)
        }
        .navigationTitle(patient.displayName)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if model.detail?.patient != nil {
                    Button { showEdit = true } label: { Image(systemName: "pencil") }
                        .help("Edit patient profile")
                }
                Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
            }
        }
        .refreshable { await model.reload() }
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showEdit) {
            if let full = model.detail?.patient {
                PatientEditView(patient: full, model: model)
            }
        }
        .task { await model.reload() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(model.detail?.patient.displayName ?? patient.displayName)
                .font(.title2.weight(.semibold))
            HStack(spacing: 10) {
                Text(patient.email).lineLimit(1).truncationMode(.middle)
                if let age = model.detail?.patient.ageYears { Text("· \(age) yo") }
                if let status = model.detail?.patient.status, status != "active" {
                    Text(status.uppercased()).font(.caption2.bold()).foregroundStyle(Theme.amber)
                }
            }.font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassCard()
    }

    // MARK: - What's new

    @ViewBuilder
    private func whatsNewPanel(_ wn: WhatsNewResponse) -> some View {
        let events = wn.events ?? []
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("What's new", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button { Task { await model.markViewed() } } label: {
                    Text("Mark seen").font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(events.isEmpty)
            }

            if events.isEmpty {
                Text(wn.firstVisit == true
                     ? "First view of this case — last 30 days shown below as it arrives."
                     : "Nothing new since your last view.")
                    .font(.footnote).foregroundStyle(.secondary)
            } else {
                if let counts = wn.counts {
                    HStack(spacing: 8) {
                        if let urgent = counts.bySeverity?["urgent"], urgent > 0 {
                            Text("\(urgent) urgent")
                                .font(.caption2.bold())
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Theme.red.opacity(0.22), in: Capsule())
                                .foregroundStyle(Theme.red)
                        }
                        if let warn = counts.bySeverity?["warning"], warn > 0 {
                            Text("\(warn) warning")
                                .font(.caption2.bold())
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Theme.amber.opacity(0.22), in: Capsule())
                                .foregroundStyle(Theme.amber)
                        }
                        if let info = counts.bySeverity?["info"], info > 0 {
                            Text("\(info) info")
                                .font(.caption2.bold())
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Theme.accentSoft.opacity(0.22), in: Capsule())
                                .foregroundStyle(Theme.accentSoft)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(events.prefix(20)) { e in EventRow(event: e) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassCard()
    }

    // MARK: - Summary cards

    @ViewBuilder
    private var summarySection: some View {
        if let s = model.detail?.summary {
            VStack(alignment: .leading, spacing: 10) {
                Text("At a glance").font(.subheadline.weight(.semibold))
                if let intake = s.intake {
                    summaryRow(icon: "doc.text", label: "Intake",
                               value: "\(intake.status?.capitalized ?? "—") · \(Int((intake.completionPct ?? 0) * 100))%")
                }
                if let triage = s.triage {
                    summaryRow(icon: "stethoscope", label: "Triage",
                               value: "\(prettyVisitKey(triage.visitType ?? "—"))  ·  \(triage.urgency?.capitalized ?? "—")",
                               accent: triage.urgency == "urgent" ? Theme.red : nil)
                }
                if let next = s.nextAppointment {
                    summaryRow(icon: "calendar", label: "Next visit",
                               value: "\(prettyVisitKey(next.visitType ?? "—"))  ·  \(fmtEpoch(next.startsAt))")
                }
                if let last = s.lastAppointment {
                    summaryRow(icon: "calendar.badge.clock", label: "Last visit",
                               value: "\(prettyVisitKey(last.visitType ?? "—"))  ·  \(fmtEpoch(last.startsAt))")
                }
                if let msg = s.messages {
                    summaryRow(icon: "bubble.left.and.bubble.right", label: "Messages",
                               value: "\(msg.threadCount ?? 0) threads, \(msg.unreadForClinician ?? 0) unread",
                               accent: (msg.unreadForClinician ?? 0) > 0 ? Theme.amber : nil)
                }
                if let sx = s.symptoms {
                    summaryRow(icon: "waveform.path.ecg", label: "Symptoms",
                               value: "\(sx.entryCount ?? 0) entries  ·  last \(sx.latestEntryDate ?? "—")")
                }
                if let docs = s.documents {
                    summaryRow(icon: "folder", label: "Documents",
                               value: "\(docs.count ?? 0)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .glassCard()
        }
    }

    private func summaryRow(icon: String, label: String, value: String, accent: Color? = nil) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(accent ?? Theme.accentSoft)
                .frame(width: 22, alignment: .center)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.subheadline)
            }
            Spacer()
        }
    }
}

private struct EventRow: View {
    let event: CaseEvent
    private var color: Color {
        switch event.severity {
        case "urgent": return Theme.red
        case "warning": return Theme.amber
        default: return Theme.accentSoft
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(color).frame(width: 7, height: 7).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.eventSummary ?? prettyVisitKey(event.eventType))
                    .font(.subheadline)
                HStack(spacing: 6) {
                    Text(event.eventType)
                    if let at = event.occurredAt { Text("· \(at)") }
                }.font(.caption2).foregroundStyle(.tertiary)
            }
            Spacer()
        }
    }
}

// MARK: - Profile editor

/// Editor for the patient profile fields the backend PATCH allows:
/// preferred_name, phone, pronouns, preferred_language, timezone, mrn, status.
struct PatientEditView: View {
    let patient: PatientFull
    @ObservedObject var model: PatientDetailModel
    @Environment(\.dismiss) private var dismiss

    @State private var preferredName: String
    @State private var phone: String
    @State private var pronouns: String
    @State private var language: String
    @State private var timezone: String
    @State private var mrn: String
    @State private var status: String
    @State private var saving = false

    private let statuses = ["active", "suspended", "closed"]

    init(patient: PatientFull, model: PatientDetailModel) {
        self.patient = patient
        self.model = model
        _preferredName = State(initialValue: patient.preferredName ?? "")
        _phone = State(initialValue: patient.phone ?? "")
        _pronouns = State(initialValue: patient.pronouns ?? "")
        _language = State(initialValue: patient.preferredLanguage ?? "")
        _timezone = State(initialValue: patient.timezone ?? "")
        _mrn = State(initialValue: patient.mrn ?? "")
        _status = State(initialValue: patient.status ?? "active")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identity — read-only") {
                    LabeledContent("Name",
                        value: [patient.firstName, patient.lastName].compactMap { $0 }.joined(separator: " "))
                    LabeledContent("Email", value: patient.email)
                    if let d = patient.dob { LabeledContent("DOB", value: d) }
                }
                Section("Profile") {
                    TextField("Preferred name", text: $preferredName)
                    TextField("Phone", text: $phone)
                        #if os(iOS)
                        .keyboardType(.phonePad)
                        #endif
                    TextField("Pronouns", text: $pronouns)
                    TextField("Preferred language", text: $language)
                    TextField("Timezone — e.g. America/Chicago", text: $timezone)
                    TextField("MRN", text: $mrn)
                }
                Section("Account status") {
                    Picker("Status", selection: $status) {
                        ForEach(statuses, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }
            }
            .navigationTitle("Edit patient")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() }
                    else { Button("Save") { Task { await save() } } }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 540)
        #endif
    }

    private func save() async {
        saving = true; defer { saving = false }
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let fields: [String: Any] = [
            "preferred_name": t(preferredName),
            "phone": t(phone),
            "pronouns": t(pronouns),
            "preferred_language": t(language),
            "timezone": t(timezone),
            "mrn": t(mrn),
            "status": status,
        ]
        if await model.updateProfile(fields) { dismiss() }
    }
}
