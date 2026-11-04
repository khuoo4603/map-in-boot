package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoLoanApplication;
import com.mapinboot.demo.account.model.DemoLoanProduct;
import com.mapinboot.demo.account.repository.InMemoryLoanApplicationRepository;
import com.mapinboot.demo.account.repository.InMemoryLoanProductRepository;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 대출 신청 및 고객 본인 신청 내역 API 컨트롤러 */
@RestController
public class LoanApplicationController {

    private final InMemoryLoanApplicationRepository applicationRepository;
    private final InMemoryLoanProductRepository productRepository;

    public LoanApplicationController(
            InMemoryLoanApplicationRepository applicationRepository,
            InMemoryLoanProductRepository productRepository) {
        this.applicationRepository = applicationRepository;
        this.productRepository = productRepository;
    }

    /** 본인확인 완료 고객의 대출 신청 */
    @PostMapping("/api/secured/loans/applications")
    public ResponseEntity<?> createApplication(
            @RequestBody LoanApplicationRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (!isIdentityVerified(jwt)) {
            return identityVerificationRequired();
        }
        return submitApplication(request, jwt);
    }

    /*
     * Scenario: V09 (counterpart: N09)
     * API: POST /api/loans/applications
     * Rule: STATE_BYPASS
     * Vulnerable: JWT 인증 후 필수 본인확인 상태 검사 누락
     * Normal: identity_verified 검증 실패 시 403
     * Note: SDK는 이 주석을 탐지 근거로 사용하지 않음
     */
    @PostMapping("/api/loans/applications")
    public ResponseEntity<?> createVulnerableApplication(
            @RequestBody LoanApplicationRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return submitApplication(request, jwt);
    }

    private ResponseEntity<?> submitApplication(
            LoanApplicationRequest request,
            Jwt jwt) {
        if (request == null
                || request.productId() == null
                || request.productId().isBlank()
                || request.amount() == null
                || request.amount().signum() <= 0) {
            return ResponseEntity.badRequest().build();
        }

        DemoLoanProduct product = productRepository.findByProductId(request.productId()).orElse(null);
        if (product == null) {
            return ResponseEntity.notFound().build();
        }
        if (!product.isActive()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
        if (request.amount().compareTo(product.getMinAmount()) < 0
                || request.amount().compareTo(product.getMaxAmount()) > 0) {
            return ResponseEntity.badRequest().build();
        }

        DemoLoanApplication application = new DemoLoanApplication(
                applicationRepository.nextApplicationId(),
                jwt.getSubject(),
                product.getProductId(),
                request.amount(),
                "SUBMITTED",
                LocalDateTime.now());
        applicationRepository.save(application);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new LoanApplicationResponse(
                        application.getApplicationId(),
                        application.getApplicantId(),
                        application.getStatus()));
    }

    /** 고객 본인 대출 신청 목록 조회 */
    @GetMapping("/api/loans/applications/my")
    public ResponseEntity<List<DemoLoanApplication>> getMyApplications(
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        return ResponseEntity.ok(applicationRepository.findByApplicantId(jwt.getSubject()));
    }

    /** 고객 본인 대출 신청 상세 및 결과 조회 */
    @GetMapping("/api/loans/applications/my/{applicationId}")
    public ResponseEntity<?> getMyApplication(
            @PathVariable String applicationId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoLoanApplication application = applicationRepository
                .findByApplicationId(applicationId)
                .orElse(null);
        if (application == null) {
            return ResponseEntity.notFound().build();
        }
        // 소유권 확인 후 본인확인 상태 검사 순서
        if (!application.getApplicantId().equals(jwt.getSubject())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        if (!isIdentityVerified(jwt)) {
            return identityVerificationRequired();
        }

        return ResponseEntity.ok(application);
    }

    private boolean isIdentityVerified(Jwt jwt) {
        return Boolean.TRUE.equals(jwt.getClaims().get("identity_verified"));
    }

    private ResponseEntity<IdentityErrorResponse> identityVerificationRequired() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new IdentityErrorResponse(
                        false,
                        null,
                        new ErrorDetail("IDENTITY_VERIFICATION_REQUIRED", "본인확인이 필요합니다")));
    }

    private record LoanApplicationRequest(String productId, BigDecimal amount, String purpose) {
    }

    private record LoanApplicationResponse(String applicationId, String applicantId, String status) {
    }

    private record IdentityErrorResponse(boolean success, Object data, ErrorDetail error) {
    }

    private record ErrorDetail(String code, String message) {
    }
}
