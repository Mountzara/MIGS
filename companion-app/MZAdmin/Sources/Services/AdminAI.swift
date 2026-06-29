import Foundation
import SwiftUI
import os

#if canImport(FoundationModels)
import FoundationModels
#endif

// =====================================================================
// MZ Admin — AI-native layer (Apple FoundationModels, on-device).
//
// Everything here runs on-device via Apple Intelligence (iOS 26 / macOS 26).
// The model is grounded in Dr. Mabini's live content queue through *tool
// calling* — it decides when to query posts / trend briefs / carousels and
// answers from the returned data instead of guessing.
//
// PHI rule (CLAUDE.md Rule 28 / §6): the tools ONLY touch the public-content
// surfaces (posts, trend briefs, carousels). Messages, Triage, and Patient
// records are never exposed to the model.
// =====================================================================

#if canImport(FoundationModels)

/// Rough token budget for the shared 4096-token prompt+answer window: keep
/// each tool's returned context well under it so we never silently overflow
/// into the non-AI fallback (see memory: fm-ondevice-window-and-mac-verification).
private let kToolOutputCharBudget = 2200

@available(iOS 26.0, macOS 26.0, *)
private func clamp(_ s: String, _ max: Int) -> String {
    s.count <= max ? s : String(s.prefix(max)) + "…(truncated)"
}

/// Tool: search the content queue by keyword. The model calls this to ground
/// answers in real titles / statuses / ids.
@available(iOS 26.0, macOS 26.0, *)
struct ContentSearchTool: Tool {
    let name = "searchContent"
    let description = "Search Dr. Mabini's content queue (research-digest posts, trend briefs, social carousels) by keyword. Returns matching titles, statuses, and ids. Content only — never patient data."
    let token: String?

    @Generable
    struct Arguments {
        @Guide(description: "Keywords to match against titles, topics, and claim text.")
        var query: String
        @Guide(description: "Which surface to search: one of posts, briefs, carousels, all.")
        var kind: String
    }

    func call(arguments: Arguments) async throws -> String {
        let api = AdminAPI(token: token)
        let q = arguments.query.lowercased()
        let want = arguments.kind.lowercased()
        var lines: [String] = []

        func matches(_ haystacks: [String?]) -> Bool {
            q.isEmpty || haystacks.contains { ($0 ?? "").lowercased().contains(q) }
        }

        if want == "posts" || want == "all" {
            for kind in PostKind.allCases {
                if let posts = try? await api.listPosts(kind: kind) {
                    for p in posts where matches([p.title, p.summary, p.weekLabel, (p.topicsCovered ?? []).joined(separator: " ")]) {
                        lines.append("POST [\(p.id)] \(p.title) — \(p.status)\(p.weekLabel.map { " · \($0)" } ?? "")")
                    }
                }
            }
        }
        if want == "briefs" || want == "all" {
            if let briefs = try? await api.listTrendBriefs(includeDone: true) {
                for b in briefs where matches([b.claimText, b.influencer, (b.topicsCovered ?? []).joined(separator: " ")]) {
                    lines.append("BRIEF [\(b.id)] \(b.claimText ?? b.slug ?? b.id) — \(b.status)")
                }
            }
        }
        if want == "carousels" || want == "all" {
            if let cs = try? await api.listCarousels() {
                for c in cs where matches([c.title, c.postTopic, c.weekLabel]) {
                    lines.append("CAROUSEL [\(c.slug)] \(c.title ?? c.slug) — \(c.status)")
                }
            }
        }
        if lines.isEmpty { return "No content items matched \"\(arguments.query)\"." }
        return clamp(lines.prefix(40).joined(separator: "\n"), kToolOutputCharBudget)
    }
}

/// Tool: counts of items awaiting review across the content surfaces.
@available(iOS 26.0, macOS 26.0, *)
struct PendingCountsTool: Tool {
    let name = "getPendingCounts"
    let description = "Get counts of content items awaiting review: draft posts, pending trend briefs, and draft carousels. Content only — never patient data."
    let token: String?

    @Generable
    struct Arguments {
        @Guide(description: "Surface to count, or 'all'.")
        var category: String
    }

    func call(arguments: Arguments) async throws -> String {
        let api = AdminAPI(token: token)
        var posts = 0, briefs = 0, carousels = 0
        for kind in PostKind.allCases {
            if let ps = try? await api.listPosts(kind: kind) { posts += ps.filter { $0.status == "draft" }.count }
        }
        if let bs = try? await api.listTrendBriefs(includeDone: false) { briefs = bs.filter { $0.status == "pending" }.count }
        if let cs = try? await api.listCarousels() { carousels = cs.filter { $0.status == "draft" }.count }
        return "Pending review — draft posts: \(posts), pending trend briefs: \(briefs), draft carousels: \(carousels)."
    }
}

/// Structured summary of the content queue (guided generation).
@available(iOS 26.0, macOS 26.0, *)
@Generable
struct QueueDigest {
    @Guide(description: "One-sentence headline of what most needs the operator's attention.")
    var headline: String
    @Guide(description: "Up to 4 short, concrete next actions.")
    var actions: [String]
}

#endif

// =====================================================================
// Assistant engine — a streaming, tool-calling chat session.
// =====================================================================

/// One turn in the assistant transcript.
struct AssistantTurn: Identifiable, Equatable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    var text: String
}

#if canImport(FoundationModels)

@available(iOS 26.0, macOS 26.0, *)
@MainActor
final class AdminAssistant: ObservableObject {
    @Published var turns: [AssistantTurn] = []
    @Published var isResponding = false
    @Published var input: String = ""
    @Published var errorText: String?

    private let auth: AuthStore
    private var session: LanguageModelSession?
    private let log = Logger(subsystem: "com.mountzara.mzadmin", category: "assistant")

    private static let instructions = """
    You are the Mount Zara admin assistant for Dr. Chris Mabini. You help him
    manage his CONTENT pipeline: research-digest posts, trend briefs, and social
    carousels. Use the provided tools to look up real items and counts — never
    invent titles, ids, statuses, dates, or PMIDs. If a tool returns nothing,
    say so plainly. Be concise (2–4 sentences) unless asked for detail. You have
    no access to patient data, messages, triage, or schedules; if asked about
    those, say they are out of scope for this assistant.
    """

    init(auth: AuthStore) { self.auth = auth }

    private func ensureSession() {
        guard session == nil else { return }
        let token = auth.basicToken
        let s = LanguageModelSession(
            tools: [ContentSearchTool(token: token), PendingCountsTool(token: token)],
            instructions: Self.instructions
        )
        s.prewarm()
        session = s
    }

    /// Send the current input and stream the grounded answer back.
    func send() async {
        let q = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !isResponding else { return }
        input = ""
        errorText = nil
        turns.append(AssistantTurn(role: .user, text: q))
        turns.append(AssistantTurn(role: .assistant, text: ""))
        let replyIndex = turns.count - 1
        isResponding = true
        defer { isResponding = false }

        ensureSession()
        guard let session else {
            turns[replyIndex].text = "On-device model unavailable."
            return
        }
        let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: 500)
        do {
            for try await partial in session.streamResponse(to: q, options: options) {
                turns[replyIndex].text = partial.content
            }
            log.info("assistant: answered (\(self.turns[replyIndex].text.count) chars)")
        } catch {
            log.error("assistant stream failed: \(error.localizedDescription)")
            errorText = error.localizedDescription
            if turns[replyIndex].text.isEmpty {
                turns[replyIndex].text = "I couldn't answer that on device."
            }
        }
    }

    /// One-shot structured digest of the queue (guided generation + tools).
    func digest() async -> QueueDigest? {
        ensureSession()
        guard let session else { return nil }
        do {
            let r = try await session.respond(
                to: "Summarize what most needs my attention across the content queue. Use getPendingCounts.",
                generating: QueueDigest.self,
                options: GenerationOptions(temperature: 0.2)
            )
            return r.content
        } catch {
            log.error("digest failed: \(error.localizedDescription)")
            return nil
        }
    }
}

#endif

// =====================================================================
// In-app Assistant tab.
// =====================================================================

/// The Assistant tab. Shows the on-device chat when Apple Intelligence is
/// available, and a clear status row explaining why not when it isn't.
struct AssistantView: View {
    let auth: AuthStore

    var body: some View {
        NavigationStack {
            Group {
                #if canImport(FoundationModels)
                if #available(iOS 26.0, macOS 26.0, *), OnDeviceModel.isAvailable {
                    AssistantChatView(auth: auth)
                } else {
                    unavailable
                }
                #else
                unavailable
                #endif
            }
            .navigationTitle("Assistant")
        }
    }

    private var unavailable: some View {
        ContentUnavailableView {
            Label("On-device assistant", systemImage: "sparkles")
        } description: {
            Text(OnDeviceModel.availabilityDescription)
        }
    }
}

#if canImport(FoundationModels)

@available(iOS 26.0, macOS 26.0, *)
struct AssistantChatView: View {
    @StateObject private var assistant: AdminAssistant
    @FocusState private var inputFocused: Bool

    init(auth: AuthStore) { _assistant = StateObject(wrappedValue: AdminAssistant(auth: auth)) }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if assistant.turns.isEmpty { emptyState }
                        ForEach(assistant.turns) { turn in
                            bubble(turn).id(turn.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: assistant.turns) { _, t in
                    if let last = t.last?.id { withAnimation { proxy.scrollTo(last, anchor: .bottom) } }
                }
            }
            composer
        }
        .overlay(alignment: .bottom) { ErrorBar(text: assistant.errorText) }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("On-device · grounded in your queue", systemImage: "sparkles")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accentSoft)
            Text("Ask about your content pipeline — e.g. “what's pending?”, “any carousels about endometriosis?”, “summarize my drafts.” Answers come from live posts, trend briefs, and carousels. No patient data.")
                .font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func bubble(_ turn: AssistantTurn) -> some View {
        HStack {
            if turn.role == .user { Spacer(minLength: 40) }
            Text(turn.text.isEmpty && turn.role == .assistant ? "…" : turn.text)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: turn.role == .user ? .trailing : .leading)
                .multilineTextAlignment(turn.role == .user ? .trailing : .leading)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(turn.role == .user ? Theme.accent.opacity(0.22) : Color.white.opacity(0.06),
                            in: RoundedRectangle(cornerRadius: 14))
            if turn.role == .assistant { Spacer(minLength: 40) }
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask about your queue…", text: $assistant.input, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.plain)
                .focused($inputFocused)
                .onSubmit { Task { await assistant.send() } }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Color.white.opacity(0.06), in: Capsule())
            Button {
                inputFocused = false
                Task { await assistant.send() }
            } label: {
                Image(systemName: assistant.isResponding ? "stop.circle.fill" : "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(assistant.input.trimmingCharacters(in: .whitespaces).isEmpty || assistant.isResponding)
            .tint(Theme.accent)
        }
        .padding(12)
        .background(.ultraThinMaterial)
    }
}

#endif
