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
            ToolbarItem(placement: .primaryAction) {
                Button { showEdit = true } label: { Label("Edit", systemImage: "pencil") }
            }
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
    @State private var saving = false
    @State private var error: String?

    init(post: Post, model: AppModel, onSaved: @escaping (Post) -> Void) {
        self.post = post
        self.model = model
        self.onSaved = onSaved
        _title = State(initialValue: post.title)
        _summary = State(initialValue: post.summary ?? "")
        _verdict = State(initialValue: post.verdict ?? "")
        _topics = State(initialValue: (post.topicsCovered ?? []).joined(separator: ", "))
        _bodyHTML = State(initialValue: post.bodyHTML ?? "")
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
                Section("Body (HTML)") {
                    TextEditor(text: $bodyHTML)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 300)
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

        if let updated = await model.updatePost(post.id, fields: fields) {
            onSaved(updated)
            dismiss()
        } else {
            error = model.errorMessage ?? "Couldn't save the post."
        }
    }
}
