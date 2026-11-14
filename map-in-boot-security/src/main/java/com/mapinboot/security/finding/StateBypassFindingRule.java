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

// 독립 상태 요구와 완결된 상태 우회 경로의 평가
public final class StateBypassFindingRule {
    private static final String STATE_TYPE = "BUSINESS_SECURITY_STATE";
    private static final String EVALUATION_TYPE = "BUSINESS_STATE_EVALUATION";

    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    public List<Finding> evaluate(AnalysisReport report) {
        if (report == null || report.collectionReport() == null) {
            return List.of();
        }
        Set<String> availableEvidence = report.evidence().stream()
                .map(item -> item.id())
                .collect(java.util.stream.Collectors.toSet());
        Map<String, Fact> requirements = facts(report, STATE_TYPE).stream()
                .filter(fact -> "REQUIRES".equals(fact.attributes().get("stateAction")))
                .collect(java.util.stream.Collectors.toMap(
                        Fact::subjectKey, fact -> fact, (first, second) -> first,
                        LinkedHashMap::new));
        Map<String, Finding> findings = new LinkedHashMap<>();

        for (Fact requirement : requirements.values()) {
            if (!hasEvidence(requirement, availableEvidence)) {
                continue;
            }
            for (Fact evaluation : facts(report, EVALUATION_TYPE)) {
                if (!matches(requirement, evaluation)
                        || !"BYPASS_PATH".equals(evaluation.attributes().get("pathOutcome"))
                        || !"COMPLETE_SUPPORTED_PATH".equals(evaluation.attributes().get("coverage"))
                        || !hasEvidence(evaluation, availableEvidence)) {
                    continue;
                }
                Set<String> evidenceIds = new TreeSet<>(requirement.evidenceIds());
                evidenceIds.addAll(evaluation.evidenceIds());
                Finding finding = new Finding(
                        idGenerator.generate("STATE_BYPASS", List.of(
                                requirement.subjectKey(), evaluation.subjectKey())),
                        "STATE_BYPASS",
                        "업무 보안 상태 검증 우회 경로",
                        "선언된 업무 보안 상태 요구가 확인된 경로에서 상태 검증 없이 보호 업무에 도달할 수 있습니다.",
                        Confidence.CONFIRMED,
                        List.of(),
                        List.of(),
                        evidenceIds.stream().toList(),
                        "보호 업무 호출 이전에 요구 Claim 조회·비교와 실패 시 거부가 모든 지원 경로에 적용되는지 확인하세요.");
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

    private boolean matches(Fact requirement, Fact evaluation) {
        return requirement.subjectKey().equals(evaluation.attributes().get("requirementKey"))
                && requirement.attributes().get("handler").equals(evaluation.attributes().get("handler"))
                && requirement.attributes().get("stateName").equals(evaluation.attributes().get("stateName"))
                && requirement.attributes().getOrDefault("claim", "")
                .equals(evaluation.attributes().getOrDefault("claimName", ""));
    }

    private boolean hasEvidence(Fact fact, Set<String> availableEvidence) {
        return !fact.evidenceIds().isEmpty() && availableEvidence.containsAll(fact.evidenceIds());
    }
}
