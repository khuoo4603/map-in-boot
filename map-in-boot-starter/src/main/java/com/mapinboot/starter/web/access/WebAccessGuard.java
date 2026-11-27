package com.mapinboot.starter.web.access;

import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

// SDK WEB 요청의 호스트 인증·역할 판정
public final class WebAccessGuard {
    private static final List<String> PUBLIC_UI_PATHS = List.of(
            "/mapinboot",
            "/mapinboot/",
            "/mapinboot/index.html",
            "/mapinboot/app.css",
            "/mapinboot/app.js",
            "/mapinboot/spotlight.js",
            "/mapinboot/graph-flow.js",
            "/mapinboot/request-flow-animation.js",
            "/mapinboot/graph-standard-filters.js",
            "/mapinboot/graph-inspector.js",
            "/mapinboot/graph-navigation.js",
            "/mapinboot/graph-renderer.js",
            "/mapinboot/layout-client.js",
            "/mapinboot/vendor/elk-api.js",
            "/mapinboot/vendor/elk-worker.min.js",
            "/mapinboot/assets/mapinboot_logo_transparent.png");
    private static final List<String> PREVIEW_API_PATHS = List.of(
            "/mapinboot/api/status",
            "/mapinboot/api/snapshot");

    private WebAccessGuard() {
    }

    // Spring Security와 MVC가 공유하는 공개 SDK 경로 목록
    public static String[] publicUiPaths() {
        return PUBLIC_UI_PATHS.toArray(String[]::new);
    }

    // Spring Security와 MVC가 공유하는 익명 Preview 조회 경로 목록
    public static String[] previewApiPaths() {
        return PREVIEW_API_PATHS.toArray(String[]::new);
    }

    public static boolean isPublicUiRequest(HttpServletRequest request) {
        return isGet(request) && PUBLIC_UI_PATHS.contains(applicationPath(request));
    }

    public static boolean isAnonymousPreviewEnabled(
            MapInBootProperties properties, Environment environment) {
        return properties != null
                && properties.isEnabled()
                && properties.getWeb() != null
                && properties.getWeb().isEnabled()
                && properties.getWeb().isAnonymousPreview()
                && environment != null
                && environment.acceptsProfiles(Profiles.of("develop"));
    }

    public static boolean isAnonymousPreviewRequest(HttpServletRequest request) {
        return isGet(request) && PREVIEW_API_PATHS.contains(applicationPath(request));
    }

    public static HttpStatus deniedStatus(
            HttpServletRequest request, MapInBootProperties properties, Environment environment) {
        if (isPublicUiRequest(request)
                || (isAnonymousPreviewEnabled(properties, environment) && isAnonymousPreviewRequest(request))) {
            return null;
        }
        String requiredRole = properties == null || properties.getWeb() == null
                ? null : properties.getWeb().getRequiredRole();
        return deniedStatus(request, requiredRole);
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

    private static boolean isGet(HttpServletRequest request) {
        return request != null && "GET".equalsIgnoreCase(request.getMethod());
    }

    private static String applicationPath(HttpServletRequest request) {
        if (request == null || request.getRequestURI() == null) {
            return "";
        }
        String contextPath = request.getContextPath();
        return contextPath == null || contextPath.isEmpty() || !request.getRequestURI().startsWith(contextPath)
                ? request.getRequestURI()
                : request.getRequestURI().substring(contextPath.length());
    }
}
