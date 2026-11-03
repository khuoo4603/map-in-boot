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

    /**
     * Account 정상 내부 경로로 계좌 요약 요청
     */
    @GetMapping("/api/portal/secured/accounts/{accountId}/summary")
    public ResponseEntity<?> getSecuredSummary(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return accountInternalClient.getSummary(
                "/internal/secured/accounts/" + accountId + "/summary", jwt.getSubject());
    }

    /**
     * Account 취약 내부 경로로 계좌 요약 요청
     */
    @GetMapping("/api/portal/accounts/{accountId}/summary")
    public ResponseEntity<?> getSummaryWithoutOwnerCheck(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return accountInternalClient.getSummary(
                "/internal/accounts/" + accountId + "/summary", jwt.getSubject());
    }
}
