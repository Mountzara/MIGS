import Foundation
import os
#if canImport(AppIntents)
import AppIntents
#endif

/// Mount Zara — App Intents + Siri AppShortcuts for MZ Admin.
///
/// Mirrors the §3 design pattern from the OS-27 migration handoff:
///   - Fixed-phrase AppShortcuts are a secondary surface.
///   - The primary "answer from my admin queue" path is the Spotlight
///     semantic index that AdminSpotlight populates.
///
/// Triggers (when Apple Intelligence is enabled on the device):
///   - "Hey Siri, ask MZ Admin about <question>"     → AskAdminIntent
///   - "Hey Siri, what's pending in MZ Admin?"        → PendingQueueIntent
///
/// PHI rule: these intents only answer from the public-content queue
/// (posts / trend briefs / carousels). Patient-derived data is never
/// surfaced through Siri.
#if canImport(AppIntents)

@available(macOS 15.0, iOS 17.0, *)
struct AskAdminIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask MZ Admin"
    static var description = IntentDescription(
        "Answer a question about Dr. Mabini's content queue — research-digest posts, trend briefs, and carousels — using the on-device Apple Foundation Models engine."
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

        // The Spotlight index is the authoritative content surface. For the
        // first cut we hand the model a short stub describing that the
        // operator's queue lives on mountzara.com behind admin auth, and
        // let Siri's own Spotlight retrieval supplement.
        // (When the OS-27 semantic-Siri pull-through API lands, swap this
        // for the IndexedEntity context API per CLAUDE.md §3 / Rule 28.)
        let context = """
        MZ Admin is Dr. Mabini's mission-control app for the Mount Zara
        content pipeline. Surfaces: research-digest blog posts, trend briefs,
        social carousels. The Spotlight semantic index carries the operator's
        recent queue — titles, statuses, slugs, claim text, week labels, and
        topics. Patient-derived content is intentionally not in this index.
        """
        do {
            let answer = try await OnDeviceModel.answerAdmin(query: question, context: context)
            return .result(dialog: .init(stringLiteral: answer))
        } catch {
            Self.log.error("AskAdminIntent failed: \(error.localizedDescription)")
            return .result(dialog: .init(stringLiteral: "I couldn't answer that on device."))
        }
    }
}

@available(macOS 15.0, iOS 17.0, *)
struct PendingQueueIntent: AppIntent {
    static var title: LocalizedStringResource = "Show pending review in MZ Admin"
    static var description = IntentDescription(
        "Open the MZ Admin app to the items waiting for clinician review."
    )
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult { .result() }
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
