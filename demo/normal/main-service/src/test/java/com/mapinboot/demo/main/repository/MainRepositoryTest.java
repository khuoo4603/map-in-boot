package com.mapinboot.demo.main.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.mapinboot.demo.main.model.DemoNotice;
import com.mapinboot.demo.main.model.DemoReport;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Main 저장소 및 공지·보고서 Fixture 검증 테스트
 */
class MainRepositoryTest {

    @Test
    @DisplayName("공개 공지사항 Fixture 검증")
    void testNoticeFixtures() {
        InMemoryNoticeRepository noticeRepository = new InMemoryNoticeRepository();
        noticeRepository.initFixtures();

        List<DemoNotice> notices = noticeRepository.findAll();
        assertThat(notices).hasSizeGreaterThanOrEqualTo(3);

        DemoNotice notice1 = noticeRepository.findByNoticeId("NOTICE001").orElseThrow();
        assertThat(notice1.getTitle()).contains("정기예금 금리 안내");
        assertThat(notice1.getPublishedAt()).isNotNull();
    }

    @Test
    @DisplayName("업무 보고서 및 열람 권한 구분 Fixture 검증")
    void testReportFixtures() {
        InMemoryReportRepository reportRepository = new InMemoryReportRepository();
        reportRepository.initFixtures();

        List<DemoReport> staffReports = reportRepository.findByVisibility("STAFF");
        assertThat(staffReports).hasSizeGreaterThanOrEqualTo(2);
        assertThat(staffReports).extracting(DemoReport::getReportId)
                .contains("REPORT001", "REPORT002");

        List<DemoReport> publicReports = reportRepository.findByVisibility("PUBLIC");
        assertThat(publicReports).hasSizeGreaterThanOrEqualTo(1);
        assertThat(publicReports).extracting(DemoReport::getReportId)
                .contains("REPORT003");
    }
}

