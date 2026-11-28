package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// 선행 PermitAll Chain에 가려진 후속 보호 Chain 판정
final class ChainOrderFindingRule {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String POLICY_TYPE = "URL_AUTHORIZATION";
    private static final Set<String> STRONGER_POLICIES = Set.of("AUTHENTICATED", "AUTHORITY_REQUIRED", "DENY_ALL");
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
            if (matchedBy == null) {
                continue;
            }
            Fact selectedChain = chains.get(matchedBy.targetKey());
            Fact selectedPolicy = selectedPolicy(report, endpoint, selectedChain, policies);
            if (selectedChain == null || selectedPolicy == null
                    || !"PERMIT_ALL".equals(selectedPolicy.attributes().get("policyKind"))) {
                continue;
            }
            List<AccessControlRequirement> requirements = AccessControlRequirement.forEndpoint(report, endpoint);
            List<Fact> laterChains = chains.values().stream()
                    .filter(laterChain -> laterChain(selectedChain, laterChain))
                    .sorted(Comparator.comparingInt(this::chainOrder).thenComparing(Fact::id))
                    .toList();
            for (Fact laterChain : laterChains) {
                if (!hasContinuousChainOrder(selectedChain, laterChain, chains.values())) {
                    break;
                }
                String coverage = EndpointChainMatchingAnalysisAdapter.chainCoverage(endpoint, laterChain);
                if ("NONE".equals(coverage)) {
                    continue;
                }
                if (!"ALL".equals(coverage)) {
                    break;
                }
                Fact laterPolicy = firstApplicablePolicy(endpoint, laterChain, policies);
                if (laterPolicy != null && STRONGER_POLICIES.contains(laterPolicy.attributes().get("policyKind"))) {
                    Finding finding = finding(report, endpoint, selectedChain, selectedPolicy,
                            laterChain, laterPolicy, requirements);
                    if (finding != null) {
                        findings.add(finding);
                    }
                }
                break;
            }
        }
        return findings.stream().sorted(Comparator.comparing(Finding::id)).toList();
    }

    private Finding finding(
            AnalysisReport report,
            Fact endpoint,
            Fact selectedChain,
            Fact selectedPolicy,
            Fact laterChain,
            Fact laterPolicy,
            List<AccessControlRequirement> requirements
    ) {
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(selectedChain.evidenceIds());
        evidenceIds.addAll(selectedPolicy.evidenceIds());
        evidenceIds.addAll(laterChain.evidenceIds());
        evidenceIds.addAll(laterPolicy.evidenceIds());
        requirements.forEach(requirement -> {
            evidenceIds.addAll(requirement.fact().evidenceIds());
            evidenceIds.addAll(requirement.relation().evidenceIds());
        });
        if (!hasRequiredEvidence(report, evidenceIds, endpoint, selectedChain, selectedPolicy,
                laterChain, laterPolicy, requirements)) {
            return null;
        }
        return new Finding(
                idGenerator.generate("CHAIN_ORDER", List.of(endpoint.subjectKey(), selectedChain.subjectKey(), laterChain.subjectKey(), laterPolicy.subjectKey())),
                "CHAIN_ORDER",
                "SecurityFilterChain 순서 문제",
                endpoint.attributes().get("httpMethod") + " " + endpoint.attributes().get("path")
                        + " Endpoint는 선행 Chain의 PERMIT_ALL 정책이 적용되어 후속 보호 Chain이 선택되지 않습니다.",
                requirements.isEmpty() ? Confidence.LIKELY : Confidence.CONFIRMED,
                List.of(),
                List.of(),
                List.copyOf(evidenceIds),
                "FilterChainProxy 등록 순서와 선행 Chain의 Matcher·URL 인가 정책을 점검하고, 후속 보호 Chain이 선택되지 않는 이유와 의도된 보호 요구를 대조하세요.");
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
                .filter(relation -> endpoint.subjectKey().equals(relation.sourceKey()))
                .toList();
        return relations.size() == 1 ? relations.get(0) : null;
    }

    private Fact selectedPolicy(AnalysisReport report, Fact endpoint, Fact chain, List<Fact> policies) {
        if (chain == null) {
            return null;
        }
        return report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                .filter(relation -> "URL".equals(relation.attributes().get("policySource")))
                .filter(relation -> chain.attributes().get("chainKey").equals(relation.attributes().get("chainKey")))
                .filter(relation -> relation.evidenceIds().containsAll(endpoint.evidenceIds()))
                .map(Relation::targetKey)
                .distinct()
                .map(target -> policies.stream().filter(policy -> target.equals(policy.subjectKey())).findFirst().orElse(null))
                .filter(java.util.Objects::nonNull)
                .reduce((first, second) -> null)
                .orElse(null);
    }

    static Fact firstApplicablePolicy(Fact endpoint, Fact chain, List<Fact> policies) {
        List<Fact> chainPolicies = policies.stream()
                .filter(policy -> chain.attributes().get("chainKey").equals(policy.attributes().get("chainKey")))
                .sorted(Comparator.comparingInt(ChainOrderFindingRule::policyOrder).thenComparing(Fact::id))
                .toList();
        int expectedOrder = 1;
        for (Fact policy : chainPolicies) {
            if (policyOrder(policy) != expectedOrder++) {
                return null;
            }
            String coverage = EndpointChainMatchingAnalysisAdapter.policyCoverage(endpoint, policy);
            if ("ALL".equals(coverage)) {
                return policy;
            }
            if (!"NONE".equals(coverage)) {
                return null;
            }
        }
        return null;
    }

    private static int policyOrder(Fact policy) {
        try {
            return Integer.parseInt(policy.attributes().get("policyOrder"));
        } catch (RuntimeException exception) {
            return Integer.MAX_VALUE;
        }
    }

    private int chainOrder(Fact chain) {
        try {
            return Integer.parseInt(chain.attributes().get("chainOrder"));
        } catch (RuntimeException exception) {
            return Integer.MAX_VALUE;
        }
    }

    private boolean laterChain(Fact selected, Fact candidate) {
        if (!selected.attributes().get("proxyBeanName").equals(candidate.attributes().get("proxyBeanName"))) {
            return false;
        }
        try {
            return Integer.parseInt(candidate.attributes().get("chainOrder"))
                    > Integer.parseInt(selected.attributes().get("chainOrder"));
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private boolean hasContinuousChainOrder(Fact selected, Fact candidate, java.util.Collection<Fact> chains) {
        int selectedOrder = chainOrder(selected);
        int candidateOrder = chainOrder(candidate);
        if (selectedOrder == Integer.MAX_VALUE || candidateOrder == Integer.MAX_VALUE) {
            return false;
        }
        for (int expectedOrder = selectedOrder + 1; expectedOrder < candidateOrder; expectedOrder++) {
            int requiredOrder = expectedOrder;
            boolean present = chains.stream().anyMatch(chain -> selected.attributes().get("proxyBeanName")
                    .equals(chain.attributes().get("proxyBeanName")) && chainOrder(chain) == requiredOrder);
            if (!present) {
                return false;
            }
        }
        return true;
    }

    private boolean hasRequiredEvidence(
            AnalysisReport report,
            Set<String> evidenceIds,
            Fact endpoint,
            Fact selectedChain,
            Fact selectedPolicy,
            Fact laterChain,
            Fact laterPolicy,
            List<AccessControlRequirement> requirements
    ) {
        if (evidenceIds.isEmpty() || endpoint.evidenceIds().isEmpty()
                || selectedChain.evidenceIds().isEmpty() || selectedPolicy.evidenceIds().isEmpty()
                || laterChain.evidenceIds().isEmpty() || laterPolicy.evidenceIds().isEmpty()
                || requirements.stream().anyMatch(requirement -> requirement.fact().evidenceIds().isEmpty()
                || requirement.relation().evidenceIds().isEmpty())) {
            return false;
        }
        Set<String> available = report.evidence().stream().map(item -> item.id()).collect(java.util.stream.Collectors.toSet());
        return available.containsAll(evidenceIds);
    }
}
