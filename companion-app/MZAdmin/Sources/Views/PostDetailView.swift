import SwiftUI
#if canImport(WebKit)
import WebKit
#endif

struct PostDetailView: View {
    let post: Post
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var full: Post?
    @State private var showHTML = false
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
                if showHTML, let html = current.bodyHTML {
                    HTMLView(html: html)
                        .frame(minHeight: 420)
                        .glassCard()
                } else if current.bodyHTML != nil {
                    Button { showHTML = true } label: {
                        Label("Preview full post", systemImage: "doc.richtext")
                    }
                } else if loadingFull {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading full post…").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Label("Couldn't load the full post body.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Theme.amber)
                }
            }
            .padding()
        }
        .background(Theme.base)
        .navigationTitle(current.statusKind.label)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .safeAreaInset(edge: .bottom) { actions }
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

/// Renders the post body_html in a platform web view for an accurate preview.
struct HTMLView: View {
    let html: String
    var body: some View {
        #if canImport(WebKit)
        WebPreview(html: html)
        #else
        ScrollView { Text(html).font(.footnote.monospaced()) }
        #endif
    }
}

#if canImport(WebKit)
#if os(iOS)
struct WebPreview: UIViewRepresentable {
    let html: String
    func makeUIView(context: Context) -> WKWebView {
        let wv = WKWebView(); wv.isOpaque = false; wv.backgroundColor = .clear; return wv
    }
    func updateUIView(_ wv: WKWebView, context: Context) {
        wv.loadHTMLString(wrap(html), baseURL: URL(string: "https://mountzara.com/"))
    }
}
#elseif os(macOS)
struct WebPreview: NSViewRepresentable {
    let html: String
    func makeNSView(context: Context) -> WKWebView { WKWebView() }
    func updateNSView(_ wv: WKWebView, context: Context) {
        wv.loadHTMLString(wrap(html), baseURL: URL(string: "https://mountzara.com/"))
    }
}
#endif
private func wrap(_ html: String) -> String {
    "<style>body{background:#07070a;color:#f5f5f7;font:16px -apple-system;padding:14px;}img{max-width:100%}</style>" + html
}
#endif
