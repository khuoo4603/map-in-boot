package com.mapinboot.core.finding;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import java.util.List;

// Finding 결과와 평가 진단의 함께 전달
public record FindingEvaluation(
        List<Finding> findings,
        List<AdapterDiagnostic> diagnostics
) {
    public FindingEvaluation {
        findings = List.copyOf(findings);
        diagnostics = List.copyOf(diagnostics);
    }
}
