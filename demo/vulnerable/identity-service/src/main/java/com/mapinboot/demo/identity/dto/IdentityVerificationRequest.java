package com.mapinboot.demo.identity.dto;

/**
 * 본인확인 요청 DTO
 */
public record IdentityVerificationRequest(String method, String verificationCode) {
}
