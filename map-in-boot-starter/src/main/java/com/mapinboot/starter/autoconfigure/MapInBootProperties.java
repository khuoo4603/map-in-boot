package com.mapinboot.starter.autoconfigure;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;

// Starter 실행 및 후속 Snapshot 설정 바인딩
@ConfigurationProperties(prefix = "mapinboot")
public class MapInBootProperties implements InitializingBean {
    private boolean enabled = true;
    private Web web = new Web();
    private Snapshot snapshot = new Snapshot();

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Web getWeb() {
        return web;
    }

    public void setWeb(Web web) {
        this.web = web;
    }

    public Snapshot getSnapshot() {
        return snapshot;
    }

    public void setSnapshot(Snapshot snapshot) {
        this.snapshot = snapshot;
    }

    @Override
    public void afterPropertiesSet() {
        if (web == null || web.requiredRole == null || web.requiredRole.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "mapinboot.web.required-role 설정이 비어 있습니다.");
        }
        if (web.login == null || web.login.sessionTimeout == null
                || web.login.sessionTimeout.isZero() || web.login.sessionTimeout.isNegative()) {
            throw new MapInBootException(
                    ErrorCode.INVALID_CONFIG, "mapinboot.web.login.session-timeout 값은 양수여야 합니다.");
        }
        try {
            Instant.now().plus(web.login.sessionTimeout);
        } catch (DateTimeException | ArithmeticException exception) {
            throw new MapInBootException(
                    ErrorCode.INVALID_CONFIG, "mapinboot.web.login.session-timeout 인증 만료 시각 범위 초과", exception);
        }
        if (snapshot == null || snapshot.directory == null || snapshot.directory.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "mapinboot.snapshot.directory 설정이 비어 있습니다.");
        }
        if (snapshot.retentionDays < 1 || snapshot.retentionDays > 90) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "mapinboot.snapshot.retention-days 범위가 올바르지 않습니다.");
        }
        try {
            Path.of(snapshot.directory);
        } catch (InvalidPathException exception) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "mapinboot.snapshot.directory 경로가 올바르지 않습니다.", exception);
        }
    }

    public static class Web {
        private boolean enabled = false;
        private boolean anonymousPreview = false;
        private String requiredRole = "MAP_IN_BOOT_ADMIN";
        private WebAuthMode authMode;
        private Login login = new Login();

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isAnonymousPreview() {
            return anonymousPreview;
        }

        public void setAnonymousPreview(boolean anonymousPreview) {
            this.anonymousPreview = anonymousPreview;
        }

        public String getRequiredRole() {
            return requiredRole;
        }

        public void setRequiredRole(String requiredRole) {
            this.requiredRole = requiredRole;
        }

        public WebAuthMode getAuthMode() {
            return authMode == null ? WebAuthMode.HOST : authMode;
        }

        public void setAuthMode(WebAuthMode authMode) {
            this.authMode = authMode;
        }

        public boolean isAuthModeConfigured() {
            return authMode != null;
        }

        public Login getLogin() {
            return login;
        }

        public void setLogin(Login login) {
            this.login = login;
        }

        public static class Login {
            private String password;
            private Duration sessionTimeout = Duration.ofMinutes(30);

            public String getPassword() {
                return password;
            }

            public void setPassword(String password) {
                this.password = password;
            }

            public Duration getSessionTimeout() {
                return sessionTimeout;
            }

            public void setSessionTimeout(Duration sessionTimeout) {
                this.sessionTimeout = sessionTimeout;
            }
        }
    }

    public static class Snapshot {
        private String directory = "./mapinboot-data/snapshots";
        private int retentionDays = 7;

        public String getDirectory() {
            return directory;
        }

        public void setDirectory(String directory) {
            this.directory = directory;
        }

        public int getRetentionDays() {
            return retentionDays;
        }

        public void setRetentionDays(int retentionDays) {
            this.retentionDays = retentionDays;
        }
    }
}
