package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoAccount;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 계좌 저장소
 */
@Repository
public class InMemoryAccountRepository {

    private final Map<String, DemoAccount> accountsById = new ConcurrentHashMap<>();

    /**
     * 초기 계좌 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        accountsById.clear();

        save(new DemoAccount("ACC001", "USER001", "CHECKING", new BigDecimal("1250000"), "ACTIVE"));
        save(new DemoAccount("ACC002", "USER002", "CHECKING", new BigDecimal("2800000"), "ACTIVE"));
    }

    /**
     * 계좌 정보 저장
     */
    public void save(DemoAccount account) {
        accountsById.put(account.getAccountId(), account);
    }

    /**
     * 계좌 ID 기준 단건 조회
     */
    public Optional<DemoAccount> findByAccountId(String accountId) {
        return Optional.ofNullable(accountsById.get(accountId));
    }

    /**
     * 소유자 ID(userId) 기준 계좌 목록 조회
     */
    public List<DemoAccount> findByOwnerId(String ownerId) {
        return accountsById.values().stream()
                .filter(account -> account.getOwnerId().equals(ownerId))
                .toList();
    }

    /**
     * 전체 계좌 목록 조회
     */
    public List<DemoAccount> findAll() {
        return new ArrayList<>(accountsById.values());
    }
}

