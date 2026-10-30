package com.mapinboot.core.evidence;

import java.util.List;
import java.util.Map;

// 수집된 구조 사실 및 subjectKey 기반 구조 식별
public record Fact(
        String id,
        String type,
        String subjectKey,
        Map<String, String> attributes,
        List<String> evidenceIds
) {
    public Fact {
        attributes = Map.copyOf(attributes);
        evidenceIds = List.copyOf(evidenceIds);
    }
}
