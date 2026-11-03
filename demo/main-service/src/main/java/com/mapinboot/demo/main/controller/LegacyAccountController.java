package com.mapinboot.demo.main.controller;

import com.mapinboot.demo.main.client.AccountInternalClient;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 레거시 계좌 요약 진입 API 컨트롤러
 */
@RestController
public class LegacyAccountController {

    private final AccountInternalClient accountInternalClient;

    public LegacyAccountController(AccountInternalClient accountInternalClient) {
        this.accountInternalClient = accountInternalClient;
    }

    /**
     * SecurityFilterChain 적용 레거시 계좌 요약 조회
     */
    @GetMapping("/api/secured/legacy/account-summary/{accountId}")
    public ResponseEntity<?> getSecuredSummary(@PathVariable String accountId) {
        return accountInternalClient.getLegacySummary(
                "/internal/accounts/" + accountId + "/legacy-summary");
    }

    /**
     * SecurityFilterChain 미적용 레거시 계좌 요약 조회
     */
    @GetMapping("/api/legacy/account-summary/{accountId}")
    public ResponseEntity<?> getSummaryWithoutSecurity(@PathVariable String accountId) {
        return accountInternalClient.getLegacySummary(
                "/internal/accounts/" + accountId + "/legacy-summary");
    }
}
