package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoSavingsProduct;
import com.mapinboot.demo.account.model.DemoSavingsSubscription;
import com.mapinboot.demo.account.repository.InMemorySavingsProductRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsSubscriptionRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 고객 예적금 가입·보유 내역 API 컨트롤러
 */
@RestController
@RequestMapping("/api/my")
public class MySavingsController {

    private final InMemorySavingsProductRepository productRepository;
    private final InMemorySavingsSubscriptionRepository subscriptionRepository;

    public MySavingsController(
            InMemorySavingsProductRepository productRepository,
            InMemorySavingsSubscriptionRepository subscriptionRepository) {
        this.productRepository = productRepository;
        this.subscriptionRepository = subscriptionRepository;
    }

    /**
     * 현재 인증된 고객의 예적금 가입 목록 조회
     */
    @GetMapping("/savings")
    public ResponseEntity<List<DemoSavingsSubscription>> getMySavings(
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        return ResponseEntity.ok(subscriptionRepository.findByOwnerId(jwt.getSubject()));
    }

    /**
     * 현재 인증된 고객의 예적금 가입 상세 조회
     */
    @GetMapping("/savings/{subscriptionId}")
    public ResponseEntity<?> getMySavingsDetail(
            @PathVariable String subscriptionId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoSavingsSubscription subscription = subscriptionRepository
                .findBySubscriptionId(subscriptionId)
                .orElse(null);
        if (subscription == null) {
            return ResponseEntity.notFound().build();
        }
        if (!subscription.getOwnerId().equals(jwt.getSubject())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        DemoSavingsProduct product = productRepository
                .findByProductId(subscription.getProductId())
                .orElse(null);
        String productName = product == null ? subscription.getProductId() : product.getName();

        return ResponseEntity.ok(new SavingsDetailResponse(
                subscription.getSubscriptionId(),
                subscription.getProductId(),
                productName,
                subscription.getPrincipal(),
                subscription.getJoinedAt(),
                subscription.getMaturityDate(),
                subscription.getStatus()));
    }

    /**
     * 현재 인증된 고객의 예적금 가입
     */
    @PostMapping("/savings")
    public ResponseEntity<?> createSavings(
            @RequestBody SavingsRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (request == null
                || request.productId() == null
                || request.productId().isBlank()
                || request.principal() == null
                || request.principal().signum() <= 0) {
            return ResponseEntity.badRequest().build();
        }

        DemoSavingsProduct product = productRepository
                .findByProductId(request.productId())
                .orElse(null);
        if (product == null) {
            return ResponseEntity.notFound().build();
        }
        if (!product.isActive()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        LocalDate joinedAt = LocalDate.now();
        DemoSavingsSubscription subscription = new DemoSavingsSubscription(
                subscriptionRepository.nextSubscriptionId(),
                jwt.getSubject(),
                product.getProductId(),
                request.principal(),
                joinedAt,
                joinedAt.plusMonths(product.getTermMonths()),
                "ACTIVE");
        subscriptionRepository.save(subscription);

        return ResponseEntity.status(HttpStatus.CREATED).body(subscription);
    }

    private record SavingsRequest(String productId, BigDecimal principal) {
    }

    private record SavingsDetailResponse(
            String subscriptionId,
            String productId,
            String productName,
            BigDecimal principal,
            LocalDate joinedAt,
            LocalDate maturityDate,
            String status) {
    }
}
