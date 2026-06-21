import Foundation

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
    var aiInPersonRequired: Bool
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
    var clinicianOverrideInPersonRequired: Bool?
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
    var slaBreached: Bool?
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
    var patientFirstName: String?
    var patientLastName: String?
    var visitType: String
    var startsAt: Int
    var durationMin: Int?
    var modality: String?
    var status: String
    var chiefComplaintSummary: String?

    var patientName: String {
        [patientFirstName, patientLastName].compactMap { $0 }.joined(separator: " ")
            .ifEmpty("Patient")
    }
    enum CodingKeys: String, CodingKey {
        case id, status, modality
        case patientFirstName = "patient_first_name"
        case patientLastName = "patient_last_name"
        case visitType = "visit_type"
        case startsAt = "starts_at"
        case durationMin = "duration_min"
        case chiefComplaintSummary = "chief_complaint_summary"
    }
}
struct AppointmentsResponse: Codable { let appointments: [Appointment] }

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
    var hasPassword: Bool?
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
        var reviewed: Bool?
        var booked: Bool?
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
    let ok: Bool?
    let clinicianId: String?
    let patientId: String?
    let since: String?
    let firstVisit: Bool?
    let counts: WhatsNewCounts?
    let events: [CaseEvent]?

    enum CodingKeys: String, CodingKey {
        case ok, since, counts, events
        case clinicianId = "clinician_id"
        case patientId = "patient_id"
        case firstVisit = "first_visit"
    }
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
