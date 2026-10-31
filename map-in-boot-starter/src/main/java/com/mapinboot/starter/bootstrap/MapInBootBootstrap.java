package com.mapinboot.starter.bootstrap;

import com.mapinboot.core.analysis.AnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.CollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.starter.snapshot.LocalSnapshotStore;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import com.mapinboot.starter.snapshot.SnapshotJsonCodec;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationListener;

// 기동 완료 이후 Core 실행 조정 및 결과 보존
public class MapInBootBootstrap implements ApplicationListener<ApplicationReadyEvent> {
    private static final Log log = LogFactory.getLog(MapInBootBootstrap.class);

    private final ApplicationContext applicationContext;
    private final CollectionProvider collectionProvider;
    private final AnalysisProvider analysisProvider;
    private final List<CollectorAdapter> collectorAdapters;
    private final List<AnalysisAdapter> analysisAdapters;
    private final Executor executor;
    private final SnapshotAssembler snapshotAssembler;
    private final SnapshotJsonCodec snapshotJsonCodec;
    private final LocalSnapshotStore snapshotStore;
    private final String instanceId = UUID.randomUUID().toString();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicReference<CollectionReport> collectionReport = new AtomicReference<>();
    private final AtomicReference<AnalysisReport> analysisReport = new AtomicReference<>();
    private final AtomicReference<Snapshot> snapshot = new AtomicReference<>();
    private final AtomicReference<Snapshot> persistedSnapshot = new AtomicReference<>();
    private final AtomicReference<Throwable> failure = new AtomicReference<>();

    public MapInBootBootstrap(
            ApplicationContext applicationContext,
            CollectionProvider collectionProvider,
            AnalysisProvider analysisProvider,
            List<CollectorAdapter> collectorAdapters,
            List<AnalysisAdapter> analysisAdapters,
            Executor executor
    ) {
        this(applicationContext, collectionProvider, analysisProvider, collectorAdapters, analysisAdapters, executor,
                new SnapshotAssembler(List.<FindingEvaluator>of(), "1"), new SnapshotJsonCodec(), null);
    }

    public MapInBootBootstrap(
            ApplicationContext applicationContext,
            CollectionProvider collectionProvider,
            AnalysisProvider analysisProvider,
            List<CollectorAdapter> collectorAdapters,
            List<AnalysisAdapter> analysisAdapters,
            Executor executor,
            SnapshotAssembler snapshotAssembler,
            SnapshotJsonCodec snapshotJsonCodec
    ) {
        this(applicationContext, collectionProvider, analysisProvider, collectorAdapters, analysisAdapters, executor,
                snapshotAssembler, snapshotJsonCodec, null);
    }

    public MapInBootBootstrap(
            ApplicationContext applicationContext,
            CollectionProvider collectionProvider,
            AnalysisProvider analysisProvider,
            List<CollectorAdapter> collectorAdapters,
            List<AnalysisAdapter> analysisAdapters,
            Executor executor,
            SnapshotAssembler snapshotAssembler,
            SnapshotJsonCodec snapshotJsonCodec,
            LocalSnapshotStore snapshotStore
    ) {
        this.applicationContext = applicationContext;
        this.collectionProvider = collectionProvider;
        this.analysisProvider = analysisProvider;
        this.collectorAdapters = List.copyOf(collectorAdapters);
        this.analysisAdapters = List.copyOf(analysisAdapters);
        this.executor = executor;
        this.snapshotAssembler = snapshotAssembler;
        this.snapshotJsonCodec = snapshotJsonCodec;
        this.snapshotStore = snapshotStore;
    }

    // ApplicationReady 이후 단일 비동기 실행 위임
    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (event.getApplicationContext() != applicationContext) {
            return;
        }
        if (!started.compareAndSet(false, true)) {
            return;
        }
        String serviceId = serviceId(event);
        if (serviceId == null) {
            MapInBootException exception = new MapInBootException(
                    ErrorCode.INVALID_CONFIG,
                    "Map in Boot 서비스 식별자를 확인할 수 없습니다.");
            failure.set(exception);
            log.error(failureSummary(exception));
            return;
        }
        try {
            executor.execute(() -> analyze(serviceId));
        } catch (RuntimeException exception) {
            failure.set(exception);
            log.error(failureSummary(exception));
        }
    }

    // 수집 및 분석 결과 보존
    private void analyze(String serviceId) {
        try {
            restorePersistedSnapshot(serviceId);
            CollectionReport collected = collectionProvider.execute(
                    new CollectionContext(applicationContext, serviceId, instanceId), collectorAdapters);
            collectionReport.set(collected);
            AnalysisReport analyzed = analysisProvider.execute(new AnalysisContext(collected, serviceId), analysisAdapters);
            analysisReport.set(analyzed);
            Snapshot assembled = snapshotAssembler.assemble(
                    analyzed, serviceId, instanceId, applicationVersion());
            snapshotJsonCodec.encode(assembled);
            snapshot.set(assembled);
            if (snapshotStore != null) {
                Optional<Snapshot> persisted = snapshotStore.save(
                        assembled, isComplete(collected, analyzed));
                persisted.ifPresent(persistedSnapshot::set);
            }

            if (collectorAdapters.isEmpty() || analysisAdapters.isEmpty()) {
                log.warn("Map in Boot 분석에 필요한 Adapter가 등록되지 않았습니다.");
                return;
            }
            if (hasIncompleteStatus(collected) || hasIncompleteStatus(analyzed)) {
                log.warn("Map in Boot 분석이 부분 상태로 완료되었습니다.");
                return;
            }
            log.info("Map in Boot 분석이 완료되었습니다.");
        } catch (RuntimeException exception) {
            failure.set(exception);
            log.error(failureSummary(exception));
        }
    }

    private String failureSummary(RuntimeException exception) {
        if (exception instanceof MapInBootException mapInBootException) {
            return "Map in Boot 분석 실행 실패: " + mapInBootException.getErrorCode().getCode();
        }
        return "Map in Boot 분석 실행 중 예상하지 못한 오류가 발생했습니다.";
    }

    private String serviceId(ApplicationReadyEvent event) {
        String configuredName = applicationContext.getEnvironment().getProperty("spring.application.name");
        if (configuredName != null && !configuredName.isBlank()) {
            return configuredName;
        }
        Class<?> mainApplicationClass = event.getSpringApplication().getMainApplicationClass();
        if (mainApplicationClass == null || !event.getSpringApplication().getAllSources().contains(mainApplicationClass)) {
            return null;
        }
        return mainApplicationClass.getName();
    }

    private String applicationVersion() {
        String configuredVersion = applicationContext.getEnvironment().getProperty("spring.application.version");
        if (configuredVersion != null && !configuredVersion.isBlank()) {
            return configuredVersion;
        }
        for (BuildProperties buildProperties : applicationContext.getBeansOfType(BuildProperties.class).values()) {
            if (buildProperties.getVersion() != null && !buildProperties.getVersion().isBlank()) {
                return buildProperties.getVersion();
            }
        }
        return "UNKNOWN";
    }

    private void restorePersistedSnapshot(String serviceId) {
        if (snapshotStore == null) {
            return;
        }
        try {
            snapshotStore.loadLatest(serviceId).ifPresent(persistedSnapshot::set);
        } catch (RuntimeException exception) {
            failure.set(exception);
            log.error(failureSummary(exception));
        }
    }

    private boolean hasIncompleteStatus(CollectionReport report) {
        return report.statusByAdapter().containsValue(AnalysisStatus.PARTIAL)
                || report.statusByAdapter().containsValue(AnalysisStatus.UNKNOWN);
    }

    private boolean hasIncompleteStatus(AnalysisReport report) {
        return report.statusByAdapter().containsValue(AnalysisStatus.PARTIAL)
                || report.statusByAdapter().containsValue(AnalysisStatus.UNKNOWN);
    }

    private boolean isComplete(CollectionReport collection, AnalysisReport analysis) {
        if (collection == null || analysis == null) {
            return false;
        }
        Set<String> activeCollectorIds = activeIds(collectorAdapters);
        Set<String> activeAnalyzerIds = activeIds(analysisAdapters);
        if (activeCollectorIds == null || activeAnalyzerIds == null
                || activeCollectorIds.isEmpty()) {
            return false;
        }
        if (!allReady(activeCollectorIds, collection.statusByAdapter())) {
            return false;
        }
        if (!activeAnalyzerIds.isEmpty()
                && !allReady(activeAnalyzerIds, analysis.statusByAdapter())) {
            return false;
        }
        if (activeAnalyzerIds.isEmpty() && !analysis.statusByAdapter().isEmpty()) {
            return false;
        }
        Set<String> requiredFactTypes = requiredStructureTypes(activeCollectorIds);
        if (requiredFactTypes == null) {
            return false;
        }
        Set<String> collectedFactTypes = collection.facts().stream()
                .map(com.mapinboot.core.evidence.Fact::type)
                .collect(java.util.stream.Collectors.toSet());
        return collectedFactTypes.containsAll(requiredFactTypes)
                && !hasIncompleteStatus(collection) && !hasIncompleteStatus(analysis);
    }

    private Set<String> activeIds(List<?> adapters) {
        Set<String> ids = new java.util.HashSet<>();
        try {
            for (Object adapter : adapters) {
                boolean enabled;
                String id;
                if (adapter instanceof CollectorAdapter collectorAdapter) {
                    enabled = collectorAdapter.enabled();
                    id = collectorAdapter.id();
                } else if (adapter instanceof AnalysisAdapter analysisAdapter) {
                    enabled = analysisAdapter.enabled();
                    id = analysisAdapter.id();
                } else {
                    return null;
                }
                if (enabled) {
                    if (id == null || id.isBlank() || !ids.add(id)) {
                        return null;
                    }
                }
            }
            return ids;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private boolean allReady(Set<String> activeIds, java.util.Map<String, AnalysisStatus> statuses) {
        return !statuses.isEmpty()
                && statuses.size() == activeIds.size()
                && statuses.keySet().containsAll(activeIds)
                && statuses.values().stream().allMatch(AnalysisStatus.READY::equals);
    }

    private Set<String> requiredStructureTypes(Set<String> activeCollectorIds) {
        Set<String> required = new java.util.HashSet<>();
        try {
            for (CollectorAdapter adapter : collectorAdapters) {
                if (!activeCollectorIds.contains(adapter.id())) {
                    continue;
                }
                Set<String> supportedTypes = adapter.getSupportedTypes();
                if (supportedTypes == null) {
                    return null;
                }
                for (String type : Set.of("ENDPOINT_MAPPING", "SERVLET_REGISTRATION", "SECURITY_CHAIN")) {
                    if (supportedTypes.contains(type)) {
                        required.add(type);
                    }
                }
            }
            return required;
        } catch (RuntimeException exception) {
            return null;
        }
    }

    CollectionReport collectionReport() {
        return collectionReport.get();
    }

    AnalysisReport analysisReport() {
        return analysisReport.get();
    }

    Snapshot snapshot() {
        return snapshot.get();
    }

    Snapshot persistedSnapshot() {
        return persistedSnapshot.get();
    }

    Throwable failure() {
        return failure.get();
    }
}
