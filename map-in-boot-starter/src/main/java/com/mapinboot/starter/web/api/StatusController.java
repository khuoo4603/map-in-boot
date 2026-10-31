package com.mapinboot.starter.web.api;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.bootstrap.MapInBootBootstrap;
import com.mapinboot.starter.web.access.WebAccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// 현재 실행 상태와 보존 Snapshot 메타데이터의 읽기 전용 조회 API
@RestController
@RequestMapping("/mapinboot/api")
@ConditionalOnProperty(prefix = "mapinboot", name = "enabled", havingValue = "true", matchIfMissing = true)
@ConditionalOnProperty(prefix = "mapinboot.web", name = "enabled", havingValue = "true")
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(name = "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping")
public class StatusController {
    private final MapInBootBootstrap bootstrap;
    private final MapInBootProperties properties;

    public StatusController(MapInBootBootstrap bootstrap, MapInBootProperties properties) {
        this.bootstrap = bootstrap;
        this.properties = properties;
    }

    @GetMapping("/status")
    public ResponseEntity<?> status(HttpServletRequest request) {
        HttpStatus denied = WebAccessGuard.deniedStatus(request, properties.getWeb().getRequiredRole());
        if (denied != null) {
            return ResponseEntity.status(denied).build();
        }
        return ResponseEntity.ok(StatusResponse.from(bootstrap));
    }

    public record StatusResponse(
            String phase,
            Map<String, AnalysisStatus> collectionStatuses,
            Map<String, AnalysisStatus> analysisStatuses,
            List<DiagnosticResponse> diagnostics,
            boolean persistedSnapshotPresent,
            String persistedSnapshotId,
            Instant persistedCapturedAt,
            String errorCode
    ) {
        static StatusResponse from(MapInBootBootstrap bootstrap) {
            CollectionReport collection = bootstrap.collectionReport();
            AnalysisReport analysis = bootstrap.analysisReport();
            Snapshot persisted = bootstrap.persistedSnapshot();
            List<DiagnosticResponse> diagnostics = new ArrayList<>();
            if (collection != null) {
                diagnostics.addAll(toDiagnostics(collection.diagnostics()));
            }
            if (analysis != null) {
                diagnostics.addAll(toDiagnostics(analysis.diagnostics()));
            }
            return new StatusResponse(
                    bootstrap.executionPhase(),
                    collection == null ? Map.of() : collection.statusByAdapter(),
                    analysis == null ? Map.of() : analysis.statusByAdapter(),
                    List.copyOf(diagnostics),
                    persisted != null,
                    persisted == null ? null : persisted.snapshotId(),
                    persisted == null ? null : persisted.capturedAt(),
                    bootstrap.failureCode());
        }

        private static List<DiagnosticResponse> toDiagnostics(List<AdapterDiagnostic> diagnostics) {
            return diagnostics.stream()
                    .filter(Objects::nonNull)
                    .map(diagnostic -> new DiagnosticResponse(
                            diagnostic.adapterId(),
                            diagnostic.errorCode() == null ? null : diagnostic.errorCode().getCode(),
                            diagnostic.errorCode() == null
                                    ? "Adapter 진단 설명 없음"
                                    : diagnostic.errorCode().getDescription()))
                    .toList();
        }
    }

    public record DiagnosticResponse(String adapterId, String errorCode, String summary) {
    }
}
