import SwiftUI

@MainActor
final class ComplianceModel: ObservableObject {
    @Published var docs: [ComplianceDoc] = []
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

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
                ForEach(items) { d in ComplianceRowView(doc: d) }
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
