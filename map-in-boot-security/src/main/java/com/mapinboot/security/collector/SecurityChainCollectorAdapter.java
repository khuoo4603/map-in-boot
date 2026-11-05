package com.mapinboot.security.collector;

import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.StableIdGenerator;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AndRequestMatcher;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

// Spring Security Runtime FilterChain 및 RequestMatcher 수집기
public class SecurityChainCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "SECURITY_CHAIN";
    private static final int MAX_MATCHER_DEPTH = 32;
    private static final String HTTP_METHOD_MATCHER =
            "org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher$HttpMethodRequestMatcher";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public SecurityChainCollectorAdapter() {
        super("security-chain", "Spring Security FilterChain 및 Matcher 수집", Set.of(TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }

        ApplicationContext applicationContext = context.applicationContext();
        Map<String, FilterChainProxy> proxies = new TreeMap<>(
                applicationContext.getBeansOfType(FilterChainProxy.class));
        if (proxies.isEmpty()) {
            return unavailable("FilterChainProxy 미등록");
        }

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Map<String, Integer> occurrences = new HashMap<>();
        boolean partial = false;
        int readableProxies = 0;

        for (Map.Entry<String, FilterChainProxy> proxyEntry : proxies.entrySet()) {
            List<SecurityFilterChain> chains;
            try {
                chains = proxyEntry.getValue().getFilterChains();
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "FilterChainProxy 등록 Chain 조회 실패"));
                continue;
            }
            if (chains == null) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                        "FilterChainProxy 등록 Chain 정보 부재"));
                continue;
            }
            readableProxies++;

            // FilterChainProxy 등록 목록의 실제 적용 순서 기준
            for (int index = 0; index < chains.size(); index++) {
                SecurityFilterChain chain = chains.get(index);
                try {
                    MatcherInfo matcher = matcherInfo(chain);
                    if (matcher.diagnostic() != null) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, matcher.diagnostic()));
                    }
                    String occurrenceKey = proxyEntry.getKey() + "|" + matcher.structuralKey();
                    int occurrence = occurrences.merge(occurrenceKey, 1, Integer::sum);
                    String chainKey = occurrenceKey + "|" + occurrence;
                    String subjectKey = "chain|" + chainKey;
                    String evidenceId = idGenerator.generate(
                            context.serviceId(), NodeType.SECURITY_CHAIN, "evidence|" + subjectKey);
                    String chainOrder = Integer.toString(index + 1);
                    Map<String, String> attributes = new TreeMap<>();
                    attributes.put("chainKey", chainKey);
                    attributes.put("chainOrder", chainOrder);
                    attributes.put("proxyBeanName", proxyEntry.getKey());
                    attributes.put("matcherClass", matcher.matcherClass());
                    attributes.put("matcherType", matcher.type());
                    if (matcher.condition() != null) {
                        attributes.put("matcherCondition", matcher.condition());
                    }
                    if (matcher.httpMethod() != null) {
                        attributes.put("httpMethod", matcher.httpMethod());
                    }
                    if (matcher.pathPatternSettings() != null) {
                        attributes.put("pathPatternSettings", matcher.pathPatternSettings());
                    }
                    facts.add(new Fact(
                            idGenerator.generate(context.serviceId(), NodeType.SECURITY_CHAIN, "fact|" + subjectKey),
                            TYPE, subjectKey, attributes, List.of(evidenceId)));
                    evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME,
                            "FilterChainProxy:" + proxyEntry.getKey() + "[" + chainOrder + "]",
                            "SecurityFilterChain Matcher 수집: " + matcher.type()));
                } catch (RuntimeException exception) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                            "SecurityFilterChain 등록 항목 처리 실패"));
                }
            }
        }

        if (readableProxies == 0) {
            return new CollectionResult(id(), facts, evidence, AnalysisStatus.UNKNOWN, diagnostics);
        }
        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    private MatcherInfo matcherInfo(SecurityFilterChain chain) {
        if (!(chain instanceof DefaultSecurityFilterChain defaultChain)) {
            String matcherClass = chain == null ? "null" : chain.getClass().getName();
            return new MatcherInfo("UNKNOWN", null, "UNKNOWN|" + matcherClass, matcherClass,
                    "DefaultSecurityFilterChain 이외의 SecurityFilterChain 구현 Matcher 미지원");
        }
        RequestMatcher matcher = defaultChain.getRequestMatcher();
        return matcherInfo(matcher, Collections.newSetFromMap(new IdentityHashMap<>()), 0);
    }

    private MatcherInfo matcherInfo(RequestMatcher matcher, Set<RequestMatcher> visited, int depth) {
        if (matcher == null) {
            return incomplete("UNKNOWN", "null", "RequestMatcher 부재");
        }
        if (depth > MAX_MATCHER_DEPTH) {
            return incomplete("UNKNOWN", matcher.getClass().getName(), "RequestMatcher 중첩 깊이 초과");
        }
        if (!visited.add(matcher)) {
            return incomplete("UNKNOWN", matcher.getClass().getName(), "RequestMatcher 순환 구조 감지");
        }

        try {
            // Spring Security 7 Runtime Matcher의 확인 가능한 구조 필드 해석
            if (matcher instanceof PathPatternRequestMatcher pathPatternMatcher) {
            PathPattern pattern = readField(pathPatternMatcher, "pattern", PathPattern.class);
            if (pattern == null) {
                return incomplete("PATH", pathPatternMatcher.getClass().getName(), "Path Matcher 경로 조건 확인 실패");
            }
            PathPatternSettings settings = pathPatternSettings(pattern);
            if (settings == null) {
                return incomplete("PATH", pathPatternMatcher.getClass().getName(),
                        "PathPattern 설정 확인 실패");
            }
            RequestMatcher methodMatcher = readField(pathPatternMatcher, "method", RequestMatcher.class);
            String path = pattern.getPatternString();
            if (methodMatcher == null) {
                return incomplete("PATH", pathPatternMatcher.getClass().getName(),
                        "Path Matcher HTTP Method 필드 확인 실패");
            }
            if (methodMatcher instanceof AnyRequestMatcher) {
                String structuralKey = structuralKey("PATH", path, settings);
                return supported("PATH", path, structuralKey, pathPatternMatcher.getClass().getName(), null,
                        settings.value(), settings.known() ? null : "PathPattern 기본 Parser 의미 동등성 확인 실패");
            }
            if (!HTTP_METHOD_MATCHER.equals(methodMatcher.getClass().getName())) {
                return incomplete("PATH", pathPatternMatcher.getClass().getName(),
                        "Path Matcher HTTP Method 조건 유형 미지원");
            }
            HttpMethod method = readField(methodMatcher, "method", HttpMethod.class);
            if (method == null) {
                return incomplete("METHOD_PATH", pathPatternMatcher.getClass().getName(),
                        "Path Matcher HTTP Method 조건 확인 실패");
            }
            String condition = method.name() + " " + path;
            String structuralKey = structuralKey("METHOD_PATH", condition, settings);
            return supported("METHOD_PATH", condition, structuralKey,
                    pathPatternMatcher.getClass().getName(), method.name(), settings.value(),
                    settings.known() ? null : "PathPattern 기본 Parser 의미 동등성 확인 실패");
            }
            if (matcher instanceof NegatedRequestMatcher negatedMatcher) {
            RequestMatcher nested = readField(negatedMatcher, "requestMatcher", RequestMatcher.class);
            MatcherInfo nestedInfo = matcherInfo(nested, visited, depth + 1);
            String condition = nestedInfo.condition() == null ? null : "NOT(" + nestedInfo.condition() + ")";
            String structuralKey = "NEGATED|" + nestedInfo.structuralKey();
            String diagnostic = nestedInfo.diagnostic();
            if (condition == null && diagnostic == null) {
                diagnostic = "부정 Matcher 조건 확인 실패";
            }
            return new MatcherInfo("NEGATED", condition, structuralKey, negatedMatcher.getClass().getName(), diagnostic,
                    null, nestedInfo.pathPatternSettings());
            }
            if (matcher instanceof AndRequestMatcher andMatcher) {
            return composite("AND", andMatcher, "requestMatchers", visited, depth + 1);
            }
            if (matcher instanceof OrRequestMatcher orMatcher) {
            return composite("OR", orMatcher, "requestMatchers", visited, depth + 1);
            }
            if (matcher instanceof AnyRequestMatcher) {
            return supported("ANY", "ANY", "ANY", matcher.getClass().getName(), null);
            }
            String matcherClass = matcher.getClass().getName();
            return new MatcherInfo("UNSUPPORTED", null, "UNSUPPORTED|" + matcherClass, matcherClass,
                    "지원하지 않는 RequestMatcher 유형: " + matcherClass);
        } finally {
            visited.remove(matcher);
        }
    }

    private MatcherInfo composite(
            String type, RequestMatcher matcher, String fieldName, Set<RequestMatcher> visited, int depth) {
        Object nestedValue = readField(matcher, fieldName, Object.class);
        if (!(nestedValue instanceof List<?> values)) {
            return incomplete(type, matcher.getClass().getName(), type + " Matcher 구성 확인 실패");
        }
        List<RequestMatcher> nested = new ArrayList<>();
        for (Object nestedMatcher : values) {
            if (!(nestedMatcher instanceof RequestMatcher requestMatcher)) {
                return incomplete(type, matcher.getClass().getName(), type + " Matcher 하위 조건 유형 미지원");
            }
            nested.add(requestMatcher);
        }
        List<MatcherInfo> children = nested.stream()
                .map(child -> matcherInfo(child, visited, depth))
                .toList();
        String condition = children.stream()
                .map(MatcherInfo::condition)
                .collect(Collectors.joining(",", type + "(", ")"));
        String structuralKey = children.stream()
                .map(MatcherInfo::structuralKey)
                .collect(Collectors.joining(",", type + "(", ")"));
        String diagnostic = children.stream()
                .map(MatcherInfo::diagnostic)
                .filter(value -> value != null)
                .findFirst()
                .orElse(null);
        if (children.stream().anyMatch(child -> child.condition() == null)) {
            condition = null;
        }
        String pathPatternSettings = mergePathPatternSettings(children);
        if ("UNKNOWN".equals(pathPatternSettings) && diagnostic == null) {
            diagnostic = "복합 Matcher PathPattern 설정 확인 실패";
        }
        return new MatcherInfo(type, condition, structuralKey, matcher.getClass().getName(), diagnostic, null,
                pathPatternSettings);
    }

    private MatcherInfo supported(
            String type, String condition, String structuralKey, String matcherClass, String httpMethod) {
        return new MatcherInfo(type, condition, structuralKey, matcherClass, null, httpMethod, null);
    }

    private MatcherInfo supported(
            String type, String condition, String structuralKey, String matcherClass, String httpMethod,
            String pathPatternSettings, String diagnostic) {
        return new MatcherInfo(type, condition, structuralKey, matcherClass, diagnostic, httpMethod,
                pathPatternSettings);
    }

    private MatcherInfo incomplete(String type, String matcherClass, String diagnostic) {
        return new MatcherInfo(type, null, type + "|UNKNOWN", matcherClass, diagnostic, null, "UNKNOWN");
    }

    private String structuralKey(String type, String condition, PathPatternSettings settings) {
        if (settings.defaultCompatible()) {
            return type + "|" + condition;
        }
        return type + "|" + condition + "|PATH_PATTERN_SETTINGS|" + settings.value();
    }

    private PathPatternSettings pathPatternSettings(PathPattern pattern) {
        Boolean caseSensitive = readField(pattern, "caseSensitive", Boolean.class);
        PathContainer.Options options = readField(pattern, "pathOptions", PathContainer.Options.class);
        if (caseSensitive == null || options == null) {
            return null;
        }
        PathPatternValues actual = new PathPatternValues(
                caseSensitive, options.separator(), options.shouldDecodeAndParseSegments());
        PathPatternValues defaults;
        try {
            PathPattern defaultPattern = PathPatternParser.defaultInstance.parse(pattern.getPatternString());
            Boolean defaultCaseSensitive = readField(defaultPattern, "caseSensitive", Boolean.class);
            PathContainer.Options defaultOptions = readField(
                    defaultPattern, "pathOptions", PathContainer.Options.class);
            if (defaultCaseSensitive == null || defaultOptions == null) {
                return new PathPatternSettings("UNKNOWN", false, false);
            }
            defaults = new PathPatternValues(
                    defaultCaseSensitive, defaultOptions.separator(), defaultOptions.shouldDecodeAndParseSegments());
        } catch (RuntimeException exception) {
            return new PathPatternSettings("UNKNOWN", false, false);
        }
        if (actual.equals(defaults)) {
            return new PathPatternSettings("DEFAULT", true, true);
        }
        return new PathPatternSettings("NON_DEFAULT|" + actual.signature(), false, true);
    }

    private String mergePathPatternSettings(List<MatcherInfo> children) {
        List<String> settings = children.stream()
                .map(MatcherInfo::pathPatternSettings)
                .filter(value -> value != null)
                .toList();
        if (settings.isEmpty()) {
            return null;
        }
        if (settings.contains("UNKNOWN")) {
            return "UNKNOWN";
        }
        if (settings.stream().anyMatch(value -> !"DEFAULT".equals(value))) {
            return "NON_DEFAULT";
        }
        return "DEFAULT";
    }

    private <T> T readField(Object target, String name, Class<T> type) {
        if (target == null) {
            return null;
        }
        try {
            Field field = target.getClass().getDeclaredField(name);
            if (!field.trySetAccessible()) {
                return null;
            }
            Object value = field.get(target);
            return type.isInstance(value) ? type.cast(value) : null;
        } catch (ReflectiveOperationException | SecurityException exception) {
            return null;
        }
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record MatcherInfo(
            String type,
            String condition,
            String structuralKey,
            String matcherClass,
            String diagnostic,
            String httpMethod,
            String pathPatternSettings
    ) {
        private MatcherInfo(String type, String condition, String structuralKey, String matcherClass, String diagnostic) {
            this(type, condition, structuralKey, matcherClass, diagnostic, null, null);
        }
    }

    private record PathPatternSettings(String value, boolean defaultCompatible, boolean known) {
    }

    private record PathPatternValues(boolean caseSensitive, char separator, boolean decodeAndParseSegments) {
        private String signature() {
            return "caseSensitive=" + caseSensitive
                    + ";separator=" + separator
                    + ";decodeAndParseSegments=" + decodeAndParseSegments;
        }
    }
}
