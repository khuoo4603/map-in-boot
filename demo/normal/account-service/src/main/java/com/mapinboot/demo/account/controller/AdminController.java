package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoLoanApplication;
import com.mapinboot.demo.account.model.DemoSavingsProduct;
import com.mapinboot.demo.account.model.DemoSavingsSubscription;
import com.mapinboot.demo.account.model.DemoStaffAssignment;
import com.mapinboot.demo.account.repository.InMemoryLoanApplicationRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsProductRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsSubscriptionRepository;
import com.mapinboot.demo.account.repository.InMemoryStaffAssignmentRepository;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 은행 관리자 상품 운영 및 금융 현황 조회 API 컨트롤러 */
@RestController
public class AdminController {

    private final InMemorySavingsProductRepository productRepository;
    private final InMemorySavingsSubscriptionRepository subscriptionRepository;
    private final InMemoryLoanApplicationRepository applicationRepository;
    private final InMemoryStaffAssignmentRepository assignmentRepository;

    public AdminController(
            InMemorySavingsProductRepository productRepository,
            InMemorySavingsSubscriptionRepository subscriptionRepository,
            InMemoryLoanApplicationRepository applicationRepository,
            InMemoryStaffAssignmentRepository assignmentRepository) {
        this.productRepository = productRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.applicationRepository = applicationRepository;
        this.assignmentRepository = assignmentRepository;
    }

    /** 활성·비활성 예적금 상품 전체 조회 */
    @GetMapping("/api/admin/savings/products")
    public ResponseEntity<?> getSavingsProducts(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(productRepository.findAll());
    }

    /** 신규 예적금 상품 등록 */
    @PostMapping("/api/admin/savings/products")
    public ResponseEntity<?> createSavingsProduct(
            @RequestBody SavingsProductRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (!isValidCreateRequest(request)) {
            return ResponseEntity.badRequest().build();
        }

        String productId = productRepository.nextProductId();
        productRepository.save(new DemoSavingsProduct(
                productId,
                request.name(),
                request.kind(),
                request.termMonths(),
                request.displayRate(),
                true));

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new ProductCreateResponse(productId, true));
    }

    /** 예적금 상품 표시 정보 및 판매 상태 변경 */
    @PatchMapping("/api/admin/savings/products/{productId}")
    public ResponseEntity<?> updateSavingsProduct(
            @PathVariable String productId,
            @RequestBody SavingsProductUpdateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoSavingsProduct product = productRepository.findByProductId(productId).orElse(null);
        if (product == null) {
            return ResponseEntity.notFound().build();
        }
        if (!isValidUpdateRequest(request)) {
            return ResponseEntity.badRequest().build();
        }

        DemoSavingsProduct updatedProduct = new DemoSavingsProduct(
                product.getProductId(),
                request.name() == null ? product.getName() : request.name(),
                product.getKind(),
                product.getTermMonths(),
                product.getDisplayRate(),
                request.active() == null ? product.isActive() : request.active());
        productRepository.save(updatedProduct);

        return ResponseEntity.ok(new ProductUpdateResponse(
                updatedProduct.getProductId(),
                updatedProduct.isActive(),
                LocalDateTime.now()));
    }

    /** 예적금 가입 현황 및 선택 필터 조회 */
    @GetMapping("/api/admin/savings/subscriptions")
    public ResponseEntity<?> getSavingsSubscriptions(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String productId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        List<SubscriptionSummaryResponse> items = subscriptionRepository.findAll().stream()
                .filter(subscription -> productId == null
                        || productId.isBlank()
                        || productId.equals(subscription.getProductId()))
                .filter(subscription -> status == null
                        || status.isBlank()
                        || status.equals(subscription.getStatus()))
                .map(subscription -> new SubscriptionSummaryResponse(
                        subscription.getSubscriptionId(),
                        subscription.getProductId(),
                        subscription.getStatus(),
                        subscription.getPrincipal()))
                .toList();

        return ResponseEntity.ok(new SubscriptionListResponse(items, items.size()));
    }

    /** 대출 신청 상태별 건수 조회 */
    @GetMapping("/api/admin/loans/summary")
    public ResponseEntity<?> getLoanSummary(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        List<DemoLoanApplication> applications = applicationRepository.findAll();
        Map<String, Long> statusCounts = applications.stream()
                .collect(Collectors.groupingBy(
                        DemoLoanApplication::getStatus,
                        LinkedHashMap::new,
                        Collectors.counting()));
        return ResponseEntity.ok(new LoanSummaryResponse(
                applications.size(),
                statusCounts));
    }

    /** 직원 담당 고객 배정 현황 조회 */
    @GetMapping("/api/admin/assignments")
    public ResponseEntity<?> getAssignments(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(assignmentRepository.findAll());
    }

    private boolean isValidCreateRequest(SavingsProductRequest request) {
        return request != null
                && request.name() != null
                && !request.name().isBlank()
                && ("DEPOSIT".equals(request.kind()) || "INSTALLMENT".equals(request.kind()))
                && request.termMonths() != null
                && request.termMonths() > 0
                && request.displayRate() != null
                && request.displayRate().signum() >= 0;
    }

    private boolean isValidUpdateRequest(SavingsProductUpdateRequest request) {
        return request != null
                && (request.name() != null || request.active() != null)
                && (request.name() == null || !request.name().isBlank());
    }

    private record SavingsProductRequest(
            String name,
            String kind,
            Integer termMonths,
            BigDecimal displayRate) {
    }

    private record SavingsProductUpdateRequest(String name, Boolean active) {
    }

    private record ProductCreateResponse(String productId, boolean active) {
    }

    private record ProductUpdateResponse(String productId, boolean active, LocalDateTime updatedAt) {
    }

    private record SubscriptionListResponse(
            List<SubscriptionSummaryResponse> items,
            int totalCount) {
    }

    private record SubscriptionSummaryResponse(
            String subscriptionId,
            String productId,
            String status,
            BigDecimal principal) {
    }

    private record LoanSummaryResponse(int totalCount, Map<String, Long> statusCounts) {
    }
}
