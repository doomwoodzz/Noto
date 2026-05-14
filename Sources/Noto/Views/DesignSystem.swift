import SwiftUI

enum NotoDesign {
    static let accent = Color(red: 0.22, green: 0.42, blue: 0.78)
    static let ink = Color(red: 0.12, green: 0.14, blue: 0.18)
    static let muted = Color(red: 0.42, green: 0.45, blue: 0.50)
    static let line = Color.black.opacity(0.08)
    static let panel = Color.white.opacity(0.72)
    static let editor = Color(red: 0.985, green: 0.986, blue: 0.992)
    static let recorderRed = Color(red: 0.82, green: 0.18, blue: 0.16)

    static func glassBackground(cornerRadius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.65), lineWidth: 1)
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
