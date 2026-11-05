package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import com.mapinboot.security.finding.SecurityRuleEngine;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.util.List;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

class SecurityRuntimeSnapshotIntegrationTest {

    @Test
    void assemblesSnapshotFromRegisteredRuntimeFacts() throws Exception {
        try (AnnotationConfigApplicationContext context = context(CompleteRuntimeConfiguration.class)) {
            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);
            SecurityRuleEngine ruleEngine = context.getBean(SecurityRuleEngine.class);
            assertNotNull(chainCollector);
            assertNotNull(analyzer);

            CollectionReport collection = collect(context, chainCollector);
            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get("starter-endpoint-mapping"));
            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get("security-chain"));
            assertTrue(collection.facts().stream().anyMatch(fact -> "ENDPOINT_MAPPING".equals(fact.type())));
            assertTrue(collection.facts().stream().anyMatch(fact -> "SECURITY_CHAIN".equals(fact.type())));
            assertTrue(collection.facts().stream().anyMatch(fact -> "URL_AUTHORIZATION".equals(fact.type())));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            assertEquals(AnalysisStatus.READY, analysis.statusByAdapter().get(analyzer.id()));
            assertEquals(2, analysis.relations().size());
            assertTrue(analysis.relations().stream().anyMatch(relation -> relation.type() == EdgeType.MATCHED_BY));
            assertTrue(analysis.relations().stream().anyMatch(relation -> relation.type() == EdgeType.SECURED_BY));

            SecurityGraph graph = new GraphBuilder().build("main", analysis);
            assertEquals(2, graph.edges().size());
            assertTrue(graph.edges().get(0).sourceId() != null);
            assertTrue(graph.edges().get(0).targetId() != null);

            Snapshot snapshot = new SnapshotAssembler(List.of(ruleEngine), "1")
                    .assemble(analysis, "main", "instance", "test");
            assertEquals(2, snapshot.edges().size());
            assertTrue(snapshot.findings().isEmpty());
            assertTrue(snapshot.analysisStatus().containsKey(analyzer.id()));
            assertTrue(snapshot.edges().get(0).evidenceIds().stream()
                    .allMatch(id -> snapshot.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
        }
    }

    @Test
    void assemblesSharedHandlerSecuredByEvidenceThroughSnapshotPath() throws Exception {
        try (AnnotationConfigApplicationContext context = context(SharedHandlerRuntimeConfiguration.class)) {
            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);
            CollectionReport collected = collect(context, chainCollector);
            Fact getEndpoint = collected.facts().stream()
                    .filter(fact -> "ENDPOINT_MAPPING".equals(fact.type()))
                    .findFirst().orElseThrow();
            String handler = getEndpoint.attributes().get("handler");
            Fact postEndpoint = new Fact(
                    "endpoint-fact-runtime-post",
                    "ENDPOINT_MAPPING",
                    "endpoint|runtime-post",
                    java.util.Map.of(
                            "httpMethod", "POST",
                            "path", "/api/orders",
                            "handler", handler,
                            "mvcPathPatternSettings", "DEFAULT"),
                    List.of("endpoint-evidence-runtime-post"));
            Evidence postEvidence = new Evidence(
                    "endpoint-evidence-runtime-post", EvidenceSource.RUNTIME, "test", "test endpoint");
            CollectionReport collection = new CollectionReport(
                    Stream.concat(collected.facts().stream(), Stream.of(postEndpoint)).toList(),
                    Stream.concat(collected.evidence().stream(), Stream.of(postEvidence)).toList(),
                    collected.statusByAdapter(), collected.diagnostics());

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            assertEquals(AnalysisStatus.READY, analysis.statusByAdapter().get(analyzer.id()));
            assertEquals(2, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                    .count());
            List<String> securedEvidence = analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                    .findFirst().orElseThrow().evidenceIds();
            assertEquals(1, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                    .count());
            assertTrue(securedEvidence.contains("endpoint-evidence-runtime-post"));
            assertTrue(securedEvidence.contains(getEndpoint.evidenceIds().get(0)));
            assertTrue(analysis.diagnostics().stream().noneMatch(diagnostic ->
                    diagnostic.summary().contains("Relation ID 충돌")));

            SecurityGraph graph = new GraphBuilder().build("main", analysis);
            assertEquals(3, graph.edges().size());
            Snapshot snapshot = new SnapshotAssembler(List.of(), "1")
                    .assemble(analysis, "main", "instance", "test");
            assertEquals(3, snapshot.edges().size());
            assertTrue(snapshot.edges().stream().flatMap(edge -> edge.evidenceIds().stream())
                    .allMatch(id -> snapshot.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id))));
        }
    }

    @Test
    void assemblesPartialSnapshotWithoutConfirmingAChainAfterUnknownMatcher() throws Exception {
        try (AnnotationConfigApplicationContext context = context(PartialRuntimeConfiguration.class)) {
            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);

            CollectionReport collection = collect(context, chainCollector);
            assertEquals(AnalysisStatus.PARTIAL, collection.statusByAdapter().get("security-chain"));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            assertEquals(AnalysisStatus.PARTIAL, analysis.statusByAdapter().get(analyzer.id()));
            assertTrue(analysis.relations().isEmpty());

            Snapshot snapshot = new SnapshotAssembler(List.of(), "1")
                    .assemble(analysis, "main", "instance", "test");
            assertTrue(snapshot.edges().isEmpty());
            assertEquals(AnalysisStatus.PARTIAL, snapshot.analysisStatus().get(analyzer.id()));
        }
    }

    @Test
    void keepsGetEndpointAnalysisSeparateFromActualHeadChainSelection() throws Exception {
        try (AnnotationConfigApplicationContext context = context(CompleteRuntimeConfiguration.class)) {
            FilterChainProxy proxy = context.getBean(FilterChainProxy.class);
            assertEquals(0, firstMatchingChain(proxy, "GET"));
            assertEquals(1, firstMatchingChain(proxy, "HEAD"));

            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);
            CollectionReport collection = collect(context, chainCollector);
            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));

            assertEquals(1, collection.facts().stream()
                    .filter(fact -> "ENDPOINT_MAPPING".equals(fact.type())).count());
            assertEquals("GET", collection.facts().stream()
                    .filter(fact -> "ENDPOINT_MAPPING".equals(fact.type()))
                    .findFirst().orElseThrow().attributes().get("httpMethod"));
            assertEquals(2, analysis.relations().size());
            assertEquals(1, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                    .count());
            assertEquals(1, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                    .count());
            assertEquals("1", analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                    .findFirst().orElseThrow().attributes().get("chainOrder"));
        }
    }

    @Test
    void discoversSecurityAdaptersThroughAutoConfigurationImports() {
        new ApplicationContextRunner()
                .withUserConfiguration(AutoDiscoveryConfiguration.class)
                .run(context -> {
                    assertEquals(1, context.getBeansOfType(SecurityChainCollectorAdapter.class).size());
                    assertEquals(1, context.getBeansOfType(EndpointChainMatchingAnalysisAdapter.class).size());
                    assertEquals(1, context.getBeansOfType(SecurityRuleEngine.class).size());
                });
    }

    @Test
    void assemblesLikelyChainOrderRuntimeFromProvenUrlPolicyCovering() throws Exception {
        try (AnnotationConfigApplicationContext context = context(ChainOrderRuntimeConfiguration.class)) {
            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);
            SecurityRuleEngine ruleEngine = context.getBean(SecurityRuleEngine.class);

            CollectionReport collection = collect(context, chainCollector);
            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            Snapshot snapshot = new SnapshotAssembler(List.of(ruleEngine), "1")
                    .assemble(analysis, "main", "instance", "test");

            assertEquals(1, context.getBeansOfType(com.mapinboot.core.finding.FindingEvaluator.class).size());
            assertEquals(1, snapshot.findings().size());
            assertEquals("CHAIN_ORDER", snapshot.findings().get(0).ruleId());
            assertEquals(Confidence.LIKELY, snapshot.findings().get(0).confidence());
            assertTrue(snapshot.evidence().stream()
                    .map(Evidence::id)
                    .collect(java.util.stream.Collectors.toSet())
                    .containsAll(snapshot.findings().get(0).evidenceIds()));
        }
    }

    @Test
    void assemblesPublicRuntimeWithoutFindingWhenProtectionRequirementIsUnavailable() throws Exception {
        try (AnnotationConfigApplicationContext context = context(PublicRuntimeConfiguration.class)) {
            SecurityChainCollectorAdapter chainCollector = context.getBean(SecurityChainCollectorAdapter.class);
            EndpointChainMatchingAnalysisAdapter analyzer = context.getBean(EndpointChainMatchingAnalysisAdapter.class);
            SecurityRuleEngine ruleEngine = context.getBean(SecurityRuleEngine.class);

            CollectionReport collection = collect(context, chainCollector);
            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            Snapshot snapshot = new SnapshotAssembler(List.of(ruleEngine), "1")
                    .assemble(analysis, "main", "instance", "test");

            assertEquals(1, context.getBeansOfType(com.mapinboot.core.finding.FindingEvaluator.class).size());
            assertTrue(snapshot.findings().isEmpty());
            assertTrue(snapshot.edges().stream().flatMap(edge -> edge.evidenceIds().stream())
                    .allMatch(id -> snapshot.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
        }
    }

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configuration, MapInBootSecurityAutoConfiguration.class);
        context.refresh();
        return context;
    }

    private CollectionReport collect(
            AnnotationConfigApplicationContext context, SecurityChainCollectorAdapter chainCollector) {
        return new CollectionProvider().execute(
                new CollectionContext(context, "main", "instance"),
                List.of(new EndpointMappingCollectorAdapter(), chainCollector));
    }

    private int firstMatchingChain(FilterChainProxy proxy, String method) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/orders");
        request.setServletPath("/api/orders");
        return IntStream.range(0, proxy.getFilterChains().size())
                .filter(index -> ((DefaultSecurityFilterChain) proxy.getFilterChains().get(index))
                        .getRequestMatcher().matches(request))
                .findFirst()
                .orElse(-1);
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration(exclude = com.mapinboot.starter.autoconfigure.MapInBootAutoConfiguration.class)
    static class AutoDiscoveryConfiguration {
    }

    @Configuration(proxyBeanMethods = false)
    static class CompleteRuntimeConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    chain(PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/orders"), authorizationFilter()),
                    chain(AnyRequestMatcher.INSTANCE)));
        }

        private AuthorizationFilter authorizationFilter() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .authenticated()
                            .build();
            return new AuthorizationFilter(manager);
        }

        @Bean
        RuntimeController runtimeController() {
            return new RuntimeController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class SharedHandlerRuntimeConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    chain(PathPatternRequestMatcher.pathPattern("/api/orders"), authorizationFilter()),
                    chain(AnyRequestMatcher.INSTANCE)));
        }

        private AuthorizationFilter authorizationFilter() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .authenticated()
                            .build();
            return new AuthorizationFilter(manager);
        }

        @Bean
        RuntimeController runtimeController() {
            return new RuntimeController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class PartialRuntimeConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    chain(new UnsupportedMatcher()),
                    chain(AnyRequestMatcher.INSTANCE)));
        }

        @Bean
        RuntimeController runtimeController() {
            return new RuntimeController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class ChainOrderRuntimeConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    chain(PathPatternRequestMatcher.pathPattern("/api/reports/**"), permitAllFilter()),
                    chain(PathPatternRequestMatcher.pathPattern("/api/reports/summary"), authorityFilter())));
        }

        private AuthorizationFilter permitAllFilter() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .permitAll()
                            .build();
            return new AuthorizationFilter(manager);
        }

        private AuthorizationFilter authorityFilter() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .hasAuthority("ROLE_STAFF")
                            .build();
            return new AuthorizationFilter(manager);
        }

        @Bean
        ReportsController reportsController() {
            return new ReportsController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class PublicRuntimeConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    chain(PathPatternRequestMatcher.pathPattern("/api/public/notices"), permitAllFilter())));
        }

        private AuthorizationFilter permitAllFilter() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .permitAll()
                            .build();
            return new AuthorizationFilter(manager);
        }

        @Bean
        PublicRuntimeController publicRuntimeController() {
            return new PublicRuntimeController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Controller
    static class RuntimeController {

        @RequestMapping(path = "/api/orders", method = RequestMethod.GET)
        public void orders() {
        }
    }

    @Controller
    static class ReportsController {

        @RequestMapping(path = "/api/reports/summary", method = RequestMethod.GET)
        public void summary() {
        }
    }

    @Controller
    static class PublicRuntimeController {

        @RequestMapping(path = "/api/public/notices", method = RequestMethod.GET)
        public void notices() {
        }
    }

    static class UnsupportedMatcher implements RequestMatcher {
        @Override
        public boolean matches(jakarta.servlet.http.HttpServletRequest request) {
            return true;
        }
    }

    private static SecurityFilterChain chain(RequestMatcher matcher) {
        return new DefaultSecurityFilterChain(matcher, List.of());
    }

    private static SecurityFilterChain chain(RequestMatcher matcher, AuthorizationFilter authorizationFilter) {
        return new DefaultSecurityFilterChain(matcher, List.of(authorizationFilter));
    }
}
