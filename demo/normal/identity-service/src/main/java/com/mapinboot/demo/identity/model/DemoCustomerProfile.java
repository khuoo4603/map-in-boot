package com.mapinboot.demo.identity.model;

/**
 * 고객 프로필 Fixture 모델
 */
public class DemoCustomerProfile {

    private final String customerId;
    private final String userId;
    private final String displayName;

    public DemoCustomerProfile(String customerId, String userId, String displayName) {
        this.customerId = customerId;
        this.userId = userId;
        this.displayName = displayName;
    }

    public String getCustomerId() {
        return customerId;
    }

    public String getUserId() {
        return userId;
    }

    public String getDisplayName() {
        return displayName;
    }
}
