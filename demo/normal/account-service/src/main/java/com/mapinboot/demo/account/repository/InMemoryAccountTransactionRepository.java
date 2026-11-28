package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoAccountTransaction;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 계좌 거래내역 저장소
 */
@Repository
public class InMemoryAccountTransactionRepository {

    private final Map<String, DemoAccountTransaction> transactionsById = new ConcurrentHashMap<>();

    /**
     * 초기 계좌 거래내역 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        transactionsById.clear();

        LocalDateTime baseTime = LocalDateTime.of(2026, 10, 1, 9, 0, 0);

        save(new DemoAccountTransaction(
                "TX001", "ACC001", baseTime.plusDays(1), "DEPOSIT", new BigDecimal("1000000"), "급여 입금"));
        save(new DemoAccountTransaction(
                "TX002", "ACC001", baseTime.plusDays(3), "WITHDRAWAL", new BigDecimal("50000"), "ATM 현금 인출"));
        save(new DemoAccountTransaction(
                "TX003", "ACC001", baseTime.plusDays(5), "DEPOSIT", new BigDecimal("300000"), "이자 정산 입금"));
    }

    /**
     * 거래내역 저장
     */
    public void save(DemoAccountTransaction transaction) {
        transactionsById.put(transaction.getTransactionId(), transaction);
    }

    /**
     * 거래 ID 기준 단건 조회
     */
    public Optional<DemoAccountTransaction> findByTransactionId(String transactionId) {
        return Optional.ofNullable(transactionsById.get(transactionId));
    }

    /**
     * 계좌 ID 기준 거래내역 목록 조회
     */
    public List<DemoAccountTransaction> findByAccountId(String accountId) {
        return transactionsById.values().stream()
                .filter(transaction -> transaction.getAccountId().equals(accountId))
                .toList();
    }

    /**
     * 전체 거래내역 목록 조회
     */
    public List<DemoAccountTransaction> findAll() {
        return new ArrayList<>(transactionsById.values());
    }
}

