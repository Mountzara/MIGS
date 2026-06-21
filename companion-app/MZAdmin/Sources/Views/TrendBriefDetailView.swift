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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let s = brief.suggestionsText, !s.isEmpty { suggestionsCard(s) }
                metadataCard
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Trend brief")
        .navigationBarBackButtonHidden(false)
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { approveSheet }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
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
            .disabled(model.busyIDs.contains(brief.id))
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
            }
            .navigationTitle("Approve brief")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showApproveSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Approve") {
                        Task {
                            let body = TrendBriefApproveBody(
                                verdict: verdict,
                                verdictLabel: verdictLabel.trimmingCharacters(in: .whitespacesAndNewlines),
                                rationale: rationale.trimmingCharacters(in: .whitespacesAndNewlines))
                            if await model.approve(brief.id, body) {
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
