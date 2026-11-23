package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.repository.InMemoryAccountRepository;
import com.mapinboot.core.annotation.RequiresObjectAuthorization;
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

    /** JWT 주체와 계좌 소유자를 비교하는 계좌 상세 조회 */
    @GetMapping("/api/accounts/{accountId}")
    @RequiresObjectAuthorization(
            kind = "OWNER", resourceType = DemoAccount.class, principalSource = "JWT_SUBJECT")
    public ResponseEntity<?> getAccount(
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

}
