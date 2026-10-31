package com.mapinboot.demo.main.model;

import java.time.LocalDate;

/**
 * 데모 공지사항 도메인 모델
 */
public class DemoNotice {

    private final String noticeId;
    private final String title;
    private final LocalDate publishedAt;
    private final String body;

    public DemoNotice(String noticeId, String title, LocalDate publishedAt, String body) {
        this.noticeId = noticeId;
        this.title = title;
        this.publishedAt = publishedAt;
        this.body = body;
    }

    public String getNoticeId() {
        return noticeId;
    }

    public String getTitle() {
        return title;
    }

    public LocalDate getPublishedAt() {
        return publishedAt;
    }

    public String getBody() {
        return body;
    }
}

