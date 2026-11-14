package com.mapinboot.security.analyzer;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.StableIdGenerator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// 업무 보안 상태 선언과 실제 Handler 구조 연결
public class BusinessStateAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String STATE_TYPE = "BUSINESS_SECURITY_STATE";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public BusinessStateAnalysisAdapter() {
        super("security-business-state-analysis", "업무 보안 상태 선언 관계 분석", Set.of("SECURITY_STATE"));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("업무 보안 상태 분석 입력 또는 서비스 식별 정보 부족");
        }

        CollectionReport report = context.collectionReport();
        Map<String, Evidence> evidenceById = evidenceById(report.evidence());
        List<Fact> endpoints = facts(report, ENDPOINT_TYPE);
        List<Fact> states = facts(report, STATE_TYPE);
        Map<RelationKey, RelationData> relationData = new TreeMap<>(Comparator
                .comparing(RelationKey::sourceKey)
                .thenComparing(RelationKey::targetKey)
                .thenComparing(RelationKey::stateAction));
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        boolean partial = false;

        for (Fact state : states) {
            if (!hasEvidence(state, evidenceById)) {
                partial = true;
                diagnostics.add(diagnostic("업무 보안 상태 Fact Evidence 확인 불가: " + state.subjectKey()));
                continue;
            }
            String action = state.attributes().get("stateAction");
            String handler = state.attributes().get("handler");
            if (!Set.of("REQUIRES", "PRODUCES").contains(action) || isBlank(handler)) {
                partial = true;
                diagnostics.add(diagnostic("업무 보안 상태 Fact 구조 확인 불가: " + state.subjectKey()));
                continue;
            }

            List<Fact> matchingEndpoints = endpoints.stream()
                    .filter(endpoint -> handler.equals(endpoint.attributes().get("handler")))
                    .toList();
            if (matchingEndpoints.isEmpty()) {
                partial = true;
                diagnostics.add(diagnostic("업무 보안 상태 Handler Endpoint 연결 불가: " + state.subjectKey()));
                continue;
            }
            for (Fact endpoint : matchingEndpoints) {
                if (!hasEvidence(endpoint, evidenceById)) {
                    partial = true;
                    diagnostics.add(diagnostic("Endpoint Evidence 확인 불가: " + endpoint.subjectKey()));
                    continue;
                }
                String sourceKey = "REQUIRES".equals(action) ? handler : state.subjectKey();
                String targetKey = "REQUIRES".equals(action) ? state.subjectKey() : handler;
                addRelation(relationData, sourceKey, targetKey, action,
                        evidenceIds(state, endpoint));
            }
        }

        List<Relation> relations = relationData.values().stream()
                .map(data -> data.relation(context.serviceId(), idGenerator))
                .sorted(Comparator.comparing(Relation::id))
                .toList();
        return new AnalysisResult(id(), relations, List.of(),
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    @Override
    public Set<String> requiredFactTypes() {
        return Set.of();
    }

    private List<Fact> facts(CollectionReport report, String type) {
        return report.facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey))
                .toList();
    }

    private Map<String, Evidence> evidenceById(List<Evidence> evidence) {
        Map<String, Evidence> result = new LinkedHashMap<>();
        for (Evidence item : evidence) {
            if (item != null && item.id() != null) {
                result.putIfAbsent(item.id(), item);
            }
        }
        return result;
    }

    private boolean hasEvidence(Fact fact, Map<String, Evidence> evidenceById) {
        return fact != null && !fact.evidenceIds().isEmpty()
                && fact.evidenceIds().stream().allMatch(evidenceById::containsKey);
    }

    private List<String> evidenceIds(Fact first, Fact second) {
        TreeSet<String> result = new TreeSet<>();
        result.addAll(first.evidenceIds());
        result.addAll(second.evidenceIds());
        return result.stream().toList();
    }

    private void addRelation(
            Map<RelationKey, RelationData> relationData,
            String sourceKey,
            String targetKey,
            String stateAction,
            List<String> evidenceIds
    ) {
        if (isBlank(sourceKey) || isBlank(targetKey) || evidenceIds.isEmpty()) {
            return;
        }
        RelationKey key = new RelationKey(sourceKey, targetKey, stateAction);
        relationData.computeIfAbsent(key,
                        ignored -> new RelationData(sourceKey, targetKey, stateAction))
                .evidenceIds.addAll(evidenceIds);
    }

    private AdapterDiagnostic diagnostic(String summary) {
        return new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary);
    }

    private AnalysisResult unknown(String summary) {
        return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record RelationKey(String sourceKey, String targetKey, String stateAction) {
    }

    private static final class RelationData {
        private final String sourceKey;
        private final String targetKey;
        private final String stateAction;
        private final Set<String> evidenceIds = new TreeSet<>();

        private RelationData(String sourceKey, String targetKey, String stateAction) {
            this.sourceKey = sourceKey;
            this.targetKey = targetKey;
            this.stateAction = stateAction;
        }

        private Relation relation(String serviceId, StableIdGenerator idGenerator) {
            Map<String, String> attributes = Map.of(
                    "policySource", "ANNOTATION",
                    "stateAction", stateAction);
            NodeType sourceType = "PRODUCES".equals(stateAction)
                    ? NodeType.BUSINESS_SECURITY_STATE : NodeType.HANDLER;
            NodeType targetType = "PRODUCES".equals(stateAction)
                    ? NodeType.HANDLER : NodeType.BUSINESS_SECURITY_STATE;
            String sourceId = idGenerator.generate(serviceId, sourceType, sourceKey);
            String targetId = idGenerator.generate(serviceId, targetType, targetKey);
            String id = idGenerator.generateEdge(sourceId, targetId, EdgeType.SECURITY_STATE, attributes);
            return new Relation(id, sourceKey, targetKey, EdgeType.SECURITY_STATE,
                    attributes, Confidence.CONFIRMED, evidenceIds.stream().toList());
        }
    }
}
