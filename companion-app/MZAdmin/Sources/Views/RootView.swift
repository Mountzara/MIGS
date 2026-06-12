import SwiftUI

struct RootView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        ZStack {
            Theme.base.ignoresSafeArea()
            if auth.isAuthenticated {
                PostListView(auth: auth)
            } else {
                LoginView()
            }
        }
    }
}

#Preview {
    RootView().environmentObject(AuthStore())
}
