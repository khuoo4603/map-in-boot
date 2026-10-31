package com.mapinboot.demo.account.model;

/**
 * 데모 고객 정보 도메인 모델
 */
public class DemoCustomer {

    private final String customerId;
    private final String userId;
    private final String displayName;
    private final String status;

    public DemoCustomer(String customerId, String userId, String displayName, String status) {
        this.customerId = customerId;
        this.userId = userId;
        this.displayName = displayName;
        this.status = status;
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

    public String getStatus() {
        return status;
    }
}

