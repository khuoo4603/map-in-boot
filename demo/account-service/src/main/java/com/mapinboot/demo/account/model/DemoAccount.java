package com.mapinboot.demo.account.model;

import java.math.BigDecimal;
import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 데모 계좌 도메인 모델
 */
public class DemoAccount {

    private final String accountId;
    private final String accountNumber;
    private final String ownerId;
    private final String accountType;
    private final BigDecimal balance;
    private final String status;

    public DemoAccount(String accountId, String ownerId, String accountType, BigDecimal balance, String status) {
        this(accountId, null, ownerId, accountType, balance, status);
    }

    public DemoAccount(
            String accountId,
            String accountNumber,
            String ownerId,
            String accountType,
            BigDecimal balance,
            String status) {
        this.accountId = accountId;
        this.accountNumber = accountNumber;
        this.ownerId = ownerId;
        this.accountType = accountType;
        this.balance = balance;
        this.status = status;
    }

    public String getAccountId() {
        return accountId;
    }

    /**
     * 고객 화면 표시용 계좌번호 조회
     */
    @JsonIgnore
    public String getAccountNumber() {
        return accountNumber;
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

