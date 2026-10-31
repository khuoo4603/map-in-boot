package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoSavingsProduct;
import com.mapinboot.demo.account.repository.InMemorySavingsProductRepository;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공개 예금·적금 상품 조회 API 컨트롤러
 */
@RestController
@RequestMapping("/api/public/savings/products")
public class SavingsProductController {

    private final InMemorySavingsProductRepository productRepository;

    public SavingsProductController(InMemorySavingsProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * 판매 중인 예금·적금 상품 목록 조회
     */
    @GetMapping
    public List<DemoSavingsProduct> getProducts() {
        return productRepository.findByActive(true);
    }

    /**
     * 예금·적금 상품 상세 조회
     */
    @GetMapping("/{productId}")
    public ResponseEntity<DemoSavingsProduct> getProduct(@PathVariable String productId) {
        return productRepository.findByProductId(productId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
