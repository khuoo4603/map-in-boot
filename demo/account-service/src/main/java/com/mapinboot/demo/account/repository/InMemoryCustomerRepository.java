package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoCustomer;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 고객 정보 저장소
 */
@Repository
public class InMemoryCustomerRepository {

    private final Map<String, DemoCustomer> customersById = new ConcurrentHashMap<>();
    private final Map<String, DemoCustomer> customersByUserId = new ConcurrentHashMap<>();

    /**
     * 초기 고객 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        customersById.clear();
        customersByUserId.clear();

        save(new DemoCustomer("CUST001", "USER001", "고객 A", "ACTIVE"));
        save(new DemoCustomer("CUST002", "USER002", "고객 B", "ACTIVE"));
    }

    /**
     * 고객 정보 저장
     */
    public void save(DemoCustomer customer) {
        customersById.put(customer.getCustomerId(), customer);
        customersByUserId.put(customer.getUserId(), customer);
    }

    /**
     * 고객 ID 기준 단건 조회
     */
    public Optional<DemoCustomer> findByCustomerId(String customerId) {
        return Optional.ofNullable(customersById.get(customerId));
    }

    /**
     * 사용자 ID 기준 단건 조회
     */
    public Optional<DemoCustomer> findByUserId(String userId) {
        return Optional.ofNullable(customersByUserId.get(userId));
    }

    /**
     * 전체 고객 목록 조회
     */
    public List<DemoCustomer> findAll() {
        return new ArrayList<>(customersById.values());
    }
}

