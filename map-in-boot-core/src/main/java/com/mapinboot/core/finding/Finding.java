package com.mapinboot.core.finding;

import com.mapinboot.core.common.status.Confidence;
import java.util.List;

public record Finding(
        String id,
        String ruleId,
        String title,
        String description,
        Confidence confidence,
        List<String> nodeIds,
        List<String> edgeIds,
        List<String> evidenceIds,
        String guide
) {
    public Finding {
        nodeIds = List.copyOf(nodeIds);
        edgeIds = List.copyOf(edgeIds);
        evidenceIds = List.copyOf(evidenceIds);
    }
}
