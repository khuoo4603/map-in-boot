package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

// 보호 요구가 확인된 Endpoint의 SecurityChain 부재 판정
final class ChainMissingFindingRule {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    List<Finding> evaluate(AnalysisReport report) {
        if (!ready(report)) {
            return List.of();
        }
        List<Fact> chains = report.collectionReport().facts().stream()
                .filter(fact -> CHAIN_TYPE.equals(fact.type()))
                .toList();
        if (chains.isEmpty()) {
            return List.of();
        }
        List<Finding> findings = new ArrayList<>();
        for (Fact endpoint : endpoints(report)) {
            List<AccessControlRequirement> requirements = AccessControlRequirement.forEndpoint(report, endpoint);
            if (requirements.isEmpty() || hasMatchedChain(report, endpoint)) {
                continue;
            }
            Set<String> evidenceIds = evidence(endpoint, chains, requirements);
            if (!hasRequiredEvidence(report, evidenceIds, endpoint, chains, requirements)) {
                continue;
            }
            findings.add(new Finding(
                    idGenerator.generate("CHAIN_MISSING", List.of(endpoint.subjectKey())),
                    "CHAIN_MISSING",
                    "SecurityFilterChain 누락",
                    endpoint.attributes().get("httpMethod") + " " + endpoint.attributes().get("path")
                            + " Endpoint에 적용되는 SecurityFilterChain이 확인되지 않았습니다.",
                    Confidence.CONFIRMED,
                    List.of(),
                    List.of(),
                    List.copyOf(evidenceIds),
                    "SecurityFilterChain 적용 범위와 의도된 공개 API 여부를 확인하고, 보호가 필요하면 Chain Matcher와 인가 설정을 점검하세요."));
        }
        return findings.stream().sorted(Comparator.comparing(Finding::id)).toList();
    }

    private boolean ready(AnalysisReport report) {
        return report != null && report.collectionReport() != null
                && report.collectionReport().statusByAdapter().get("starter-endpoint-mapping") == AnalysisStatus.READY
                && report.collectionReport().statusByAdapter().get("security-chain") == AnalysisStatus.READY
                && report.statusByAdapter().get("security-endpoint-chain-matching") == AnalysisStatus.READY;
    }

    private List<Fact> endpoints(AnalysisReport report) {
        return report.collectionReport().facts().stream()
                .filter(fact -> ENDPOINT_TYPE.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private boolean hasMatchedChain(AnalysisReport report, Fact endpoint) {
        return report.relations().stream().anyMatch(relation -> relation.type() == EdgeType.MATCHED_BY
                && endpoint.subjectKey().equals(relation.sourceKey()));
    }

    private Set<String> evidence(
            Fact endpoint,
            List<Fact> chains,
            List<AccessControlRequirement> requirements
    ) {
        Set<String> evidenceIds = new TreeSet<>(endpoint.evidenceIds());
        chains.forEach(chain -> evidenceIds.addAll(chain.evidenceIds()));
        requirements.forEach(requirement -> {
            evidenceIds.addAll(requirement.fact().evidenceIds());
            evidenceIds.addAll(requirement.relation().evidenceIds());
        });
        return evidenceIds;
    }

    private boolean hasRequiredEvidence(
            AnalysisReport report,
            Set<String> evidenceIds,
            Fact endpoint,
            List<Fact> chains,
            List<AccessControlRequirement> requirements
    ) {
        if (evidenceIds.isEmpty() || endpoint.evidenceIds().isEmpty()
                || chains.stream().anyMatch(chain -> chain.evidenceIds().isEmpty())
                || requirements.stream().anyMatch(requirement -> requirement.fact().evidenceIds().isEmpty()
                || requirement.relation().evidenceIds().isEmpty())) {
            return false;
        }
        Set<String> available = report.evidence().stream().map(item -> item.id()).collect(java.util.stream.Collectors.toSet());
        return available.containsAll(evidenceIds);
    }
}
