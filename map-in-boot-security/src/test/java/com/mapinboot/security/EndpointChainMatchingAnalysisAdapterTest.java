package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EndpointChainMatchingAnalysisAdapterTest {

    @Test
    void createsRelationForTheFirstCompleteMatch() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact chain = chain("first", 1, "PATH", "/api/**");

        AnalysisReport report = execute(List.of(endpoint, chain), readyStatuses());

        assertEquals(AnalysisStatus.READY, status(report));
        assertEquals(1, report.relations().size());
        assertRelation(report.relations().get(0), endpoint, chain);
    }

    @Test
    void skipsAnEarlierNonMatchingChainAndSelectsTheNextCompleteMatch() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact first = chain("admin", 1, "PATH", "/admin/**");
        Fact second = chain("api", 2, "PATH", "/api/**");

        AnalysisReport report = execute(List.of(endpoint, first, second), readyStatuses());

        assertEquals(1, report.relations().size());
        assertEquals(second.subjectKey(), report.relations().get(0).targetKey());
    }

    @Test
    void keepsOnlyTheFirstRelationWhenSeveralChainsMatch() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact first = chain("api", 1, "PATH", "/api/**");
        Fact second = chain("any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, first, second), readyStatuses());

        assertEquals(1, report.relations().size());
        assertEquals(first.subjectKey(), report.relations().get(0).targetKey());
    }

    @Test
    void requiresPathCoverageInsteadOfPrefixSimilarity() {
        Fact endpoint = endpoint("order", "GET", "/api/orders");
        Fact exact = chain("exact", 1, "PATH", "/api/order");

        AnalysisReport report = execute(List.of(endpoint, exact), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.READY, status(report));
    }

    @Test
    void usesSpringPathPatternForRegexAndSegmentWildcards() {
        assertFirstChainMatches("regex", "/api/{id:[0-9]+}", "/api/123");
        assertFirstChainMatches("segment-wildcard", "/api/item-*", "/api/item-123");
        assertFirstChainMatches("multi-segment-capture", "/api/{*path}", "/api/a/b");

        Fact endpoint = endpoint("dynamic-catch-all", "GET", "/api/{id}");
        Fact first = chain("dynamic-catch-all", 1, "PATH", "/api/**");
        Fact any = chain("dynamic-catch-all-any", 2, "ANY", "ANY");
        AnalysisReport report = execute(List.of(endpoint, first, any), readyStatuses());
        assertEquals(1, report.relations().size());
        assertEquals(first.subjectKey(), report.relations().get(0).targetKey());
    }

    @Test
    void keepsSpringTrailingSlashSemantics() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact slash = chain("slash", 1, "PATH", "/api/orders/");
        Fact any = chain("any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, slash, any), readyStatuses());

        assertEquals(1, report.relations().size());
        assertEquals(any.subjectKey(), report.relations().get(0).targetKey());
        assertEquals(AnalysisStatus.READY, status(report));
    }

    @Test
    void blocksAnyChainAfterAnUnprovenDynamicPatternRelation() {
        Fact endpoint = endpoint("dynamic", "GET", "/api/{id}");
        Fact restricted = chain("restricted", 1, "PATH", "/api/{id:[0-9]+}");
        Fact any = chain("any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, restricted, any), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void blocksAnyChainWhenRuntimePathPatternSettingsAreNotDefault() {
        Fact endpoint = endpoint("upper-orders", "GET", "/api/orders",
                Map.of("mvcPathPatternSettings", "NON_DEFAULT"));
        Fact caseSensitive = chain("case-sensitive", 1, "PATH", "/api/orders");
        Fact any = chain("case-sensitive-any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, caseSensitive, any), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void treatsMissingMvcPathPatternSettingsAsUnknown() {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("httpMethod", "GET");
        attributes.put("path", "/api/orders");
        attributes.put("handler", "Orders#handle");
        Fact endpoint = new Fact("endpoint-fact-missing-settings", "ENDPOINT_MAPPING", "endpoint|missing-settings",
                attributes, List.of("endpoint-evidence-missing-settings"));
        Fact chain = chain("missing-settings", 1, "PATH", "/api/orders");
        Fact any = chain("missing-settings-any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, chain, any), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void preservesUnknownThroughCompositeAndNegatedMatchers() {
        Fact endpoint = endpoint("dynamic", "GET", "/api/{id}");
        Fact and = chain("and", 1, "AND", "AND(GET /api/{id},/other/**)");
        Fact any = chain("any", 2, "ANY", "ANY");
        AnalysisReport andReport = execute(List.of(endpoint, and, any), readyStatuses());
        assertTrue(andReport.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(andReport));

        Fact or = chain("or", 1, "OR", "OR(GET /api/{other},/other/**)");
        AnalysisReport orReport = execute(List.of(endpoint, or, any), readyStatuses());
        assertTrue(orReport.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(orReport));

        Fact negated = chain("negated", 1, "NEGATED", "NOT(/api/{other})");
        AnalysisReport negatedReport = execute(List.of(endpoint, negated, any), readyStatuses());
        assertTrue(negatedReport.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(negatedReport));
    }

    @Test
    void reportsNoMatchForMethodMismatch() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact chain = chain("post", 1, "METHOD_PATH", "POST /api/orders", "POST");

        AnalysisReport report = execute(List.of(endpoint, chain), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.READY, status(report));
    }

    @Test
    void evaluatesNegatedAndCompositeMatchers() {
        Fact privateEndpoint = endpoint("private", "GET", "/api/private");
        Fact negated = chain("private", 1, "NEGATED", "NOT(/api/public/**)");
        AnalysisReport negatedReport = execute(List.of(privateEndpoint, negated), readyStatuses());
        assertEquals(1, negatedReport.relations().size());

        Fact compositeEndpoint = endpoint("orders", "GET", "/api/orders");
        Fact and = chain("and", 1, "AND", "AND(GET /api/orders,/api/**)");
        AnalysisReport andReport = execute(List.of(compositeEndpoint, and), readyStatuses());
        assertEquals(1, andReport.relations().size());

        Fact or = chain("or", 1, "OR", "OR(POST /api/orders,/admin/**)");
        AnalysisReport orReport = execute(List.of(compositeEndpoint, or), readyStatuses());
        assertTrue(orReport.relations().isEmpty());
    }

    @Test
    void doesNotSkipAnUnknownEarlierChainToConfirmALaterChain() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact unknown = chain("unknown", 1, "UNSUPPORTED", null);
        Fact later = chain("api", 2, "PATH", "/api/**");

        AnalysisReport report = execute(List.of(endpoint, unknown, later), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.PARTIAL));

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void preservesAConfirmedFirstMatchWhenOnlyLaterChainDataIsPartial() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact first = chain("api", 1, "PATH", "/api/**");
        Fact laterUnknown = chain("unknown", 2, "UNSUPPORTED", null);

        AnalysisReport report = execute(List.of(endpoint, first, laterUnknown), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.PARTIAL));

        assertEquals(1, report.relations().size());
        assertEquals(first.subjectKey(), report.relations().get(0).targetKey());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void doesNotConfirmAPathWhenEndpointRequestSetIsPartial() {
        Fact endpoint = endpoint("orders", "ANY", "/api/orders");
        Fact chain = chain("get", 1, "METHOD_PATH", "GET /api/orders", "GET");

        AnalysisReport report = execute(List.of(endpoint, chain), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void leavesAllNonMatchingEndpointsWithoutAChainMissingRelation() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact chain = chain("admin", 1, "PATH", "/admin/**");

        AnalysisReport report = execute(List.of(endpoint, chain), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertTrue(report.diagnostics().isEmpty());
        assertEquals(AnalysisStatus.READY, status(report));
    }

    @Test
    void returnsUnknownWhenEndpointOrChainFactsAreMissing() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        AnalysisReport missingChain = execute(List.of(endpoint), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.UNKNOWN));
        assertEquals(AnalysisStatus.UNKNOWN, status(missingChain));
        assertTrue(missingChain.relations().isEmpty());

        Fact chain = chain("api", 1, "PATH", "/api/**");
        AnalysisReport missingEndpoint = execute(List.of(chain), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.UNKNOWN,
                "security-chain", AnalysisStatus.READY));
        assertEquals(AnalysisStatus.UNKNOWN, status(missingEndpoint));
        assertTrue(missingEndpoint.relations().isEmpty());
    }

    @Test
    void doesNotInventGlobalOrderAcrossMultipleFilterChainProxies() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact firstProxy = chain("a", 1, "PATH", "/api/**", "proxy-a");
        Fact secondProxy = chain("b", 1, "PATH", "/api/**", "proxy-b");

        AnalysisReport report = execute(List.of(endpoint, firstProxy, secondProxy), readyStatuses());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.UNKNOWN, status(report));
    }

    @Test
    void ignoresAnUnrelatedPartialCollectorButProducesStableGraphRelation() {
        Fact endpoint = endpoint("orders", "GET", "/api/orders");
        Fact chain = chain("api", 1, "PATH", "/api/**");
        Map<String, AnalysisStatus> statuses = new LinkedHashMap<>(readyStatuses());
        statuses.put("unrelated", AnalysisStatus.PARTIAL);

        AnalysisReport first = execute(List.of(endpoint, chain), statuses);
        AnalysisReport second = execute(List.of(endpoint, chain), statuses);

        assertEquals(first.relations(), second.relations());
        assertEquals(AnalysisStatus.READY, status(first));
        assertEquals(Confidence.CONFIRMED, first.relations().get(0).confidence());

        SecurityGraph graph = new GraphBuilder().build("main", first);
        assertEquals(1, graph.edges().size());
        assertEquals(EdgeType.MATCHED_BY, graph.edges().get(0).type());
    }

    private AnalysisReport execute(List<Fact> facts, Map<String, AnalysisStatus> statuses) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        CollectionReport collectionReport = new CollectionReport(facts, evidence, statuses, List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "main"),
                List.of(new EndpointChainMatchingAnalysisAdapter()));
    }

    private void assertRelation(Relation relation, Fact endpoint, Fact chain) {
        assertEquals(endpoint.subjectKey(), relation.sourceKey());
        assertEquals(chain.subjectKey(), relation.targetKey());
        assertEquals(EdgeType.MATCHED_BY, relation.type());
        assertEquals(Confidence.CONFIRMED, relation.confidence());
        assertEquals(chain.attributes().get("matcherType"), relation.attributes().get("matcherType"));
        assertEquals(chain.attributes().get("matcherCondition"), relation.attributes().get("matcherCondition"));
        assertEquals(chain.attributes().get("chainKey"), relation.attributes().get("chainKey"));
        assertEquals(chain.attributes().get("chainOrder"), relation.attributes().get("chainOrder"));
        assertTrue(relation.evidenceIds().contains(endpoint.evidenceIds().get(0)));
        assertTrue(relation.evidenceIds().contains(chain.evidenceIds().get(0)));
    }

    private AnalysisStatus status(AnalysisReport report) {
        return report.statusByAdapter().get("security-endpoint-chain-matching");
    }

    private void assertFirstChainMatches(String key, String matcherPath, String endpointPath) {
        Fact endpoint = endpoint(key, "GET", endpointPath);
        Fact first = chain(key, 1, "PATH", matcherPath);
        Fact any = chain(key + "-any", 2, "ANY", "ANY");

        AnalysisReport report = execute(List.of(endpoint, first, any), readyStatuses());

        assertEquals(1, report.relations().size());
        assertEquals(first.subjectKey(), report.relations().get(0).targetKey());
        assertEquals(AnalysisStatus.READY, status(report));
    }

    private Map<String, AnalysisStatus> readyStatuses() {
        return Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.READY);
    }

    private Fact endpoint(String key, String method, String path) {
        return endpoint(key, method, path, Map.of());
    }

    private Fact endpoint(String key, String method, String path, Map<String, String> extra) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("httpMethod", method);
        attributes.put("path", path);
        attributes.put("handler", "Orders#handle");
        attributes.put("mvcPathPatternSettings", "DEFAULT");
        attributes.putAll(extra);
        return new Fact("endpoint-fact-" + key, "ENDPOINT_MAPPING", "endpoint|" + key,
                attributes, List.of("endpoint-evidence-" + key));
    }

    private Fact chain(String key, int order, String type, String condition) {
        return chain(key, order, type, condition, "proxy");
    }

    private Fact chain(String key, int order, String type, String condition, String proxyBeanName) {
        return chainWithPathSettings(key, order, type, condition, proxyBeanName,
                condition != null && condition.contains("/") ? "DEFAULT" : null);
    }

    private Fact chainWithPathSettings(
            String key, int order, String type, String condition, String pathPatternSettings) {
        return chainWithPathSettings(key, order, type, condition, "proxy", pathPatternSettings);
    }

    private Fact chainWithPathSettings(
            String key, int order, String type, String condition, String proxyBeanName, String pathPatternSettings) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", proxyBeanName + "|" + key);
        attributes.put("chainOrder", Integer.toString(order));
        attributes.put("matcherType", type);
        attributes.put("proxyBeanName", proxyBeanName);
        if (condition != null) {
            attributes.put("matcherCondition", condition);
        }
        if (pathPatternSettings != null) {
            attributes.put("pathPatternSettings", pathPatternSettings);
        }
        if ("METHOD_PATH".equals(type)) {
            attributes.put("httpMethod", condition.substring(0, condition.indexOf(' ')));
        }
        return new Fact("chain-fact-" + proxyBeanName + "-" + key, "SECURITY_CHAIN",
                "chain|" + proxyBeanName + "|" + key, attributes,
                List.of("chain-evidence-" + proxyBeanName + "-" + key));
    }
}
