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

    /// Edit a post's content (PUT /api/posts/:id). Editable fields incl.
    /// title, summary, body_html, verdict, topics_covered, pmids_cited, status.
    func updatePost(id: String, fields: [String: Any]) async throws {
        let payload = try JSONSerialization.data(withJSONObject: fields)
        _ = try await send(request("/api/posts/\(id)", method: "PUT", body: payload))
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

    /// Update an appointment (status / cancel reason / reschedule / modality)
    /// via PATCH /api/v1/admin/appointments/<id>.
    @discardableResult
    func updateAppointment(id: String, fields: [String: Any]) async throws -> Appointment? {
        let payload = try JSONSerialization.data(withJSONObject: fields)
        let data = try await send(request("/api/v1/admin/appointments/\(id)", method: "PATCH", body: payload))
        // Handler returns the updated appointment under "appointment" (best-effort decode).
        return try? decode(AppointmentDetailResponse.self, data).appointment
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

    /// Edit patient profile fields (preferred_name, phone, pronouns,
    /// preferred_language, timezone, mrn, status) via PATCH /patients/<id>.
    func updatePatient(id: String, fields: [String: Any]) async throws {
        let payload = try JSONSerialization.data(withJSONObject: fields)
        _ = try await send(request("/api/v1/admin/patients/\(id)", method: "PATCH", body: payload))
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

    /// Full detail: the brief row + its audit-event timeline.
    func trendBriefDetail(id: String) async throws -> TrendBriefDetailResponse {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await send(request("/api/v1/admin/trend-briefs/\(encoded)"))
        return try decode(TrendBriefDetailResponse.self, data)
    }

    /// The rendered brief body (text/html) for inline preview.
    func trendBriefPreviewHTML(id: String) async throws -> String {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data = try await send(request("/api/v1/admin/trend-briefs/\(encoded)/preview"))
        return String(data: data, encoding: .utf8) ?? ""
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

    /// Full feedback row (with submission context) + its audit-event timeline.
    func feedbackDetail(id: String) async throws -> FeedbackDetailResponse {
        let data = try await send(request("/api/v1/admin/feedback/\(id)"))
        return try decode(FeedbackDetailResponse.self, data)
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

    /// Download a message attachment's bytes (decrypted server-side).
    func messageAttachment(id: String) async throws -> Data {
        try await send(request("/api/v1/admin/messages/attachments/\(id)"))
    }

    // MARK: - Carousels
    func listCarousels(status: String? = nil) async throws -> [Carousel] {
        var path = "/api/v1/admin/carousels"
        if let status, !status.isEmpty { path += "?status=\(status)" }
        let data = try await send(request(path))
        return try decode(CarouselsListResponse.self, data).carousels
    }

    func carousel(slug: String) async throws -> Carousel {
        let data = try await send(request("/api/v1/admin/carousels/\(slug)"))
        return try decode(CarouselDetailResponse.self, data).carousel
    }

    /// Edit a carousel's editorial fields (title, captions, alt_text, hashtags)
    /// via PUT /api/v1/admin/carousels/<slug>.
    @discardableResult
    func updateCarousel(slug: String, fields: [String: Any]) async throws -> Carousel? {
        let payload = try JSONSerialization.data(withJSONObject: fields)
        let data = try await send(request("/api/v1/admin/carousels/\(slug)", method: "PUT", body: payload))
        return try? decode(CarouselDetailResponse.self, data).carousel
    }

    /// Approve only succeeds when the §3.11.6 deploy gate marked the
    /// carousel ready_to_publish=true. Reject takes a short admin memo.
    func setCarouselDecision(slug: String, action: String, memo: String?) async throws {
        var obj: [String: Any] = ["action": action]
        if let memo, !memo.isEmpty { obj["admin_memo"] = memo }
        let payload = try JSONSerialization.data(withJSONObject: obj)
        _ = try await send(request("/api/v1/admin/carousels/\(slug)", method: "POST", body: payload))
    }

    /// Authenticated bytes for a carousel asset (e.g. cover PNG, slide PNG, PDF).
    func carouselAsset(slug: String, file: String) async throws -> Data {
        try await send(request("/api/v1/admin/carousels/\(slug)/asset/\(file)"))
    }

    // MARK: - Analytics
    func analytics(windowDays: Int = 30) async throws -> AdminAnalytics {
        let data = try await send(request("/api/v1/admin/analytics?window=\(windowDays)"))
        return try decode(AdminAnalytics.self, data)
    }

    // MARK: - Compliance
    func listComplianceDocs() async throws -> [ComplianceDoc] {
        let data = try await send(request("/api/v1/admin/compliance/docs"))
        return try decode(ComplianceDocsResponse.self, data).docs
    }

    /// Full compliance doc: rendered body + the active signature record.
    func complianceDocDetail(slug: String) async throws -> ComplianceDocDetail {
        let data = try await send(request("/api/v1/admin/compliance/docs/\(slug)"))
        return try decode(ComplianceDocDetail.self, data)
    }

    // MARK: - Briefings
    func listBriefings(date: String? = nil, range: String? = nil) async throws -> [Briefing] {
        var params: [String] = []
        if let date { params.append("date=\(date)") }
        if let range { params.append("range=\(range)") }
        let path = "/api/v1/admin/briefings" + (params.isEmpty ? "" : "?" + params.joined(separator: "&"))
        let data = try await send(request(path))
        return try decode(BriefingsResponse.self, data).briefings
    }

    /// Full pre-visit briefing for one patient (optionally focused on an appointment).
    func briefingDetail(patientId: String, appointmentId: String? = nil) async throws -> BriefingDetail {
        var path = "/api/v1/admin/briefings/\(patientId)"
        if let appointmentId { path += "?appointment_id=\(appointmentId)" }
        let data = try await send(request(path))
        return try decode(BriefingDetail.self, data)
    }

    // MARK: - Education
    func listEducation(status: String = "all") async throws -> [EducationMaterial] {
        let data = try await send(request("/api/v1/admin/education?status=\(status)"))
        return try decode(EducationListResponse.self, data).materials
    }

    /// Full record for one material, including `body_md` (inline markdown) and `r2_key`.
    func educationDetail(slug: String) async throws -> EducationMaterial {
        let data = try await send(request("/api/v1/admin/education/\(slug)"))
        return try decode(EducationDetailResponse.self, data).material
    }

    /// Change a material's publish status (draft → published, or → archived).
    /// Backend bumps `version` and stamps `published_at` on first publish.
    @discardableResult
    func setEducationStatus(slug: String, status: String) async throws -> EducationMaterial {
        let payload = try JSONSerialization.data(withJSONObject: ["status": status])
        let data = try await send(request("/api/v1/admin/education/\(slug)", method: "PATCH", body: payload))
        return try decode(EducationDetailResponse.self, data).material
    }

    /// Edit a material's title / summary (e.g. after accepting an AI suggestion).
    @discardableResult
    func updateEducation(slug: String, title: String?, summary: String?) async throws -> EducationMaterial {
        var fields: [String: Any] = [:]
        if let title { fields["title"] = title }
        if let summary { fields["summary"] = summary }
        return try await patchEducation(slug: slug, fields: fields)
    }

    /// Patch any editable education fields (title, summary, body_md, topic_tags,
    /// target_audience, status) — the full PATCH /api/v1/admin/education/<slug> contract.
    @discardableResult
    func patchEducation(slug: String, fields: [String: Any]) async throws -> EducationMaterial {
        let payload = try JSONSerialization.data(withJSONObject: fields)
        let data = try await send(request("/api/v1/admin/education/\(slug)", method: "PATCH", body: payload))
        return try decode(EducationDetailResponse.self, data).material
    }

    /// Ask the on-server Claude copy editor for a clearer title + summary,
    /// grounded in the material's own body (no clinical-fact changes).
    func suggestEducationEdit(slug: String, instruction: String) async throws -> SuggestEditResponse {
        let payload = try JSONSerialization.data(withJSONObject: ["kind": "education", "slug": slug, "instruction": instruction])
        let data = try await send(request("/api/v1/admin/ai/suggest-edit", method: "POST", body: payload))
        return try decode(SuggestEditResponse.self, data)
    }

    // MARK: - Debug sessions
    func listDebugSessions(limit: Int = 100) async throws -> DebugSessionsResponse {
        let data = try await send(request("/api/v1/admin/debug/sessions?limit=\(limit)"))
        return try decode(DebugSessionsResponse.self, data)
    }

    // MARK: - Billing
    func listBillingClaims(statuses: [String]? = nil, days: Int = 60, limit: Int = 50) async throws -> [BillingClaim] {
        var params: [String] = ["days=\(days)", "limit=\(limit)"]
        if let statuses, !statuses.isEmpty { params.append("status=\(statuses.joined(separator: ","))") }
        let path = "/api/v1/admin/billing/claims?" + params.joined(separator: "&")
        let data = try await send(request(path))
        return try decode(BillingClaimsResponse.self, data).claims
    }

    /// Full claim drill-down: lines, diagnoses, compliance flags, upcoding
    /// opportunities, and documentation suggestions.
    func fetchBillingClaimDetail(id: String) async throws -> BillingClaimDetail {
        let data = try await send(request("/api/v1/admin/billing/claims/\(id)"))
        return try decode(BillingClaimDetail.self, data)
    }

    func approveBillingClaim(id: String, notes: String?, force: Bool = false) async throws {
        var obj: [String: Any] = ["force": force]
        if let notes, !notes.isEmpty { obj["notes"] = notes }
        let payload = try JSONSerialization.data(withJSONObject: obj)
        _ = try await send(request("/api/v1/admin/billing/claims/\(id)/approve", method: "POST", body: payload))
    }

    func rejectBillingClaim(id: String, reason: String) async throws {
        let payload = try JSONSerialization.data(withJSONObject: ["reason": reason])
        _ = try await send(request("/api/v1/admin/billing/claims/\(id)/reject", method: "POST", body: payload))
    }

    func billingReportSummary(from: String? = nil, to: String? = nil) async throws -> BillingReportSummary {
        var params: [String] = []
        if let from { params.append("from=\(from)") }
        if let to { params.append("to=\(to)") }
        let path = "/api/v1/admin/billing/reports/summary" + (params.isEmpty ? "" : "?" + params.joined(separator: "&"))
        let data = try await send(request(path))
        return try decode(BillingReportSummary.self, data)
    }

    /// Cross-encounter Coding Coach — documentation-supported undercoding not
    /// yet captured, recurring flags, modifier misses, and coaching actions.
    /// window: mtd | qtd | ytd | l30d | l90d | l365d.
    func codingCoach(window: String = "ytd") async throws -> CodingCoach {
        let data = try await send(request("/api/v1/admin/billing/coding-coach?window=\(window)"))
        return try decode(CodingCoachResponse.self, data).coach
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
