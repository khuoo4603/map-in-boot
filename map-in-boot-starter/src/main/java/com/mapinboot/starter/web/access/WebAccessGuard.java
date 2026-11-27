package com.mapinboot.starter.web.access;

import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.autoconfigure.WebAuthMode;
import com.mapinboot.starter.web.auth.SdkLoginService;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.web.util.ServletRequestPathUtils;
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
    private static final List<String> AUTH_STATUS_PATHS = List.of("/mapinboot/api/auth/status");
    private static final List<String> AUTH_POST_PATHS = List.of(
            "/mapinboot/api/auth/login",
            "/mapinboot/api/auth/logout");

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

    // 호스트 SecurityFilterChain 연동용 인증 상태 GET 경로
    public static String[] authStatusPaths() {
        return AUTH_STATUS_PATHS.toArray(String[]::new);
    }

    // 호스트 SecurityFilterChain 연동용 인증 POST 경로
    public static String[] authPostPaths() {
        return AUTH_POST_PATHS.toArray(String[]::new);
    }

    public static boolean isPublicUiRequest(HttpServletRequest request) {
        return isGet(request) && PUBLIC_UI_PATHS.contains(applicationPath(request));
    }

    static String mappedApplicationPath(HttpServletRequest request) {
        if (request == null || !ServletRequestPathUtils.hasParsedRequestPath(request)) {
            return applicationPath(request);
        }
        RequestPath requestPath = ServletRequestPathUtils.getParsedRequestPath(request);
        StringBuilder path = new StringBuilder();
        for (PathContainer.Element element : requestPath.pathWithinApplication().elements()) {
            if (element instanceof PathContainer.Separator separator) {
                path.append(separator.value());
            } else if (element instanceof PathContainer.PathSegment segment) {
                path.append(segment.valueToMatch());
            }
        }
        return path.toString();
    }

    static boolean isDevelopmentRequest(HttpServletRequest request) {
        return isDevelopmentPath(mappedApplicationPath(request));
    }

    public static boolean isAnonymousPreviewEnabled(
            MapInBootProperties properties, Environment environment) {
        return properties != null
                && properties.isEnabled()
                && properties.getWeb() != null
                && properties.getWeb().isEnabled()
                && !properties.getWeb().isAuthModeConfigured()
                && properties.getWeb().isAnonymousPreview()
                && environment != null
                && environment.acceptsProfiles(Profiles.of("develop"));
    }

    // SDK 조회 API를 호스트 필터에서 MVC 접근 경계까지 전달할 조건
    public static boolean isSdkReadApiFilterPassThroughEnabled(
            MapInBootProperties properties, Environment environment) {
        if (properties == null || !properties.isEnabled()
                || properties.getWeb() == null || !properties.getWeb().isEnabled()) {
            return false;
        }
        WebAuthMode mode = properties.getWeb().getAuthMode();
        return mode == WebAuthMode.PASSWORD
                || mode == WebAuthMode.NONE
                || isAnonymousPreviewEnabled(properties, environment);
    }

    public static boolean isAnonymousPreviewRequest(HttpServletRequest request) {
        return isGet(request) && PREVIEW_API_PATHS.contains(applicationPath(request));
    }

    public static HttpStatus deniedStatus(
            HttpServletRequest request, MapInBootProperties properties, Environment environment) {
        if (isAuthStatusRequest(request) || isAuthPostRequest(request)) {
            return null;
        }

        WebAuthMode mode = properties == null || properties.getWeb() == null
                ? WebAuthMode.HOST : properties.getWeb().getAuthMode();
        if (mode == WebAuthMode.PASSWORD
                && properties != null
                && properties.isEnabled()
                && properties.getWeb().isEnabled()) {
            if (!isCanonicalMappedPath(request)) {
                return HttpStatus.BAD_REQUEST;
            }
            String mappedPath = mappedApplicationPath(request);
            if (!isPasswordConfigured(properties)) {
                return HttpStatus.SERVICE_UNAVAILABLE;
            }
            if (isPasswordProtectedPath(mappedPath)) {
                return SdkLoginService.hasAuthenticatedSession(request) ? null : HttpStatus.UNAUTHORIZED;
            }
            if (isDevelopmentPath(mappedPath)) {
                if (!SdkLoginService.hasAuthenticatedSession(request)) {
                    return HttpStatus.UNAUTHORIZED;
                }
                return deniedStatus(request, properties.getWeb().getRequiredRole());
            }
        }

        if (isPublicUiRequest(request)
                || (mode == WebAuthMode.NONE && isAnonymousPreviewRequest(request))
                || (isAnonymousPreviewEnabled(properties, environment) && isAnonymousPreviewRequest(request))) {
            return null;
        }
        String requiredRole = properties == null || properties.getWeb() == null
                ? null : properties.getWeb().getRequiredRole();
        return deniedStatus(request, requiredRole);
    }

    private static boolean isPasswordConfigured(MapInBootProperties properties) {
        String password = properties.getWeb().getLogin().getPassword();
        return password != null && !password.isBlank();
    }

    private static boolean isPasswordProtectedPath(String path) {
        return PUBLIC_UI_PATHS.contains(path) || PREVIEW_API_PATHS.contains(path);
    }

    private static boolean isCanonicalMappedPath(HttpServletRequest request) {
        String rawPath = applicationPath(request);
        if (!rawPath.equals(mappedApplicationPath(request))
                || rawPath.contains("//")
                || rawPath.indexOf(';') >= 0
                || rawPath.indexOf('%') >= 0
                || rawPath.indexOf('\\') >= 0) {
            return false;
        }
        for (String segment : rawPath.split("/")) {
            if (".".equals(segment) || "..".equals(segment)) {
                return false;
            }
        }
        return true;
    }

    private static boolean isDevelopmentPath(String path) {
        return "/mapinboot/test".equals(path) || path.startsWith("/mapinboot/test/");
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

    private static boolean isAuthStatusRequest(HttpServletRequest request) {
        return isGet(request) && AUTH_STATUS_PATHS.contains(applicationPath(request));
    }

    private static boolean isAuthPostRequest(HttpServletRequest request) {
        return request != null
                && "POST".equalsIgnoreCase(request.getMethod())
                && AUTH_POST_PATHS.contains(applicationPath(request));
    }

    private static String applicationPath(HttpServletRequest request) {
        if (request == null || request.getRequestURI() == null) {
            return "";
        }
        String contextPath = request.getContextPath();
        String path = contextPath == null || contextPath.isEmpty() || !request.getRequestURI().startsWith(contextPath)
                ? request.getRequestURI()
                : request.getRequestURI().substring(contextPath.length());
        String servletPathPrefix = ServletRequestPathUtils.getServletPathPrefix(request);
        return servletPathPrefix == null || servletPathPrefix.isEmpty() || !path.startsWith(servletPathPrefix)
                ? path
                : path.substring(servletPathPrefix.length());
    }
}
