package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AndRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

class SecurityChainCollectorAdapterTest {

    @Test
    void collectsRuntimeChainsAndPreservesRegisteredOrder() {
        try (AnnotationConfigApplicationContext context = context(RuntimeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertEquals(3, result.facts().size());
            assertEquals(List.of("1", "2", "3"), result.facts().stream()
                    .map(fact -> fact.attributes().get("chainOrder"))
                    .toList());
            assertEquals("PATH", result.facts().get(0).attributes().get("matcherType"));
            assertEquals("METHOD_PATH", result.facts().get(1).attributes().get("matcherType"));
            assertEquals("NEGATED", result.facts().get(2).attributes().get("matcherType"));
            assertEquals(3, result.evidence().size());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void preservesCompositeMatcherConditionsAndReportsUnsupportedMatcher() {
        try (AnnotationConfigApplicationContext context = context(CompositeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            Fact composite = result.facts().get(0);
            assertEquals("AND", composite.attributes().get("matcherType"));
            assertEquals("AND(GET /api/orders,NOT(/api/orders))",
                    composite.attributes().get("matcherCondition"));
            assertEquals("OR", result.facts().get(1).attributes().get("matcherType"));
            assertEquals("OR(GET /api/orders,NOT(/api/orders))",
                    result.facts().get(1).attributes().get("matcherCondition"));
            assertEquals("UNSUPPORTED", result.facts().get(2).attributes().get("matcherType"));
            assertEquals(1, result.diagnostics().size());
            assertFalse(result.diagnostics().get(0).summary().isBlank());
        }
    }

    @Test
    void returnsUnknownWhenFilterChainProxyIsUnavailable() {
        try (AnnotationConfigApplicationContext context = context(NoSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.UNKNOWN, result.status());
            assertTrue(result.facts().isEmpty());
            assertTrue(result.evidence().isEmpty());
            assertEquals(1, result.diagnostics().size());
        }
    }

    @Test
    void createsDeterministicIdsCompatibleWithGraphBuilder() {
        try (AnnotationConfigApplicationContext context = context(RuntimeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();
            CollectionResult first = adapter.collect(new CollectionContext(context, "main", "instance-a"));
            CollectionResult second = adapter.collect(new CollectionContext(context, "main", "instance-b"));

            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());

            CollectionReport report = new CollectionReport(
                    first.facts(), first.evidence(), Map.of(adapter.id(), first.status()), first.diagnostics());
            AnalysisReport analysisReport = new AnalysisReport(
                    report, List.of(), first.evidence(), Map.of(), List.of());
            SecurityGraph graph = new GraphBuilder().build("main", analysisReport);

            assertEquals(first.facts().size(), graph.nodes().size());
            assertTrue(graph.nodes().stream().allMatch(node -> node.type().name().equals("SECURITY_CHAIN")));
            assertNotNull(graph.nodes().get(0).id());
        }
    }

    @Test
    void registersCollectorWhenSecurityRuntimeIsAvailable() {
        try (AnnotationConfigApplicationContext withSecurity = context(
                RuntimeSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, withSecurity.getBeansOfType(SecurityChainCollectorAdapter.class).size());
        }
        try (AnnotationConfigApplicationContext withoutSecurity = context(
                NoSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, withoutSecurity.getBeansOfType(SecurityChainCollectorAdapter.class).size());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        return context(configuration, MapInBootSecurityAutoConfiguration.class);
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configurations);
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class RuntimeSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            List<SecurityFilterChain> chains = List.of(
                    chain(PathPatternRequestMatcher.pathPattern("/api/**")),
                    chain(PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/orders")),
                    chain(new NegatedRequestMatcher(PathPatternRequestMatcher.pathPattern("/api/admin/**"))));
            return new FilterChainProxy(chains);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class CompositeSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcher orders = PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/orders");
            RequestMatcher excluded = new NegatedRequestMatcher(PathPatternRequestMatcher.pathPattern("/api/orders"));
            List<SecurityFilterChain> chains = List.of(
                    chain(new AndRequestMatcher(orders, excluded)),
                    chain(new OrRequestMatcher(orders, excluded)),
                    chain(new UnsupportedMatcher()));
            return new FilterChainProxy(chains);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class NoSecurityConfiguration {
    }

    private static SecurityFilterChain chain(RequestMatcher matcher) {
        return new DefaultSecurityFilterChain(matcher, List.of());
    }

    static class UnsupportedMatcher implements RequestMatcher {
        @Override
        public boolean matches(jakarta.servlet.http.HttpServletRequest request) {
            return true;
        }
    }
}
