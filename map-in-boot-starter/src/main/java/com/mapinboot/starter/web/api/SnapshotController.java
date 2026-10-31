package com.mapinboot.starter.web.api;

import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.bootstrap.MapInBootBootstrap;
import com.mapinboot.starter.web.access.WebAccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 보존 Snapshot의 읽기 전용 조회 API
@RestController
@RequestMapping("/mapinboot/api")
@ConditionalOnProperty(prefix = "mapinboot", name = "enabled", havingValue = "true", matchIfMissing = true)
@ConditionalOnProperty(prefix = "mapinboot.web", name = "enabled", havingValue = "true")
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(name = "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping")
public class SnapshotController {
    private final MapInBootBootstrap bootstrap;
    private final MapInBootProperties properties;

    public SnapshotController(MapInBootBootstrap bootstrap, MapInBootProperties properties) {
        this.bootstrap = bootstrap;
        this.properties = properties;
    }

    @GetMapping("/snapshot")
    public ResponseEntity<?> snapshot(HttpServletRequest request) {
        HttpStatus denied = WebAccessGuard.deniedStatus(request, properties.getWeb().getRequiredRole());
        if (denied != null) {
            return ResponseEntity.status(denied).build();
        }
        Snapshot persisted = bootstrap.persistedSnapshot();
        return persisted == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(persisted);
    }
}
