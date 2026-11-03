package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.repository.InMemoryAccountRepository;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Main 서비스 전용 내부 계좌 요약 API 컨트롤러
 */
@RestController
public class InternalAccountController {

    private final InMemoryAccountRepository accountRepository;

    public InternalAccountController(InMemoryAccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    /**
     * 최종 사용자와 계좌 소유자 비교를 수행하는 정상 내부 계좌 요약 조회
     */
    @GetMapping("/internal/secured/accounts/{accountId}/summary")
    public ResponseEntity<?> getSecuredSummary(
            @PathVariable String accountId,
            @RequestHeader(value = "X-Authenticated-User", required = false) String userId) {
        if (userId == null || userId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        if (!account.getOwnerId().equals(userId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        return ResponseEntity.ok(toSummary(account));
    }

    /**
     * 최종 사용자와 계좌 소유자 비교를 생략하는 취약 내부 계좌 요약 조회
     */
    @GetMapping("/internal/accounts/{accountId}/summary")
    public ResponseEntity<?> getSummaryWithoutOwnerCheck(
            @PathVariable String accountId,
            @RequestHeader(value = "X-Authenticated-User", required = false) String userId) {
        /*
         * Scenario: V10 (counterpart: N10)
         * Rule: OBJECT_BINDING
         * Vulnerable: 내부 서비스 인증 후 최종 사용자와 계좌 Owner 비교 누락
         * Normal: 최종 사용자와 계좌 Owner 비교 후 불일치 403
         */
        if (userId == null || userId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(toSummary(account));
    }

    /**
     * 최종 사용자 식별정보 없이 레거시 계좌 요약 조회
     */
    @GetMapping("/internal/accounts/{accountId}/legacy-summary")
    public ResponseEntity<?> getLegacySummary(@PathVariable String accountId) {
        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(toSummary(account));
    }

    private Map<String, Object> toSummary(DemoAccount account) {
        return Map.of(
                "accountId", account.getAccountId(),
                "ownerId", account.getOwnerId(),
                "balance", account.getBalance());
    }
}
