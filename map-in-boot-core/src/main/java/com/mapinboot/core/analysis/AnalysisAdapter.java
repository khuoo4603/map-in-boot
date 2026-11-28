package com.mapinboot.core.analysis;

import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import java.util.Set;

// 분석 Adapter 확장 계약
public interface AnalysisAdapter {
    String id();

    String getDescription();

    Set<String> getSupportedTypes();

    default boolean enabled() {
        return true;
    }

    default Set<String> requiredFactTypes() {
        return Set.of();
    }

    AnalysisResult analyze(AnalysisContext context);
}
