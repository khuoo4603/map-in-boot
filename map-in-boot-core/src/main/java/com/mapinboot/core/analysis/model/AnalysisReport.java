package com.mapinboot.core.analysis.model;

import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Relation;
import java.util.List;
import java.util.Map;

// CollectionReport 기반 분석 관계·근거·상태 집계
public record AnalysisReport(
        CollectionReport collectionReport,
        List<Relation> relations,
        List<Evidence> evidence,
        Map<String, AnalysisStatus> statusByAdapter,
        List<AdapterDiagnostic> diagnostics
) {
    public AnalysisReport {
        relations = List.copyOf(relations);
        evidence = List.copyOf(evidence);
        statusByAdapter = Map.copyOf(statusByAdapter);
        diagnostics = List.copyOf(diagnostics);
    }
}
