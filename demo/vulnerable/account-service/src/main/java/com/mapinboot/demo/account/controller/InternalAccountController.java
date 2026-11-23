package com.mapinboot.demo.account.controller;

import com.mapinboot.core.annotation.RequiresObjectAuthorization;
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

    /** 최종 사용자와 계좌 소유자를 비교하는 내부 계좌 요약 조회 */
    @GetMapping("/internal/accounts/{accountId}/summary")
    @RequiresObjectAuthorization(
            kind = "OWNER", resourceType = DemoAccount.class, principalSource = "REQUEST_HEADER")
    public ResponseEntity<?> getSummary(
            @PathVariable String accountId,
            @RequestHeader(value = "X-Authenticated-User", required = false) String userId) {
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
