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
    @State private var detail: BillingClaimDetail?
    @State private var loadingDetail = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                financialsCard
                complianceCard
                if let d = detail {
                    linesCard(d.lines ?? [])
                    diagnosesCard(d.diagnoses ?? [])
                    flagsCard(d.flags ?? [])
                    upcodingCard(d.upcoding ?? [])
                    docSuggestionsCard(d.docSuggestions ?? [])
                } else if loadingDetail {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading full claim…").font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Claim")
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { approveSheet }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
        .task { detail = await model.claimDetail(claim.id); loadingDetail = false }
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

    private func sectionCard<C: View>(_ title: String, _ icon: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    @ViewBuilder
    private func linesCard(_ lines: [BillingClaimLine]) -> some View {
        if !lines.isEmpty {
            sectionCard("Service lines (\(lines.count))", "list.number") {
                ForEach(lines.sorted { ($0.lineNumber ?? 0) < ($1.lineNumber ?? 0) }) { ln in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(ln.code ?? "—").font(.callout.weight(.semibold).monospaced())
                            if !ln.modifiers.isEmpty {
                                Text(ln.modifiers.map { "·\($0)" }.joined(separator: " "))
                                    .font(.caption2).foregroundStyle(Theme.accentSoft)
                            }
                            Spacer()
                            if let u = ln.units, u != 1 { Text("×\(u)").font(.caption).foregroundStyle(.secondary) }
                            Text(fmtCents(ln.chargeCents)).font(.callout).foregroundStyle(.secondary)
                        }
                        if let d = ln.codeDescription, !d.isEmpty {
                            Text(d).font(.caption).foregroundStyle(.secondary)
                        }
                        if let mr = ln.modifierRationale, !mr.isEmpty {
                            Text("Modifier: \(mr)").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 2)
                    if ln.id != lines.last?.id { Divider() }
                }
            }
        }
    }

    @ViewBuilder
    private func diagnosesCard(_ dx: [BillingClaimDiagnosis]) -> some View {
        if !dx.isEmpty {
            sectionCard("Diagnoses (\(dx.count))", "stethoscope") {
                ForEach(dx.sorted { ($0.diagnosisIndex ?? 0) < ($1.diagnosisIndex ?? 0) }) { d in
                    HStack(alignment: .top, spacing: 8) {
                        Text(d.userOverrideCode ?? d.icd10Code ?? "—")
                            .font(.callout.weight(.semibold).monospaced())
                            .frame(width: 72, alignment: .leading)
                        Text(d.icd10Description ?? "").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func flagsCard(_ flags: [BillingComplianceFlag]) -> some View {
        if !flags.isEmpty {
            sectionCard("Compliance flags (\(flags.count))", "exclamationmark.shield") {
                ForEach(flags) { f in
                    let color: Color = f.severity == "error" ? Theme.red : (f.severity == "warning" ? Theme.amber : Theme.accentSoft)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Image(systemName: f.isResolved ? "checkmark.circle.fill" : "circle")
                                .font(.caption2).foregroundStyle(f.isResolved ? Theme.green : color)
                            Text(f.title ?? f.flagKind ?? "Flag").font(.caption.weight(.semibold))
                                .strikethrough(f.isResolved)
                            if let rc = f.referencedCode, !rc.isEmpty {
                                Text(rc).font(.caption2.monospaced()).foregroundStyle(.tertiary)
                            }
                            Spacer()
                        }
                        if let d = f.description, !d.isEmpty {
                            Text(d).font(.caption2).foregroundStyle(.secondary)
                        }
                        if let fix = f.suggestedFix, !fix.isEmpty {
                            Text("Fix: \(fix)").font(.caption2).foregroundStyle(Theme.accentSoft)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    @ViewBuilder
    private func upcodingCard(_ ops: [BillingUpcoding]) -> some View {
        if !ops.isEmpty {
            sectionCard("Upcoding opportunities (\(ops.count))", "arrow.up.right.circle") {
                ForEach(ops) { op in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(op.currentCode ?? "—").font(.caption.monospaced())
                            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.tertiary)
                            Text(op.potentialCode ?? "—").font(.caption.weight(.bold).monospaced()).foregroundStyle(Theme.green)
                            Spacer()
                            if let r = op.revenueDeltaCents { Text("+\(fmtCents(r))").font(.caption).foregroundStyle(Theme.green) }
                            if op.isAccepted { Text("accepted").font(.caption2).foregroundStyle(Theme.green) }
                        }
                        HStack(spacing: 8) {
                            if let w = op.wrvuDelta { Text("+\(String(format: "%.2f", w)) wRVU").font(.caption2).foregroundStyle(.secondary) }
                            if let c = op.confidence { Text("· \(String(format: "%.0f%%", c * 100)) conf").font(.caption2).foregroundStyle(.secondary) }
                        }
                        if let rat = op.rationale, !rat.isEmpty {
                            Text(rat).font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 2)
                    if op.id != ops.last?.id { Divider() }
                }
            }
        }
    }

    @ViewBuilder
    private func docSuggestionsCard(_ sugg: [BillingDocSuggestion]) -> some View {
        if !sugg.isEmpty {
            sectionCard("Documentation suggestions (\(sugg.count))", "doc.text.magnifyingglass") {
                ForEach(sugg) { s in
                    let pc: Color = s.priority == "high" ? Theme.red : (s.priority == "medium" ? Theme.amber : Theme.accentSoft)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text((s.priority ?? "—").uppercased()).font(.caption2.bold())
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(pc.opacity(0.22), in: Capsule()).foregroundStyle(pc)
                            if let sec = s.section, !sec.isEmpty { Text(sec).font(.caption2).foregroundStyle(.tertiary) }
                            Spacer()
                            if let ri = s.revenueImpact, !ri.isEmpty { Text(ri).font(.caption2).foregroundStyle(Theme.accentSoft) }
                        }
                        if let i = s.issue, !i.isEmpty { Text(i).font(.caption.weight(.medium)) }
                        if let sg = s.suggestion, !sg.isEmpty { Text(sg).font(.caption2).foregroundStyle(.secondary) }
                    }
                    .padding(.vertical, 2)
                    if s.id != sugg.last?.id { Divider() }
                }
            }
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
