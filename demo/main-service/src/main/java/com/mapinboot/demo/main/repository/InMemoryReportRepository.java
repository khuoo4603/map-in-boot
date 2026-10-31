package com.mapinboot.demo.main.repository;

import com.mapinboot.demo.main.model.DemoReport;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 업무 보고서 저장소
 */
@Repository
public class InMemoryReportRepository {

    private final Map<String, DemoReport> reportsById = new ConcurrentHashMap<>();

    /**
     * 초기 직원 보고서 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        reportsById.clear();

        save(new DemoReport(
                "REPORT001",
                "2026년 3분기 영업점 업무 실적 요약",
                "3분기 영업점 여수신 및 고객 상담 실적 종합 요약 보고서",
                "STAFF"));

        save(new DemoReport(
                "REPORT002",
                "영업점 담당 고객 상담 및 안내 가이드",
                "영업점 직원의 배정 고객 대상 금융상품 상담 기준 및 응대 매뉴얼",
                "STAFF"));

        save(new DemoReport(
                "REPORT003",
                "2026년 하반기 거시경제 및 금융시장 동향",
                "대고객 공개용 금융시장 금리 추이 및 경제 분석 리포트",
                "PUBLIC"));
    }

    /**
     * 보고서 저장
     */
    public void save(DemoReport report) {
        reportsById.put(report.getReportId(), report);
    }

    /**
     * 보고서 ID 기준 단건 조회
     */
    public Optional<DemoReport> findByReportId(String reportId) {
        return Optional.ofNullable(reportsById.get(reportId));
    }

    /**
     * 열람 권한(visibility) 기준 보고서 목록 조회
     */
    public List<DemoReport> findByVisibility(String visibility) {
        return reportsById.values().stream()
                .filter(report -> report.getVisibility().equals(visibility))
                .toList();
    }

    /**
     * 전체 보고서 목록 조회
     */
    public List<DemoReport> findAll() {
        return new ArrayList<>(reportsById.values());
    }
}

