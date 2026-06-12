import SwiftUI

/// Mount Zara admin palette — mirrors the web admin (#07070a base, purple accent,
/// frosted-glass surfaces) so the native app feels like the same product.
enum Theme {
    static let base    = Color(red: 0.027, green: 0.027, blue: 0.039)   // #07070a
    static let surface = Color.white.opacity(0.045)
    static let border  = Color.white.opacity(0.10)
    static let accent  = Color(red: 0.427, green: 0.157, blue: 0.851)   // #6d28d9
    static let accentSoft = Color(red: 0.655, green: 0.545, blue: 0.980)
    static let green   = Color(red: 0.063, green: 0.725, blue: 0.506)
    static let amber   = Color(red: 0.961, green: 0.620, blue: 0.043)
    static let red     = Color(red: 0.937, green: 0.267, blue: 0.267)

    static func statusColor(_ k: StatusKind) -> Color {
        switch k {
        case .draft: return amber
        case .published: return green
        case .rejected: return red
        }
    }
}

/// A frosted-glass card surface — the same "real glass" treatment used on the site.
struct GlassCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 1)
            )
    }
}

extension View {
    func glassCard() -> some View { modifier(GlassCard()) }
}
