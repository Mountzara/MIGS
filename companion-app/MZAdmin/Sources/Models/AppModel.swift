import Foundation
import SwiftUI

/// Central observable state for the app: holds the loaded posts, the selected
/// kind, loading/error state, and drives all API actions through AdminAPI.
@MainActor
final class AppModel: ObservableObject {
    @Published var kind: PostKind = .blog
    @Published var posts: [Post] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var actioningIDs: Set<String> = []   // ids mid approve/reject

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }

    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var drafts: [Post]    { posts.filter { $0.isDraft } }
    var published: [Post] { posts.filter { $0.isPublished } }
    var rejected: [Post]  { posts.filter { $0.isRejected } }

    func reload() async {
        isLoading = true; errorMessage = nil
        do {
            let fetched = try await api.listPosts(kind: kind)
            posts = fetched.sorted {
                // drafts first (the review queue), then by created date desc
                if $0.isDraft != $1.isDraft { return $0.isDraft }
                return ($0.createdAt ?? "") > ($1.createdAt ?? "")
            }
        } catch {
            errorMessage = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func fullPost(_ id: String) async -> Post? {
        try? await api.fetchPost(id: id)
    }

    func approve(_ post: Post) async {
        await act(post.id) { try await self.api.approve(id: post.id) }
    }

    func reject(_ post: Post) async {
        await act(post.id) { try await self.api.reject(id: post.id) }
    }

    private func act(_ id: String, _ op: @escaping () async throws -> Void) async {
        actioningIDs.insert(id)
        defer { actioningIDs.remove(id) }
        do { try await op(); await reload() }
        catch { errorMessage = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription }
    }
}
