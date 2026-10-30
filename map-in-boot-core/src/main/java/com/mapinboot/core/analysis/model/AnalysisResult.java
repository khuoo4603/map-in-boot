package com.mapinboot.core.analysis.model;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Relation;
import java.util.List;

public record AnalysisResult(
        String adapterId,
        List<Relation> relations,
        List<Evidence> additionalEvidence,
        AnalysisStatus status,
        List<AdapterDiagnostic> diagnostics
) {
    public AnalysisResult {
        relations = List.copyOf(relations);
        additionalEvidence = List.copyOf(additionalEvidence);
        diagnostics = List.copyOf(diagnostics);
    }
}
