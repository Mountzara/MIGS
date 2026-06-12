import Foundation
import Security

/// Stores the admin Basic-auth credentials securely in the system Keychain
/// (shared across app launches; never written to UserDefaults or disk in clear).
/// The web admin uses HTTP Basic auth (email:password) against /api/posts/_admin,
/// and this app reuses the exact same scheme so one credential works everywhere.
@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var email: String?
    @Published private(set) var isAuthenticated: Bool = false

    private let service = "com.mountzara.admin"
    private let account = "admin-basic"

    init() {
        if let creds = load() {
            self.email = creds.email
            self.isAuthenticated = true
        }
    }

    struct Credentials { let email: String; let password: String }

    /// Base64 "email:password" for the Authorization: Basic header.
    var basicToken: String? {
        guard let c = load() else { return nil }
        return Data("\(c.email):\(c.password)".utf8).base64EncodedString()
    }

    func signIn(email: String, password: String) {
        save(email: email, password: password)
        self.email = email
        self.isAuthenticated = true
    }

    func signOut() {
        delete()
        self.email = nil
        self.isAuthenticated = false
    }

    // MARK: - Keychain

    private func save(email: String, password: String) {
        delete()
        let payload = Data("\(email)\u{0000}\(password)".utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: payload,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private func load() -> Credentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let str = String(data: data, encoding: .utf8) else { return nil }
        let parts = str.components(separatedBy: "\u{0000}")
        guard parts.count == 2 else { return nil }
        return Credentials(email: parts[0], password: parts[1])
    }

    private func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
