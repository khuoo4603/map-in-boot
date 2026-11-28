package com.mapinboot.demo.main.controller;

import com.mapinboot.demo.main.model.DemoNotice;
import com.mapinboot.demo.main.repository.InMemoryNoticeRepository;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공개 공지사항 조회 API 컨트롤러
 */
@RestController
@RequestMapping("/api/public/notices")
public class NoticeController {

    private final InMemoryNoticeRepository noticeRepository;

    public NoticeController(InMemoryNoticeRepository noticeRepository) {
        this.noticeRepository = noticeRepository;
    }

    /**
     * 공개 공지사항 목록 조회
     */
    @GetMapping
    public List<DemoNotice> getNotices() {
        return noticeRepository.findAll();
    }
}
