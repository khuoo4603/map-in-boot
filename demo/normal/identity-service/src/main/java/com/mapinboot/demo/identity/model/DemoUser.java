package com.mapinboot.demo.identity.model;

import java.util.Collections;
import java.util.Set;

/**
 * 데모 사용자 도메인 모델
 */
public class DemoUser {

    private final String userId;
    private final String username;
    private final String passwordHash;
    private final Set<String> roles;
    private final boolean enabled;

    public DemoUser(String userId, String username, String passwordHash, Set<String> roles, boolean enabled) {
        this.userId = userId;
        this.username = username;
        this.passwordHash = passwordHash;
        this.roles = roles != null ? Collections.unmodifiableSet(roles) : Collections.emptySet();
        this.enabled = enabled;
    }

    public String getUserId() {
        return userId;
    }

    public String getUsername() {
        return username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public Set<String> getRoles() {
        return roles;
    }

    public boolean isEnabled() {
        return enabled;
    }
}

