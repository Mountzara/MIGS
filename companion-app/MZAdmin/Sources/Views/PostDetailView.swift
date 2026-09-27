import SwiftUI
#if canImport(WebKit)
import WebKit
#endif

struct PostDetailView: View {
    let post: Post
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var full: Post?
    @State private var showEdit = false
    @State private var bodyHeight: CGFloat = 240
    @State private var loadingFull = true
    @State private var confirmDelete = false

    private var current: Post { full ?? post }
    private var isActioning: Bool { model.actioningIDs.contains(post.id) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let v = current.verdict, !v.isEmpty {
                    label("Verdict", v)
                }
                if let s = current.summary, !s.isEmpty {
                    label("Summary", s)
                }
                if let topics = current.topicsCovered, !topics.isEmpty {
                    chips(topics)
                }
                if let li = current.linkedinDraft, !li.isEmpty {
                    label("LinkedIn draft", li)
                }
                if let ig = current.instagramDraft, !ig.isEmpty {
                    label("Instagram draft", ig)
                }
                if let html = current.bodyHTML, !html.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("FULL POST").font(.caption2.weight(.bold)).foregroundStyle(.tertiary)
                        HTMLView(html: html, height: $bodyHeight)
                            .frame(height: max(bodyHeight, 220))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).glassCard()
                } else if loadingFull {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading full post…").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Label("This post has no body content yet.", systemImage: "doc")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .background(Theme.base)
        .navigationTitle(current.statusKind.label)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { listenToThisPost() } label: { Label("Listen", systemImage: "headphones") }
                    .help("Read this brief aloud")
                Button { showEdit = true } label: { Label("Edit", systemImage: "pencil") }
                Menu {
                    Button(role: .destructive) { confirmDelete = true } label: {
                        Label("Delete post…", systemImage: "trash")
                    }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("Permanently delete this post?",
                            isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete \"\(current.displayTitle)\"", role: .destructive) {
                Task { if await model.deletePost(current.id) { dismiss() } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes it from the site index and R2. There is no undo.")
        }
        .safeAreaInset(edge: .bottom) { actions }
        .sheet(isPresented: $showEdit) {
            PostEditView(post: current, model: model) { updated in
                full = updated
                bodyHeight = 240
            }
        }
        .task { full = await model.fullPost(post.id); loadingFull = false }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle().fill(Theme.statusColor(current.statusKind)).frame(width: 10, height: 10)
                Text(current.statusKind.label).font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.statusColor(current.statusKind))
                if let w = current.weekLabel { Text("· \(w)").font(.caption).foregroundStyle(.secondary) }
            }
            Text(current.displayTitle).font(.title2.bold()).foregroundStyle(.white)
            if let p = current.pmidsCited, !p.isEmpty {
                Text("\(p.count) references").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// Read this brief aloud and jump to the Listen tab (player + controls).
    private func listenToThisPost() {
        let p = current
        var paras: [String] = ["\(p.displayTitle)."]
        if let body = p.bodyHTML, !body.isEmpty {
            paras += SpokenText.paragraphs(fromHTML: body)
        } else if let s = p.summary, !s.isEmpty {
            paras.append(s)
        }
        let kindLabel = PostKind(rawValue: p.kind)?.title ?? p.kind.capitalized
        BriefNarrator.shared.play([ListenItem(
            id: p.id, title: p.displayTitle, kindLabel: kindLabel, paragraphs: paras)])
        NotificationRouter.shared.selectedTab = .listen
    }

    private func label(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.tertiary)
            Text(body).font(.callout).foregroundStyle(.primary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chips(_ items: [String]) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(items, id: \.self) { t in
                Text(t).font(.caption2)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .glassCard()
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        if current.isDraft || current.isRejected {
            HStack(spacing: 12) {
                if current.isDraft {
                    Button(role: .destructive) {
                        Task { await model.reject(current); dismiss() }
                    } label: { actionLabel("Reject", "xmark") }
                    .tint(Theme.red)
                }
                Button {
                    Task { await model.approve(current); dismiss() }
                } label: {
                    actionLabel(current.isRejected ? "Publish anyway" : "Approve & publish", "checkmark")
                }
                .tint(Theme.green)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isActioning)
            .overlay { if isActioning { ProgressView() } }
            .padding()
            .background(.ultraThinMaterial)
        }
    }

    private func actionLabel(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon).frame(maxWidth: .infinity)
    }
}

/// Renders the post body_html in a platform web view, self-sizing to its
/// content so the whole post is readable inline (no nested scroll).
struct HTMLView: View {
    let html: String
    @Binding var height: CGFloat
    var body: some View {
        #if canImport(WebKit)
        WebPreview(html: html, height: $height)
        #else
        ScrollView { Text(html).font(.footnote.monospaced()) }
        #endif
    }
}

#if canImport(WebKit)
private func measureHeight(_ wv: WKWebView, _ apply: @escaping (CGFloat) -> Void) {
    wv.evaluateJavaScript("document.body.scrollHeight") { v, _ in
        if let h = v as? CGFloat, h > 1 { DispatchQueue.main.async { apply(h) } }
    }
}
#if os(iOS)
struct WebPreview: UIViewRepresentable {
    let html: String
    @Binding var height: CGFloat
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let wv = WKWebView()
        wv.navigationDelegate = context.coordinator
        wv.isOpaque = false; wv.backgroundColor = .clear
        wv.scrollView.isScrollEnabled = false
        return wv
    }
    func updateUIView(_ wv: WKWebView, context: Context) {
        wv.loadHTMLString(wrap(html), baseURL: URL(string: "https://mountzara.com/"))
    }
    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: WebPreview
        init(_ p: WebPreview) { parent = p }
        func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) {
            measureHeight(wv) { self.parent.height = $0 }
        }
    }
}
#elseif os(macOS)
struct WebPreview: NSViewRepresentable {
    let html: String
    @Binding var height: CGFloat
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> WKWebView {
        let wv = WKWebView(); wv.navigationDelegate = context.coordinator; return wv
    }
    func updateNSView(_ wv: WKWebView, context: Context) {
        wv.loadHTMLString(wrap(html), baseURL: URL(string: "https://mountzara.com/"))
    }
    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: WebPreview
        init(_ p: WebPreview) { parent = p }
        func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) {
            measureHeight(wv) { self.parent.height = $0 }
        }
    }
}
#endif
private func wrap(_ html: String) -> String {
    "<style>body{background:#07070a;color:#f5f5f7;font:16px -apple-system;padding:14px;margin:0;}img{max-width:100%}a{color:#a78bfa}h1,h2,h3{line-height:1.25}</style>" + html
}
#endif

// MARK: - Edit

/// Full editor for a post: title, summary, verdict, topics, and the body
/// (HTML source). Saves via PUT /api/posts/:id.
struct PostEditView: View {
    let post: Post
    @ObservedObject var model: AppModel
    var onSaved: (Post) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var summary: String
    @State private var verdict: String
    @State private var topics: String
    @State private var bodyHTML: String
    @State private var status: String
    @State private var kind: String
    @State private var linkedinDraft: String
    @State private var instagramDraft: String
    @State private var saving = false
    @State private var error: String?
    @State private var bodyMode = 0                  // 0 = HTML source, 1 = live preview
    @State private var previewHeight: CGFloat = 320

    init(post: Post, model: AppModel, onSaved: @escaping (Post) -> Void) {
        self.post = post
        self.model = model
        self.onSaved = onSaved
        _title = State(initialValue: post.title)
        _summary = State(initialValue: post.summary ?? "")
        _verdict = State(initialValue: post.verdict ?? "")
        _topics = State(initialValue: (post.topicsCovered ?? []).joined(separator: ", "))
        _bodyHTML = State(initialValue: post.bodyHTML ?? "")
        _status = State(initialValue: post.status)
        _kind = State(initialValue: post.kind)
        _linkedinDraft = State(initialValue: post.linkedinDraft ?? "")
        _instagramDraft = State(initialValue: post.instagramDraft ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $title, axis: .vertical).lineLimit(1...3)
                }
                Section("Summary") {
                    TextField("Summary", text: $summary, axis: .vertical).lineLimit(2...6)
                }
                Section("Verdict") {
                    TextField("Verdict (optional)", text: $verdict, axis: .vertical).lineLimit(1...4)
                }
                Section("Topics — comma separated") {
                    TextField("Topics", text: $topics, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    Picker("Status", selection: $status) {
                        Text("Draft").tag("draft")
                        Text("Published").tag("published")
                        Text("Rejected").tag("rejected")
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Status")
                } footer: {
                    Text("Publishing here puts the post live on mountzara.com immediately.")
                }
                Section {
                    Picker("Feed", selection: $kind) {
                        ForEach(PostKind.allCases) { Text($0.title).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                } header: { Text("Feed") } footer: {
                    Text("Moving feeds re-categorizes the post and rebuilds both indexes.")
                }
                Section("LinkedIn draft") {
                    TextField("LinkedIn caption", text: $linkedinDraft, axis: .vertical).lineLimit(2...8)
                }
                Section("Instagram draft") {
                    TextField("Instagram caption", text: $instagramDraft, axis: .vertical).lineLimit(2...8)
                }
                Section {
                    Picker("View", selection: $bodyMode) {
                        Text("HTML source").tag(0)
                        Text("Preview").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if bodyMode == 0 {
                        TextEditor(text: $bodyHTML)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 300)
                    } else {
                        // Live render of the CURRENT edit buffer (unsaved) — so
                        // you see exactly how the HTML looks before you save.
                        HTMLView(html: bodyHTML, height: $previewHeight)
                            .frame(height: max(previewHeight, 300))
                            .id(bodyHTML)   // fresh render whenever the source changes
                    }
                } header: {
                    Text("Body (HTML)")
                } footer: {
                    Text(bodyMode == 1 ? "Live preview of your unsaved edits." : "Edit the raw HTML, then switch to Preview to see it rendered.")
                }
            }
            .navigationTitle("Edit post")
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
        .frame(minWidth: 580, minHeight: 620)
        #endif
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        var fields: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "summary": summary.trimmingCharacters(in: .whitespacesAndNewlines),
            "body_html": bodyHTML,
            "topics_covered": topics.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
        ]
        let v = verdict.trimmingCharacters(in: .whitespacesAndNewlines)
        if !v.isEmpty { fields["verdict"] = v }
        if status != post.status { fields["status"] = status }
        if kind != post.kind { fields["kind"] = kind }
        if linkedinDraft != (post.linkedinDraft ?? "") { fields["linkedin_draft"] = linkedinDraft }
        if instagramDraft != (post.instagramDraft ?? "") { fields["instagram_draft"] = instagramDraft }

        if let updated = await model.updatePost(post.id, fields: fields) {
            onSaved(updated)
            dismiss()
        } else {
            error = model.errorMessage ?? "Couldn't save the post."
        }
    }
}

// MARK: - Compose (new post)

/// Create a brand-new post draft from scratch — POST /api/posts.
/// The id is slugified from the title (prefixed by kind) but editable.
struct PostComposeView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var kind: PostKind = .blog
    @State private var slug = ""
    @State private var slugEdited = false
    @State private var title = ""
    @State private var summary = ""
    @State private var verdict = ""
    @State private var topics = ""
    @State private var bodyHTML = ""
    @State private var publishNow = false
    @State private var saving = false
    @State private var error: String?
    @State private var bodyMode = 0
    @State private var previewHeight: CGFloat = 320

    private var effectiveSlug: String { slugEdited ? slug : Self.slugify(title) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Feed") {
                    Picker("Feed", selection: $kind) {
                        ForEach(PostKind.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section("Title") {
                    TextField("Title", text: $title, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    TextField("post-id-slug", text: Binding(
                        get: { effectiveSlug },
                        set: { slug = $0; slugEdited = true }))
                        .font(.system(.footnote, design: .monospaced))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                } header: { Text("ID") } footer: {
                    Text("Auto-generated from the title; edit if you need a specific slug.")
                }
                Section("Summary") {
                    TextField("Summary", text: $summary, axis: .vertical).lineLimit(2...6)
                }
                Section("Verdict (optional)") {
                    TextField("Verdict", text: $verdict, axis: .vertical).lineLimit(1...4)
                }
                Section("Topics — comma separated") {
                    TextField("Topics", text: $topics, axis: .vertical).lineLimit(1...3)
                }
                Section {
                    Picker("View", selection: $bodyMode) {
                        Text("HTML source").tag(0)
                        Text("Preview").tag(1)
                    }
                    .pickerStyle(.segmented)
                    if bodyMode == 0 {
                        TextEditor(text: $bodyHTML)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 280)
                    } else {
                        HTMLView(html: bodyHTML, height: $previewHeight)
                            .frame(height: max(previewHeight, 280))
                            .id(bodyHTML)
                    }
                } header: { Text("Body (HTML)") }
                Section {
                    Toggle("Publish immediately", isOn: $publishNow)
                        .tint(Theme.accent)
                } footer: {
                    Text(publishNow ? "Goes live on mountzara.com as soon as you save."
                                    : "Saved as a draft in the review queue.")
                }
            }
            .navigationTitle("New post")
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
                                      || effectiveSlug.isEmpty)
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 580, minHeight: 640)
        #endif
    }

    static func slugify(_ s: String) -> String {
        let lowered = s.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
        let mapped = lowered.map { c -> Character in
            (c.isLetter || c.isNumber) ? c : "-"
        }
        let collapsed = String(mapped).split(separator: "-").joined(separator: "-")
        return String(collapsed.prefix(80))
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        var fields: [String: Any] = [
            "id": effectiveSlug,
            "kind": kind.rawValue,
            "status": publishNow ? "published" : "draft",
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "summary": summary.trimmingCharacters(in: .whitespacesAndNewlines),
            "body_html": bodyHTML,
            "topics_covered": topics.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
        ]
        let v = verdict.trimmingCharacters(in: .whitespacesAndNewlines)
        if !v.isEmpty { fields["verdict"] = v }

        if await model.createPost(fields: fields) {
            dismiss()
        } else {
            error = model.errorMessage ?? "Couldn't create the post."
        }
    }
}
