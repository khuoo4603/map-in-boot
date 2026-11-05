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
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.util.List;
import java.util.stream.IntStream;
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
            assertNotNull(chainCollector);
            assertNotNull(analyzer);

            CollectionReport collection = collect(context, chainCollector);
            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get("starter-endpoint-mapping"));
            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get("security-chain"));
            assertTrue(collection.facts().stream().anyMatch(fact -> "ENDPOINT_MAPPING".equals(fact.type())));
            assertTrue(collection.facts().stream().anyMatch(fact -> "SECURITY_CHAIN".equals(fact.type())));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "main"), List.of(analyzer));
            assertEquals(AnalysisStatus.READY, analysis.statusByAdapter().get(analyzer.id()));
            assertEquals(1, analysis.relations().size());

            SecurityGraph graph = new GraphBuilder().build("main", analysis);
            assertEquals(1, graph.edges().size());
            assertTrue(graph.edges().get(0).sourceId() != null);
            assertTrue(graph.edges().get(0).targetId() != null);

            Snapshot snapshot = new SnapshotAssembler(List.of(), "1")
                    .assemble(analysis, "main", "instance", "test");
            assertEquals(1, snapshot.edges().size());
            assertTrue(snapshot.analysisStatus().containsKey(analyzer.id()));
            assertTrue(snapshot.edges().get(0).evidenceIds().stream()
                    .allMatch(id -> snapshot.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
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
            assertEquals(1, analysis.relations().size());
            assertEquals("1", analysis.relations().get(0).attributes().get("chainOrder"));
        }
    }

    @Test
    void discoversSecurityAdaptersThroughAutoConfigurationImports() {
        new ApplicationContextRunner()
                .withUserConfiguration(AutoDiscoveryConfiguration.class)
                .run(context -> {
                    assertEquals(1, context.getBeansOfType(SecurityChainCollectorAdapter.class).size());
                    assertEquals(1, context.getBeansOfType(EndpointChainMatchingAnalysisAdapter.class).size());
                });
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
                    chain(PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/orders")),
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

    @Controller
    static class RuntimeController {

        @RequestMapping(path = "/api/orders", method = RequestMethod.GET)
        public void orders() {
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
}
