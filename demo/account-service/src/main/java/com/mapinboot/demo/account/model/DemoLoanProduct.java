package com.mapinboot.demo.account.model;

import java.math.BigDecimal;

/**
 * 데모 대출 금융상품 도메인 모델
 */
public class DemoLoanProduct {

    private final String productId;
    private final String name;
    private final BigDecimal minAmount;
    private final BigDecimal maxAmount;
    private final boolean active;

    public DemoLoanProduct(
            String productId,
            String name,
            BigDecimal minAmount,
            BigDecimal maxAmount,
            boolean active) {
        this.productId = productId;
        this.name = name;
        this.minAmount = minAmount;
        this.maxAmount = maxAmount;
        this.active = active;
    }

    public String getProductId() {
        return productId;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getMinAmount() {
        return minAmount;
    }

    public BigDecimal getMaxAmount() {
        return maxAmount;
    }

    public boolean isActive() {
        return active;
    }
}

