package com.mapinboot.demo.identity.repository;

import com.mapinboot.demo.identity.model.DemoCustomerProfile;
import jakarta.annotation.PostConstruct;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 고객 프로필 In-Memory 저장소
 */
@Repository
public class InMemoryCustomerProfileRepository {

    private final Map<String, DemoCustomerProfile> profilesByCustomerId = new ConcurrentHashMap<>();

    /**
     * 고객 프로필 Fixture 초기화
     */
    @PostConstruct
    public void initFixtures() {
        profilesByCustomerId.clear();
        save(new DemoCustomerProfile("CUST001", "USER001", "고객 A"));
        save(new DemoCustomerProfile("CUST002", "USER002", "고객 B"));
    }

    public void save(DemoCustomerProfile profile) {
        profilesByCustomerId.put(profile.getCustomerId(), profile);
    }

    public Optional<DemoCustomerProfile> findByCustomerId(String customerId) {
        return Optional.ofNullable(profilesByCustomerId.get(customerId));
    }
}
