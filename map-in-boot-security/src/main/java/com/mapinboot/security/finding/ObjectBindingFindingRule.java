package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

// 독립 객체 인가 요구와 완결된 접근 경로의 불일치 평가
public final class ObjectBindingFindingRule {
    private static final String REQUIREMENT_TYPE = "OBJECT_AUTHORIZATION_REQUIREMENT";
    private static final String PATH_TYPE = "OBJECT_ACCESS_PATH";
    private static final Set<String> POSITIVE_OUTCOMES = Set.of("UNGUARDED", "SOURCE_MISMATCH");

    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    public List<Finding> evaluate(AnalysisReport report) {
        if (report == null || report.collectionReport() == null) {
            return List.of();
        }
        Set<String> availableEvidence = report.evidence().stream()
                .map(item -> item.id())
                .collect(java.util.stream.Collectors.toSet());
        Map<String, Fact> requirements = facts(report, REQUIREMENT_TYPE).stream()
                .collect(java.util.stream.Collectors.toMap(
                        Fact::subjectKey, fact -> fact, (first, second) -> first,
                        LinkedHashMap::new));
        Map<String, Finding> findings = new LinkedHashMap<>();

        for (Fact requirement : requirements.values()) {
            if (!hasEvidence(requirement, availableEvidence)) {
                continue;
            }
            for (Fact path : facts(report, PATH_TYPE)) {
                if (!matches(requirement, path)
                        || !POSITIVE_OUTCOMES.contains(path.attributes().get("pathOutcome"))
                        || !"COMPLETE_SUPPORTED_PATH".equals(path.attributes().get("coverage"))
                        || !hasEvidence(path, availableEvidence)) {
                    continue;
                }
                Set<String> evidenceIds = new TreeSet<>(requirement.evidenceIds());
                evidenceIds.addAll(path.evidenceIds());
                Finding finding = new Finding(
                        idGenerator.generate("OBJECT_BINDING", List.of(
                                requirement.subjectKey(), path.subjectKey())),
                        "OBJECT_BINDING",
                        "객체 인가 요구와 접근 경로 불일치",
                        path.attributes().get("pathOutcome") + " 경로에서 선언된 객체 인가 요구의 실효 보호가 확인되지 않았습니다.",
                        Confidence.CONFIRMED,
                        List.of(),
                        List.of(),
                        evidenceIds.stream().toList(),
                        "객체 조회 이후 요구된 Owner 또는 Assignment 기준의 인증정보 출처와 불일치 거부 경로를 확인하세요.");
                findings.putIfAbsent(finding.id(), finding);
            }
        }
        return findings.values().stream()
                .sorted(Comparator.comparing(Finding::id))
                .toList();
    }

    private List<Fact> facts(AnalysisReport report, String type) {
        return report.collectionReport().facts().stream()
                .filter(fact -> type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private boolean matches(Fact requirement, Fact path) {
        return requirement.attributes().get("handler").equals(path.attributes().get("handler"))
                && requirement.attributes().get("resourceType").equals(path.attributes().get("resourceType"))
                && requirement.subjectKey().equals(path.attributes().get("requirementKey"));
    }

    private boolean hasEvidence(Fact fact, Set<String> availableEvidence) {
        return !fact.evidenceIds().isEmpty() && availableEvidence.containsAll(fact.evidenceIds());
    }
}
