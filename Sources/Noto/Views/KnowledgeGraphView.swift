import Foundation
import SwiftUI
import NotoCore

struct KnowledgeGraphView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var appState = appState
        let graph = appState.store.visibleGraph

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Knowledge Web")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(NotoDesign.ink)
                    Text("Generated from Markdown wiki links and backlinks.")
                        .font(.system(size: 12))
                        .foregroundStyle(NotoDesign.muted)
                }

                Spacer()

                Picker("Graph Filter", selection: $appState.store.graphFilter) {
                    ForEach(GraphFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 430)
            }
            .padding(24)

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
                                .stroke(NotoDesign.accent.opacity(0.22), lineWidth: max(edge.weight, 1))
                            }
                        }

                        ForEach(graph.nodes) { node in
                            let point = layout[node.id] ?? .zero

                            Button {
                                appState.selectFile(id: node.id)
                            } label: {
                                VStack(spacing: 5) {
                                    Circle()
                                        .fill(node.id == appState.store.activeFileId ? NotoDesign.accent : Color.white)
                                        .frame(width: nodeSize(node), height: nodeSize(node))
                                        .overlay {
                                            Circle()
                                                .stroke(NotoDesign.accent.opacity(0.38), lineWidth: 1)
                                        }
                                        .shadow(color: Color.black.opacity(0.10), radius: 8, x: 0, y: 4)
                                    Text(node.title)
                                        .font(.system(
                                            size: 11,
                                            weight: node.id == appState.store.activeFileId ? .semibold : .regular
                                        ))
                                        .foregroundStyle(NotoDesign.ink)
                                        .lineLimit(1)
                                        .frame(width: 118)
                                }
                            }
                            .buttonStyle(.plain)
                            .position(point)
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

enum GraphLayout {
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
}
