package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

// 확인된 Method·Object 접근제어 보호 요구 판별
record AccessControlRequirement(Fact fact, Relation relation) {
    private static final String OBJECT_AUTHORIZATION = "OBJECT_AUTHORIZATION";
    private static final Set<String> ACCESS_CONTROL_TYPES = Set.of(OBJECT_AUTHORIZATION);

    static List<AccessControlRequirement> forEndpoint(AnalysisReport report, Fact endpoint) {
        String handler = endpoint.attributes().get("handler");
        Map<String, Fact> facts = report.collectionReport().facts().stream()
                .filter(fact -> ACCESS_CONTROL_TYPES.contains(fact.type()))
                .collect(Collectors.toMap(Fact::subjectKey, fact -> fact, (first, second) -> first));
        return report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .filter(relation -> handler.equals(relation.sourceKey()))
                .filter(relation -> "AUTHORIZATION".equals(relation.attributes().get("securityKind")))
                .filter(relation -> "OBJECT".equals(relation.attributes().get("policySource")))
                .map(relation -> requirement(facts.get(relation.targetKey()), relation))
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    private static AccessControlRequirement requirement(Fact fact, Relation relation) {
        if (fact == null || !matchesPolicySource(fact, relation.attributes().get("policySource"))
                || !hasText(fact.attributes().get("checkKind"))) {
            return null;
        }
        return new AccessControlRequirement(fact, relation);
    }

    private static boolean matchesPolicySource(Fact fact, String policySource) {
        return OBJECT_AUTHORIZATION.equals(fact.type()) && "OBJECT".equals(policySource);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
