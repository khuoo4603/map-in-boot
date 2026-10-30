package com.mapinboot.demo.account.model;

/**
 * 데모 직원-고객 배정 관계 도메인 모델
 */
public class DemoStaffAssignment {

    private final String staffId;
    private final String customerId;
    private final boolean assigned;
    private final String scope;

    public DemoStaffAssignment(String staffId, String customerId, boolean assigned, String scope) {
        this.staffId = staffId;
        this.customerId = customerId;
        this.assigned = assigned;
        this.scope = scope;
    }

    public String getStaffId() {
        return staffId;
    }

    public String getCustomerId() {
        return customerId;
    }

    public boolean isAssigned() {
        return assigned;
    }

    public String getScope() {
        return scope;
    }
}

