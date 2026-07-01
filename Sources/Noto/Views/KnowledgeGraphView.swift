import Foundation
import SwiftUI
import NotoCore

struct KnowledgeGraphView: View {
    @Environment(AppState.self) private var appState
    @State private var previewedNodeId: String?

    var body: some View {
        @Bindable var appState = appState
        let graph = appState.store.visibleGraph

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Knowledge Web")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(NotoDesign.ink)
                    Text("Generated from Markdown wiki links and backlinks.")
                        .font(.system(size: 14))
                        .foregroundStyle(NotoDesign.muted)
                }

                Spacer()

                Picker("Graph Filter", selection: $appState.store.graphFilter) {
                    ForEach(GraphFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 500)
            }
            .padding(28)

            if graph.nodes.isEmpty {
                ContentUnavailableView(
                    "No graph nodes",
                    systemImage: "point.3.connected.trianglepath.dotted",
                    description: Text("The selected filter has no notes to show.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GeometryReader { proxy in
                    let layout = GraphLayout.layout(
                        graph: graph,
                        size: proxy.size,
                        activeFileId: appState.store.activeFileId
                    )

                    ZStack {
                        ForEach(graph.edges) { edge in
                            if let source = layout[edge.source], let target = layout[edge.target] {
                                Path { path in
                                    path.move(to: source)
                                    path.addLine(to: target)
                                }
                                .stroke(NotoDesign.accent.opacity(0.34), lineWidth: max(edge.weight, 1.2))
                            }
                        }

                        ForEach(graph.nodes) { node in
                            let point = layout[node.id] ?? .zero

                            Button {
                                appState.selectFile(id: node.id)
                            } label: {
                                GraphNodeCell(
                                    node: node,
                                    isActive: node.id == appState.store.activeFileId,
                                    size: nodeSize(node)
                                )
                            }
                            .buttonStyle(.plain)
                            .position(point)
                            .onHover { isHovering in
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    previewedNodeId = isHovering ? node.id : nil
                                }
                            }
                            .zIndex(previewedNodeId == node.id ? 2 : 1)
                        }

                        if let previewedNodeId,
                           let node = graph.nodes.first(where: { $0.id == previewedNodeId }),
                           let file = appState.store.vault.files.first(where: { $0.id == previewedNodeId }),
                           let point = layout[previewedNodeId] {
                            GraphNodePreviewPopup(node: node, file: file)
                                .position(GraphLayout.previewPosition(
                                    anchor: point,
                                    graphSize: proxy.size
                                ))
                                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                                .allowsHitTesting(false)
                                .zIndex(10)
                        }
                    }
                    .padding(20)
                }
            }
        }
        .background(NotoDesign.editor)
    }

    private func nodeSize(_ node: GraphNode) -> CGFloat {
        CGFloat(18 + min(node.degree, 8) * 4)
    }
}

private struct GraphNodeCell: View {
    let node: GraphNode
    let isActive: Bool
    let size: CGFloat

    var body: some View {
        VStack(spacing: 5) {
            Circle()
                .fill(isActive ? NotoDesign.accent : NotoDesign.card)
                .frame(width: size, height: size)
                .overlay {
                    Circle()
                        .stroke(NotoDesign.accent.opacity(0.62), lineWidth: 1)
                }
                .shadow(color: Color.black.opacity(0.24), radius: 8, x: 0, y: 4)

            Text(node.title)
                .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                .foregroundStyle(NotoDesign.ink)
                .lineLimit(1)
                .frame(width: 136)
        }
    }
}

private struct GraphNodePreviewPopup: View {
    let node: GraphNode
    let file: VaultFile

    private var summary: String {
        NotePreviewSummary.summarize(file.content)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(file.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NotoDesign.ink)
                    .lineLimit(1)

                Text(file.path)
                    .font(.system(size: 11))
                    .foregroundStyle(NotoDesign.muted)
                    .lineLimit(1)
            }

            Text(summary)
                .font(.system(size: 12))
                .foregroundStyle(NotoDesign.ink.opacity(0.88))
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                GraphPreviewMetric(
                    title: "Links",
                    value: node.outgoingCount
                )
                GraphPreviewMetric(
                    title: "Backlinks",
                    value: node.backlinksCount
                )
            }
        }
        .frame(width: GraphLayout.previewSize.width, alignment: .leading)
        .padding(14)
        .background(NotoDesign.glassBackground(cornerRadius: 12))
        .shadow(color: Color.black.opacity(0.32), radius: 18, x: 0, y: 12)
    }
}

private struct GraphPreviewMetric: View {
    let title: String
    let value: Int

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(NotoDesign.muted)
            Text("\(value)")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotoDesign.ink)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill(NotoDesign.accent.opacity(0.12))
        }
    }
}

enum GraphLayout {
    static let previewSize = CGSize(width: 280, height: 170)

    static func layout(graph: KnowledgeGraph, size: CGSize, activeFileId: String) -> [String: CGPoint] {
        guard !graph.nodes.isEmpty else {
            return [:]
        }

        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        if graph.nodes.count == 1 {
            return [graph.nodes[0].id: center]
        }

        let radius = max(120, min(size.width, size.height) * 0.34)
        let sorted = graph.nodes.sorted { left, right in
            if left.id == activeFileId { return true }
            if right.id == activeFileId { return false }
            return left.title < right.title
        }
        let activeIsVisible = sorted.contains { $0.id == activeFileId }
        let ringCount = activeIsVisible ? sorted.count - 1 : sorted.count

        var points: [String: CGPoint] = [:]
        var ringIndex = 0

        for node in sorted {
            if node.id == activeFileId {
                points[node.id] = center
                continue
            }

            let angle = (Double(ringIndex) / Double(max(ringCount, 1))) * Double.pi * 2 - Double.pi / 2
            let adjustedRadius = radius + CGFloat((node.degree % 3) * 18)
            points[node.id] = CGPoint(
                x: center.x + cos(angle) * adjustedRadius,
                y: center.y + sin(angle) * adjustedRadius
            )
            ringIndex += 1
        }

        return points
    }

    static func previewPosition(anchor: CGPoint, graphSize: CGSize) -> CGPoint {
        let horizontalOffset: CGFloat = 190
        let verticalOffset: CGFloat = -72
        let margin: CGFloat = 24
        let halfWidth = previewSize.width / 2
        let halfHeight = previewSize.height / 2
        let proposedX = anchor.x + horizontalOffset
        let proposedY = anchor.y + verticalOffset

        return CGPoint(
            x: min(max(proposedX, margin + halfWidth), graphSize.width - margin - halfWidth),
            y: min(max(proposedY, margin + halfHeight), graphSize.height - margin - halfHeight)
        )
    }
}
