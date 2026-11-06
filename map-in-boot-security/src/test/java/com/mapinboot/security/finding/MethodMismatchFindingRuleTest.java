package com.mapinboot.security.finding;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.analyzer.MethodSecurityAnalysisAdapter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MethodMismatchFindingRuleTest {

    @Test
    void doesNotFlagConfirmedMethodProtectionBehindPermitAll() {
        Fact endpoint = endpoint("permit", DirectController.class, "handle", "/permit");
        Fact chain = chain("permit", "/permit");
        Fact policy = policy("permit-policy", chain, "PERMIT_ALL", null);
        Fact method = method("permit-method", DirectController.class, "handle", "ROLE_STAFF");

        assertTrue(evaluate(List.of(endpoint, chain, policy, method), readyStatuses()).isEmpty());
    }

    @Test
    void doesNotFlagAuthenticatedUrlWithStrongerMethodAuthority() {
        Fact endpoint = endpoint("authenticated", DirectController.class, "handle", "/authenticated");
        Fact chain = chain("authenticated", "/authenticated");
        Fact policy = policy("authenticated-policy", chain, "AUTHENTICATED", null);
        Fact method = method("authenticated-method", DirectController.class, "handle", "ROLE_STAFF");

        assertTrue(evaluate(List.of(endpoint, chain, policy, method), readyStatuses()).isEmpty());
    }

    @Test
    void doesNotFlagDifferentUrlAndMethodAuthoritiesByThemselves() {
        Fact endpoint = endpoint("different", DirectController.class, "handle", "/different");
        Fact chain = chain("different", "/different");
        Fact policy = policy("different-policy", chain, "AUTHORITY_REQUIRED", "ROLE_ADMIN");
        Fact method = method("different-method", DirectController.class, "handle", "ROLE_STAFF");

        assertTrue(evaluate(List.of(endpoint, chain, policy, method), readyStatuses()).isEmpty());
    }

    @Test
    void doesNotFlagUnknownExternalReceiver() {
        Fact endpoint = endpoint("external", ServiceController.class, "load", "/external");
        Fact chain = chain("external", "/external");
        Fact policy = policy("external-policy", chain, "PERMIT_ALL", null);
        Fact method = method("external-method", GuardedService.class, "find", "ROLE_STAFF");

        AnalysisReport report = analyze(List.of(endpoint, chain, policy, method), readyStatuses());

        assertTrue(report.relations().stream().noneMatch(relation ->
                "METHOD".equals(relation.attributes().get("policySource"))
                        && relation.confidence() == Confidence.CONFIRMED));
        assertTrue(new MethodMismatchFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void doesNotParseSelfInvocationDiagnosticAsFinding() {
        Fact endpoint = endpoint("self", GuardedService.class, "viaSelf", "/self");
        Fact chain = chain("self", "/self");
        Fact policy = policy("self-policy", chain, "PERMIT_ALL", null);
        Fact method = method("self-method", GuardedService.class, "find", "ROLE_STAFF");

        AnalysisReport report = analyze(List.of(endpoint, chain, policy, method), readyStatuses());

        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Self Invocation")));
        assertTrue(new MethodMismatchFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void doesNotTreatPartialMethodCollectionAsConfirmedMismatch() {
        Fact endpoint = endpoint("partial-method", DirectController.class, "handle", "/partial-method");
        Fact chain = chain("partial-method", "/partial-method");
        Fact policy = policy("partial-policy", chain, "AUTHENTICATED", null);
        Fact method = method("partial-method-fact", DirectController.class, "handle", "ROLE_STAFF");
        Map<String, AnalysisStatus> statuses = readyStatuses();
        statuses.put("security-method-authorization", AnalysisStatus.PARTIAL);

        assertTrue(evaluate(List.of(endpoint, chain, policy, method), statuses).isEmpty());
    }

    @Test
    void doesNotTreatUnknownUrlPolicyAsPermitAll() {
        Fact endpoint = endpoint("unknown-url", DirectController.class, "handle", "/unknown-url");
        Fact chain = chain("unknown-url", "/unknown-url");
        Fact policy = policy("unknown-url-policy", chain, "UNKNOWN", null);
        Fact method = method("unknown-url-method", DirectController.class, "handle", "ROLE_STAFF");
        Map<String, AnalysisStatus> statuses = readyStatuses();
        statuses.put("security-chain", AnalysisStatus.UNKNOWN);

        assertTrue(evaluate(List.of(endpoint, chain, policy, method), statuses).isEmpty());
    }

    @Test
    void doesNotCreateFindingWhenReferencedEvidenceIsUnavailable() {
        Fact endpoint = endpoint("missing-evidence", DirectController.class, "handle", "/missing-evidence");
        Fact chain = chain("missing-evidence", "/missing-evidence");
        Fact policy = policy("missing-evidence-policy", chain, "PERMIT_ALL", null);
        Fact method = method("missing-evidence-method", DirectController.class, "handle", "ROLE_STAFF");
        AnalysisReport analyzed = analyze(List.of(endpoint, chain, policy, method), readyStatuses());
        AnalysisReport withoutEvidence = new AnalysisReport(
                analyzed.collectionReport(), analyzed.relations(), List.of(),
                analyzed.statusByAdapter(), analyzed.diagnostics());

        assertTrue(new MethodMismatchFindingRule().evaluate(withoutEvidence).isEmpty());
    }

    private List<Finding> evaluate(List<Fact> facts, Map<String, AnalysisStatus> statuses) {
        return new SecurityRuleEngine().evaluate(analyze(facts, statuses));
    }

    private AnalysisReport analyze(List<Fact> facts, Map<String, AnalysisStatus> statuses) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        CollectionReport collection = new CollectionReport(facts, evidence, statuses, List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collection, "main"),
                List.of(new EndpointChainMatchingAnalysisAdapter(), new MethodSecurityAnalysisAdapter()));
    }

    private Map<String, AnalysisStatus> readyStatuses() {
        return new LinkedHashMap<>(Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.READY,
                "security-method-authorization", AnalysisStatus.READY));
    }

    private Fact endpoint(String key, Class<?> type, String methodName, String path) {
        return fact("endpoint", key, "ENDPOINT_MAPPING", "endpoint|" + key, Map.of(
                "httpMethod", "GET",
                "path", path,
                "handler", handler(type, methodName),
                "mvcPathPatternSettings", "DEFAULT"));
    }

    private Fact chain(String key, String path) {
        return fact("chain", key, "SECURITY_CHAIN", "chain|" + key, Map.of(
                "chainKey", "proxy|" + key,
                "chainOrder", "1",
                "matcherType", "PATH",
                "matcherCondition", path,
                "pathPatternSettings", "DEFAULT",
                "proxyBeanName", "proxy"));
    }

    private Fact policy(String key, Fact chain, String kind, String authority) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", "1");
        attributes.put("policyOrder", "1");
        attributes.put("policyKind", kind);
        attributes.put("policyMatcherType", "PATH");
        attributes.put("policyMatcherCondition", "ANY");
        attributes.put("pathPatternSettings", "DEFAULT");
        attributes.put("policySource", "URL");
        attributes.put("proxyBeanName", "proxy");
        if (authority != null) {
            attributes.put("requiredAuthority", authority);
        }
        return fact("policy", key, "URL_AUTHORIZATION", "policy|" + key, attributes);
    }

    private Fact method(String key, Class<?> type, String methodName, String authority) {
        return fact("method", key, "METHOD_AUTHORIZATION", "method|" + key, Map.of(
                "handler", handler(type, methodName),
                "declarationKind", "METHOD",
                "annotationType", "PRE_AUTHORIZE",
                "policySource", "METHOD",
                "targetClass", type.getName(),
                "beanName", type.getSimpleName(),
                "proxyDetected", "true",
                "methodSecurityInfrastructure", "preAuthorizeAdvisor",
                "expressionKind", "HAS_AUTHORITY",
                "requiredAuthority", authority));
    }

    private String handler(Class<?> type, String methodName) {
        return java.util.Arrays.stream(type.getDeclaredMethods())
                .filter(method -> method.getName().equals(methodName))
                .findFirst()
                .map(method -> type.getName() + "#" + method.getName() + "("
                        + java.util.Arrays.stream(method.getParameterTypes())
                        .map(Class::getName).reduce((first, second) -> first + "," + second).orElse("") + ")")
                .orElseThrow();
    }

    private Fact fact(String prefix, String key, String type, String subjectKey, Map<String, String> attributes) {
        return new Fact(prefix + "-fact-" + key, type, subjectKey, attributes,
                List.of(prefix + "-evidence-" + key));
    }

    static class DirectController {
        public String handle() {
            return "handle";
        }
    }

    static class ServiceController {
        private final GuardedService guardedService = new GuardedService();

        public String load() {
            return guardedService.find();
        }
    }

    static class GuardedService {
        public String find() {
            return "find";
        }

        public String viaSelf() {
            return this.find();
        }
    }
}
