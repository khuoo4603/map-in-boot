package com.mapinboot.demo.account.controller;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.model.DemoAccountTransaction;
import com.mapinboot.demo.account.repository.InMemoryAccountRepository;
import com.mapinboot.demo.account.repository.InMemoryAccountTransactionRepository;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 로그인 고객 본인 계좌 조회 API 컨트롤러
 */
@RestController
@RequestMapping("/api/my")
public class MyAccountController {

    private final InMemoryAccountRepository accountRepository;
    private final InMemoryAccountTransactionRepository transactionRepository;

    public MyAccountController(
            InMemoryAccountRepository accountRepository,
            InMemoryAccountTransactionRepository transactionRepository) {
        this.accountRepository = accountRepository;
        this.transactionRepository = transactionRepository;
    }

    /**
     * 현재 인증된 고객 본인의 계좌 목록 조회
     */
    @GetMapping("/accounts")
    public ResponseEntity<List<MyAccountResponse>> getMyAccounts(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String userId = jwt.getSubject();
        List<DemoAccount> accounts = accountRepository.findByOwnerId(userId);
        return ResponseEntity.ok(accounts.stream().map(MyAccountResponse::from).toList());
    }

    /**
     * 현재 인증된 고객의 본인 계좌 거래내역 조회
     */
    @GetMapping("/accounts/{accountId}/transactions")
    public ResponseEntity<List<DemoAccountTransaction>> getMyTransactions(
            @PathVariable String accountId,
            @AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoAccount account = accountRepository.findByAccountId(accountId).orElse(null);
        if (account == null) {
            return ResponseEntity.notFound().build();
        }

        // 계좌 소유권 확인 후 거래내역 조회
        if (!account.getOwnerId().equals(jwt.getSubject())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        return ResponseEntity.ok(transactionRepository.findByAccountId(accountId));
    }

    /**
     * 고객 계좌 목록의 화면 표시용 응답
     */
    private record MyAccountResponse(
            String accountId,
            String accountNumber,
            String ownerId,
            String accountType,
            BigDecimal balance,
            String status) {

        private static MyAccountResponse from(DemoAccount account) {
            return new MyAccountResponse(
                    account.getAccountId(),
                    account.getAccountNumber(),
                    account.getOwnerId(),
                    account.getAccountType(),
                    account.getBalance(),
                    account.getStatus());
        }
    }
}

