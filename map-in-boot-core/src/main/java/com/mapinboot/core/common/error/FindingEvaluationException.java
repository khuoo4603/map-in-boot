package com.mapinboot.core.common.error;

import java.util.List;

// Finding Rule 평가 실패와 안전한 진단 보존
public final class FindingEvaluationException extends MapInBootException {
    private final List<AdapterDiagnostic> diagnostics;

    public FindingEvaluationException(List<AdapterDiagnostic> diagnostics) {
        super(ErrorCode.ADAPTER_FAILED, "Finding Rule 평가에 실패했습니다.");
        this.diagnostics = List.copyOf(diagnostics);
    }

    public List<AdapterDiagnostic> diagnostics() {
        return diagnostics;
    }
}
