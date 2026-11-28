package com.mapinboot.core.common.type;

public enum NodeType {
    APPLICATION("Spring Boot 애플리케이션"),
    SERVLET("등록된 Servlet 및 웹 진입 구조"),
    ENDPOINT("HTTP API Endpoint"),
    HANDLER("Controller 또는 Handler Method"),
    SECURITY_CHAIN("SecurityFilterChain 및 요청 매칭 조건"),
    FILTER("Servlet 또는 Security Filter"),
    AUTHENTICATION("인증 처리 구조와 AuthenticationProvider"),
    AUTHORIZATION("URL·Method·객체 수준 인가 정책 및 판단"),
    SECURITY_DATA("JWT·Session·Header·Principal·Authority 등 인증정보"),
    BUSINESS_SECURITY_STATE("업무상 보안 상태");

    private final String description;

    NodeType(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
