package com.mapinboot.core.evidence;

import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import java.util.List;
import java.util.Map;

// 구조 키 간 분석 관계 및 GraphEdge 변환 입력
public record Relation(
        String id,
        String sourceKey, // Stable Node ID 변환 전 출발 구조 키
        String targetKey, // Stable Node ID 변환 전 도착 구조 키
        EdgeType type,
        Map<String, String> attributes,
        Confidence confidence,
        List<String> evidenceIds
) {
    public Relation {
        attributes = Map.copyOf(attributes);
        evidenceIds = List.copyOf(evidenceIds);
    }
}
