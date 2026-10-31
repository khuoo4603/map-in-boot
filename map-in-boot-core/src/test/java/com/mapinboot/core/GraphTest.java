package com.mapinboot.core;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
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
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.GraphFingerprintGenerator;
import com.mapinboot.core.graph.StableIdGenerator;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GraphTest {

    @Test
    void stableIdsUseStructuralInputsAndSortedIdentityAttributes() {
        StableIdGenerator generator = new StableIdGenerator();

        String nodeId = generator.generate("orders", NodeType.ENDPOINT, "GET /orders");
        String edgeId = generator.generateEdge(
                "node-a", "node-b", EdgeType.SECURITY_STATE,
                Map.of("stateAction", "REQUIRES", "securityKind", "AUTHORIZATION"));

        assertEquals(nodeId, generator.generate("orders", NodeType.ENDPOINT, "GET /orders"));
        assertNotEquals(nodeId, generator.generate("billing", NodeType.ENDPOINT, "GET /orders"));
        assertNotEquals(nodeId, generator.generate("orders", NodeType.HANDLER, "GET /orders"));
        assertNotEquals(nodeId, generator.generate("orders", NodeType.ENDPOINT, "GET /orders/{id}"));
        assertEquals(edgeId, generator.generateEdge(
                "node-a", "node-b", EdgeType.SECURITY_STATE,
                Map.of("securityKind", "AUTHORIZATION", "stateAction", "REQUIRES")));
        assertNotEquals(edgeId, generator.generateEdge(
                "node-a", "node-b", EdgeType.SECURITY_STATE,
                Map.of("stateAction", "PRODUCES", "securityKind", "AUTHORIZATION")));
        assertNotEquals(
                generator.generate("ab", NodeType.ENDPOINT, "c"),
                generator.generate("a", NodeType.ENDPOINT, "bc"));
    }

    @Test
    void fingerprintIgnoresPresentationAndEvidenceButDetectsStructuralChanges() {
        GraphFingerprintGenerator generator = new GraphFingerprintGenerator();
        GraphNode endpoint = new GraphNode(
                "node-endpoint", NodeType.ENDPOINT, "orders", "GET /orders",
                Map.of("path", "/orders", "httpMethod", "GET"), List.of("evidence-a"));
        GraphNode chain = new GraphNode(
                "node-chain", NodeType.SECURITY_CHAIN, "orders", "orders chain",
                Map.of("matcherType", "PATH"), List.of("evidence-b"));
        GraphEdge edge = new GraphEdge(
                "edge-match", "node-endpoint", "node-chain", EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1"),
                Confidence.CONFIRMED, List.of("evidence-a"));

        String fingerprint = generator.generate(new SecurityGraph(List.of(endpoint, chain), List.of(edge)));
        Map<String, String> reorderedEndpointAttributes = new LinkedHashMap<>();
        reorderedEndpointAttributes.put("path", "/orders");
        reorderedEndpointAttributes.put("httpMethod", "GET");
        Map<String, String> reorderedEdgeAttributes = new LinkedHashMap<>();
        reorderedEdgeAttributes.put("chainOrder", "1");
        reorderedEdgeAttributes.put("matcherCondition", "/orders/**");
        SecurityGraph reordered = new SecurityGraph(
                List.of(new GraphNode(
                        "node-chain", NodeType.SECURITY_CHAIN, "orders", "다른 표시명",
                        Map.of("matcherType", "PATH"), List.of("evidence-c")),
                        new GraphNode(
                                "node-endpoint", NodeType.ENDPOINT, "orders", "다른 Endpoint 표시명",
                                reorderedEndpointAttributes, List.of("evidence-b"))),
                List.of(new GraphEdge(
                        "edge-match", "node-endpoint", "node-chain", EdgeType.MATCHED_BY,
                        reorderedEdgeAttributes,
                        Confidence.UNKNOWN, List.of("evidence-c"))));
        SecurityGraph changed = new SecurityGraph(
                List.of(endpoint, chain),
                List.of(new GraphEdge(
                        "edge-match", "node-endpoint", "node-chain", EdgeType.MATCHED_BY,
                        Map.of("matcherCondition", "/orders/**", "chainOrder", "2"),
                        Confidence.CONFIRMED, List.of("evidence-a"))));

        assertEquals(fingerprint, generator.generate(reordered));
        assertNotEquals(fingerprint, generator.generate(changed));
    }

    @Test
    void graphBuilderMapsFactsAndRelationsToStableGraphIds() {
        Evidence endpointEvidence = new Evidence("evidence-endpoint", EvidenceSource.RUNTIME, "mapping", "endpoint");
        Evidence chainEvidence = new Evidence("evidence-chain", EvidenceSource.SPRING_METADATA, "chain", "chain");
        Fact endpoint = new Fact(
                "fact-endpoint", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"),
                List.of("evidence-endpoint"));
        Fact chain = new Fact(
                "fact-chain", "SECURITY_CHAIN", "chain:orders",
                Map.of("chainKey", "orders", "matcherType", "PATH"), List.of("evidence-chain"));
        Fact duplicateEndpoint = new Fact(
                "fact-endpoint-duplicate", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"),
                List.of("evidence-chain"));
        Relation matchedBy = new Relation(
                "relation-match", "endpoint:GET:/orders", "chain:orders", EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1"),
                Confidence.CONFIRMED, List.of("evidence-endpoint"));
        Relation duplicateMatch = new Relation(
                "relation-match-duplicate", "endpoint:GET:/orders", "chain:orders", EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1"),
                Confidence.CONFIRMED, List.of("evidence-chain"));
        AnalysisReport report = report(
                List.of(endpoint, chain, duplicateEndpoint), List.of(endpointEvidence, chainEvidence), List.of(matchedBy, duplicateMatch));

        SecurityGraph graph = new GraphBuilder().build("orders", report);
        GraphNode endpointNode = graph.nodes().stream()
                .filter(node -> node.type() == NodeType.ENDPOINT)
                .findFirst()
                .orElseThrow();
        GraphNode handlerNode = graph.nodes().stream()
                .filter(node -> node.type() == NodeType.HANDLER)
                .findFirst()
                .orElseThrow();
        GraphNode chainNode = graph.nodes().stream()
                .filter(node -> node.type() == NodeType.SECURITY_CHAIN)
                .findFirst()
                .orElseThrow();

        assertEquals(3, graph.nodes().size());
        assertEquals(1, graph.edges().size());
        assertEquals("orders", endpointNode.serviceId());
        assertEquals(List.of("evidence-chain", "evidence-endpoint"), endpointNode.evidenceIds());
        assertEquals("OrderController#list", handlerNode.label());
        assertEquals(endpointNode.id(), graph.edges().get(0).sourceId());
        assertEquals(chainNode.id(), graph.edges().get(0).targetId());
        assertEquals(List.of("evidence-chain", "evidence-endpoint"), graph.edges().get(0).evidenceIds());
    }

    @Test
    void graphBuilderRejectsMissingEvidenceAndMissingRelationNodes() {
        Fact endpoint = new Fact(
                "fact-endpoint", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"),
                List.of("missing-evidence"));
        Relation missingTarget = new Relation(
                "relation", "endpoint:GET:/orders", "missing-chain", EdgeType.MATCHED_BY,
                Map.of(), Confidence.UNKNOWN, List.of());

        MapInBootException evidenceException = assertThrows(MapInBootException.class,
                () -> new GraphBuilder().build("orders", report(List.of(endpoint), List.of(), List.of())));
        MapInBootException nodeException = assertThrows(MapInBootException.class,
                () -> new GraphBuilder().build("orders", report(
                        List.of(new Fact(
                                "fact-endpoint", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"), List.of())),
                        List.of(), List.of(missingTarget))));

        assertEquals(ErrorCode.INVALID_GRAPH, evidenceException.getErrorCode());
        assertEquals(ErrorCode.INVALID_GRAPH, nodeException.getErrorCode());
    }

    @Test
    void providersBuildDeterministicGraphAndFingerprint() {
        Evidence evidence = new Evidence("evidence", EvidenceSource.RUNTIME, "endpoint", "endpoint");
        Fact endpoint = new Fact(
                "fact", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"),
                List.of("evidence"));
        Relation flow = new Relation(
                "relation", "endpoint:GET:/orders", "OrderController#list", EdgeType.FLOWS_TO,
                Map.of("flowKind", "HANDLER", "displayColor", "blue"), Confidence.CONFIRMED, List.of("evidence"));
        CollectionReport collectionReport = new CollectionProvider().execute(
                new CollectionContext(null, "orders", "instance-a"),
                List.of(new TestCollector(endpoint, evidence)));
        AnalysisReport firstReport = new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "orders"), List.of(new TestAnalysis(flow)));
        AnalysisReport secondReport = new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "orders"), List.of(new TestAnalysis(new Relation(
                        "different-relation-id", "endpoint:GET:/orders", "OrderController#list", EdgeType.FLOWS_TO,
                        Map.of("displayColor", "red", "flowKind", "HANDLER"), Confidence.UNKNOWN, List.of("evidence")))));
        GraphBuilder builder = new GraphBuilder();
        GraphFingerprintGenerator fingerprintGenerator = new GraphFingerprintGenerator();

        SecurityGraph firstGraph = builder.build("orders", firstReport);
        SecurityGraph secondGraph = builder.build("orders", secondReport);

        assertEquals(2, firstGraph.nodes().size());
        assertEquals(1, firstGraph.edges().size());
        assertEquals(firstGraph.edges().get(0).id(), secondGraph.edges().get(0).id());
        assertEquals(fingerprintGenerator.generate(firstGraph), fingerprintGenerator.generate(secondGraph));
    }

    @Test
    void graphBuilderMergesCompatibleNodeAttributesAndKeepsDifferentNodeTypes() {
        Fact firstChain = new Fact(
                "chain-a", "SECURITY_CHAIN", "shared-key",
                Map.of("chainKey", "orders", "matcherType", "PATH"), List.of("evidence-a"));
        Fact secondChain = new Fact(
                "chain-b", "SECURITY_CHAIN", "shared-key",
                Map.of("chainKey", "orders", "matcherType", "PATH", "matcherCondition", "/orders/**"),
                List.of("evidence-b"));
        Fact filter = new Fact(
                "filter", "FILTER_REGISTRATION", "shared-key",
                Map.of("filterClass", "AuditFilter", "registrationKind", "SECURITY"), List.of("evidence-a"));

        SecurityGraph graph = new GraphBuilder().build("orders", report(
                List.of(firstChain, secondChain, filter),
                List.of(
                        new Evidence("evidence-a", EvidenceSource.RUNTIME, "a", "a"),
                        new Evidence("evidence-b", EvidenceSource.RUNTIME, "b", "b")),
                List.of()));

        GraphNode chain = graph.nodes().stream().filter(node -> node.type() == NodeType.SECURITY_CHAIN).findFirst().orElseThrow();
        assertEquals(2, graph.nodes().size());
        assertEquals("/orders/**", chain.attributes().get("matcherCondition"));
        assertEquals(List.of("evidence-a", "evidence-b"), chain.evidenceIds());
    }

    @Test
    void graphBuilderExcludesPresentationAttributesFromEdgeIdentityAndFingerprint() {
        Fact endpoint = new Fact(
                "endpoint", "ENDPOINT_MAPPING", "endpoint:GET:/orders",
                Map.of("httpMethod", "GET", "path", "/orders", "handler", "OrderController#list"), List.of());
        Fact chain = new Fact(
                "chain", "SECURITY_CHAIN", "chain:orders",
                Map.of("chainKey", "orders", "matcherType", "PATH"), List.of());
        Relation first = new Relation(
                "first", "endpoint:GET:/orders", "chain:orders", EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1", "matcherLabel", "Z label"),
                Confidence.CONFIRMED, List.of());
        Relation second = new Relation(
                "second", "endpoint:GET:/orders", "chain:orders", EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1", "matcherLabel", "A label"),
                Confidence.CONFIRMED, List.of());

        SecurityGraph graph = new GraphBuilder().build("orders", report(List.of(endpoint, chain), List.of(), List.of(first, second)));
        GraphEdge presentationChanged = new GraphEdge(
                graph.edges().get(0).id(), graph.edges().get(0).sourceId(), graph.edges().get(0).targetId(), EdgeType.MATCHED_BY,
                Map.of("matcherCondition", "/orders/**", "chainOrder", "1", "matcherLabel", "different"),
                Confidence.UNKNOWN, List.of("different-evidence"));

        assertEquals(1, graph.edges().size());
        assertEquals("A label", graph.edges().get(0).attributes().get("matcherLabel"));
        assertEquals(new GraphFingerprintGenerator().generate(graph), new GraphFingerprintGenerator().generate(
                new SecurityGraph(graph.nodes(), List.of(presentationChanged))));
    }

    @Test
    void graphBuilderRejectsAmbiguousRelationAndMissingRequiredFactAttributes() {
        Fact chain = new Fact(
                "chain", "SECURITY_CHAIN", "shared-key",
                Map.of("chainKey", "orders", "matcherType", "PATH"), List.of());
        Fact filter = new Fact(
                "filter", "FILTER_REGISTRATION", "shared-key",
                Map.of("filterClass", "AuditFilter", "registrationKind", "SECURITY"), List.of());
        Relation ambiguous = new Relation(
                "ambiguous", "shared-key", "shared-key", EdgeType.FILTERED_BY, Map.of("filterOrder", "1"),
                Confidence.CONFIRMED, List.of());
        Fact missingChainKey = new Fact(
                "invalid-chain", "SECURITY_CHAIN", "chain:invalid", Map.of("matcherType", "PATH"), List.of());

        MapInBootException ambiguousException = assertThrows(MapInBootException.class,
                () -> new GraphBuilder().build("orders", report(List.of(chain, filter), List.of(), List.of(ambiguous))));
        MapInBootException factException = assertThrows(MapInBootException.class,
                () -> new GraphBuilder().build("orders", report(List.of(missingChainKey), List.of(), List.of())));

        assertEquals(ErrorCode.INVALID_GRAPH, ambiguousException.getErrorCode());
        assertEquals(ErrorCode.INVALID_GRAPH, factException.getErrorCode());
        assertTrue(ambiguousException.getMessage().contains("모호"));
    }

    private AnalysisReport report(List<Fact> facts, List<Evidence> evidence, List<Relation> relations) {
        CollectionReport collectionReport = new CollectionReport(
                facts, evidence, Map.of("collector", AnalysisStatus.READY), List.of());
        return new AnalysisReport(collectionReport, relations, evidence, Map.of("analysis", AnalysisStatus.READY), List.of());
    }

    private static final class TestCollector extends AbstractCollectorAdapter {
        private final Fact fact;
        private final Evidence evidence;

        private TestCollector(Fact fact, Evidence evidence) {
            super("collector", "수집 테스트", Set.of("ENDPOINT_MAPPING"));
            this.fact = fact;
            this.evidence = evidence;
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            return new CollectionResult(id(), List.of(fact), List.of(evidence), AnalysisStatus.READY, List.of());
        }
    }

    private static final class TestAnalysis extends AbstractAnalysisAdapter {
        private final Relation relation;

        private TestAnalysis(Relation relation) {
            super("analysis", "분석 테스트", Set.of(EdgeType.FLOWS_TO.name()));
            this.relation = relation;
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            return new AnalysisResult(id(), List.of(relation), List.of(), AnalysisStatus.READY, List.of());
        }
    }
}
