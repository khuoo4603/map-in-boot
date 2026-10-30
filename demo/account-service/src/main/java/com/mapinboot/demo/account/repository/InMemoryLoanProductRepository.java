package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoLoanProduct;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 대출 상품 저장소
 */
@Repository
public class InMemoryLoanProductRepository {

    private final Map<String, DemoLoanProduct> productsById = new ConcurrentHashMap<>();

    /**
     * 초기 대출 상품 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        productsById.clear();

        save(new DemoLoanProduct(
                "LOAN-BASIC", "기본 신용대출", new BigDecimal("1000000"), new BigDecimal("50000000"), true));
        save(new DemoLoanProduct(
                "LOAN-HOUSE", "주택담보대출", new BigDecimal("10000000"), new BigDecimal("500000000"), true));
    }

    /**
     * 대출 상품 저장
     */
    public void save(DemoLoanProduct product) {
        productsById.put(product.getProductId(), product);
    }

    /**
     * 상품 ID 기준 단건 조회
     */
    public Optional<DemoLoanProduct> findByProductId(String productId) {
        return Optional.ofNullable(productsById.get(productId));
    }

    /**
     * 활성화 상태별 대출 상품 목록 조회
     */
    public List<DemoLoanProduct> findByActive(boolean active) {
        return productsById.values().stream()
                .filter(product -> product.isActive() == active)
                .toList();
    }

    /**
     * 전체 대출 상품 목록 조회
     */
    public List<DemoLoanProduct> findAll() {
        return new ArrayList<>(productsById.values());
    }
}

