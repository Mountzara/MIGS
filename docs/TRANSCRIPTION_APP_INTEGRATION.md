# MountZara Transcription App ↔ Website Integration

Companion to `docs/PATIENT_SNAPSHOT_PIPELINE.md`. The website side of the
Phase 9 sync loop is fully built. The Transcription app side needs the
glue described here — a new `WebsiteSyncService` Swift class plus a
small number of integration points in existing services. This document
specifies that work so a future session on the
`MountZaraMedicalTranscription` codebase can complete it without
re-discovering the surface.

---

## 1. Where this lives in the Transcription app

Add a new Swift package module:

```
Sources/MedicalTranscriptionKit/Services/Sync/
├── WebsiteSyncService.swift          (NEW)
├── WebsiteSyncModels.swift           (NEW — Codable DTOs for wire format)
└── WebsiteSyncKeychain.swift         (NEW — Keychain reader for the bearer token)
```

Touch existing files only where indicated below.

---

## 2. WebsiteSyncService.swift

A service class that owns three operations: poll for dirty patients,
fetch a patient's full context, push a freshly generated snapshot.

```swift
import Foundation
import os

public actor WebsiteSyncService {
    private let baseURL: URL
    private let session: URLSession
    private let bearerToken: String
    private let logger = Logger(subsystem: "com.mountzara.transcription", category: "WebsiteSync")

    public init?(baseURL: URL = URL(string: "https://mountzara.com")!) {
        guard let token = WebsiteSyncKeychain.readToken() else {
            return nil
        }
        self.baseURL = baseURL
        self.bearerToken = token
        var cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.waitsForConnectivity = true
        self.session = URLSession(configuration: cfg)
    }

    // MARK: - Connection 1: dirty patient list

    /// Returns the delta of patients whose context changed since `since`.
    /// Records of (cursor, since) should be persisted by the caller — typically
    /// in UserDefaults at `com.mountzara.transcription.lastSync.transcription`.
    public func listDirtyPatients(since: Date, limit: Int = 100, cursor: Int = 0)
        async throws -> WSPatientListResponse
    {
        var components = URLComponents(url: baseURL.appendingPathComponent("/api/v1/sync/transcription/patients"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "since", value: String(Int(since.timeIntervalSince1970 * 1000))),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "cursor", value: String(cursor)),
        ]
        let req = bearerRequest(url: components.url!, method: "GET")
        return try await decode(req, as: WSPatientListResponse.self)
    }

    // MARK: - Connection 2: full patient context

    /// Pull the full patient context (intake, symptom diary, prior encounters,
    /// active triage, current snapshot, recent claims). Updates server-side
    /// patient_sync_state.last_pulled_at and clears the dirty flag.
    public func fetchPatientContext(patientId: String) async throws -> WSPatientContextResponse {
        let url = baseURL.appendingPathComponent("/api/v1/sync/transcription/patients/\(patientId)/context")
        let req = bearerRequest(url: url, method: "GET")
        return try await decode(req, as: WSPatientContextResponse.self)
    }

    // MARK: - Connection 3: push snapshot

    /// Send a freshly generated PatientProgressSummary to the website.
    /// On success, returns the server-assigned snapshot_id + version_number.
    public func pushSnapshot(_ payload: WSSnapshotPushRequest) async throws -> WSSnapshotPushResponse {
        let url = baseURL.appendingPathComponent("/api/v1/sync/transcription/snapshot")
        var req = bearerRequest(url: url, method: "POST")
        req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        req.httpBody = try encoder.encode(payload)
        return try await decode(req, as: WSSnapshotPushResponse.self)
    }

    // MARK: - Internals

    private func bearerRequest(url: URL, method: String) -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.addValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        req.addValue("MountZaraTranscription/1.0", forHTTPHeaderField: "User-Agent")
        return req
    }

    private func decode<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw WSError.transport("non-http response")
        }
        if !(200...299).contains(http.statusCode) {
            let bodyText = String(data: data, encoding: .utf8) ?? "<unreadable>"
            logger.error("WebsiteSync \(req.httpMethod ?? "?") \(req.url?.path ?? "?") → \(http.statusCode): \(bodyText, privacy: .public)")
            throw WSError.http(status: http.statusCode, body: bodyText)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            logger.error("WebsiteSync decode failed: \(String(describing: error), privacy: .public)")
            throw WSError.decode(error.localizedDescription)
        }
    }
}

public enum WSError: Error {
    case transport(String)
    case http(status: Int, body: String)
    case decode(String)
}
```

---

## 3. WebsiteSyncModels.swift

Codable DTOs that mirror the wire format documented in
`docs/PATIENT_SNAPSHOT_PIPELINE.md` §4 and the endpoint header comments.

```swift
import Foundation

// MARK: - Patient list (Connection 1)

public struct WSPatientListResponse: Decodable {
    public let ok: Bool
    public let patients: [WSPatientListRow]
    public let next_cursor: String?
    public let server_time: Int64
    public let since: Int64
}

public struct WSPatientListRow: Decodable {
    public let patient_id: String
    public let first_name: String?
    public let last_name: String?
    public let date_of_birth: String?
    public let updated_at: Int64
    public let dirty_reason: String?
    public let dirty_since: Int64?
    public let last_intake_submitted_at: Int64?
    public let app_last_pulled_at: Int64?
}

// MARK: - Patient context (Connection 2)

public struct WSPatientContextResponse: Decodable {
    public let ok: Bool
    public let context: WSPatientContext
}

public struct WSPatientContext: Decodable {
    public let patient: WSPatient
    public let intake: WSIntake?
    public let symptom_diary_recent_90d: [WSSymptomEntry]
    public let active_triage: WSActiveTriage?
    public let prior_encounters: [WSPriorEncounter]
    public let current_snapshot: WSCurrentSnapshot?
    public let recent_claims: [WSRecentClaim]
}

public struct WSPatient: Decodable {
    public let id: String
    public let first_name: String?
    public let last_name: String?
    public let email: String?
    public let phone: String?
    public let date_of_birth: String?
    public let sex: String?
    public let gender_identity: String?
    public let pronouns: String?
}

public struct WSIntake: Decodable {
    public let intake_id: String?
    public let head: WSIntakeHead?
    public let sections: [WSIntakeSection]
}

public struct WSIntakeHead: Decodable {
    public let id: String
    public let status: String
    public let started_at: Int64?
    public let submitted_at: Int64?
    public let completion_pct: Double?
}

public struct WSIntakeSection: Decodable {
    public let section_number: Int
    public let section_key: String
    public let data: WSAnyJSON?
    public let updated_at: Int64?
}

public struct WSSymptomEntry: Decodable {
    public let entry_date: String
    public let symptoms: WSAnyJSON?
    public let notes: String?
}

public struct WSActiveTriage: Decodable {
    public let id: String
    public let visit_type: String?
    public let urgency: String?
    public let estimated_duration_min: Int?
    public let preferred_time_of_day: String?
    public let rationale: String?
    public let secondary_concerns: [String]?
    public let released_at: Int64?
    public let clinician_override: String?
}

public struct WSPriorEncounter: Decodable {
    public let id: String
    public let visit_date: String?
    public let visit_type_actual: String?
    public let chief_complaint: String?
    public let transcription_session_id: String?
    public let note_source: String?
}

public struct WSCurrentSnapshot: Decodable {
    public let id: String
    public let version_number: Int
    public let source_app: String
    public let generated_at: Int64
    public let encounter_count: Int
    public let dominant_category: String?
    public let ai_model: String?
}

public struct WSRecentClaim: Decodable {
    public let id: String
    public let visit_date: String?
    public let em_code: String?
    public let em_mdm_level: String?
    public let total_wrvu: Double?
    public let compliance_status: String?
    public let medico_legal_score: Int?
    public let status: String?
}

// MARK: - Snapshot push (Connection 3)

public struct WSSnapshotPushRequest: Encodable {
    public let patient_id: String
    public let source_app_snapshot_id: String?    // ← pass the local SnapshotVersion UUID
    public let generated_at: Date                  // ISO-8601 on the wire
    public let encounter_count: Int
    public let encounter_ids: [String]?
    public let dominant_category: String?

    public let clinical_overview: String?
    public let chief_complaint: String?
    public let cc_history: String?
    public let narrative_patient_story: String?

    public let patient_goals: [String]?
    public let surgical_history: [String]?
    public let ai_recommendations: [String]?

    public let problem_list: [WSProblem]?
    public let diagnostic_trends: [WSDiagnosticTrend]?
    public let imaging_measurements: [WSImagingMeasurement]?
    public let timeline_events: [WSTimelineEvent]?
    public let action_items: [WSActionItem]?

    public let change_notes: String?
    public let ai_meta: WSAIMeta?
}

public struct WSProblem: Encodable {
    public let problem: String
    public let status: String
    public let last_visit_plan: String?
}

public struct WSDiagnosticTrend: Encodable {
    public let category: String
    public let test_name: String
    public let trend_summary: String?
    public let entries: [WSDiagnosticEntry]
}

public struct WSDiagnosticEntry: Encodable {
    public let date: String
    public let value: String
    public let interpretation: String?
}

public struct WSImagingMeasurement: Encodable {
    public let organ_name: String
    public let dimension: String
    public let measurement_date: String?
    public let impression: String?
    public let prior_dimension: String?
}

public struct WSTimelineEvent: Encodable {
    public let event_date: String?
    public let event_type: String?
    public let event_title: String
    public let event_detail: String?
    public let icd10_codes: [String]?
}

public struct WSActionItem: Encodable {
    public let description: String
    public let priority: String?
    public let due_date: String?
    public let rationale: String?
}

public struct WSAIMeta: Encodable {
    public let model: String?
    public let prompt_version: String?
}

public struct WSSnapshotPushResponse: Decodable {
    public let ok: Bool
    public let snapshot_id: String
    public let version_number: Int
    public let prior_current_archived: Bool
    public let children: WSSnapshotChildren?
}

public struct WSSnapshotChildren: Decodable {
    public let problems: Int
    public let diagnostic_trends: Int
    public let imaging: Int
    public let timeline: Int
    public let action_items: Int
}

/// Type-erased JSON for fields that vary between intake sections and
/// symptom-diary payloads. Decodes anything that JSONDecoder can decode.
public enum WSAnyJSON: Decodable {
    case object([String: WSAnyJSON])
    case array([WSAnyJSON])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Double.self) { self = .number(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([String: WSAnyJSON].self) { self = .object(v); return }
        if let v = try? c.decode([WSAnyJSON].self) { self = .array(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }
}
```

---

## 4. WebsiteSyncKeychain.swift

```swift
import Foundation
import Security

enum WebsiteSyncKeychain {
    // Mirrors the Keychain entry the user creates with:
    //   security add-generic-password \
    //       -s "mountzara-transcription-sync-token" \
    //       -a "$USER" -w "<the-bearer-token>" -U
    private static let service = "mountzara-transcription-sync-token"

    static func readToken() -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
        ]
        if let user = ProcessInfo.processInfo.environment["USER"] {
            query[kSecAttrAccount as String] = user
        }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data,
              let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        else { return nil }
        return token.isEmpty ? nil : token
    }
}
```

---

## 5. Integration points in existing services

### A. PatientIntelligenceService.swift

After `generateProgressSummary(...)` returns and the local
`SnapshotHistoryStore` archives the new version, fire-and-forget push
to the website:

```swift
// inside PatientIntelligenceService, after the local save:
Task.detached(priority: .utility) {
    do {
        guard let sync = await WebsiteSyncService() else {
            logger.info("WebsiteSyncService unavailable — token missing or app offline. Skipping push.")
            return
        }
        let payload = WSSnapshotMapper.from(summary: result,
                                            sourceAppSnapshotId: latestVersion.id.uuidString)
        let resp = try await sync.pushSnapshot(payload)
        logger.info("Snapshot pushed: id=\(resp.snapshot_id) v=\(resp.version_number)")
    } catch {
        logger.error("Snapshot push failed: \(String(describing: error))")
    }
}
```

A `WSSnapshotMapper` helper translates the in-app
`PatientProgressSummary` (camelCase, Date, structured types) into the
wire format `WSSnapshotPushRequest` (snake_case fields, ISO dates,
string-only arrays). Add it next to the models file.

### B. PatientRecordService.swift (or wherever you provision local patients)

On app launch, and on a 5-minute timer thereafter:

```swift
Task.detached(priority: .utility) {
    guard let sync = await WebsiteSyncService() else { return }
    let lastSync = UserDefaults.standard.object(forKey: "mz.lastWebsiteSync") as? Date ?? .distantPast
    do {
        let list = try await sync.listDirtyPatients(since: lastSync)
        for row in list.patients {
            let ctx = try await sync.fetchPatientContext(patientId: row.patient_id)
            await PatientRecordService.shared.upsertFromWebsite(ctx)
        }
        UserDefaults.standard.set(Date(timeIntervalSince1970: Double(list.server_time) / 1000),
                                  forKey: "mz.lastWebsiteSync")
    } catch {
        os.Logger(subsystem: "com.mountzara.transcription", category: "WebsiteSync")
            .error("dirty-patient pull failed: \(String(describing: error))")
    }
}
```

`upsertFromWebsite(_ ctx: WSPatientContextResponse)` is a new method on
`PatientRecordService` that:

1. Creates or updates a local `Patient` from `ctx.context.patient`.
2. Walks `ctx.context.intake.sections` and turns each into the
   appropriate `EncounterContext.gynChecklist` / `obChecklist` /
   `freeTextContext` so a new encounter starts pre-populated.
3. Builds a `PatientContext` with allergies, medications, family
   history, ERAS flags (GLP-1 last-dose, anticoag, anemia, BMI, etc.)
   extracted from intake section #12.
4. Pre-loads `relevantHistory` with everything material from intake
   sections #15 (family GYN history), #11 (GI/GU), #4 (chief complaint).
5. Pre-loads `currentMedications` and `allergies` from intake sections
   #13 and #14.
6. Caches the symptom diary as a "Recent symptoms" annotation on the
   active encounter context.

### C. WSSnapshotMapper.swift (helper)

```swift
import Foundation

enum WSSnapshotMapper {
    static func from(summary: PatientProgressSummary,
                     sourceAppSnapshotId: String) -> WSSnapshotPushRequest
    {
        WSSnapshotPushRequest(
            patient_id: summary.patientId,
            source_app_snapshot_id: sourceAppSnapshotId,
            generated_at: summary.generatedDate,
            encounter_count: summary.encounterCount,
            encounter_ids: summary.encounterIds.map { $0.uuidString },
            dominant_category: summary.dominantCategory,
            clinical_overview: summary.clinicalOverview,
            chief_complaint: summary.chiefComplaint,
            cc_history: summary.ccHistory,
            narrative_patient_story: summary.narrativePatientStory,
            patient_goals: summary.patientGoals,
            surgical_history: summary.surgicalHistory,
            ai_recommendations: summary.aiRecommendations,
            problem_list: summary.problemList.map { p in
                WSProblem(problem: p.problem, status: p.status, last_visit_plan: p.lastVisitPlan)
            },
            diagnostic_trends: summary.diagnosticTrends.map { t in
                WSDiagnosticTrend(
                    category: t.category, test_name: t.testName,
                    trend_summary: t.trendSummary,
                    entries: t.entries.map { e in
                        WSDiagnosticEntry(date: e.date, value: e.value, interpretation: e.interpretation)
                    })
            },
            imaging_measurements: summary.imagingMeasurements.map { m in
                WSImagingMeasurement(
                    organ_name: m.organName, dimension: m.dimension,
                    measurement_date: m.date, impression: m.impression,
                    prior_dimension: m.priorDimension)
            },
            timeline_events: summary.treatmentTimeline.map { ev in
                WSTimelineEvent(
                    event_date: ev.date, event_type: ev.type,
                    event_title: ev.title, event_detail: ev.detail,
                    icd10_codes: ev.icd10Codes)
            },
            action_items: summary.actionItemDescriptions.map { a in
                WSActionItem(description: a.description, priority: a.priority,
                             due_date: a.dueDate, rationale: a.rationale)
            },
            change_notes: nil,
            ai_meta: WSAIMeta(model: nil, prompt_version: nil)
        )
    }
}
```

(Adjust property names — the audit on the app side found the exact
field names; mirror them here without guessing.)

---

## 6. Auth token setup

Before any of this works, the user must store the
`TRANSCRIPTION_SYNC_TOKEN` in macOS Keychain:

```
# Get the current token value (already a Cloudflare Pages secret on the
# website side):
security find-generic-password -s "mountzara-transcription-sync-token" -w 2>/dev/null

# Or generate + rotate:
TOKEN=$(openssl rand -base64 32)
# Save on the Mac:
security add-generic-password \
    -s "mountzara-transcription-sync-token" \
    -a "$USER" -w "$TOKEN" -U
# Save on the website:
cd ~/Developer/MountZara/MIGS && \
    echo "$TOKEN" | npx wrangler@latest pages secret put TRANSCRIPTION_SYNC_TOKEN --project-name=mountzara
```

---

## 7. Smoke tests once the app side is wired

1. Build + run the app. Confirm the launch-time dirty-patient pull
   doesn't crash, and a fresh-install with no `lastWebsiteSync` returns
   the full patient list once.
2. Submit a new intake on the website with a brand-new test patient
   (`new-test-YYYYMMDD@example.test`). Within 5 minutes, the app should
   surface that patient locally with the intake-derived context.
3. Generate a SOAP note in the app for that patient. The app already
   triggers `PatientIntelligenceService.generateProgressSummary` after N
   encounters — confirm a `WSSnapshotPushRequest` fires and gets a 201.
4. Open `/admin/cases/<patient_id>/snapshot/` on the website. The full
   PatientProgressSummary should render in the EMR dashboard.
5. Edit the patient's intake / log a symptom on the website. Within 5
   minutes the app's next pull should surface that patient again with
   the dirty flag, so the next snapshot generation incorporates the new
   data.

---

## 8. What's NOT in scope for this Swift-side work

- Snapshot regeneration triggered remotely from the website (Round E
  in the snapshot-pipeline doc) — not needed for V1.
- Real-time WebSocket push from website → app (Round F) — polling at
  5-min intervals is sufficient for the typical solo-practice workflow.
- iOS app integration — the iOS app has its own sync flow, separate
  Bearer token. Mirror this pattern in a future round.
