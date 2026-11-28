package com.mapinboot.starter.snapshot;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.core.graph.StableIdGenerator;
import com.mapinboot.core.graph.GraphFingerprintGenerator;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import java.io.InputStream;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SnapshotJsonCodecTest {

    @Test
    void assemblerPersistsDisplayCodesForFinalEvidence() {
        Snapshot snapshot = new SnapshotAssembler(List.of(), sdkVersion())
                .assemble(report(), "service", "instance", "1.2.3", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        String encoded = new SnapshotJsonCodec().encode(snapshot);

        assertTrue(encoded.contains("\"evidenceDisplayCodes\":{\"evidence-1\":\"EP-MAPPING-001\"}"));
    }

    @Test
    void codecRejectsNewSnapshotWithoutDisplayCodeMapping() {
        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(withoutDisplayCodes(validSnapshot())));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void codecRejectsDuplicateDisplayCodesForDifferentEvidence() {
        Snapshot source = validSnapshot();
        Evidence second = new Evidence("evidence-2", EvidenceSource.RUNTIME, "runtime-2", "Handler");
        Snapshot invalid = new Snapshot(source.snapshotId(), source.capturedAt(), source.schemaVersion(),
                source.sdkVersion(), source.serviceId(), source.instanceId(), source.applicationVersion(),
                source.graphFingerprint(), source.nodes(), source.edges(), List.of(source.evidence().get(0), second),
                source.findings(), source.analysisStatus(),
                Map.of("evidence-1", "EP-MAPPING-001", second.id(), "EP-MAPPING-001"), source.runtimeArchitecture());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(invalid));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void codecRejectsMissingUnknownNullBlankAndMalformedDisplayCodeEntries() {
        Snapshot source = validSnapshot();
        Map<String, String> nullKey = new LinkedHashMap<>();
        nullKey.put(null, "EP-MAPPING-001");
        Map<String, String> nullValue = new LinkedHashMap<>();
        nullValue.put("evidence-1", null);
        List<Map<String, String>> invalidMaps = List.of(
                Map.of(),
                Map.of("unknown-evidence", "EP-MAPPING-001"),
                Map.of("evidence-1", " "),
                Map.of("evidence-1", "E-001"),
                nullKey,
                nullValue);

        for (Map<String, String> invalidMap : invalidMaps) {
            MapInBootException exception = assertThrows(MapInBootException.class,
                    () -> new SnapshotJsonCodec().encode(withDisplayCodes(source, invalidMap)));
            assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
        }

        MapInBootException nullMapException = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(withDisplayCodes(source, null)));
        assertEquals(ErrorCode.INVALID_SNAPSHOT, nullMapException.getErrorCode());
    }

    @Test
    void snapshotCopiesEvidenceDisplayCodesImmutably() {
        Snapshot source = validSnapshot();
        Map<String, String> mutableCodes = new LinkedHashMap<>(source.evidenceDisplayCodes());
        Snapshot snapshot = withDisplayCodes(source, mutableCodes);
        mutableCodes.put("other-evidence", "EP-MAPPING-002");

        assertEquals(source.evidenceDisplayCodes(), snapshot.evidenceDisplayCodes());
        assertThrows(UnsupportedOperationException.class,
                () -> snapshot.evidenceDisplayCodes().put("other-evidence", "EP-MAPPING-002"));
    }

    @Test
    void assemblerUsesGradleVersionMetadataForSdkVersion() throws Exception {
        Properties metadata = new Properties();
        try (InputStream input = getClass().getClassLoader()
                .getResourceAsStream("META-INF/map-in-boot-version.properties")) {
            assertNotNull(input);
            metadata.load(input);
        }

        Snapshot snapshot = new SnapshotAssembler(List.of(), sdkVersion())
                .assemble(report(), "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        String projectVersion = System.getProperty("mapinboot.project.version");
        assertNotNull(projectVersion);
        assertEquals(projectVersion, metadata.getProperty("sdk.version"));
        assertEquals(projectVersion, snapshot.sdkVersion());
    }

    @Test
    void assemblerBuildsGraphFingerprintFindingsAndStatuses() {
        AnalysisReport report = report();
        Finding finding = finding();
        SnapshotAssembler assembler = new SnapshotAssembler(
                List.of(ignored -> List.of(finding)), sdkVersion());

        Snapshot snapshot = assembler.assemble(report, "service", "instance", "1.2.3", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        assertNotNull(snapshot.snapshotId());
        assertNotNull(snapshot.capturedAt());
        assertEquals("2", snapshot.schemaVersion());
        assertEquals(System.getProperty("mapinboot.project.version"), snapshot.sdkVersion());
        assertEquals("service", snapshot.serviceId());
        assertEquals("instance", snapshot.instanceId());
        assertEquals("1.2.3", snapshot.applicationVersion());
        assertNotNull(snapshot.graphFingerprint());
        assertEquals(2, snapshot.nodes().size());
        assertEquals(List.of(finding), snapshot.findings());
        assertEquals(Map.of("collector", AnalysisStatus.READY, "analyzer", AnalysisStatus.READY),
                snapshot.analysisStatus());
    }

    @Test
    void findingChangesDoNotChangeGraphFingerprint() {
        Finding first = new Finding("finding-first", "RULE-1", "title", "description", Confidence.LIKELY,
                List.of(), List.of(), List.of("evidence-1"), "guide");
        Finding second = new Finding("finding-second", "RULE-2", "title", "description", Confidence.UNKNOWN,
                List.of(), List.of(), List.of("evidence-1"), "guide");

        Snapshot firstSnapshot = new SnapshotAssembler(List.of(ignored -> List.of(first)), sdkVersion())
                .assemble(report(), "service", "instance", "1.2.3", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
        Snapshot secondSnapshot = new SnapshotAssembler(List.of(ignored -> List.of(second)), sdkVersion())
                .assemble(report(), "service", "instance", "1.2.3", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        assertEquals(firstSnapshot.graphFingerprint(), secondSnapshot.graphFingerprint());
    }

    @Test
    void assemblerAllowsNoEvaluatorAndRejectsMultipleEvaluators() {
        AnalysisReport report = report();

        Snapshot snapshot = new SnapshotAssembler(List.of(), sdkVersion())
                .assemble(report, "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
        assertEquals(List.of(), snapshot.findings());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotAssembler(List.of(ignored -> List.of(), ignored -> List.of()), sdkVersion())
                        .assemble(report, "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown()));
        assertEquals(ErrorCode.INVALID_CONFIG, exception.getErrorCode());
    }

    @Test
    void assemblerRejectsFindingReferencesOutsideGraph() {
        Finding invalid = new Finding("finding-1", "RULE-1", "title", "description", Confidence.LIKELY,
                List.of("missing-node"), List.of(), List.of("evidence-1"), "guide");
        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotAssembler(List.of(ignored -> List.of(invalid)), sdkVersion())
                        .assemble(report(), "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown()));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void assemblerRejectsMissingFindingAndEvidenceMetadata() {
        Evidence invalidEvidence = new Evidence("evidence-1", null, "runtime", "Endpoint");
        Fact fact = new Fact("fact-1", "ENDPOINT_MAPPING", "endpoint-1",
                Map.of("httpMethod", "GET", "path", "/api", "handler", "handler-1"), List.of(invalidEvidence.id()));
        CollectionReport collection = new CollectionReport(
                List.of(fact), List.of(invalidEvidence), Map.of("collector", AnalysisStatus.READY), List.of());
        AnalysisReport report = new AnalysisReport(collection, List.of(), List.of(invalidEvidence),
                Map.of("analyzer", AnalysisStatus.READY), List.of());
        MapInBootException evidenceException = assertThrows(MapInBootException.class,
                () -> new SnapshotAssembler(List.of(), sdkVersion())
                        .assemble(report, "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown()));
        Finding invalidFinding = new Finding("finding-1", "", "title", "description", Confidence.UNKNOWN,
                List.of(), List.of(), List.of("evidence-1"), "guide");
        MapInBootException findingException = assertThrows(MapInBootException.class,
                () -> new SnapshotAssembler(List.of(ignored -> List.of(invalidFinding)), sdkVersion())
                        .assemble(report(), "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown()));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, evidenceException.getErrorCode());
        assertEquals(ErrorCode.INVALID_SNAPSHOT, findingException.getErrorCode());
    }

    @Test
    void assemblerAllowsEmptyFindingReferencesAndUnknownConfidence() {
        Finding finding = new Finding("finding-1", "RULE-1", "title", "description", Confidence.UNKNOWN,
                List.of(), List.of(), List.of("evidence-1"), "guide");

        Snapshot snapshot = new SnapshotAssembler(List.of(ignored -> List.of(finding)), sdkVersion())
                .assemble(report(), "service", "instance", "UNKNOWN", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        assertEquals(Confidence.UNKNOWN, snapshot.findings().get(0).confidence());
        assertEquals(List.of(), snapshot.findings().get(0).nodeIds());
    }

    @Test
    void jackson3CodecRoundTripsSnapshotAndPreservesAllFields() {
        Evidence evidence = new Evidence("evidence-1", EvidenceSource.RUNTIME, "runtime", "Endpoint");
        GraphNode node = new GraphNode("node-1", NodeType.ENDPOINT, "service", "endpoint",
                Map.of("path", "/api"), List.of(evidence.id()));
        GraphNode handler = new GraphNode("node-2", NodeType.HANDLER, "service", "handler",
                Map.of("handler", "handler-1"), List.of(evidence.id()));
        GraphEdge edge = new GraphEdge("edge-1", node.id(), handler.id(), EdgeType.FLOWS_TO,
                Map.of("flowKind", "HANDLER"), Confidence.UNKNOWN, List.of(evidence.id()));
        Finding finding = new Finding("finding-1", "RULE-1", "title", "description", Confidence.LIKELY,
                List.of(node.id()), List.of(edge.id()), List.of(evidence.id()), "guide");
        String fingerprint = new GraphFingerprintGenerator().generate(new SecurityGraph(List.of(node, handler), List.of(edge)));
        Snapshot snapshot = new Snapshot("snapshot-1", Instant.parse("2026-10-31T00:00:00Z"), "2",
                sdkVersion(), "service", "instance", "1.2.3", fingerprint,
                List.of(node, handler), List.of(edge), List.of(evidence), List.of(finding),
                Map.of("collector", AnalysisStatus.READY), Map.of(evidence.id(), "EP-MAPPING-001"),
                com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
        SnapshotJsonCodec codec = new SnapshotJsonCodec();

        String encoded = codec.encode(snapshot);
        Snapshot decoded = codec.decode(encoded);

        assertTrue(encoded.contains("\"evidenceDisplayCodes\":{\"evidence-1\":\"EP-MAPPING-001\"}"));
        assertEquals(snapshot, decoded);
        assertEquals(Map.of(evidence.id(), "EP-MAPPING-001"), decoded.evidenceDisplayCodes());
        assertEquals(snapshot.schemaVersion(), decoded.schemaVersion());
        assertEquals(snapshot.evidence(), decoded.evidence());
        assertEquals(snapshot.nodes().get(0).evidenceIds(), decoded.nodes().get(0).evidenceIds());
        assertEquals(snapshot.edges().get(0).evidenceIds(), decoded.edges().get(0).evidenceIds());
        assertEquals(snapshot.findings().get(0).evidenceIds(), decoded.findings().get(0).evidenceIds());
        assertEquals(snapshot.graphFingerprint(), decoded.graphFingerprint());
        assertEquals(snapshot.capturedAt(), decoded.capturedAt());
        assertEquals(Confidence.UNKNOWN, decoded.edges().get(0).confidence());
    }

    @Test
    void jackson3CodecRejectsGraphNodeServiceIdMismatch() {
        Snapshot source = validSnapshot();
        GraphNode original = source.nodes().get(0);
        GraphNode mismatched = new GraphNode(original.id(), original.type(), "other-service", original.label(),
                original.attributes(), original.evidenceIds());
        Snapshot invalid = withGraph(source, List.of(mismatched, source.nodes().get(1)), source.edges());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(invalid));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void jackson3CodecRejectsBlankGraphNodeLabel() {
        Snapshot source = validSnapshot();
        GraphNode original = source.nodes().get(0);
        GraphNode invalidNode = new GraphNode(original.id(), original.type(), original.serviceId(), " ",
                original.attributes(), original.evidenceIds());
        Snapshot invalid = withGraph(source, List.of(invalidNode, source.nodes().get(1)), source.edges());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(invalid));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void jackson3CodecRejectsMissingGraphEdgeConfidence() {
        Snapshot source = validSnapshot();
        GraphEdge original = source.edges().get(0);
        GraphEdge invalidEdge = new GraphEdge(original.id(), original.sourceId(), original.targetId(), original.type(),
                original.attributes(), null, original.evidenceIds());
        Snapshot invalid = withGraph(source, source.nodes(), List.of(invalidEdge));

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(invalid));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void jackson3CodecRejectsMalformedJson() {
        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().decode("{\"snapshotId\":null"));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void jackson3CodecRejectsInvalidSnapshotBeforeEncoding() {
        Snapshot snapshot = new Snapshot("snapshot-1", Instant.parse("2026-10-31T00:00:00Z"), "2",
                sdkVersion(), "service", "instance", "1.2.3", "wrong",
                List.of(), List.of(), List.of(), List.of(), Map.of(), Map.of(),
                com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> new SnapshotJsonCodec().encode(snapshot));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    @Test
    void jackson3CodecRejectsFingerprintMismatchDuringDecoding() {
        Snapshot snapshot = new SnapshotAssembler(List.of(), sdkVersion())
                .assemble(report(), "service", "instance", "1.2.3", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
        SnapshotJsonCodec codec = new SnapshotJsonCodec();
        String tampered = codec.encode(snapshot).replace(snapshot.graphFingerprint(), "wrong");

        MapInBootException exception = assertThrows(MapInBootException.class,
                () -> codec.decode(tampered));

        assertEquals(ErrorCode.INVALID_SNAPSHOT, exception.getErrorCode());
    }

    private AnalysisReport report() {
        Evidence evidence = new Evidence("evidence-1", EvidenceSource.RUNTIME, "runtime", "Endpoint");
        Fact fact = new Fact("fact-1", "ENDPOINT_MAPPING", "endpoint-1",
                Map.of("httpMethod", "GET", "path", "/api", "handler", "handler-1"), List.of(evidence.id()));
        CollectionReport collection = new CollectionReport(
                List.of(fact), List.of(evidence), Map.of("collector", AnalysisStatus.READY), List.of());
        return new AnalysisReport(collection, List.of(), List.of(evidence),
                Map.of("analyzer", AnalysisStatus.READY), List.of());
    }

    private Finding finding() {
        String nodeId = new StableIdGenerator().generate("service", NodeType.ENDPOINT, "endpoint-1");
        return new Finding("finding-1", "RULE-1", "title", "description", Confidence.LIKELY,
                List.of(nodeId), List.of(), List.of("evidence-1"), "guide");
    }

    private Snapshot validSnapshot() {
        Evidence evidence = new Evidence("evidence-1", EvidenceSource.RUNTIME, "runtime", "Endpoint");
        GraphNode node = new GraphNode("node-1", NodeType.ENDPOINT, "service", "endpoint",
                Map.of("path", "/api"), List.of(evidence.id()));
        GraphNode handler = new GraphNode("node-2", NodeType.HANDLER, "service", "handler",
                Map.of("handler", "handler-1"), List.of(evidence.id()));
        GraphEdge edge = new GraphEdge("edge-1", node.id(), handler.id(), EdgeType.FLOWS_TO,
                Map.of("flowKind", "HANDLER"), Confidence.UNKNOWN, List.of(evidence.id()));
        Finding finding = new Finding("finding-1", "RULE-1", "title", "description", Confidence.LIKELY,
                List.of(node.id()), List.of(edge.id()), List.of(evidence.id()), "guide");
        String fingerprint = new GraphFingerprintGenerator().generate(new SecurityGraph(List.of(node, handler), List.of(edge)));
        return new Snapshot("snapshot-1", Instant.parse("2026-10-31T00:00:00Z"), "2",
                sdkVersion(), "service", "instance", "1.2.3", fingerprint,
                List.of(node, handler), List.of(edge), List.of(evidence), List.of(finding),
                Map.of("collector", AnalysisStatus.READY), Map.of(evidence.id(), "EP-MAPPING-001"),
                com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
    }

    private Snapshot withGraph(Snapshot source, List<GraphNode> nodes, List<GraphEdge> edges) {
        String fingerprint = new GraphFingerprintGenerator().generate(new SecurityGraph(nodes, edges));
        return new Snapshot(source.snapshotId(), source.capturedAt(), source.schemaVersion(), source.sdkVersion(),
                source.serviceId(), source.instanceId(), source.applicationVersion(), fingerprint,
                nodes, edges, source.evidence(), source.findings(), source.analysisStatus(),
                source.evidenceDisplayCodes(), source.runtimeArchitecture());
    }

    private Snapshot withoutDisplayCodes(Snapshot source) {
        return new Snapshot(source.snapshotId(), source.capturedAt(), source.schemaVersion(), source.sdkVersion(),
                source.serviceId(), source.instanceId(), source.applicationVersion(), source.graphFingerprint(),
                source.nodes(), source.edges(), source.evidence(), source.findings(), source.analysisStatus(),
                Map.of(), source.runtimeArchitecture());
    }

    private Snapshot withDisplayCodes(Snapshot source, Map<String, String> displayCodes) {
        return new Snapshot(source.snapshotId(), source.capturedAt(), source.schemaVersion(), source.sdkVersion(),
                source.serviceId(), source.instanceId(), source.applicationVersion(), source.graphFingerprint(),
                source.nodes(), source.edges(), source.evidence(), source.findings(), source.analysisStatus(), displayCodes,
                source.runtimeArchitecture());
    }

    private String sdkVersion() {
        Properties metadata = new Properties();
        try (InputStream input = getClass().getClassLoader()
                .getResourceAsStream("META-INF/map-in-boot-version.properties")) {
            if (input == null) {
                throw new AssertionError("SDK version metadata is missing");
            }
            metadata.load(input);
            return metadata.getProperty("sdk.version");
        } catch (Exception exception) {
            throw new AssertionError("SDK version metadata cannot be read", exception);
        }
    }
}
