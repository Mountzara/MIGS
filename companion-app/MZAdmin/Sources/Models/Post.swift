import Foundation

/// A post as returned by /api/posts/_admin (summary) and /api/posts/_admin/:id (full).
/// Mirrors the fields written by functions/api/posts/[[path]].js.
struct Post: Identifiable, Codable, Hashable {
    let id: String
    var kind: String            // "blog" | "evidence" | "claim_proposal"
    var status: String          // "draft" | "published" | "rejected"
    var title: String
    var summary: String?
    var weekLabel: String?
    var verdict: String?
    var topicsCovered: [String]?
    var pmidsCited: [String]?
    var createdAt: String?
    var publishedAt: String?
    var updatedAt: String?
    var bodyHTML: String?       // only present on the full fetch

    enum CodingKeys: String, CodingKey {
        case id, kind, status, title, summary, verdict
        case weekLabel = "week_label"
        case topicsCovered = "topics_covered"
        case pmidsCited = "pmids_cited"
        case createdAt = "created_at"
        case publishedAt = "published_at"
        case updatedAt = "updated_at"
        case bodyHTML = "body_html"
    }

    var statusKind: StatusKind { StatusKind(rawValue: status) ?? .draft }
    var isDraft: Bool { statusKind == .draft }
    var isPublished: Bool { statusKind == .published }
    var isRejected: Bool { statusKind == .rejected }

    /// A friendly, name-free display title (the brand, never the clinician's name).
    var displayTitle: String { title.isEmpty ? id : title }
}

enum StatusKind: String, CaseIterable {
    case draft, published, rejected
    var label: String {
        switch self {
        case .draft: return "Pending review"
        case .published: return "Live"
        case .rejected: return "Rejected"
        }
    }
}

/// Wrapper for GET /api/posts/_admin which returns { posts: [...] }.
struct PostListResponse: Codable { let posts: [Post] }

enum PostKind: String, CaseIterable, Identifiable {
    case blog, evidence
    var id: String { rawValue }
    var title: String {
        switch self {
        case .blog: return "Trend Briefs"      // evidence-* slugs carry kind=blog
        case .evidence: return "Monday Mornings" // blog-* slugs carry kind=evidence
        }
    }
}
