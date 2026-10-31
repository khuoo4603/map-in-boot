package com.mapinboot.demo.account.model;

import java.math.BigDecimal;

/**
 * 데모 계좌 도메인 모델
 */
public class DemoAccount {

    private final String accountId;
    private final String ownerId;
    private final String accountType;
    private final BigDecimal balance;
    private final String status;

    public DemoAccount(String accountId, String ownerId, String accountType, BigDecimal balance, String status) {
        this.accountId = accountId;
        this.ownerId = ownerId;
        this.accountType = accountType;
        this.balance = balance;
        this.status = status;
    }

    public String getAccountId() {
        return accountId;
    }

    public String getOwnerId() {
        return ownerId;
    }

    public String getAccountType() {
        return accountType;
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public String getStatus() {
        return status;
    }
}

