package com.mapinboot.demo.identity.dto;

import java.util.List;

/**
 * 현재 인증 사용자 정보 응답 DTO
 */
public record MeResponse(String userId, List<String> roles, Boolean identityVerified) {
}

