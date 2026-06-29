import SwiftUI

@MainActor
final class ComplianceModel: ObservableObject {
    @Published var docs: [ComplianceDoc] = []
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var signed: [ComplianceDoc] { docs.filter { $0.status == "signed" } }
    var dueSoon: [ComplianceDoc] { docs.filter { $0.status == "review_due_soon" } }
    var overdue: [ComplianceDoc] { docs.filter { $0.status == "review_overdue" } }
    var unsigned: [ComplianceDoc] { docs.filter { $0.status == "unsigned" } }

    func reload() async {
        isLoading = true; error = nil
        do { docs = try await api.listComplianceDocs() }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }
}

struct ComplianceView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: ComplianceModel
    init(auth: AuthStore) { _model = StateObject(wrappedValue: ComplianceModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.docs.isEmpty {
                    ProgressView("Loading compliance…")
                } else if model.docs.isEmpty {
                    ContentUnavailableView("No documents", systemImage: "doc.badge.gearshape",
                        description: Text("No compliance documents configured."))
                } else {
                    List {
                        section("Action required", model.overdue + model.unsigned, badge: model.overdue.count + model.unsigned.count)
                        section("Review due soon", model.dueSoon, badge: model.dueSoon.count)
                        section("Up to date", model.signed)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Compliance")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        }
        .task { await model.reload() }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [ComplianceDoc], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { d in
                    NavigationLink {
                        ComplianceDetailView(doc: d, model: model)
                    } label: {
                        ComplianceRowView(doc: d)
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
}

private struct ComplianceRowView: View {
    let doc: ComplianceDoc
    private var color: Color {
        switch doc.status {
        case "signed": return Theme.green
        case "review_overdue": return Theme.red
        case "review_due_soon": return Theme.amber
        default: return Theme.amber
        }
    }
    private var statusLabel: String {
        switch doc.status {
        case "signed": return "Signed"
        case "review_overdue": return "OVERDUE"
        case "review_due_soon": return "Due soon"
        case "unsigned": return "Unsigned"
        default: return doc.status
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(color).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(doc.title).font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    Text(statusLabel).foregroundStyle(color)
                    if let by = doc.signedBy, !by.isEmpty { Text("· \(by)") }
                    if let due = doc.dueInDays {
                        Text(due < 0 ? "\(abs(due)) d overdue" : "\(due) d to review")
                    } else if let date = doc.nextReviewDate {
                        Text("· next review \(date)")
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}

// MARK: - Detail

/// Read-only compliance doc viewer: renders the document body and the active
/// signature record (who signed, when, next review). The signing action
/// (POST with a stored signature + typed attestation) is a separate, legally
/// sensitive flow and is intentionally not wired here yet.
struct ComplianceDetailView: View {
    let doc: ComplianceDoc
    @ObservedObject var model: ComplianceModel
    @State private var detail: ComplianceDocDetail?
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let sig = detail?.activeSignature { signatureCard(sig) }
                if isLoading && detail == nil {
                    ProgressView("Loading…").frame(maxWidth: .infinity).padding(.vertical, 28)
                } else {
                    bodyCard
                }
            }
            .padding(16)
        }
        .navigationTitle("Document")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .overlay(alignment: .bottom) { ErrorBar(text: loadError ?? model.error) }
        .task { await load() }
    }

    private func load() async {
        isLoading = true; loadError = nil
        do { detail = try await model.api.complianceDocDetail(slug: doc.slug) }
        catch { loadError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription }
        isLoading = false
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                if let m = doc.reviewIntervalMonths { Text("review every \(m) mo").font(.caption).foregroundStyle(.secondary) }
            }
            Text(doc.title).font(.headline)
            if doc.counselReviewRecommended == true {
                Label("Counsel review recommended", systemImage: "building.columns")
                    .font(.caption).foregroundStyle(Theme.amber)
            }
            if let due = doc.dueInDays {
                Text(due < 0 ? "\(abs(due)) days overdue for review" : "\(due) days until review")
                    .font(.caption2).foregroundStyle(due < 0 ? Theme.red : Color.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch doc.status {
            case "signed": return ("SIGNED", Theme.green)
            case "review_overdue": return ("REVIEW OVERDUE", Theme.red)
            case "review_due_soon": return ("REVIEW DUE SOON", Theme.amber)
            default: return ("UNSIGNED", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    private func signatureCard(_ sig: ComplianceDocDetail.ActiveSignature) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Active signature", systemImage: "signature").font(.subheadline.weight(.semibold))
            if let by = sig.signedByDisplayName { kvRow("Signed by", by) }
            if let at = sig.signedAt { kvRow("Signed", at) }
            if let i = sig.typedInitials { kvRow("Initials", i) }
            if let nr = sig.nextReviewDate { kvRow("Next review", nr) }
            if let sha = sig.documentSha256 { kvRow("SHA-256", String(sha.prefix(16)) + "…") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    @ViewBuilder
    private var bodyCard: some View {
        if let body = detail?.body, !body.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Document", systemImage: "doc.text").font(.subheadline.weight(.semibold))
                Text(Self.renderMarkdown(body)).font(.callout).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).glassCard()
        } else {
            Text("Document body isn't available in-app. Open \(detail?.doc?.publicUrl ?? "the web admin") to read the full text.")
                .font(.callout).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14).glassCard()
        }
    }

    private func kvRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 92, alignment: .leading)
            Text(value).font(.subheadline)
            Spacer()
        }
    }

    private static func renderMarkdown(_ md: String) -> AttributedString {
        (try? AttributedString(markdown: md,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace,
                           failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(md)
    }
}
