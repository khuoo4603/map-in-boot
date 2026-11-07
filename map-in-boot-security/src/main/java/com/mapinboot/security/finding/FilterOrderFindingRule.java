package com.mapinboot.security.finding;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

// 실제 적용 Chain의 인증 Filter 순서와 제한된 코드 근거를 함께 평가
final class FilterOrderFindingRule {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String FILTER_TYPE = "FILTER_REGISTRATION";
    private static final String SECURITY_REGISTRATION = "SECURITY";
    private static final String BEARER_FILTER_CLASS =
            "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter";

    private final FindingIdGenerator idGenerator = new FindingIdGenerator();

    List<Finding> evaluate(AnalysisReport report) {
        if (!available(report)) {
            return List.of();
        }
        Map<String, Fact> chains = factsBySubject(report, CHAIN_TYPE);
        Map<String, Fact> filters = factsBySubject(report, FILTER_TYPE);
        Map<String, Evidence> evidenceById = evidenceById(report);
        List<Finding> findings = new ArrayList<>();
        for (Fact endpoint : facts(report, ENDPOINT_TYPE)) {
            SelectedChain selected = selectedChain(report, endpoint, chains);
            if (selected == null) {
                continue;
            }
            List<RegisteredFilter> registered = registeredFilters(report, selected.chain(), filters);
            if (registered == null) {
                continue;
            }
            OrderIssue issue = orderIssue(registered, evidenceById);
            if (issue == null) {
                continue;
            }
            Set<String> evidenceIds = evidence(endpoint, selected, issue);
            if (!hasEvidence(evidenceById, evidenceIds)) {
                continue;
            }
            findings.add(finding(endpoint, selected, issue, evidenceIds));
        }
        return findings.stream()
                .sorted(Comparator.comparing(Finding::id))
                .toList();
    }

    private boolean available(AnalysisReport report) {
        if (report == null || report.collectionReport() == null) {
            return false;
        }
        Map<String, AnalysisStatus> statuses = report.collectionReport().statusByAdapter();
        AnalysisStatus securityStatus = statuses.get("security-chain");
        return statuses.get("starter-endpoint-mapping") == AnalysisStatus.READY
                && (securityStatus == AnalysisStatus.READY || securityStatus == AnalysisStatus.PARTIAL);
    }

    private SelectedChain selectedChain(AnalysisReport report, Fact endpoint, Map<String, Fact> chains) {
        List<Relation> matched = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                .filter(relation -> endpoint.subjectKey().equals(relation.sourceKey()))
                .toList();
        if (matched.size() != 1) {
            return null;
        }
        Relation relation = matched.get(0);
        if (relation.confidence() != Confidence.CONFIRMED
                || relation.evidenceIds().isEmpty()) {
            return null;
        }
        Fact chain = chains.get(relation.targetKey());
        if (chain == null || !same(chain.attributes().get("chainKey"), relation.attributes().get("chainKey"))
                || !same(chain.attributes().get("chainOrder"), relation.attributes().get("chainOrder"))) {
            return null;
        }
        return new SelectedChain(chain, relation);
    }

    private List<RegisteredFilter> registeredFilters(
            AnalysisReport report,
            Fact chain,
            Map<String, Fact> filters
    ) {
        List<Fact> chainFilters = filters.values().stream()
                .filter(filter -> SECURITY_REGISTRATION.equals(filter.attributes().get("registrationKind")))
                .filter(filter -> same(chain.attributes().get("chainKey"), filter.attributes().get("chainKey")))
                .filter(filter -> same(chain.attributes().get("chainOrder"), filter.attributes().get("chainOrder")))
                .filter(filter -> same(chain.attributes().get("proxyBeanName"), filter.attributes().get("proxyBeanName")))
                .sorted(Comparator.comparingInt(this::filterOrder).thenComparing(Fact::subjectKey))
                .toList();
        List<Relation> relations = report.relations().stream()
                .filter(relation -> relation.type() == EdgeType.FILTERED_BY)
                .filter(relation -> chain.subjectKey().equals(relation.sourceKey()))
                .filter(relation -> relation.confidence() == Confidence.CONFIRMED)
                .toList();
        if (relations.size() != chainFilters.size() || chainFilters.isEmpty()) {
            return chainFilters.isEmpty() ? List.of() : null;
        }

        Set<Integer> orders = new HashSet<>();
        Map<String, Relation> relationByFilter = new HashMap<>();
        for (Relation relation : relations) {
            if (relation.evidenceIds().isEmpty() || relationByFilter.putIfAbsent(relation.targetKey(), relation) != null) {
                return null;
            }
        }
        List<RegisteredFilter> result = new ArrayList<>();
        for (Fact filter : chainFilters) {
            int order = filterOrder(filter);
            if (order < 1 || !orders.add(order)) {
                return null;
            }
            Relation relation = relationByFilter.get(filter.subjectKey());
            if (relation == null || !matches(filter, chain, relation)) {
                return null;
            }
            result.add(new RegisteredFilter(filter, relation));
        }
        return result;
    }

    private boolean matches(Fact filter, Fact chain, Relation relation) {
        return SECURITY_REGISTRATION.equals(relation.attributes().get("registrationKind"))
                && same(chain.attributes().get("chainKey"), relation.attributes().get("chainKey"))
                && same(chain.attributes().get("chainOrder"), relation.attributes().get("chainOrder"))
                && same(chain.attributes().get("proxyBeanName"), relation.attributes().get("proxyBeanName"))
                && same(filter.attributes().get("filterClass"), relation.attributes().get("filterClass"))
                && same(filter.attributes().get("filterOrder"), relation.attributes().get("filterOrder"));
    }

    private OrderIssue orderIssue(List<RegisteredFilter> filters, Map<String, Evidence> evidenceById) {
        RegisteredFilter provider = filters.stream()
                .filter(this::authenticationProvider)
                .min(Comparator.comparingInt(item -> filterOrder(item.fact())))
                .orElse(null);
        if (provider == null) {
            return null;
        }
        return filters.stream()
                .filter(item -> authenticationGuard(item.fact(), evidenceById))
                .filter(item -> filterOrder(item.fact()) < filterOrder(provider.fact()))
                .findFirst()
                .map(guard -> new OrderIssue(guard, provider))
                .orElse(null);
    }

    private boolean authenticationProvider(RegisteredFilter registered) {
        Fact filter = registered.fact();
        return "AUTHENTICATION_PROVIDER".equals(filter.attributes().get("filterRole"))
                || BEARER_FILTER_CLASS.equals(filter.attributes().get("filterClass"));
    }

    private boolean authenticationGuard(Fact filter, Map<String, Evidence> evidenceById) {
        if (!"AUTHENTICATION_GUARD".equals(filter.attributes().get("codePattern"))
                || !"SECURITY_CONTEXT_AUTHENTICATION".equals(filter.attributes().get("authData"))
                || !"JWT_AUTHENTICATION".equals(filter.attributes().get("authType"))
                || !"IS_AUTHENTICATED".equals(filter.attributes().get("authCheck"))
                || !"HTTP_401".equals(filter.attributes().get("unauthenticatedAction"))
                || !"AFTER_AUTHENTICATION".equals(filter.attributes().get("filterChainContinuation"))) {
            return false;
        }
        return filter.evidenceIds().stream()
                .map(evidenceById::get)
                .anyMatch(evidence -> evidence != null && evidence.source() == EvidenceSource.CODE_PATTERN);
    }

    private Set<String> evidence(Fact endpoint, SelectedChain selected, OrderIssue issue) {
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(selected.chain().evidenceIds());
        evidenceIds.addAll(selected.matchedBy().evidenceIds());
        evidenceIds.addAll(issue.guard().fact().evidenceIds());
        evidenceIds.addAll(issue.guard().relation().evidenceIds());
        evidenceIds.addAll(issue.provider().fact().evidenceIds());
        evidenceIds.addAll(issue.provider().relation().evidenceIds());
        return evidenceIds;
    }

    private Finding finding(Fact endpoint, SelectedChain selected, OrderIssue issue, Set<String> evidenceIds) {
        Fact guard = issue.guard().fact();
        Fact provider = issue.provider().fact();
        String path = endpoint.attributes().get("path");
        String httpMethod = endpoint.attributes().get("httpMethod");
        return new Finding(
                idGenerator.generate("FILTER_ORDER", List.of(
                        endpoint.subjectKey(), selected.chain().subjectKey(),
                        guard.subjectKey(), provider.subjectKey())),
                "FILTER_ORDER",
                "인증 필터 처리 순서 오류",
                httpMethod + " " + path + " Endpoint에서 인증정보를 요구하고 미인증 요청을 거부하는 Filter("
                        + guard.attributes().get("filterClass") + ", order="
                        + guard.attributes().get("filterOrder") + ")가 인증 제공 Filter("
                        + provider.attributes().get("filterClass") + ", order="
                        + provider.attributes().get("filterOrder") + ")보다 먼저 등록됨",
                Confidence.LIKELY,
                List.of(),
                List.of(),
                List.copyOf(evidenceIds),
                "실제 적용 Chain의 Filter 순서와 인증정보 의존성·미인증 거부 코드를 함께 확인하고, 유효한 인증 요청이 인증 전에 거부될 수 있는지 검증할 것");
    }

    private Map<String, Fact> factsBySubject(AnalysisReport report, String type) {
        Map<String, Fact> result = new HashMap<>();
        Set<String> duplicates = new HashSet<>();
        for (Fact fact : facts(report, type)) {
            if (duplicates.contains(fact.subjectKey())) {
                continue;
            }
            if (result.putIfAbsent(fact.subjectKey(), fact) != null) {
                result.remove(fact.subjectKey());
                duplicates.add(fact.subjectKey());
            }
        }
        return result;
    }

    private List<Fact> facts(AnalysisReport report, String type) {
        return report.collectionReport().facts().stream()
                .filter(fact -> type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private Map<String, Evidence> evidenceById(AnalysisReport report) {
        Map<String, Evidence> result = new HashMap<>();
        for (Evidence evidence : report.evidence()) {
            result.putIfAbsent(evidence.id(), evidence);
        }
        return result;
    }

    private boolean hasEvidence(Map<String, Evidence> available, Set<String> required) {
        return !required.isEmpty() && available.keySet().containsAll(required);
    }

    private int filterOrder(Fact filter) {
        try {
            return Integer.parseInt(filter.attributes().get("filterOrder"));
        } catch (RuntimeException exception) {
            return Integer.MAX_VALUE;
        }
    }

    private boolean same(String first, String second) {
        return first != null && !first.isBlank() && first.equals(second);
    }

    private record SelectedChain(Fact chain, Relation matchedBy) {
    }

    private record RegisteredFilter(Fact fact, Relation relation) {
    }

    private record OrderIssue(RegisteredFilter guard, RegisteredFilter provider) {
    }
}
