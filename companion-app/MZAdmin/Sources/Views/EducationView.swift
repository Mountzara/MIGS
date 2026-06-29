import SwiftUI

@MainActor
final class EducationModel: ObservableObject {
    @Published var materials: [EducationMaterial] = []
    @Published var status: String = "all"          // all | draft | published | archived
    @Published var isLoading = false
    @Published var error: String?

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    var api: AdminAPI { AdminAPI(token: auth.basicToken) }

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

    /// Flip a material's publish status (draft → published, or → archived),
    /// then refresh the list. Returns true on success so the detail can dismiss.
    func setStatus(_ slug: String, to status: String) async -> Bool {
        error = nil
        do {
            _ = try await api.setEducationStatus(slug: slug, status: status)
            await reload()
            return true
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
            return false
        }
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
                ForEach(items) { m in
                    NavigationLink {
                        EducationDetailView(material: m, model: model)
                    } label: {
                        EducationRowView(material: m)
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

// MARK: - Detail

/// Full-record view for one education material: renders the inline markdown
/// body (or notes when it lives in R2) and lets the clinician publish a draft
/// or archive a material. Mirrors the web admin's publish/reject workflow.
struct EducationDetailView: View {
    let material: EducationMaterial
    @ObservedObject var model: EducationModel
    @Environment(\.dismiss) private var dismiss

    @State private var detail: EducationMaterial?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var working = false

    /// The detail (with body) once fetched; falls back to the list row until then.
    private var current: EducationMaterial { detail ?? material }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if isLoading && detail == nil {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity).padding(.vertical, 28)
                } else {
                    bodyCard
                }
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Material")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .overlay(alignment: .bottom) { ErrorBar(text: loadError ?? model.error) }
        .task { await load() }
    }

    private func load() async {
        isLoading = true; loadError = nil
        do { detail = try await model.api.educationDetail(slug: material.slug) }
        catch {
            loadError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                if let v = current.version { Text("v\(v)").font(.caption).foregroundStyle(.secondary) }
            }
            Text(current.title).font(.headline)
            if let s = current.summary, !s.isEmpty {
                Text(s).font(.subheadline).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if let aud = current.targetAudience, !aud.isEmpty {
                    Text(aud.capitalized).font(.caption).foregroundStyle(.secondary)
                }
                if let tags = current.topicTags, !tags.isEmpty {
                    Text("· \(tags.prefix(4).joined(separator: ", "))")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            if let p = current.publishedAt {
                Text("Published \(fmtEpoch(p))").font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch current.status {
            case "published": return ("PUBLISHED", Theme.green)
            case "archived": return ("ARCHIVED", Theme.accentSoft)
            default: return ("DRAFT", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private var bodyCard: some View {
        if let md = current.bodyMd, !md.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Content", systemImage: "doc.plaintext")
                    .font(.subheadline.weight(.semibold))
                Text(Self.renderMarkdown(md)).font(.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).glassCard()
        } else if current.hasR2Body == true || (current.r2Key?.isEmpty == false) {
            infoNote("This material's body is stored in R2 (key: \(current.r2Key ?? "—")). Open the web admin to view or edit the full document.")
        } else {
            infoNote("No body content yet for this material.")
        }
    }

    private func infoNote(_ text: String) -> some View {
        Text(text).font(.callout).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).glassCard()
    }

    @ViewBuilder
    private var actionsBar: some View {
        HStack(spacing: 12) {
            if current.status != "published" {
                Button { Task { await act("published") } } label: {
                    Label("Publish", systemImage: "checkmark.seal").bold().frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(Theme.green)
            }
            if current.status != "archived" {
                Button(role: .destructive) { Task { await act("archived") } } label: {
                    Label("Archive", systemImage: "archivebox").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .disabled(working)
    }

    private func act(_ status: String) async {
        working = true; defer { working = false }
        if await model.setStatus(current.slug, to: status) { dismiss() }
    }

    /// Render inline markdown while preserving the author's line breaks.
    private static func renderMarkdown(_ md: String) -> AttributedString {
        (try? AttributedString(
            markdown: md,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace,
                           failurePolicy: .returnPartiallyParsedIfPossible)))
            ?? AttributedString(md)
    }
}

#if DEBUG
#Preview {
    let sample = EducationMaterial(
        id: "1", slug: "iron-in-pregnancy", title: "Iron Deficiency in Pregnancy",
        summary: "Why ferritin matters and how to dose oral iron.",
        topicTags: ["anemia", "nutrition"], targetAudience: "patient",
        status: "draft", version: 2, publishedAt: nil,
        createdAt: 1_710_000_000, updatedAt: nil,
        hasInlineBody: true, hasR2Body: nil,
        bodyMd: "Iron in pregnancy\n\nTake oral iron **with vitamin C** and avoid calcium within two hours. A ferritin under 30 ng/mL warrants supplementation.",
        r2Key: nil)
    return NavigationStack {
        EducationDetailView(material: sample, model: EducationModel(auth: AuthStore()))
    }
    .preferredColorScheme(.dark)
}
#endif
