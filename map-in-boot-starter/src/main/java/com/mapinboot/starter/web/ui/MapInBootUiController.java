package com.mapinboot.starter.web.ui;

import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.autoconfigure.WebAuthMode;
import com.mapinboot.starter.web.auth.SdkLoginService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 정식 SDK 화면 진입 자원 제공
@RestController
@RequestMapping("/mapinboot")
public final class MapInBootUiController {
    private static final String INDEX_RESOURCE = "static/mapinboot/index.html";
    private static final String LOGIN_RESOURCE = "static/mapinboot/login.html";
    private static final String LOGIN_STYLE_RESOURCE = "static/mapinboot/login.css";
    private static final String LOGIN_SCRIPT_RESOURCE = "static/mapinboot/login.js";
    private final MapInBootProperties properties;

    public MapInBootUiController(MapInBootProperties properties) {
        this.properties = properties;
    }

    @GetMapping(value = "/login.css", produces = "text/css")
    public ResponseEntity<Resource> loginStyle() {
        return resource(LOGIN_STYLE_RESOURCE, MediaType.valueOf("text/css"));
    }

    @GetMapping(value = "/login.js", produces = "text/javascript")
    public ResponseEntity<Resource> loginScript() {
        return resource(LOGIN_SCRIPT_RESOURCE, MediaType.valueOf("text/javascript"));
    }

    @GetMapping(value = {"", "/", "/index.html"}, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<Resource> index(HttpServletRequest request) {
        boolean passwordLogin = properties.getWeb().getAuthMode() == WebAuthMode.PASSWORD
                && !SdkLoginService.hasAuthenticatedSession(request);
        return resource(passwordLogin ? LOGIN_RESOURCE : INDEX_RESOURCE, MediaType.TEXT_HTML);
    }

    private ResponseEntity<Resource> resource(String path, MediaType mediaType) {
        Resource resource = new ClassPathResource(path);
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(mediaType).body(resource);
    }
}
