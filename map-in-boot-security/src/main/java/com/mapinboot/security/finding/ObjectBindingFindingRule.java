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
        Set<String> availableEvidence = evidenceById(report).keySet();
        Map<String, Fact> requirements = factsBySubject(report, REQUIREMENT_TYPE);
        Map<String, Fact> paths = factsBySubject(report, PATH_TYPE);
        Map<String, Finding> findings = new LinkedHashMap<>();

        for (Fact requirement : requirements.values()) {
            if (!hasEvidence(requirement, availableEvidence)) {
                continue;
            }
            for (Fact path : paths.values()) {
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

    private Map<String, Fact> factsBySubject(AnalysisReport report, String type) {
        Map<String, Fact> factsBySubject = new LinkedHashMap<>();
        for (Fact fact : facts(report, type)) {
            Fact existing = factsBySubject.putIfAbsent(fact.subjectKey(), fact);
            if (existing != null && !existing.equals(fact)) {
                throw new MapInBootException(ErrorCode.INVALID_STATE,
                        "객체 인가 Fact 식별 충돌");
            }
        }
        return factsBySubject;
    }

    private boolean matches(Fact requirement, Fact path) {
        return same(requirement.attributes().get("handler"), path.attributes().get("handler"))
                && same(requirement.attributes().get("resourceType"), path.attributes().get("resourceType"))
                && same(requirement.subjectKey(), path.attributes().get("requirementKey"));
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
                        "객체 인가 Evidence 식별자 누락");
            }
            Evidence existing = evidenceById.putIfAbsent(evidence.id(), evidence);
            if (existing != null && !existing.equals(evidence)) {
                throw new MapInBootException(ErrorCode.INVALID_STATE,
                        "객체 인가 Evidence 식별 충돌");
            }
        }
        return evidenceById;
    }

    private void addFinding(Map<String, Finding> findings, Finding finding) {
        Finding existing = findings.putIfAbsent(finding.id(), finding);
        if (existing != null && !existing.equals(finding)) {
            throw new MapInBootException(ErrorCode.INVALID_STATE,
                    "객체 인가 Finding 식별 충돌");
        }
    }

    private boolean same(String first, String second) {
        return !isBlank(first) && first.equals(second);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
