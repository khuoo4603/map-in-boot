package com.mapinboot.demo.identity.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// Identity 개발 진단용 비밀번호 로그인 화면 제공
@RestController
@Profile("develop")
@ConditionalOnProperty(name = "mapinboot.web.enabled", havingValue = "true")
public final class DevelopmentLoginController {
    private static final String RESOURCE_PATH = "META-INF/mapinboot/development-login/";
    private static final MediaType TEXT_CSS = MediaType.parseMediaType("text/css;charset=UTF-8");
    private static final MediaType TEXT_JAVASCRIPT = MediaType.parseMediaType("text/javascript;charset=UTF-8");

    @GetMapping(value = "/mapinboot-login", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<Resource> loginPage() {
        return resource("development-login.html", MediaType.TEXT_HTML);
    }

    @GetMapping(value = "/mapinboot-login/assets/development-login.css", produces = "text/css")
    public ResponseEntity<Resource> stylesheet() {
        return resource("development-login.css", TEXT_CSS);
    }

    @GetMapping(value = "/mapinboot-login/assets/development-login.js", produces = "text/javascript")
    public ResponseEntity<Resource> script() {
        return resource("development-login.js", TEXT_JAVASCRIPT);
    }

    private ResponseEntity<Resource> resource(String name, MediaType contentType) {
        Resource resource = new ClassPathResource(RESOURCE_PATH + name);
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(contentType).body(resource);
    }
}
