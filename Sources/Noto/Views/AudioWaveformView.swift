import SwiftUI

struct AudioWaveformView: View {
    let isAnimating: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            ForEach(0..<18, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(NotoDesign.accent.opacity(0.78))
                    .frame(width: 4, height: isAnimating ? CGFloat(12 + ((index * 7) % 30)) : 10)
                    .animation(
                        isAnimating
                            ? .easeInOut(duration: 0.48 + Double(index % 4) * 0.08).repeatForever(autoreverses: true)
                            : .default,
                        value: isAnimating
                    )
            }
        }
        .frame(height: 54)
    }
}
