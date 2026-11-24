package com.mapinboot.demo.main.controller;

import com.mapinboot.demo.main.client.AccountInternalClient;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 고객 JWT 기반 내부 계좌 요약 진입 API 컨트롤러
 */
@RestController
public class PortalAccountController {

    private final AccountInternalClient accountInternalClient;

    public PortalAccountController(AccountInternalClient accountInternalClient) {
        this.accountInternalClient = accountInternalClient;
    }

    /** JWT 주체를 전달해 Account에서 최종 소유자를 확인하는 계좌 요약 조회 */
    @GetMapping("/api/portal/accounts/{accountId}/summary")
    public ResponseEntity<?> getSummary(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return accountInternalClient.getSummary(
                "/internal/accounts/" + accountId + "/summary", jwt.getSubject());
    }
}
