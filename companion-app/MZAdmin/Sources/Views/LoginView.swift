import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var email = "chris.mabini@gmail.com"
    @State private var password = ""
    @State private var verifying = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "lock.shield")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Theme.accentSoft)
            Text("Mount Zara")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(.white)
            Text("Admin Mission Control")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                TextField("Admin email", text: $email)
                    .textContentType(.username)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                    .disableAutocorrection(true)
                    .padding(12).glassCard()

                SecureField("Admin password", text: $password)
                    .textContentType(.password)
                    .padding(12).glassCard()
                    #if os(iOS)
                    .onSubmit(signIn)
                    #endif

                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.red)
                }

                Button(action: signIn) {
                    HStack {
                        if verifying { ProgressView().controlSize(.small) }
                        Text(verifying ? "Verifying…" : "Sign in")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.white)
                }
                .disabled(password.isEmpty || verifying)
            }
            .frame(maxWidth: 360)

            Spacer()
            Text("Uses the same login as the web admin. Stored securely in your Keychain.")
                .font(.caption2).foregroundStyle(.tertiary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
        .padding()
    }

    private func signIn() {
        guard !password.isEmpty else { return }
        verifying = true; error = nil
        Task {
            let api = AdminAPI(token: Data("\(email):\(password)".utf8).base64EncodedString())
            if let err = await api.verifyDescribingError() {
                error = err.errorDescription ?? "Sign-in failed."
            } else {
                auth.signIn(email: email, password: password)
            }
            verifying = false
        }
    }
}
