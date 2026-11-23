package com.mapinboot.demo.identity.dto;

import java.time.LocalDateTime;

/**
 * 본인확인 상태 응답 DTO
 */
public record IdentityStatusResponse(boolean identityVerified, LocalDateTime verifiedAt) {
}
