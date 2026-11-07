package com.mapinboot.security.analyzer;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.StableIdGenerator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

// Servlet·Security Filter 등록 경로와 Chain 내부 구성 순서 분석
public class FilterRegistrationAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String FILTER_TYPE = "FILTER_REGISTRATION";
    private static final String SERVLET_TYPE = "SERVLET_REGISTRATION";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String SECURITY_CHAIN_COLLECTOR = "security-chain";
    private static final String SERVLET_FILTER_COLLECTOR = "starter-servlet-filter";
    private static final String SERVLET_REGISTRATION_COLLECTOR = "starter-servlet-registration";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public FilterRegistrationAnalysisAdapter() {
        super("security-filter-registration-analysis", "Servlet·Security Filter 등록 경로와 순서 분석",
                Set.of(EdgeType.FILTERED_BY.name()));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("Filter 분석 입력 또는 서비스 식별자 부재");
        }

        CollectionReport report = context.collectionReport();
        AnalysisStatus securityStatus = report.statusByAdapter().get(SECURITY_CHAIN_COLLECTOR);
        List<Fact> chains = facts(report, CHAIN_TYPE);
        List<Fact> filters = facts(report, FILTER_TYPE);
        boolean securityFactsPresent = !chains.isEmpty() || filters.stream()
                .anyMatch(filter -> "SECURITY".equals(filter.attributes().get("registrationKind")));
        if (securityStatus == AnalysisStatus.UNKNOWN
                || (securityStatus == null && securityFactsPresent)) {
            return unknown("SecurityChain 수집 상태 부재 또는 UNKNOWN");
        }

        Set<String> availableEvidence = evidenceIds(report.evidence());
        List<Relation> relations = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        boolean partial = securityStatus != null && securityStatus != AnalysisStatus.READY;
        if (partial) {
            diagnostics.add(diagnostic("SecurityChain 수집 결과 PARTIAL"));
        }

        int chainDiagnosticCount = diagnostics.size();
        Map<String, Fact> chainsByKey = chainMap(chains, diagnostics);
        partial |= diagnostics.size() > chainDiagnosticCount;
        List<Fact> securityFilters = filters.stream()
                .filter(filter -> "SECURITY".equals(filter.attributes().get("registrationKind")))
                .toList();
        for (Fact filter : securityFilters) {
            Relation relation = securityRelation(context.serviceId(), filter, chainsByKey, availableEvidence, diagnostics);
            if (relation == null) {
                partial = true;
            } else {
                relations.add(relation);
            }
        }

        if (chains.isEmpty() && !securityFilters.isEmpty()) {
            partial = true;
            diagnostics.add(diagnostic("Security Filter에 대응하는 SecurityChain Fact 부재"));
        }

        partial |= servletRelations(
                context.serviceId(), report, filters, availableEvidence, relations, diagnostics);
        return result(relations, partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    @Override
    public Set<String> requiredFactTypes() {
        // CollectionProvider의 전역 PARTIAL 차단을 피하고 Collector별 상태를 개별 검증
        return Set.of();
    }

    private Map<String, Fact> chainMap(List<Fact> chains, List<AdapterDiagnostic> diagnostics) {
        Map<String, Fact> result = new LinkedHashMap<>();
        for (Fact chain : chains) {
            String chainKey = chain.attributes().get("chainKey");
            String chainOrder = chain.attributes().get("chainOrder");
            String proxyBeanName = chain.attributes().get("proxyBeanName");
            if (isBlank(chainKey) || isBlank(chainOrder) || isBlank(proxyBeanName)) {
                diagnostics.add(diagnostic("SecurityChain Fact 구조 불완전: " + chain.subjectKey()));
                continue;
            }
            String key = chainIdentity(proxyBeanName, chainKey, chainOrder);
            if (result.putIfAbsent(key, chain) != null) {
                diagnostics.add(diagnostic("SecurityChain Fact 식별 충돌: " + key));
            }
        }
        return result;
    }

    private Relation securityRelation(
            String serviceId,
            Fact filter,
            Map<String, Fact> chainsByKey,
            Set<String> availableEvidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        Map<String, String> attributes = filter.attributes();
        String chainKey = attributes.get("chainKey");
        String chainOrder = attributes.get("chainOrder");
        String proxyBeanName = attributes.get("proxyBeanName");
        String filterOrder = attributes.get("filterOrder");
        String filterClass = attributes.get("filterClass");
        if (isBlank(chainKey) || isBlank(chainOrder) || isBlank(proxyBeanName)
                || isBlank(filterOrder) || isBlank(filterClass) || !positiveInteger(filterOrder)) {
            diagnostics.add(diagnostic("Security Filter Fact 구조 불완전: " + filter.subjectKey()));
            return null;
        }
        Fact chain = chainsByKey.get(chainIdentity(proxyBeanName, chainKey, chainOrder));
        if (chain == null) {
            diagnostics.add(diagnostic("Security Filter의 Chain 참조 부재: " + filter.subjectKey()));
            return null;
        }
        Set<String> evidenceIds = mergedEvidence(chain, filter);
        if (!hasEvidence(availableEvidence, evidenceIds)) {
            diagnostics.add(diagnostic("Security Filter Evidence 참조 불완전: " + filter.subjectKey()));
            return null;
        }

        Map<String, String> relationAttributes = new TreeMap<>();
        relationAttributes.put("filterClass", filterClass);
        relationAttributes.put("registrationKind", "SECURITY");
        relationAttributes.put("proxyBeanName", proxyBeanName);
        relationAttributes.put("chainKey", chainKey);
        relationAttributes.put("chainOrder", chainOrder);
        relationAttributes.put("filterOrder", filterOrder);
        copyIfPresent(relationAttributes, attributes, "instanceReuse");
        Map<String, String> identity = new TreeMap<>();
        identity.put("filterClass", filterClass);
        identity.put("registrationKind", "SECURITY");
        identity.put("filterOrder", filterOrder);
        String sourceId = idGenerator.generate(serviceId, NodeType.SECURITY_CHAIN, chain.subjectKey());
        String targetId = idGenerator.generate(serviceId, NodeType.FILTER, filter.subjectKey());
        String relationId = idGenerator.generateEdge(sourceId, targetId, EdgeType.FILTERED_BY, identity);
        return new Relation(relationId, chain.subjectKey(), filter.subjectKey(), EdgeType.FILTERED_BY,
                relationAttributes, Confidence.CONFIRMED, List.copyOf(evidenceIds));
    }

    private boolean servletRelations(
            String serviceId,
            CollectionReport report,
            List<Fact> filters,
            Set<String> availableEvidence,
            List<Relation> relations,
            List<AdapterDiagnostic> diagnostics
    ) {
        List<Fact> servlets = facts(report, SERVLET_TYPE);
        List<Fact> servletFilters = filters.stream()
                .filter(filter -> "SERVLET".equals(filter.attributes().get("registrationKind")))
                .toList();
        if (servlets.isEmpty() && servletFilters.isEmpty()) {
            return false;
        }

        boolean partial = collectorIncomplete(report, SERVLET_FILTER_COLLECTOR)
                || collectorIncomplete(report, SERVLET_REGISTRATION_COLLECTOR);
        if (partial) {
            diagnostics.add(diagnostic("Servlet Filter 또는 Servlet 등록 수집 결과 불완전"));
        }
        if (!servletFilters.isEmpty() && servlets.isEmpty()) {
            partial = true;
            diagnostics.add(diagnostic("Servlet Filter에 대응하는 Servlet Registration Fact 부재"));
        }
        for (Fact filter : servletFilters) {
            String filterClass = filter.attributes().get("filterClass");
            String registrationName = filter.attributes().get("registrationName");
            if (isBlank(filterClass) || isBlank(registrationName)) {
                partial = true;
                diagnostics.add(diagnostic("Servlet Filter Fact 구조 불완전: " + filter.subjectKey()));
                continue;
            }
            String names = filter.attributes().get("servletNames");
            if (isBlank(names)) {
                if (!isBlank(filter.attributes().get("urlPatterns"))) {
                    partial = true;
                    diagnostics.add(diagnostic("Servlet URL Filter 매핑 범위 미확인: " + filter.subjectKey()));
                } else {
                    partial = true;
                    diagnostics.add(diagnostic("Servlet Filter 매핑 정보 부재: " + filter.subjectKey()));
                }
                continue;
            }
            Set<String> servletNames = splitValues(names);
            if (servletNames.isEmpty()) {
                partial = true;
                diagnostics.add(diagnostic("Servlet Filter Servlet 이름 매핑 부재: " + filter.subjectKey()));
                continue;
            }
            for (Fact servlet : servlets) {
                String servletName = servlet.attributes().get("servletName");
                String urlPattern = servlet.attributes().get("urlPattern");
                if (isBlank(servletName) || isBlank(urlPattern) || !servletNames.contains(servletName)) {
                    continue;
                }
                Set<String> evidenceIds = mergedEvidence(servlet, filter);
                if (!hasEvidence(availableEvidence, evidenceIds)) {
                    partial = true;
                    diagnostics.add(diagnostic("Servlet Filter Evidence 참조 불완전: " + filter.subjectKey()));
                    continue;
                }
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("filterClass", filterClass);
                attributes.put("registrationKind", "SERVLET");
                attributes.put("registrationName", registrationName);
                attributes.put("servletName", servletName);
                attributes.put("urlPattern", urlPattern);
                copyIfPresent(attributes, filter.attributes(), "urlPatterns");
                copyIfPresent(attributes, filter.attributes(), "servletNames");
                Map<String, String> identity = new TreeMap<>();
                identity.put("filterClass", filterClass);
                identity.put("registrationKind", "SERVLET");
                String sourceId = idGenerator.generate(serviceId, NodeType.SERVLET, servlet.subjectKey());
                String targetId = idGenerator.generate(serviceId, NodeType.FILTER, filter.subjectKey());
                String relationId = idGenerator.generateEdge(sourceId, targetId, EdgeType.FILTERED_BY, identity);
                relations.add(new Relation(relationId, servlet.subjectKey(), filter.subjectKey(),
                        EdgeType.FILTERED_BY, attributes, Confidence.CONFIRMED, List.copyOf(evidenceIds)));
            }
        }
        return partial;
    }

    private boolean collectorIncomplete(CollectionReport report, String collectorId) {
        AnalysisStatus status = report.statusByAdapter().get(collectorId);
        return status == AnalysisStatus.PARTIAL || status == AnalysisStatus.UNKNOWN;
    }

    private List<Fact> facts(CollectionReport report, String type) {
        return report.facts().stream()
                .filter(fact -> type.equals(fact.type()))
                .sorted(Comparator.comparing(Fact::subjectKey).thenComparing(Fact::id))
                .toList();
    }

    private Set<String> evidenceIds(List<Evidence> evidence) {
        return evidence.stream().map(Evidence::id).collect(java.util.stream.Collectors.toSet());
    }

    private Set<String> mergedEvidence(Fact first, Fact second) {
        Set<String> ids = new TreeSet<>(first.evidenceIds());
        ids.addAll(second.evidenceIds());
        return ids;
    }

    private boolean hasEvidence(Set<String> available, Set<String> required) {
        return !required.isEmpty() && available.containsAll(required);
    }

    private String chainIdentity(String proxyBeanName, String chainKey, String chainOrder) {
        return proxyBeanName + "|" + chainKey + "|" + chainOrder;
    }

    private Set<String> splitValues(String values) {
        Set<String> result = new LinkedHashSet<>();
        for (String value : values.split(",")) {
            if (!isBlank(value)) {
                result.add(value.trim());
            }
        }
        return result;
    }

    private boolean positiveInteger(String value) {
        try {
            return Integer.parseInt(value) > 0;
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private void copyIfPresent(Map<String, String> target, Map<String, String> source, String key) {
        String value = source.get(key);
        if (!isBlank(value)) {
            target.put(key, value);
        }
    }

    private AnalysisResult unknown(String summary) {
        return result(List.of(), AnalysisStatus.UNKNOWN, List.of(diagnostic(summary)));
    }

    private AnalysisResult result(List<Relation> relations, AnalysisStatus status,
                                  List<AdapterDiagnostic> diagnostics) {
        return new AnalysisResult(id(), relations, List.of(), status, diagnostics);
    }

    private AdapterDiagnostic diagnostic(String summary) {
        return new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
