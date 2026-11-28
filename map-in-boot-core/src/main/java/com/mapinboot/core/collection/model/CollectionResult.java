package com.mapinboot.core.collection.model;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import java.util.List;

public record CollectionResult(
        String adapterId,
        List<Fact> facts,
        List<Evidence> evidence,
        AnalysisStatus status,
        List<AdapterDiagnostic> diagnostics
) {
    public CollectionResult {
        facts = List.copyOf(facts);
        evidence = List.copyOf(evidence);
        diagnostics = List.copyOf(diagnostics);
    }
}
