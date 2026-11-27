package com.mapinboot.starter.web.auth;

import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

// SDK 전용 Session 인증과 CSRF 상태 관리
public final class SdkLoginService {
    public static final String CSRF_HEADER = "X-MapInBoot-CSRF";

    private static final String AUTHENTICATED = "mapinboot.sdk.auth.authenticated";
    private static final String AUTHENTICATED_AT = "mapinboot.sdk.auth.authenticated-at";
    private static final String EXPIRES_AT = "mapinboot.sdk.auth.expires-at";
    private static final String CSRF_TOKEN = "mapinboot.sdk.auth.csrf-token";
    private static final String CSRF_EXPIRES_AT = "mapinboot.sdk.auth.csrf-expires-at";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final MapInBootProperties properties;
    private final LoginAttemptLimiter attemptLimiter;

    public SdkLoginService(MapInBootProperties properties, LoginAttemptLimiter attemptLimiter) {
        this.properties = properties;
        this.attemptLimiter = attemptLimiter;
    }

    public boolean isConfigured() {
        String password = properties.getWeb().getLogin().getPassword();
        return password != null && !password.isBlank();
    }

    public boolean isAuthenticated(HttpServletRequest request) {
        return hasAuthenticatedSession(request);
    }

    public static boolean hasAuthenticatedSession(HttpServletRequest request) {
        HttpSession session = request == null ? null : request.getSession(false);
        if (session == null) {
            return false;
        }
        synchronized (session) {
            if (!Boolean.TRUE.equals(session.getAttribute(AUTHENTICATED))) {
                return false;
            }
            Object expiryValue = session.getAttribute(EXPIRES_AT);
            if (!(expiryValue instanceof Instant expiresAt) || !Instant.now().isBefore(expiresAt)) {
                clearAuthentication(session);
                return false;
            }
            return true;
        }
    }

    public String csrfToken(HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        synchronized (session) {
            return csrfToken(session, Instant.now());
        }
    }

    public synchronized LoginResult login(HttpServletRequest request, String password, String csrfToken) {
        if (!isConfigured()) {
            return LoginResult.CONFIGURATION_INVALID;
        }
        if (password == null || password.isBlank()) {
            return LoginResult.REQUEST_INVALID;
        }

        HttpSession session = request.getSession(false);
        if (session == null) {
            return LoginResult.CSRF_INVALID;
        }

        synchronized (session) {
            if (!validCsrfToken(session, csrfToken)) {
                return LoginResult.CSRF_INVALID;
            }

            String remoteAddress = request.getRemoteAddr();
            if (attemptLimiter.isLimited(remoteAddress)) {
                return LoginResult.RATE_LIMITED;
            }

            byte[] configured = properties.getWeb().getLogin().getPassword().getBytes(StandardCharsets.UTF_8);
            byte[] supplied = password.getBytes(StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(configured, supplied)) {
                attemptLimiter.recordFailure(remoteAddress);
                return LoginResult.PASSWORD_INVALID;
            }

            attemptLimiter.reset(remoteAddress);
            request.changeSessionId();
            Instant now = Instant.now();
            session.setAttribute(AUTHENTICATED, Boolean.TRUE);
            session.setAttribute(AUTHENTICATED_AT, now);
            session.setAttribute(EXPIRES_AT, now.plus(sessionTimeout()));
            rotateCsrfToken(session, now);
            return LoginResult.SUCCESS;
        }
    }

    public LoginResult logout(HttpServletRequest request, String csrfToken) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return LoginResult.CSRF_INVALID;
        }
        synchronized (session) {
            if (!validCsrfToken(session, csrfToken)) {
                return LoginResult.CSRF_INVALID;
            }
            clearAuthentication(session);
            rotateCsrfToken(session, Instant.now());
            return LoginResult.SUCCESS;
        }
    }

    private boolean validCsrfToken(HttpSession session, String suppliedToken) {
        if (session == null || suppliedToken == null) {
            return false;
        }
        Object storedValue = session.getAttribute(CSRF_TOKEN);
        Object expiryValue = session.getAttribute(CSRF_EXPIRES_AT);
        if (!(storedValue instanceof String storedToken)
                || !(expiryValue instanceof Instant expiresAt)
                || !Instant.now().isBefore(expiresAt)) {
            clearCsrfToken(session);
            return false;
        }
        return MessageDigest.isEqual(
                storedToken.getBytes(StandardCharsets.UTF_8), suppliedToken.getBytes(StandardCharsets.UTF_8));
    }

    private String csrfToken(HttpSession session, Instant now) {
        Object tokenValue = session.getAttribute(CSRF_TOKEN);
        Object expiryValue = session.getAttribute(CSRF_EXPIRES_AT);
        if (tokenValue instanceof String token
                && expiryValue instanceof Instant expiresAt
                && now.isBefore(expiresAt)) {
            return token;
        }
        return rotateCsrfToken(session, now);
    }

    private String rotateCsrfToken(HttpSession session, Instant now) {
        byte[] randomBytes = new byte[32];
        RANDOM.nextBytes(randomBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
        session.setAttribute(CSRF_TOKEN, token);
        session.setAttribute(CSRF_EXPIRES_AT, now.plus(sessionTimeout()));
        return token;
    }

    private Duration sessionTimeout() {
        return properties.getWeb().getLogin().getSessionTimeout();
    }

    private static void clearAuthentication(HttpSession session) {
        if (session != null) {
            session.removeAttribute(AUTHENTICATED);
            session.removeAttribute(AUTHENTICATED_AT);
            session.removeAttribute(EXPIRES_AT);
        }
    }

    private static void clearCsrfToken(HttpSession session) {
        session.removeAttribute(CSRF_TOKEN);
        session.removeAttribute(CSRF_EXPIRES_AT);
    }

    public enum LoginResult {
        SUCCESS,
        CONFIGURATION_INVALID,
        REQUEST_INVALID,
        CSRF_INVALID,
        RATE_LIMITED,
        PASSWORD_INVALID
    }
}
