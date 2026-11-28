package com.mapinboot.core.common.type;

public enum EdgeType {
    FLOWS_TO("등록된 요청 진입·Handler 연결 구조"),
    MATCHED_BY("확인된 Matcher·SecurityFilterChain 적용 관계"),
    FILTERED_BY("Servlet 또는 Security Filter 등록·구성 관계"),
    SECURED_BY("인증 또는 인가 구성에 의한 보호 관계"),
    READS_SECURITY_DATA("JWT·Session·Header·Principal 등 인증정보 조회"),
    WRITES_SECURITY_DATA("JWT Claim 등 인증정보 생성·작성"),
    CONVERTS_TO_AUTHORITY("인증정보에서 Authority로의 변환"),
    USES_FOR_AUTHORIZATION("인증정보를 실제 인가 판단에 사용"),
    SECURITY_STATE("업무 보안 상태의 생성·요구 관계");

    private final String description;

    EdgeType(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
