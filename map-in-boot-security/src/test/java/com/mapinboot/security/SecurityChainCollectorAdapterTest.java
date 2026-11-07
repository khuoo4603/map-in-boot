package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.analyzer.FilterRegistrationAnalysisAdapter;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpMethod;
import org.springframework.security.authorization.AllAuthoritiesAuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.intercept.RequestMatcherDelegatingAuthorizationManager;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AndRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.util.pattern.PathPatternParser;
import org.springframework.web.util.pattern.PathPattern;

class SecurityChainCollectorAdapterTest {

    @Test
    void recordsLimitedAuthenticationGuardCodePatternEvidenceForRegisteredFilter() {
        try (AnnotationConfigApplicationContext context = context(AuthenticationGuardSecurityConfiguration.class)) {
            CollectionResult result = new SecurityChainCollectorAdapter().collect(
                    new CollectionContext(context, "main", "instance"));

            Fact guard = result.facts().stream()
                    .filter(fact -> "FILTER_REGISTRATION".equals(fact.type()))
                    .filter(fact -> AuthenticationGuardFilter.class.getName()
                            .equals(fact.attributes().get("filterClass")))
                    .findFirst().orElseThrow();

            assertEquals("AUTHENTICATION_GUARD", guard.attributes().get("codePattern"));
            assertEquals("SECURITY_CONTEXT_AUTHENTICATION", guard.attributes().get("authData"));
            assertEquals("AUTHENTICATION", guard.attributes().get("authType"));
            assertEquals("IS_AUTHENTICATED", guard.attributes().get("authCheck"));
            assertEquals("HTTP_401", guard.attributes().get("unauthenticatedAction"));
            assertEquals("AFTER_AUTHENTICATION", guard.attributes().get("filterChainContinuation"));
            assertTrue(guard.evidenceIds().stream()
                    .map(id -> result.evidence().stream().filter(evidence -> evidence.id().equals(id)).findFirst().orElse(null))
                    .anyMatch(evidence -> evidence != null && evidence.source() == EvidenceSource.CODE_PATTERN));
        }
    }

    @Test
    void collectsEverySecurityFilterWithChainScopedOrderAndReuseMetadata() {
        try (AnnotationConfigApplicationContext context = context(MultipleFilterSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            List<Fact> filters = result.facts().stream()
                    .filter(fact -> "FILTER_REGISTRATION".equals(fact.type()))
                    .toList();
            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(adapter.getSupportedTypes().contains("FILTER_REGISTRATION"));
            assertEquals(5, filters.size());
            assertEquals(List.of("1", "2", "3"), filters.stream()
                    .filter(fact -> "1".equals(fact.attributes().get("chainOrder")))
                    .map(fact -> fact.attributes().get("filterOrder"))
                    .toList());
            assertEquals(List.of("1", "2"), filters.stream()
                    .filter(fact -> "2".equals(fact.attributes().get("chainOrder")))
                    .map(fact -> fact.attributes().get("filterOrder"))
                    .toList());
            assertEquals(2, filters.stream()
                    .filter(fact -> "1".equals(fact.attributes().get("chainOrder")))
                    .filter(fact -> OrderFilter.class.getName().equals(fact.attributes().get("filterClass")))
                    .count());
            assertTrue(filters.stream()
                    .filter(fact -> OrderFilter.class.getName().equals(fact.attributes().get("filterClass")))
                    .allMatch(fact -> !fact.attributes().containsKey("instanceReuse")));
            assertTrue(filters.stream().allMatch(fact ->
                    "SECURITY".equals(fact.attributes().get("registrationKind"))));
            assertEquals(filters.size(), filters.stream().map(Fact::subjectKey).distinct().count());
            assertTrue(filters.stream().anyMatch(fact ->
                    "CROSS_CHAIN".equals(fact.attributes().get("instanceReuse"))));
            assertEquals(7, result.evidence().size());
            assertTrue(filters.stream().allMatch(fact -> fact.evidenceIds().stream()
                    .allMatch(id -> result.evidence().stream().anyMatch(evidence -> evidence.id().equals(id)))));
        }
    }

    @Test
    void preservesN08AndV08RuntimeFilterOrder() {
        try (AnnotationConfigApplicationContext context = context(N08V08SecurityConfiguration.class)) {
            List<Fact> filters = new SecurityChainCollectorAdapter()
                    .collect(new CollectionContext(context, "main", "instance"))
                    .facts().stream()
                    .filter(fact -> "FILTER_REGISTRATION".equals(fact.type()))
                    .toList();

            assertEquals(List.of(BearerTokenAuthenticationFilter.class.getName(), RefreshTokenFilter.class.getName()),
                    filters.stream().filter(fact -> "1".equals(fact.attributes().get("chainOrder")))
                            .map(fact -> fact.attributes().get("filterClass")).toList());
            assertEquals(List.of(RefreshTokenFilter.class.getName(), BearerTokenAuthenticationFilter.class.getName()),
                    filters.stream().filter(fact -> "2".equals(fact.attributes().get("chainOrder")))
                            .map(fact -> fact.attributes().get("filterClass")).toList());
        }
    }

    @Test
    void separatesFiltersFromMultipleFilterChainProxies() {
        try (AnnotationConfigApplicationContext context = context(MultipleProxyFilterSecurityConfiguration.class)) {
            List<Fact> filters = new SecurityChainCollectorAdapter()
                    .collect(new CollectionContext(context, "main", "instance"))
                    .facts().stream()
                    .filter(fact -> "FILTER_REGISTRATION".equals(fact.type()))
                    .toList();

            assertEquals(2, filters.size());
            assertEquals(Set.of("proxyA", "proxyB"), filters.stream()
                    .map(fact -> fact.attributes().get("proxyBeanName"))
                    .collect(java.util.stream.Collectors.toSet()));
            assertEquals(2, filters.stream().map(Fact::subjectKey).distinct().count());
        }
    }

    @Test
    void collectsRuntimeChainsAndPreservesRegisteredOrder() {
        try (AnnotationConfigApplicationContext context = context(RuntimeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertEquals(3, result.facts().size());
            assertEquals(List.of("1", "2", "3"), result.facts().stream()
                    .map(fact -> fact.attributes().get("chainOrder"))
                    .toList());
            assertEquals("PATH", result.facts().get(0).attributes().get("matcherType"));
            assertEquals("METHOD_PATH", result.facts().get(1).attributes().get("matcherType"));
            assertEquals("NEGATED", result.facts().get(2).attributes().get("matcherType"));
            assertEquals("DEFAULT", result.facts().get(0).attributes().get("pathPatternSettings"));
            assertEquals("DEFAULT", result.facts().get(1).attributes().get("pathPatternSettings"));
            assertTrue(result.facts().stream().noneMatch(fact -> "URL_AUTHORIZATION".equals(fact.type())));
            assertEquals(3, result.evidence().size());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void collectsUrlAuthorizationPoliciesFromRuntimeAuthorizationFilter() {
        try (AnnotationConfigApplicationContext context = context(UrlAuthorizationSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            List<Fact> policies = result.facts().stream()
                    .filter(fact -> "URL_AUTHORIZATION".equals(fact.type()))
                    .toList();
            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(adapter.getSupportedTypes().containsAll(Set.of("SECURITY_CHAIN", "URL_AUTHORIZATION")));
            assertEquals(4, policies.size());
            assertEquals(List.of("PERMIT_ALL", "COMPOSITE_AUTHORITY", "AUTHORITY_REQUIRED", "AUTHENTICATED"), policies.stream()
                    .map(fact -> fact.attributes().get("policyKind"))
                    .toList());
            assertEquals(List.of("1", "2", "3", "4"), policies.stream()
                    .map(fact -> fact.attributes().get("policyOrder"))
                    .toList());
            assertTrue(policies.stream().allMatch(fact -> "URL".equals(fact.attributes().get("policySource"))));
            assertEquals(6, result.evidence().size());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void preservesAnyAndAllAuthorityOperatorsFromRuntimeAuthorizationManagers() {
        try (AnnotationConfigApplicationContext context = context(AuthorityOperatorSecurityConfiguration.class)) {
            CollectionResult result = new SecurityChainCollectorAdapter().collect(
                    new CollectionContext(context, "main", "instance"));

            List<Fact> policies = result.facts().stream()
                    .filter(fact -> "URL_AUTHORIZATION".equals(fact.type()))
                    .toList();

            assertEquals(AnalysisStatus.READY, result.status());
            assertEquals(3, policies.size());
            assertEquals("ANY", policies.get(0).attributes().get("authorityOperator"));
            assertEquals("ALL", policies.get(1).attributes().get("authorityOperator"));
            assertEquals("ROLE_A,ROLE_B", policies.get(0).attributes().get("requiredAuthority"));
            assertEquals("ROLE_A,ROLE_B", policies.get(1).attributes().get("requiredAuthority"));
            assertTrue(!policies.get(0).subjectKey().equals(policies.get(1).subjectKey()));
        }
    }

    @Test
    void doesNotUseTheFirstAuthorizationFilterWhenAChainContainsMultipleFilters() {
        try (AnnotationConfigApplicationContext context = context(DuplicateAuthorizationFilterSecurityConfiguration.class)) {
            CollectionResult result = new SecurityChainCollectorAdapter().collect(
                    new CollectionContext(context, "main", "instance"));

            List<Fact> policies = result.facts().stream()
                    .filter(fact -> "URL_AUTHORIZATION".equals(fact.type()))
                    .toList();

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertEquals(1, policies.size());
            assertEquals("UNKNOWN", policies.get(0).attributes().get("policyKind"));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("AuthorizationFilter")));
        }
    }

    @Test
    void doesNotCreateSecuredByFromDuplicateAuthorizationFilters() {
        try (AnnotationConfigApplicationContext context = context(DuplicateAuthorizationFilterSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();
            CollectionResult collection = adapter.collect(new CollectionContext(context, "main", "instance"));
            Fact endpoint = new Fact("endpoint-fact-orders", "ENDPOINT_MAPPING", "endpoint|orders",
                    Map.of(
                            "httpMethod", "GET",
                            "path", "/api/orders",
                            "handler", "Orders#handle",
                            "mvcPathPatternSettings", "DEFAULT"),
                    List.of("endpoint-evidence-orders"));
            List<Fact> facts = new java.util.ArrayList<>(collection.facts());
            facts.add(endpoint);
            CollectionReport report = new CollectionReport(
                    facts,
                    collection.evidence(),
                    Map.of(
                            adapter.id(), collection.status(),
                            "starter-endpoint-mapping", AnalysisStatus.READY),
                    collection.diagnostics());

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(report, "main"),
                    List.of(new EndpointChainMatchingAnalysisAdapter()));

            assertEquals(AnalysisStatus.PARTIAL,
                    analysis.statusByAdapter().get("security-endpoint-chain-matching"));
            assertTrue(analysis.relations().stream().anyMatch(relation -> relation.type() == EdgeType.MATCHED_BY));
            assertTrue(analysis.relations().stream().noneMatch(relation -> relation.type() == EdgeType.SECURED_BY));
        }
    }

    @Test
    void downgradesCollectionWhenAuthorizationManagerIsUnsupported() {
        try (AnnotationConfigApplicationContext context = context(UnsupportedAuthorizationManagerSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            Fact policy = result.facts().stream()
                    .filter(fact -> "URL_AUTHORIZATION".equals(fact.type()))
                    .findFirst().orElseThrow();
            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertEquals("UNKNOWN", policy.attributes().get("policyKind"));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("AuthorizationManager")));
        }
    }

    @Test
    void preservesCompositeMatcherConditionsAndReportsUnsupportedMatcher() {
        try (AnnotationConfigApplicationContext context = context(CompositeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            Fact composite = result.facts().get(0);
            assertEquals("AND", composite.attributes().get("matcherType"));
            assertEquals("AND(GET /api/orders,NOT(/api/orders))",
                    composite.attributes().get("matcherCondition"));
            assertEquals("OR", result.facts().get(1).attributes().get("matcherType"));
            assertEquals("OR(GET /api/orders,NOT(/api/orders))",
                    result.facts().get(1).attributes().get("matcherCondition"));
            assertEquals("UNSUPPORTED", result.facts().get(2).attributes().get("matcherType"));
            assertEquals(1, result.diagnostics().size());
            assertFalse(result.diagnostics().get(0).summary().isBlank());
        }
    }

    @Test
    void returnsUnknownWhenFilterChainProxyIsUnavailable() {
        try (AnnotationConfigApplicationContext context = context(NoSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.UNKNOWN, result.status());
            assertTrue(result.facts().isEmpty());
            assertTrue(result.evidence().isEmpty());
            assertEquals(1, result.diagnostics().size());
        }
    }

    @Test
    void createsDeterministicIdsCompatibleWithGraphBuilder() {
        try (AnnotationConfigApplicationContext context = context(RuntimeSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();
            CollectionResult first = adapter.collect(new CollectionContext(context, "main", "instance-a"));
            CollectionResult second = adapter.collect(new CollectionContext(context, "main", "instance-b"));

            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());

            CollectionReport report = new CollectionReport(
                    first.facts(), first.evidence(), Map.of(adapter.id(), first.status()), first.diagnostics());
            AnalysisReport analysisReport = new AnalysisReport(
                    report, List.of(), first.evidence(), Map.of(), List.of());
            SecurityGraph graph = new GraphBuilder().build("main", analysisReport);

            assertEquals(first.facts().size(), graph.nodes().size());
            assertTrue(graph.nodes().stream().allMatch(node -> node.type().name().equals("SECURITY_CHAIN")));
            assertNotNull(graph.nodes().get(0).id());
        }
    }

    @Test
    void distinguishesRepeatedMatchersWithStableOccurrenceKeys() {
        try (AnnotationConfigApplicationContext context = context(DuplicateMatcherSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult first = adapter.collect(new CollectionContext(context, "main", "instance-a"));
            CollectionResult second = adapter.collect(new CollectionContext(context, "main", "instance-b"));

            assertEquals(2, first.facts().size());
            assertTrue(!first.facts().get(0).attributes().get("chainKey")
                    .equals(first.facts().get(1).attributes().get("chainKey")));
            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());
        }
    }

    @Test
    void keepsProxyIdentityWhenSeveralFilterChainProxiesAreRegistered() {
        try (AnnotationConfigApplicationContext context = context(MultipleProxySecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertEquals(List.of("proxyA", "proxyB"), result.facts().stream()
                    .map(fact -> fact.attributes().get("proxyBeanName"))
                    .toList());
            assertEquals(List.of("1", "1"), result.facts().stream()
                    .map(fact -> fact.attributes().get("chainOrder"))
                    .toList());
        }
    }

    @Test
    void downgradesCollectionWhenRuntimeMatcherFieldsCannotBeRead() {
        try (AnnotationConfigApplicationContext context = context(ReflectionFailureSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertEquals("PATH", result.facts().get(0).attributes().get("matcherType"));
            assertTrue(!result.facts().get(0).attributes().containsKey("matcherCondition"));
            assertEquals(1, result.diagnostics().size());
        }
    }

    @Test
    void preservesNonDefaultRuntimePathPatternSettings() {
        try (AnnotationConfigApplicationContext context = context(CaseInsensitiveSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.facts().get(0).attributes().get("pathPatternSettings")
                    .startsWith("NON_DEFAULT|caseSensitive=false"));
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void downgradesCollectionWhenPathPatternSettingsCannotBeConfirmed() throws ReflectiveOperationException {
        try (AnnotationConfigApplicationContext context = context(PathPatternSettingsFailureConfiguration.class)) {
            SecurityChainCollectorAdapter adapter = new SecurityChainCollectorAdapter();

            CollectionResult result = adapter.collect(new CollectionContext(context, "main", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertEquals(1, result.diagnostics().size());
            assertEquals("PATH", result.facts().get(0).attributes().get("matcherType"));
            assertEquals("UNKNOWN", result.facts().get(0).attributes().get("pathPatternSettings"));
        }
    }

    @Test
    void registersCollectorWhenSecurityRuntimeIsAvailable() {
        try (AnnotationConfigApplicationContext withSecurity = context(
                RuntimeSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, withSecurity.getBeansOfType(SecurityChainCollectorAdapter.class).size());
            assertEquals(1, withSecurity.getBeansOfType(EndpointChainMatchingAnalysisAdapter.class).size());
            assertEquals(1, withSecurity.getBeansOfType(FilterRegistrationAnalysisAdapter.class).size());
            assertEquals(1, withSecurity.getBeansOfType(com.mapinboot.security.finding.SecurityRuleEngine.class).size());
        }
        try (AnnotationConfigApplicationContext withoutSecurity = context(
                NoSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, withoutSecurity.getBeansOfType(SecurityChainCollectorAdapter.class).size());
            assertEquals(1, withoutSecurity.getBeansOfType(EndpointChainMatchingAnalysisAdapter.class).size());
            assertEquals(1, withoutSecurity.getBeansOfType(FilterRegistrationAnalysisAdapter.class).size());
            assertEquals(1, withoutSecurity.getBeansOfType(com.mapinboot.security.finding.SecurityRuleEngine.class).size());
        }
    }

    @Test
    void doesNotRegisterSecurityAdaptersWhenMapInBootIsDisabled() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("test", Map.of("mapinboot.enabled", "false")));
        context.register(RuntimeSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class);
        context.refresh();
        try (context) {
            assertTrue(context.getBeansOfType(SecurityChainCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(EndpointChainMatchingAnalysisAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(FilterRegistrationAnalysisAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(com.mapinboot.security.finding.SecurityRuleEngine.class).isEmpty());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        return context(configuration, MapInBootSecurityAutoConfiguration.class);
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configurations);
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class RuntimeSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            List<SecurityFilterChain> chains = List.of(
                    chain(PathPatternRequestMatcher.pathPattern("/api/**")),
                    chain(PathPatternRequestMatcher.pathPattern(HttpMethod.POST, "/api/orders")),
                    chain(new NegatedRequestMatcher(PathPatternRequestMatcher.pathPattern("/api/admin/**"))));
            return new FilterChainProxy(chains);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class UrlAuthorizationSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .requestMatchers(PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/public/**"))
                            .permitAll()
                            .requestMatchers(PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/manager/**"))
                            .hasAnyAuthority("ROLE_STAFF", "ROLE_MANAGER")
                            .requestMatchers(PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/staff/**"))
                            .hasAuthority("ROLE_STAFF")
                            .anyRequest()
                            .authenticated()
                            .build();
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/api/**"),
                    List.of(new AuthorizationFilter(manager)))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class AuthorityOperatorSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .requestMatchers(PathPatternRequestMatcher.pathPattern("/api/same"))
                            .hasAnyAuthority("ROLE_A", "ROLE_B")
                            .add(PathPatternRequestMatcher.pathPattern("/api/same"),
                                    AllAuthoritiesAuthorizationManager.hasAllAuthorities("ROLE_A", "ROLE_B"))
                            .anyRequest()
                            .permitAll()
                            .build();
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/api/**"),
                    List.of(new AuthorizationFilter(manager)))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class DuplicateAuthorizationFilterSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcherDelegatingAuthorizationManager manager =
                    RequestMatcherDelegatingAuthorizationManager.builder()
                            .anyRequest()
                            .authenticated()
                            .build();
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/api/**"),
                    List.of(new AuthorizationFilter(manager), new AuthorizationFilter(manager)))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class UnsupportedAuthorizationManagerSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            AuthorizationManager<jakarta.servlet.http.HttpServletRequest> manager =
                    (authentication, request) -> new AuthorizationDecision(true);
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/api/**"),
                    List.of(new AuthorizationFilter(manager)))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class CompositeSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcher orders = PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/api/orders");
            RequestMatcher excluded = new NegatedRequestMatcher(PathPatternRequestMatcher.pathPattern("/api/orders"));
            List<SecurityFilterChain> chains = List.of(
                    chain(new AndRequestMatcher(orders, excluded)),
                    chain(new OrRequestMatcher(orders, excluded)),
                    chain(new UnsupportedMatcher()));
            return new FilterChainProxy(chains);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class DuplicateMatcherSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            RequestMatcher matcher = PathPatternRequestMatcher.pathPattern("/api/orders");
            return new FilterChainProxy(List.of(chain(matcher), chain(matcher)));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class MultipleProxySecurityConfiguration {

        @Bean
        FilterChainProxy proxyA() {
            return new FilterChainProxy(List.of(chain(PathPatternRequestMatcher.pathPattern("/api/a"))));
        }

        @Bean
        FilterChainProxy proxyB() {
            return new FilterChainProxy(List.of(chain(PathPatternRequestMatcher.pathPattern("/api/b"))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class ReflectionFailureSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() throws ReflectiveOperationException {
            PathPatternRequestMatcher matcher = PathPatternRequestMatcher.pathPattern("/api/orders");
            java.lang.reflect.Field pattern = PathPatternRequestMatcher.class.getDeclaredField("pattern");
            assertTrue(pattern.trySetAccessible());
            pattern.set(matcher, null);
            return new FilterChainProxy(List.of(chain(matcher)));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class CaseInsensitiveSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            PathPatternParser parser = new PathPatternParser();
            parser.setCaseSensitive(false);
            RequestMatcher matcher = PathPatternRequestMatcher.withPathPatternParser(parser)
                    .matcher("/api/orders");
            return new FilterChainProxy(List.of(chain(matcher)));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class PathPatternSettingsFailureConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() throws ReflectiveOperationException {
            PathPatternRequestMatcher matcher = PathPatternRequestMatcher.pathPattern("/api/orders");
            java.lang.reflect.Field patternField = PathPatternRequestMatcher.class.getDeclaredField("pattern");
            assertTrue(patternField.trySetAccessible());
            PathPattern pattern = (PathPattern) patternField.get(matcher);
            java.lang.reflect.Field optionsField = PathPattern.class.getDeclaredField("pathOptions");
            assertTrue(optionsField.trySetAccessible());
            optionsField.set(pattern, null);
            return new FilterChainProxy(List.of(chain(matcher)));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class NoSecurityConfiguration {
    }

    private static SecurityFilterChain chain(RequestMatcher matcher) {
        return new DefaultSecurityFilterChain(matcher, List.of());
    }

    static class UnsupportedMatcher implements RequestMatcher {
        @Override
        public boolean matches(jakarta.servlet.http.HttpServletRequest request) {
            return true;
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class MultipleFilterSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            SharedFilter shared = new SharedFilter();
            return new FilterChainProxy(List.of(
                    new DefaultSecurityFilterChain(
                            PathPatternRequestMatcher.pathPattern("/n08/**"),
                            List.of(new OrderFilter(), shared, new OrderFilter())),
                    new DefaultSecurityFilterChain(
                            PathPatternRequestMatcher.pathPattern("/v08/**"),
                            List.of(shared, new OrderFilter()))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class AuthenticationGuardSecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/api/auth/**"),
                    List.of(new AuthenticationGuardFilter()))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class N08V08SecurityConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            return new FilterChainProxy(List.of(
                    new DefaultSecurityFilterChain(
                            PathPatternRequestMatcher.pathPattern("/api/auth/secured/refresh"),
                            List.of(new BearerTokenAuthenticationFilter(), new RefreshTokenFilter())),
                    new DefaultSecurityFilterChain(
                            PathPatternRequestMatcher.pathPattern("/api/auth/refresh"),
                            List.of(new RefreshTokenFilter(), new BearerTokenAuthenticationFilter()))));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class MultipleProxyFilterSecurityConfiguration {

        @Bean
        FilterChainProxy proxyA() {
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/proxy-a/**"), List.of(new SharedFilter()))));
        }

        @Bean
        FilterChainProxy proxyB() {
            return new FilterChainProxy(List.of(new DefaultSecurityFilterChain(
                    PathPatternRequestMatcher.pathPattern("/proxy-b/**"), List.of(new SharedFilter()))));
        }
    }

    static class OrderFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
        }
    }

    static class SharedFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
        }
    }

    static class BearerTokenAuthenticationFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
        }
    }

    static class RefreshTokenFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
        }
    }

    static class AuthenticationGuardFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            var authentication = org.springframework.security.core.context.SecurityContextHolder
                    .getContext().getAuthentication();
            if (authentication == null || !authentication.isAuthenticated()) {
                ((jakarta.servlet.http.HttpServletResponse) response)
                        .sendError(jakarta.servlet.http.HttpServletResponse.SC_UNAUTHORIZED);
                return;
            }
            chain.doFilter(request, response);
        }
    }
}
