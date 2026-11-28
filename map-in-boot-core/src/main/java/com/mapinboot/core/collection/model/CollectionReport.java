package com.mapinboot.core.collection.model;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import java.util.List;
import java.util.Map;

// Collector 실행 결과의 Fact·Evidence·상태 집계
public record CollectionReport(
        List<Fact> facts,
        List<Evidence> evidence,
        Map<String, AnalysisStatus> statusByAdapter,
        List<AdapterDiagnostic> diagnostics
) {
    public CollectionReport {
        facts = List.copyOf(facts);
        evidence = List.copyOf(evidence);
        statusByAdapter = Map.copyOf(statusByAdapter);
        diagnostics = List.copyOf(diagnostics);
    }
}
