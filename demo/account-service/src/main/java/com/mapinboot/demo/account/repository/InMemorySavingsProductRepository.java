package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoSavingsProduct;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 예금·적금 상품 저장소
 */
@Repository
public class InMemorySavingsProductRepository {

    private final Map<String, DemoSavingsProduct> productsById = new ConcurrentHashMap<>();

    /**
     * 초기 예금·적금 상품 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        productsById.clear();

        save(new DemoSavingsProduct("DEP-12M", "정기예금 12개월", "DEPOSIT", 12, new BigDecimal("3.50"), true));
        save(new DemoSavingsProduct("SAV-12M", "정기적금 12개월", "INSTALLMENT", 12, new BigDecimal("4.00"), true));
        save(new DemoSavingsProduct("SAV-CLOSED", "특판 적금(마감)", "INSTALLMENT", 6, new BigDecimal("5.00"), false));
    }

    /**
     * 금융상품 저장
     */
    public void save(DemoSavingsProduct product) {
        productsById.put(product.getProductId(), product);
    }

    /**
     * 상품 ID 기준 단건 조회
     */
    public Optional<DemoSavingsProduct> findByProductId(String productId) {
        return Optional.ofNullable(productsById.get(productId));
    }

    /**
     * 활성화 상태별 상품 목록 조회
     */
    public List<DemoSavingsProduct> findByActive(boolean active) {
        return productsById.values().stream()
                .filter(product -> product.isActive() == active)
                .toList();
    }

    /**
     * 전체 금융상품 목록 조회
     */
    public List<DemoSavingsProduct> findAll() {
        return new ArrayList<>(productsById.values());
    }
}

