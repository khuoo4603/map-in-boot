package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoSavingsSubscription;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 예금·적금 가입 내역 저장소
 */
@Repository
public class InMemorySavingsSubscriptionRepository {

    private final Map<String, DemoSavingsSubscription> subscriptionsById = new ConcurrentHashMap<>();

    /**
     * 초기 예적금 가입 내역 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        subscriptionsById.clear();

        save(new DemoSavingsSubscription(
                "SAV001",
                "USER001",
                "DEP-12M",
                new BigDecimal("5000000"),
                LocalDate.of(2026, 1, 10),
                LocalDate.of(2027, 1, 10),
                "ACTIVE"));

        save(new DemoSavingsSubscription(
                "SAV002",
                "USER002",
                "SAV-12M",
                new BigDecimal("2000000"),
                LocalDate.of(2026, 2, 15),
                LocalDate.of(2027, 2, 15),
                "ACTIVE"));
    }

    /**
     * 가입 내역 저장
     */
    public void save(DemoSavingsSubscription subscription) {
        subscriptionsById.put(subscription.getSubscriptionId(), subscription);
    }

    /**
     * 가입 식별자 기준 단건 조회
     */
    public Optional<DemoSavingsSubscription> findBySubscriptionId(String subscriptionId) {
        return Optional.ofNullable(subscriptionsById.get(subscriptionId));
    }

    /**
     * 소유자 ID(userId) 기준 가입 내역 목록 조회
     */
    public List<DemoSavingsSubscription> findByOwnerId(String ownerId) {
        return subscriptionsById.values().stream()
                .filter(subscription -> subscription.getOwnerId().equals(ownerId))
                .toList();
    }

    /**
     * 전체 가입 내역 목록 조회
     */
    public List<DemoSavingsSubscription> findAll() {
        return new ArrayList<>(subscriptionsById.values());
    }
}

