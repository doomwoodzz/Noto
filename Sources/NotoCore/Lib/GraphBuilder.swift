public enum GraphBuilder {
    public static func build(files: [VaultFile], cache: MetadataCache) -> KnowledgeGraph {
        let nodes = files.map { file in
            let metadata = cache.filesById[file.id]
            return GraphNode(
                id: file.id,
                title: file.title,
                path: file.path,
                backlinksCount: metadata?.backlinks.count ?? 0,
                outgoingCount: metadata?.outgoingLinks.count ?? 0
            )
        }

        var edges: [GraphEdge] = []
        for file in files {
            guard let metadata = cache.filesById[file.id] else {
                continue
            }

            for targetTitle in metadata.outgoingLinks {
                guard let targetId = cache.fileIdByTitle[targetTitle] else {
                    continue
                }

                edges.append(
                    GraphEdge(
                        id: "\(file.id)->\(targetId)",
                        source: file.id,
                        target: targetId,
                        weight: 1
                    )
                )
            }
        }

        return KnowledgeGraph(nodes: nodes, edges: edges)
    }

    public static func filter(graph: KnowledgeGraph, mode: GraphFilter, activeFileId: String) -> KnowledgeGraph {
        switch mode {
        case .all:
            return graph
        case .local:
            return subgraph(graph, keeping: localNodeIds(in: graph, activeFileId: activeFileId))
        case .lectureOnly:
            let ids = Set(graph.nodes.filter { $0.path.hasPrefix("AI Lecture Notes/") }.map(\.id))
            return subgraph(graph, keeping: ids)
        case .orphans:
            let connected = Set(graph.edges.flatMap { [$0.source, $0.target] })
            let ids = Set(graph.nodes.filter { !connected.contains($0.id) }.map(\.id))
            return subgraph(graph, keeping: ids)
        }
    }

    private static func localNodeIds(in graph: KnowledgeGraph, activeFileId: String) -> Set<String> {
        var ids: Set<String> = [activeFileId]

        for edge in graph.edges {
            if edge.source == activeFileId {
                ids.insert(edge.target)
            }

            if edge.target == activeFileId {
                ids.insert(edge.source)
            }
        }

        return ids
    }

    private static func subgraph(_ graph: KnowledgeGraph, keeping ids: Set<String>) -> KnowledgeGraph {
        KnowledgeGraph(
            nodes: graph.nodes.filter { ids.contains($0.id) },
            edges: graph.edges.filter { ids.contains($0.source) && ids.contains($0.target) }
        )
    }
}
