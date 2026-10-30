package com.mapinboot.core.evidence;

import java.util.List;
import java.util.Map;

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
