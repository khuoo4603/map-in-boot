package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.repository.InMemoryAccountRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 계좌 상세 조회 API 컨트롤러
 */
@RestController
public class AccountDetailController {

    private final InMemoryAccountRepository accountRepository;

    public AccountDetailController(InMemoryAccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    /**
     * JWT 주체와 계좌 소유자 비교를 수행하는 정상 계좌 상세 조회
     */
    @GetMapping("/api/secured/accounts/{accountId}")
    public ResponseEntity<?> getSecuredAccount(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        if (!account.getOwnerId().equals(jwt.getSubject())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        return ResponseEntity.ok(account);
    }

    /**
     * JWT 인증만 수행하는 취약 계좌 상세 조회
     */
    @GetMapping("/api/accounts/{accountId}")
    public ResponseEntity<?> getAccountWithoutOwnerCheck(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        /*
         * Scenario: V05 (counterpart: N05)
         * Rule: OBJECT_BINDING
         * JWT 인증 후 Account.ownerId 비교 생략
         */
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(account);
    }
}
