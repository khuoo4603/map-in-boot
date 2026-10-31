package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.repository.InMemoryAccountRepository;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 로그인 고객 본인 계좌 조회 API 컨트롤러
 */
@RestController
@RequestMapping("/api/my")
public class MyAccountController {

    private final InMemoryAccountRepository accountRepository;

    public MyAccountController(InMemoryAccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    /**
     * 현재 인증된 고객 본인의 계좌 목록 조회
     */
    @GetMapping("/accounts")
    public ResponseEntity<List<DemoAccount>> getMyAccounts(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String userId = jwt.getSubject();
        List<DemoAccount> accounts = accountRepository.findByOwnerId(userId);
        return ResponseEntity.ok(accounts);
    }
}

