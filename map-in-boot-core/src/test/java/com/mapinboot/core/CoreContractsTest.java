package com.mapinboot.core;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CoreContractsTest {

    @Test
    void collectionRecordsPreserveDefensiveCopies() {
        List<String> evidenceIds = new ArrayList<>(List.of("evidence-1"));
        Map<String, String> attributes = new LinkedHashMap<>(Map.of("path", "/api"));

        Fact fact = new Fact("fact-1", "ENDPOINT_MAPPING", "endpoint-1", attributes, evidenceIds);
        Relation relation = new Relation(
                "relation-1", "endpoint-1", "handler-1", EdgeType.FLOWS_TO,
                attributes, Confidence.CONFIRMED, evidenceIds);
        GraphNode node = new GraphNode(
                "node-1", NodeType.ENDPOINT, "service", "GET /api", attributes, evidenceIds);
        GraphEdge edge = new GraphEdge(
                "edge-1", "node-1", "node-2", EdgeType.FLOWS_TO,
                attributes, Confidence.CONFIRMED, evidenceIds);
        Evidence evidenceItem = new Evidence("evidence-1", EvidenceSource.RUNTIME, "endpoint-1", "등록 정보");
        AdapterDiagnostic diagnostic = new AdapterDiagnostic("collector", ErrorCode.ADAPTER_FAILED, "실패 요약");
        List<Fact> facts = new ArrayList<>(List.of(fact));
        List<Evidence> evidence = new ArrayList<>(List.of(evidenceItem));
        List<Relation> relations = new ArrayList<>(List.of(relation));
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(List.of(diagnostic));
        Map<String, AnalysisStatus> statusByAdapter = new LinkedHashMap<>(
                Map.of("collector", AnalysisStatus.PARTIAL));
        List<GraphNode> nodes = new ArrayList<>(List.of(node));
        List<GraphEdge> edges = new ArrayList<>(List.of(edge));
        List<Finding> findings = new ArrayList<>();
        CollectionResult collectionResult = new CollectionResult(
                "collector", facts, evidence, AnalysisStatus.PARTIAL, diagnostics);
        CollectionReport collectionReport = new CollectionReport(
                facts, evidence, statusByAdapter, diagnostics);
        CollectionContext collectionContext = new CollectionContext(null, "service", "instance");
        AnalysisContext analysisContext = new AnalysisContext(collectionReport, "service");
        AnalysisResult analysisResult = new AnalysisResult(
                "analyzer", relations, evidence, AnalysisStatus.READY, diagnostics);
        AnalysisReport analysisReport = new AnalysisReport(
                collectionReport, relations, evidence, statusByAdapter, diagnostics);
        Finding finding = new Finding(
                "finding-1", "RULE-1", "진단", "설명", Confidence.LIKELY,
                List.of("node-1"), List.of("edge-1"), evidenceIds, "점검 가이드");
        findings.add(finding);
        SecurityGraph graph = new SecurityGraph(nodes, edges);
        Snapshot snapshot = new Snapshot(
                "snapshot-1", Instant.parse("2026-10-31T00:00:00Z"), "1", "0.1.0-SNAPSHOT",
                "service", "instance", "1.0.0", "fingerprint", nodes, edges,
                evidence, findings, statusByAdapter);

        evidenceIds.add("evidence-2");
        attributes.put("method", "GET");
        facts.clear();
        evidence.clear();
        relations.clear();
        diagnostics.clear();
        statusByAdapter.clear();
        nodes.clear();
        edges.clear();
        findings.clear();

        assertEquals(List.of("evidence-1"), fact.evidenceIds());
        assertEquals(Map.of("path", "/api"), fact.attributes());
        assertEquals(Map.of("path", "/api"), relation.attributes());
        assertEquals(List.of("evidence-1"), relation.evidenceIds());
        assertEquals(Map.of("path", "/api"), node.attributes());
        assertEquals(List.of("evidence-1"), node.evidenceIds());
        assertEquals(Map.of("path", "/api"), edge.attributes());
        assertEquals(List.of("evidence-1"), edge.evidenceIds());
        assertEquals(List.of("evidence-1"), finding.evidenceIds());
        assertEquals(List.of(fact), collectionResult.facts());
        assertEquals(List.of(evidenceItem), collectionResult.evidence());
        assertEquals(List.of(diagnostic), collectionResult.diagnostics());
        assertEquals(List.of(evidenceItem), collectionReport.evidence());
        assertEquals(List.of(diagnostic), collectionReport.diagnostics());
        assertEquals(List.of(relation), analysisResult.relations());
        assertEquals(List.of(evidenceItem), analysisResult.additionalEvidence());
        assertEquals(List.of(diagnostic), analysisResult.diagnostics());
        assertEquals(List.of(evidenceItem), analysisReport.evidence());
        assertEquals(List.of(diagnostic), analysisReport.diagnostics());
        assertEquals(Map.of("collector", AnalysisStatus.PARTIAL), collectionReport.statusByAdapter());
        assertEquals(List.of(node), graph.nodes());
        assertEquals(List.of(edge), graph.edges());
        assertEquals(List.of(node), snapshot.nodes());
        assertEquals(List.of(edge), snapshot.edges());
        assertEquals(List.of(evidenceItem), snapshot.evidence());
        assertEquals(List.of(finding), snapshot.findings());
        assertEquals(Map.of("collector", AnalysisStatus.PARTIAL), snapshot.analysisStatus());
        assertEquals("instance", collectionContext.instanceId());
        assertEquals(collectionReport, analysisContext.collectionReport());
        assertThrows(UnsupportedOperationException.class, () -> fact.evidenceIds().add("blocked"));
        assertThrows(UnsupportedOperationException.class, () -> node.attributes().put("blocked", "blocked"));
        assertThrows(UnsupportedOperationException.class, () -> collectionResult.facts().clear());
        assertThrows(UnsupportedOperationException.class, () -> collectionReport.statusByAdapter().clear());
        assertThrows(UnsupportedOperationException.class, () -> analysisResult.relations().clear());
        assertThrows(UnsupportedOperationException.class, () -> analysisReport.statusByAdapter().clear());
        assertThrows(UnsupportedOperationException.class, () -> graph.nodes().clear());
        assertThrows(UnsupportedOperationException.class, () -> snapshot.analysisStatus().clear());
    }

    @Test
    void abstractAdaptersExposeFixedCommonContracts() {
        Set<String> collectorTypes = new LinkedHashSet<>(Set.of("ENDPOINT_MAPPING"));
        Set<String> analysisTypes = new LinkedHashSet<>(Set.of("FLOWS_TO"));
        TestCollector collector = new TestCollector("collector", "수집 설명", collectorTypes);
        TestAnalysis analysis = new TestAnalysis("analysis", "분석 설명", analysisTypes);

        collectorTypes.add("SESSION_USAGE");
        analysisTypes.add("SECURED_BY");

        assertEquals("collector", collector.id());
        assertEquals("수집 설명", collector.getDescription());
        assertEquals(Set.of("ENDPOINT_MAPPING"), collector.getSupportedTypes());
        assertEquals(true, collector.enabled());
        assertEquals(Set.of(), collector.dependsOn());
        assertEquals("TestCollector[id=collector, supportedTypes=[ENDPOINT_MAPPING], description=수집 설명]", collector.toString());
        assertEquals("analysis", analysis.id());
        assertEquals(Set.of("FLOWS_TO"), analysis.getSupportedTypes());
        assertEquals(true, analysis.enabled());
        assertEquals(Set.of(), analysis.requiredFactTypes());
        assertEquals("TestAnalysis[id=analysis, supportedTypes=[FLOWS_TO], description=분석 설명]", analysis.toString());
        assertThrows(UnsupportedOperationException.class, () -> collector.getSupportedTypes().add("blocked"));
        assertThrows(UnsupportedOperationException.class, () -> analysis.getSupportedTypes().add("blocked"));
        assertThrows(IllegalArgumentException.class, () -> new TestCollector(" ", "설명", Set.of()));
        assertThrows(NullPointerException.class, () -> new TestAnalysis("analysis", null, Set.of()));
    }

    @Test
    void errorCodeUsesContractedMessage() {
        MapInBootException exception = new MapInBootException(ErrorCode.INVALID_CONFIG);

        assertEquals("MIB-001", exception.getErrorCode().getCode());
        assertEquals("SDK 설정이 올바르지 않습니다.", exception.getMessage());
    }

    private static final class TestCollector extends AbstractCollectorAdapter {

        private TestCollector(String id, String description, Set<String> supportedTypes) {
            super(id, description, supportedTypes);
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            return null;
        }
    }

    private static final class TestAnalysis extends AbstractAnalysisAdapter {

        private TestAnalysis(String id, String description, Set<String> supportedTypes) {
            super(id, description, supportedTypes);
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            return null;
        }
    }
}
