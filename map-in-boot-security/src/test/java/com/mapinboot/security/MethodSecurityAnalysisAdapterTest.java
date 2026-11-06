package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.analyzer.MethodSecurityAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.MethodSecurityCollectorAdapter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

class MethodSecurityAnalysisAdapterTest {

    @Test
    void connectsDirectEndpointHandlerOnlyWhenAdvisorAndProxyAreConfirmed() {
        Fact endpoint = endpoint("direct", DirectController.class, "direct", "GET", "/direct");
        Fact method = method("direct-method", DirectController.class, "direct", "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertEquals(1, report.relations().size());
        assertEquals(EdgeType.SECURED_BY, report.relations().get(0).type());
        assertEquals(endpoint.attributes().get("handler"), report.relations().get(0).sourceKey());
        assertEquals(method.subjectKey(), report.relations().get(0).targetKey());
        assertEquals(Confidence.CONFIRMED, report.relations().get(0).confidence());
        assertEquals("DIRECT_HANDLER", report.relations().get(0).attributes().get("invocationKind"));
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void doesNotConfirmDirectlyConstructedServiceOrSimilarName() {
        Fact endpoint = endpoint("service", ServiceController.class, "load", "GET", "/service");
        Fact method = method("service-method", GuardedService.class, "find", "PRE_AUTHORIZE", true,
                "preAuthorizeAdvisor", null, "guardedService");
        Fact unrelated = method("unrelated", OtherService.class, "find", "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method, unrelated), AnalysisStatus.READY, AnalysisStatus.READY);

        assertTrue(report.relations().isEmpty());
        assertFalse(report.relations().stream().anyMatch(relation -> relation.targetKey().equals(unrelated.subjectKey())));
        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Spring 관리 Proxy Bean")));
    }

    @Test
    void marksCalledMethodWithUnknownProxyAsPartialWithoutCreatingProtectionRelation() {
        Fact endpoint = endpoint("unknown-proxy", ServiceController.class, "load", "GET", "/unknown-proxy");
        Fact method = method("unknown-proxy-method", GuardedService.class, "find",
                "PRE_AUTHORIZE", false, null, null, "guardedService");
        Fact chain = chain("unknown-proxy");
        Fact policy = policy("PERMIT_ALL", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.relations().stream().noneMatch(relation ->
                "METHOD".equals(relation.attributes().get("policySource"))));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Advisor") || diagnostic.summary().contains("Proxy")));
    }

    @Test
    void preservesSpringProxyCallAsUnknownWithoutRuntimeReceiverIdentity() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(SpringConfiguration.class)) {
            CollectionResult collected = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));
            Fact method = collected.facts().stream()
                    .filter(fact -> fact.attributes().get("handler").endsWith("SpringGuardedService#find(java.lang.String)"))
                    .findFirst()
                    .orElseThrow();
            Fact endpoint = endpoint("spring-service", SpringController.class, "load", "GET", "/spring-service");

            AnalysisReport report = executeCollected(endpoint, method, collected);

            Relation methodRelation = report.relations().stream()
                    .filter(relation -> method.subjectKey().equals(relation.targetKey()))
                    .filter(relation -> "EXTERNAL_BEAN".equals(relation.attributes().get("invocationKind")))
                    .findFirst()
                    .orElseThrow();
            assertEquals(Confidence.UNKNOWN, methodRelation.confidence());
            assertEquals("UNKNOWN", methodRelation.attributes().get("proxyApplicability"));
            assertTrue(report.relations().stream().flatMap(relation -> relation.evidenceIds().stream())
                    .anyMatch(id -> collected.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
            SecurityGraph graph = new GraphBuilder().build("account", report);
            assertTrue(graph.edges().stream().anyMatch(edge -> edge.type() == EdgeType.SECURED_BY));
        }
    }

    @Test
    void doesNotConfirmAConstructorPatternWithoutReceiverBeanIdentity() {
        Fact endpoint = endpoint("ordinary-receiver", OrdinaryController.class, "load", "GET", "/ordinary-receiver");
        Fact method = method("ordinary-receiver-method", SpringGuardedService.class, "find",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", null, "springGuardedService");
        Fact chain = chain("ordinary-receiver");
        Fact policy = policy("PERMIT_ALL", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        Relation methodRelation = report.relations().stream()
                .filter(relation -> "METHOD".equals(relation.attributes().get("policySource")))
                .findFirst()
                .orElseThrow();
        assertEquals(Confidence.UNKNOWN, methodRelation.confidence());
        assertEquals("UNKNOWN", methodRelation.attributes().get("proxyApplicability"));
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void keepsEndpointSpecificCallPathsWhenOneMethodIsDirectAndAnotherIsExternal() {
        Fact directEndpoint = endpoint("direct-service", SpringGuardedService.class, "find", "GET", "/direct-service");
        Fact externalEndpoint = endpoint("external-service", SpringController.class, "load", "GET", "/external-service");
        Fact method = method("shared-service-method", SpringGuardedService.class, "find",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", null, "springGuardedService");

        AnalysisReport report = execute(List.of(directEndpoint, externalEndpoint, method),
                AnalysisStatus.READY, AnalysisStatus.READY);

        assertEquals(2, report.relations().size());
        assertTrue(report.relations().stream().anyMatch(relation ->
                directEndpoint.attributes().get("handler").equals(relation.sourceKey())));
        assertTrue(report.relations().stream().anyMatch(relation ->
                externalEndpoint.attributes().get("handler").equals(relation.sourceKey())));
    }

    @Test
    void doesNotConfirmSelfInvocationAsProxyProtected() {
        Fact endpoint = endpoint("self", GuardedService.class, "viaSelf", "GET", "/self");
        Fact method = method("self-method", GuardedService.class, "find", "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("호출 경로") || diagnostic.summary().contains("Self")));
    }

    @Test
    void distinguishesAnotherInstanceCallFromThisInvocation() {
        Fact endpoint = endpoint("other-instance", GuardedService.class, "viaOther", "GET", "/other-instance");
        Fact method = method("other-instance-method", GuardedService.class, "find",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertTrue(report.relations().isEmpty());
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Spring 관리 Proxy Bean")));
        assertFalse(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Self Invocation")));
    }

    @Test
    void doesNotConfirmWhenConfirmedAndSelfInvocationPathsCoexist() {
        Fact endpoint = endpoint("mixed", MixedService.class, "load", "GET", "/mixed");
        Fact method = method("mixed-method", MixedService.class, "find",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", null, "springMixedService");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Self Invocation")
                        || diagnostic.summary().contains("Receiver")
                        || diagnostic.summary().contains("호출 경로")), report.diagnostics().toString());
    }

    @Test
    void preservesConfirmedRelationsWhenMethodCollectionIsPartial() {
        Fact endpoint = endpoint("partial", DirectController.class, "direct", "GET", "/partial");
        Fact method = method("partial-method", DirectController.class, "direct", "SECURED", true, "securedAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.PARTIAL);

        assertEquals(1, report.relations().size());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void distinguishesNoDeclarationsFromAnEmptyPartialCollection() {
        Fact endpoint = endpoint("empty", DirectController.class, "direct", "GET", "/empty");

        AnalysisReport ready = execute(List.of(endpoint), AnalysisStatus.READY, AnalysisStatus.READY);
        AnalysisReport partial = execute(List.of(endpoint), AnalysisStatus.READY, AnalysisStatus.PARTIAL);

        assertTrue(ready.relations().isEmpty());
        assertEquals(AnalysisStatus.READY, status(ready));
        assertTrue(partial.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(partial));
    }

    @Test
    void mergesSharedHandlerEvidenceWithoutRelationIdConflict() {
        Fact first = endpoint("shared-a", DirectController.class, "direct", "GET", "/shared-a");
        Fact second = endpoint("shared-b", DirectController.class, "direct", "POST", "/shared-b");
        Fact method = method("shared-method", DirectController.class, "direct", "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(first, second, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertEquals(1, report.relations().size());
        assertTrue(report.relations().get(0).evidenceIds().contains("endpoint-evidence-shared-a"));
        assertTrue(report.relations().get(0).evidenceIds().contains("endpoint-evidence-shared-b"));
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void keepsMethodEvidenceAndGraphReferencesConsistent() {
        Fact endpoint = endpoint("graph", DirectController.class, "direct", "GET", "/graph");
        Fact method = method("graph-method", DirectController.class, "direct", "ROLES_ALLOWED", true, "jsr250Advisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);
        SecurityGraph graph = new GraphBuilder().build("account", report);

        assertEquals(1, graph.edges().size());
        assertTrue(graph.edges().stream().anyMatch(edge -> edge.type() == EdgeType.SECURED_BY));
        assertTrue(graph.edges().stream().allMatch(edge -> edge.evidenceIds().stream()
                .allMatch(id -> report.evidence().stream().anyMatch(evidence -> evidence.id().equals(id)))));
    }

    @Test
    void registersMethodSecurityAnalyzerFromAutoConfiguration() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.register(MapInBootSecurityAutoConfiguration.class);
            context.refresh();

            assertEquals(1, context.getBeansOfType(MethodSecurityAnalysisAdapter.class).size());
        }
    }

    @Test
    void doesNotCreateRelationForAnnotationWithoutItsMatchingAdvisor() {
        Fact endpoint = endpoint("advisor", DirectController.class, "direct", "GET", "/advisor");
        Fact method = method("advisor-method", DirectController.class, "direct", "SECURED", true, null);

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void preservesComplexSpelWithoutInferringAnAuthority() {
        Fact endpoint = endpoint("spel", DirectController.class, "direct", "GET", "/spel");
        Fact method = method("spel-method", DirectController.class, "direct", "PRE_AUTHORIZE", true,
                "preAuthorizeAdvisor", "EXPRESSION");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertEquals(1, report.relations().size());
        assertFalse(report.relations().get(0).attributes().containsKey("requiredAuthority"));
        assertEquals(AnalysisStatus.PARTIAL, status(report));
    }

    @Test
    void preservesMethodRelationAcrossUrlPolicyVariantsWithoutFindingInference() {
        for (String policyKind : List.of("PERMIT_ALL", "AUTHENTICATED", "AUTHORITY_REQUIRED")) {
            Fact endpoint = endpoint("url-" + policyKind, DirectController.class, "direct", "GET", "/url");
            Fact method = method("url-method-" + policyKind, DirectController.class, "direct",
                    "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", "HAS_AUTHORITY",
                    DirectController.class.getSimpleName(), "ROLE_STAFF");
            Fact chain = chain(policyKind);
            Fact policy = policy(policyKind, chain);
            AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

            assertTrue(report.relations().stream().anyMatch(relation ->
                    relation.type() == EdgeType.SECURED_BY && relation.targetKey().equals(method.subjectKey())),
                    report.relations().toString());
            assertFalse(report.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("Finding") || diagnostic.summary().contains("취약")));
            assertTrue(report.diagnostics().isEmpty(), report.diagnostics().toString());
            if ("AUTHORITY_REQUIRED".equals(policyKind)) {
                assertTrue(report.relations().stream().anyMatch(relation ->
                        "URL".equals(relation.attributes().get("policySource"))
                                && "ROLE_STAFF".equals(relation.attributes().get("requiredAuthority"))));
            }
        }
    }

    @Test
    void reportsUncertaintyForComplexMethodPolicyDuringUrlComparison() {
        Fact endpoint = endpoint("complex-policy", DirectController.class, "direct", "GET", "/complex-policy");
        Fact method = method("complex-policy-method", DirectController.class, "direct",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", "EXPRESSION");
        Fact chain = chain("complex-policy");
        Fact policy = policy("AUTHORITY_REQUIRED", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        assertEquals(AnalysisStatus.PARTIAL, status(report), report.diagnostics().toString());
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("정책") && diagnostic.summary().contains("비교")));
    }

    @Test
    void preservesKnownAuthorityDifferenceWithoutReportingAnError() {
        Fact endpoint = endpoint("authority-difference", DirectController.class, "direct", "GET", "/authority-difference");
        Fact method = method("authority-difference-method", DirectController.class, "direct",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", "HAS_AUTHORITY",
                DirectController.class.getSimpleName(), "ROLE_ADMIN");
        Fact chain = chain("authority-difference");
        Fact policy = policy("AUTHORITY_REQUIRED", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        assertEquals(AnalysisStatus.READY, status(report));
        assertTrue(report.diagnostics().isEmpty(), report.diagnostics().toString());
    }

    @Test
    void normalizesHasRoleAuthorityForUrlComparison() {
        Fact endpoint = endpoint("has-role", DirectController.class, "direct", "GET", "/has-role");
        Fact method = method("has-role-method", DirectController.class, "direct",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", "HAS_ROLE",
                DirectController.class.getSimpleName(), "STAFF");
        Fact chain = chain("has-role");
        Fact policy = policy("AUTHORITY_REQUIRED", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        assertEquals(AnalysisStatus.READY, status(report));
        assertTrue(report.diagnostics().isEmpty(), report.diagnostics().toString());
    }

    @Test
    void keepsCompositeAuthorityComparisonUnknown() {
        Fact endpoint = endpoint("composite-authority", DirectController.class, "direct", "GET", "/composite-authority");
        Fact method = method("composite-authority-method", DirectController.class, "direct",
                "SECURED", true, "securedAdvisor", "SECURED",
                DirectController.class.getSimpleName(), "ROLE_ADMIN,ROLE_STAFF");
        Fact chain = chain("composite-authority");
        Fact policy = policy("AUTHORITY_REQUIRED", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, chain, policy));

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("정책") && diagnostic.summary().contains("비교")));
    }

    @Test
    void doesNotTreatAnUnrelatedMethodDeclarationAsAnHttpAnalysisFailure() {
        Fact endpoint = endpoint("independent", DirectController.class, "direct", "GET", "/independent");
        Fact method = method("independent-direct", DirectController.class, "direct",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor", "HAS_AUTHORITY",
                DirectController.class.getSimpleName(), "ROLE_STAFF");
        Fact unrelated = method("independent-service", OtherService.class, "find",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");
        Fact chain = chain("independent");
        Fact policy = policy("PERMIT_ALL", chain);

        AnalysisReport report = executeWithUrl(List.of(endpoint, method, unrelated, chain, policy));

        assertEquals(AnalysisStatus.READY, status(report), report.diagnostics().toString());
        assertEquals(1, report.relations().stream()
                .filter(relation -> "METHOD".equals(relation.attributes().get("policySource")))
                .count());
        assertFalse(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains(unrelated.subjectKey())));
    }

    @Test
    void doesNotReportReadyWhenSecurityChainStatusIsMissing() {
        Fact endpoint = endpoint("missing-chain", DirectController.class, "direct", "GET", "/missing-chain");
        Fact method = method("missing-chain-method", DirectController.class, "direct",
                "PRE_AUTHORIZE", true, "preAuthorizeAdvisor");

        AnalysisReport report = execute(List.of(endpoint, method), AnalysisStatus.READY, AnalysisStatus.READY);

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.targetKey().equals(method.subjectKey())));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("SecurityChain 수집 상태 부재")));
    }

    private AnalysisReport execute(List<Fact> facts, AnalysisStatus endpointStatus, AnalysisStatus methodStatus) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        Map<String, AnalysisStatus> statuses = new LinkedHashMap<>();
        statuses.put("starter-endpoint-mapping", endpointStatus);
        statuses.put("security-method-authorization", methodStatus);
        CollectionReport collectionReport = new CollectionReport(facts, evidence, statuses, List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "account"),
                List.of(new MethodSecurityAnalysisAdapter()));
    }

    private AnalysisStatus status(AnalysisReport report) {
        return report.statusByAdapter().get("security-method-authorization-analysis");
    }

    private AnalysisReport executeCollected(Fact endpoint, Fact method, CollectionResult collected) {
        List<Fact> facts = List.of(endpoint, method);
        List<Evidence> evidence = new ArrayList<>(collected.evidence());
        evidence.add(new Evidence(endpoint.evidenceIds().get(0), EvidenceSource.RUNTIME,
                "test", "test endpoint"));
        CollectionReport collectionReport = new CollectionReport(
                facts, evidence,
                Map.of("starter-endpoint-mapping", AnalysisStatus.READY,
                        "security-method-authorization", collected.status()),
                List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "account"),
                List.of(new MethodSecurityAnalysisAdapter()));
    }

    private AnalysisReport executeWithUrl(List<Fact> facts) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        Map<String, AnalysisStatus> statuses = new LinkedHashMap<>();
        statuses.put("starter-endpoint-mapping", AnalysisStatus.READY);
        statuses.put("security-chain", AnalysisStatus.READY);
        statuses.put("security-method-authorization", AnalysisStatus.READY);
        CollectionReport collectionReport = new CollectionReport(facts, evidence, statuses, List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collectionReport, "account"),
                List.of(new EndpointChainMatchingAnalysisAdapter(),
                        new MethodSecurityAnalysisAdapter()));
    }

    private Fact endpoint(String key, Class<?> type, String methodName, String httpMethod, String path) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("httpMethod", httpMethod);
        attributes.put("path", path);
        attributes.put("handler", handler(type, methodName));
        attributes.put("mvcPathPatternSettings", "DEFAULT");
        return new Fact("endpoint-fact-" + key, "ENDPOINT_MAPPING", "endpoint|" + key,
                attributes, List.of("endpoint-evidence-" + key));
    }

    private Fact method(
            String key, Class<?> type, String methodName, String annotationType,
            boolean proxyDetected, String infrastructure
    ) {
        return method(key, type, methodName, annotationType, proxyDetected, infrastructure,
                null, type.getSimpleName());
    }

    private Fact method(
            String key, Class<?> type, String methodName, String annotationType,
            boolean proxyDetected, String infrastructure, String expressionKind
    ) {
        return method(key, type, methodName, annotationType, proxyDetected, infrastructure,
                expressionKind, type.getSimpleName());
    }

    private Fact method(
            String key, Class<?> type, String methodName, String annotationType,
            boolean proxyDetected, String infrastructure, String expressionKind, String beanName
    ) {
        return method(key, type, methodName, annotationType, proxyDetected, infrastructure,
                expressionKind, beanName, null);
    }

    private Fact method(
            String key, Class<?> type, String methodName, String annotationType,
            boolean proxyDetected, String infrastructure, String expressionKind,
            String beanName, String requiredAuthority
    ) {
        String handler = handler(type, methodName);
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("handler", handler);
        attributes.put("declarationKind", "METHOD");
        attributes.put("annotationType", annotationType);
        attributes.put("policySource", "METHOD");
        attributes.put("targetClass", type.getName());
        attributes.put("beanName", beanName);
        attributes.put("proxyDetected", Boolean.toString(proxyDetected));
        if (infrastructure != null) {
            attributes.put("methodSecurityInfrastructure", infrastructure);
        }
        if (expressionKind != null) {
            attributes.put("expressionKind", expressionKind);
        }
        if (requiredAuthority != null) {
            attributes.put("requiredAuthority", requiredAuthority);
        }
        return new Fact("method-fact-" + key, "METHOD_AUTHORIZATION", "method|" + key,
                attributes, List.of("method-evidence-" + key));
    }

    private Fact chain(String key) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", "proxy|" + key);
        attributes.put("chainOrder", "1");
        attributes.put("matcherType", "ANY");
        attributes.put("matcherCondition", "ANY");
        attributes.put("proxyBeanName", "proxy");
        return new Fact("chain-fact-" + key, "SECURITY_CHAIN", "chain|" + key,
                attributes, List.of("chain-evidence-" + key));
    }

    private Fact policy(String key, Fact chain) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", "1");
        attributes.put("policyOrder", "1");
        attributes.put("policyKind", key);
        attributes.put("policyMatcherType", "ANY");
        attributes.put("policyMatcherCondition", "ANY");
        attributes.put("policySource", "URL");
        attributes.put("proxyBeanName", "proxy");
        if ("AUTHORITY_REQUIRED".equals(key)) {
            attributes.put("requiredAuthority", "ROLE_STAFF");
            attributes.put("authorityOperator", "ALL");
        }
        return new Fact("policy-fact-" + key, "URL_AUTHORIZATION", "policy|" + key,
                attributes, List.of("policy-evidence-" + key));
    }

    private String handler(Class<?> type, String methodName) {
        java.lang.reflect.Method method = java.util.Arrays.stream(type.getDeclaredMethods())
                .filter(candidate -> candidate.getName().equals(methodName))
                .findFirst()
                .orElseThrow();
        String parameters = java.util.Arrays.stream(method.getParameterTypes())
                .map(Class::getName)
                .reduce((first, second) -> first + "," + second)
                .orElse("");
        return type.getName() + "#" + methodName + "(" + parameters + ")";
    }

    static class DirectController {
        public String direct() {
            return "direct";
        }
    }

    static class ServiceController {
        private final GuardedService guardedService = new GuardedService();

        public String load(String value) {
            return guardedService.find(value);
        }
    }

    static class GuardedService {
        private final GuardedService peer = new GuardedService();

        public String find(String value) {
            return value;
        }

        public String viaSelf(String value) {
            return this.find(value);
        }

        public String viaOther(String value) {
            return peer.find(value);
        }
    }

    static class OtherService {
        public String find(String value) {
            return value;
        }
    }

    static class MixedService {
        private final MixedService springMixedService;

        MixedService(MixedService springMixedService) {
            this.springMixedService = springMixedService;
        }

        public String load(String value) {
            springMixedService.find(value);
            return this.find(value);
        }

        public String find(String value) {
            return value;
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableMethodSecurity
    static class SpringConfiguration {
        @Bean
        SpringGuardedService springGuardedService() {
            return new SpringGuardedService();
        }

        @Bean
        SpringController springController(SpringGuardedService service) {
            return new SpringController(service);
        }
    }

    static class SpringGuardedService {
        @PreAuthorize("hasAuthority('ROLE_STAFF')")
        public String find(String value) {
            return value;
        }
    }

    static class SpringController {
        private final SpringGuardedService springGuardedService;

        SpringController(SpringGuardedService springGuardedService) {
            this.springGuardedService = springGuardedService;
        }

        public String load(String value) {
            new Object();
            return springGuardedService.find(value);
        }
    }

    static class OrdinaryController {
        private final SpringGuardedService springGuardedService;

        OrdinaryController(SpringGuardedService springGuardedService) {
            this.springGuardedService = springGuardedService;
        }

        public String load(String value) {
            return springGuardedService.find(value);
        }
    }
}
