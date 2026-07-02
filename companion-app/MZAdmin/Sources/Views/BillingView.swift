import SwiftUI

@MainActor
final class BillingModel: ObservableObject {
    @Published var claims: [BillingClaim] = []
    @Published var summary: BillingReportSummary?
    @Published var coach: CodingCoach?
    @Published var section: String = "claims"      // "claims" | "coach" | "report"
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
            switch section {
            case "claims":
                claims = try await api.listBillingClaims(
                    statuses: ["pending_review", "edited", "ready_to_submit", "submitted", "paid", "denied"],
                    days: 60)
            case "coach":
                coach = try await api.codingCoach(window: "ytd")
            default:
                summary = try await api.billingReportSummary()
            }
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    /// Full claim drill-down (lines, diagnoses, flags, upcoding, doc suggestions).
    func claimDetail(_ id: String) async -> BillingClaimDetail? {
        try? await api.fetchBillingClaimDetail(id: id)
    }

    /// Resolve/unresolve a compliance flag.
    func setFlagResolved(claimId: String, flagId: String, resolved: Bool) async -> Bool {
        do { try await api.setBillingFlagResolved(claimId: claimId, flagId: flagId, resolved: resolved, note: nil); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }
    /// Accept/revert an upcoding opportunity (applies to the line on accept).
    func setUpcodingAccepted(claimId: String, opId: String, accepted: Bool) async -> Bool {
        do { try await api.setBillingUpcodingAccepted(claimId: claimId, opId: opId, accepted: accepted); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }
    /// Mark a documentation suggestion applied/unapplied.
    func setDocSuggestionApplied(claimId: String, suggId: String, applied: Bool) async -> Bool {
        do { try await api.setBillingDocSuggestionApplied(claimId: claimId, suggId: suggId, applied: applied); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }

    func approve(_ id: String, notes: String?, force: Bool = false) async -> Bool {
        await run(id) { try await self.api.approveBillingClaim(id: id, notes: notes, force: force) }
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
                    Text("Coach").tag("coach")
                    Text("Report").tag("report")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.top, 8)
                .onChange(of: model.section) { _, _ in Task { await model.reload() } }

                if model.section == "claims" {
                    claimsList
                } else if model.section == "coach" {
                    coachScroll
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
            .onChange(of: model.claims) { _, _ in
                // Reconcile the selection against the live queue: drop ids the
                // server no longer returns, and leave selection mode if there's
                // nothing left to pick (otherwise the Cancel toggle can vanish).
                picked.formIntersection(Set(model.claims.map { $0.id }))
                if selecting && model.pending.isEmpty {
                    selecting = false
                    picked.removeAll()
                }
            }
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
                        let note = bulkNotes.trimmingCharacters(in: .whitespacesAndNewlines)
                        // Only send ids that still exist in the current queue.
                        let ids = Array(picked.intersection(Set(model.claims.map { $0.id })))
                        Task {
                            let failed = await model.bulkApprove(ids, notes: note.isEmpty ? nil : note)
                            showBulkApprove = false
                            // Keep only still-existing failures selected for retry; drop
                            // any id the server no longer returns (deleted/changed).
                            picked = Set(failed).intersection(Set(model.claims.map { $0.id }))
                            if picked.isEmpty { withAnimation { selecting = false } }
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
    private var coachScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let c = model.coach {
                    coachHeadline(c)
                    if let pts = c.coachingPoints, !pts.isEmpty { coachingPointsCard(pts) }
                    if let pairs = c.undercoding?.topPairs, !pairs.isEmpty { undercodingCard(pairs) }
                    if let flags = c.recurringFlags, !flags.isEmpty { recurringFlagsCard(flags) }
                    if let mods = c.modifierMisses, !mods.isEmpty { modifierMissesCard(mods) }
                    if let t = c.trend, !t.isEmpty { trendCard(t) }
                    if let note = c.complianceNote, !note.isEmpty {
                        Text(note).font(.caption2).foregroundStyle(.tertiary)
                    }
                } else if model.isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 32)
                } else {
                    ContentUnavailableView("No coaching data yet", systemImage: "sparkles",
                        description: Text("Coding analysis appears here once encounters have synced from MedicalTranscription."))
                }
            }.padding(16)
        }
    }

    private func coachHeadline(_ c: CodingCoach) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Coding Coach" + (c.window?.label.map { " · \($0)" } ?? ""), systemImage: "chart.line.uptrend.xyaxis")
                .font(.subheadline.weight(.semibold))
            if let open = c.summary?.documentedUndercodingOpenUsd, open >= 1 {
                Text("$\(open, specifier: "%.0f")")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.green)
                Text("documentation-supported coding not yet captured"
                     + (c.summary?.openOpportunityCount.map { " · \($0) encounter\($0 == 1 ? "" : "s")" } ?? ""))
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("No open undercoding — your billed levels match your documentation.")
                    .font(.callout).foregroundStyle(Theme.green)
            }
            Divider().padding(.vertical, 2)
            HStack(spacing: 18) {
                if let n = c.summary?.claimsAnalyzed { metric("\(n)", "claims") }
                if let w = c.summary?.totalWrvu { metric(String(format: "%.1f", w), "wRVU") }
                if let s = c.summary?.avgMedicolegalScore { metric("\(s)", "med-legal") }
                if let ow = c.undercoding?.openWrvu, ow > 0 { metric(String(format: "%.1f", ow), "open wRVU") }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func coachingPointsCard(_ points: [CodingCoach.CoachingPoint]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Coaching", systemImage: "lightbulb").font(.subheadline.weight(.semibold))
            ForEach(points) { p in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(priorityColor(p.priority)).frame(width: 8, height: 8)
                        Text(p.title ?? "").font(.callout.weight(.semibold))
                    }
                    if let d = p.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.secondary) }
                    if let n = p.nextStep, !n.isEmpty {
                        Label(n, systemImage: "arrow.turn.down.right")
                            .font(.caption2).foregroundStyle(Theme.accentSoft)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if p.id != points.last?.id { Divider() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func priorityColor(_ p: String?) -> Color {
        switch p { case "high": return Theme.red; case "medium": return Theme.amber; default: return Theme.accentSoft }
    }

    private func undercodingCard(_ pairs: [CodingCoach.Undercoding.Pair]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Top undercoding — note supports a higher level", systemImage: "arrow.up.right")
                .font(.subheadline.weight(.semibold))
            ForEach(pairs) { p in
                HStack {
                    Text("\(p.fromCode ?? "?") → \(p.toCode ?? "?")").font(.subheadline.weight(.medium))
                    if let n = p.openCount, n > 0 { Text("\(n)×").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if let usd = p.openRevenueDeltaUsd, usd > 0 {
                        Text("+$\(usd, specifier: "%.0f")").font(.subheadline.weight(.medium)).foregroundStyle(Theme.green)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func recurringFlagsCard(_ flags: [CodingCoach.RecurringFlag]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Recurring compliance flags", systemImage: "flag").font(.subheadline.weight(.semibold))
            ForEach(flags.prefix(8)) { f in
                HStack {
                    Text((f.kind ?? "—").replacingOccurrences(of: "_", with: " ").capitalized).font(.subheadline)
                    Spacer()
                    if let n = f.count { Text("\(n)×").font(.caption).foregroundStyle(Theme.amber) }
                    if let c = f.claimsAffected, c > 0 { Text("· \(c) claims").font(.caption2).foregroundStyle(.tertiary) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func modifierMissesCard(_ mods: [CodingCoach.ModifierMiss]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Modifier misses", systemImage: "number").font(.subheadline.weight(.semibold))
            ForEach(mods.prefix(8)) { m in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(m.referencedCode ?? "—").font(.subheadline.weight(.medium))
                        Spacer()
                        if let n = m.count { Text("\(n)×").font(.caption).foregroundStyle(Theme.amber) }
                    }
                    if let fix = m.exampleFix, !fix.isEmpty { Text(fix).font(.caption2).foregroundStyle(.tertiary) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func trendCard(_ trend: [CodingCoach.TrendPoint]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Monthly open undercoding", systemImage: "calendar").font(.subheadline.weight(.semibold))
            ForEach(trend) { t in
                HStack {
                    Text(t.month ?? "—").font(.subheadline)
                    Spacer()
                    if let usd = t.openUndercodingUsd { Text("$\(usd, specifier: "%.0f")").font(.subheadline.weight(.medium)) }
                    if let c = t.claims { Text("· \(c) claims").font(.caption2).foregroundStyle(.tertiary) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
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
