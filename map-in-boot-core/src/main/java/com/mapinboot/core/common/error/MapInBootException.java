package com.mapinboot.core.common.error;

import java.util.Objects;

// Core 공통 SDK 실행 예외
public class MapInBootException extends RuntimeException {
    private final ErrorCode errorCode;

    public MapInBootException(ErrorCode errorCode) {
        super(Objects.requireNonNull(errorCode).getDescription());
        this.errorCode = errorCode;
    }

    public MapInBootException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = Objects.requireNonNull(errorCode);
    }

    public MapInBootException(ErrorCode errorCode, String message, Throwable cause) {
        super(message, cause);
        this.errorCode = Objects.requireNonNull(errorCode);
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}
