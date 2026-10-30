package com.mapinboot.core.graph.model;

import com.mapinboot.core.common.type.NodeType;
import java.util.List;
import java.util.Map;

public record GraphNode(
        String id,
        NodeType type,
        String serviceId,
        String label,
        Map<String, String> attributes,
        List<String> evidenceIds
) {
    public GraphNode {
        attributes = Map.copyOf(attributes);
        evidenceIds = List.copyOf(evidenceIds);
    }
}
