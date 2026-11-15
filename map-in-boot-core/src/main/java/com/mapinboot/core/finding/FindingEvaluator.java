package com.mapinboot.core.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import java.util.List;

// Finding 평가 확장 계약
public interface FindingEvaluator {
    List<Finding> evaluate(AnalysisReport report);

    // 기존 List 결과와 평가 진단의 하위 호환 확장
    default FindingEvaluation evaluateWithDiagnostics(AnalysisReport report) {
        return new FindingEvaluation(evaluate(report), List.of());
    }
}
