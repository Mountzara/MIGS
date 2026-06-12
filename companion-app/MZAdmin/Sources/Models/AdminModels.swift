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
