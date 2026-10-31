package com.mapinboot.starter.snapshot;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.GraphFingerprintGenerator;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import java.time.Instant;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

// AnalysisReport 기반 Graph·Finding·Snapshot 조립
public class SnapshotAssembler {
    private static final String SDK_VERSION_RESOURCE = "META-INF/map-in-boot-version.properties";
    private final GraphBuilder graphBuilder = new GraphBuilder();
    private final GraphFingerprintGenerator fingerprintGenerator = new GraphFingerprintGenerator();
    private final List<FindingEvaluator> findingEvaluators;
    private final String schemaVersion;
    private final String sdkVersion;

    public SnapshotAssembler(List<FindingEvaluator> findingEvaluators, String schemaVersion) {
        this(findingEvaluators, schemaVersion, loadSdkVersion());
    }

    SnapshotAssembler(List<FindingEvaluator> findingEvaluators, String schemaVersion, String sdkVersion) {
        if (findingEvaluators == null || schemaVersion == null || schemaVersion.isBlank()
                || sdkVersion == null || sdkVersion.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Snapshot 조립 설정이 올바르지 않습니다.");
        }
        this.findingEvaluators = List.copyOf(findingEvaluators);
        this.schemaVersion = schemaVersion;
        this.sdkVersion = sdkVersion;
    }

    public Snapshot assemble(AnalysisReport report, String serviceId, String instanceId, String applicationVersion) {
        if (report == null || report.collectionReport() == null || isBlank(serviceId) || isBlank(instanceId)) {
            throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot 조립 입력이 올바르지 않습니다.");
        }
        if (findingEvaluators.size() > 1) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "FindingEvaluator가 중복 등록되었습니다.");
        }

        SecurityGraph graph = graphBuilder.build(serviceId, report);
        String graphFingerprint = fingerprintGenerator.generate(graph);
        List<Finding> findings = evaluateFindings(report);
        Map<String, AnalysisStatus> analysisStatus = mergeStatuses(report.collectionReport(), report);
        validateSnapshotContents(graph, report.evidence(), findings, analysisStatus);

        Snapshot snapshot = new Snapshot(
                UUID.randomUUID().toString(),
                Instant.now(),
                schemaVersion,
                sdkVersion,
                serviceId,
                instanceId,
                isBlank(applicationVersion) ? "UNKNOWN" : applicationVersion,
                graphFingerprint,
                graph.nodes(),
                graph.edges(),
                report.evidence(),
                findings,
                analysisStatus);
        validateSnapshot(snapshot);
        return snapshot;
    }

    static void validateSnapshot(Snapshot snapshot) {
        if (snapshot == null || isBlank(snapshot.snapshotId()) || snapshot.capturedAt() == null
                || isBlank(snapshot.schemaVersion()) || isBlank(snapshot.sdkVersion())
                || isBlank(snapshot.serviceId()) || isBlank(snapshot.instanceId())
                || isBlank(snapshot.applicationVersion()) || isBlank(snapshot.graphFingerprint())) {
            invalidSnapshot("Snapshot 필수 필드가 없습니다.");
        }
        SecurityGraph graph = new SecurityGraph(snapshot.nodes(), snapshot.edges());
        for (GraphNode node : graph.nodes()) {
            if (!snapshot.serviceId().equals(node.serviceId())) {
                invalidSnapshot("Snapshot serviceId와 Graph Node serviceId가 일치하지 않습니다.");
            }
        }
        validateSnapshotContents(graph, snapshot.evidence(), snapshot.findings(), snapshot.analysisStatus());
        if (!snapshot.graphFingerprint().equals(new GraphFingerprintGenerator().generate(graph))) {
            invalidSnapshot("Snapshot Graph Fingerprint가 일치하지 않습니다.");
        }
    }

    private List<Finding> evaluateFindings(AnalysisReport report) {
        if (findingEvaluators.isEmpty()) {
            return List.of();
        }
        try {
            List<Finding> findings = findingEvaluators.get(0).evaluate(report);
            if (findings == null || findings.stream().anyMatch(finding -> finding == null)) {
                throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Finding 결과가 올바르지 않습니다.");
            }
            return List.copyOf(findings);
        } catch (MapInBootException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new MapInBootException(ErrorCode.ADAPTER_FAILED, "Finding 평가에 실패했습니다.", exception);
        }
    }

    private Map<String, AnalysisStatus> mergeStatuses(CollectionReport collectionReport, AnalysisReport analysisReport) {
        Map<String, AnalysisStatus> statuses = new LinkedHashMap<>();
        addStatuses(statuses, collectionReport.statusByAdapter());
        addStatuses(statuses, analysisReport.statusByAdapter());
        return statuses;
    }

    private void addStatuses(Map<String, AnalysisStatus> target, Map<String, AnalysisStatus> source) {
        for (Map.Entry<String, AnalysisStatus> entry : source.entrySet()) {
            if (isBlank(entry.getKey()) || entry.getValue() == null || target.putIfAbsent(entry.getKey(), entry.getValue()) != null) {
                throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, "Snapshot Adapter 상태가 중복되거나 올바르지 않습니다.");
            }
        }
    }

    static void validateSnapshotContents(
            SecurityGraph graph, List<Evidence> evidence, List<Finding> findings,
            Map<String, AnalysisStatus> analysisStatus) {
        Set<String> nodeIds = new HashSet<>();
        for (GraphNode node : graph.nodes()) {
            if (node == null || isBlank(node.id()) || isBlank(node.label()) || !nodeIds.add(node.id())) {
                invalidSnapshot("Graph Node ID 또는 label이 올바르지 않습니다.");
            }
        }
        Set<String> edgeIds = new HashSet<>();
        for (GraphEdge edge : graph.edges()) {
            if (edge == null || isBlank(edge.id()) || !edgeIds.add(edge.id())
                    || !nodeIds.contains(edge.sourceId()) || !nodeIds.contains(edge.targetId())
                    || edge.confidence() == null) {
                invalidSnapshot("Graph Edge 참조 또는 confidence가 올바르지 않습니다.");
            }
        }
        Set<String> evidenceIds = new HashSet<>();
        for (Evidence item : evidence) {
            if (item == null || isBlank(item.id()) || item.source() == null || isBlank(item.location())
                    || isBlank(item.summary()) || !evidenceIds.add(item.id())) {
                invalidSnapshot("Snapshot Evidence ID가 중복되거나 올바르지 않습니다.");
            }
        }
        for (GraphNode node : graph.nodes()) {
            if (node.evidenceIds().stream().anyMatch(id -> !evidenceIds.contains(id))) {
                invalidSnapshot("Graph Node Evidence 참조가 올바르지 않습니다.");
            }
        }
        for (GraphEdge edge : graph.edges()) {
            if (edge.evidenceIds().stream().anyMatch(id -> !evidenceIds.contains(id))) {
                invalidSnapshot("Graph Edge Evidence 참조가 올바르지 않습니다.");
            }
        }
        Set<String> findingIds = new HashSet<>();
        for (Finding finding : findings) {
            if (finding == null || isBlank(finding.id()) || isBlank(finding.ruleId())
                    || isBlank(finding.title()) || isBlank(finding.description()) || finding.confidence() == null
                    || isBlank(finding.guide()) || !findingIds.add(finding.id())
                    || finding.nodeIds().stream().anyMatch(id -> !nodeIds.contains(id))
                    || finding.edgeIds().stream().anyMatch(id -> !edgeIds.contains(id))
                    || finding.evidenceIds().stream().anyMatch(id -> !evidenceIds.contains(id))) {
                invalidSnapshot("Finding 참조가 Snapshot 객체를 가리키지 않습니다.");
            }
        }
        for (Map.Entry<String, AnalysisStatus> entry : analysisStatus.entrySet()) {
            if (isBlank(entry.getKey()) || entry.getValue() == null) {
                invalidSnapshot("Snapshot 분석 상태가 올바르지 않습니다.");
            }
        }
    }

    private static void invalidSnapshot(String message) {
        throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, message);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String loadSdkVersion() {
        try (InputStream input = SnapshotAssembler.class.getClassLoader().getResourceAsStream(SDK_VERSION_RESOURCE)) {
            if (input == null) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "SDK 버전 메타데이터가 없습니다.");
            }
            Properties properties = new Properties();
            properties.load(input);
            String version = properties.getProperty("sdk.version");
            if (isBlank(version)) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "SDK 버전 메타데이터가 올바르지 않습니다.");
            }
            return version;
        } catch (IOException exception) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "SDK 버전 메타데이터를 읽지 못했습니다.", exception);
        }
    }
}
