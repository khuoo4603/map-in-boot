package com.mapinboot.starter.bootstrap;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.starter.autoconfigure.MapInBootAutoConfiguration;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapInBootBootstrapTest {
    @Test
    void disabledConfigurationDoesNotCreateBootstrapOrExecutor() {
        try (AnnotationConfigApplicationContext context = context(Map.of("mapinboot.enabled", "false"))) {
            assertFalse(context.containsBean("mapInBootBootstrap"));
            assertFalse(context.containsBean("mapInBootExecutor"));
            assertNotNull(context.getBean(MapInBootProperties.class));
        }
    }

    @Test
    void invalidPropertiesPreventApplicationStartup() {
        assertInvalidProperties(Map.of("mapinboot.web.required-role", ""));
        assertInvalidProperties(Map.of("mapinboot.snapshot.retention-days", "0"));
        assertInvalidProperties(Map.of("mapinboot.snapshot.retention-days", "91"));
        assertInvalidProperties(Map.of("mapinboot.snapshot.directory", " "));
        assertInvalidProperties(Map.of("mapinboot.snapshot.directory", "\u0000"));
    }

    @Test
    void propertiesBindDefaultsAndRetentionBoundaries() {
        try (AnnotationConfigApplicationContext defaultContext = context(Map.of());
             AnnotationConfigApplicationContext minimumContext = context(Map.of("mapinboot.snapshot.retention-days", "1"));
             AnnotationConfigApplicationContext maximumContext = context(Map.of("mapinboot.snapshot.retention-days", "90"))) {
            assertTrue(defaultContext.getBean(MapInBootProperties.class).isEnabled());
            assertFalse(defaultContext.getBean(MapInBootProperties.class).getWeb().isEnabled());
            assertEquals("MAP_IN_BOOT_ADMIN", defaultContext.getBean(MapInBootProperties.class).getWeb().getRequiredRole());
            assertEquals("./mapinboot-data/snapshots",
                    defaultContext.getBean(MapInBootProperties.class).getSnapshot().getDirectory());
            assertEquals(7, defaultContext.getBean(MapInBootProperties.class).getSnapshot().getRetentionDays());
            assertEquals(1, minimumContext.getBean(MapInBootProperties.class).getSnapshot().getRetentionDays());
            assertEquals(90, maximumContext.getBean(MapInBootProperties.class).getSnapshot().getRetentionDays());
        }
    }

    @Test
    void executorShutsDownWhenApplicationContextCloses() {
        AnnotationConfigApplicationContext context = context(Map.of());
        ExecutorService executor = context.getBean("mapInBootExecutor", ExecutorService.class);

        context.close();

        assertTrue(executor.isShutdown());
    }

    @Test
    void bootstrapRunsOnceAfterReadyEventAndPreservesReportsWithoutAdapters() {
        try (AnnotationConfigApplicationContext context = context(Map.of())) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            ApplicationReadyEvent event = readyEvent(context);

            context.publishEvent(event);
            context.publishEvent(event);

            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.collectionReport());
            assertNotNull(bootstrap.analysisReport());
            assertNotNull(bootstrap.snapshot());
            assertTrue(bootstrap.collectionReport().facts().isEmpty());
            assertTrue(bootstrap.analysisReport().relations().isEmpty());
            assertTrue(bootstrap.snapshot().findings().isEmpty());
        }
    }

    @Test
    void bootstrapUsesConfiguredNameBeforeMainApplicationClass() {
        assertServiceId(Map.of("spring.application.name", "configured-service"), "configured-service");
        assertServiceId(Map.of("spring.application.name", ""), TestApplication.class.getName());
    }

    @Test
    void bootstrapUsesApplicationVersionThenBuildPropertiesThenUnknown() {
        try (AnnotationConfigApplicationContext configured = context(
                Map.of("spring.application.name", "test-service", "spring.application.version", "configured-version"),
                AdapterConfiguration.class, BuildPropertiesConfiguration.class)) {
            MapInBootBootstrap bootstrap = configured.getBean(MapInBootBootstrap.class);
            configured.publishEvent(readyEvent(configured));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);
            assertNull(bootstrap.failure());
            assertEquals("configured-version", bootstrap.snapshot().applicationVersion());
        }

        try (AnnotationConfigApplicationContext buildInfo = context(
                Map.of("spring.application.name", "test-service"), AdapterConfiguration.class,
                BuildPropertiesConfiguration.class)) {
            MapInBootBootstrap bootstrap = buildInfo.getBean(MapInBootBootstrap.class);
            buildInfo.publishEvent(readyEvent(buildInfo));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);
            assertNull(bootstrap.failure());
            assertEquals("build-version", bootstrap.snapshot().applicationVersion());
        }

        try (AnnotationConfigApplicationContext unknown = context(
                Map.of("spring.application.name", "test-service"), AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = unknown.getBean(MapInBootBootstrap.class);
            unknown.publishEvent(readyEvent(unknown));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);
            assertNull(bootstrap.failure());
            assertEquals("UNKNOWN", bootstrap.snapshot().applicationVersion());
        }
    }

    @Test
    void bootstrapRecordsFailureWhenNoStableServiceIdIsAvailable() {
        try (AnnotationConfigApplicationContext context = context(Map.of("spring.application.name", ""))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);

            context.publishEvent(readyEvent(context, new SpringApplication()));
            await(() -> bootstrap.failure() != null);

            assertInstanceOf(MapInBootException.class, bootstrap.failure());
            assertNull(bootstrap.collectionReport());
            assertNull(bootstrap.analysisReport());
            assertTrue(context.isActive());
        }
    }

    @Test
    void bootstrapPreservesAdapterReportsAndDoesNotTreatProviderFailureAsCompletion() {
        try (AnnotationConfigApplicationContext context = context(
                Map.of("mapinboot.web.enabled", "false", "spring.application.name", "test-service"),
                AdapterConfiguration.class);
             AnnotationConfigApplicationContext otherContext = new AnnotationConfigApplicationContext()) {
            otherContext.refresh();
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            TestCollector collector = context.getBean(TestCollector.class);
            TestAnalyzer analyzer = context.getBean(TestAnalyzer.class);

            context.publishEvent(readyEvent(otherContext));
            context.publishEvent(readyEvent(context));
            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertEquals(1, collector.calls());
            assertEquals(1, analyzer.calls());
            assertEquals(1, bootstrap.collectionReport().facts().size());
            assertEquals(1, bootstrap.collectionReport().diagnostics().size());
            assertEquals(AnalysisStatus.READY,
                    bootstrap.collectionReport().statusByAdapter().get("collector"));
            assertEquals(1, bootstrap.analysisReport().relations().size());
            assertEquals(AnalysisStatus.PARTIAL,
                    bootstrap.analysisReport().statusByAdapter().get("analyzer"));
            assertNotNull(bootstrap.snapshot());
            assertEquals(AnalysisStatus.PARTIAL,
                    bootstrap.snapshot().analysisStatus().get("analyzer"));
        }

        try (AnnotationConfigApplicationContext context = context(Map.of(), FailingProviderConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);

            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.failure() != null);

            assertInstanceOf(MapInBootException.class, bootstrap.failure());
            assertNull(bootstrap.collectionReport());
            assertNull(bootstrap.analysisReport());
            assertNull(bootstrap.snapshot());
        }
    }

    @Test
    void bootstrapPreservesReportsWhenFindingEvaluationFails() {
        try (AnnotationConfigApplicationContext context = context(
                Map.of("spring.application.name", "test-service"), FailingFindingConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);

            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.failure() != null);

            assertInstanceOf(MapInBootException.class, bootstrap.failure());
            assertNotNull(bootstrap.collectionReport());
            assertNotNull(bootstrap.analysisReport());
            assertNull(bootstrap.snapshot());
        }
    }

    private AnnotationConfigApplicationContext context(Map<String, Object> properties, Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", properties));
        if (configurations.length > 0) {
            context.register(configurations);
        }
        context.register(MapInBootAutoConfiguration.class);
        context.refresh();
        return context;
    }

    private void assertInvalidProperties(Map<String, Object> properties) {
        Exception exception = org.junit.jupiter.api.Assertions.assertThrows(Exception.class, () -> context(properties));
        assertTrue(hasCause(exception, MapInBootException.class));
    }

    private void assertServiceId(Map<String, Object> properties, String expectedServiceId) {
        try (AnnotationConfigApplicationContext context = context(properties, AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            TestCollector collector = context.getBean(TestCollector.class);
            TestAnalyzer analyzer = context.getBean(TestAnalyzer.class);

            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertEquals(expectedServiceId, collector.serviceId());
            assertEquals(expectedServiceId, analyzer.serviceId());
        }
    }

    private boolean hasCause(Throwable throwable, Class<? extends Throwable> type) {
        Throwable current = throwable;
        while (current != null) {
            if (type.isInstance(current)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private ApplicationReadyEvent readyEvent(AnnotationConfigApplicationContext context) {
        SpringApplication application = new SpringApplication(TestApplication.class);
        application.setMainApplicationClass(TestApplication.class);
        return readyEvent(context, application);
    }

    private ApplicationReadyEvent readyEvent(AnnotationConfigApplicationContext context, SpringApplication application) {
        return new ApplicationReadyEvent(application, new String[0], context, Duration.ZERO);
    }

    private void await(Check check) {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        while (!check.done() && System.nanoTime() < deadline) {
            Thread.onSpinWait();
        }
        assertTrue(check.done(), "비동기 분석 결과가 제한 시간 안에 생성되어야 합니다.");
    }

    @FunctionalInterface
    private interface Check {
        boolean done();
    }

    @Configuration(proxyBeanMethods = false)
    static class AdapterConfiguration {
        @Bean
        TestCollector testCollector() {
            return new TestCollector();
        }

        @Bean
        TestAnalyzer testAnalyzer() {
            return new TestAnalyzer();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class FailingProviderConfiguration {
        @Bean
        CollectionProvider collectionProvider() {
            return new CollectionProvider() {
                @Override
                public com.mapinboot.core.collection.model.CollectionReport execute(
                        CollectionContext context,
                        java.util.Collection<com.mapinboot.core.collection.CollectorAdapter> adapters
                ) {
                    throw new MapInBootException(ErrorCode.INVALID_STATE, "Provider failure");
                }
            };
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class FailingFindingConfiguration {
        @Bean
        FindingEvaluator findingEvaluator() {
            return ignored -> {
                throw new IllegalStateException("Finding evaluation failure");
            };
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class BuildPropertiesConfiguration {
        @Bean
        BuildProperties buildProperties() {
            java.util.Properties properties = new java.util.Properties();
            properties.setProperty("version", "build-version");
            return new BuildProperties(properties);
        }
    }

    static class TestCollector extends AbstractCollectorAdapter {
        private final AtomicInteger calls = new AtomicInteger();
        private final AtomicReference<String> serviceId = new AtomicReference<>();

        TestCollector() {
            super("collector", "테스트 수집기", Set.of("ENDPOINT_MAPPING"));
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            calls.incrementAndGet();
            serviceId.set(context.serviceId());
            Evidence evidence = new Evidence("evidence", EvidenceSource.RUNTIME, "endpoint", "테스트 근거");
            Fact fact = new Fact(
                    "fact", "ENDPOINT_MAPPING", "endpoint",
                    Map.of("httpMethod", "GET", "path", "/test", "handler", "TestHandler#handle"),
                    List.of("evidence"));
            AdapterDiagnostic diagnostic = new AdapterDiagnostic("collector", ErrorCode.INVALID_STATE, "부분 확인");
            return new CollectionResult(id(), List.of(fact), List.of(evidence), AnalysisStatus.READY, List.of(diagnostic));
        }

        int calls() {
            return calls.get();
        }

        String serviceId() {
            return serviceId.get();
        }
    }

    static class TestAnalyzer extends AbstractAnalysisAdapter {
        private final AtomicInteger calls = new AtomicInteger();
        private final AtomicReference<String> serviceId = new AtomicReference<>();

        TestAnalyzer() {
            super("analyzer", "테스트 분석기", Set.of(EdgeType.FLOWS_TO.name()));
        }

        @Override
        public Set<String> requiredFactTypes() {
            return Set.of("ENDPOINT_MAPPING");
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            calls.incrementAndGet();
            serviceId.set(context.serviceId());
            Relation relation = new Relation(
                    "relation", "endpoint", "TestHandler#handle", EdgeType.FLOWS_TO,
                    Map.of("flowKind", "HANDLER"), Confidence.CONFIRMED, List.of("evidence"));
            return new AnalysisResult(id(), List.of(relation), List.of(), AnalysisStatus.PARTIAL, List.of());
        }

        int calls() {
            return calls.get();
        }

        String serviceId() {
            return serviceId.get();
        }
    }

    static class TestApplication {
    }
}
