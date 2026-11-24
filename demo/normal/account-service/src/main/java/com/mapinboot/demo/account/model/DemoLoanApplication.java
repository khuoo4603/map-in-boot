package com.mapinboot.demo.account.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 데모 대출 신청 도메인 모델
 */
public class DemoLoanApplication {

    private final String applicationId;
    private final String applicantId;
    private final String productId;
    private final BigDecimal amount;
    private final String status;
    private final LocalDateTime createdAt;

    public DemoLoanApplication(
            String applicationId,
            String applicantId,
            String productId,
            BigDecimal amount,
            String status,
            LocalDateTime createdAt) {
        this.applicationId = applicationId;
        this.applicantId = applicantId;
        this.productId = productId;
        this.amount = amount;
        this.status = status;
        this.createdAt = createdAt;
    }

    public String getApplicationId() {
        return applicationId;
    }

    public String getApplicantId() {
        return applicantId;
    }

    public String getProductId() {
        return productId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getStatus() {
        return status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}

