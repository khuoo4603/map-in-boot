package com.mapinboot.core.snapshot;

import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import java.time.Instant;
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
        Map<String, AnalysisStatus> analysisStatus
) {
    public Snapshot {
        nodes = List.copyOf(nodes);
        edges = List.copyOf(edges);
        evidence = List.copyOf(evidence);
        findings = List.copyOf(findings);
        analysisStatus = Map.copyOf(analysisStatus);
    }
}
