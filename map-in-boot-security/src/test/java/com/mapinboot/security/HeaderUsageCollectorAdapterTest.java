package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.HeaderUsageCollectorAdapter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

class HeaderUsageCollectorAdapterTest {

    @Test
    void collectsHeaderDeclarationsAndServletReadsWithoutTrustOrCrossSourceFacts() {
        try (AnnotationConfigApplicationContext context = context()) {
            HeaderUsageCollectorAdapter adapter = new HeaderUsageCollectorAdapter();
            var result = adapter.collect(new CollectionContext(context, "account", "instance"));

            assertEquals("security-header-usage", adapter.id());
            assertEquals(Set.of("HEADER_USAGE"), adapter.getSupportedTypes());
            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertTrue(result.facts().stream().allMatch(fact ->
                    fact.type().equals("HEADER_USAGE")
                            && fact.attributes().containsKey("headerName")
                            && fact.attributes().containsKey("codeLocation")
                            && fact.evidenceIds().stream().allMatch(id -> result.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id)))));
            assertTrue(result.evidence().stream().anyMatch(evidence ->
                    evidence.source() == EvidenceSource.DECLARATION));
            assertTrue(result.evidence().stream().anyMatch(evidence ->
                    evidence.source() == EvidenceSource.CODE_PATTERN));

            assertTrue(result.facts().stream().anyMatch(fact ->
                    "X-Staff-Id".equals(fact.attributes().get("headerName"))
                            && "REQUEST_HEADER".equals(fact.attributes().get("sourceKind"))
                            && "false".equals(fact.attributes().get("required"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "X-Authenticated-User".equals(fact.attributes().get("headerName"))
                            && "true".equals(fact.attributes().get("hasDefaultValue"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "Authorization".equals(fact.attributes().get("headerName"))
                            && "SERVLET_REQUEST".equals(fact.attributes().get("sourceKind"))
                            && "getHeader".equals(fact.attributes().get("apiName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "X-Authenticated-User".equals(fact.attributes().get("headerName"))
                            && "getHeaders".equals(fact.attributes().get("apiName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "unknown".equalsIgnoreCase(fact.attributes().get("headerName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "optionalHeader".equals(fact.attributes().get("headerName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiOwner", "").contains("HttpServletResponse")));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiOwner", "").contains("Map")));
            assertFalse(result.facts().toString().contains("raw-header-value"));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("Header 이름")
                            || diagnostic.summary().contains("동적 Header")));
        }
    }

    @Test
    void keepsHeaderFactIdsStableAndSeparatesDuplicateReads() {
        try (AnnotationConfigApplicationContext context = context()) {
            HeaderUsageCollectorAdapter adapter = new HeaderUsageCollectorAdapter();
            var first = adapter.collect(new CollectionContext(context, "account", "first"));
            var second = adapter.collect(new CollectionContext(context, "account", "second"));

            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());
            assertEquals(first.facts().size(), first.facts().stream()
                    .map(Fact::id).collect(Collectors.toSet()).size());
            assertEquals(3, first.facts().stream()
                    .filter(fact -> "Authorization".equals(fact.attributes().get("headerName")))
                    .count());
        }
    }

    @Test
    void keepsUnsupportedContextReadyWithoutFacts() {
        try (AnnotationConfigApplicationContext context = emptyContext()) {
            var result = new HeaderUsageCollectorAdapter().collect(
                    new CollectionContext(context, "empty", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.facts().isEmpty());
            assertTrue(result.evidence().isEmpty());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void preservesHeaderFactReferencesThroughGraphBuilder() {
        try (AnnotationConfigApplicationContext context = context()) {
            HeaderUsageCollectorAdapter adapter = new HeaderUsageCollectorAdapter();
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "account", "instance"), List.of(adapter));
            AnalysisReport report = new AnalysisReport(
                    collection, List.of(), collection.evidence(), Map.of(), List.of());

            SecurityGraph graph = new GraphBuilder().build("account", report);

            assertEquals(collection.facts().size(), graph.nodes().size());
        }
    }

    @Test
    void registersHeaderCollectorThroughSecurityAutoConfiguration() {
        try (AnnotationConfigApplicationContext context = context(MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(HeaderUsageCollectorAdapter.class).size());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(FixtureConfiguration.class);
        if (configurations.length > 0) {
            context.register(configurations);
        }
        context.refresh();
        return context;
    }

    private AnnotationConfigApplicationContext emptyContext() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(EmptyConfiguration.class);
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class FixtureConfiguration {

        @Bean
        HeaderFixture headerFixture() {
            return new HeaderFixture();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class EmptyConfiguration {
    }

    @RestController
    static class HeaderFixture {

        @GetMapping("/named")
        void named(@RequestHeader(name = "X-Staff-Id", required = false) String staffId) {
        }

        @GetMapping("/value")
        void value(@RequestHeader(value = "X-Authenticated-User", required = false,
                defaultValue = "fallback") String userId) {
        }

        @GetMapping("/inferred")
        void inferred(@RequestHeader(required = false, defaultValue = "fallback") String optionalHeader) {
        }

        void observe(HttpServletRequest request, HttpServletResponse response, String dynamicName) {
            request.getHeader("Authorization");
            request.getHeaders("X-Authenticated-User");
            request.getHeaderNames();
            request.getHeader(dynamicName);
            request.getAttribute("X-Staff-Id");
            response.setHeader("X-Staff-Id", "raw-header-value");
            Map.of("Authorization", "raw-map-value").get("Authorization");
        }

        void duplicate(HttpServletRequest request) {
            request.getHeader("Authorization");
            request.getHeader("Authorization");
        }
    }
}
