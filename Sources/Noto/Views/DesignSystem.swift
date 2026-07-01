import SwiftUI

enum NotoDesign {
    static let accent = Color(red: 0.34, green: 0.56, blue: 0.98)
    static let ink = Color(red: 0.92, green: 0.94, blue: 0.98)
    static let muted = Color(red: 0.56, green: 0.60, blue: 0.68)
    static let line = Color.white.opacity(0.08)
    static let background = Color(red: 0.045, green: 0.050, blue: 0.060)
    static let sidebar = Color(red: 0.070, green: 0.075, blue: 0.088)
    static let panel = Color(red: 0.095, green: 0.102, blue: 0.118)
    static let card = Color(red: 0.135, green: 0.145, blue: 0.165)
    static let field = Color(red: 0.165, green: 0.175, blue: 0.195)
    static let editor = Color(red: 0.060, green: 0.066, blue: 0.078)
    static let recorderRed = Color(red: 0.96, green: 0.28, blue: 0.25)

    static func glassBackground(cornerRadius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(panel.opacity(0.94))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(line, lineWidth: 1)
            }
    }
}

struct SectionLabel: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(NotoDesign.muted)
            .tracking(0.8)
    }
}
