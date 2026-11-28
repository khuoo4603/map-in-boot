package com.mapinboot.demo.identity.model;

import java.time.LocalDateTime;

/**
 * 데모 본인확인 및 OTP 인증 상태 도메인 모델
 */
public class DemoIdentityState {

    private final String userId;
    private final boolean identityVerified;
    private final boolean otpVerified;
    private final LocalDateTime verifiedAt;

    public DemoIdentityState(String userId, boolean identityVerified, boolean otpVerified, LocalDateTime verifiedAt) {
        this.userId = userId;
        this.identityVerified = identityVerified;
        this.otpVerified = otpVerified;
        this.verifiedAt = verifiedAt;
    }

    public String getUserId() {
        return userId;
    }

    public boolean isIdentityVerified() {
        return identityVerified;
    }

    public boolean isOtpVerified() {
        return otpVerified;
    }

    public LocalDateTime getVerifiedAt() {
        return verifiedAt;
    }
}

