package com.mapinboot.starter.web.ui;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.starter.bootstrap.MapInBootBootstrap;
import com.mapinboot.starter.web.api.StatusController;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
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
    private static final String RESOURCE_PATH = "META-INF/mapinboot/development-diagnostic/";
    private static final MediaType TEXT_CSS = MediaType.parseMediaType("text/css");
    private static final MediaType TEXT_JAVASCRIPT = MediaType.parseMediaType("text/javascript");

    private final MapInBootBootstrap bootstrap;

    public DevelopmentDiagnosticController(MapInBootBootstrap bootstrap) {
        this.bootstrap = bootstrap;
    }

    @GetMapping(value = "/test", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<Resource> test() {
        return resource("development-diagnostic.html", MediaType.TEXT_HTML);
    }

    @GetMapping(value = "/test/assets/development-diagnostic.css", produces = "text/css")
    public ResponseEntity<Resource> stylesheet() {
        return resource("development-diagnostic.css", TEXT_CSS);
    }

    @GetMapping(value = "/test/assets/development-diagnostic.js", produces = "text/javascript")
    public ResponseEntity<Resource> script() {
        return resource("development-diagnostic.js", TEXT_JAVASCRIPT);
    }

    // 현재 수집·분석 결과의 읽기 전용 조회
    @GetMapping(value = "/test/api/report", produces = MediaType.APPLICATION_JSON_VALUE)
    public DevelopmentDiagnosticReport report() {
        return DevelopmentDiagnosticReport.from(bootstrap);
    }

    private ResponseEntity<Resource> resource(String name, MediaType contentType) {
        Resource resource = new ClassPathResource(RESOURCE_PATH + name);
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok().contentType(contentType).body(resource);
    }

    public record DevelopmentDiagnosticReport(
            String phase,
            String errorCode,
            boolean collectionPresent,
            Map<String, AnalysisStatus> collectionStatuses,
            List<Fact> facts,
            boolean analysisPresent,
            Map<String, AnalysisStatus> analysisStatuses,
            List<Relation> relations,
            List<Evidence> evidence,
            List<StatusController.DiagnosticResponse> diagnostics,
            boolean currentSnapshotPresent,
            CurrentSnapshotResponse currentSnapshot,
            boolean persistedSnapshotPresent,
            PersistedSnapshotResponse persistedSnapshot
    ) {
        static DevelopmentDiagnosticReport from(MapInBootBootstrap bootstrap) {
            CollectionReport collection = bootstrap.collectionReport();
            AnalysisReport analysis = bootstrap.analysisReport();
            Snapshot current = bootstrap.snapshot();
            Snapshot persisted = bootstrap.persistedSnapshot();
            return new DevelopmentDiagnosticReport(
                    bootstrap.executionPhase(),
                    bootstrap.failureCode(),
                    collection != null,
                    collection == null ? Map.of() : collection.statusByAdapter(),
                    collection == null ? List.of() : collection.facts(),
                    analysis != null,
                    analysis == null ? Map.of() : analysis.statusByAdapter(),
                    analysis == null ? List.of() : analysis.relations(),
                    evidence(collection, analysis),
                    diagnostics(collection, analysis),
                    current != null,
                    current == null ? null : CurrentSnapshotResponse.from(current),
                    persisted != null,
                    persisted == null ? null : PersistedSnapshotResponse.from(persisted));
        }

        private static List<Evidence> evidence(CollectionReport collection, AnalysisReport analysis) {
            Map<String, Evidence> evidenceById = new LinkedHashMap<>();
            if (collection != null) {
                addEvidence(evidenceById, collection.evidence());
            }
            if (analysis != null) {
                addEvidence(evidenceById, analysis.evidence());
            }
            return List.copyOf(evidenceById.values());
        }

        private static void addEvidence(Map<String, Evidence> evidenceById, List<Evidence> evidence) {
            for (Evidence item : evidence) {
                if (item != null) {
                    evidenceById.putIfAbsent(item.id(), item);
                }
            }
        }

        private static List<StatusController.DiagnosticResponse> diagnostics(
                CollectionReport collection,
                AnalysisReport analysis
        ) {
            List<AdapterDiagnostic> diagnostics = new ArrayList<>();
            if (collection != null) {
                diagnostics.addAll(collection.diagnostics());
            }
            if (analysis != null) {
                diagnostics.addAll(analysis.diagnostics());
            }
            return StatusController.StatusResponse.toDiagnostics(diagnostics);
        }
    }

    public record CurrentSnapshotResponse(
            String snapshotId,
            Instant capturedAt,
            String schemaVersion,
            String sdkVersion,
            String serviceId,
            String instanceId,
            String applicationVersion,
            String graphFingerprint,
            List<GraphNode> nodes,
            List<GraphEdge> edges,
            List<Finding> findings,
            Map<String, AnalysisStatus> analysisStatus
    ) {
        private static CurrentSnapshotResponse from(Snapshot snapshot) {
            return new CurrentSnapshotResponse(
                    snapshot.snapshotId(),
                    snapshot.capturedAt(),
                    snapshot.schemaVersion(),
                    snapshot.sdkVersion(),
                    snapshot.serviceId(),
                    snapshot.instanceId(),
                    snapshot.applicationVersion(),
                    snapshot.graphFingerprint(),
                    snapshot.nodes(),
                    snapshot.edges(),
                    snapshot.findings(),
                    snapshot.analysisStatus());
        }
    }

    public record PersistedSnapshotResponse(String snapshotId, Instant capturedAt, String graphFingerprint) {
        private static PersistedSnapshotResponse from(Snapshot snapshot) {
            return new PersistedSnapshotResponse(
                    snapshot.snapshotId(),
                    snapshot.capturedAt(),
                    snapshot.graphFingerprint());
        }
    }
}
