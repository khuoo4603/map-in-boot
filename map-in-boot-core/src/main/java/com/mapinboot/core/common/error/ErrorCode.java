package com.mapinboot.core.common.error;

public enum ErrorCode {
    INVALID_CONFIG("MIB-001", "SDK 설정이 올바르지 않습니다."),
    DUPLICATE_ADAPTER("MIB-002", "동일한 ID의 Adapter가 중복 등록되었습니다."),
    ADAPTER_FAILED("MIB-003", "Adapter 실행 중 오류가 발생했습니다."),
    INVALID_STATE("MIB-004", "보안 상태 선언 또는 입력값이 올바르지 않습니다."),
    INVALID_GRAPH("MIB-005", "Graph의 Node·Edge 참조 또는 구조가 올바르지 않습니다."),
    INVALID_SNAPSHOT("MIB-006", "Snapshot 구조 또는 데이터가 올바르지 않습니다."),
    SNAPSHOT_READ_FAILED("MIB-007", "Snapshot을 읽는 데 실패했습니다."),
    SNAPSHOT_WRITE_FAILED("MIB-008", "Snapshot을 저장하는 데 실패했습니다."),
    UNSUPPORTED_SCHEMA("MIB-009", "지원하지 않는 Snapshot 스키마 버전입니다."),
    ACCESS_DENIED("MIB-010", "SDK 결과에 접근할 권한이 없습니다."),
    HASH_FAILED("MIB-011", "Stable ID 또는 Graph Fingerprint 생성에 실패했습니다.");

    private final String code;
    private final String description;

    ErrorCode(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }
}
