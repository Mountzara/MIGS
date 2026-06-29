import SwiftUI

struct BillingClaimDetailView: View {
    let claim: BillingClaim
    let model: BillingModel
    @Environment(\.dismiss) private var dismiss

    @State private var notes = ""
    @State private var rejectReason = ""
    @State private var force = false
    @State private var showApproveSheet = false
    @State private var showRejectSheet = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                financialsCard
                complianceCard
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Claim")
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { approveSheet }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                if let d = claim.visitDate { Text(d).font(.caption).foregroundStyle(.secondary) }
            }
            Text(claim.patientName).font(.headline)
            HStack(spacing: 8) {
                if let v = claim.visitType { Text(prettyVisitKey(v)) }
                if let em = claim.emCode, !em.isEmpty { Text("· \(em)") }
                if let mdm = claim.emMdmLevel, !mdm.isEmpty { Text("· MDM \(mdm)") }
            }.font(.caption).foregroundStyle(.secondary)
            if let p = claim.payerName, !p.isEmpty {
                Text("Payer: \(p)\(claim.payerKind.map { " · \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch claim.status {
            case "paid": return ("PAID", Theme.green)
            case "partially_paid": return ("PARTIAL", Theme.green)
            case "ready_to_submit": return ("READY", Theme.accentSoft)
            case "submitted": return ("SUBMITTED", Theme.accentSoft)
            case "denied", "rejected": return ("DENIED", Theme.red)
            case "edited": return ("EDITED", Theme.amber)
            default: return ("PENDING", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    private var financialsCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Financials", systemImage: "dollarsign.circle")
                .font(.subheadline.weight(.semibold))
            row("Total charge", fmtCents(claim.totalChargeCents))
            row("Expected collection", fmtCents(claim.expectedCollectionCents))
            if let wrvu = claim.emWrvu { row("E&M wRVU", String(format: "%.2f", wrvu)) }
            if let conf = claim.emConfidence { row("E&M confidence", String(format: "%.0f%%", conf * 100)) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    @ViewBuilder
    private var complianceCard: some View {
        if (claim.unresolvedErrors ?? 0) > 0 || (claim.unresolvedWarnings ?? 0) > 0
           || (claim.unacceptedUpcoding ?? 0) > 0 || (claim.unappliedHighDocsugg ?? 0) > 0
           || claim.complianceStatus != nil || claim.statusReason != nil {
            VStack(alignment: .leading, spacing: 6) {
                Label("Compliance & flags", systemImage: "exclamationmark.shield")
                    .font(.subheadline.weight(.semibold))
                if let cs = claim.complianceStatus { row("Status", cs.capitalized) }
                if let e = claim.unresolvedErrors, e > 0 {
                    row("Errors", "\(e)", accent: Theme.red)
                }
                if let w = claim.unresolvedWarnings, w > 0 {
                    row("Warnings", "\(w)", accent: Theme.amber)
                }
                if let u = claim.unacceptedUpcoding, u > 0 {
                    row("Upcoding suggestions", "\(u)")
                }
                if let d = claim.unappliedHighDocsugg, d > 0 {
                    row("Doc suggestions (high)", "\(d)")
                }
                if let r = claim.statusReason, !r.isEmpty {
                    Divider().padding(.vertical, 4)
                    Text(r).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).glassCard()
        }
    }

    private func row(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(accent ?? .primary)
        }
    }

    @ViewBuilder
    private var actionsBar: some View {
        if claim.isPending {
            HStack(spacing: 12) {
                Button(role: .destructive) {
                    rejectReason = ""; showRejectSheet = true
                } label: { Text("Reject").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
                Button {
                    notes = ""; force = false; showApproveSheet = true
                } label: { Text("Approve").bold().frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
            .disabled(model.busyIDs.contains(claim.id))
        }
    }

    private var approveSheet: some View {
        NavigationStack {
            Form {
                Section("Notes (optional)") {
                    TextField("Approval notes for the audit log", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
                if (claim.unresolvedErrors ?? 0) > 0 {
                    Section {
                        Toggle("Force approve despite \(claim.unresolvedErrors ?? 0) error flag(s)",
                               isOn: $force)
                    } footer: {
                        Text("Without force, the backend will refuse with HTTP 409 while errors are unresolved.")
                    }
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
                            if await model.approve(claim.id, notes: notes.trimmingCharacters(in: .whitespacesAndNewlines), force: force) {
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
                Section("Rejection reason") {
                    TextField("Required — why this claim was rejected", text: $rejectReason, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle("Reject")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRejectSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reject", role: .destructive) {
                        Task {
                            if await model.reject(claim.id, reason: rejectReason.trimmingCharacters(in: .whitespacesAndNewlines)) {
                                showRejectSheet = false; dismiss()
                            }
                        }
                    }
                    .disabled(rejectReason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
