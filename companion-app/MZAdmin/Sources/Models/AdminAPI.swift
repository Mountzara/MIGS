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
        // Concat instead of appendingPathComponent so query strings like "?kind=blog"
        // are preserved instead of being URL-encoded into the path (%3Fkind=blog → 404).
        let url = URL(string: baseURL.absoluteString + path) ?? baseURL
        var req = URLRequest(url: url)
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
    /// Returns nil on success or the specific APIError so the caller can
    /// distinguish 401 (wrong password) from offline / server / decoding.
    func verifyDescribingError() async -> APIError? {
        do {
            _ = try await listPosts(kind: .blog)
            return nil
        } catch let e as APIError {
            return e
        } catch {
            return .offline
        }
    }

    // MARK: - Decoding helper
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding("\(error)") }
    }

    // MARK: - Visit types
    func visitTypes() async throws -> [VisitType] {
        let data = try await send(request("/api/v1/admin/visit-types"))
        return try decode(VisitTypesResponse.self, data).visitTypes
    }

    // MARK: - Triage
    func listTriage(status: String = "pending") async throws -> [TriageRow] {
        let data = try await send(request("/api/v1/admin/triage?status=\(status)"))
        return try decode(TriageListResponse.self, data).pending
    }

    /// In-flight save of the clinician's overrides (does NOT release).
    func saveTriage(id: String, _ ovr: TriageOverride) async throws {
        let body = try JSONEncoder().encode(ovr)
        _ = try await send(request("/api/v1/admin/triage/\(id)", method: "PATCH", body: body))
    }

    /// Release the triage decision to the patient (stamps final_* + reviewed_at).
    func releaseTriage(id: String, finalVisitType: String, finalDurationMin: Int) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "final_visit_type": finalVisitType,
            "final_duration_min": finalDurationMin,
        ])
        _ = try await send(request("/api/v1/admin/triage/\(id)/release", method: "POST", body: body))
    }

    // MARK: - Messaging
    func listThreads() async throws -> [MessageThread] {
        let data = try await send(request("/api/v1/admin/messages"))
        return try decode(ThreadsResponse.self, data).threads
    }
    func thread(id: String) async throws -> ThreadDetailResponse {
        let data = try await send(request("/api/v1/admin/messages/\(id)"))
        return try decode(ThreadDetailResponse.self, data)
    }
    func reply(threadID: String, body text: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["body": text])
        _ = try await send(request("/api/v1/admin/messages/\(threadID)", method: "POST", body: body))
    }

    // MARK: - Scheduling
    func listAppointments(from: String, to: String) async throws -> [Appointment] {
        let data = try await send(request("/api/v1/admin/appointments?from=\(from)&to=\(to)"))
        return try decode(AppointmentsResponse.self, data).appointments
    }

    // MARK: - Patients
    func listPatients(query: String = "", limit: Int = 50) async throws -> [Patient] {
        var path = "/api/v1/admin/patients?limit=\(limit)"
        if !query.isEmpty {
            let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
            path += "&q=\(q)"
        }
        let data = try await send(request(path))
        return try decode(PatientsListResponse.self, data).patients
    }

    func patient(id: String) async throws -> PatientDetailResponse {
        let data = try await send(request("/api/v1/admin/patients/\(id)"))
        return try decode(PatientDetailResponse.self, data)
    }

    // MARK: - Cases (what's new)
    func caseWhatsNew(patientId: String) async throws -> WhatsNewResponse {
        let data = try await send(request("/api/v1/admin/cases/\(patientId)/whats-new"))
        return try decode(WhatsNewResponse.self, data)
    }

    /// Marks the case as just-viewed so subsequent whats-new responses only
    /// surface events that arrived after now.
    func markCaseViewed(patientId: String) async throws {
        _ = try await send(request("/api/v1/admin/cases/\(patientId)/whats-new", method: "POST", body: Data("{}".utf8)))
    }

    // MARK: - Trend Briefs
    func listTrendBriefs(includeDone: Bool = false) async throws -> [TrendBrief] {
        var path = "/api/v1/admin/trend-briefs/queue"
        if includeDone { path += "?include_done=1" }
        let data = try await send(request(path))
        return try decode(TrendBriefsQueueResponse.self, data).briefs
    }

    func trendBrief(id: String) async throws -> TrendBrief {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await send(request("/api/v1/admin/trend-briefs/\(encoded)"))
        return try decode(TrendBriefDetailResponse.self, data).brief
    }

    func approveTrendBrief(id: String, _ body: TrendBriefApproveBody) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let payload = try JSONEncoder().encode(body)
        _ = try await send(request("/api/v1/admin/trend-briefs/\(encoded)/approve", method: "POST", body: payload))
    }

    func rejectTrendBrief(id: String, reason: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let payload = try JSONSerialization.data(withJSONObject: ["reason": reason])
        _ = try await send(request("/api/v1/admin/trend-briefs/\(encoded)/reject", method: "POST", body: payload))
    }

    // MARK: - Feedback
    func listFeedback(statuses: [String]? = nil) async throws -> [Feedback] {
        var path = "/api/v1/admin/feedback"
        if let statuses, !statuses.isEmpty {
            path += "?status=\(statuses.joined(separator: ","))"
        }
        let data = try await send(request(path))
        return try decode(FeedbackListResponse.self, data).feedback
    }

    func feedback(id: String) async throws -> Feedback {
        let data = try await send(request("/api/v1/admin/feedback/\(id)"))
        return try decode(FeedbackDetailResponse.self, data).feedback
    }

    func approveFeedback(id: String, note: String?) async throws {
        var obj: [String: Any] = [:]
        if let note, !note.isEmpty { obj["note"] = note }
        let payload = try JSONSerialization.data(withJSONObject: obj)
        _ = try await send(request("/api/v1/admin/feedback/\(id)/approve", method: "POST", body: payload))
    }

    /// kind = "rejected" (considered, won't act now) or "wont_fix" (out of scope).
    func rejectFeedback(id: String, reason: String?, kind: String = "rejected") async throws {
        var obj: [String: Any] = ["kind": kind]
        if let reason, !reason.isEmpty { obj["reason"] = reason }
        let payload = try JSONSerialization.data(withJSONObject: obj)
        _ = try await send(request("/api/v1/admin/feedback/\(id)/reject", method: "POST", body: payload))
    }

    /// Authenticated PNG/JPEG bytes for the screenshot of a feedback row.
    /// Used by FeedbackDetailView to render an `Image(uiImage:)` directly
    /// (AsyncImage can't carry custom headers).
    func feedbackScreenshot(id: String) async throws -> Data {
        try await send(request("/api/v1/admin/feedback/\(id)/screenshot"))
    }
}

/// PATCH body for an in-flight triage override. Only the fields the
/// clinician changed need to be sent; the endpoint treats each as optional
/// and persists them (schema 0024) so they survive a reload.
struct TriageOverride: Codable {
    var visitType: String?
    var durationMin: Int?
    var urgency: String?
    var inPersonRequired: Bool?
    var preferredTimeOfDay: String?
    var overrideReason: String?
    enum CodingKeys: String, CodingKey {
        case visitType = "visit_type"
        case durationMin = "duration_min"
        case urgency
        case inPersonRequired = "in_person_required"
        case preferredTimeOfDay = "preferred_time_of_day"
        case overrideReason = "override_reason"
    }
}
