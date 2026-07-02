import SwiftUI

private let VERDICTS = [
    "supported",
    "partially supported",
    "equipoise",
    "mechanism-plausible / not supported",
    "refuted",
]

struct TrendBriefDetailView: View {
    let brief: TrendBrief
    let model: TrendBriefsModel
    @Environment(\.dismiss) private var dismiss

    @State private var verdict: String = "equipoise"
    @State private var verdictLabel: String = ""
    @State private var rationale: String = ""
    @State private var rejectReason: String = ""
    @State private var showApproveSheet = false
    @State private var showRejectSheet = false

    // Full rendered brief + audit timeline (fetched on appear)
    @State private var previewHTML: String?
    @State private var bodyHeight: CGFloat = 360
    @State private var events: [TrendBriefEvent] = []
    @State private var loadingPreview = true

    // Optional editorial overrides applied at approval
    @State private var ovTitle = ""
    @State private var ovSummary = ""
    @State private var ovLede = ""
    @State private var ovTagline = ""
    @State private var ovTaglineBody = ""
    @State private var ovBottomLine = ""
    @State private var reviewerNotes = ""

    // Refine-in-Cowork (free-text revision suggestions)
    @State private var showRefineSheet = false
    @State private var refineText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let s = brief.suggestionsText, !s.isEmpty { suggestionsCard(s) }
                fullBriefCard
                metadataCard
                if !events.isEmpty { eventsCard }
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Trend brief")
        .navigationBarBackButtonHidden(false)
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { approveSheet }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
        .sheet(isPresented: $showRefineSheet) { refineSheet }
        .task { await loadDetail() }
    }

    private func loadDetail() async {
        if let d = await model.detail(brief.id) { events = d.events ?? [] }
        previewHTML = await model.previewHTML(brief.id)
        loadingPreview = false
    }

    /// The fully rendered brief, inline (the "complete posting"), via /preview.
    private var fullBriefCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Full brief", systemImage: "doc.richtext")
                .font(.subheadline.weight(.semibold))
            if let html = previewHTML, !html.isEmpty {
                HTMLView(html: html, height: $bodyHeight)
                    .frame(height: max(bodyHeight, 300))
            } else if loadingPreview {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading rendered brief…").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text("No rendered body is available for this brief yet.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var eventsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Audit timeline", systemImage: "clock.arrow.circlepath")
                .font(.subheadline.weight(.semibold))
            ForEach(events) { e in
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(Theme.accent.opacity(0.6)).frame(width: 6, height: 6).padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text((e.eventKind ?? "event").replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption.weight(.medium))
                        HStack(spacing: 6) {
                            if let who = e.actorLabel ?? e.actor, !who.isEmpty { Text(who) }
                            if let ts = e.ts { Text("· \(fmtEpoch(ts))") }
                        }.font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                if let d = brief.briefDate { Text(d).font(.caption).foregroundStyle(.secondary) }
            }
            Text(brief.claimText ?? brief.slug ?? brief.id).font(.headline)
            if let inf = brief.influencer, !inf.isEmpty {
                Text(inf).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch brief.status {
            case "approved": return ("APPROVED", Theme.green)
            case "rejected": return ("REJECTED", Theme.red)
            default: return ("PENDING REVIEW", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func suggestionsCard(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Verdict suggestions", systemImage: "lightbulb")
                .font(.subheadline.weight(.semibold))
            Text(text).font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var metadataCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Details", systemImage: "info.circle")
                .font(.subheadline.weight(.semibold))
            if let pass = brief.auditPassCount, let fail = brief.auditFailCount {
                row("Audit", "\(pass) pass · \(fail) fail",
                    accent: fail == 0 ? Theme.green : Theme.amber)
            }
            if let pmids = brief.pmidsCited, !pmids.isEmpty {
                row("PMIDs cited", "\(pmids.count)")
            }
            if let topics = brief.topicsCovered, !topics.isEmpty {
                row("Topics", topics.joined(separator: " · "))
            }
            if let at = brief.submittedAt {
                row("Submitted", fmtEpoch(at))
            }
            if let r = brief.statusReason, !r.isEmpty {
                row("Reason", r, accent: Theme.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func row(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            Text(value).font(.subheadline)
                .foregroundStyle(accent ?? .primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
    }

    @ViewBuilder
    private var actionsBar: some View {
        if brief.isPending {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    Button(role: .destructive) {
                        rejectReason = ""; showRejectSheet = true
                    } label: {
                        Text("Reject").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    Button {
                        verdictLabel = ""; rationale = ""
                        verdict = "equipoise"
                        showApproveSheet = true
                    } label: {
                        Text("Approve").bold().frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                }
                Button {
                    refineText = ""; showRefineSheet = true
                } label: {
                    Label("Refine in Cowork…", systemImage: "arrow.uturn.backward.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Theme.accentSoft)
            }
            .disabled(model.busyIDs.contains(brief.id))
        }
    }

    // MARK: - Refine sheet

    /// Free-text revision suggestions — flips the brief to needs_revision and
    /// queues it for the Cowork pipeline to re-author.
    private var refineSheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What should change? Be specific — this goes to the re-authoring run.",
                              text: $refineText, axis: .vertical)
                        .lineLimit(5...14)
                } header: { Text("Revision suggestions") } footer: {
                    Text("Sends the brief back for revision instead of approving or rejecting it.")
                }
            }
            .navigationTitle("Refine brief")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRefineSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send for revision") {
                        Task {
                            if await model.suggest(brief.id, suggestions: refineText.trimmingCharacters(in: .whitespacesAndNewlines)) {
                                showRefineSheet = false
                                dismiss()
                            }
                        }
                    }
                    .disabled(refineText.trimmingCharacters(in: .whitespaces).count < 10)
                }
            }
        }
    }

    // MARK: - Approve sheet

    private var approveSheet: some View {
        NavigationStack {
            Form {
                Section("Verdict") {
                    Picker("Verdict", selection: $verdict) {
                        ForEach(VERDICTS, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Verdict label (shown on gauge)", text: $verdictLabel, axis: .vertical)
                        .lineLimit(2...4)
                }
                Section("Rationale") {
                    TextField("Required — audit-trail justification", text: $rationale, axis: .vertical)
                        .lineLimit(3...8)
                }
                Section {
                    TextField("Title", text: $ovTitle, axis: .vertical).lineLimit(1...3)
                    TextField("Summary", text: $ovSummary, axis: .vertical).lineLimit(2...5)
                    TextField("Lede", text: $ovLede, axis: .vertical).lineLimit(2...5)
                    TextField("Tagline", text: $ovTagline, axis: .vertical).lineLimit(1...3)
                    TextField("Tagline body", text: $ovTaglineBody, axis: .vertical).lineLimit(2...5)
                    TextField("Bottom line", text: $ovBottomLine, axis: .vertical).lineLimit(2...5)
                } header: {
                    Text("Editorial overrides — optional")
                } footer: {
                    Text("Leave blank to keep the rendered brief's copy. Anything entered overwrites it on re-render.")
                }
                Section("Reviewer notes — not published") {
                    TextField("Internal note", text: $reviewerNotes, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle("Approve brief")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showApproveSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Approve") {
                        Task {
                            func clean(_ s: String) -> String? {
                                let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                                return t.isEmpty ? nil : t
                            }
                            var approveBody = TrendBriefApproveBody(
                                verdict: verdict,
                                verdictLabel: verdictLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                                rationale: rationale.trimmingCharacters(in: .whitespacesAndNewlines))
                            approveBody.title = clean(ovTitle)
                            approveBody.summary = clean(ovSummary)
                            approveBody.lede = clean(ovLede)
                            approveBody.tagline = clean(ovTagline)
                            approveBody.taglineBody = clean(ovTaglineBody)
                            approveBody.bottomLine = clean(ovBottomLine)
                            approveBody.reviewerNotes = clean(reviewerNotes)
                            if await model.approve(brief.id, approveBody) {
                                showApproveSheet = false
                                dismiss()
                            }
                        }
                    }
                    .disabled(verdictLabel.trimmingCharacters(in: .whitespaces).isEmpty
                              || rationale.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private var rejectSheet: some View {
        NavigationStack {
            Form {
                Section("Reason") {
                    TextField("Required — why this brief was rejected", text: $rejectReason, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle("Reject brief")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRejectSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reject", role: .destructive) {
                        Task {
                            if await model.reject(brief.id, reason: rejectReason.trimmingCharacters(in: .whitespacesAndNewlines)) {
                                showRejectSheet = false
                                dismiss()
                            }
                        }
                    }
                    .disabled(rejectReason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
