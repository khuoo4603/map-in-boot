package com.mapinboot.core.common.error;

public record AdapterDiagnostic(
        String adapterId,
        ErrorCode errorCode,
        String summary
) {
}
