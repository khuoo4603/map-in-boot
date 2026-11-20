package com.mapinboot.core.snapshot;

import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record Snapshot(
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
        List<Evidence> evidence,
        List<Finding> findings,
        Map<String, AnalysisStatus> analysisStatus,
        Map<String, String> evidenceDisplayCodes
) {
    // 표시 코드가 없는 기존 호출부와의 소스 호환용 생성자
    public Snapshot(
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
            List<Evidence> evidence,
            List<Finding> findings,
            Map<String, AnalysisStatus> analysisStatus
    ) {
        this(snapshotId, capturedAt, schemaVersion, sdkVersion, serviceId, instanceId, applicationVersion,
                graphFingerprint, nodes, edges, evidence, findings, analysisStatus, Map.of());
    }

    public Snapshot {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
        evidence = List.copyOf(evidence);
        findings = List.copyOf(findings);
        analysisStatus = Map.copyOf(analysisStatus);
        // 구버전 Snapshot 필드 누락 허용 및 전달 Map 불변 복사
        evidenceDisplayCodes = evidenceDisplayCodes == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(evidenceDisplayCodes));
    }
}
