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
    @State private var composing = false
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
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                        .help("New material")
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .sheet(isPresented: $composing) { EducationComposeView(model: model) }
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
    @State private var suggestion: EducationEditSuggestion?
    @State private var suggesting = false
    @State private var showSuggestion = false
    @State private var applyingEdit = false
    @State private var showEdit = false

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
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { showEdit = true } label: { Image(systemName: "pencil") }
                    .help("Edit this material")
                Button { Task { await suggest() } } label: {
                    if suggesting { ProgressView() } else { Image(systemName: "wand.and.sparkles") }
                }
                .disabled(suggesting)
                .help("Suggest a clearer title & summary (on-server Claude)")
            }
        }
        .sheet(isPresented: $showSuggestion) { suggestionSheet }
        .sheet(isPresented: $showEdit) {
            EducationEditView(material: current, model: model) { updated in
                detail = updated
                Task { await model.reload() }
            }
        }
        .task { await load() }
    }

    private func suggest() async {
        suggesting = true
        defer { suggesting = false }
        do {
            let resp = try await model.api.suggestEducationEdit(slug: current.slug, instruction: "")
            suggestion = resp.proposal
            showSuggestion = true
        } catch {
            loadError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func applyEdit() async {
        guard let s = suggestion else { return }
        applyingEdit = true
        defer { applyingEdit = false }
        do {
            _ = try await model.api.updateEducation(slug: current.slug, title: s.proposedTitle, summary: s.proposedSummary)
            showSuggestion = false
            await load()
            await model.reload()
        } catch {
            loadError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    @ViewBuilder
    private var suggestionSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let s = suggestion {
                        diffCard("Title", currentValue: current.title, proposed: s.proposedTitle)
                        diffCard("Summary", currentValue: current.summary ?? "", proposed: s.proposedSummary)
                        if !s.rationale.isEmpty {
                            Label(s.rationale, systemImage: "sparkles")
                                .font(.caption).foregroundStyle(Theme.accentSoft)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12).glassCard()
                        }
                        Text("AI-proposed copy edit, grounded in this material's body. Review carefully — it must not change any clinical meaning. Applying updates the title and summary only.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(16)
            }
            .navigationTitle("Suggested edit")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Discard") { showSuggestion = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { Task { await applyEdit() } }.disabled(applyingEdit)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 440)
        #endif
    }

    private func diffCard(_ label: String, currentValue: String, proposed: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label.uppercased()).font(.caption2.bold()).foregroundStyle(.tertiary)
            VStack(alignment: .leading, spacing: 3) {
                Text("Current").font(.caption2).foregroundStyle(.secondary)
                Text(currentValue.isEmpty ? "(none)" : currentValue).font(.callout).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Proposed").font(.caption2).foregroundStyle(Theme.green)
                Text(proposed).font(.callout.weight(.medium))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
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

// MARK: - Manual editor

/// Full manual editor for an education material: title, summary, audience,
/// topics, and the markdown body → PATCH /api/v1/admin/education/<slug>.
struct EducationEditView: View {
    let material: EducationMaterial
    @ObservedObject var model: EducationModel
    var onSaved: (EducationMaterial) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var summary: String
    @State private var audience: String
    @State private var topics: String
    @State private var bodyMd: String
    @State private var saving = false
    @State private var error: String?
    @State private var bodyMode = 0                  // 0 = Markdown source, 1 = live preview

    init(material: EducationMaterial, model: EducationModel, onSaved: @escaping (EducationMaterial) -> Void) {
        self.material = material
        self.model = model
        self.onSaved = onSaved
        _title = State(initialValue: material.title)
        _summary = State(initialValue: material.summary ?? "")
        _audience = State(initialValue: material.targetAudience ?? "")
        _topics = State(initialValue: (material.topicTags ?? []).joined(separator: ", "))
        _bodyMd = State(initialValue: material.bodyMd ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $title, axis: .vertical).lineLimit(1...3)
                }
                Section("Summary") {
                    TextField("Summary", text: $summary, axis: .vertical).lineLimit(2...5)
                }
                Section("Target audience") {
                    TextField("e.g. patient / clinician", text: $audience)
                }
                Section("Topics — comma separated") {
                    TextField("Topics", text: $topics, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    Picker("View", selection: $bodyMode) {
                        Text("Markdown").tag(0)
                        Text("Preview").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if bodyMode == 0 {
                        TextEditor(text: $bodyMd)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 300)
                    } else {
                        ScrollView {
                            Text(Self.renderMarkdown(bodyMd))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .padding(.vertical, 4)
                        }
                        .frame(minHeight: 300)
                    }
                } header: {
                    Text("Body (Markdown)")
                } footer: {
                    Text(bodyMode == 1 ? "Live preview of your unsaved Markdown." : "Edit Markdown, then switch to Preview to see it rendered.")
                }
            }
            .navigationTitle("Edit material")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .overlay(alignment: .bottom) { ErrorBar(text: error) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() }
                    else {
                        Button("Save") { Task { await save() } }
                            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 600)
        #endif
    }

    static func renderMarkdown(_ md: String) -> AttributedString {
        (try? AttributedString(markdown: md,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace,
                           failurePolicy: .returnPartiallyParsedIfPossible))) ?? AttributedString(md)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        var fields: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "summary": summary.trimmingCharacters(in: .whitespacesAndNewlines),
            "body_md": bodyMd,
            "topic_tags": topics.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
        ]
        let a = audience.trimmingCharacters(in: .whitespacesAndNewlines)
        if !a.isEmpty { fields["target_audience"] = a }
        do {
            let updated = try await model.api.patchEducation(slug: material.slug, fields: fields)
            onSaved(updated)
            dismiss()
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Compose (new material)

/// Author a brand-new education material — POST /api/v1/admin/education.
/// Slug auto-generates from the title (lowercase/digits/hyphens), editable.
struct EducationComposeView: View {
    @ObservedObject var model: EducationModel
    @Environment(\.dismiss) private var dismiss

    @State private var slug = ""
    @State private var slugEdited = false
    @State private var title = ""
    @State private var summary = ""
    @State private var audience = "patient"
    @State private var topics = ""
    @State private var bodyMd = ""
    @State private var publishNow = false
    @State private var saving = false
    @State private var error: String?
    @State private var bodyMode = 0

    private var effectiveSlug: String { slugEdited ? slug : PostComposeView.slugify(title) }
    private var slugValid: Bool {
        effectiveSlug.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title (≤200 chars)", text: $title, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    TextField("material-slug", text: Binding(
                        get: { effectiveSlug },
                        set: { slug = $0.lowercased(); slugEdited = true }))
                        .font(.system(.footnote, design: .monospaced))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .foregroundStyle(effectiveSlug.isEmpty || slugValid ? Color.primary : Theme.red)
                } header: { Text("Slug") } footer: {
                    Text("Lowercase letters, digits, hyphens. Auto-generated from the title.")
                }
                Section("Summary (≤280 chars)") {
                    TextField("Summary", text: $summary, axis: .vertical).lineLimit(2...5)
                }
                Section("Target audience") {
                    TextField("e.g. patient / clinician / all", text: $audience)
                }
                Section("Topics — comma separated") {
                    TextField("Topics", text: $topics, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    Picker("View", selection: $bodyMode) {
                        Text("Markdown").tag(0)
                        Text("Preview").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if bodyMode == 0 {
                        TextEditor(text: $bodyMd)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 280)
                    } else {
                        ScrollView {
                            Text(EducationEditView.renderMarkdown(bodyMd))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .padding(.vertical, 4)
                        }
                        .frame(minHeight: 280)
                    }
                } header: { Text("Body (Markdown, ≤60k chars)") }
                Section {
                    Toggle("Publish immediately", isOn: $publishNow)
                        .tint(Theme.accent)
                } footer: {
                    Text(publishNow ? "Live for patients as soon as you save."
                                    : "Saved as a draft you can publish later.")
                }
            }
            .navigationTitle("New material")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .overlay(alignment: .bottom) { ErrorBar(text: error) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() }
                    else {
                        Button(publishNow ? "Publish" : "Save draft") { Task { await save() } }
                            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty
                                      || !slugValid
                                      || bodyMd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 620)
        #endif
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        var fields: [String: Any] = [
            "slug": effectiveSlug,
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "body_md": bodyMd,
            "status": publishNow ? "published" : "draft",
            "topic_tags": topics.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
        ]
        let s = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.isEmpty { fields["summary"] = s }
        let a = audience.trimmingCharacters(in: .whitespacesAndNewlines)
        if !a.isEmpty { fields["target_audience"] = a }
        do {
            try await model.api.createEducation(fields: fields)
            await model.reload()
            dismiss()
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
