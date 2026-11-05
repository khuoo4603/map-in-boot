package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// 실제 공개 URL 정책과 독립적인 접근제어 근거의 결합 점검
final class PublicEndpointFindingRule {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String POLICY_TYPE = "URL_AUTHORIZATION";
    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    List<Finding> evaluate(AnalysisReport report) {
        if (!ready(report)) {
            return List.of();
        }
        Map<String, Fact> chains = factsBySubject(report, CHAIN_TYPE);
        List<Fact> policies = report.collectionReport().facts().stream()
                .filter(fact -> POLICY_TYPE.equals(fact.type()))
                .toList();
        List<Finding> findings = new ArrayList<>();
        for (Fact endpoint : endpoints(report)) {
            Relation matchedBy = matchedBy(report, endpoint);
            Fact chain = matchedBy == null ? null : chains.get(matchedBy.targetKey());
            if (!matchesChain(matchedBy, chain)) {
                continue;
            }
            Fact policy = ChainOrderFindingRule.firstApplicablePolicy(endpoint, chain, policies);
            if (policy == null || !"PERMIT_ALL".equals(policy.attributes().get("policyKind"))
                    || !matchesPolicy(chain, policy)) {
                continue;
            }
            Relation securedBy = securedBy(report, endpoint, chain, policy);
            List<AccessControlRequirement> requirements = AccessControlRequirement.forEndpoint(report, endpoint);
            if (securedBy == null || requirements.isEmpty()) {
                continue;
            }
            Set<String> evidenceIds = evidence(endpoint, chain, policy, matchedBy, securedBy, requirements);
            if (!hasRequiredEvidence(report, evidenceIds, endpoint, chain, policy, matchedBy, securedBy, requirements)) {
                continue;
            }
            findings.add(new Finding(
                    idGenerator.generate("PUBLIC_ENDPOINT", List.of(endpoint.subjectKey(), chain.subjectKey(), policy.subjectKey())),
                    "PUBLIC_ENDPOINT",
                    "민감 Endpoint에 공개 URL 정책 적용",
                    endpoint.attributes().get("httpMethod") + " " + endpoint.attributes().get("path")
                            + " Endpoint에 실제 적용된 URL 정책이 PERMIT_ALL입니다. 확인된 객체 인가 근거가 있으나 URL 공개의 부적절성은 현재 Runtime 근거만으로 확정되지 않았습니다.",
                    Confidence.LIKELY,
                    List.of(),
                    List.of(),
                    List.copyOf(evidenceIds),
                    "해당 Endpoint의 공개 정책이 의도된 것인지와 Controller 또는 Service의 실제 인증·인가 요구를 확인하고, 필요하면 URL Authorization 정책을 조정하세요."));
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

    private Map<String, Fact> factsBySubject(AnalysisReport report, String type) {
        Map<String, Fact> facts = new TreeMap<>();
        report.collectionReport().facts().stream()
                .filter(fact -> type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::id))
                .forEach(fact -> facts.putIfAbsent(fact.subjectKey(), fact));
        return facts;
    }

    private Relation matchedBy(AnalysisReport report, Fact endpoint) {
        List<Relation> relations = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .filter(relation -> endpoint.subjectKey().equals(relation.sourceKey()))
                .toList();
        return relations.size() == 1 ? relations.get(0) : null;
    }

    private boolean matchesChain(Relation relation, Fact chain) {
        return relation != null && chain != null
                && same(relation.attributes().get("chainKey"), chain.attributes().get("chainKey"))
                && same(relation.attributes().get("chainOrder"), chain.attributes().get("chainOrder"))
                && hasText(chain.attributes().get("proxyBeanName"));
    }

    private boolean matchesPolicy(Fact chain, Fact policy) {
        return "URL".equals(policy.attributes().get("policySource"))
                && same(chain.attributes().get("chainKey"), policy.attributes().get("chainKey"))
                && same(chain.attributes().get("chainOrder"), policy.attributes().get("chainOrder"))
                && same(chain.attributes().get("proxyBeanName"), policy.attributes().get("proxyBeanName"));
    }

    private Relation securedBy(AnalysisReport report, Fact endpoint, Fact chain, Fact policy) {
        List<Relation> relations = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .filter(relation -> endpoint.attributes().get("handler").equals(relation.sourceKey()))
                .filter(relation -> policy.subjectKey().equals(relation.targetKey()))
                .filter(relation -> "AUTHORIZATION".equals(relation.attributes().get("securityKind")))
                .filter(relation -> "URL".equals(relation.attributes().get("policySource")))
                .filter(relation -> same(chain.attributes().get("chainKey"), relation.attributes().get("chainKey")))
                .filter(relation -> same(policy.attributes().get("policyOrder"), relation.attributes().get("policyOrder")))
                .filter(relation -> relation.evidenceIds().containsAll(endpoint.evidenceIds()))
                .filter(relation -> relation.evidenceIds().containsAll(policy.evidenceIds()))
                .toList();
        return relations.size() == 1 ? relations.get(0) : null;
    }

    private Set<String> evidence(
            Fact endpoint,
            Fact chain,
            Fact policy,
            Relation matchedBy,
            Relation securedBy,
            List<AccessControlRequirement> requirements
    ) {
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(chain.evidenceIds());
        evidenceIds.addAll(policy.evidenceIds());
        evidenceIds.addAll(matchedBy.evidenceIds());
        evidenceIds.addAll(securedBy.evidenceIds());
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
            Fact chain,
            Fact policy,
            Relation matchedBy,
            Relation securedBy,
            List<AccessControlRequirement> requirements
    ) {
        if (evidenceIds.isEmpty() || endpoint.evidenceIds().isEmpty() || chain.evidenceIds().isEmpty()
                || policy.evidenceIds().isEmpty() || matchedBy.evidenceIds().isEmpty()
                || securedBy.evidenceIds().isEmpty() || requirements.stream().anyMatch(requirement ->
                requirement.fact().evidenceIds().isEmpty() || requirement.relation().evidenceIds().isEmpty())) {
            return false;
        }
        Set<String> available = report.evidence().stream().map(item -> item.id())
                .collect(java.util.stream.Collectors.toSet());
        return available.containsAll(evidenceIds);
    }

    private boolean same(String first, String second) {
        return hasText(first) && first.equals(second);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
