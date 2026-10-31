package com.mapinboot.core.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import java.util.List;

// Finding 평가 확장 계약
public interface FindingEvaluator {
    List<Finding> evaluate(AnalysisReport report);
}
