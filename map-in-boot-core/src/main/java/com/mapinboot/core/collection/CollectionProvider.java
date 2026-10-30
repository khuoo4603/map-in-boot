package com.mapinboot.core.collection;

import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

// Collector 실행 및 수집 결과 집계
public class CollectionProvider {

    public CollectionReport execute(CollectionContext context, Collection<CollectorAdapter> adapters) {
        if (context == null || adapters == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Collection 실행 입력이 올바르지 않습니다.");
        }

        Map<String, CollectorAdapter> registered = register(adapters);
        Map<String, AnalysisStatus> statusByAdapter = new LinkedHashMap<>();
        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        List<CollectorAdapter> pending = new ArrayList<>();
        Set<String> activeIds = new LinkedHashSet<>();

        for (Map.Entry<String, CollectorAdapter> entry : registered.entrySet()) {
            try {
                if (entry.getValue().enabled()) {
                    pending.add(entry.getValue());
                    activeIds.add(entry.getKey());
                }
            } catch (Exception exception) {
                fail(entry.getKey(), ErrorCode.ADAPTER_FAILED, "활성 상태 확인 실패", statusByAdapter, diagnostics);
            }
        }

        while (!pending.isEmpty()) {
            boolean executed = false;
            Iterator<CollectorAdapter> iterator = pending.iterator();

            while (iterator.hasNext()) {
                CollectorAdapter adapter = iterator.next();
                String adapterId = adapter.id();
                boolean waiting = false;
                boolean invalid = false;
                Set<String> dependencies;
                try {
                    dependencies = adapter.dependsOn();
                } catch (Exception exception) {
                    dependencies = null;
                }
                if (dependencies == null) {
                    invalid = true;
                } else {
                    for (String dependencyId : dependencies) {
                        if (dependencyId == null || dependencyId.isBlank()
                                || adapterId.equals(dependencyId)
                                || !registered.containsKey(dependencyId)
                                || !activeIds.contains(dependencyId)) {
                            invalid = true;
                            break;
                        }
                        AnalysisStatus dependencyStatus = statusByAdapter.get(dependencyId);
                        if (dependencyStatus == null) {
                            waiting = true;
                        } else if (dependencyStatus != AnalysisStatus.READY) {
                            invalid = true;
                            break;
                        }
                    }
                }
                if (waiting && !invalid) {
                    continue;
                }
                iterator.remove();
                executed = true;

                if (invalid) {
                    fail(adapterId, ErrorCode.INVALID_CONFIG, "선행 Collector 의존성 미충족", statusByAdapter, diagnostics);
                    continue;
                }
                collect(context, adapter, adapterId, facts, evidence, statusByAdapter, diagnostics);
            }

            if (executed) {
                continue;
            }
            for (CollectorAdapter adapter : pending) {
                fail(adapter.id(), ErrorCode.INVALID_CONFIG, "순환 Collector 의존성", statusByAdapter, diagnostics);
            }
            pending.clear();
        }

        return new CollectionReport(facts, evidence, statusByAdapter, diagnostics);
    }

    private Map<String, CollectorAdapter> register(Collection<CollectorAdapter> adapters) {
        Map<String, CollectorAdapter> registered = new LinkedHashMap<>();

        for (CollectorAdapter adapter : adapters) {
            if (adapter == null) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Collector 등록 정보가 올바르지 않습니다.");
            }
            String adapterId = adapter.id();
            if (adapterId == null || adapterId.isBlank()) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Collector ID가 올바르지 않습니다.");
            }
            if (registered.putIfAbsent(adapterId, adapter) != null) {
                throw new MapInBootException(ErrorCode.DUPLICATE_ADAPTER, "Collector ID가 중복되었습니다.");
            }
        }
        return registered;
    }

    private void collect(
            CollectionContext context,
            CollectorAdapter adapter,
            String adapterId,
            List<Fact> facts,
            List<Evidence> evidence,
            Map<String, AnalysisStatus> statusByAdapter,
            List<AdapterDiagnostic> diagnostics
    ) {
        try {
            CollectionResult result = adapter.collect(context);
            if (result == null || !Objects.equals(adapterId, result.adapterId()) || result.status() == null) {
                fail(adapterId, ErrorCode.ADAPTER_FAILED, "Collector 결과가 올바르지 않습니다.", statusByAdapter, diagnostics);
                return;
            }
            boolean hasConflict = addFacts(adapterId, facts, result.facts(), diagnostics, new LinkedHashSet<>());
            hasConflict |= addEvidence(adapterId, evidence, result.evidence(), diagnostics, new LinkedHashSet<>());
            diagnostics.addAll(result.diagnostics());
            statusByAdapter.put(adapterId, conflictedStatus(result.status(), hasConflict));
        } catch (Exception exception) {
            fail(adapterId, ErrorCode.ADAPTER_FAILED, "Collector 실행 실패", statusByAdapter, diagnostics);
        }
    }

    private void fail(
            String adapterId,
            ErrorCode errorCode,
            String summary,
            Map<String, AnalysisStatus> statusByAdapter,
            List<AdapterDiagnostic> diagnostics
    ) {
        statusByAdapter.put(adapterId, AnalysisStatus.UNKNOWN);
        diagnostics.add(new AdapterDiagnostic(adapterId, errorCode, "Adapter [" + adapterId + "] " + summary));
    }

    private AnalysisStatus conflictedStatus(AnalysisStatus status, boolean hasConflict) {
        return hasConflict && status == AnalysisStatus.READY ? AnalysisStatus.PARTIAL : status;
    }

    private boolean addFacts(
            String adapterId,
            List<Fact> target,
            List<Fact> values,
            List<AdapterDiagnostic> diagnostics,
            Set<String> conflictIds
    ) {
        boolean hasConflict = false;
        for (Fact value : values) {
            if (target.contains(value)) {
                continue;
            }
            if (target.stream().anyMatch(existing -> existing.id().equals(value.id()))) {
                hasConflict = true;
                if (conflictIds.add(value.id())) {
                    diagnostics.add(new AdapterDiagnostic(
                            adapterId, ErrorCode.INVALID_STATE,
                            "Adapter [" + adapterId + "] Fact ID 충돌: " + value.id()));
                }
                continue;
            }
            target.add(value);
        }
        return hasConflict;
    }

    private boolean addEvidence(
            String adapterId,
            List<Evidence> target,
            List<Evidence> values,
            List<AdapterDiagnostic> diagnostics,
            Set<String> conflictIds
    ) {
        boolean hasConflict = false;
        for (Evidence value : values) {
            if (target.contains(value)) {
                continue;
            }
            if (target.stream().anyMatch(existing -> existing.id().equals(value.id()))) {
                hasConflict = true;
                if (conflictIds.add(value.id())) {
                    diagnostics.add(new AdapterDiagnostic(
                            adapterId, ErrorCode.INVALID_STATE,
                            "Adapter [" + adapterId + "] Evidence ID 충돌: " + value.id()));
                }
                continue;
            }
            target.add(value);
        }
        return hasConflict;
    }
}
