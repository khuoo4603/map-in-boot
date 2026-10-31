package com.mapinboot.demo.account.model;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * 데모 예금·적금 고객 가입 내역 도메인 모델
 */
public class DemoSavingsSubscription {

    private final String subscriptionId;
    private final String ownerId;
    private final String productId;
    private final BigDecimal principal;
    private final LocalDate joinedAt;
    private final LocalDate maturityDate;
    private final String status;

    public DemoSavingsSubscription(
            String subscriptionId,
            String ownerId,
            String productId,
            BigDecimal principal,
            LocalDate joinedAt,
            LocalDate maturityDate,
            String status) {
        this.subscriptionId = subscriptionId;
        this.ownerId = ownerId;
        this.productId = productId;
        this.principal = principal;
        this.joinedAt = joinedAt;
        this.maturityDate = maturityDate;
        this.status = status;
    }

    public String getSubscriptionId() {
        return subscriptionId;
    }

    public String getOwnerId() {
        return ownerId;
    }

    public String getProductId() {
        return productId;
    }

    public BigDecimal getPrincipal() {
        return principal;
    }

    public LocalDate getJoinedAt() {
        return joinedAt;
    }

    public LocalDate getMaturityDate() {
        return maturityDate;
    }

    public String getStatus() {
        return status;
    }
}

