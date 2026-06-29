import SwiftUI
#if os(iOS)
import UIKit
import UserNotifications
import os
#endif

/// Mount Zara — Admin Mission Control.
/// One SwiftUI codebase → iPhone, iPad, and Mac. Talks to the existing
/// mountzara.com admin API (HTTP Basic auth) to review/approve/reject drafts.
@main
struct MZAdminApp: App {
    @StateObject private var auth = AuthStore()
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    #endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .preferredColorScheme(.dark)
                .tint(Theme.accentSoft)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        #endif
    }
}

#if os(iOS)
/// Bridges UIKit notification callbacks into PushNotifications.shared.
/// SwiftUI app lifecycle exposes these via UIApplicationDelegateAdaptor.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private let log = Logger(subsystem: "com.mountzara.mzadmin", category: "appdelegate")

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        log.info("did finish launching; UN delegate wired")
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        log.info("APNs device token granted (len=\(token.count))")
        Task { @MainActor in await PushNotifications.shared.handleDeviceToken(token) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        log.error("APNs registration failed: \(error.localizedDescription)")
    }

    // Show notifications while the app is foregrounded.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
                                -> UNNotificationPresentationOptions {
        return [.banner, .sound, .badge]
    }

    // Tap handling — route the {type, id} payload to the matching tab.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        log.info("notification tapped: \(info as NSDictionary)")
        await NotificationRouter.shared.handle(type: info["type"] as? String,
                                               id: info["id"] as? String)
    }
}
#endif
