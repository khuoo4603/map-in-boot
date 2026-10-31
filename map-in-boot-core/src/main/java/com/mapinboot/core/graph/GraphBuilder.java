package com.mapinboot.core.graph;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.model.GraphEdge;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// Fact·Relation 기반 SecurityGraph 조립
public class GraphBuilder {
    private static final Set<String> IDENTITY_ATTRIBUTES = Set.of(
            "flowKind", "securityKind", "policySource", "stateAction");
    private static final Set<String> MATCHER_IDENTITY_ATTRIBUTES = Set.of(
            "matcherType", "matcherCondition", "chainKey", "chainOrder");
    private static final Set<String> FILTER_IDENTITY_ATTRIBUTES = Set.of(
            "filterClass", "registrationKind", "filterOrder");
    private static final Map<String, List<String>> REQUIRED_FACT_ATTRIBUTES = Map.ofEntries(
            Map.entry("ENDPOINT_MAPPING", List.of("httpMethod", "path", "handler")),
            Map.entry("SERVLET_REGISTRATION", List.of("servletName", "urlPattern")),
            Map.entry("FILTER_REGISTRATION", List.of("filterClass", "registrationKind")),
            Map.entry("SECURITY_CHAIN", List.of("chainKey", "matcherType")),
            Map.entry("URL_AUTHORIZATION", List.of("chainKey", "policyKind")),
            Map.entry("METHOD_AUTHORIZATION", List.of("handler", "declarationKind")),
            Map.entry("JWT_USAGE", List.of("operation", "codeLocation")),
            Map.entry("SESSION_USAGE", List.of("operation", "codeLocation")),
            Map.entry("HEADER_USAGE", List.of("headerName", "codeLocation")),
            Map.entry("PRINCIPAL_USAGE", List.of("principalType", "codeLocation")),
            Map.entry("AUTHORITY_MAPPING", List.of("codeLocation", "mappingKind")),
            Map.entry("OBJECT_AUTHORIZATION", List.of("codeLocation", "checkKind")),
            Map.entry("BUSINESS_SECURITY_STATE", List.of("stateName", "stateAction", "declaringMethod")));

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    // 수집·분석 결과의 Fact·Relation을 참조 무결성을 갖춘 Graph로 변환
    public SecurityGraph build(String serviceId, AnalysisReport report) {
        if (isBlank(serviceId)) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "서비스 식별자 누락");
        }
        if (report == null || report.collectionReport() == null) {
            invalidGraph("분석 결과 누락");
        }

        Map<String, Evidence> evidenceById = evidenceById(report.evidence());
        Map<String, GraphNode> nodesById = new LinkedHashMap<>();
        Map<String, Set<String>> nodeIdsByStructuralKey = new HashMap<>();
        for (Fact fact : report.collectionReport().facts()) {
            addFact(serviceId, fact, evidenceById, nodesById, nodeIdsByStructuralKey);
        }

        Map<String, GraphEdge> edgesById = new LinkedHashMap<>();
        for (Relation relation : report.relations()) {
            addRelation(relation, evidenceById, nodesById, nodeIdsByStructuralKey, edgesById);
        }
        return new SecurityGraph(sorted(nodesById.values(), GraphNode::id), sorted(edgesById.values(), GraphEdge::id));
    }

    // Fact.type별 NodeType 변환 및 필수 구조 정보 검증
    private void addFact(String serviceId, Fact fact, Map<String, Evidence> evidenceById,
                         Map<String, GraphNode> nodesById, Map<String, Set<String>> nodeIdsByStructuralKey) {
        validateFact(fact);
        validateEvidenceIds(fact.evidenceIds(), evidenceById);
        switch (fact.type()) {
            case "ENDPOINT_MAPPING" -> {
                addNode(serviceId, NodeType.ENDPOINT, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(),
                        nodesById, nodeIdsByStructuralKey);
                String handler = fact.attributes().get("handler");
                // Endpoint와 Handler의 독립 구조 표현
                addNode(serviceId, NodeType.HANDLER, handler, handler, Map.of("handler", handler), fact.evidenceIds(),
                        nodesById, nodeIdsByStructuralKey);
            }
            case "SERVLET_REGISTRATION" -> addNode(serviceId, NodeType.SERVLET, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            case "FILTER_REGISTRATION" -> addNode(serviceId, NodeType.FILTER, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            case "SECURITY_CHAIN" -> addNode(serviceId, NodeType.SECURITY_CHAIN, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            case "URL_AUTHORIZATION", "METHOD_AUTHORIZATION", "OBJECT_AUTHORIZATION" -> addNode(serviceId, NodeType.AUTHORIZATION, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            case "JWT_USAGE", "SESSION_USAGE", "HEADER_USAGE", "PRINCIPAL_USAGE", "AUTHORITY_MAPPING" -> addNode(serviceId, NodeType.SECURITY_DATA, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            case "BUSINESS_SECURITY_STATE" -> addNode(serviceId, NodeType.BUSINESS_SECURITY_STATE, fact.subjectKey(), fact.subjectKey(), fact.attributes(), fact.evidenceIds(), nodesById, nodeIdsByStructuralKey);
            default -> invalidGraph("지원하지 않는 Fact 유형");
        }
    }

    // 동일 Stable ID의 구조 속성 병합 및 Evidence 합집합
    private void addNode(String serviceId, NodeType type, String structuralKey, String label, Map<String, String> attributes,
                         List<String> evidenceIds, Map<String, GraphNode> nodesById, Map<String, Set<String>> nodeIdsByStructuralKey) {
        String nodeId = idGenerator.generate(serviceId, type, structuralKey);
        nodeIdsByStructuralKey.computeIfAbsent(structuralKey, ignored -> new LinkedHashSet<>()).add(nodeId);
        GraphNode existing = nodesById.get(nodeId);
        if (existing == null) {
            nodesById.put(nodeId, new GraphNode(nodeId, type, serviceId, label, attributes, sortedIds(evidenceIds)));
            return;
        }
        if (existing.type() != type || !existing.serviceId().equals(serviceId)) {
            invalidGraph("Node 식별 충돌");
        }
        nodesById.put(nodeId, new GraphNode(nodeId, type, serviceId,
                presentationValue(existing.label(), label), mergeAttributes(existing.attributes(), attributes),
                mergedEvidence(existing.evidenceIds(), evidenceIds)));
    }

    // Relation 구조 키를 단일 Node 후보로 해석한 뒤 Stable Edge ID 생성
    private void addRelation(Relation relation, Map<String, Evidence> evidenceById, Map<String, GraphNode> nodesById,
                             Map<String, Set<String>> nodeIdsByStructuralKey, Map<String, GraphEdge> edgesById) {
        if (relation == null || relation.type() == null || isBlank(relation.sourceKey()) || isBlank(relation.targetKey())) {
            invalidGraph("Relation 구조 오류");
        }
        validateEvidenceIds(relation.evidenceIds(), evidenceById);
        String sourceId = resolvedNodeId(relation.sourceKey(), nodeIdsByStructuralKey);
        String targetId = resolvedNodeId(relation.targetKey(), nodeIdsByStructuralKey);
        if (!nodesById.containsKey(sourceId) || !nodesById.containsKey(targetId)) {
            invalidGraph("Relation Node 참조 누락");
        }
        String edgeId = idGenerator.generateEdge(sourceId, targetId, relation.type(), identityAttributes(relation.type(), relation.attributes()));
        GraphEdge existing = edgesById.get(edgeId);
        if (existing == null) {
            edgesById.put(edgeId, new GraphEdge(edgeId, sourceId, targetId, relation.type(), relation.attributes(), relation.confidence(), sortedIds(relation.evidenceIds())));
            return;
        }
        if (!existing.sourceId().equals(sourceId) || !existing.targetId().equals(targetId)
                || existing.type() != relation.type() || existing.confidence() != relation.confidence()) {
            invalidGraph("Edge 식별 충돌");
        }
        edgesById.put(edgeId, new GraphEdge(edgeId, sourceId, targetId, relation.type(),
                mergeAttributes(existing.attributes(), relation.attributes()), relation.confidence(),
                mergedEvidence(existing.evidenceIds(), relation.evidenceIds())));
    }

    // Fact.type별 필수 attributes 및 기존 고정값 계약 검증
    private void validateFact(Fact fact) {
        if (fact == null || isBlank(fact.type()) || isBlank(fact.subjectKey())) {
            invalidGraph("Fact 구조 키 또는 유형 오류");
        }
        List<String> requiredAttributes = REQUIRED_FACT_ATTRIBUTES.get(fact.type());
        if (requiredAttributes == null) {
            invalidGraph("지원하지 않는 Fact 유형");
        }
        for (String key : requiredAttributes) {
            if (isBlank(fact.attributes().get(key))) {
                invalidGraph("Fact 필수 속성 누락");
            }
        }
        if ("FILTER_REGISTRATION".equals(fact.type()) && !Set.of("SERVLET", "SECURITY").contains(fact.attributes().get("registrationKind"))) {
            invalidGraph("Filter 등록 유형 오류");
        }
        if ("BUSINESS_SECURITY_STATE".equals(fact.type()) && !Set.of("PRODUCES", "REQUIRES").contains(fact.attributes().get("stateAction"))) {
            invalidGraph("업무 보안 상태 동작 오류");
        }
        if ("ENDPOINT_MAPPING".equals(fact.type()) && !fact.attributes().get("httpMethod").equals(fact.attributes().get("httpMethod").toUpperCase(Locale.ROOT))) {
            invalidGraph("HTTP Method 형식 오류");
        }
    }

    // 명시된 구조 식별 속성만 Edge ID 입력으로 선택
    private Map<String, String> identityAttributes(EdgeType type, Map<String, String> attributes) {
        Map<String, String> selected = new TreeMap<>();
        attributes.forEach((key, value) -> {
            if (!isPresentationAttribute(key) && (IDENTITY_ATTRIBUTES.contains(key)
                    || type == EdgeType.MATCHED_BY && MATCHER_IDENTITY_ATTRIBUTES.contains(key)
                    || type == EdgeType.FILTERED_BY && FILTER_IDENTITY_ATTRIBUTES.contains(key))) {
                selected.put(key, value);
            }
        });
        return selected;
    }

    // Evidence ID별 단일 근거 확인
    private Map<String, Evidence> evidenceById(List<Evidence> evidence) {
        Map<String, Evidence> evidenceById = new HashMap<>();
        for (Evidence item : evidence) {
            if (item == null || isBlank(item.id())) {
                invalidGraph("Evidence 식별자 오류");
            }
            Evidence existing = evidenceById.putIfAbsent(item.id(), item);
            if (existing != null && !existing.equals(item)) {
                invalidGraph("Evidence 식별 충돌");
            }
        }
        return evidenceById;
    }

    // 동일 구조 키의 다중 Node 후보에 대한 임의 Relation 연결 방지
    private String resolvedNodeId(String structuralKey, Map<String, Set<String>> nodeIdsByStructuralKey) {
        Set<String> nodeIds = nodeIdsByStructuralKey.get(structuralKey);
        if (nodeIds == null || nodeIds.isEmpty()) {
            invalidGraph("Relation Node 참조 누락");
        }
        if (nodeIds.size() != 1) {
            invalidGraph("Relation Node 참조 모호성");
        }
        return nodeIds.iterator().next();
    }

    // 구조 충돌 차단 및 표시 속성의 결정적 보존
    private Map<String, String> mergeAttributes(Map<String, String> first, Map<String, String> second) {
        Map<String, String> merged = new TreeMap<>(first);
        for (Map.Entry<String, String> entry : second.entrySet()) {
            String existing = merged.get(entry.getKey());
            if (existing == null || existing.equals(entry.getValue())) {
                merged.put(entry.getKey(), entry.getValue());
            } else if (isPresentationAttribute(entry.getKey())) {
                merged.put(entry.getKey(), presentationValue(existing, entry.getValue()));
            } else {
                invalidGraph("Graph 구조 속성 충돌");
            }
        }
        return Map.copyOf(merged);
    }

    // 표시 값 충돌의 입력 순서 독립적 선택
    private String presentationValue(String first, String second) {
        if (first == null) {
            return second;
        }
        if (second == null) {
            return first;
        }
        return first.compareTo(second) <= 0 ? first : second;
    }

    private void validateEvidenceIds(List<String> evidenceIds, Map<String, Evidence> evidenceById) {
        for (String evidenceId : evidenceIds) {
            if (isBlank(evidenceId) || !evidenceById.containsKey(evidenceId)) {
                invalidGraph("Evidence 참조 누락");
            }
        }
    }

    private boolean isPresentationAttribute(String key) {
        String lowerKey = key.toLowerCase(Locale.ROOT);
        return lowerKey.endsWith("label") || lowerKey.startsWith("display") || lowerKey.startsWith("ui")
                || lowerKey.equals("collectedat") || lowerKey.equals("capturedat") || lowerKey.equals("timestamp");
    }

    private List<String> mergedEvidence(List<String> first, List<String> second) {
        TreeSet<String> merged = new TreeSet<>(first);
        merged.addAll(second);
        return List.copyOf(merged);
    }

    private List<String> sortedIds(List<String> ids) {
        return List.copyOf(new TreeSet<>(ids));
    }

    private <T> List<T> sorted(java.util.Collection<T> values, java.util.function.Function<T, String> id) {
        return values.stream().sorted(Comparator.comparing(id)).toList();
    }

    private void invalidGraph(String message) {
        throw new MapInBootException(ErrorCode.INVALID_GRAPH, message);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
