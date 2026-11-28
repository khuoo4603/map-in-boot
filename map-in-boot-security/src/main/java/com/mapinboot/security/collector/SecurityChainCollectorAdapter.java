package com.mapinboot.security.collector;

import jakarta.servlet.Filter;
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
import java.io.IOException;
import java.io.InputStream;
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
import org.springframework.security.authorization.AllAuthoritiesAuthorizationManager;
import org.springframework.security.authorization.AuthenticatedAuthorizationManager;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authorization.SingleResultAuthorizationManager;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.PathContainer;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AndRequestMatcher;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcherEntry;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

// Spring Security Runtime FilterChain 및 RequestMatcher 수집기
public class SecurityChainCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "SECURITY_CHAIN";
    private static final String URL_AUTHORIZATION_TYPE = "URL_AUTHORIZATION";
    private static final String FILTER_REGISTRATION_TYPE = "FILTER_REGISTRATION";
    private static final int MAX_MATCHER_DEPTH = 32;
    private static final String HTTP_METHOD_MATCHER =
            "org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher$HttpMethodRequestMatcher";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public SecurityChainCollectorAdapter() {
        super("security-chain", "Spring Security FilterChain 및 Matcher 수집",
                Set.of(TYPE, URL_AUTHORIZATION_TYPE, FILTER_REGISTRATION_TYPE));
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
        IdentityHashMap<Filter, String> filterLocations = new IdentityHashMap<>();
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
                    partial |= collectSecurityFilters(
                            context.serviceId(), proxyEntry.getKey(), chainOrder, chainKey, chain,
                            filterLocations, facts, evidence, diagnostics);
                    partial |= collectUrlAuthorizationPolicies(
                            context.serviceId(), proxyEntry.getKey(), chainOrder, chainKey, chain,
                            facts, evidence, diagnostics);
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

    private boolean collectSecurityFilters(
            String serviceId,
            String proxyBeanName,
            String chainOrder,
            String chainKey,
            SecurityFilterChain chain,
            IdentityHashMap<Filter, String> filterLocations,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        List<? extends Filter> filters;
        try {
            filters = chain.getFilters();
        } catch (RuntimeException exception) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                    "SecurityFilterChain Filter 목록 조회 실패: " + chainKey));
            return true;
        }
        if (filters == null) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "SecurityFilterChain Filter 목록 부재: " + chainKey));
            return true;
        }

        boolean partial = false;
        for (int index = 0; index < filters.size(); index++) {
            Filter filter = filters.get(index);
            if (filter == null) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                        "SecurityFilter 구성 부재: " + chainKey));
                continue;
            }
            try {
                String filterClass = filter.getClass().getName();
                String filterOrder = Integer.toString(index + 1);
                String location = chainKey + "|" + filterOrder;
                String previousLocation = filterLocations.putIfAbsent(filter, location);
                String subjectKey = "filter|SECURITY|" + proxyBeanName + "|" + chainKey
                        + "|" + filterOrder + "|" + filterClass;
                String evidenceId = idGenerator.generate(
                        serviceId, NodeType.FILTER, "evidence|" + subjectKey);
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("filterClass", filterClass);
                attributes.put("registrationKind", "SECURITY");
                attributes.put("proxyBeanName", proxyBeanName);
                attributes.put("chainKey", chainKey);
                attributes.put("chainOrder", chainOrder);
                attributes.put("filterOrder", filterOrder);
                if (isBearerAuthenticationFilter(filterClass)) {
                    attributes.put("filterRole", "AUTHENTICATION_PROVIDER");
                }
                CodePatternInfo codePattern = codePattern(filterClass);
                if (codePattern.unknown()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Security Filter 코드 패턴 조회 불확실: " + filterClass));
                }
                attributes.putAll(codePattern.attributes());
                if (previousLocation != null) {
                    attributes.put("instanceReuse",
                            previousLocation.startsWith(chainKey + "|")
                                    ? "WITHIN_CHAIN" : "CROSS_CHAIN");
                }
                List<String> evidenceIds = new ArrayList<>(List.of(evidenceId));
                if (codePattern.evidence()) {
                    String codeEvidenceId = idGenerator.generate(
                            serviceId, NodeType.FILTER, "evidence|code|" + subjectKey);
                    evidenceIds.add(codeEvidenceId);
                    evidence.add(new Evidence(codeEvidenceId, EvidenceSource.CODE_PATTERN,
                            filterClass + ":doFilter",
                            "등록된 Filter의 인증정보 처리 코드 패턴: " + codePattern.attributes().get("codePattern")));
                }
                facts.add(new Fact(
                        idGenerator.generate(serviceId, NodeType.FILTER, "fact|" + subjectKey),
                        FILTER_REGISTRATION_TYPE, subjectKey, attributes, evidenceIds));
                evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME,
                        "FilterChainProxy:" + proxyBeanName + "[" + chainOrder + "]/filter[" + filterOrder + "]",
                        "Security Filter 수집: " + filterClass));
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Security Filter 처리 실패: " + chainKey));
            }
        }
        return partial;
    }

    private boolean isBearerAuthenticationFilter(String filterClass) {
        return "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter"
                .equals(filterClass);
    }

    private CodePatternInfo codePattern(String filterClass) {
        String resource = filterClass.replace('.', '/') + ".class";
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (loader == null) {
            loader = getClass().getClassLoader();
        }
        try (InputStream input = loader.getResourceAsStream(resource)) {
            if (input == null) {
                return CodePatternInfo.unavailable();
            }
            boolean[] flags = new boolean[7];
            new ClassReader(input).accept(new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(int access, String name, String descriptor,
                                                  String signature, String[] exceptions) {
                    if (!"doFilter".equals(name) && !"doFilterInternal".equals(name)) {
                        return null;
                    }
                    return new MethodVisitor(Opcodes.ASM9) {
                        @Override
                        public void visitMethodInsn(int opcode, String owner, String name,
                                                    String descriptor, boolean isInterface) {
                            if ("org/springframework/security/core/context/SecurityContextHolder".equals(owner)
                                    && "getContext".equals(name)) {
                                flags[0] = true;
                            }
                            if ("org/springframework/security/core/context/SecurityContext".equals(owner)
                                    && "getAuthentication".equals(name)) {
                                flags[1] = true;
                            }
                            if ("isAuthenticated".equals(name) && "()Z".equals(descriptor)
                                    && ("org/springframework/security/core/Authentication".equals(owner)
                                    || owner.endsWith("AuthenticationToken"))) {
                                flags[2] = true;
                            }
                            if ("jakarta/servlet/http/HttpServletResponse".equals(owner)
                                    && "sendError".equals(name)) {
                                flags[4] = true;
                            }
                            if ("jakarta/servlet/FilterChain".equals(owner)
                                    && "doFilter".equals(name)) {
                                flags[5] = true;
                            }
                        }

                        @Override
                        public void visitTypeInsn(int opcode, String type) {
                            if ((opcode == Opcodes.INSTANCEOF || opcode == Opcodes.CHECKCAST)
                                    && type.endsWith("/JwtAuthenticationToken")) {
                                flags[3] = true;
                            }
                        }

                        @Override
                        public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                            if (opcode == Opcodes.GETSTATIC
                                    && "jakarta/servlet/http/HttpServletResponse".equals(owner)
                                    && "SC_UNAUTHORIZED".equals(name)) {
                                flags[6] = true;
                            }
                        }

                        @Override
                        public void visitIntInsn(int opcode, int operand) {
                            if ((opcode == Opcodes.BIPUSH || opcode == Opcodes.SIPUSH) && operand == 401) {
                                flags[6] = true;
                            }
                        }

                        @Override
                        public void visitLdcInsn(Object value) {
                            if (Integer.valueOf(401).equals(value)) {
                                flags[6] = true;
                            }
                        }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            Map<String, String> attributes = new TreeMap<>();
            if (!flags[0] && !flags[1]) {
                return new CodePatternInfo(attributes, false, false);
            }
            attributes.put("authData", flags[0] && flags[1]
                    ? "SECURITY_CONTEXT_AUTHENTICATION" : "AUTHENTICATION_LOOKUP");
            attributes.put("authType", flags[3] ? "JWT_AUTHENTICATION" : "AUTHENTICATION");
            if (flags[2]) {
                attributes.put("authCheck", "IS_AUTHENTICATED");
            }
            if (flags[4] && flags[6]) {
                attributes.put("unauthenticatedAction", "HTTP_401");
            }
            if (flags[5]) {
                attributes.put("filterChainContinuation", "AFTER_AUTHENTICATION");
            }
            boolean guard = flags[0] && flags[1] && flags[2] && flags[4] && flags[5] && flags[6];
            attributes.put("codePattern", guard ? "AUTHENTICATION_GUARD" : "AUTHENTICATION_LOOKUP");
            return new CodePatternInfo(attributes, guard, false);
        } catch (IOException | RuntimeException exception) {
            return CodePatternInfo.unavailable();
        }
    }

    private record CodePatternInfo(Map<String, String> attributes, boolean evidence, boolean unknown) {
        private static CodePatternInfo unavailable() {
            return new CodePatternInfo(Map.of("codePattern", "UNKNOWN"), false, true);
        }
    }

    private boolean collectUrlAuthorizationPolicies(
            String serviceId,
            String proxyBeanName,
            String chainOrder,
            String chainKey,
            SecurityFilterChain chain,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        if (!(chain instanceof DefaultSecurityFilterChain defaultChain)) {
            return false;
        }

        List<AuthorizationFilter> authorizationFilters = defaultChain.getFilters().stream()
                .filter(AuthorizationFilter.class::isInstance)
                .map(AuthorizationFilter.class::cast)
                .toList();
        if (authorizationFilters.isEmpty()) {
            return false;
        }

        boolean partial = false;
        if (authorizationFilters.size() > 1) {
            partial = true;
            addUnknownPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, 1,
                    "AuthorizationFilter 중복으로 URL Authorization 분석 불가", facts, evidence);
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "SecurityFilterChain 내 AuthorizationFilter 중복 등록"));
            return true;
        }
        AuthorizationManager<?> manager = authorizationFilters.get(0).getAuthorizationManager();
        if (!(manager instanceof RequestMatcherDelegatingAuthorizationManager delegatingManager)) {
            addUnknownPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, 1,
                    "AuthorizationManager 유형 미지원", facts, evidence);
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "URL AuthorizationManager 구조 미지원"));
            return true;
        }

        List<?> mappings = readField(delegatingManager, "mappings", List.class);
        if (mappings == null || mappings.isEmpty()) {
            addUnknownPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, 1,
                    "URL Authorization 정책 목록 확인 실패", facts, evidence);
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "URL Authorization 정책 목록 확인 실패"));
            return true;
        }

        int policyOrder = 0;
        for (Object mapping : mappings) {
            policyOrder++;
            if (!(mapping instanceof RequestMatcherEntry<?> entry) || entry.getRequestMatcher() == null) {
                addUnknownPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, policyOrder,
                        "URL Authorization Matcher 확인 실패", facts, evidence);
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                        "URL Authorization Matcher 확인 실패"));
                partial = true;
                continue;
            }

            RequestMatcher requestMatcher = entry.getRequestMatcher();
            MatcherInfo matcher = matcherInfo(requestMatcher, Collections.newSetFromMap(new IdentityHashMap<>()), 0);
            PolicyInfo policy = policyInfo(entry.getEntry());
            if (matcher.diagnostic() != null || policy.diagnostic() != null) {
                partial = true;
                if (matcher.diagnostic() != null) {
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, matcher.diagnostic()));
                }
                if (policy.diagnostic() != null) {
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, policy.diagnostic()));
                }
            }
            addPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, policyOrder, matcher, policy,
                    facts, evidence);
        }
        return partial;
    }

    private void addUnknownPolicyFact(
            String serviceId,
            String proxyBeanName,
            String chainOrder,
            String chainKey,
            int policyOrder,
            String diagnostic,
            List<Fact> facts,
            List<Evidence> evidence
    ) {
        MatcherInfo matcher = new MatcherInfo(
                "UNKNOWN", null, "UNKNOWN|" + chainKey + "|" + policyOrder,
                "UNKNOWN", diagnostic, null, "UNKNOWN");
        addPolicyFact(serviceId, proxyBeanName, chainOrder, chainKey, policyOrder, matcher,
                new PolicyInfo("UNKNOWN", null, null, diagnostic), facts, evidence);
    }

    private void addPolicyFact(
            String serviceId,
            String proxyBeanName,
            String chainOrder,
            String chainKey,
            int policyOrder,
            MatcherInfo matcher,
            PolicyInfo policy,
            List<Fact> facts,
            List<Evidence> evidence
    ) {
        String policyMatcherType = matcher.type();
        String subjectKey = "policy|" + chainKey + "|" + policyOrder + "|"
                + matcher.structuralKey() + "|" + policy.kind() + "|"
                + String.valueOf(policy.requiredAuthority()) + "|"
                + String.valueOf(policy.authorityOperator());
        String evidenceId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("chainKey", chainKey);
        attributes.put("chainOrder", chainOrder);
        attributes.put("policyOrder", Integer.toString(policyOrder));
        attributes.put("policyKind", policy.kind());
        attributes.put("policyMatcherType", policyMatcherType);
        attributes.put("policySource", "URL");
        attributes.put("proxyBeanName", proxyBeanName);
        if (matcher.condition() != null) {
            attributes.put("policyMatcherCondition", matcher.condition());
        }
        if (policy.requiredAuthority() != null) {
            attributes.put("requiredAuthority", policy.requiredAuthority());
        }
        if (policy.authorityOperator() != null) {
            attributes.put("authorityOperator", policy.authorityOperator());
        }
        if (matcher.pathPatternSettings() != null) {
            attributes.put("pathPatternSettings", matcher.pathPatternSettings());
        }
        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "fact|" + subjectKey),
                URL_AUTHORIZATION_TYPE, subjectKey, attributes, List.of(evidenceId)));
        evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME,
                "FilterChainProxy:" + proxyBeanName + "[" + chainOrder + "]",
                "URL Authorization 정책 수집: " + policy.kind()));
    }

    private PolicyInfo policyInfo(Object manager) {
        if (manager instanceof SingleResultAuthorizationManager<?> singleResultManager) {
            AuthorizationResult result = readField(singleResultManager, "result", AuthorizationResult.class);
            if (result == null) {
                return new PolicyInfo("UNKNOWN", null, "SingleResultAuthorizationManager 결과 확인 실패");
            }
            return result.isGranted()
                    ? new PolicyInfo("PERMIT_ALL", null, null)
                    : new PolicyInfo("DENY_ALL", null, null);
        }
        if (manager instanceof AuthenticatedAuthorizationManager<?> authenticatedManager) {
            Object strategy = readField(authenticatedManager, "authorizationStrategy", Object.class);
            String strategyName = strategy == null ? null : strategy.getClass().getSimpleName();
            if (strategyName == null) {
                return new PolicyInfo("UNKNOWN", null, "AuthenticatedAuthorizationManager 전략 확인 실패");
            }
            if (strategyName.contains("FullyAuthenticated")) {
                return new PolicyInfo("FULLY_AUTHENTICATED", null, null);
            }
            if (strategyName.contains("Authenticated")) {
                return new PolicyInfo("AUTHENTICATED", null, null);
            }
            return new PolicyInfo("UNKNOWN", null, "지원하지 않는 AuthenticatedAuthorizationManager 전략");
        }
        if (manager instanceof AuthorityAuthorizationManager<?> authorityManager) {
            Set<String> authorities = readField(authorityManager, "authorities", Set.class);
            if (authorities == null || authorities.isEmpty()) {
                return new PolicyInfo("UNKNOWN", null, null, "Authority list could not be confirmed");
            }
            String requiredAuthority = authorities.stream().sorted().collect(Collectors.joining(","));
            return new PolicyInfo(authorities.size() == 1 ? "AUTHORITY_REQUIRED" : "COMPOSITE_AUTHORITY",
                    requiredAuthority, authorities.size() == 1 ? null : "ANY", null);
        }
        if (manager instanceof AllAuthoritiesAuthorizationManager<?> allAuthoritiesManager) {
            List<String> authorities = readField(allAuthoritiesManager, "requiredAuthorities", List.class);
            if (authorities == null || authorities.isEmpty()) {
                return new PolicyInfo("UNKNOWN", null, null, "All-authority list could not be confirmed");
            }
            return new PolicyInfo("COMPOSITE_AUTHORITY", authorities.stream().sorted().collect(Collectors.joining(",")),
                    "ALL", null);
        }
        return new PolicyInfo("UNKNOWN", null,
                "지원하지 않는 AuthorizationManager 유형: "
                        + (manager == null ? "null" : manager.getClass().getName()));
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

    private record PolicyInfo(String kind, String requiredAuthority, String authorityOperator, String diagnostic) {
        private PolicyInfo(String kind, String requiredAuthority, String diagnostic) {
            this(kind, requiredAuthority, null, diagnostic);
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
