package com.mapinboot.demo.identity.dto;

/**
 * 로그인 응답 DTO
 */
public record LoginResponse(String accessToken, long expiresIn, UserSummary user) {
}

