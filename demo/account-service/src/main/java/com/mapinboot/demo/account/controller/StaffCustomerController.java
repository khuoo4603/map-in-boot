package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoCustomer;
import com.mapinboot.demo.account.model.DemoSavingsSubscription;
import com.mapinboot.demo.account.repository.InMemoryCustomerRepository;
import com.mapinboot.demo.account.repository.InMemoryLoanApplicationRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsProductRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsSubscriptionRepository;
import com.mapinboot.demo.account.repository.InMemoryStaffAssignmentRepository;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** 직원 담당 고객 및 금융 내역 조회 API 컨트롤러 */
@RestController
public class StaffCustomerController {

    private final InMemoryStaffAssignmentRepository assignmentRepository;
    private final InMemoryCustomerRepository customerRepository;
    private final InMemorySavingsSubscriptionRepository subscriptionRepository;
    private final InMemorySavingsProductRepository savingsProductRepository;
    private final InMemoryLoanApplicationRepository applicationRepository;

    public StaffCustomerController(
            InMemoryStaffAssignmentRepository assignmentRepository,
            InMemoryCustomerRepository customerRepository,
            InMemorySavingsSubscriptionRepository subscriptionRepository,
            InMemorySavingsProductRepository savingsProductRepository,
            InMemoryLoanApplicationRepository applicationRepository) {
        this.assignmentRepository = assignmentRepository;
        this.customerRepository = customerRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.savingsProductRepository = savingsProductRepository;
        this.applicationRepository = applicationRepository;
    }

    /** 검증된 직원 JWT 기준 담당 고객 목록 조회 */
    @GetMapping("/api/staff/assigned-customers")
    public ResponseEntity<?> getAssignedCustomers(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        List<CustomerSummaryResponse> customers = new ArrayList<>();
        assignmentRepository.findByStaffId(jwt.getSubject()).stream()
                .filter(assignment -> assignment.isAssigned())
                .forEach(assignment -> customerRepository.findByCustomerId(assignment.getCustomerId())
                        .ifPresent(customer -> customers.add(new CustomerSummaryResponse(
                                customer.getCustomerId(),
                                customer.getDisplayName(),
                                customer.getStatus()))));

        return ResponseEntity.ok(customers);
    }

    /** 담당 고객의 예적금 가입 요약 조회 */
    @GetMapping("/api/staff/assigned-customers/{customerId}/savings")
    public ResponseEntity<?> getAssignedSavings(
            @PathVariable String customerId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoCustomer customer = customerRepository.findByCustomerId(customerId).orElse(null);
        if (customer == null) {
            return ResponseEntity.notFound().build();
        }
        if (!isAssigned(jwt.getSubject(), customerId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        List<SavingsSummaryResponse> subscriptions = subscriptionRepository
                .findByOwnerId(customer.getUserId())
                .stream()
                .map(this::toSavingsSummary)
                .toList();
        return ResponseEntity.ok(new SavingsListResponse(subscriptions));
    }

    /** 담당 고객의 대출 신청 요약 조회 */
    @GetMapping("/api/staff/assigned-customers/{customerId}/loans")
    public ResponseEntity<?> getAssignedLoans(
            @PathVariable String customerId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoCustomer customer = customerRepository.findByCustomerId(customerId).orElse(null);
        if (customer == null) {
            return ResponseEntity.notFound().build();
        }
        if (!isAssigned(jwt.getSubject(), customerId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        List<LoanSummaryResponse> applications = applicationRepository
                .findByApplicantId(customer.getUserId())
                .stream()
                .map(application -> new LoanSummaryResponse(
                        application.getApplicationId(),
                        application.getProductId(),
                        application.getAmount(),
                        application.getStatus(),
                        application.getCreatedAt()))
                .toList();
        return ResponseEntity.ok(applications);
    }

    private boolean isAssigned(String staffId, String customerId) {
        return assignmentRepository.findByStaffIdAndCustomerId(staffId, customerId)
                .map(assignment -> assignment.isAssigned())
                .orElse(false);
    }

    private SavingsSummaryResponse toSavingsSummary(DemoSavingsSubscription subscription) {
        String productName = savingsProductRepository.findByProductId(subscription.getProductId())
                .map(product -> product.getName())
                .orElse(subscription.getProductId());
        return new SavingsSummaryResponse(
                subscription.getSubscriptionId(),
                productName,
                subscription.getStatus(),
                subscription.getPrincipal());
    }

    private record CustomerSummaryResponse(String customerId, String displayName, String status) {
    }

    private record SavingsListResponse(List<SavingsSummaryResponse> subscriptions) {
    }

    private record SavingsSummaryResponse(
            String subscriptionId,
            String productName,
            String status,
            BigDecimal principal) {
    }

    private record LoanSummaryResponse(
            String applicationId,
            String productId,
            BigDecimal amount,
            String status,
            LocalDateTime createdAt) {
    }
}
