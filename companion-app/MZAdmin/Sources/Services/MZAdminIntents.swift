import Foundation
import os
#if canImport(AppIntents)
import AppIntents
#endif

/// Mount Zara — App Intents + Siri AppShortcuts for MZ Admin.
///
/// All three intents answer from the operator's *live content queue* (posts /
/// trend briefs / carousels) — grounded, not guessed:
///   - AskAdminIntent       — on-device, tool-calling Q&A over the queue
///   - SummarizeQueueIntent  — structured "what needs attention" digest
///   - PendingQueueIntent    — real pending counts + opens the app
///
/// PHI rule (Rule 28 / §6): patient-derived data (messages, triage, patients,
/// schedule) is never surfaced through Siri. Content surfaces only.
#if canImport(AppIntents)

/// Reads the admin Basic-auth token from the Keychain (shared with the app).
/// Returns nil when the operator hasn't signed in (or the Keychain isn't
/// reachable from this process).
private func adminToken() async -> String? {
    await MainActor.run { AuthStore().basicToken }
}

@available(macOS 15.0, iOS 17.0, *)
struct AskAdminIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask MZ Admin"
    static var description = IntentDescription(
        "Answer a question about Dr. Mabini's content queue — research-digest posts, trend briefs, and carousels — on-device, grounded in the live queue via Apple Foundation Models tool-calling."
    )
    static var openAppWhenRun: Bool = false

    @Parameter(
        title: "Question",
        description: "The content-queue question to look up.",
        requestValueDialog: "What can I look up in your queue?"
    )
    var question: String

    private static let log = Logger(subsystem: "com.mountzara.mzadmin", category: "intent.ask")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        Self.log.info("AskAdminIntent.perform: '\(question)'")

        guard OnDeviceModel.isAvailable else {
            return .result(dialog: .init(stringLiteral: OnDeviceModel.availabilityDescription))
        }
        if #available(macOS 26.0, iOS 26.0, *) {
            guard let token = await adminToken() else {
                return .result(dialog: "Sign in to MZ Admin first, then ask again.")
            }
            do {
                let answer = try await AdminAIEngine.answer(token: token, query: question)
                return .result(dialog: .init(stringLiteral: answer))
            } catch {
                Self.log.error("AskAdminIntent failed: \(error.localizedDescription)")
                return .result(dialog: "I couldn't answer that on device.")
            }
        }
        return .result(dialog: "Requires iOS 26 / macOS 26 with Apple Intelligence.")
    }
}

@available(macOS 15.0, iOS 17.0, *)
struct SummarizeQueueIntent: AppIntent {
    static var title: LocalizedStringResource = "Summarize MZ Admin queue"
    static var description = IntentDescription(
        "On-device summary of what most needs attention across the content queue."
    )
    static var openAppWhenRun: Bool = false

    private static let log = Logger(subsystem: "com.mountzara.mzadmin", category: "intent.summary")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard OnDeviceModel.isAvailable else {
            return .result(dialog: .init(stringLiteral: OnDeviceModel.availabilityDescription))
        }
        if #available(macOS 26.0, iOS 26.0, *) {
            guard let token = await adminToken() else {
                return .result(dialog: "Sign in to MZ Admin first.")
            }
            do {
                let d = try await AdminAIEngine.digest(token: token)
                var text = d.headline
                if !d.actions.isEmpty { text += " " + d.actions.prefix(3).joined(separator: "; ") }
                return .result(dialog: .init(stringLiteral: text))
            } catch {
                Self.log.error("SummarizeQueueIntent failed: \(error.localizedDescription)")
                return .result(dialog: "I couldn't summarize the queue on device.")
            }
        }
        return .result(dialog: "Requires iOS 26 / macOS 26 with Apple Intelligence.")
    }
}

@available(macOS 15.0, iOS 17.0, *)
struct PendingQueueIntent: AppIntent {
    static var title: LocalizedStringResource = "What's pending in MZ Admin"
    static var description = IntentDescription(
        "Report how many content items are awaiting review, then open the app."
    )
    static var openAppWhenRun: Bool = true

    private static let log = Logger(subsystem: "com.mountzara.mzadmin", category: "intent.pending")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let token = await adminToken() else {
            return .result(dialog: "Sign in to MZ Admin first.")
        }
        let c = await AdminQueue.pendingCounts(token: token)
        // Best-effort deep-link to the review queue when the app comes forward
        // (no-op if this intent runs outside the app process).
        await MainActor.run { NotificationRouter.shared.selectedTab = .posts }

        let total = c.posts + c.briefs + c.carousels
        Self.log.info("PendingQueueIntent: posts=\(c.posts) briefs=\(c.briefs) carousels=\(c.carousels)")
        let msg: String
        if total == 0 {
            msg = "Nothing is pending review right now."
        } else {
            func n(_ k: Int, _ s: String) -> String { "\(k) \(s)\(k == 1 ? "" : "s")" }
            msg = "Pending review: \(n(c.posts, "draft post")), \(n(c.briefs, "trend brief")), and \(n(c.carousels, "carousel"))."
        }
        return .result(dialog: .init(stringLiteral: msg))
    }
}

@available(macOS 15.0, iOS 17.0, *)
struct MZAdminShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskAdminIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "\(.applicationName) lookup",
                "Look something up in \(.applicationName)",
            ],
            shortTitle: "Ask MZ Admin",
            systemImageName: "questionmark.bubble"
        )
        AppShortcut(
            intent: SummarizeQueueIntent(),
            phrases: [
                "Summarize my \(.applicationName) queue",
                "What needs attention in \(.applicationName)",
            ],
            shortTitle: "Summarize queue",
            systemImageName: "wand.and.stars"
        )
        AppShortcut(
            intent: PendingQueueIntent(),
            phrases: [
                "What's pending in \(.applicationName)",
                "Open pending review in \(.applicationName)",
            ],
            shortTitle: "Pending review",
            systemImageName: "tray.full"
        )
    }
}

#endif
