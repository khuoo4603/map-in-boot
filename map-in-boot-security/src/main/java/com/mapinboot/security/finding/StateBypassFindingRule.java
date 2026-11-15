package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.evidence.Evidence;
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
        Set<String> availableEvidence = evidenceById(report).keySet();
        Map<String, Fact> requirements = factsBySubject(report, STATE_TYPE, true);
        Map<String, Fact> evaluations = factsBySubject(report, EVALUATION_TYPE, false);
        Map<String, Finding> findings = new LinkedHashMap<>();

        for (Fact requirement : requirements.values()) {
            if (!hasEvidence(requirement, availableEvidence)) {
                continue;
            }
            for (Fact evaluation : evaluations.values()) {
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
                addFinding(findings, finding);
            }
        }
        return findings.values().stream()
                .sorted(Comparator.comparing(Finding::id))
                .toList();
    }

    private List<Fact> facts(AnalysisReport report, String type) {
        return report.collectionReport().facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private Map<String, Fact> factsBySubject(AnalysisReport report, String type, boolean requires) {
        Map<String, Fact> factsBySubject = new LinkedHashMap<>();
        for (Fact fact : facts(report, type)) {
            if (requires != "REQUIRES".equals(fact.attributes().get("stateAction"))) {
                continue;
            }
            Fact existing = factsBySubject.putIfAbsent(fact.subjectKey(), fact);
            if (existing != null && !existing.equals(fact)) {
                throw new MapInBootException(ErrorCode.INVALID_STATE,
                        "업무 보안 상태 Fact 식별 충돌");
            }
        }
        return factsBySubject;
    }

    private boolean matches(Fact requirement, Fact evaluation) {
        return same(requirement.subjectKey(), evaluation.attributes().get("requirementKey"))
                && same(requirement.attributes().get("handler"), evaluation.attributes().get("handler"))
                && same(requirement.attributes().get("stateName"), evaluation.attributes().get("stateName"))
                && requirement.attributes().getOrDefault("claim", "")
                .equals(evaluation.attributes().getOrDefault("claimName", ""));
    }

    private boolean hasEvidence(Fact fact, Set<String> availableEvidence) {
        return fact != null && !fact.evidenceIds().isEmpty()
                && fact.evidenceIds().stream().allMatch(id -> !isBlank(id))
                && availableEvidence.containsAll(fact.evidenceIds());
    }

    private Map<String, Evidence> evidenceById(AnalysisReport report) {
        Map<String, Evidence> evidenceById = new LinkedHashMap<>();
        for (Evidence evidence : report.evidence()) {
            if (evidence == null || isBlank(evidence.id())) {
                throw new MapInBootException(ErrorCode.INVALID_STATE,
                        "업무 보안 상태 Evidence 식별자 누락");
            }
            Evidence existing = evidenceById.putIfAbsent(evidence.id(), evidence);
            if (existing != null && !existing.equals(evidence)) {
                throw new MapInBootException(ErrorCode.INVALID_STATE,
                        "업무 보안 상태 Evidence 식별 충돌");
            }
        }
        return evidenceById;
    }

    private void addFinding(Map<String, Finding> findings, Finding finding) {
        Finding existing = findings.putIfAbsent(finding.id(), finding);
        if (existing != null && !existing.equals(finding)) {
            throw new MapInBootException(ErrorCode.INVALID_STATE,
                    "업무 보안 상태 Finding 식별 충돌");
        }
    }

    private boolean same(String first, String second) {
        return !isBlank(first) && first.equals(second);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
