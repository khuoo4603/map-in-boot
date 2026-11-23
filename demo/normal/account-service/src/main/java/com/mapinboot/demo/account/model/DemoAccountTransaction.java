package com.mapinboot.demo.account.model;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 데모 계좌 거래내역 도메인 모델
 */
public class DemoAccountTransaction {

    private final String transactionId;
    private final String accountId;
    private final LocalDateTime occurredAt;
    private final String type;
    private final BigDecimal amount;
    private final String description;

    public DemoAccountTransaction(
            String transactionId,
            String accountId,
            LocalDateTime occurredAt,
            String type,
            BigDecimal amount,
            String description) {
        this.transactionId = transactionId;
        this.accountId = accountId;
        this.occurredAt = occurredAt;
        this.type = type;
        this.amount = amount;
        this.description = description;
    }

    public String getTransactionId() {
        return transactionId;
    }

    public String getAccountId() {
        return accountId;
    }

    public LocalDateTime getOccurredAt() {
        return occurredAt;
    }

    public String getType() {
        return type;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getDescription() {
        return description;
    }
}

