import Foundation

// ---------- Lenient boolean decoding ----------
// D1/SQLite returns 0/1 for boolean columns; JSONDecoder won't coerce a number
// into Bool. These wrappers decode bool, 0/1 number, or "true"/"1" string.
@propertyWrapper struct LBool: Codable, Equatable, Hashable {
    var wrappedValue: Bool?
    init(wrappedValue: Bool?) { self.wrappedValue = wrappedValue }
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if c.decodeNil() { wrappedValue = nil }
        else if let b = try? c.decode(Bool.self) { wrappedValue = b }
        else if let i = try? c.decode(Int.self) { wrappedValue = i != 0 }
        else if let x = try? c.decode(Double.self) { wrappedValue = x != 0 }
        else if let s = try? c.decode(String.self) { wrappedValue = (s == "true" || s == "1") }
        else { wrappedValue = nil }
    }
    func encode(to e: Encoder) throws {
        var c = e.singleValueContainer()
        if let v = wrappedValue { try c.encode(v) } else { try c.encodeNil() }
    }
}
@propertyWrapper struct LBoolReq: Codable, Equatable, Hashable {
    var wrappedValue: Bool
    init(wrappedValue: Bool) { self.wrappedValue = wrappedValue }
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let b = try? c.decode(Bool.self) { wrappedValue = b }
        else if let i = try? c.decode(Int.self) { wrappedValue = i != 0 }
        else if let x = try? c.decode(Double.self) { wrappedValue = x != 0 }
        else if let s = try? c.decode(String.self) { wrappedValue = (s == "true" || s == "1") }
        else { wrappedValue = false }
    }
    func encode(to e: Encoder) throws { var c = e.singleValueContainer(); try c.encode(wrappedValue) }
}
extension KeyedDecodingContainer {
    func decode(_ t: LBool.Type, forKey k: Key) throws -> LBool {
        (try decodeIfPresent(t, forKey: k)) ?? LBool(wrappedValue: nil)
    }
    func decode(_ t: LBoolReq.Type, forKey k: Key) throws -> LBoolReq {
        (try decodeIfPresent(t, forKey: k)) ?? LBoolReq(wrappedValue: false)
    }
}


// =====================================================================
// Models for the admin clinical surfaces the app drives beyond posts:
// triage review, secure messaging, and scheduling. Field names mirror
// the JSON from functions/api/v1/admin/{triage,messages,appointments,
// visit-types} exactly (plain JSONDecoder, explicit CodingKeys).
// =====================================================================

// ---------- Visit types (shared catalog) ----------
struct VisitType: Identifiable, Codable, Hashable {
    let key: String
    let label: String
    let durationMin: Int
    var modalityPreferred: String?
    var id: String { key }
    enum CodingKeys: String, CodingKey {
        case key, label
        case durationMin = "duration_min"
        case modalityPreferred = "modality_preferred"
    }
}
struct VisitTypesResponse: Codable { let visitTypes: [VisitType]
    enum CodingKeys: String, CodingKey { case visitTypes = "visit_types" } }

// ---------- Triage ----------
struct TriageRow: Identifiable, Codable, Hashable {
    let id: String
    var patientName: String?
    var patientEmail: String?
    var ageYears: Int?
    var chiefComplaint: String?
    var aiVisitType: String
    var aiDurationMin: Int
    var aiUrgency: String
    @LBoolReq var aiInPersonRequired: Bool
    var aiPreferredTimeOfDay: String?
    var aiRationale: String?
    var clinicianReviewedAt: Int?
    var finalVisitType: String?
    var finalDurationMin: Int?
    var hoursPending: Double?
    // persisted overrides (schema 0024) — survive reload
    var clinicianOverrideVisitType: String?
    var clinicianOverrideDurationMin: Int?
    var clinicianOverrideUrgency: String?
    @LBool var clinicianOverrideInPersonRequired: Bool?
    var clinicianOverridePreferredTimeOfDay: String?
    var clinicianOverrideReason: String?

    var isReleased: Bool { (clinicianReviewedAt ?? 0) > 0 }

    enum CodingKeys: String, CodingKey {
        case id
        case patientName = "patient_name"
        case patientEmail = "patient_email"
        case ageYears = "age_years"
        case chiefComplaint = "chief_complaint"
        case aiVisitType = "ai_visit_type"
        case aiDurationMin = "ai_duration_min"
        case aiUrgency = "ai_urgency"
        case aiInPersonRequired = "ai_in_person_required"
        case aiPreferredTimeOfDay = "ai_preferred_time_of_day"
        case aiRationale = "ai_rationale"
        case clinicianReviewedAt = "clinician_reviewed_at"
        case finalVisitType = "final_visit_type"
        case finalDurationMin = "final_duration_min"
        case hoursPending = "hours_pending"
        case clinicianOverrideVisitType = "clinician_override_visit_type"
        case clinicianOverrideDurationMin = "clinician_override_duration_min"
        case clinicianOverrideUrgency = "clinician_override_urgency"
        case clinicianOverrideInPersonRequired = "clinician_override_in_person_required"
        case clinicianOverridePreferredTimeOfDay = "clinician_override_preferred_time_of_day"
        case clinicianOverrideReason = "clinician_override_reason"
    }
}
struct TriageListResponse: Codable { let pending: [TriageRow] }

// ---------- Messaging ----------
struct MessageThread: Identifiable, Codable, Hashable {
    let id: String
    var patientId: String?
    var patientFirstName: String?
    var patientLastName: String?
    var patientEmail: String?
    var subject: String
    var lastMessageAt: Int?
    var lastMessagePreview: String?
    var lastMessageFromRole: String?
    var unreadCount: Int?
    var urgency: String?
    var slaDueAt: Int?
    @LBool var slaBreached: Bool?
    var status: String?

    var patientName: String {
        [patientFirstName, patientLastName].compactMap { $0 }.joined(separator: " ")
            .ifEmpty(patientEmail ?? "(no name)")
    }
    enum CodingKeys: String, CodingKey {
        case id, subject, urgency, status
        case patientId = "patient_id"
        case patientFirstName = "patient_first_name"
        case patientLastName = "patient_last_name"
        case patientEmail = "patient_email"
        case lastMessageAt = "last_message_at"
        case lastMessagePreview = "last_message_preview"
        case lastMessageFromRole = "last_message_from_role"
        case unreadCount = "unread_count"
        case slaDueAt = "sla_due_at"
        case slaBreached = "sla_breached"
    }
}
struct ThreadsResponse: Codable { let threads: [MessageThread] }

struct ThreadMessage: Identifiable, Codable, Hashable {
    let id: String
    var fromRole: String
    var body: String
    var createdAt: Int?
    var readAt: Int?
    enum CodingKeys: String, CodingKey {
        case id, body
        case fromRole = "from_role"
        case createdAt = "created_at"
        case readAt = "read_at"
    }
}
struct ThreadDetailResponse: Codable { let thread: MessageThread; let messages: [ThreadMessage] }

// ---------- Scheduling ----------
struct Appointment: Identifiable, Codable, Hashable {
    let id: String
    var patientId: String?
    var patientFirstName: String?
    var patientLastName: String?
    var visitType: String
    var startsAt: Int
    var endsAt: Int?
    var durationMin: Int?
    var modality: String?
    var status: String
    var chiefComplaintSummary: String?
    var cancellationReason: String?
    var doxyRoomUrl: String?
    var doxyJoinLoggedAt: Int?
    var deviceCheck: AppointmentDeviceCheck?

    var patientName: String {
        [patientFirstName, patientLastName].compactMap { $0 }.joined(separator: " ")
            .ifEmpty("Patient")
    }
    enum CodingKeys: String, CodingKey {
        case id, status, modality
        case patientId = "patient_id"
        case patientFirstName = "patient_first_name"
        case patientLastName = "patient_last_name"
        case visitType = "visit_type"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case durationMin = "duration_min"
        case chiefComplaintSummary = "chief_complaint_summary"
        case cancellationReason = "cancellation_reason"
        case doxyRoomUrl = "doxy_room_url"
        case doxyJoinLoggedAt = "doxy_join_logged_at"
        case deviceCheck = "device_check"
    }
}

/// Telehealth pre-visit device check, from the appointment GET.
struct AppointmentDeviceCheck: Codable, Hashable {
    var status: String?            // "passed" | "failed"
    var checkedAt: Int?
    var networkKbps: Int?
    var failures: [String]?
    enum CodingKeys: String, CodingKey {
        case status, failures
        case checkedAt = "checked_at"
        case networkKbps = "network_kbps"
    }
}
struct AppointmentsResponse: Codable { let appointments: [Appointment] }
struct AppointmentDetailResponse: Codable { let appointment: Appointment? }

// ---------- Patients ----------
/// Row returned by GET /api/v1/admin/patients (list).
struct Patient: Identifiable, Codable, Hashable {
    let id: String
    var email: String
    var firstName: String?
    var lastName: String?
    var dob: String?
    var phone: String?
    var status: String?
    var createdAt: String?

    var displayName: String {
        [firstName, lastName].compactMap { $0 }.joined(separator: " ").ifEmpty(email)
    }
    enum CodingKeys: String, CodingKey {
        case id, email, dob, phone, status
        case firstName = "first_name"
        case lastName = "last_name"
        case createdAt = "created_at"
    }
}
struct PatientsListResponse: Codable {
    let q: String?
    let patients: [Patient]
}

/// Inner patient block from GET /api/v1/admin/patients/:id.
struct PatientFull: Codable, Hashable {
    let id: String
    var email: String
    var phone: String?
    var firstName: String?
    var lastName: String?
    var preferredName: String?
    var dob: String?
    var mrn: String?
    var pronouns: String?
    var preferredLanguage: String?
    var timezone: String?
    @LBool var hasPassword: Bool?
    var emailVerifiedAt: String?
    var status: String?
    var createdAt: String?
    var updatedAt: String?
    var ageYears: Int?
    var displayName: String?

    enum CodingKeys: String, CodingKey {
        case id, email, phone, dob, mrn, pronouns, timezone, status
        case firstName = "first_name"
        case lastName = "last_name"
        case preferredName = "preferred_name"
        case preferredLanguage = "preferred_language"
        case hasPassword = "has_password"
        case emailVerifiedAt = "email_verified_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case ageYears = "age_years"
        case displayName = "display_name"
    }
}

struct PatientSummary: Codable, Hashable {
    var intake: IntakeSummary?
    var triage: TriageSummary?
    var nextAppointment: AppointmentSummary?
    var lastAppointment: AppointmentSummary?
    var messages: MessageSummary?
    var symptoms: SymptomsSummary?
    var documents: DocumentsSummary?

    enum CodingKeys: String, CodingKey {
        case intake, triage, messages, symptoms, documents
        case nextAppointment = "next_appointment"
        case lastAppointment = "last_appointment"
    }

    struct IntakeSummary: Codable, Hashable {
        let id: String
        var status: String?
        var startedAt: String?
        var submittedAt: String?
        var completionPct: Double?
        enum CodingKeys: String, CodingKey {
            case id, status
            case startedAt = "started_at"
            case submittedAt = "submitted_at"
            case completionPct = "completion_pct"
        }
    }
    struct TriageSummary: Codable, Hashable {
        let id: String
        var visitType: String?
        var urgency: String?
        @LBool var reviewed: Bool?
        @LBool var booked: Bool?
        var createdAt: String?
        enum CodingKeys: String, CodingKey {
            case id, urgency, reviewed, booked
            case visitType = "visit_type"
            case createdAt = "created_at"
        }
    }
    struct AppointmentSummary: Codable, Hashable {
        let id: String
        var visitType: String?
        var startsAt: Int?
        var endsAt: Int?
        var modality: String?
        var status: String?
        var doxyRoomUrl: String?
        enum CodingKeys: String, CodingKey {
            case id, modality, status
            case visitType = "visit_type"
            case startsAt = "starts_at"
            case endsAt = "ends_at"
            case doxyRoomUrl = "doxy_room_url"
        }
    }
    struct MessageSummary: Codable, Hashable {
        var threadCount: Int?
        var unreadForClinician: Int?
        enum CodingKeys: String, CodingKey {
            case threadCount = "thread_count"
            case unreadForClinician = "unread_for_clinician"
        }
    }
    struct SymptomsSummary: Codable, Hashable {
        var entryCount: Int?
        var latestEntryDate: String?
        var earliestEntryDate: String?
        enum CodingKeys: String, CodingKey {
            case entryCount = "entry_count"
            case latestEntryDate = "latest_entry_date"
            case earliestEntryDate = "earliest_entry_date"
        }
    }
    struct DocumentsSummary: Codable, Hashable {
        var count: Int?
    }
}

struct PatientDetailResponse: Codable, Hashable {
    let patient: PatientFull
    let summary: PatientSummary?
}

// ---------- Cases — "what's new" event feed ----------
/// One row from `encounter_events`, materialized by listEventsForPatient
/// and surfaced via /api/v1/admin/cases/:id/whats-new.
struct CaseEvent: Identifiable, Codable, Hashable {
    let id: String
    var eventType: String
    var eventSummary: String?
    var severity: String?       // "urgent" | "warning" | "info"
    var refKind: String?
    var refId: String?
    var occurredAt: String?     // ISO8601

    enum CodingKeys: String, CodingKey {
        case id, severity
        case eventType = "event_type"
        case eventSummary = "event_summary"
        case refKind = "ref_kind"
        case refId = "ref_id"
        case occurredAt = "occurred_at"
    }
}

struct WhatsNewCounts: Codable, Hashable {
    var total: Int?
    var bySeverity: [String: Int]?
    enum CodingKeys: String, CodingKey {
        case total
        case bySeverity = "by_severity"
    }
}

struct WhatsNewResponse: Codable, Hashable {
    @LBool var ok: Bool?
    let clinicianId: String?
    let patientId: String?
    let since: String?
    @LBool var firstVisit: Bool?
    let counts: WhatsNewCounts?
    let events: [CaseEvent]?

    enum CodingKeys: String, CodingKey {
        case ok, since, counts, events
        case clinicianId = "clinician_id"
        case patientId = "patient_id"
        case firstVisit = "first_visit"
    }
}

// ---------- Trend Briefs ----------
/// Row returned by GET /api/v1/admin/trend-briefs/queue and
/// (per-id) /api/v1/admin/trend-briefs/<id>. Mirrors `rowToWire` in
/// functions/_lib/trend_briefs.js.
struct TrendBrief: Identifiable, Codable, Hashable {
    let id: String
    var slug: String?
    var briefDate: String?
    var claimText: String?
    var influencer: String?
    var topicsCovered: [String]?
    var pmidsCited: [String]?
    var auditPassCount: Int?
    var auditFailCount: Int?
    var status: String                // "pending" | "approved" | "rejected"
    var statusReason: String?
    @LBool var hasOverride: Bool?
    var submittedAt: Int?
    var approvedAt: Int?
    var rejectedAt: Int?
    var suggestionsText: String?

    var isPending: Bool { status == "pending" }
    var isApproved: Bool { status == "approved" }
    var isRejected: Bool { status == "rejected" }

    enum CodingKeys: String, CodingKey {
        case id, slug, influencer, status
        case briefDate = "brief_date"
        case claimText = "claim_text"
        case topicsCovered = "topics_covered"
        case pmidsCited = "pmids_cited"
        case auditPassCount = "audit_pass_count"
        case auditFailCount = "audit_fail_count"
        case statusReason = "status_reason"
        case hasOverride = "has_override"
        case submittedAt = "submitted_at"
        case approvedAt = "approved_at"
        case rejectedAt = "rejected_at"
        case suggestionsText = "suggestions_text"
    }
}

struct TrendBriefsQueueResponse: Codable {
    let briefs: [TrendBrief]
    let summary: [String: Int]?
    let count: Int?
}

struct TrendBriefDetailResponse: Codable {
    let brief: TrendBrief
    let events: [TrendBriefEvent]?
}

/// One row of a trend brief's audit timeline (submitted / resubmitted /
/// approved / rejected), from GET /trend-briefs/<id>.
struct TrendBriefEvent: Codable, Identifiable, Hashable {
    var id: String { "\(ts ?? 0)-\(eventKind ?? "")-\(actor ?? "")" }
    let ts: Int?
    let actor: String?
    let actorLabel: String?
    let eventKind: String?
    enum CodingKeys: String, CodingKey {
        case ts, actor
        case actorLabel = "actor_label"
        case eventKind = "event_kind"
    }
}

/// Approval override forwarded to render_brief_html. verdict/label/rationale are
/// required; the editorial fields are optional and only sent when the reviewer
/// edits them in-app (they overwrite the rendered brief's copy).
struct TrendBriefApproveBody: Codable {
    let verdict: String           // supported | partially supported | equipoise | mechanism-plausible / not supported | refuted
    let verdictLabel: String
    let rationale: String
    var title: String? = nil
    var summary: String? = nil
    var lede: String? = nil
    var bottomLine: String? = nil
    var reviewerNotes: String? = nil
    enum CodingKeys: String, CodingKey {
        case verdict, rationale, title, summary, lede
        case verdictLabel = "verdict_label"
        case bottomLine = "bottom_line"
        case reviewerNotes = "reviewer_notes"
    }
}

// ---------- Member feedback ----------
/// Beta-tester feedback row from GET /api/v1/admin/feedback.
/// Mirrors the JSON fields written by functions/api/v1/admin/feedback/index.js.
struct Feedback: Identifiable, Codable, Hashable {
    let id: String
    var patientId: String?
    var inviteLabel: String?
    var route: String?
    var feedbackType: String?       // "bug" | "idea" | "request"
    var severity: String?           // "urgent" | "high" | "medium" | "low"
    var commentText: String?
    var status: String              // new | ai_analyzed | approved | rejected | wont_fix | implemented
    var statusReason: String?
    var aiGeneratedAt: Int?
    var approvedAt: Int?
    var approvedBy: String?
    var implementedAt: Int?
    var implementedInCommit: String?
    var createdAt: Int?
    var updatedAt: Int?
    @LBool var hasScreenshot: Bool?
    var aiRecommendation: AIRecommendation?

    var isPending: Bool { status == "new" || status == "ai_analyzed" }
    var isApproved: Bool { status == "approved" }
    var isImplemented: Bool { status == "implemented" }
    var isDeclined: Bool { status == "rejected" || status == "wont_fix" }

    enum CodingKeys: String, CodingKey {
        case id, route, severity, status
        case patientId = "patient_id"
        case inviteLabel = "invite_label"
        case feedbackType = "feedback_type"
        case commentText = "comment_text"
        case statusReason = "status_reason"
        case aiGeneratedAt = "ai_generated_at"
        case approvedAt = "approved_at"
        case approvedBy = "approved_by"
        case implementedAt = "implemented_at"
        case implementedInCommit = "implemented_in_commit"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case hasScreenshot = "has_screenshot"
        case aiRecommendation = "ai_recommendation"
    }

    /// Claude-generated implementation recommendation embedded in the row.
    struct AIRecommendation: Codable, Hashable {
        var summary: String?
        var rootCause: String?
        var proposedChange: String?
        var filesToEdit: [String]?
        var severity: String?
        var effort: String?
        var rationale: String?
        var confidence: Double?
        var aiModel: String?
        var tags: [String]?
        var generatedAt: Int?

        enum CodingKeys: String, CodingKey {
            case summary, severity, effort, rationale, confidence, tags
            case rootCause = "root_cause"
            case proposedChange = "proposed_change"
            case filesToEdit = "files_to_edit"
            case aiModel = "ai_model"
            case generatedAt = "generated_at"
        }
    }
}

struct FeedbackListResponse: Codable {
    let feedback: [Feedback]
    let summary: [String: Int]?
}

struct FeedbackDetailResponse: Codable {
    let feedback: Feedback
}

// ---------- Carousels ----------
/// Summary row from GET /api/v1/admin/carousels (the `summarize()` shape).
struct Carousel: Identifiable, Codable, Hashable {
    let slug: String
    var title: String?
    var handleLine: String?
    var postTopic: String?
    var weekLabel: String?
    var status: String              // draft | approved | rejected | published
    var slideCount: Int?
    var coverPngUrl: String?
    @LBool var readyToPublish: Bool?
    var createdAt: Int?
    var approvedAt: Int?
    var rejectedAt: Int?

    var id: String { slug }
    var isDraft: Bool { status == "draft" }
    var isApproved: Bool { status == "approved" }
    var isRejected: Bool { status == "rejected" }
    var isPublished: Bool { status == "published" }

    enum CodingKeys: String, CodingKey {
        case slug, title, status
        case handleLine = "handle_line"
        case postTopic = "post_topic"
        case weekLabel = "week_label"
        case slideCount = "slide_count"
        case coverPngUrl = "cover_png_url"
        case readyToPublish = "ready_to_publish"
        case createdAt = "created_at"
        case approvedAt = "approved_at"
        case rejectedAt = "rejected_at"
    }
}
struct CarouselsListResponse: Codable { let carousels: [Carousel] }
struct CarouselDetailResponse: Codable { let carousel: Carousel }

// ---------- Analytics ----------
/// Wire shape from GET /api/v1/admin/analytics. Decodes the fields used by
/// the iOS dashboard view; ignores everything else (Codable is permissive
/// on missing keys for Optional values).
struct AdminAnalytics: Codable, Hashable {
    var totals: Totals?
    var intakeFunnel: IntakeFunnel?
    var triage: TriageBreakdown?
    var appointments: AppointmentsBreakdown?
    var messagingActivity: MessagingActivity?
    var symptomSignals: SymptomSignals?
    var auditSignals: AuditSignals?

    enum CodingKeys: String, CodingKey {
        case totals, triage, appointments
        case intakeFunnel = "intake_funnel"
        case messagingActivity = "messaging_activity"
        case symptomSignals = "symptom_signals"
        case auditSignals = "audit_signals"
    }

    struct Totals: Codable, Hashable {
        var patients: Int?
        var intakesInProgress: Int?
        var intakesSubmitted: Int?
        var appointmentsTotal: Int?
        var appointmentsUpcoming: Int?
        var appointmentsCompleted: Int?
        var messagesThreads: Int?
        var messagesUnreadForClinician: Int?
        var symptomEntriesWindow: Int?
        var documents: Int?
        var educationPublished: Int?
        var educationAssigned: Int?
        enum CodingKeys: String, CodingKey {
            case patients, documents
            case intakesInProgress = "intakes_in_progress"
            case intakesSubmitted = "intakes_submitted"
            case appointmentsTotal = "appointments_total"
            case appointmentsUpcoming = "appointments_upcoming"
            case appointmentsCompleted = "appointments_completed"
            case messagesThreads = "messages_threads"
            case messagesUnreadForClinician = "messages_unread_for_clinician"
            case symptomEntriesWindow = "symptom_entries_window"
            case educationPublished = "education_published"
            case educationAssigned = "education_assigned"
        }
    }

    struct IntakeFunnel: Codable, Hashable {
        var started: Int?
        var inProgress: Int?
        var submitted: Int?
        var reviewed: Int?
        enum CodingKeys: String, CodingKey {
            case started, submitted, reviewed
            case inProgress = "in_progress"
        }
    }

    struct CountedKey: Codable, Hashable, Identifiable {
        var visitType: String?
        var urgency: String?
        var status: String?
        var modality: String?
        var action: String?
        var count: Int
        var id: String { visitType ?? urgency ?? status ?? modality ?? action ?? UUID().uuidString }
        enum CodingKeys: String, CodingKey {
            case count, urgency, status, modality, action
            case visitType = "visit_type"
        }
    }

    struct TriageBreakdown: Codable, Hashable {
        var total: Int?
        var pending: Int?
        var released: Int?
        var booked: Int?
        var manualReviewRequired: Int?
        var byVisitType: [CountedKey]?
        var byUrgency: [CountedKey]?
        enum CodingKeys: String, CodingKey {
            case total, pending, released, booked
            case manualReviewRequired = "manual_review_required"
            case byVisitType = "by_visit_type"
            case byUrgency = "by_urgency"
        }
    }

    struct AppointmentsBreakdown: Codable, Hashable {
        var byStatus: [CountedKey]?
        var byVisitType: [CountedKey]?
        enum CodingKeys: String, CodingKey {
            case byStatus = "by_status"
            case byVisitType = "by_visit_type"
        }
    }

    struct MessagingActivity: Codable, Hashable {
        var messagesWindow: Int?
        var clinicianRepliesWindow: Int?
        var threadsWithUnread: Int?
        var oldestUnreadThreadMs: Int?
        enum CodingKeys: String, CodingKey {
            case messagesWindow = "messages_window"
            case clinicianRepliesWindow = "clinician_replies_window"
            case threadsWithUnread = "threads_with_unread"
            case oldestUnreadThreadMs = "oldest_unread_thread_ms"
        }
    }

    struct SymptomSignals: Codable, Hashable {
        var uniquePatientsLogging: Int?
        var recentPainAvg: Double?
        var recentPainHighCount: Int?
        var urgentPainPatients: [UrgentPainPatient]?
        enum CodingKeys: String, CodingKey {
            case uniquePatientsLogging = "unique_patients_logging_last_7d"
            case recentPainAvg = "recent_pain_avg"
            case recentPainHighCount = "recent_pain_high_count"
            case urgentPainPatients = "urgent_pain_patients"
        }
    }

    /// A patient flagged for high recent pelvic pain (≥8/10) in the last 7 days.
    struct UrgentPainPatient: Codable, Hashable, Identifiable {
        let id: String
        var name: String?
        var email: String?
        var painMax: Double?
        var latestDate: String?
        enum CodingKeys: String, CodingKey {
            case id, name, email
            case painMax = "pain_max"
            case latestDate = "latest_date"
        }
    }

    struct AuditSignals: Codable, Hashable {
        var eventsWindowTotal: Int?
        var byAction: [CountedKey]?
        enum CodingKeys: String, CodingKey {
            case eventsWindowTotal = "events_window_total"
            case byAction = "by_action"
        }
    }
}

// ---------- Compliance ----------
struct ComplianceDoc: Identifiable, Codable, Hashable {
    let slug: String
    var title: String
    var status: String                 // signed | unsigned | review_due_soon | review_overdue
    var signedAt: String?
    var signedBy: String?
    var nextReviewDate: String?
    var dueInDays: Int?
    var reviewIntervalMonths: Int?
    @LBool var counselReviewRecommended: Bool?
    var path: String?
    var id: String { slug }
    enum CodingKeys: String, CodingKey {
        case slug, title, status, path
        case signedAt = "signed_at"
        case signedBy = "signed_by"
        case nextReviewDate = "next_review_date"
        case dueInDays = "due_in_days"
        case reviewIntervalMonths = "review_interval_months"
        case counselReviewRecommended = "counsel_review_recommended"
    }
}
struct ComplianceDocsResponse: Codable { let docs: [ComplianceDoc] }

/// GET /api/v1/admin/compliance/docs/<slug> — doc body + active signature.
struct ComplianceDocDetail: Codable {
    let doc: DocMeta?
    let body: String?
    @LBool var bodyPresent: Bool?
    let activeSignature: ActiveSignature?

    struct DocMeta: Codable {
        let slug: String?; let title: String?; let path: String?; let publicUrl: String?
        var reviewIntervalMonths: Int?
        @LBool var counselReviewRecommended: Bool?
        enum CodingKeys: String, CodingKey {
            case slug, title, path
            case publicUrl = "public_url"
            case reviewIntervalMonths = "review_interval_months"
            case counselReviewRecommended = "counsel_review_recommended"
        }
    }
    struct ActiveSignature: Codable {
        let signedByDisplayName: String?; let signedAt: String?; let typedInitials: String?
        let documentSha256: String?; let nextReviewDate: String?
        enum CodingKeys: String, CodingKey {
            case signedByDisplayName = "signed_by_display_name"
            case signedAt = "signed_at"
            case typedInitials = "typed_initials"
            case documentSha256 = "document_sha256"
            case nextReviewDate = "next_review_date"
        }
    }
    enum CodingKeys: String, CodingKey {
        case doc, body
        case bodyPresent = "body_present"
        case activeSignature = "active_signature"
    }
}

// ---------- Briefings ----------
struct Briefing: Identifiable, Codable, Hashable {
    let id: String                     // typically patient_id-appointment_id
    var patientId: String?
    var patientName: String?
    var appointmentId: String?
    var visitType: String?
    var startsAt: Int?
    var modality: String?
    var summary: String?               // briefing text composed by the backend
    @LBool var hasNewSinceLastView: Bool?

    enum CodingKeys: String, CodingKey {
        case id, summary, modality
        case patientId = "patient_id"
        case patientName = "patient_name"
        case appointmentId = "appointment_id"
        case visitType = "visit_type"
        case startsAt = "starts_at"
        case hasNewSinceLastView = "has_new_since_last_view"
    }
}
struct BriefingsResponse: Codable {
    let briefings: [Briefing]
    let window: BriefingWindow?
}
struct BriefingWindow: Codable, Hashable {
    var startsAtMin: Int?
    var startsAtMax: Int?
    enum CodingKeys: String, CodingKey {
        case startsAtMin = "starts_at_min"
        case startsAtMax = "starts_at_max"
    }
}

// ---------- Education ----------
struct EducationMaterial: Identifiable, Codable, Hashable {
    let id: String
    var slug: String
    var title: String
    var summary: String?
    var topicTags: [String]?
    var targetAudience: String?
    var status: String                 // draft | published | archived
    var version: Int?
    var publishedAt: Int?
    var createdAt: Int?
    var updatedAt: Int?
    @LBool var hasInlineBody: Bool?
    @LBool var hasR2Body: Bool?
    var bodyMd: String?                // only present on the detail (GET /education/<slug>) response
    var r2Key: String?                 // set when the body lives in R2 rather than inline
    enum CodingKeys: String, CodingKey {
        case id, slug, title, summary, status, version
        case topicTags = "topic_tags"
        case targetAudience = "target_audience"
        case publishedAt = "published_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case hasInlineBody = "has_inline_body"
        case hasR2Body = "has_r2_body"
        case bodyMd = "body_md"
        case r2Key = "r2_key"
    }
}
struct EducationListResponse: Codable {
    let materials: [EducationMaterial]
    let count: Int?
}
struct EducationDetailResponse: Codable {
    let material: EducationMaterial
}

/// POST /api/v1/admin/ai/suggest-edit — Claude-proposed copy edit (title/summary).
struct EducationEditSuggestion: Codable, Equatable {
    let proposedTitle: String
    let proposedSummary: String
    let rationale: String
}
struct SuggestEditResponse: Codable {
    let proposal: EducationEditSuggestion
    let model: String?
}

// ---------- Debug session traces ----------
struct DebugSessionEvent: Identifiable, Codable, Hashable {
    let id: String
    var ts: Int?
    var inviteLabel: String?
    var patientId: String?
    var route: String?
    var outcome: String?               // ok | blocked | error
    var statusCode: Int?
    var hashedIp: String?
    var userAgent: String?
    var note: String?
    enum CodingKeys: String, CodingKey {
        case id, ts, route, outcome, note
        case inviteLabel = "invite_label"
        case patientId = "patient_id"
        case statusCode = "status_code"
        case hashedIp = "hashed_ip"
        case userAgent = "user_agent"
    }
}
struct DebugSessionsResponse: Codable {
    let events: [DebugSessionEvent]
    let summary: [String: DebugSessionLabelSummary]?
    let count: Int?
}
struct DebugSessionLabelSummary: Codable, Hashable {
    var count: Int?
    var errors: Int?
    var blocked: Int?
}

// ---------- Billing ----------
struct BillingClaim: Identifiable, Codable, Hashable {
    let id: String
    var patientId: String?
    var encounterId: String?
    var visitDate: String?
    var visitType: String?
    var emCode: String?
    var emMdmLevel: String?
    var emWrvu: Double?
    var emConfidence: Double?
    var totalChargeCents: Int?
    var expectedCollectionCents: Int?
    var complianceStatus: String?
    var status: String                 // pending_review | edited | ready_to_submit | submitted | paid | denied | …
    var statusReason: String?
    var payerName: String?
    var payerKind: String?
    var patientFirstName: String?
    var patientLastName: String?
    var unresolvedErrors: Int?
    var unresolvedWarnings: Int?
    var unacceptedUpcoding: Int?
    var unappliedHighDocsugg: Int?
    var createdAt: Int?

    var patientName: String {
        [patientFirstName, patientLastName].compactMap { $0 }.joined(separator: " ").ifEmpty("Patient")
    }
    var isPending: Bool { status == "pending_review" || status == "edited" }
    var isReady: Bool { status == "ready_to_submit" }
    var isPaid: Bool { status == "paid" || status == "partially_paid" }
    var isDenied: Bool { status == "denied" || status == "rejected" }

    enum CodingKeys: String, CodingKey {
        case id, status
        case patientId = "patient_id"
        case encounterId = "encounter_id"
        case visitDate = "visit_date"
        case visitType = "visit_type"
        case emCode = "em_code"
        case emMdmLevel = "em_mdm_level"
        case emWrvu = "em_wrvu"
        case emConfidence = "em_confidence"
        case totalChargeCents = "total_charge_cents"
        case expectedCollectionCents = "expected_collection_cents"
        case complianceStatus = "compliance_status"
        case statusReason = "status_reason"
        case payerName = "payer_name"
        case payerKind = "payer_kind"
        case patientFirstName = "patient_first_name"
        case patientLastName = "patient_last_name"
        case unresolvedErrors = "unresolved_errors"
        case unresolvedWarnings = "unresolved_warnings"
        case unacceptedUpcoding = "unaccepted_upcoding"
        case unappliedHighDocsugg = "unapplied_high_docsugg"
        case createdAt = "created_at"
    }
}
struct BillingClaimsResponse: Codable {
    let claims: [BillingClaim]
    let total: Int?
}

// MARK: - Billing claim drill-down (GET /billing/claims/:id)

struct BillingClaimDetail: Codable {
    let claim: BillingClaim
    var lines: [BillingClaimLine]?
    var diagnoses: [BillingClaimDiagnosis]?
    var flags: [BillingComplianceFlag]?
    var upcoding: [BillingUpcoding]?
    var docSuggestions: [BillingDocSuggestion]?
    enum CodingKeys: String, CodingKey {
        case claim, lines, diagnoses, flags, upcoding
        case docSuggestions = "doc_suggestions"
    }
}

struct BillingClaimLine: Codable, Hashable, Identifiable {
    let id: String
    var lineNumber: Int?
    var codeType: String?
    var code: String?
    var codeDescription: String?
    var modifier1: String?
    var modifier2: String?
    var modifierRationale: String?
    var units: Int?
    var placeOfService: String?
    var chargeCents: Int?
    var modifiers: [String] { [modifier1, modifier2].compactMap { $0 }.filter { !$0.isEmpty } }
    enum CodingKeys: String, CodingKey {
        case id, code, units
        case lineNumber = "line_number"
        case codeType = "code_type"
        case codeDescription = "code_description"
        case modifier1 = "modifier_1"
        case modifier2 = "modifier_2"
        case modifierRationale = "modifier_rationale"
        case placeOfService = "place_of_service"
        case chargeCents = "charge_cents"
    }
}

struct BillingClaimDiagnosis: Codable, Hashable, Identifiable {
    let id: String
    var diagnosisIndex: Int?
    var icd10Code: String?
    var icd10Description: String?
    var userOverrideCode: String?
    enum CodingKeys: String, CodingKey {
        case id
        case diagnosisIndex = "diagnosis_index"
        case icd10Code = "icd10_code"
        case icd10Description = "icd10_description"
        case userOverrideCode = "user_override_code"
    }
}

struct BillingComplianceFlag: Codable, Hashable, Identifiable {
    let id: String
    var severity: String?
    var flagKind: String?
    var title: String?
    var description: String?
    var referencedCode: String?
    var suggestedFix: String?
    var resolved: Int?
    var resolvedNote: String?
    var isResolved: Bool { (resolved ?? 0) != 0 }
    enum CodingKeys: String, CodingKey {
        case id, severity, title, description, resolved
        case flagKind = "flag_kind"
        case referencedCode = "referenced_code"
        case suggestedFix = "suggested_fix"
        case resolvedNote = "resolved_note"
    }
}

struct BillingUpcoding: Codable, Hashable, Identifiable {
    let id: String
    var currentCode: String?
    var potentialCode: String?
    var wrvuDelta: Double?
    var revenueDeltaCents: Int?
    var requiredDocumentation: String?
    var confidence: Double?
    var rationale: String?
    var accepted: Int?
    var isAccepted: Bool { (accepted ?? 0) != 0 }
    enum CodingKeys: String, CodingKey {
        case id, confidence, rationale, accepted
        case currentCode = "current_code"
        case potentialCode = "potential_code"
        case wrvuDelta = "wrvu_delta"
        case revenueDeltaCents = "revenue_delta_cents"
        case requiredDocumentation = "required_documentation"
    }
}

struct BillingDocSuggestion: Codable, Hashable, Identifiable {
    let id: String
    var priority: String?
    var section: String?
    var issue: String?
    var suggestion: String?
    var revisedText: String?
    var revenueImpact: String?
    enum CodingKeys: String, CodingKey {
        case id, priority, section, issue, suggestion
        case revisedText = "revised_text"
        case revenueImpact = "revenue_impact"
    }
}

struct BillingReportSummary: Codable, Hashable {
    var period: Period?
    var income: Income?
    var byService: [ServiceRow]?
    var byMonth: [MonthRow]?
    enum CodingKeys: String, CodingKey {
        case period, income
        case byService = "by_service"
        case byMonth = "by_month"
    }
    struct Period: Codable, Hashable {
        var from: String?
        var to: String?
        var days: Int?
    }
    struct Income: Codable, Hashable {
        var grossCents: Int?
        var refundsCents: Int?
        var netReceiptsCents: Int?
        var stripeFeesCents: Int?
        var bankDepositsCents: Int?
        var invoiceCount: Int?
        var paymentCount: Int?
        var refundCount: Int?
        enum CodingKeys: String, CodingKey {
            case grossCents = "gross_cents"
            case refundsCents = "refunds_cents"
            case netReceiptsCents = "net_receipts_cents"
            case stripeFeesCents = "stripe_fees_cents"
            case bankDepositsCents = "bank_deposits_cents"
            case invoiceCount = "invoice_count"
            case paymentCount = "payment_count"
            case refundCount = "refund_count"
        }
    }
    struct ServiceRow: Codable, Hashable, Identifiable {
        var serviceCode: String
        var displayName: String?
        var grossCents: Int?
        var paymentCount: Int?
        var id: String { serviceCode }
        enum CodingKeys: String, CodingKey {
            case serviceCode = "service_code"
            case displayName = "display_name"
            case grossCents = "gross_cents"
            case paymentCount = "payment_count"
        }
    }
    struct MonthRow: Codable, Hashable, Identifiable {
        var month: String
        var grossCents: Int?
        var feesCents: Int?
        var refundsCents: Int?
        var netCents: Int?
        var id: String { month }
        enum CodingKeys: String, CodingKey {
            case month
            case grossCents = "gross_cents"
            case feesCents = "fees_cents"
            case refundsCents = "refunds_cents"
            case netCents = "net_cents"
        }
    }
}

// ---------- Coding Coach (GET /api/v1/admin/billing/coding-coach) ----------
// Cross-encounter coaching view aggregating the AI coding analysis synced
// from MedicalTranscription: documentation-supported undercoding not yet
// captured, recurring compliance flags, modifier misses, and coaching actions.
struct CodingCoach: Codable {
    var window: Window?
    var summary: Summary?
    var undercoding: Undercoding?
    var recurringFlags: [RecurringFlag]?
    var modifierMisses: [ModifierMiss]?
    var coachingPoints: [CoachingPoint]?
    var trend: [TrendPoint]?
    var complianceNote: String?
    var generatedAt: String?

    enum CodingKeys: String, CodingKey {
        case window, summary, undercoding, trend
        case recurringFlags = "recurring_flags"
        case modifierMisses = "modifier_misses"
        case coachingPoints = "coaching_points"
        case complianceNote = "compliance_note"
        case generatedAt = "generated_at"
    }

    struct Window: Codable { var key: String?; var label: String? }

    struct Summary: Codable {
        var claimsAnalyzed: Int?
        var totalWrvu: Double?
        var avgMedicolegalScore: Int?
        var documentedUndercodingOpenUsd: Double?
        var openOpportunityCount: Int?
        var topRecurringFlag: String?
        enum CodingKeys: String, CodingKey {
            case claimsAnalyzed = "claims_analyzed"
            case totalWrvu = "total_wrvu"
            case avgMedicolegalScore = "avg_medicolegal_score"
            case documentedUndercodingOpenUsd = "documented_undercoding_open_usd"
            case openOpportunityCount = "open_opportunity_count"
            case topRecurringFlag = "top_recurring_flag"
        }
    }

    struct CoachingPoint: Codable, Identifiable {
        var priority: String?
        var theme: String?
        var title: String?
        var detail: String?
        var nextStep: String?
        var id: String { (theme ?? "") + "|" + (title ?? "") }
        enum CodingKeys: String, CodingKey {
            case priority, theme, title, detail
            case nextStep = "next_step"
        }
    }

    struct Undercoding: Codable {
        var documentedUndercodingOpenUsd: Double?
        var openOpportunityCount: Int?
        var openWrvu: Double?
        var topPairs: [Pair]?
        enum CodingKeys: String, CodingKey {
            case documentedUndercodingOpenUsd = "documented_undercoding_open_usd"
            case openOpportunityCount = "open_opportunity_count"
            case openWrvu = "open_wrvu"
            case topPairs = "top_pairs"
        }
        struct Pair: Codable, Identifiable {
            var fromCode: String?
            var toCode: String?
            var openCount: Int?
            var openRevenueDeltaUsd: Double?
            var wrvuDelta: Double?
            var id: String { (fromCode ?? "") + "→" + (toCode ?? "") }
            enum CodingKeys: String, CodingKey {
                case fromCode = "from_code"
                case toCode = "to_code"
                case openCount = "open_count"
                case openRevenueDeltaUsd = "open_revenue_delta_usd"
                case wrvuDelta = "wrvu_delta"
            }
        }
    }

    struct RecurringFlag: Codable, Identifiable {
        var kind: String?
        var severity: String?
        var count: Int?
        var claimsAffected: Int?
        var id: String { (kind ?? "flag") + "|" + String(count ?? 0) }
        enum CodingKeys: String, CodingKey {
            case kind, severity, count
            case claimsAffected = "claims_affected"
        }
    }

    struct ModifierMiss: Codable, Identifiable {
        var referencedCode: String?
        var count: Int?
        var exampleFix: String?
        var id: String { (referencedCode ?? "mod") + "|" + String(count ?? 0) }
        enum CodingKeys: String, CodingKey {
            case referencedCode = "referenced_code"
            case count
            case exampleFix = "example_fix"
        }
    }

    struct TrendPoint: Codable, Identifiable {
        var month: String?
        var claims: Int?
        var openUndercodingUsd: Double?
        var id: String { month ?? "" }
        enum CodingKeys: String, CodingKey {
            case month, claims
            case openUndercodingUsd = "open_undercoding_usd"
        }
    }
}
struct CodingCoachResponse: Codable {
    let coach: CodingCoach
    @LBool var cached: Bool?
}

/// Format cents → "$1,234.56".
func fmtCents(_ cents: Int?) -> String {
    guard let cents else { return "—" }
    let dollars = Double(cents) / 100.0
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "USD"
    return f.string(from: NSNumber(value: dollars)) ?? "$\(dollars)"
}

// ---------- small helpers ----------
extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// Visit-type key → human label fallback when the catalog isn't loaded.
func prettyVisitKey(_ key: String) -> String {
    key.replacingOccurrences(of: "_", with: " ").capitalized
}

/// Format a millisecond epoch as a short local date-time.
func fmtEpoch(_ ms: Int?, dateStyle: DateFormatter.Style = .medium,
              timeStyle: DateFormatter.Style = .short) -> String {
    guard let ms else { return "—" }
    let f = DateFormatter()
    f.dateStyle = dateStyle; f.timeStyle = timeStyle
    return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
}
