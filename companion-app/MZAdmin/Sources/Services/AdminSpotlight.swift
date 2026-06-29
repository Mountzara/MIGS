import Foundation
import os
#if canImport(CoreSpotlight)
import CoreSpotlight
#endif
#if canImport(AppIntents)
import AppIntents
#endif

/// Mount Zara — Spotlight semantic indexer for the MZ Admin app.
///
/// Mirrors the §4(C) "Content Spotlight indexer" pattern from the OS-27
/// migration handoff (CLAUDE.md Rule 28 + §6 PHI policy):
///
///   • Posts (Blog + Monday Mornings)        — indexed (public content)
///   • Trend briefs (claim text + verdict)   — indexed (public-once-published)
///   • Carousels (slug + title)              — indexed (public-once-published)
///   • Messages / Triage / Patients          — NEVER indexed (PHI)
///
/// The cloud-readable Siri semantic index is intentionally restricted to
/// content that is or becomes publicly visible on mountzara.com. Patient-
/// derived surfaces stay behind the operator's intentional review flows in
/// the app and are excluded by design.
@available(macOS 15.0, iOS 17.0, *)
enum AdminSpotlight {
    private static let log = Logger(subsystem: "com.mountzara.mzadmin", category: "spotlight")

    /// Index every non-PHI surface available to the signed-in admin.
    /// Called from MZAdminApp's `.task` once authenticated.
    static func indexAll(api: AdminAPI) async {
        #if canImport(CoreSpotlight)
        if #available(macOS 15.0, iOS 18.0, *) {
            await indexPosts(api: api)
            await indexTrendBriefs(api: api)
            await indexCarousels(api: api)
        } else {
            log.info("indexAll: CoreSpotlight 18+ required; skipping")
        }
        #else
        log.info("indexAll: CoreSpotlight unavailable on this platform")
        #endif
    }

    #if canImport(CoreSpotlight)

    @available(macOS 15.0, iOS 18.0, *)
    private static func indexPosts(api: AdminAPI) async {
        var entities: [AdminPostEntity] = []
        for kind in PostKind.allCases {
            do {
                let posts = try await api.listPosts(kind: kind)
                entities.append(contentsOf: posts.map { AdminPostEntity($0) })
            } catch {
                log.error("indexPosts(\(kind.rawValue)) failed: \(error.localizedDescription)")
            }
        }
        do {
            try await CSSearchableIndex.default().indexAppEntities(entities)
            log.info("AdminSpotlight: indexed \(entities.count) posts into the semantic index")
        } catch {
            log.error("indexPosts CoreSpotlight push failed: \(error.localizedDescription)")
        }
    }

    @available(macOS 15.0, iOS 18.0, *)
    private static func indexTrendBriefs(api: AdminAPI) async {
        do {
            // include_done=1 so the index reflects everything the operator
            // has ever published / approved, not just the pending queue.
            let briefs = try await api.listTrendBriefs(includeDone: true)
            let entities = briefs.map { AdminTrendBriefEntity($0) }
            try await CSSearchableIndex.default().indexAppEntities(entities)
            log.info("AdminSpotlight: indexed \(entities.count) trend briefs into the semantic index")
        } catch {
            log.error("indexTrendBriefs failed: \(error.localizedDescription)")
        }
    }

    @available(macOS 15.0, iOS 18.0, *)
    private static func indexCarousels(api: AdminAPI) async {
        do {
            let carousels = try await api.listCarousels()
            let entities = carousels.map { AdminCarouselEntity($0) }
            try await CSSearchableIndex.default().indexAppEntities(entities)
            log.info("AdminSpotlight: indexed \(entities.count) carousels into the semantic index")
        } catch {
            log.error("indexCarousels failed: \(error.localizedDescription)")
        }
    }

    #endif
}

// MARK: - AppEntity / IndexedEntity declarations

#if canImport(AppIntents) && canImport(CoreSpotlight)

/// Admin API bound to the signed-in operator's Keychain token, for resolving
/// indexed entities from the App Intents / Spotlight context.
@available(macOS 15.0, iOS 18.0, *)
private func entityResolverAPI() async -> AdminAPI {
    let token = await MainActor.run { AuthStore().basicToken }
    return AdminAPI(token: token)
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminPostEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Mount Zara post" }
    static var defaultQuery = AdminPostEntityQuery()

    let id: String
    let title: String
    let subtitle: String
    let content: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let set = CSSearchableItemAttributeSet(contentType: .text)
        set.title = title
        set.contentDescription = content
        set.keywords = ["Mount Zara", "post", "research digest"]
        return set
    }

    init(_ post: Post) {
        self.id = post.id
        self.title = post.title.isEmpty ? post.id : post.title
        let parts = [post.kind, post.status, post.weekLabel].compactMap { $0 }.filter { !$0.isEmpty }
        self.subtitle = parts.joined(separator: " · ")
        var body = "\(post.title)\n"
        if let s = post.summary { body += s + "\n" }
        if let v = post.verdict { body += "Verdict: \(v)\n" }
        if let t = post.topicsCovered { body += "Topics: \(t.joined(separator: ", "))\n" }
        self.content = body
    }
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminPostEntityQuery: EntityQuery {
    func suggestedEntities() async throws -> [AdminPostEntity] {
        let api = await entityResolverAPI()
        var out: [AdminPostEntity] = []
        for kind in PostKind.allCases {
            if let ps = try? await api.listPosts(kind: kind) { out += ps.prefix(12).map(AdminPostEntity.init) }
        }
        return Array(out.prefix(24))
    }
    func entities(for identifiers: [AdminPostEntity.ID]) async throws -> [AdminPostEntity] {
        let ids = Set(identifiers)
        return try await suggestedEntities().filter { ids.contains($0.id) }
    }
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminTrendBriefEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Trend brief" }
    static var defaultQuery = AdminTrendBriefEntityQuery()

    let id: String
    let title: String
    let subtitle: String
    let content: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let set = CSSearchableItemAttributeSet(contentType: .text)
        set.title = title
        set.contentDescription = content
        set.keywords = ["Mount Zara", "trend brief", "evidence"]
        return set
    }

    init(_ brief: TrendBrief) {
        self.id = brief.id
        self.title = brief.claimText ?? brief.slug ?? brief.id
        var parts = [brief.status]
        if let d = brief.briefDate { parts.append(d) }
        if let inf = brief.influencer, !inf.isEmpty { parts.append(inf) }
        self.subtitle = parts.joined(separator: " · ")
        var body = (brief.claimText ?? "") + "\n"
        body += "Status: \(brief.status)\n"
        if let inf = brief.influencer, !inf.isEmpty { body += "Source: \(inf)\n" }
        if let topics = brief.topicsCovered, !topics.isEmpty {
            body += "Topics: \(topics.joined(separator: ", "))\n"
        }
        self.content = body
    }
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminTrendBriefEntityQuery: EntityQuery {
    func suggestedEntities() async throws -> [AdminTrendBriefEntity] {
        let api = await entityResolverAPI()
        let briefs = (try? await api.listTrendBriefs(includeDone: true)) ?? []
        return briefs.prefix(24).map(AdminTrendBriefEntity.init)
    }
    func entities(for identifiers: [AdminTrendBriefEntity.ID]) async throws -> [AdminTrendBriefEntity] {
        let ids = Set(identifiers)
        return try await suggestedEntities().filter { ids.contains($0.id) }
    }
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminCarouselEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Carousel" }
    static var defaultQuery = AdminCarouselEntityQuery()

    let id: String
    let title: String
    let subtitle: String
    let content: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let set = CSSearchableItemAttributeSet(contentType: .text)
        set.title = title
        set.contentDescription = content
        set.keywords = ["Mount Zara", "carousel", "social"]
        return set
    }

    init(_ c: Carousel) {
        self.id = c.slug
        self.title = c.title ?? c.slug
        var parts = [c.status]
        if let week = c.weekLabel, !week.isEmpty { parts.append(week) }
        if let topic = c.postTopic, !topic.isEmpty { parts.append(topic) }
        self.subtitle = parts.joined(separator: " · ")
        var body = (c.title ?? c.slug) + "\n"
        body += "Status: \(c.status)\n"
        if let topic = c.postTopic, !topic.isEmpty { body += "Topic: \(topic)\n" }
        if let week = c.weekLabel, !week.isEmpty { body += "Week: \(week)\n" }
        self.content = body
    }
}

@available(macOS 15.0, iOS 18.0, *)
struct AdminCarouselEntityQuery: EntityQuery {
    func suggestedEntities() async throws -> [AdminCarouselEntity] {
        let api = await entityResolverAPI()
        let cs = (try? await api.listCarousels()) ?? []
        return cs.prefix(24).map(AdminCarouselEntity.init)
    }
    func entities(for identifiers: [AdminCarouselEntity.ID]) async throws -> [AdminCarouselEntity] {
        let ids = Set(identifiers)
        return try await suggestedEntities().filter { ids.contains($0.id) }
    }
}

#endif
