package com.mapinboot.starter.web.ui;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.EvidenceClassification;
import com.mapinboot.core.evidence.EvidenceCodeGenerator;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// 보고서의 구조 근거를 표시 코드 분류로 변환
public final class EvidenceDisplayCodeResolver {
    private static final Classification ENDPOINT_MAPPING = new Classification("EP", "MAPPING");
    private static final Classification SERVLET = new Classification("SV", "SERVLET");
    private static final Classification SERVLET_FILTER = new Classification("SV", "FILTER");
    private static final Classification SECURITY_FILTER = new Classification("SF", "FILTER");
    private static final Classification SECURITY_FILTER_CODE = new Classification("SF", "CODE");
    private static final Classification SECURITY_CHAIN = new Classification("SC", "CHAIN");
    private static final Classification URL_AUTHORIZATION = new Classification("SC", "AUTH");
    private static final Classification METHOD_DECLARATION = new Classification("MS", "DECL");
    private static final Classification METHOD_METADATA = new Classification("MS", "META");
    private static final Classification METHOD_RUNTIME = new Classification("MS", "RUNTIME");
    private static final Classification METHOD_CALL = new Classification("MA", "CALL");

    private final EvidenceCodeGenerator generator;

    public EvidenceDisplayCodeResolver() {
        this(new EvidenceCodeGenerator());
    }

    EvidenceDisplayCodeResolver(EvidenceCodeGenerator generator) {
        this.generator = generator;
    }

    // Collection·Analysis 보고서 기반 원본 ID·표시 코드 매핑 생성
    public Map<String, String> resolve(CollectionReport collection, AnalysisReport analysis) {
        List<Evidence> evidence = evidence(collection, analysis);
        Map<String, Evidence> evidenceById = indexEvidence(evidence);
        Map<String, Set<Classification>> classificationsByEvidenceId = new LinkedHashMap<>();

        CollectionReport source = collection;
        if (source == null && analysis != null) {
            source = analysis.collectionReport();
        }
        if (source != null) {
            for (Fact fact : source.facts()) {
                addFactClassifications(fact, evidenceById, classificationsByEvidenceId);
            }
        }
        if (analysis != null) {
            for (Relation relation : analysis.relations()) {
                addMethodCallClassifications(relation, evidenceById, classificationsByEvidenceId);
            }
        }

        List<EvidenceClassification> classifications = new ArrayList<>();
        for (String evidenceId : evidenceById.keySet()) {
            Set<Classification> candidates = classificationsByEvidenceId.getOrDefault(evidenceId, Set.of());
            if (candidates.size() == 1) {
                Classification classification = candidates.iterator().next();
                classifications.add(new EvidenceClassification(
                        evidenceId, classification.areaCode(), classification.targetCode()));
            } else if (candidates.size() > 1) {
                // 상충 분류는 우선순위 선택 없이 일반 분류로 하향
                classifications.add(EvidenceClassification.general(evidenceId));
            }
        }
        return generator.generate(evidence, classifications);
    }

    // Collection·Analysis Evidence 원본 목록 결합
    private List<Evidence> evidence(CollectionReport collection, AnalysisReport analysis) {
        List<Evidence> evidence = new ArrayList<>();
        if (collection != null) {
            evidence.addAll(collection.evidence());
        }
        if (analysis != null) {
            evidence.addAll(analysis.evidence());
        }
        return evidence;
    }

    // 표시 코드 분류 대상 Evidence ID 인덱스 생성
    private Map<String, Evidence> indexEvidence(List<Evidence> evidence) {
        Map<String, Evidence> evidenceById = new LinkedHashMap<>();
        for (Evidence item : evidence) {
            if (item != null) {
                evidenceById.putIfAbsent(item.id(), item);
            }
        }
        return evidenceById;
    }

    // Fact 유형·속성·Evidence 출처 기반 분류 후보 추가
    private void addFactClassifications(
            Fact fact,
            Map<String, Evidence> evidenceById,
            Map<String, Set<Classification>> classificationsByEvidenceId
    ) {
        if (fact == null) {
            return;
        }
        String type = fact.type();
        if ("ENDPOINT_MAPPING".equals(type)) {
            addAll(fact.evidenceIds(), ENDPOINT_MAPPING, evidenceById, classificationsByEvidenceId);
        } else if ("SERVLET_REGISTRATION".equals(type)) {
            addAll(fact.evidenceIds(), SERVLET, evidenceById, classificationsByEvidenceId);
        } else if ("SECURITY_CHAIN".equals(type)) {
            addAll(fact.evidenceIds(), SECURITY_CHAIN, evidenceById, classificationsByEvidenceId);
        } else if ("URL_AUTHORIZATION".equals(type)
                && "URL".equals(fact.attributes().get("policySource"))) {
            addAll(fact.evidenceIds(), URL_AUTHORIZATION, evidenceById, classificationsByEvidenceId);
        } else if ("METHOD_AUTHORIZATION".equals(type)
                && "METHOD".equals(fact.attributes().get("policySource"))) {
            addBySource(fact.evidenceIds(), EvidenceSource.DECLARATION,
                    METHOD_DECLARATION, evidenceById, classificationsByEvidenceId);
            addBySource(fact.evidenceIds(), EvidenceSource.SPRING_METADATA,
                    METHOD_METADATA, evidenceById, classificationsByEvidenceId);
            addBySource(fact.evidenceIds(), EvidenceSource.RUNTIME,
                    METHOD_RUNTIME, evidenceById, classificationsByEvidenceId);
        } else if ("FILTER_REGISTRATION".equals(type)) {
            String registrationKind = fact.attributes().get("registrationKind");
            if ("SERVLET".equals(registrationKind)) {
                addAll(fact.evidenceIds(), SERVLET_FILTER, evidenceById, classificationsByEvidenceId);
            } else if ("SECURITY".equals(registrationKind)) {
                addBySource(fact.evidenceIds(), EvidenceSource.RUNTIME,
                        SECURITY_FILTER, evidenceById, classificationsByEvidenceId);
                addBySource(fact.evidenceIds(), EvidenceSource.CODE_PATTERN,
                        SECURITY_FILTER_CODE, evidenceById, classificationsByEvidenceId);
            }
        }
    }

    // Method Security 분석 관계의 직접 CODE_PATTERN 근거 분류
    private void addMethodCallClassifications(
            Relation relation,
            Map<String, Evidence> evidenceById,
            Map<String, Set<Classification>> classificationsByEvidenceId
    ) {
        if (relation == null || relation.type() != EdgeType.SECURED_BY
                || !"METHOD".equals(relation.attributes().get("policySource"))) {
            return;
        }
        addBySource(relation.evidenceIds(), EvidenceSource.CODE_PATTERN,
                METHOD_CALL, evidenceById, classificationsByEvidenceId);
    }

    private void addAll(
            List<String> evidenceIds,
            Classification classification,
            Map<String, Evidence> evidenceById,
            Map<String, Set<Classification>> classificationsByEvidenceId
    ) {
        for (String evidenceId : evidenceIds) {
            if (evidenceById.containsKey(evidenceId)) {
                classificationsByEvidenceId
                        .computeIfAbsent(evidenceId, ignored -> new LinkedHashSet<>())
                        .add(classification);
            }
        }
    }

    private void addBySource(
            List<String> evidenceIds,
            EvidenceSource source,
            Classification classification,
            Map<String, Evidence> evidenceById,
            Map<String, Set<Classification>> classificationsByEvidenceId
    ) {
        for (String evidenceId : evidenceIds) {
            Evidence evidence = evidenceById.get(evidenceId);
            if (evidence != null && evidence.source() == source) {
                classificationsByEvidenceId
                        .computeIfAbsent(evidenceId, ignored -> new LinkedHashSet<>())
                        .add(classification);
            }
        }
    }

    private record Classification(String areaCode, String targetCode) {
    }
}
