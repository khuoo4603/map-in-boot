package com.mapinboot.starter.web.access;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.autoconfigure.WebAuthMode;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.HandlerInterceptor;

// /mapinboot/** 전체 경로의 호스트 인증·역할 판정
public final class WebAccessInterceptor implements HandlerInterceptor {
    private final MapInBootProperties properties;
    private final Environment environment;

    public WebAccessInterceptor(MapInBootProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (!properties.isEnabled() || !properties.getWeb().isEnabled()) {
            response.sendError(HttpStatus.NOT_FOUND.value());
            return false;
        }
        if (properties.getWeb().getAuthMode() == WebAuthMode.PASSWORD
                || WebAccessGuard.isDevelopmentRequest(request)) {
            response.setHeader("Cache-Control", "no-store");
        }
        HttpStatus denied = WebAccessGuard.deniedStatus(request, properties, environment);
        if (denied == null) {
            return true;
        }
        response.sendError(denied.value());
        return false;
    }
}
