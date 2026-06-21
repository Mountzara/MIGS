import Foundation
import os

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Mount Zara — On-device Apple Foundation Models wrapper for MZ Admin.
///
/// Mirrors the §4(A) reference engine that ships in the other Mount Zara apps
/// (MedicalTranscription, ABOG Case List Manager, ClinicalAI, MZ Research
/// Suite, Surgical Video Archive, FMIGS) — see CLAUDE.md Rule 28.
///
/// Sole in-app LLM. Never routes anything off-device. PHI is never sent here
/// to begin with — MZ Admin's PHI surfaces (Messages, Triage, Patients) stay
/// behind the operator's intentional review flows and are never used as
/// context for this model.
///
/// API mirrors the canonical engine in the other apps so future shared-package
/// extraction is a clean copy/paste:
///   - `OnDeviceModel.isAvailable` — is Apple Intelligence on this device?
///   - `OnDeviceModel.availabilityDescription` — human-readable why-not
///   - `OnDeviceModel.complete(system:user:)` — generic completion
///   - `OnDeviceModel.answerAdmin(query:context:)` — admin-content Q&A
enum OnDeviceModel {
    private static let log = Logger(subsystem: "com.mountzara.admin", category: "ondevice")

    /// True only when:
    ///   (a) the FoundationModels framework is linkable (macOS 26+/iOS 26+)
    ///   AND
    ///   (b) Apple Intelligence is enabled on this device AND
    ///   (c) the on-device model has been downloaded.
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, iOS 26.0, *) {
            return SystemLanguageModel.default.availability == .available
        }
        #endif
        return false
    }

    /// One-line human description of why the on-device engine is or isn't
    /// usable right now. Surfaced in the in-app status row + os.Logger.
    static var availabilityDescription: String {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return "On-device Apple Intelligence ready"
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible:
                    return "Device not eligible for Apple Intelligence"
                case .appleIntelligenceNotEnabled:
                    return "Enable Apple Intelligence in Settings"
                case .modelNotReady:
                    return "Apple Intelligence model still downloading"
                @unknown default:
                    return "On-device model unavailable"
                }
            @unknown default:
                return "On-device model unavailable"
            }
        }
        return "Requires macOS 26 / iOS 26 (Apple Intelligence)"
        #else
        return "Built without FoundationModels framework"
        #endif
    }

    /// Generic system+user completion. Throws if Apple Intelligence isn't
    /// available so callers can surface a clean fallback.
    static func complete(system: String, user: String) async throws -> String {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, iOS 26.0, *) {
            guard SystemLanguageModel.default.availability == .available else {
                throw OnDeviceError.unavailable(availabilityDescription)
            }
            let session = LanguageModelSession(instructions: system)
            let response = try await session.respond(to: user)
            log.info("complete: ok (\(response.content.count) chars)")
            return response.content
        }
        throw OnDeviceError.unavailable("Requires macOS 26 / iOS 26")
        #else
        throw OnDeviceError.unavailable("FoundationModels framework not available")
        #endif
    }

    /// Admin-facing Q&A: answers a question about the operator's own queued
    /// content (posts / trend briefs / carousels) using the Spotlight-indexed
    /// context that AdminSpotlight surfaces.
    ///
    /// PHI rule (Rule 28 / §6): patient-derived content (messages, triage,
    /// patient records) is NEVER passed in here. Callers are responsible for
    /// only supplying public/queue surfaces.
    static func answerAdmin(query: String, context: String) async throws -> String {
        let system = """
        You are the Mount Zara admin assistant for Dr. Chris Mabini.
        You answer questions about Dr. Mabini's content queue — research-digest
        posts, trend briefs, and social carousels — using only the structured
        context provided.

        Constraints:
        - Be concise (2–4 sentences unless the user asks for detail).
        - Quote ids/slugs verbatim when referring to specific items.
        - If the context doesn't contain the answer, say so plainly — do NOT
          fabricate post titles, PMIDs, dates, or verdicts.
        - Never speculate about patients or clinical events; this surface
          covers content only.
        """
        let user = """
        Question: \(query)

        Context:
        \(context)
        """
        return try await complete(system: system, user: user)
    }

    enum OnDeviceError: LocalizedError {
        case unavailable(String)
        var errorDescription: String? {
            switch self {
            case .unavailable(let why): return why
            }
        }
    }
}
