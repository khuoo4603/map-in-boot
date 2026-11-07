package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

// URL 정책과 실제로 확인된 Method Security 보호 차이 평가
final class MethodMismatchFindingRule {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String POLICY_TYPE = "URL_AUTHORIZATION";
    private static final String METHOD_TYPE = "METHOD_AUTHORIZATION";
    private static final Set<String> URL_POLICIES = Set.of(
            "PERMIT_ALL", "AUTHENTICATED", "AUTHORITY_REQUIRED", "DENY_ALL");

    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    List<Finding> evaluate(AnalysisReport report) {
        if (!ready(report)) {
            return List.of();
        }
        Map<String, Fact> chains = factsBySubject(report, CHAIN_TYPE);
        Map<String, Fact> methods = factsBySubject(report, METHOD_TYPE);
        List<Fact> policies = facts(report, POLICY_TYPE);
        Set<String> availableEvidence = evidenceIds(report.evidence());
        Map<String, Finding> findings = new LinkedHashMap<>();

        for (Fact endpoint : facts(report, ENDPOINT_TYPE)) {
            UrlProtection url = urlProtection(report, endpoint, chains, policies);
            if (url == null || !hasEvidence(availableEvidence, url.evidenceIds())) {
                continue;
            }
            for (Relation methodRelation : methodRelations(report, endpoint)) {
                Fact method = methods.get(methodRelation.targetKey());
                if (method == null || !confirmedMethod(methodRelation, method)
                        || !hasEvidence(availableEvidence, methodEvidence(method, methodRelation))) {
                    continue;
                }
                if (!structuredBypass(methodRelation)) {
                    continue;
                }
                Finding finding = finding(endpoint, url, method, methodRelation);
                findings.putIfAbsent(finding.id(), finding);
            }
        }
        return findings.values().stream()
                .sorted(Comparator.comparing(Finding::id))
                .toList();
    }

    private boolean ready(AnalysisReport report) {
        if (report == null || report.collectionReport() == null) {
            return false;
        }
        Map<String, AnalysisStatus> collection = report.collectionReport().statusByAdapter();
        Map<String, AnalysisStatus> analysis = report.statusByAdapter();
        return collection.get("starter-endpoint-mapping") == AnalysisStatus.READY
                && collection.get("security-chain") == AnalysisStatus.READY
                && collection.get("security-method-authorization") != null
                && collection.get("security-method-authorization") != AnalysisStatus.UNKNOWN
                && analysis.get("security-endpoint-chain-matching") == AnalysisStatus.READY
                && analysis.get("security-method-authorization-analysis") != null
                && analysis.get("security-method-authorization-analysis") != AnalysisStatus.UNKNOWN;
    }

    private UrlProtection urlProtection(
            AnalysisReport report,
            Fact endpoint,
            Map<String, Fact> chains,
            List<Fact> policies
    ) {
        List<Relation> matched = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .filter(relation -> endpoint.subjectKey().equals(relation.sourceKey()))
                .toList();
        if (matched.size() != 1) {
            return null;
        }
        Relation matchedBy = matched.get(0);
        Fact chain = chains.get(matchedBy.targetKey());
        if (chain == null || !same(chain.attributes().get("chainKey"), matchedBy.attributes().get("chainKey"))
                || !same(chain.attributes().get("chainOrder"), matchedBy.attributes().get("chainOrder"))) {
            return null;
        }
        List<Relation> secured = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .filter(relation -> "URL".equals(relation.attributes().get("policySource")))
                .filter(relation -> endpoint.attributes().get("handler").equals(relation.sourceKey()))
                .filter(relation -> same(chain.attributes().get("chainKey"), relation.attributes().get("chainKey")))
                .filter(relation -> same(chain.attributes().get("chainOrder"), relation.attributes().get("chainOrder")))
                .toList();
        if (secured.size() != 1) {
            return null;
        }
        Relation securedBy = secured.get(0);
        Fact policy = policies.stream()
                .filter(candidate -> candidate.subjectKey().equals(securedBy.targetKey()))
                .findFirst()
                .orElse(null);
        if (policy == null || !URL_POLICIES.contains(policy.attributes().get("policyKind"))
                || !"URL".equals(policy.attributes().get("policySource"))
                || !same(chain.attributes().get("chainKey"), policy.attributes().get("chainKey"))
                || !same(chain.attributes().get("chainOrder"), policy.attributes().get("chainOrder"))
                || !same(policy.attributes().get("policyOrder"), securedBy.attributes().get("policyOrder"))) {
            return null;
        }
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(chain.evidenceIds());
        evidenceIds.addAll(policy.evidenceIds());
        evidenceIds.addAll(matchedBy.evidenceIds());
        evidenceIds.addAll(securedBy.evidenceIds());
        return new UrlProtection(policy, evidenceIds);
    }

    private List<Relation> methodRelations(AnalysisReport report, Fact endpoint) {
        return report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                .filter(relation -> "METHOD".equals(relation.attributes().get("policySource")))
                .filter(relation -> endpoint.attributes().get("handler").equals(relation.sourceKey()))
                .toList();
    }

    private boolean confirmedMethod(Relation relation, Fact method) {
        return relation.confidence() == Confidence.CONFIRMED
                && "CONFIRMED".equals(relation.attributes().get("proxyApplicability"))
                && !isBlank(method.attributes().get("annotationType"))
                && !isBlank(method.attributes().get("methodSecurityInfrastructure"))
                && "true".equalsIgnoreCase(method.attributes().get("proxyDetected"));
    }

    private boolean structuredBypass(Relation relation) {
        // 현재 Commit 2는 Self Invocation을 구조화 Relation으로 내보내지 않으므로 기본적으로 미생성
        return "SELF_INVOCATION".equals(relation.attributes().get("invocationKind"));
    }

    private Finding finding(Fact endpoint, UrlProtection url, Fact method, Relation methodRelation) {
        Set<String> evidenceIds = new TreeSet<>(url.evidenceIds());
        evidenceIds.addAll(methodEvidence(method, methodRelation));
        String path = endpoint.attributes().get("path");
        String httpMethod = endpoint.attributes().get("httpMethod");
        String policyKind = url.policy().attributes().get("policyKind");
        return new Finding(
                idGenerator.generate("METHOD_MISMATCH", List.of(
                        endpoint.subjectKey(), method.subjectKey(), url.policy().subjectKey(),
                        methodRelation.attributes().get("invocationKind"))),
                "METHOD_MISMATCH",
                "Method Security 보호 불일치",
                httpMethod + " " + path + " Endpoint의 Method Security 호출 경로가 Self Invocation으로 확인되어 URL 정책("
                        + policyKind + ")과 실효 Method 보호 경로가 일치하지 않습니다.",
                Confidence.CONFIRMED,
                List.of(),
                List.of(),
                List.copyOf(evidenceIds),
                "Method Security Proxy 경유 호출인지 확인하고, Self Invocation 대신 Spring Bean Proxy를 통한 호출 구조를 점검합니다.");
    }

    private Set<String> methodEvidence(Fact method, Relation relation) {
        Set<String> evidenceIds = new TreeSet<>(method.evidenceIds());
        evidenceIds.addAll(relation.evidenceIds());
        return evidenceIds;
    }

    private Map<String, Fact> factsBySubject(AnalysisReport report, String type) {
        Map<String, Fact> facts = new LinkedHashMap<>();
        facts(report, type).stream()
                .sorted(Comparator.comparing(Fact::id))
                .forEach(fact -> facts.putIfAbsent(fact.subjectKey(), fact));
        return facts;
    }

    private List<Fact> facts(AnalysisReport report, String type) {
        return report.collectionReport().facts().stream()
                .filter(fact -> type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private Set<String> evidenceIds(List<Evidence> evidence) {
        return evidence.stream().map(Evidence::id).collect(java.util.stream.Collectors.toSet());
    }

    private boolean hasEvidence(Set<String> available, Set<String> required) {
        return !required.isEmpty() && available.containsAll(required);
    }

    private boolean same(String first, String second) {
        return !isBlank(first) && first.equals(second);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record UrlProtection(Fact policy, Set<String> evidenceIds) {
    }
}
