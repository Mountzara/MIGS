import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

/// A single message thread: the conversation plus a reply composer.
/// Mirrors the web reader, including the send-start thread pin so a reply
/// can't misroute.
struct ThreadView: View {
    let thread: MessageThread
    let auth: AuthStore
    var onChange: () -> Void

    @State private var messages: [ThreadMessage] = []
    @State private var loading = true
    @State private var reply = ""
    @State private var sending = false
    @State private var error: String?
    @State private var downloadingId: String?
    @State private var downloaded: DownloadedFile?

    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var body: some View {
        VStack(spacing: 0) {
            if loading && messages.isEmpty {
                Spacer(); ProgressView("Loading…"); Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(messages) { m in
                                MessageBubble(message: m, downloadingId: downloadingId) { att in
                                    Task { await download(att) }
                                }
                                .id(m.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: messages.count) { _, _ in
                        if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
            }
            composer
        }
        .navigationTitle(thread.patientName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .overlay(alignment: .top) { ErrorBar(text: error) }
        .task { await load() }
        #if os(iOS)
        .sheet(item: $downloaded) { f in ActivityShareSheet(items: [f.url]) }
        #endif
    }

    private func download(_ att: MessageAttachment) async {
        downloadingId = att.id
        defer { downloadingId = nil }
        error = nil
        do {
            let data = try await api.messageAttachment(id: att.id)
            let name = att.filename ?? "attachment-\(att.id)"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: url)
            #if os(macOS)
            NSWorkspace.shared.activateFileViewerSelecting([url])
            #else
            downloaded = DownloadedFile(url: url)
            #endif
        } catch let e {
            error = (e as? AdminAPI.APIError)?.errorDescription ?? e.localizedDescription
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Reply to \(thread.patientName)…", text: $reply, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
            Button { Task { await send() } } label: {
                if sending { ProgressView().controlSize(.small) }
                else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
            }
            .disabled(sending || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .tint(Theme.accent)
        }
        .padding(10)
        .background(.ultraThinMaterial)
    }

    private func load() async {
        loading = true; error = nil
        do { messages = try await api.thread(id: thread.id).messages }
        catch let e { error = (e as? AdminAPI.APIError)?.errorDescription ?? e.localizedDescription }
        loading = false
    }

    private func send() async {
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true; error = nil
        do {
            try await api.reply(threadID: thread.id, body: text)
            reply = ""
            await load()
            onChange()   // refresh the thread list (unread/preview/SLA)
        } catch let e {
            error = (e as? AdminAPI.APIError)?.errorDescription ?? e.localizedDescription
        }
        sending = false
    }
}

private struct MessageBubble: View {
    let message: ThreadMessage
    var downloadingId: String? = nil
    var onTapAttachment: (MessageAttachment) -> Void = { _ in }
    private var mine: Bool { message.fromRole == "clinician" }
    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                if !message.body.isEmpty {
                    Text(message.body)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(mine ? Theme.accent.opacity(0.85) : Theme.surface,
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .foregroundStyle(mine ? .white : .primary)
                }
                if let atts = message.attachments, !atts.isEmpty {
                    ForEach(atts) { a in attachmentChip(a) }
                }
                HStack(spacing: 6) {
                    Text(mine ? "You" : "Patient")
                    Text(fmtEpoch(message.createdAt, dateStyle: .short, timeStyle: .short))
                    if mine, message.readAt != nil { Text("· read") }
                }
                .font(.caption2).foregroundStyle(.tertiary)
            }
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func attachmentChip(_ a: MessageAttachment) -> some View {
        Button { onTapAttachment(a) } label: {
            HStack(spacing: 6) {
                Image(systemName: icon(for: a.mimeType))
                Text(a.filename ?? "Attachment").lineLimit(1)
                if let s = a.sizeBytes { Text("· \(s / 1024) KB").foregroundStyle(.secondary) }
                if downloadingId == a.id { ProgressView().controlSize(.small) }
                else { Image(systemName: "arrow.down.circle") }
            }
            .font(.caption)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.surface, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func icon(for mime: String?) -> String {
        guard let mime else { return "paperclip" }
        if mime.hasPrefix("image/") { return "photo" }
        if mime.contains("pdf") { return "doc.richtext" }
        if mime.hasPrefix("video/") { return "video" }
        return "doc"
    }
}

/// A downloaded attachment ready to share/preview.
struct DownloadedFile: Identifiable {
    let id = UUID()
    let url: URL
}

#if os(iOS)
/// Bridges UIActivityViewController so a downloaded attachment can be shared/saved.
struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
#endif
