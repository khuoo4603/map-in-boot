package com.mapinboot.demo.identity.dto;

import java.time.LocalDateTime;

/**
 * 본인확인 성공 및 새 JWT 응답 DTO
 */
public record IdentityVerificationResponse(
        String accessToken,
        long expiresIn,
        boolean identityVerified,
        LocalDateTime verifiedAt) {
}
