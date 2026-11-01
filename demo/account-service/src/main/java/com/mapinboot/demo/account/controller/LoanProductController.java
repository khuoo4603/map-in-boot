package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoLoanProduct;
import com.mapinboot.demo.account.repository.InMemoryLoanProductRepository;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공개 대출상품 조회 API 컨트롤러
 */
@RestController
@RequestMapping("/api/public/loans/products")
public class LoanProductController {

    private final InMemoryLoanProductRepository productRepository;

    public LoanProductController(InMemoryLoanProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * 판매 중인 대출상품 목록 조회
     */
    @GetMapping
    public List<DemoLoanProduct> getProducts() {
        return productRepository.findByActive(true);
    }

    /**
     * 대출상품 상세 조회
     */
    @GetMapping("/{productId}")
    public ResponseEntity<DemoLoanProduct> getProduct(@PathVariable String productId) {
        return productRepository.findByProductId(productId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
