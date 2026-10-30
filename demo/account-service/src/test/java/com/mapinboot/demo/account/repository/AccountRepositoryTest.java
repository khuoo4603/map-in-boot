package com.mapinboot.demo.account.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.mapinboot.demo.account.model.DemoAccount;
import com.mapinboot.demo.account.model.DemoAccountTransaction;
import com.mapinboot.demo.account.model.DemoCustomer;
import com.mapinboot.demo.account.model.DemoLoanApplication;
import com.mapinboot.demo.account.model.DemoLoanProduct;
import com.mapinboot.demo.account.model.DemoSavingsProduct;
import com.mapinboot.demo.account.model.DemoSavingsSubscription;
import com.mapinboot.demo.account.model.DemoStaffAssignment;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Account 저장소 및 도메인 Fixture 관계 검증 테스트
 */
class AccountRepositoryTest {

    @Test
    @DisplayName("고객 및 계좌 도메인 Fixture 관계 검증")
    void testCustomerAndAccountFixtures() {
        InMemoryCustomerRepository customerRepository = new InMemoryCustomerRepository();
        customerRepository.initFixtures();

        DemoCustomer custA = customerRepository.findByCustomerId("CUST001").orElseThrow();
        assertThat(custA.getUserId()).isEqualTo("USER001");
        assertThat(custA.getDisplayName()).isEqualTo("고객 A");

        DemoCustomer custB = customerRepository.findByUserId("USER002").orElseThrow();
        assertThat(custB.getCustomerId()).isEqualTo("CUST002");

        InMemoryAccountRepository accountRepository = new InMemoryAccountRepository();
        accountRepository.initFixtures();

        DemoAccount accA = accountRepository.findByAccountId("ACC001").orElseThrow();
        assertThat(accA.getOwnerId()).isEqualTo("USER001");
        assertThat(accA.getBalance()).isEqualByComparingTo(new BigDecimal("1250000"));

        DemoAccount accB = accountRepository.findByAccountId("ACC002").orElseThrow();
        assertThat(accB.getOwnerId()).isEqualTo("USER002");
        assertThat(accB.getBalance()).isEqualByComparingTo(new BigDecimal("2800000"));

        List<DemoAccount> user1Accounts = accountRepository.findByOwnerId("USER001");
        assertThat(user1Accounts).hasSize(1);
        assertThat(user1Accounts.get(0).getAccountId()).isEqualTo("ACC001");
    }

    @Test
    @DisplayName("직원 배정 및 계좌 거래내역 Fixture 검증")
    void testStaffAssignmentAndTransactions() {
        InMemoryStaffAssignmentRepository staffRepository = new InMemoryStaffAssignmentRepository();
        staffRepository.initFixtures();

        // STAFF001 -> CUST001, STAFF002 -> CUST002 배정 검증
        DemoStaffAssignment assign1 = staffRepository.findByStaffIdAndCustomerId("STAFF001", "CUST001").orElseThrow();
        assertThat(assign1.isAssigned()).isTrue();

        List<DemoStaffAssignment> staff1List = staffRepository.findByStaffId("STAFF001");
        assertThat(staff1List).hasSize(1);
        assertThat(staff1List.get(0).getCustomerId()).isEqualTo("CUST001");

        assertThat(staffRepository.findByStaffIdAndCustomerId("STAFF001", "CUST002")).isEmpty();

        InMemoryAccountTransactionRepository transactionRepository = new InMemoryAccountTransactionRepository();
        transactionRepository.initFixtures();

        // ACC001 거래내역 3건(TX001, TX002, TX003) 검증
        List<DemoAccountTransaction> txList = transactionRepository.findByAccountId("ACC001");
        assertThat(txList).hasSize(3);
        assertThat(txList).extracting(DemoAccountTransaction::getTransactionId)
                .containsExactlyInAnyOrder("TX001", "TX002", "TX003");
    }

    @Test
    @DisplayName("예적금 상품 및 가입 내역 Fixture 검증")
    void testSavingsProductAndSubscriptionFixtures() {
        InMemorySavingsProductRepository productRepository = new InMemorySavingsProductRepository();
        productRepository.initFixtures();

        assertThat(productRepository.findByActive(true)).hasSize(2);
        assertThat(productRepository.findByActive(false)).hasSize(1);

        DemoSavingsProduct closedProduct = productRepository.findByProductId("SAV-CLOSED").orElseThrow();
        assertThat(closedProduct.isActive()).isFalse();

        InMemorySavingsSubscriptionRepository subscriptionRepository = new InMemorySavingsSubscriptionRepository();
        subscriptionRepository.initFixtures();

        // SAV001(USER001 -> DEP-12M, 5,000,000) 검증
        DemoSavingsSubscription sub1 = subscriptionRepository.findBySubscriptionId("SAV001").orElseThrow();
        assertThat(sub1.getOwnerId()).isEqualTo("USER001");
        assertThat(sub1.getProductId()).isEqualTo("DEP-12M");
        assertThat(sub1.getPrincipal()).isEqualByComparingTo(new BigDecimal("5000000"));

        // SAV002(USER002 -> SAV-12M, 2,000,000) 검증
        DemoSavingsSubscription sub2 = subscriptionRepository.findBySubscriptionId("SAV002").orElseThrow();
        assertThat(sub2.getOwnerId()).isEqualTo("USER002");
        assertThat(sub2.getProductId()).isEqualTo("SAV-12M");
        assertThat(sub2.getPrincipal()).isEqualByComparingTo(new BigDecimal("2000000"));
    }

    @Test
    @DisplayName("대출 상품 및 기존 신청 Fixture 검증")
    void testLoanProductAndApplicationFixtures() {
        InMemoryLoanProductRepository productRepository = new InMemoryLoanProductRepository();
        productRepository.initFixtures();

        assertThat(productRepository.findByProductId("LOAN-BASIC")).isPresent();
        assertThat(productRepository.findByProductId("LOAN-HOUSE")).isPresent();

        InMemoryLoanApplicationRepository applicationRepository = new InMemoryLoanApplicationRepository();
        applicationRepository.initFixtures();

        // LNAPP001 (USER001, REVIEW), LNAPP002 (USER002, SUBMITTED) 검증
        DemoLoanApplication app1 = applicationRepository.findByApplicationId("LNAPP001").orElseThrow();
        assertThat(app1.getApplicantId()).isEqualTo("USER001");
        assertThat(app1.getStatus()).isEqualTo("REVIEW");
        assertThat(app1.getProductId()).isEqualTo("LOAN-BASIC");

        DemoLoanApplication app2 = applicationRepository.findByApplicationId("LNAPP002").orElseThrow();
        assertThat(app2.getApplicantId()).isEqualTo("USER002");
        assertThat(app2.getStatus()).isEqualTo("SUBMITTED");
        assertThat(app2.getProductId()).isEqualTo("LOAN-HOUSE");
    }
}

