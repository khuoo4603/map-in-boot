package com.mapinboot.demo.main.repository;

import com.mapinboot.demo.main.model.DemoNotice;
import jakarta.annotation.PostConstruct;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 공지사항 저장소
 */
@Repository
public class InMemoryNoticeRepository {

    private final Map<String, DemoNotice> noticesById = new ConcurrentHashMap<>();

    /**
     * 초기 공개 공지사항 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        noticesById.clear();

        save(new DemoNotice(
                "NOTICE001",
                "2026년 정기예금 금리 안내",
                LocalDate.of(2026, 10, 1),
                "2026년 정기예금 기본 및 우대금리 변경 안내 본문"));

        save(new DemoNotice(
                "NOTICE002",
                "시스템 정기 점검 작업 안내",
                LocalDate.of(2026, 10, 15),
                "안정적인 전자금융 서비스 제공을 위한 전산 시스템 정기 점검 안내 본문"));

        save(new DemoNotice(
                "NOTICE003",
                "비대면 금융거래 본인확인 절차 강화 안내",
                LocalDate.of(2026, 10, 25),
                "전자금융거래 안전성 확보를 위한 추가 본인인증 절차 안내 본문"));
    }

    /**
     * 공지사항 저장
     */
    public void save(DemoNotice notice) {
        noticesById.put(notice.getNoticeId(), notice);
    }

    /**
     * 공지 ID 기준 단건 조회
     */
    public Optional<DemoNotice> findByNoticeId(String noticeId) {
        return Optional.ofNullable(noticesById.get(noticeId));
    }

    /**
     * 전체 공지사항 목록 조회
     */
    public List<DemoNotice> findAll() {
        return new ArrayList<>(noticesById.values());
    }
}

