import Foundation

/// Thin async client for the Mount Zara admin API (functions/api/posts/[[path]].js).
/// Uses HTTP Basic auth, matching the web admin exactly.
struct AdminAPI {
    var baseURL = URL(string: "https://mountzara.com")!
    let token: String?   // base64 email:password

    enum APIError: LocalizedError {
        case unauthorized
        case http(Int, String)
        case decoding(String)
        case offline
        var errorDescription: String? {
            switch self {
            case .unauthorized: return "Wrong email or password."
            case .http(let c, let m): return "Server error \(c): \(m)"
            case .decoding(let m): return "Could not read the response: \(m)"
            case .offline: return "No network connection."
            }
        }
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        if let token { req.setValue("Basic \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        req.cachePolicy = .reloadIgnoringLocalCacheData
        return req
    }

    private func send(_ req: URLRequest) async throws -> Data {
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { return data }
            switch http.statusCode {
            case 200...299: return data
            case 401: throw APIError.unauthorized
            default:
                let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                    ?? String(data: data, encoding: .utf8) ?? ""
                throw APIError.http(http.statusCode, msg)
            }
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError.offline
        }
    }

    /// All posts (incl. drafts/rejected) for a kind — admin listing.
    func listPosts(kind: PostKind) async throws -> [Post] {
        let data = try await send(request("/api/posts/_admin?kind=\(kind.rawValue)"))
        do { return try JSONDecoder().decode(PostListResponse.self, from: data).posts }
        catch { throw APIError.decoding("\(error)") }
    }

    /// Full post (incl. body_html) for the detail/preview screen.
    func fetchPost(id: String) async throws -> Post {
        let data = try await send(request("/api/posts/_admin/\(id)"))
        do { return try JSONDecoder().decode(Post.self, from: data) }
        catch { throw APIError.decoding("\(error)") }
    }

    func approve(id: String) async throws {
        _ = try await send(request("/api/posts/\(id)/approve", method: "POST"))
    }

    func reject(id: String) async throws {
        _ = try await send(request("/api/posts/\(id)/reject", method: "POST"))
    }

    /// Verify credentials by hitting the authenticated listing once.
    func verify() async -> Bool {
        (try? await listPosts(kind: .blog)) != nil
    }
}
