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

    /// Full pre-visit briefing for one row.
    func detail(_ b: Briefing) async -> BriefingDetail? {
        guard let pid = b.patientId else { return nil }
        return try? await api.briefingDetail(patientId: pid, appointmentId: b.appointmentId)
    }
}

struct BriefingsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: BriefingsModel
    @State private var selected: Briefing?
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
                        List(model.briefings) { b in
                            Button { selected = b } label: { BriefingRowView(briefing: b) }
                                .buttonStyle(.plain)
                        }
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
            .navigationDestination(item: $selected) { b in
                BriefingDetailView(briefing: b, model: model)
            }
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
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}

// MARK: - Full briefing detail

/// The complete pre-visit briefing for one patient — every section the
/// backend composes, rendered read-only. Crash-safe: each card only shows
/// when its data is present.
struct BriefingDetailView: View {
    let briefing: Briefing
    @ObservedObject var model: BriefingsModel
    @State private var d: BriefingDetail?
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let d {
                    Group { headerCard(d); ledeCard(d); watchCard(d); triageCard(d); snapshotCard(d) }
                    Group { questionsCard(d); obCard(d); medHistoryCard(d); medsCard(d); allergiesCard(d) }
                    Group { surgeriesCard(d); imagingCard(d); encountersCard(d); promCard(d); medWatchCard(d) }
                    Group { notesCard(d); intakeCard(d); documentsCard(d) }
                } else if loading {
                    ProgressView("Composing briefing…").frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    ContentUnavailableView("Briefing unavailable", systemImage: "doc.questionmark",
                        description: Text("Couldn't load this patient's briefing."))
                }
            }
            .padding(16)
        }
        .navigationTitle(briefing.patientName ?? "Briefing")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { d = await model.detail(briefing); loading = false }
    }

    // MARK: card scaffolding
    private func card<C: View>(_ title: String, _ icon: String, accent: Color = Theme.accentSoft,
                               @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.subheadline.weight(.semibold)).foregroundStyle(accent)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(14).glassCard()
    }
    private func kv(_ label: String, _ value: String?, accent: Color? = nil) -> some View {
        Group {
            if let v = value, !v.isEmpty {
                HStack(alignment: .top) {
                    Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
                    Text(v).font(.subheadline).foregroundStyle(accent ?? .primary).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }
            }
        }
    }
    private func bullets(_ title: String, _ items: [String]?) -> some View {
        Group {
            if let items, !items.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(Array(items.enumerated()), id: \.offset) { _, s in
                        Text("• \(s)").font(.caption).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // MARK: cards
    @ViewBuilder private func headerCard(_ d: BriefingDetail) -> some View {
        card("Patient", "person.crop.circle", accent: Theme.accent) {
            kv("Name", d.patient?.displayName ?? d.patient?.fullName ?? briefing.patientName)
            if let a = d.patient?.age { kv("Age", "\(a)") }
            kv("Pronouns", d.patient?.pronouns)
            if let f = d.appointmentFocus {
                kv("Visit", [f.visitType.map(prettyVisitKey), f.modality].compactMap { $0 }.joined(separator: " · "))
                kv("When", f.startsAt)
                kv("Chief complaint", f.chiefComplaintSummary)
            }
        }
    }
    @ViewBuilder private func ledeCard(_ d: BriefingDetail) -> some View {
        if let l = d.executiveLede, !l.isEmpty {
            card("Executive summary", "text.alignleft", accent: Theme.accent) {
                Text(l).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    @ViewBuilder private func watchCard(_ d: BriefingDetail) -> some View {
        if let w = d.watchFor, !w.isEmpty {
            card("Watch for", "exclamationmark.triangle", accent: Theme.amber) {
                ForEach(Array(w.enumerated()), id: \.offset) { _, item in
                    let c: Color = item.severity == "high" ? Theme.red : (item.severity == "medium" ? Theme.amber : Theme.accentSoft)
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(c).frame(width: 6, height: 6).padding(.top, 5)
                        Text(item.label ?? item.kind ?? "—").font(.caption).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                    }
                }
            }
        }
    }
    @ViewBuilder private func triageCard(_ d: BriefingDetail) -> some View {
        if let t = d.triage {
            card("Triage", "arrow.triangle.branch") {
                kv("Visit type", t.visitType.map(prettyVisitKey))
                kv("Urgency", t.urgency?.capitalized)
                if let ip = t.inPersonRequired { kv("Setting", ip ? "In-person required" : "Telehealth OK") }
                kv("Rationale", t.rationale)
                bullets("Secondary concerns", t.secondaryConcerns)
            }
        }
    }
    @ViewBuilder private func snapshotCard(_ d: BriefingDetail) -> some View {
        if let s = d.snapshotSummary {
            card("Clinical snapshot", "doc.text.magnifyingglass") {
                kv("Chief complaint", s.chiefComplaint)
                if let e = s.executiveSummary, !e.isEmpty { Text(e).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                bullets("Patient goals", s.patientGoals)
                bullets("AI recommendations", s.aiRecommendations)
                bullets("Surgical history", s.surgicalHistory)
            }
        }
    }
    @ViewBuilder private func questionsCard(_ d: BriefingDetail) -> some View {
        if let q = d.suggestedQuestions, !q.isEmpty {
            card("Suggested questions", "questionmark.bubble") { bullets("", q) }
        }
    }
    @ViewBuilder private func obCard(_ d: BriefingDetail) -> some View {
        if let o = d.obstetricHistory {
            card("Obstetric history", "figure.and.child.holdinghands") {
                if let g = o.gravida { kv("Gravida", "\(g)") }
                kv("Para", o.paraSimple)
                if o.wantsFuturePregnancy == true { kv("Fertility", "Desires future pregnancy") }
                if o.ttcNow == true { kv("TTC", "Trying to conceive now", accent: Theme.amber) }
                if o.infertilityFlag == true { kv("Flag", "Infertility history", accent: Theme.amber) }
            }
        }
    }
    @ViewBuilder private func medHistoryCard(_ d: BriefingDetail) -> some View {
        if let m = d.medicalHistory {
            card("Medical history", "heart.text.square") {
                bullets("Conditions", m.otherConditions)
                bullets("GYN conditions", m.gynConditions)
                bullets("Anticoagulants", m.anticoagulants)
                bullets("Hormone therapy", m.hormoneTx)
                if let g = m.glp1Use, !g.isEmpty {
                    bullets("GLP-1 use", g.map { [$0.drug, $0.lastDoseDate].compactMap { $0 }.joined(separator: " · ") })
                }
                if let e = m.erasPositives, !e.isEmpty {
                    bullets("ERAS positives", e.map { [$0.label, $0.detail].compactMap { $0 }.joined(separator: ": ") })
                }
            }
        }
    }
    @ViewBuilder private func medsCard(_ d: BriefingDetail) -> some View {
        if let m = d.currentMedications {
            card("Current medications", "pills") {
                kv("Pain", m.painMeds)
                kv("Contraceptive/hormone", m.contraceptivesHormones)
                kv("Other", m.otherMeds)
            }
        }
    }
    @ViewBuilder private func allergiesCard(_ d: BriefingDetail) -> some View {
        if let a = d.allergies {
            card("Allergies", "allergens", accent: Theme.amber) {
                if a.hasDrugAllergies == true { kv("Drug allergies", "Yes", accent: Theme.red) }
                if a.hasLatexAllergy == true { kv("Latex", "Yes", accent: Theme.amber) }
                kv("List", a.list)
                if a.hasDrugAllergies != true && a.hasLatexAllergy != true && (a.list ?? "").isEmpty {
                    Text("No known allergies").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
    @ViewBuilder private func surgeriesCard(_ d: BriefingDetail) -> some View {
        if let p = d.pastSurgeries, (p.count ?? 0) > 0 || !(p.items ?? []).isEmpty {
            card("Past surgeries", "cross.case") {
                if let items = p.items, !items.isEmpty {
                    bullets("", items.map { [$0.label, $0.year].compactMap { $0 }.joined(separator: " · ") })
                }
                kv("Findings", p.findingsText)
            }
        }
    }
    @ViewBuilder private func imagingCard(_ d: BriefingDetail) -> some View {
        if let i = d.imagingSummary {
            card("Imaging", "waveform.path.ecg.rectangle") {
                kv("TVUS date", i.tvusDate)
                kv("Endometrial thickness", i.endometrialThicknessMm.map { "\($0) mm" })
                kv("Fibroids", i.fibroidCount)
                kv("Largest fibroid", i.largestFibroidSizeCm.map { "\($0) cm" })
                if i.hadPelvicMri == true { kv("Pelvic MRI", i.pelvicMriDate ?? "Yes") }
                if i.hadHsg == true { kv("HSG", "Yes") }
                if i.hadSonohysterography == true { kv("Sonohysterography", "Yes") }
            }
        }
    }
    @ViewBuilder private func encountersCard(_ d: BriefingDetail) -> some View {
        if let e = d.recentEncounters, !e.isEmpty {
            card("Recent encounters", "calendar.badge.clock") {
                ForEach(Array(e.enumerated()), id: \.offset) { _, enc in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(enc.visitDate ?? "—").font(.caption.weight(.medium))
                            if let v = enc.visitType { Text("· \(prettyVisitKey(v))").font(.caption2).foregroundStyle(.secondary) }
                            Spacer()
                        }
                        if let cc = enc.chiefComplaint, !cc.isEmpty { Text(cc).font(.caption2).foregroundStyle(.secondary) }
                    }.padding(.vertical, 1)
                }
            }
        }
    }
    @ViewBuilder private func promCard(_ d: BriefingDetail) -> some View {
        if let p = d.promTrends, !p.isEmpty {
            card("PROM trends", "chart.line.uptrend.xyaxis") {
                ForEach(Array(p.enumerated()), id: \.offset) { _, t in
                    HStack {
                        Text(t.shortName ?? t.title ?? "—").font(.caption.weight(.medium))
                        Spacer()
                        if let s = t.latestScore { Text(String(format: "%.0f", s)).font(.caption) }
                        if let dl = t.delta, dl != 0 {
                            Text(dl > 0 ? "▲\(String(format: "%.0f", dl))" : "▼\(String(format: "%.0f", abs(dl)))")
                                .font(.caption2).foregroundStyle(dl > 0 ? Theme.red : Theme.green)
                        }
                    }
                }
            }
        }
    }
    @ViewBuilder private func medWatchCard(_ d: BriefingDetail) -> some View {
        let active = (d.medicationWatch ?? []).filter { ($0.advisory ?? "").isEmpty == false }
        if !active.isEmpty {
            card("Medication AE watch", "cross.vial", accent: Theme.amber) {
                ForEach(Array(active.enumerated()), id: \.offset) { _, w in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(w.drug ?? "—").font(.caption.weight(.semibold))
                        if let a = w.advisory { Text(a).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                    }.padding(.vertical, 1)
                }
            }
        }
    }
    @ViewBuilder private func notesCard(_ d: BriefingDetail) -> some View {
        let notes = d.personalTouchpoints ?? d.allPersonalNotes
        if let notes, !notes.isEmpty {
            card("Personal notes", "bookmark") {
                ForEach(Array(notes.enumerated()), id: \.offset) { _, n in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            if n.isPinned == true { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Theme.amber) }
                            Text(n.summary ?? n.category ?? "Note").font(.caption.weight(.medium))
                            Spacer()
                        }
                        if let b = n.body, !b.isEmpty { Text(b).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                    }.padding(.vertical, 1)
                }
            }
        }
    }
    @ViewBuilder private func intakeCard(_ d: BriefingDetail) -> some View {
        if let i = d.intakeSummary {
            card("Intake", "doc.text") {
                kv("Status", i.status?.capitalized)
                if let p = i.completionPct { kv("Completion", "\(p)%") }
                kv("Submitted", i.submittedAt)
            }
        }
    }
    @ViewBuilder private func documentsCard(_ d: BriefingDetail) -> some View {
        if let docs = d.uploadedDocuments, !docs.isEmpty {
            card("Uploaded documents", "paperclip") {
                ForEach(Array(docs.enumerated()), id: \.offset) { _, doc in
                    HStack {
                        Text(doc.originalFilename ?? doc.kind ?? "Document").font(.caption).lineLimit(1)
                        Spacer()
                        if let s = doc.sizeBytes { Text("\(s / 1024) KB").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
        }
    }
}
