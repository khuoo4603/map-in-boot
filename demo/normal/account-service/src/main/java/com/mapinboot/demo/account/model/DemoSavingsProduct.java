package com.mapinboot.demo.account.model;

import java.math.BigDecimal;

/**
 * 데모 예금·적금 금융상품 도메인 모델
 */
public class DemoSavingsProduct {

    private final String productId;
    private final String name;
    private final String kind;
    private final int termMonths;
    private final BigDecimal displayRate;
    private final boolean active;

    public DemoSavingsProduct(
            String productId,
            String name,
            String kind,
            int termMonths,
            BigDecimal displayRate,
            boolean active) {
        this.productId = productId;
        this.name = name;
        this.kind = kind;
        this.termMonths = termMonths;
        this.displayRate = displayRate;
        this.active = active;
    }

    public String getProductId() {
        return productId;
    }

    public String getName() {
        return name;
    }

    public String getKind() {
        return kind;
    }

    public int getTermMonths() {
        return termMonths;
    }

    public BigDecimal getDisplayRate() {
        return displayRate;
    }

    public boolean isActive() {
        return active;
    }
}

