package com.mapinboot.core.evidence;

import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import java.util.List;
import java.util.Map;

public record Relation(
        String id,
        String sourceKey,
        String targetKey,
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
