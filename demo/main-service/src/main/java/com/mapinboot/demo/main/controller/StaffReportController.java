package com.mapinboot.demo.main.controller;

import com.mapinboot.demo.main.model.DemoReport;
import com.mapinboot.demo.main.repository.InMemoryReportRepository;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 직원 보고서 조회 API 컨트롤러
 */
@RestController
public class StaffReportController {

    private final InMemoryReportRepository reportRepository;

    public StaffReportController(InMemoryReportRepository reportRepository) {
        this.reportRepository = reportRepository;
    }

    /**
     * ROLE_STAFF 보호 직원 보고서 조회
     */
    @GetMapping("/api/staff/protected/reports/summary")
    public ResponseEntity<List<DemoReport>> getProtectedSummary() {
        return ResponseEntity.ok(reportRepository.findByVisibility("STAFF"));
    }

    /**
     * 선행 약한 Chain이 선택되는 취약 직원 보고서 조회
     */
    @GetMapping("/api/staff/reports/summary")
    public ResponseEntity<List<DemoReport>> getSummaryWithoutChainProtection() {
        return ResponseEntity.ok(reportRepository.findByVisibility("STAFF"));
    }
}
