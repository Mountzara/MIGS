import SwiftUI

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

    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var body: some View {
        VStack(spacing: 0) {
            if loading && messages.isEmpty {
                Spacer(); ProgressView("Loading…"); Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(messages) { m in MessageBubble(message: m).id(m.id) }
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
        catch { error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription }
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
        } catch {
            error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
        sending = false
    }
}

private struct MessageBubble: View {
    let message: ThreadMessage
    private var mine: Bool { message.fromRole == "clinician" }
    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                Text(message.body)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(mine ? Theme.accent.opacity(0.85) : Theme.surface,
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .foregroundStyle(mine ? .white : .primary)
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
}
