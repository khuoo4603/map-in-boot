package com.mapinboot.core.evidence;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;

// Evidence별 표시 영역·대상 분류
public record EvidenceClassification(
        String evidenceId,
        String areaCode,
        String targetCode
) {
    public EvidenceClassification {
        validateEvidenceId(evidenceId);
        validateCode(areaCode, "Evidence 영역 코드");
        validateTargetCode(targetCode);
    }

    // 분류 정보가 없는 Evidence의 일반 분류 생성
    public static EvidenceClassification general(String evidenceId) {
        return new EvidenceClassification(evidenceId, "EV", "GENERAL");
    }

    private static void validateEvidenceId(String evidenceId) {
        if (evidenceId == null || evidenceId.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Evidence ID가 올바르지 않습니다.");
        }
    }

    private static void validateCode(String code, String name) {
        if (code == null || !code.matches("[A-Z]{2}")) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, name + "가 올바르지 않습니다.");
        }
    }

    private static void validateTargetCode(String targetCode) {
        if (targetCode == null || !targetCode.matches("[A-Z][A-Z0-9_]*")) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Evidence 대상 코드가 올바르지 않습니다.");
        }
    }
}
