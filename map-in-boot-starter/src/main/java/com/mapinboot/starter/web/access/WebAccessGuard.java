package com.mapinboot.starter.web.access;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;

// SDK WEB 요청의 호스트 인증·역할 판정
public final class WebAccessGuard {
    private WebAccessGuard() {
    }

    public static HttpStatus deniedStatus(HttpServletRequest request, String requiredRole) {
        try {
            if (request == null || request.getUserPrincipal() == null) {
                return HttpStatus.UNAUTHORIZED;
            }
            if (requiredRole == null || requiredRole.isBlank() || !request.isUserInRole(requiredRole)) {
                return HttpStatus.FORBIDDEN;
            }
        } catch (RuntimeException exception) {
            return HttpStatus.FORBIDDEN;
        }
        return null;
    }
}
