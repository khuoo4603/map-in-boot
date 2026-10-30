package com.mapinboot.core.graph.model;

import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import java.util.List;
import java.util.Map;

// 실제 GraphNode Stable ID 간의 분석 관계
public record GraphEdge(
        String id,
        String sourceId, // 존재하는 출발 GraphNode ID
        String targetId, // 존재하는 도착 GraphNode ID
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
