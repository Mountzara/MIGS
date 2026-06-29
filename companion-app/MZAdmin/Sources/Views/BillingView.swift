import SwiftUI

@MainActor
final class BillingModel: ObservableObject {
    @Published var claims: [BillingClaim] = []
    @Published var summary: BillingReportSummary?
    @Published var section: String = "claims"      // "claims" | "report"
    @Published var isLoading = false
    @Published var error: String?
    @Published var busyIDs: Set<String> = []

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var pending: [BillingClaim] { claims.filter(\.isPending) }
    var ready: [BillingClaim] { claims.filter(\.isReady) }
    var paid: [BillingClaim] { claims.filter(\.isPaid) }
    var denied: [BillingClaim] { claims.filter(\.isDenied) }

    func reload() async {
        isLoading = true; error = nil
        do {
            if section == "claims" {
                claims = try await api.listBillingClaims(
                    statuses: ["pending_review", "edited", "ready_to_submit", "submitted", "paid", "denied"],
                    days: 60)
            } else {
                summary = try await api.billingReportSummary()
            }
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func approve(_ id: String, notes: String?) async -> Bool {
        await run(id) { try await self.api.approveBillingClaim(id: id, notes: notes) }
    }
    func reject(_ id: String, reason: String) async -> Bool {
        await run(id) { try await self.api.rejectBillingClaim(id: id, reason: reason) }
    }
    private func run(_ id: String, _ op: @escaping () async throws -> Void) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        do { try await op(); await reload(); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }

    /// Approve several claims in sequence (one network call each), then refresh
    /// once. Returns the ids that failed so the caller can keep them selected.
    func bulkApprove(_ ids: [String], notes: String?) async -> [String] {
        error = nil
        var failed: [String] = []
        for id in ids {
            busyIDs.insert(id)
            do { try await api.approveBillingClaim(id: id, notes: notes) }
            catch {
                failed.append(id)
                self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
                if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
            }
            busyIDs.remove(id)
        }
        await reload()
        return failed
    }
}

struct BillingView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: BillingModel
    @State private var selected: BillingClaim?

    // Bulk-approve selection state.
    @State private var selecting = false
    @State private var picked: Set<String> = []
    @State private var showBulkApprove = false
    @State private var bulkNotes = ""

    init(auth: AuthStore) { _model = StateObject(wrappedValue: BillingModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Picker("Section", selection: $model.section) {
                    Text("Claims").tag("claims")
                    Text("Report").tag("report")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.top, 8)
                .onChange(of: model.section) { _, _ in Task { await model.reload() } }

                if model.section == "claims" {
                    claimsList
                } else {
                    reportScroll
                }
            }
            .navigationTitle("Billing")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if model.section == "claims" && !model.pending.isEmpty {
                        Button(selecting ? "Cancel" : "Select") {
                            withAnimation { selecting.toggle() }
                            if !selecting { picked.removeAll() }
                        }
                    }
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { claim in
                BillingClaimDetailView(claim: claim, model: model)
            }
            .sheet(isPresented: $showBulkApprove) { bulkApproveSheet }
        }
        .task { await model.reload() }
    }

    /// Confirmation sheet for approving the selected clean claims.
    private var bulkApproveSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Approve \(picked.count) clean claim\(picked.count == 1 ? "" : "s")? This moves them to ready-to-submit. Claims with unresolved errors aren't selectable and must be reviewed individually.")
                        .font(.callout)
                }
                Section("Approval note (optional — applies to all)") {
                    TextField("Audit note", text: $bulkNotes, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle("Bulk approve")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showBulkApprove = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Approve") {
                        let ids = Array(picked)
                        let note = bulkNotes.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            let failed = await model.bulkApprove(ids, notes: note.isEmpty ? nil : note)
                            showBulkApprove = false
                            picked = Set(failed)            // keep failures selected for retry
                            if failed.isEmpty { withAnimation { selecting = false } }
                        }
                    }
                    .disabled(picked.isEmpty)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 300)
        #endif
    }

    @ViewBuilder
    private var claimsList: some View {
        if model.isLoading && model.claims.isEmpty {
            ProgressView("Loading claims…").frame(maxWidth: .infinity).padding(.vertical, 32)
        } else if model.claims.isEmpty {
            ContentUnavailableView("Nothing in the queue",
                systemImage: "doc.text.magnifyingglass",
                description: Text("No billing claims to review in this window."))
        } else {
            List {
                claimSection("Pending review", model.pending, badge: model.pending.count, selectable: true)
                claimSection("Ready to submit / submitted", model.ready)
                claimSection("Paid", model.paid)
                claimSection("Denied", model.denied)
            }
            #if os(macOS)
            .listStyle(.inset)
            #else
            .listStyle(.insetGrouped)
            #endif
            .safeAreaInset(edge: .bottom) {
                if selecting && !picked.isEmpty { bulkBar }
            }
        }
    }

    private var bulkBar: some View {
        HStack {
            Text("\(picked.count) selected").font(.subheadline.weight(.medium))
            Spacer()
            Button {
                bulkNotes = ""; showBulkApprove = true
            } label: {
                Label("Approve \(picked.count)", systemImage: "checkmark.seal.fill").bold()
            }
            .buttonStyle(.borderedProminent).tint(Theme.green)
            .disabled(!model.busyIDs.isDisjoint(with: picked))
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private func claimSection(_ title: String, _ items: [BillingClaim], badge: Int? = nil, selectable: Bool = false) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { c in
                    if selecting && selectable {
                        let approvable = (c.unresolvedErrors ?? 0) == 0
                        Button {
                            guard approvable else { return }
                            if picked.contains(c.id) { picked.remove(c.id) } else { picked.insert(c.id) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: picked.contains(c.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(approvable ? Theme.accentSoft : Color.secondary)
                                BillingClaimRowView(claim: c).opacity(approvable ? 1 : 0.45)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!approvable)
                    } else {
                        Button { selected = c } label: { BillingClaimRowView(claim: c) }
                            .buttonStyle(.plain)
                    }
                }
            } header: {
                HStack {
                    Text(title)
                    if let badge, badge > 0 {
                        Text("\(badge)").font(.caption2.bold())
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Theme.amber.opacity(0.22), in: Capsule())
                            .foregroundStyle(Theme.amber)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var reportScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let s = model.summary {
                    if let inc = s.income, let p = s.period { incomeCard(income: inc, period: p) }
                    if let services = s.byService, !services.isEmpty { byServiceCard(services) }
                    if let months = s.byMonth, !months.isEmpty { byMonthCard(months) }
                } else if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
                } else {
                    ContentUnavailableView("No report yet",
                        systemImage: "chart.line.uptrend.xyaxis",
                        description: Text("No payments in this window."))
                }
            }.padding(16)
        }
    }

    @ViewBuilder
    private func incomeCard(income: BillingReportSummary.Income, period: BillingReportSummary.Period) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Income — \(period.from ?? "—") to \(period.to ?? "—")", systemImage: "dollarsign.circle")
                .font(.subheadline.weight(.semibold))
            kv("Gross", fmtCents(income.grossCents))
            kv("Refunds", fmtCents(income.refundsCents), accent: (income.refundsCents ?? 0) > 0 ? Theme.amber : nil)
            kv("Net receipts", fmtCents(income.netReceiptsCents), accent: Theme.green)
            kv("Stripe fees", fmtCents(income.stripeFeesCents))
            kv("Bank deposits", fmtCents(income.bankDepositsCents))
            Divider().padding(.vertical, 4)
            HStack {
                if let p = income.paymentCount { Text("\(p) payments") }
                if let r = income.refundCount, r > 0 { Text("· \(r) refunds") }
                if let i = income.invoiceCount, i > 0 { Text("· \(i) invoices") }
            }.font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func byServiceCard(_ services: [BillingReportSummary.ServiceRow]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("By service", systemImage: "list.bullet").font(.subheadline.weight(.semibold))
            ForEach(services) { s in
                HStack {
                    VStack(alignment: .leading) {
                        Text(s.displayName ?? s.serviceCode).font(.subheadline)
                        if let n = s.paymentCount { Text("\(n) payments").font(.caption2).foregroundStyle(.tertiary) }
                    }
                    Spacer()
                    Text(fmtCents(s.grossCents)).font(.subheadline.weight(.medium))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func byMonthCard(_ months: [BillingReportSummary.MonthRow]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("By month", systemImage: "calendar").font(.subheadline.weight(.semibold))
            ForEach(months) { m in
                HStack {
                    Text(m.month).font(.subheadline)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(fmtCents(m.netCents)).font(.subheadline.weight(.medium))
                        if let g = m.grossCents { Text("gross \(fmtCents(g))").font(.caption2).foregroundStyle(.tertiary) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func kv(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.subheadline.weight(.medium)).foregroundStyle(accent ?? .primary)
        }
    }
}

private struct BillingClaimRowView: View {
    let claim: BillingClaim
    private var dotColor: Color {
        switch claim.status {
        case "paid", "partially_paid": return Theme.green
        case "ready_to_submit", "submitted", "submitting", "accepted_by_clearinghouse": return Theme.accentSoft
        case "denied", "rejected", "written_off": return Theme.red
        default: return Theme.amber
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(claim.patientName).font(.body.weight(.medium))
                    if let em = claim.emCode, !em.isEmpty { Text("· \(em)").font(.caption) }
                    Spacer()
                    Text(fmtCents(claim.totalChargeCents)).font(.subheadline.weight(.medium))
                }
                HStack(spacing: 8) {
                    if let v = claim.visitType { Text(prettyVisitKey(v)) }
                    if let p = claim.payerName, !p.isEmpty { Text("· \(p)") }
                    if let d = claim.visitDate, !d.isEmpty { Text("· \(d)") }
                    if let e = claim.unresolvedErrors, e > 0 {
                        Text("\(e) err").font(.caption2.bold()).foregroundStyle(Theme.red)
                    }
                    if let w = claim.unresolvedWarnings, w > 0 {
                        Text("\(w) warn").font(.caption2.bold()).foregroundStyle(Theme.amber)
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
