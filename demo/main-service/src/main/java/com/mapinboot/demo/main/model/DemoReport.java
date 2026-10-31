package com.mapinboot.demo.main.model;

/**
 * 데모 업무 보고서 도메인 모델
 */
public class DemoReport {

    private final String reportId;
    private final String title;
    private final String summary;
    private final String visibility;

    public DemoReport(String reportId, String title, String summary, String visibility) {
        this.reportId = reportId;
        this.title = title;
        this.summary = summary;
        this.visibility = visibility;
    }

    public String getReportId() {
        return reportId;
    }

    public String getTitle() {
        return title;
    }

    public String getSummary() {
        return summary;
    }

    public String getVisibility() {
        return visibility;
    }
}

