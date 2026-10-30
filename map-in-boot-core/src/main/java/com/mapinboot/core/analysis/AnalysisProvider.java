package com.mapinboot.core.analysis;

import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

// Analyzer 실행 및 분석 결과 집계
public class AnalysisProvider {

    public AnalysisReport execute(AnalysisContext context, Collection<AnalysisAdapter> adapters) {
        if (context == null || context.collectionReport() == null || adapters == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Analysis 실행 입력이 올바르지 않습니다.");
        }

        CollectionReport collectionReport = context.collectionReport();
        Map<String, AnalysisAdapter> registered = register(adapters);
        Map<String, AnalysisStatus> statusByAdapter = new LinkedHashMap<>();
        List<Relation> relations = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>(collectionReport.evidence());
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Set<String> factTypes = new LinkedHashSet<>();

        for (Fact fact : collectionReport.facts()) {
            factTypes.add(fact.type());
        }

        for (Map.Entry<String, AnalysisAdapter> entry : registered.entrySet()) {
            String adapterId = entry.getKey();
            AnalysisAdapter adapter = entry.getValue();

            try {
                if (!adapter.enabled()) {
                    continue;
                }
                Set<String> requiredFactTypes = adapter.requiredFactTypes();
                if (requiredFactTypes == null) {
                    fail(adapterId, ErrorCode.INVALID_CONFIG, "필수 Fact 유형 정보가 올바르지 않습니다.", statusByAdapter, diagnostics);
                    continue;
                }
                AnalysisStatus collectionStatus = collectionStatus(collectionReport);
                if (!requiredFactTypes.isEmpty() && collectionStatus != null) {
                    statusByAdapter.put(adapterId, collectionStatus);
                    diagnostics.add(new AdapterDiagnostic(
                            adapterId, ErrorCode.INVALID_STATE, "Adapter [" + adapterId + "] 수집 상태 불완전"));
                    continue;
                }
                if (!factTypes.containsAll(requiredFactTypes)) {
                    AnalysisStatus status = collectionStatus == null ? AnalysisStatus.UNKNOWN : collectionStatus;
                    statusByAdapter.put(adapterId, status);
                    diagnostics.add(new AdapterDiagnostic(
                            adapterId, ErrorCode.INVALID_STATE, "Adapter [" + adapterId + "] 필수 Fact 입력 부족"));
                    continue;
                }
                analyze(context, adapter, adapterId, relations, evidence, statusByAdapter, diagnostics);
            } catch (Exception exception) {
                fail(adapterId, ErrorCode.ADAPTER_FAILED, "Analyzer 실행 실패", statusByAdapter, diagnostics);
            }
        }

        return new AnalysisReport(collectionReport, relations, evidence, statusByAdapter, diagnostics);
    }

    private AnalysisStatus collectionStatus(CollectionReport collectionReport) {
        if (collectionReport.statusByAdapter().containsValue(AnalysisStatus.UNKNOWN)) {
            return AnalysisStatus.UNKNOWN;
        }
        if (collectionReport.statusByAdapter().containsValue(AnalysisStatus.PARTIAL)) {
            return AnalysisStatus.PARTIAL;
        }
        return null;
    }

    private Map<String, AnalysisAdapter> register(Collection<AnalysisAdapter> adapters) {
        Map<String, AnalysisAdapter> registered = new LinkedHashMap<>();

        for (AnalysisAdapter adapter : adapters) {
            if (adapter == null) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Analyzer 등록 정보가 올바르지 않습니다.");
            }
            String adapterId = adapter.id();
            if (adapterId == null || adapterId.isBlank()) {
                throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Analyzer ID가 올바르지 않습니다.");
            }
            if (registered.putIfAbsent(adapterId, adapter) != null) {
                throw new MapInBootException(ErrorCode.DUPLICATE_ADAPTER, "Analyzer ID가 중복되었습니다.");
            }
        }
        return registered;
    }

    private void analyze(
            AnalysisContext context,
            AnalysisAdapter adapter,
            String adapterId,
            List<Relation> relations,
            List<Evidence> evidence,
            Map<String, AnalysisStatus> statusByAdapter,
            List<AdapterDiagnostic> diagnostics
    ) {
        try {
            AnalysisResult result = adapter.analyze(context);
            if (result == null || !Objects.equals(adapterId, result.adapterId()) || result.status() == null) {
                fail(adapterId, ErrorCode.ADAPTER_FAILED, "Analyzer 결과가 올바르지 않습니다.", statusByAdapter, diagnostics);
                return;
            }
            boolean hasConflict = addRelations(adapterId, relations, result.relations(), diagnostics, new LinkedHashSet<>());
            hasConflict |= addEvidence(adapterId, evidence, result.additionalEvidence(), diagnostics, new LinkedHashSet<>());
            diagnostics.addAll(result.diagnostics());
            statusByAdapter.put(adapterId, conflictedStatus(result.status(), hasConflict));
        } catch (Exception exception) {
            fail(adapterId, ErrorCode.ADAPTER_FAILED, "Analyzer 실행 실패", statusByAdapter, diagnostics);
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

    private boolean addRelations(
            String adapterId,
            List<Relation> target,
            List<Relation> values,
            List<AdapterDiagnostic> diagnostics,
            Set<String> conflictIds
    ) {
        boolean hasConflict = false;
        for (Relation value : values) {
            if (!target.contains(value)) {
                if (target.stream().anyMatch(existing -> existing.id().equals(value.id()))) {
                    hasConflict = true;
                    if (conflictIds.add(value.id())) {
                        diagnostics.add(new AdapterDiagnostic(
                                adapterId, ErrorCode.INVALID_STATE,
                                "Adapter [" + adapterId + "] Relation ID 충돌: " + value.id()));
                    }
                    continue;
                }
                target.add(value);
            }
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
