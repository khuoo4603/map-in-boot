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
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.StableIdGenerator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.http.server.PathContainer;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

// Endpoint request set과 최초 적용 SecurityFilterChain 관계 분석
public class EndpointChainMatchingAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String CHAIN_TYPE = "SECURITY_CHAIN";
    private static final String ENDPOINT_COLLECTOR = "starter-endpoint-mapping";
    private static final String CHAIN_COLLECTOR = "security-chain";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public EndpointChainMatchingAnalysisAdapter() {
        super("security-endpoint-chain-matching", "Endpoint 최초 적용 SecurityFilterChain 분석", Set.of("MATCHED_BY"));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("분석 입력 또는 서비스 식별자 부재");
        }

        CollectionReport report = context.collectionReport();
        List<Fact> endpoints = report.facts().stream()
                .filter(fact -> fact != null && ENDPOINT_TYPE.equals(fact.type()))
                .toList();
        List<Fact> chains = report.facts().stream()
                .filter(fact -> fact != null && CHAIN_TYPE.equals(fact.type()))
                .toList();

        AnalysisStatus endpointStatus = report.statusByAdapter().get(ENDPOINT_COLLECTOR);
        AnalysisStatus chainStatus = report.statusByAdapter().get(CHAIN_COLLECTOR);
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        if (endpointStatus == null || chainStatus == null) {
            diagnostics.add(diagnostic("Endpoint 또는 SecurityChain 수집 상태 부재"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (endpointStatus == AnalysisStatus.UNKNOWN || endpoints.isEmpty()) {
            diagnostics.add(diagnostic("Endpoint Fact 부재 또는 수집 상태 UNKNOWN"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (chainStatus == AnalysisStatus.UNKNOWN || chains.isEmpty()) {
            diagnostics.add(diagnostic("SecurityChain Fact 부재 또는 수집 상태 UNKNOWN"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        boolean partialCollection = false;
        if (endpointStatus != AnalysisStatus.READY) {
            diagnostics.add(diagnostic("Endpoint 수집 상태 불완전"));
            partialCollection = true;
        }
        if (chainStatus != AnalysisStatus.READY) {
            diagnostics.add(diagnostic("SecurityChain 수집 상태 불완전"));
            partialCollection = true;
        }

        List<ChainFact> orderedChains = orderChains(chains, diagnostics);
        if (orderedChains == null) {
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (orderedChains.stream().map(ChainFact::proxyBeanName).distinct().count() > 1) {
            diagnostics.add(diagnostic("복수 FilterChainProxy 사이의 전역 Chain 순서 미확인"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }

        List<Relation> relations = new ArrayList<>();
        boolean partial = partialCollection;
        for (Fact endpoint : endpoints) {
            EndpointRequest request = endpointRequest(endpoint);
            if (request == null) {
                partial = true;
                diagnostics.add(diagnostic("Endpoint request set 구조 불완전: " + endpoint.subjectKey()));
                continue;
            }

            boolean resolved = false;
            int expectedOrder = 1;
            for (ChainFact chain : orderedChains) {
                if (chain.order() != expectedOrder) {
                    partial = true;
                    diagnostics.add(diagnostic("SecurityChain 순서 공백으로 후속 적용 여부 불확실"));
                    resolved = true;
                    break;
                }
                expectedOrder++;
                Coverage coverage = coverage(chain.matcher(), request);
                if (coverage == Coverage.ALL) {
                    relations.add(relation(context.serviceId(), endpoint, chain.fact()));
                    resolved = true;
                    break;
                }
                if (coverage == Coverage.PARTIAL || coverage == Coverage.UNKNOWN) {
                    partial = true;
                    diagnostics.add(diagnostic("선행 Chain 적용 여부 불확실: " + chain.fact().subjectKey()));
                    resolved = true;
                    break;
                }
            }
            if (!resolved) {
                // 모든 Chain 비적용 상태는 별도 CHAIN_MISSING 관계 없이 보존
            }
        }

        return result(relations, partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    @Override
    public Set<String> requiredFactTypes() {
        // Core 전역 수집 게이트 우회 및 Endpoint·Chain 개별 상태 검증
        return Set.of();
    }

    private List<ChainFact> orderChains(List<Fact> facts, List<AdapterDiagnostic> diagnostics) {
        List<ChainFact> result = new ArrayList<>();
        Set<String> orders = new LinkedHashSet<>();
        for (Fact fact : facts) {
            String chainKey = fact.attributes().get("chainKey");
            String proxyBeanName = fact.attributes().get("proxyBeanName");
            String orderValue = fact.attributes().get("chainOrder");
            String matcherType = fact.attributes().get("matcherType");
            if (isBlank(fact.subjectKey()) || isBlank(chainKey) || isBlank(proxyBeanName)
                    || isBlank(orderValue) || isBlank(matcherType)) {
                diagnostics.add(diagnostic("SecurityChain Fact 구조 불완전: " + fact.subjectKey()));
                return null;
            }
            int order;
            try {
                order = Integer.parseInt(orderValue);
            } catch (NumberFormatException exception) {
                diagnostics.add(diagnostic("SecurityChain 순서 해석 실패: " + fact.subjectKey()));
                return null;
            }
            if (order < 1 || !orders.add(proxyBeanName + "|" + order)) {
                diagnostics.add(diagnostic("SecurityChain 순서 중복 또는 부적합: " + fact.subjectKey()));
                return null;
            }
            MatcherExpression matcher = matcher(fact);
            result.add(new ChainFact(fact, proxyBeanName, order, matcher));
        }
        result.sort(Comparator.comparingInt(ChainFact::order).thenComparing(chain -> chain.fact().subjectKey()));
        return result;
    }

    private EndpointRequest endpointRequest(Fact fact) {
        String method = fact.attributes().get("httpMethod");
        String path = fact.attributes().get("path");
        String mvcPathPatternSettings = fact.attributes().get("mvcPathPatternSettings");
        if (isBlank(fact.subjectKey()) || isBlank(method) || isBlank(path)) {
            return null;
        }
        if (isBlank(mvcPathPatternSettings)) {
            mvcPathPatternSettings = "UNKNOWN";
        }
        if (!"ANY".equals(method) && !method.equals(method.toUpperCase(Locale.ROOT))) {
            return null;
        }
        return new EndpointRequest(method, path, mvcPathPatternSettings);
    }

    private MatcherExpression matcher(Fact fact) {
        String type = fact.attributes().get("matcherType");
        String condition = fact.attributes().get("matcherCondition");
        if (isBlank(type) || isBlank(condition)) {
            return MatcherExpression.invalid();
        }
        if ("ANY".equals(type)) {
            return "ANY".equals(condition) ? new MatcherExpression("ANY", null, null, List.of(), true)
                    : MatcherExpression.invalid();
        }
        if (condition.contains("/") && !"DEFAULT".equals(fact.attributes().get("pathPatternSettings"))) {
            return MatcherExpression.invalid();
        }
        if ("PATH".equals(type)) {
            return new MatcherExpression("PATH", null, condition, List.of(), true);
        }
        if ("METHOD_PATH".equals(type)) {
            String method = fact.attributes().get("httpMethod");
            int separator = condition.indexOf(' ');
            if (isBlank(method) && separator > 0) {
                method = condition.substring(0, separator);
            }
            String path = separator > 0 ? condition.substring(separator + 1) : null;
            if (isBlank(method) || isBlank(path)) {
                return MatcherExpression.invalid();
            }
            return new MatcherExpression("METHOD_PATH", method, path, List.of(), true);
        }
        MatcherExpression parsed = parseExpression(condition);
        return parsed.valid() && type.equals(parsed.type()) ? parsed : MatcherExpression.invalid();
    }

    private MatcherExpression parseExpression(String value) {
        if (isBlank(value)) {
            return MatcherExpression.invalid();
        }
        String expression = value.trim();
        if ("ANY".equals(expression)) {
            return new MatcherExpression("ANY", null, null, List.of(), true);
        }
        for (String type : List.of("NOT", "AND", "OR")) {
            String prefix = type + "(";
            if (expression.startsWith(prefix) && expression.endsWith(")")) {
                String inner = expression.substring(prefix.length(), expression.length() - 1);
                if ("NOT".equals(type)) {
                    MatcherExpression child = parseExpression(inner);
                    return child.valid()
                            ? new MatcherExpression("NEGATED", null, null, List.of(child), true)
                            : MatcherExpression.invalid();
                }
                List<String> parts = splitTopLevel(inner);
                if (parts.isEmpty()) {
                    return MatcherExpression.invalid();
                }
                List<MatcherExpression> children = parts.stream().map(this::parseExpression).toList();
                return children.stream().allMatch(MatcherExpression::valid)
                        ? new MatcherExpression(type, null, null, children, true)
                        : MatcherExpression.invalid();
            }
        }
        int separator = expression.indexOf(' ');
        if (separator > 0 && isHttpMethod(expression.substring(0, separator))) {
            String path = expression.substring(separator + 1);
            return isBlank(path)
                    ? MatcherExpression.invalid()
                    : new MatcherExpression("METHOD_PATH", expression.substring(0, separator), path, List.of(), true);
        }
        return expression.startsWith("/")
                ? new MatcherExpression("PATH", null, expression, List.of(), true)
                : MatcherExpression.invalid();
    }

    private List<String> splitTopLevel(String value) {
        List<String> result = new ArrayList<>();
        int depth = 0;
        int start = 0;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '(') {
                depth++;
            } else if (character == ')') {
                depth--;
                if (depth < 0) {
                    return List.of();
                }
            } else if (character == ',' && depth == 0) {
                String part = value.substring(start, index).trim();
                if (part.isEmpty()) {
                    return List.of();
                }
                result.add(part);
                start = index + 1;
            }
        }
        if (depth != 0) {
            return List.of();
        }
        String last = value.substring(start).trim();
        if (last.isEmpty()) {
            return List.of();
        }
        result.add(last);
        return result;
    }

    private Coverage coverage(MatcherExpression matcher, EndpointRequest endpoint) {
        if (!matcher.valid()) {
            return Coverage.UNKNOWN;
        }
        return switch (matcher.type()) {
            case "ANY" -> Coverage.ALL;
            case "PATH" -> pathCoverage(matcher.path(), endpoint.path(), endpoint.mvcPathPatternSettings());
            case "METHOD_PATH" -> combine(
                    methodCoverage(matcher.method(), endpoint.method()),
                    pathCoverage(matcher.path(), endpoint.path(), endpoint.mvcPathPatternSettings()));
            case "NEGATED" -> invert(coverage(matcher.children().get(0), endpoint));
            case "AND" -> all(matcher.children(), endpoint);
            case "OR" -> any(matcher.children(), endpoint);
            default -> Coverage.UNKNOWN;
        };
    }

    private Coverage all(List<MatcherExpression> matchers, EndpointRequest endpoint) {
        boolean all = true;
        for (MatcherExpression matcher : matchers) {
            Coverage coverage = coverage(matcher, endpoint);
            if (coverage == Coverage.NONE) {
                return Coverage.NONE;
            }
            if (coverage != Coverage.ALL) {
                all = false;
            }
        }
        return all ? Coverage.ALL : Coverage.UNKNOWN;
    }

    private Coverage any(List<MatcherExpression> matchers, EndpointRequest endpoint) {
        boolean allNone = true;
        for (MatcherExpression matcher : matchers) {
            Coverage coverage = coverage(matcher, endpoint);
            if (coverage == Coverage.ALL) {
                return Coverage.ALL;
            }
            if (coverage != Coverage.NONE) {
                allNone = false;
            }
        }
        return allNone ? Coverage.NONE : Coverage.UNKNOWN;
    }

    private Coverage methodCoverage(String matcherMethod, String endpointMethod) {
        if ("ANY".equals(endpointMethod)) {
            return Coverage.PARTIAL;
        }
        if (isBlank(matcherMethod) || "ANY".equals(matcherMethod)) {
            return Coverage.ALL;
        }
        return matcherMethod.equalsIgnoreCase(endpointMethod) ? Coverage.ALL : Coverage.NONE;
    }

    // PathPattern 실제 매칭 및 동적 request set 포함관계 보수 판정
    private Coverage pathCoverage(String matcherPath, String endpointPath, String mvcPathPatternSettings) {
        if (isBlank(matcherPath) || isBlank(endpointPath)) {
            return Coverage.UNKNOWN;
        }
        if (!"DEFAULT".equals(mvcPathPatternSettings)) {
            return Coverage.UNKNOWN;
        }

        PathPattern matcherPattern = parsePathPattern(matcherPath);
        PathPattern endpointPattern = parsePathPattern(endpointPath);
        if (matcherPattern == null || endpointPattern == null) {
            return Coverage.UNKNOWN;
        }
        if (matcherPath.equals(endpointPath)) {
            return Coverage.ALL;
        }

        if (!endpointPattern.hasPatternSyntax()) {
            return matcherPattern.matches(PathContainer.parsePath(endpointPath))
                    ? Coverage.ALL : Coverage.NONE;
        }
        String catchAllPrefix = catchAllPrefix(matcherPath);
        if (catchAllPrefix != null && endpointWithinPrefix(endpointPath, catchAllPrefix)) {
            return Coverage.ALL;
        }
        if (!matcherPattern.hasPatternSyntax()) {
            return endpointPattern.matches(PathContainer.parsePath(matcherPath))
                    ? Coverage.PARTIAL : Coverage.NONE;
        }
        return Coverage.UNKNOWN;
    }

    private PathPattern parsePathPattern(String path) {
        try {
            return PathPatternParser.defaultInstance.parse(path);
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private String catchAllPrefix(String path) {
        String prefix = null;
        if (path.endsWith("/**")) {
            prefix = path.substring(0, path.length() - 3);
        } else {
            int captureStart = path.lastIndexOf("/{*");
            if (captureStart >= 0 && path.endsWith("}")) {
                prefix = path.substring(0, captureStart);
            }
        }
        if (prefix == null) {
            return null;
        }
        String normalizedPrefix = prefix.isEmpty() ? "/" : prefix;
        PathPattern prefixPattern = parsePathPattern(normalizedPrefix);
        return prefixPattern != null && !prefixPattern.hasPatternSyntax() ? prefix : null;
    }

    private boolean endpointWithinPrefix(String endpointPath, String prefix) {
        return prefix.isEmpty() || "/".equals(prefix)
                || endpointPath.equals(prefix) || endpointPath.startsWith(prefix + "/");
    }

    private Coverage combine(Coverage first, Coverage second) {
        if (first == Coverage.NONE || second == Coverage.NONE) {
            return Coverage.NONE;
        }
        if (first == Coverage.ALL && second == Coverage.ALL) {
            return Coverage.ALL;
        }
        if (first == Coverage.UNKNOWN || second == Coverage.UNKNOWN) {
            return Coverage.UNKNOWN;
        }
        return Coverage.PARTIAL;
    }

    private Coverage invert(Coverage value) {
        return switch (value) {
            case ALL -> Coverage.NONE;
            case NONE -> Coverage.ALL;
            case PARTIAL, UNKNOWN -> Coverage.UNKNOWN;
        };
    }

    private Relation relation(String serviceId, Fact endpoint, Fact chain) {
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("matcherType", chain.attributes().get("matcherType"));
        attributes.put("matcherCondition", chain.attributes().get("matcherCondition"));
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", chain.attributes().get("chainOrder"));
        Map<String, String> identity = Map.of(
                "matcherType", attributes.get("matcherType"),
                "matcherCondition", attributes.get("matcherCondition"),
                "chainKey", attributes.get("chainKey"),
                "chainOrder", attributes.get("chainOrder"));
        String sourceId = idGenerator.generate(serviceId, NodeType.ENDPOINT, endpoint.subjectKey());
        String targetId = idGenerator.generate(serviceId, NodeType.SECURITY_CHAIN, chain.subjectKey());
        String id = idGenerator.generateEdge(sourceId, targetId, EdgeType.MATCHED_BY, identity);
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(chain.evidenceIds());
        return new Relation(id, endpoint.subjectKey(), chain.subjectKey(), EdgeType.MATCHED_BY,
                attributes, Confidence.CONFIRMED, List.copyOf(evidenceIds));
    }

    private AnalysisResult unknown(String summary) {
        return result(List.of(), AnalysisStatus.UNKNOWN, List.of(diagnostic(summary)));
    }

    private AnalysisResult result(List<Relation> relations, AnalysisStatus status, List<AdapterDiagnostic> diagnostics) {
        return new AnalysisResult(id(), relations, List.of(), status, diagnostics);
    }

    private AdapterDiagnostic diagnostic(String summary) {
        return new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary);
    }

    private boolean isHttpMethod(String value) {
        return Set.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "TRACE", "CONNECT").contains(value);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private enum Coverage {
        ALL,
        NONE,
        PARTIAL,
        UNKNOWN
    }

    private record EndpointRequest(String method, String path, String mvcPathPatternSettings) {
    }

    private record ChainFact(Fact fact, String proxyBeanName, int order, MatcherExpression matcher) {
    }

    private record MatcherExpression(
            String type,
            String method,
            String path,
            List<MatcherExpression> children,
            boolean valid
    ) {
        private static MatcherExpression invalid() {
            return new MatcherExpression("UNKNOWN", null, null, List.of(), false);
        }
    }
}
