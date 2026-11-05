package com.mapinboot.starter.web.ui;

import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 개발 전용 SDK 진단 화면 진입점
@RestController
@Profile("develop")
@RequestMapping("/mapinboot")
public final class DevelopmentDiagnosticController {

    @GetMapping(value = "/test", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> test() {
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .body("""
                        <!doctype html>
                        <html lang="ko">
                        <head><meta charset="UTF-8"><title>Map in Boot Development Diagnostics</title></head>
                        <body>
                        <h1>Map in Boot Development Diagnostics</h1>
                        <p>SDK 개발 전용 진단 화면</p>
                        </body>
                        </html>
                        """);
    }
}
