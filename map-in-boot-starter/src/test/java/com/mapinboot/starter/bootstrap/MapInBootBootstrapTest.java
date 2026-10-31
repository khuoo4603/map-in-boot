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
import com.mapinboot.starter.snapshot.LocalSnapshotStore;
import java.time.Duration;
import java.time.Instant;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
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
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapInBootBootstrapTest {
    @TempDir
    Path tempDirectory;

    @Test
    void disabledConfigurationDoesNotCreateBootstrapOrExecutor() {
        try (AnnotationConfigApplicationContext context = context(Map.of("mapinboot.enabled", "false"))) {
            assertFalse(context.containsBean("mapInBootBootstrap"));
            assertFalse(context.containsBean("mapInBootExecutor"));
            assertFalse(context.containsBean("localSnapshotStore"));
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
        try (AnnotationConfigApplicationContext defaultContext = contextWithoutTempDirectory(Map.of());
             AnnotationConfigApplicationContext minimumContext = contextWithoutTempDirectory(Map.of("mapinboot.snapshot.retention-days", "1"));
             AnnotationConfigApplicationContext maximumContext = contextWithoutTempDirectory(Map.of("mapinboot.snapshot.retention-days", "90"))) {
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

    @Test
    void bootstrapPersistsSnapshotAndRestoresItBeforeNextAnalysis() throws Exception {
        Path directory = tempDirectory.resolve("snapshots");
        String serviceName = "persisted-service";
        String snapshotId;

        try (AnnotationConfigApplicationContext first = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), ReadyAdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = first.getBean(MapInBootBootstrap.class);
            assertNotNull(first.getBean(LocalSnapshotStore.class));

            first.publishEvent(readyEvent(first));
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.snapshot());
            assertNotNull(bootstrap.persistedSnapshot());
            snapshotId = bootstrap.persistedSnapshot().snapshotId();
            assertEquals(1, fileCount(directory));
        }

        try (AnnotationConfigApplicationContext second = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), ReadyAdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = second.getBean(MapInBootBootstrap.class);
            Instant restoredCapturedAt = second.getBean(LocalSnapshotStore.class)
                    .loadLatest(serviceName).orElseThrow().capturedAt();
            assertNull(bootstrap.persistedSnapshot());

            second.publishEvent(readyEvent(second));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);
            await(() -> bootstrap.failure() == null && bootstrap.snapshot() != null
                    && bootstrap.persistedSnapshot() != null
                    && bootstrap.persistedSnapshot().capturedAt().isAfter(restoredCapturedAt));

            assertNull(bootstrap.failure());
            assertEquals(snapshotId, bootstrap.persistedSnapshot().snapshotId());
            assertNotEquals(snapshotId, bootstrap.snapshot().snapshotId());
            assertEquals(bootstrap.persistedSnapshot().graphFingerprint(), bootstrap.snapshot().graphFingerprint());
        }
    }

    @Test
    void partialAnalysisKeepsPreviousPersistedSnapshot() throws Exception {
        Path directory = tempDirectory.resolve("partial-snapshots");
        String serviceName = "partial-service";
        String snapshotId;

        try (AnnotationConfigApplicationContext first = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), ReadyAdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = first.getBean(MapInBootBootstrap.class);
            first.publishEvent(readyEvent(first));
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failure() != null);
            assertNull(bootstrap.failure());
            snapshotId = bootstrap.persistedSnapshot().snapshotId();
        }

        try (AnnotationConfigApplicationContext second = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = second.getBean(MapInBootBootstrap.class);
            second.publishEvent(readyEvent(second));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertEquals(snapshotId, bootstrap.persistedSnapshot().snapshotId());
            assertEquals(1, fileCount(directory));
        }
    }

    @Test
    void firstPartialSnapshotIsNotPromotedToCompleteAfterRestart() throws Exception {
        Path directory = tempDirectory.resolve("first-partial-snapshots");
        String serviceName = "first-partial-service";

        try (AnnotationConfigApplicationContext first = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = first.getBean(MapInBootBootstrap.class);
            first.publishEvent(readyEvent(first));
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failure() != null);
            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.persistedSnapshot());
            assertEquals(AnalysisStatus.PARTIAL,
                    bootstrap.persistedSnapshot().analysisStatus().get("analyzer"));
        }

        try (AnnotationConfigApplicationContext second = context(Map.of(
                "spring.application.name", serviceName,
                "mapinboot.snapshot.directory", directory.toString()), AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = second.getBean(MapInBootBootstrap.class);
            second.publishEvent(readyEvent(second));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.persistedSnapshot());
            assertEquals(AnalysisStatus.PARTIAL,
                    bootstrap.persistedSnapshot().analysisStatus().get("analyzer"));
        }
    }

    @Test
    void readyAdaptersWithoutRequiredEndpointStructureAreNotPersistedAsComplete() {
        try (AnnotationConfigApplicationContext context = context(Map.of(
                "spring.application.name", "missing-structure-service"), MissingStructureConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.snapshot() != null || bootstrap.failure() != null);
            await(() -> "PARTIAL".equals(bootstrap.executionPhase()) || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.collectionReport());
            assertEquals(AnalysisStatus.READY,
                    bootstrap.collectionReport().statusByAdapter().get("starter-endpoint-mapping"));
            assertNotNull(bootstrap.analysisReport());
            assertEquals(AnalysisStatus.READY,
                    bootstrap.analysisReport().statusByAdapter().get("analyzer"));
            assertNotNull(bootstrap.snapshot());
            assertNull(bootstrap.persistedSnapshot());
            assertEquals("PARTIAL", bootstrap.executionPhase());
        }
    }

    @Test
    void restoreRunsOnExecutorAndDoesNotBlockReadyEventThread() {
        AtomicReference<Runnable> task = new AtomicReference<>();
        Executor deferredExecutor = task::set;
        try (AnnotationConfigApplicationContext context = context(
                Map.of(), deferredExecutor, SlowSnapshotStoreConfiguration.class, AdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            long start = System.nanoTime();

            context.publishEvent(readyEvent(context));

            long elapsedMillis = Duration.ofNanos(System.nanoTime() - start).toMillis();
            assertTrue(elapsedMillis < 500, "ApplicationReadyEvent 처리에서 복원 작업을 동기 실행하지 않아야 합니다.");
            assertNotNull(task.get());
            assertNull(bootstrap.collectionReport());
        }
    }

    @Test
    void snapshotWriteFailureKeepsCurrentAnalysisSeparateFromPersistedSnapshot() throws Exception {
        Path file = tempDirectory.resolve("snapshot-file");
        Files.writeString(file, "existing");

        try (AnnotationConfigApplicationContext context = context(Map.of(
                "spring.application.name", "write-failure-service",
                "mapinboot.snapshot.directory", file.toString()), ReadyAdapterConfiguration.class)) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            context.publishEvent(readyEvent(context));
            await(() -> bootstrap.failure() instanceof MapInBootException exception
                    && exception.getErrorCode() == ErrorCode.SNAPSHOT_WRITE_FAILED);

            assertInstanceOf(MapInBootException.class, bootstrap.failure());
            assertEquals(ErrorCode.SNAPSHOT_WRITE_FAILED,
                    ((MapInBootException) bootstrap.failure()).getErrorCode());
            assertEquals("FAILED", bootstrap.executionPhase());
            assertEquals(ErrorCode.SNAPSHOT_WRITE_FAILED.getCode(), bootstrap.failureCode());
            assertNotNull(bootstrap.snapshot());
            assertNull(bootstrap.persistedSnapshot());
            assertEquals("existing", Files.readString(file));
        }
    }

    private AnnotationConfigApplicationContext context(Map<String, Object> properties, Class<?>... configurations) {
        return context(properties, true, configurations);
    }

    private AnnotationConfigApplicationContext contextWithoutTempDirectory(
            Map<String, Object> properties, Class<?>... configurations) {
        return context(properties, false, configurations);
    }

    private AnnotationConfigApplicationContext context(
            Map<String, Object> properties, boolean temporaryDirectory, Class<?>... configurations) {
        return context(properties, null, temporaryDirectory, configurations);
    }

    private AnnotationConfigApplicationContext context(
            Map<String, Object> properties, Executor executor, Class<?>... configurations) {
        return context(properties, executor, true, configurations);
    }

    private AnnotationConfigApplicationContext context(
            Map<String, Object> properties, Executor executor, boolean temporaryDirectory, Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        Map<String, Object> contextProperties = new HashMap<>(properties);
        if (temporaryDirectory) {
            contextProperties.putIfAbsent("mapinboot.snapshot.directory",
                    tempDirectory.resolve("context-" + System.nanoTime()).toString());
        }
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", contextProperties));
        if (configurations.length > 0) {
            context.register(configurations);
        }
        if (executor != null) {
            context.registerBean("mapInBootExecutor", ExecutorService.class,
                    () -> new DelegatingExecutorService(executor));
        }
        context.register(MapInBootAutoConfiguration.class);
        context.refresh();
        return context;
    }

    private static final class DelegatingExecutorService extends java.util.concurrent.AbstractExecutorService {
        private final Executor delegate;

        private DelegatingExecutorService(Executor delegate) {
            this.delegate = delegate;
        }

        @Override
        public void shutdown() {
        }

        @Override
        public List<Runnable> shutdownNow() {
            return List.of();
        }

        @Override
        public boolean isShutdown() {
            return false;
        }

        @Override
        public boolean isTerminated() {
            return false;
        }

        @Override
        public boolean awaitTermination(long timeout, java.util.concurrent.TimeUnit unit) {
            return false;
        }

        @Override
        public void execute(Runnable command) {
            delegate.execute(command);
        }
    }

    private long fileCount(Path directory) throws java.io.IOException {
        try (java.util.stream.Stream<Path> paths = Files.list(directory)) {
            return paths.count();
        }
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
    static class ReadyAdapterConfiguration {
        @Bean
        ReadyCollector readyCollector() {
            return new ReadyCollector();
        }

        @Bean
        ReadyAnalyzer readyAnalyzer() {
            return new ReadyAnalyzer();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class MissingStructureConfiguration {
        @Bean
        MissingStructureCollector missingStructureCollector() {
            return new MissingStructureCollector();
        }

        @Bean
        EmptyReadyAnalyzer emptyReadyAnalyzer() {
            return new EmptyReadyAnalyzer();
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

    @Configuration(proxyBeanMethods = false)
    static class SlowSnapshotStoreConfiguration {
        @Bean
        LocalSnapshotStore localSnapshotStore() {
            return new SlowSnapshotStore();
        }
    }

    static class SlowSnapshotStore extends LocalSnapshotStore {
        SlowSnapshotStore() {
            super(Path.of("slow-snapshot-store"), 7, new com.mapinboot.starter.snapshot.SnapshotJsonCodec());
        }

        @Override
        public java.util.Optional<com.mapinboot.core.snapshot.Snapshot> loadLatest(String serviceId) {
            try {
                Thread.sleep(750);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
            return java.util.Optional.empty();
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

    static class ReadyCollector extends TestCollector {
        @Override
        public CollectionResult collect(CollectionContext context) {
            CollectionResult result = super.collect(context);
            return new CollectionResult(result.adapterId(), result.facts(), result.evidence(), AnalysisStatus.READY,
                    result.diagnostics());
        }
    }

    static class MissingStructureCollector extends AbstractCollectorAdapter {
        MissingStructureCollector() {
            super("starter-endpoint-mapping", "필수 Endpoint 구조 없는 테스트 수집기", Set.of("ENDPOINT_MAPPING"));
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.READY, List.of());
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

    static class ReadyAnalyzer extends TestAnalyzer {
        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            AnalysisResult result = super.analyze(context);
            return new AnalysisResult(result.adapterId(), result.relations(), result.additionalEvidence(), AnalysisStatus.READY,
                    result.diagnostics());
        }
    }

    static class EmptyReadyAnalyzer extends AbstractAnalysisAdapter {
        EmptyReadyAnalyzer() {
            super("analyzer", "빈 구조 테스트 분석기", Set.of());
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.READY, List.of());
        }
    }

    static class TestApplication {
    }
}
