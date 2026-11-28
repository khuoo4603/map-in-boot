package com.mapinboot.starter.web.auth;

import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.autoconfigure.WebAuthMode;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.Principal;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

// SDK 인증 상태와 PASSWORD 로그인·로그아웃 API
@RestController
@RequestMapping("/mapinboot/api/auth")
public final class LoginController {
    private static final int MAX_LOGIN_BODY_BYTES = 8192;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final MapInBootProperties properties;
    private final ObjectProvider<SdkLoginService> loginServiceProvider;

    public LoginController(
            MapInBootProperties properties, ObjectProvider<SdkLoginService> loginServiceProvider) {
        this.properties = properties;
        this.loginServiceProvider = loginServiceProvider;
    }

    @GetMapping("/status")
    public ResponseEntity<AuthStatus> status(HttpServletRequest request) {
        WebAuthMode mode = properties.getWeb().getAuthMode();
        boolean authenticated = false;
        String csrfToken = null;
        if (mode == WebAuthMode.HOST) {
            Principal principal = request.getUserPrincipal();
            authenticated = principal != null;
        } else if (mode == WebAuthMode.PASSWORD) {
            SdkLoginService loginService = loginServiceProvider.getIfAvailable();
            if (loginService != null) {
                authenticated = loginService.isAuthenticated(request);
                csrfToken = loginService.csrfToken(request);
            }
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new AuthStatus(mode, authenticated, csrfToken));
    }

    @PostMapping("/login")
    public ResponseEntity<Void> login(
            HttpServletRequest request) throws IOException {
        if (!isPasswordMode()) {
            return response(HttpStatus.NOT_FOUND);
        }
        SdkLoginService loginService = loginServiceProvider.getIfAvailable();
        if (loginService == null || !loginService.isConfigured()) {
            return response(HttpStatus.SERVICE_UNAVAILABLE);
        }
        String contentType = request.getContentType();
        if (contentType == null
                || !"application/json".equalsIgnoreCase(contentType.split(";", 2)[0].trim())) {
            return response(HttpStatus.BAD_REQUEST);
        }
        LoginRequest loginRequest = parseLoginRequest(request);
        if (loginRequest == null || loginRequest.password() == null || loginRequest.password().isBlank()) {
            return response(HttpStatus.BAD_REQUEST);
        }
        return response(loginStatus(loginService.login(
                request, loginRequest.password(), request.getHeader(SdkLoginService.CSRF_HEADER))));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        if (!isPasswordMode()) {
            return response(HttpStatus.NOT_FOUND);
        }
        SdkLoginService loginService = loginServiceProvider.getIfAvailable();
        if (loginService == null) {
            return response(HttpStatus.SERVICE_UNAVAILABLE);
        }
        SdkLoginService.LoginResult result = loginService.logout(
                request, request.getHeader(SdkLoginService.CSRF_HEADER));
        return result == SdkLoginService.LoginResult.SUCCESS
                ? response(HttpStatus.NO_CONTENT)
                : response(loginStatus(result));
    }

    private boolean isPasswordMode() {
        return properties.isEnabled()
                && properties.getWeb().isEnabled()
                && properties.getWeb().getAuthMode() == WebAuthMode.PASSWORD;
    }

    private LoginRequest parseLoginRequest(HttpServletRequest request) throws IOException {
        try {
            byte[] body = request.getInputStream().readNBytes(MAX_LOGIN_BODY_BYTES + 1);
            if (body.length > MAX_LOGIN_BODY_BYTES) {
                return null;
            }
            return JSON.readValue(body, LoginRequest.class);
        } catch (JacksonException exception) {
            return null;
        }
    }

    private HttpStatus loginStatus(SdkLoginService.LoginResult result) {
        return switch (result) {
            case SUCCESS -> HttpStatus.OK;
            case CONFIGURATION_INVALID -> HttpStatus.SERVICE_UNAVAILABLE;
            case REQUEST_INVALID -> HttpStatus.BAD_REQUEST;
            case CSRF_INVALID -> HttpStatus.FORBIDDEN;
            case RATE_LIMITED -> HttpStatus.TOO_MANY_REQUESTS;
            case PASSWORD_INVALID -> HttpStatus.UNAUTHORIZED;
        };
    }

    private ResponseEntity<Void> response(HttpStatus status) {
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }

    public record AuthStatus(WebAuthMode mode, boolean authenticated, String csrfToken) {
        @Override
        public String toString() {
            return "AuthStatus[mode=" + mode + ", authenticated=" + authenticated + ", csrfToken=<redacted>]";
        }
    }

    public record LoginRequest(String password) {
        @Override
        public String toString() {
            return "LoginRequest[password=<redacted>]";
        }
    }
}
