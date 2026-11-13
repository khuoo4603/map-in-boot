package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.CollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.SessionUsageCollectorAdapter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

class SessionUsageCollectorAdapterTest {

    @Test
    void collectsSessionOperationsAndSeparatesAuthenticationAndRequestObservations() {
        SessionUsageFixture.called = false;
        LazySessionUsageFixture.initialized = false;
        try (AnnotationConfigApplicationContext context = context()) {
            CollectorAdapter adapter = new SessionUsageCollectorAdapter();
            var result = adapter.collect(new CollectionContext(context, "identity", "instance"));

            assertEquals("security-session-usage", adapter.id());
            assertEquals(Set.of("SESSION_USAGE"), adapter.getSupportedTypes());
            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.diagnostics().isEmpty());
            assertFalse(SessionUsageFixture.called);
            assertFalse(LazySessionUsageFixture.initialized);
            assertTrue(result.evidence().stream()
                    .allMatch(evidence -> evidence.source() == EvidenceSource.CODE_PATTERN));
            assertTrue(result.facts().stream().allMatch(fact ->
                    fact.attributes().containsKey("operation")
                            && fact.attributes().containsKey("codeLocation")
                            && fact.evidenceIds().stream().allMatch(id -> result.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id)))));

            assertEquals(5, facts(result.facts(), "READ").size());
            assertEquals(1, facts(result.facts(), "WRITE").size());
            assertEquals(1, facts(result.facts(), "REMOVE").size());
            assertEquals(2, facts(result.facts(), "ACQUIRE").size());
            assertEquals(1, facts(result.facts(), "INVALIDATE").size());
            assertEquals(1, facts(result.facts(), "AUTH_STATUS").size());
            assertEquals(11, result.facts().size());

            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && "session-key".equals(fact.attributes().get("attributeName"))
                            && "HTTP_SESSION".equals(fact.attributes().get("sourceKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && "local-session-key".equals(fact.attributes().get("attributeName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && !fact.attributes().containsKey("attributeName")));
            assertTrue(result.facts().stream().filter(fact -> "ACQUIRE".equals(fact.attributes().get("operation")))
                    .allMatch(fact -> "SESSION_ACQUISITION".equals(fact.attributes().get("observationKind"))
                            && !fact.attributes().containsKey("attributeName")));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "AUTH_STATUS".equals(fact.attributes().get("operation"))
                            && "AUTHENTICATION".equals(fact.attributes().get("sourceKind"))
                            && "AUTHENTICATION_STATUS".equals(fact.attributes().get("observationKind"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "request-key".equals(fact.attributes().get("attributeName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiOwner", "").contains("OtherSessionLike")));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiName", "").equals("getName")
                            || fact.attributes().getOrDefault("apiName", "").equals("getPrincipal")));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiOwner", "").contains("SecurityContextHolder")));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().values().stream().anyMatch(value -> value.contains("cookie-value"))));
            assertFalse(result.facts().toString().contains("raw-session-value"));
        }
    }

    @Test
    void keepsFactIdsStableAndSeparatesDuplicateCallLocations() {
        try (AnnotationConfigApplicationContext context = context()) {
            SessionUsageCollectorAdapter adapter = new SessionUsageCollectorAdapter();
            var first = adapter.collect(new CollectionContext(context, "identity", "first"));
            var second = adapter.collect(new CollectionContext(context, "identity", "second"));

            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());
            assertEquals(first.facts().size(), first.facts().stream().map(Fact::id).collect(Collectors.toSet()).size());

            List<Fact> duplicateReads = first.facts().stream()
                    .filter(fact -> "READ".equals(fact.attributes().get("operation"))
                            && "session-key".equals(fact.attributes().get("attributeName")))
                    .toList();
            assertEquals(2, duplicateReads.size());
            assertEquals(2, duplicateReads.stream()
                    .map(fact -> fact.attributes().get("occurrence"))
                    .collect(Collectors.toSet()).size());
            assertEquals(2, duplicateReads.stream()
                    .map(Fact::id)
                    .collect(Collectors.toSet()).size());
        }
    }

    @Test
    void keepsUnsupportedContextReadyWithoutFacts() {
        try (AnnotationConfigApplicationContext context = emptyContext()) {
            var result = new SessionUsageCollectorAdapter().collect(
                    new CollectionContext(context, "empty", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.facts().isEmpty());
            assertTrue(result.evidence().isEmpty());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void preservesSuccessfulFactsAndReportsUnavailableClassResource() {
        try (AnnotationConfigApplicationContext context = context(ResourceFailureConfiguration.class)) {
            var result = new SessionUsageCollectorAdapter().collect(
                    new CollectionContext(context, "identity", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "session-key".equals(fact.attributes().get("attributeName"))));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("Class 바이트코드 조회 불가")
                            && diagnostic.summary().contains("ResourceUnavailableFixture")));
            assertTrue(result.diagnostics().stream().allMatch(diagnostic ->
                    !diagnostic.summary().contains("E:\\") && !diagnostic.summary().contains("/")));
        }
    }

    @Test
    void preservesGraphReferencesThroughCollectionProviderAndGraphBuilder() {
        try (AnnotationConfigApplicationContext context = context()) {
            SessionUsageCollectorAdapter adapter = new SessionUsageCollectorAdapter();
            CollectionContext collectionContext = new CollectionContext(context, "identity", "instance");
            CollectionReport collection = new CollectionProvider().execute(collectionContext, List.of(adapter));
            AnalysisReport report = new AnalysisReport(
                    collection, List.of(), collection.evidence(), Map.of(), List.of());

            SecurityGraph graph = new GraphBuilder().build("identity", report);

            assertEquals(collection.facts().size(), graph.nodes().size());
            assertTrue(graph.nodes().stream().allMatch(node ->
                    node.evidenceIds().stream().allMatch(id -> collection.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id)))));
        }
    }

    @Test
    void registersCollectorThroughSecurityAutoConfiguration() {
        try (AnnotationConfigApplicationContext context = context(MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(SessionUsageCollectorAdapter.class).size());
        }
    }

    private List<Fact> facts(List<Fact> facts, String operation) {
        return facts.stream()
                .filter(fact -> operation.equals(fact.attributes().get("operation")))
                .toList();
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
        SessionUsageFixture sessionUsageFixture() {
            return new SessionUsageFixture();
        }

        @Bean
        @Lazy
        LazySessionUsageFixture lazySessionUsageFixture() {
            return new LazySessionUsageFixture();
        }

        @Bean
        Runnable lambdaBean() {
            return () -> {
            };
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class EmptyConfiguration {
    }

    @Configuration(proxyBeanMethods = false)
    static class ResourceFailureConfiguration {

        @Bean
        Object resourceUnavailableFixture() {
            try {
                return new ResourceUnavailableFixtureLoader().load();
            } catch (ReflectiveOperationException exception) {
                throw new IllegalStateException("Resourceless Fixture 생성 실패", exception);
            }
        }
    }

    static class SessionUsageFixture {

        private static boolean called;

        void observe(
                HttpServletRequest request,
                HttpSession session,
                Authentication authentication,
                String dynamicName
        ) {
            called = true;
            session.setAttribute("session-key", "raw-session-value");
            session.getAttribute("session-key");
            session.getAttribute("session-key");
            session.removeAttribute("session-key");

            String localName = "local-session-key";
            session.getAttribute(localName);
            session.getAttribute(dynamicName);

            Object sessionObject = session;
            ((HttpSession) sessionObject).getAttribute("cast-session-key");

            request.setAttribute("request-key", new Object());
            request.getAttribute("request-key");
            request.getSession();
            request.getSession(false);
            request.getCookies();

            session.invalidate();
            authentication.isAuthenticated();
            authentication.getName();
            authentication.getPrincipal();
            SecurityContextHolder.getContext();
            new OtherSessionLike().getAttribute("session-key");
            new OtherAuthentication().isAuthenticated();
        }
    }

    static class OtherSessionLike {

        Object getAttribute(String name) {
            return name;
        }
    }

    static class OtherAuthentication {

        boolean isAuthenticated() {
            return true;
        }
    }

    static class LazySessionUsageFixture {

        private static boolean initialized;

        LazySessionUsageFixture() {
            initialized = true;
        }
    }

    public static class ResourceUnavailableFixture {

        public ResourceUnavailableFixture() {
        }
    }

    static class ResourceUnavailableFixtureLoader extends ClassLoader {

        ResourceUnavailableFixtureLoader() {
            super(ResourceUnavailableFixture.class.getClassLoader());
        }

        Object load() throws ReflectiveOperationException {
            String className = ResourceUnavailableFixture.class.getName();
            String resourceName = className.replace('.', '/') + ".class";
            try (var input = getParent().getResourceAsStream(resourceName)) {
                if (input == null) {
                    throw new IllegalStateException("Resourceless Fixture Bytecode 부재");
                }
                byte[] bytes = input.readAllBytes();
                Class<?> type = defineClass(className, bytes, 0, bytes.length);
                return type.getDeclaredConstructor().newInstance();
            } catch (java.io.IOException exception) {
                throw new IllegalStateException("Resourceless Fixture Bytecode 읽기 실패", exception);
            }
        }

        @Override
        public InputStream getResourceAsStream(String name) {
            if (name.equals(ResourceUnavailableFixture.class.getName().replace('.', '/') + ".class")) {
                return null;
            }
            return super.getResourceAsStream(name);
        }
    }
}
