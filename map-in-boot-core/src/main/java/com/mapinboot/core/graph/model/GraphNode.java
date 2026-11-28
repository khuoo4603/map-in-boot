package com.mapinboot.core.graph.model;

import com.mapinboot.core.common.type.NodeType;
import java.util.List;
import java.util.Map;

// Stable ID와 Evidence를 보존하는 Graph 구성 요소
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
