package com.mapinboot.core.graph.model;

import java.util.List;

public record SecurityGraph(
        List<GraphNode> nodes,
        List<GraphEdge> edges
) {
    public SecurityGraph {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
    }
}
