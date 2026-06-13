import Foundation
import os

#if os(iOS)
import UIKit
import UserNotifications

/// iOS-only APNs lifecycle manager.
/// Flow: bind(authStore:) when the user signs in → requestAndRegister()
/// asks the OS for permission and registers for remote notifications →
/// AppDelegate hands back the device token via handleDeviceToken(_:) →
/// the token is POSTed to `/api/v1/admin/notifications/register` with the
/// same Basic-auth token the rest of the app uses.
///
/// Notification payloads are PHI-minimal: `{type, id}` only. The tap handler
/// fetches the full record through the authenticated API.
@MainActor
final class PushNotifications {
    static let shared = PushNotifications()
    private let log = Logger(subsystem: "com.mountzara.admin", category: "push")

    private var basicToken: String?
    private var pendingDeviceToken: String?
    private var lastRegisteredToken: String?

    private init() {}

    /// Capture the current auth token so the registration POST can authenticate.
    func bind(authStore: AuthStore) {
        self.basicToken = authStore.basicToken
        log.info("bound to authStore (token \(self.basicToken == nil ? "absent" : "present"))")
        // If we already have a device token waiting for auth, flush it now.
        Task { await flushTokenToBackend() }
    }

    /// Ask the OS for notification permission, then register for remote
    /// notifications. Called after sign-in succeeds.
    func requestAndRegister() async {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            log.info("permission granted=\(granted)")
            if granted {
                await UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
            log.error("permission request failed: \(error.localizedDescription)")
        }
    }

    /// Called from AppDelegate when APNs gives us the device token.
    func handleDeviceToken(_ token: String) async {
        log.info("device token received (prefix=\(token.prefix(8)), len=\(token.count))")
        pendingDeviceToken = token
        await flushTokenToBackend()
    }

    /// POST the device token to the backend. Idempotent — backend dedups on token.
    private func flushTokenToBackend() async {
        guard let token = pendingDeviceToken else {
            log.debug("flush: no pending token")
            return
        }
        guard let basicToken else {
            log.debug("flush: no auth yet — token held for later")
            return
        }
        if token == lastRegisteredToken {
            log.debug("flush: token already registered, skipping")
            pendingDeviceToken = nil
            return
        }

        var req = URLRequest(url: URL(string: "https://mountzara.com/api/v1/admin/notifications/register")!)
        req.httpMethod = "POST"
        req.setValue("Basic \(basicToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["token": token, "platform": "ios"]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        req.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            if (200...299).contains(code) {
                log.info("backend registered token (HTTP \(code))")
                lastRegisteredToken = token
                pendingDeviceToken = nil
            } else {
                log.error("backend rejected token (HTTP \(code))")
            }
        } catch {
            log.error("token registration network error: \(error.localizedDescription)")
        }
    }
}
#endif
