package com.mapinboot.core.graph.model;

import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import java.util.List;
import java.util.Map;

public record GraphEdge(
        String id,
        String sourceId,
        String targetId,
        EdgeType type,
        Map<String, String> attributes,
        Confidence confidence,
        List<String> evidenceIds
) {
    public GraphEdge {
        attributes = Map.copyOf(attributes);
        evidenceIds = List.copyOf(evidenceIds);
    }
}
