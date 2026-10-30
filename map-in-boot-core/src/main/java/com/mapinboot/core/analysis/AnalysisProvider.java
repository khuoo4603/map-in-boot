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
// Analyzer 입력 검증 및 분석 결과 격리 집계
public class AnalysisProvider {

    public AnalysisReport execute(AnalysisContext context, Collection<AnalysisAdapter> adapters) {
        if (context == null || context.collectionReport() == null || adapters == null) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Analysis 실행 입력이 올바르지 않습니다.");
        }

        CollectionReport collectionReport = context.collectionReport();
        // Adapter ID 중복 검증 및 등록 순서 보존
        Map<String, AnalysisAdapter> registered = register(adapters);
        Map<String, AnalysisStatus> statusByAdapter = new LinkedHashMap<>();
        List<Relation> relations = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>(collectionReport.evidence());
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Set<String> factTypes = new LinkedHashSet<>();

        // Analyzer 필수 Fact.type 존재 여부 판단용 수집 유형 집합
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
                // Fact별 수집 출처 부재에 따른 보수적 전체 수집 상태 판단
                AnalysisStatus collectionStatus = collectionStatus(collectionReport);
                // PARTIAL·UNKNOWN 수집 결과의 필수 Fact 기반 분석 제한
                if (!requiredFactTypes.isEmpty() && collectionStatus != null) {
                    statusByAdapter.put(adapterId, collectionStatus);
                    diagnostics.add(new AdapterDiagnostic(
                            adapterId, ErrorCode.INVALID_STATE, "Adapter [" + adapterId + "] 수집 상태 불완전"));
                    continue;
                }
                // Fact 존재와 완전한 수집 상태의 분리 검증
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

    // Collector 상태 중 가장 보수적인 분석 가능 상태 반환
    private AnalysisStatus collectionStatus(CollectionReport collectionReport) {
        if (collectionReport.statusByAdapter().containsValue(AnalysisStatus.UNKNOWN)) {
            return AnalysisStatus.UNKNOWN;
        }
        if (collectionReport.statusByAdapter().containsValue(AnalysisStatus.PARTIAL)) {
            return AnalysisStatus.PARTIAL;
        }
        return null;
    }

    // Adapter ID 기반 등록 및 공개 계약 검증
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

    // 개별 Analyzer 실패 격리 및 Relation·Evidence 집계
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
            // Collection Evidence와 additionalEvidence 통합 및 ID 충돌 상태 하향
            boolean hasConflict = addRelations(adapterId, relations, result.relations(), diagnostics, new LinkedHashSet<>());
            hasConflict |= addEvidence(adapterId, evidence, result.additionalEvidence(), diagnostics, new LinkedHashSet<>());
            diagnostics.addAll(result.diagnostics());
            statusByAdapter.put(adapterId, conflictedStatus(result.status(), hasConflict));
        } catch (Exception exception) {
            fail(adapterId, ErrorCode.ADAPTER_FAILED, "Analyzer 실행 실패", statusByAdapter, diagnostics);
        }
    }

    // 실패 Analyzer의 UNKNOWN 상태 및 Diagnostic 기록
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

    // 충돌 발생 READY 결과의 PARTIAL 하향
    private AnalysisStatus conflictedStatus(AnalysisStatus status, boolean hasConflict) {
        return hasConflict && status == AnalysisStatus.READY ? AnalysisStatus.PARTIAL : status;
    }

    // 동일 Relation 제외 및 상이한 동일 ID 충돌 격리
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

    // 동일 Evidence 제외 및 상이한 동일 ID 충돌 격리
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
