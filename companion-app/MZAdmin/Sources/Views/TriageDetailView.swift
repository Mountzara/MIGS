import SwiftUI

/// The clinician's triage review: shows the AI recommendation, lets them
/// override visit type / duration / urgency / in-person / time-of-day, Save
/// the override (persists, survives reload — schema 0024), then Release the
/// final decision to the patient.
struct TriageDetailView: View {
    let row: TriageRow
    @ObservedObject var model: TriageModel
    @Environment(\.dismiss) private var dismiss

    @State private var visitType: String
    @State private var durationMin: Int
    @State private var urgency: String
    @State private var inPerson: Bool
    @State private var timeOfDay: String
    @State private var reason: String

    init(row: TriageRow, model: TriageModel) {
        self.row = row; self.model = model
        _visitType  = State(initialValue: row.clinicianOverrideVisitType ?? row.aiVisitType)
        _durationMin = State(initialValue: row.clinicianOverrideDurationMin ?? row.aiDurationMin)
        _urgency    = State(initialValue: row.clinicianOverrideUrgency ?? row.aiUrgency)
        _inPerson   = State(initialValue: row.clinicianOverrideInPersonRequired ?? row.aiInPersonRequired)
        _timeOfDay  = State(initialValue: row.clinicianOverridePreferredTimeOfDay ?? row.aiPreferredTimeOfDay ?? "any")
        _reason     = State(initialValue: row.clinicianOverrideReason ?? "")
    }

    private var busy: Bool { model.busyIDs.contains(row.id) }

    var body: some View {
        Form {
            Section("Patient") {
                LabeledContent("Name", value: row.patientName ?? "—")
                if let e = row.patientEmail { LabeledContent("Email", value: e) }
                if let a = row.ageYears { LabeledContent("Age", value: "\(a)") }
                if let cc = row.chiefComplaint, !cc.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Chief complaint").font(.caption).foregroundStyle(.secondary)
                        Text(cc).font(.callout)
                    }
                }
            }

            Section("AI recommendation") {
                LabeledContent("Visit type", value: model.label(for: row.aiVisitType))
                LabeledContent("Duration", value: "\(row.aiDurationMin) min")
                LabeledContent("Urgency", value: row.aiUrgency.capitalized)
                LabeledContent("In person", value: row.aiInPersonRequired ? "Required" : "Telehealth OK")
                if let r = row.aiRationale, !r.isEmpty {
                    Text(r).font(.callout).foregroundStyle(.secondary)
                }
            }

            Section("Your override") {
                Picker("Visit type", selection: $visitType) {
                    if model.visitTypes.isEmpty {
                        Text("⚠ visit types not loaded").tag(visitType)
                    }
                    ForEach(model.visitTypes) { vt in
                        Text("\(vt.label) · \(vt.durationMin)m").tag(vt.key)
                    }
                }
                Stepper("Duration: \(durationMin) min", value: $durationMin, in: 5...240, step: 5)
                Picker("Urgency", selection: $urgency) {
                    Text("Routine").tag("routine"); Text("Urgent").tag("urgent")
                }.pickerStyle(.segmented)
                Toggle("In-person required", isOn: $inPerson)
                Picker("Preferred time", selection: $timeOfDay) {
                    Text("Any").tag("any"); Text("Morning").tag("morning"); Text("Afternoon").tag("afternoon")
                }.pickerStyle(.segmented)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Override reason (optional)").font(.caption).foregroundStyle(.secondary)
                    TextField("Why you changed it", text: $reason, axis: .vertical).lineLimit(2...4)
                }
            }

            Section {
                Button { Task { await saveOverride() } } label: {
                    HStack { if busy { ProgressView().controlSize(.small) }; Text("Save override (don't release)") }
                }.disabled(busy || visitType.isEmpty)

                Button { Task { await release() } } label: {
                    HStack { if busy { ProgressView().controlSize(.small) }
                        Text("Release to patient").bold() }
                }
                .disabled(busy || visitType.isEmpty)
                .tint(Theme.green)
            } footer: {
                Text("Save keeps your edits without notifying the patient. Release stamps the final decision and sends it.")
            }
        }
        .navigationTitle(row.patientName ?? "Triage")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
    }

    private var overridePayload: TriageOverride {
        TriageOverride(visitType: visitType, durationMin: durationMin, urgency: urgency,
                       inPersonRequired: inPerson, preferredTimeOfDay: timeOfDay,
                       overrideReason: reason.isEmpty ? nil : reason)
    }
    private func saveOverride() async {
        guard !visitType.isEmpty else { return }
        if await model.save(row.id, overridePayload) { dismiss() }
    }
    private func release() async {
        guard !visitType.isEmpty else { return }
        // Persist the edits first so the released final reflects them, then release.
        _ = await model.save(row.id, overridePayload)
        if await model.release(row.id, visitType: visitType, durationMin: durationMin) { dismiss() }
    }
}

/// Shared bottom error toast used across the clinical screens.
struct ErrorBar: View {
    let text: String?
    var body: some View {
        if let text {
            Text(text).font(.footnote).foregroundStyle(.white)
                .padding(10).background(Theme.red.opacity(0.92), in: Capsule())
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
