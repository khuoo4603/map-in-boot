package com.mapinboot.starter.web.access;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.HandlerInterceptor;

// /mapinboot/** 전체 경로의 호스트 인증·역할 판정
public final class WebAccessInterceptor implements HandlerInterceptor {
    private final MapInBootProperties properties;

    public WebAccessInterceptor(MapInBootProperties properties) {
        this.properties = properties;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (!properties.isEnabled() || !properties.getWeb().isEnabled()) {
            response.sendError(HttpStatus.NOT_FOUND.value());
            return false;
        }
        HttpStatus denied = WebAccessGuard.deniedStatus(request, properties.getWeb().getRequiredRole());
        if (denied == null) {
            return true;
        }
        response.sendError(denied.value());
        return false;
    }
}
