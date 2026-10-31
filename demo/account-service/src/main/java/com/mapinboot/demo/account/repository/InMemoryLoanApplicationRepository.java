package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoLoanApplication;
import jakarta.annotation.PostConstruct;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 대출 신청 저장소
 */
@Repository
public class InMemoryLoanApplicationRepository {

    private final Map<String, DemoLoanApplication> applicationsById = new ConcurrentHashMap<>();

    /**
     * 초기 대출 신청 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        applicationsById.clear();

        save(new DemoLoanApplication(
                "LNAPP001",
                "USER001",
                "LOAN-BASIC",
                new BigDecimal("20000000"),
                "REVIEW",
                LocalDateTime.of(2026, 10, 15, 10, 0, 0)));

        save(new DemoLoanApplication(
                "LNAPP002",
                "USER002",
                "LOAN-HOUSE",
                new BigDecimal("100000000"),
                "SUBMITTED",
                LocalDateTime.of(2026, 10, 20, 14, 30, 0)));
    }

    /**
     * 대출 신청 정보 저장
     */
    public void save(DemoLoanApplication application) {
        applicationsById.put(application.getApplicationId(), application);
    }

    /**
     * 신청 식별자 기준 단건 조회
     */
    public Optional<DemoLoanApplication> findByApplicationId(String applicationId) {
        return Optional.ofNullable(applicationsById.get(applicationId));
    }

    /**
     * 신청자 ID(userId) 기준 대출 신청 목록 조회
     */
    public List<DemoLoanApplication> findByApplicantId(String applicantId) {
        return applicationsById.values().stream()
                .filter(application -> application.getApplicantId().equals(applicantId))
                .toList();
    }

    /**
     * 전체 대출 신청 목록 조회
     */
    public List<DemoLoanApplication> findAll() {
        return new ArrayList<>(applicationsById.values());
    }
}

