import SwiftUI

@MainActor
final class EducationModel: ObservableObject {
    @Published var materials: [EducationMaterial] = []
    @Published var status: String = "all"          // all | draft | published | archived
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var drafts: [EducationMaterial] { materials.filter { $0.status == "draft" } }
    var published: [EducationMaterial] { materials.filter { $0.status == "published" } }
    var archived: [EducationMaterial] { materials.filter { $0.status == "archived" } }

    func reload() async {
        isLoading = true; error = nil
        do { materials = try await api.listEducation(status: status) }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }
}

struct EducationView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: EducationModel
    init(auth: AuthStore) { _model = StateObject(wrappedValue: EducationModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.materials.isEmpty {
                    ProgressView("Loading education materials…")
                } else if model.materials.isEmpty {
                    ContentUnavailableView("No materials yet", systemImage: "book.closed",
                        description: Text("Patient education primers will appear here."))
                } else {
                    List {
                        section("Published", model.published)
                        section("Drafts", model.drafts, badge: model.drafts.count)
                        section("Archived", model.archived)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Education")
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
    private func section(_ title: String, _ items: [EducationMaterial], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { m in EducationRowView(material: m) }
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

private struct EducationRowView: View {
    let material: EducationMaterial
    private var color: Color {
        switch material.status {
        case "published": return Theme.green
        case "draft": return Theme.amber
        case "archived": return Theme.accentSoft
        default: return Theme.accentSoft
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(color).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(material.title).font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    if let aud = material.targetAudience, !aud.isEmpty { Text(aud.capitalized) }
                    if let tags = material.topicTags, !tags.isEmpty {
                        Text("· \(tags.prefix(3).joined(separator: ", "))").lineLimit(1)
                    }
                    if let v = material.version { Text("· v\(v)") }
                }.font(.caption).foregroundStyle(.secondary)
                if let s = material.summary, !s.isEmpty {
                    Text(s).font(.caption2).foregroundStyle(.tertiary).lineLimit(2)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
