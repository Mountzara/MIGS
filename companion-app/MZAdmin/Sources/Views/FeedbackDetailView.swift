import SwiftUI

struct FeedbackDetailView: View {
    let item: Feedback
    let model: FeedbackModel
    @Environment(\.dismiss) private var dismiss

    @State private var note = ""
    @State private var rejectReason = ""
    @State private var rejectKind: String = "rejected"
    @State private var showApproveSheet = false
    @State private var showRejectSheet = false
    @State private var screenshot: Data?
    @State private var screenshotError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let comment = item.commentText, !comment.isEmpty { commentCard(comment) }
                if let rec = item.aiRecommendation { aiCard(rec) }
                if item.hasScreenshot == true { screenshotCard }
                metadataCard
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Feedback")
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { approveSheet }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
        .task { if item.hasScreenshot == true { await loadScreenshot() } }
    }

    private func loadScreenshot() async {
        screenshotError = nil
        do { screenshot = try await model.api.feedbackScreenshot(id: item.id) }
        catch { screenshotError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription }
    }

    private var header: some View {
        HStack {
            statusBadge
            Spacer()
            if let t = item.feedbackType {
                Text(t.uppercased()).font(.caption2.bold()).foregroundStyle(.secondary)
            }
            if let s = item.severity {
                Text(s.uppercased()).font(.caption2.bold())
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(severityColor.opacity(0.22), in: Capsule())
                    .foregroundStyle(severityColor)
            }
        }
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch item.status {
            case "approved": return ("APPROVED", Theme.green)
            case "implemented": return ("IMPLEMENTED", Theme.accentSoft)
            case "rejected": return ("REJECTED", Theme.red)
            case "wont_fix": return ("WON'T FIX", Theme.red)
            case "ai_analyzed": return ("AI ANALYZED", Theme.amber)
            default: return ("NEW", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    private var severityColor: Color {
        switch item.severity {
        case "urgent", "high": return Theme.red
        case "medium": return Theme.amber
        default: return Theme.accentSoft
        }
    }

    private func commentCard(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("From the tester", systemImage: "quote.bubble")
                .font(.subheadline.weight(.semibold))
            Text(text).font(.body).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func aiCard(_ r: Feedback.AIRecommendation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("AI recommendation", systemImage: "wand.and.stars")
                .font(.subheadline.weight(.semibold))
            if let summary = r.summary { textRow("Summary", summary) }
            if let cause = r.rootCause { textRow("Root cause", cause) }
            if let change = r.proposedChange { textRow("Proposed change", change) }
            if let files = r.filesToEdit, !files.isEmpty {
                textRow("Files", files.joined(separator: "\n"))
            }
            if let rationale = r.rationale { textRow("Rationale", rationale) }
            HStack(spacing: 14) {
                if let s = r.severity { metaChip("severity: \(s)") }
                if let e = r.effort { metaChip("effort: \(e)") }
                if let c = r.confidence { metaChip("confidence: \(Int(c * 100))%") }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func textRow(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func metaChip(_ s: String) -> some View {
        Text(s).font(.caption2).foregroundStyle(.secondary)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.surface, in: Capsule())
    }

    @ViewBuilder
    private var screenshotCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Screenshot", systemImage: "camera")
                .font(.subheadline.weight(.semibold))
            if let data = screenshot {
                #if os(iOS)
                if let ui = UIImage(data: data) {
                    Image(uiImage: ui).resizable().scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                #elseif os(macOS)
                if let ns = NSImage(data: data) {
                    Image(nsImage: ns).resizable().scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                #endif
            } else if let err = screenshotError {
                Label("Couldn't load screenshot — \(err)", systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(Theme.amber)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ProgressView().frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var metadataCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Details", systemImage: "info.circle")
                .font(.subheadline.weight(.semibold))
            if let r = item.route { kvRow("Route", r) }
            if let l = item.inviteLabel { kvRow("Invite", l) }
            if let c = item.createdAt { kvRow("Submitted", fmtEpoch(c)) }
            if let s = item.statusReason, !s.isEmpty { kvRow("Reason", s) }
            if let by = item.approvedBy { kvRow("Approved by", by) }
            if let commit = item.implementedInCommit { kvRow("Commit", commit) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func kvRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(.secondary)
                .frame(width: 110, alignment: .leading)
            Text(value).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
    }

    @ViewBuilder
    private var actionsBar: some View {
        if item.isPending || item.isApproved {
            HStack(spacing: 12) {
                Button(role: .destructive) {
                    rejectReason = ""; rejectKind = "rejected"; showRejectSheet = true
                } label: { Text("Reject").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)

                if item.isPending {
                    Button {
                        note = ""; showApproveSheet = true
                    } label: { Text("Approve").bold().frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(item.aiRecommendation == nil)
                }
            }
            .disabled(model.busyIDs.contains(item.id))
            if item.isPending && item.aiRecommendation == nil {
                Text("Awaiting AI recommendation — approve unlocks once a Claude recommendation is attached.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private var approveSheet: some View {
        NavigationStack {
            Form {
                Section("Approval note (optional)") {
                    TextField("Note to attach to the audit event", text: $note, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Approve")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showApproveSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Approve") {
                        Task {
                            if await model.approve(item.id, note: note.trimmingCharacters(in: .whitespacesAndNewlines)) {
                                showApproveSheet = false; dismiss()
                            }
                        }
                    }
                }
            }
        }
    }

    private var rejectSheet: some View {
        NavigationStack {
            Form {
                Section("Reason (optional)") {
                    TextField("Why this feedback was rejected", text: $rejectReason, axis: .vertical)
                        .lineLimit(3...6)
                }
                Section("Kind") {
                    Picker("Kind", selection: $rejectKind) {
                        Text("Rejected").tag("rejected")
                        Text("Won't fix").tag("wont_fix")
                    }.pickerStyle(.segmented)
                }
            }
            .navigationTitle("Reject")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRejectSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Confirm", role: .destructive) {
                        Task {
                            let reason = rejectReason.trimmingCharacters(in: .whitespacesAndNewlines)
                            if await model.reject(item.id, reason: reason.isEmpty ? nil : reason, kind: rejectKind) {
                                showRejectSheet = false; dismiss()
                            }
                        }
                    }
                }
            }
        }
    }
}
