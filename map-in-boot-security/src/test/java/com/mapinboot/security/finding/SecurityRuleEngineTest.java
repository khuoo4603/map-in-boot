package com.mapinboot.security.finding;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SecurityRuleEngineTest {

    @Test
    void doesNotCreateChainMissingForBusinessStateRequirementOnly() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact requirement = requiredState("orders");

        List<Finding> findings = evaluate(List.of(endpoint, chain, requirement), readyStatuses());

        assertTrue(findings.isEmpty());
    }

    @Test
    void confirmsChainMissingForProvenNoMatchAndConfirmedObjectAuthorization() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact objectAuthorization = objectAuthorization("orders", endpoint);

        List<Finding> findings = evaluate(List.of(endpoint, chain, objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertEquals(1, findings.size());
        Finding finding = findings.get(0);
        assertEquals("CHAIN_MISSING", finding.ruleId());
        assertEquals(Confidence.CONFIRMED, finding.confidence());
        assertEquals(List.of(), finding.nodeIds());
        assertEquals(List.of(), finding.edgeIds());
        assertEquals(List.of("chain-evidence-admin", "endpoint-evidence-orders", "object-evidence-orders"),
                finding.evidenceIds());
    }

    @Test
    void doesNotCreateChainMissingWithoutIndependentProtectionRequirementOrForIncompleteInput() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");

        assertTrue(evaluate(List.of(endpoint, chain), readyStatuses()).isEmpty());
        assertTrue(evaluate(List.of(endpoint, chain, requiredState("orders")), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.PARTIAL,
                "security-chain", AnalysisStatus.READY)).isEmpty());
        assertTrue(evaluate(List.of(endpoint, chain, requiredState("orders")), Map.of(
                "starter-endpoint-mapping", AnalysisStatus.READY,
                "security-chain", AnalysisStatus.PARTIAL)).isEmpty());
    }

    @Test
    void createsLikelyChainOrderForProvenUrlPolicyCovering() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");

        List<Finding> findings = evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF")),
                readyStatuses());

        assertEquals(1, findings.size());
        assertEquals("CHAIN_ORDER", findings.get(0).ruleId());
        assertEquals(Confidence.LIKELY, findings.get(0).confidence());
        assertTrue(findings.get(0).evidenceIds().contains("policy-evidence-protected-policy"));
    }

    @Test
    void keepsChainOrderLikelyForBusinessStateRequirementOnly() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");

        List<Finding> findings = evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF"),
                requiredState("reports")), readyStatuses());

        assertEquals(1, findings.size());
        assertEquals("CHAIN_ORDER", findings.get(0).ruleId());
        assertEquals(Confidence.LIKELY, findings.get(0).confidence());
    }

    @Test
    void confirmsChainOrderWhenObjectAuthorizationIsConfirmed() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");
        Fact objectAuthorization = objectAuthorization("reports", endpoint);

        List<Finding> findings = evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF"),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertEquals(1, findings.size());
        assertEquals("CHAIN_ORDER", findings.get(0).ruleId());
        assertEquals(Confidence.CONFIRMED, findings.get(0).confidence());
        assertTrue(findings.get(0).evidenceIds().contains("object-evidence-reports"));
    }

    @Test
    void avoidsOrderFindingsForNormalSelectionEqualPoliciesOrUnknownScope() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");

        assertTrue(evaluate(List.of(
                endpoint,
                chain("other", 1, "/api/other/**"),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF")),
                readyStatuses()).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "AUTHENTICATED", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF")),
                readyStatuses()).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "COMPOSITE_AUTHORITY", "/api/reports/summary", "ROLE_A,ROLE_B")),
                readyStatuses()).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF")),
                Map.of("starter-endpoint-mapping", AnalysisStatus.READY,
                        "security-chain", AnalysisStatus.PARTIAL)).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "UNKNOWN", "/api/reports/summary", null)),
                readyStatuses()).isEmpty());
    }

    @Test
    void doesNotSkipAnUnprovenIntermediateChainToCompareLaterProtection() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact unknown = fact("chain", "unknown", "SECURITY_CHAIN", "chain|unknown", Map.of(
                "chainKey", "proxy|unknown",
                "chainOrder", "2",
                "matcherType", "UNSUPPORTED",
                "matcherCondition", "unsupported",
                "proxyBeanName", "proxy"));
        Fact protectedChain = chain("protected", 3, "/api/reports/summary");
        Fact objectAuthorization = objectAuthorization("reports", endpoint);

        List<Finding> findings = evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                unknown,
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF"),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertTrue(findings.isEmpty());
    }

    @Test
    void doesNotCreateFindingWithEvidenceAbsentFromAnalysisReport() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact objectAuthorization = objectAuthorization("orders", endpoint);

        assertTrue(evaluateWithEvidence(List.of(endpoint, chain, objectAuthorization), readyStatuses(), List.of(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization))).isEmpty());
    }

    @Test
    void doesNotCreateFindingsWhenAllRequiredEvidenceIsEmpty() {
        Fact endpoint = withoutEvidence(endpoint("orders", "/api/orders"));
        Fact chain = withoutEvidence(chain("admin", 1, "/api/admin/**"));
        Fact objectAuthorization = withoutEvidence(objectAuthorization("orders", endpoint));

        assertTrue(evaluateWithEvidence(List.of(endpoint, chain, objectAuthorization), readyStatuses(), List.of(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization, List.of()))).isEmpty());

        Fact reportsEndpoint = withoutEvidence(endpoint("reports", "/api/reports/summary"));
        Fact broad = withoutEvidence(chain("broad", 1, "/api/reports/**"));
        Fact protectedChain = withoutEvidence(chain("protected", 2, "/api/reports/summary"));
        assertTrue(evaluateWithEvidence(List.of(
                reportsEndpoint,
                broad,
                withoutEvidence(policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null)),
                protectedChain,
                withoutEvidence(policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED",
                        "/api/reports/summary", "ROLE_STAFF"))), readyStatuses(), List.of(), List.of()).isEmpty());
    }

    @Test
    void doesNotCreateChainOrderWhenAnyRequiredFactHasNoEvidence() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact broadPolicy = policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null);
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");
        Fact protectedPolicy = policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED",
                "/api/reports/summary", "ROLE_STAFF");
        List<Fact> facts = List.of(endpoint, broad, broadPolicy, protectedChain, protectedPolicy);

        for (Fact required : facts) {
            assertTrue(evaluate(facts.stream()
                    .map(fact -> fact == required ? withoutEvidence(fact) : fact)
                    .toList(), readyStatuses()).isEmpty());
        }
    }

    @Test
    void doesNotCreateConfirmedFindingWhenObjectAuthorizationEvidenceIsMissing() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");
        Fact objectAuthorization = objectAuthorization("reports", endpoint);

        List<Fact> structuralFacts = List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF"));
        List<Fact> factsWithMissingObjectEvidence = new ArrayList<>(structuralFacts);
        factsWithMissingObjectEvidence.add(withoutEvidence(objectAuthorization));
        List<Fact> factsWithObjectAuthorization = new ArrayList<>(structuralFacts);
        factsWithObjectAuthorization.add(objectAuthorization);

        assertTrue(evaluate(factsWithMissingObjectEvidence, readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization,
                        List.of(endpoint.evidenceIds().get(0))))).isEmpty());
        assertTrue(evaluate(factsWithObjectAuthorization, readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization, List.of()))).isEmpty());
    }

    @Test
    void doesNotCreateChainOrderWhenAChainOrderIsMissing() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 3, "/api/reports/summary");

        assertTrue(evaluate(List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF")),
                readyStatuses()).isEmpty());
    }

    @Test
    void doesNotCreateFindingWhenConfirmedRelationHasNoPolicySource() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact methodAuthorization = methodAuthorization("orders", endpoint);
        Relation incompleteRelation = new Relation(
                "method-relation-without-policy-source",
                endpoint.attributes().get("handler"),
                methodAuthorization.subjectKey(),
                EdgeType.SECURED_BY,
                Map.of("securityKind", "AUTHORIZATION"),
                Confidence.CONFIRMED,
                List.of(endpoint.evidenceIds().get(0), methodAuthorization.evidenceIds().get(0)));

        assertTrue(evaluate(List.of(endpoint, chain, methodAuthorization), readyStatuses(),
                List.of(incompleteRelation)).isEmpty());
    }

    @Test
    void doesNotTreatPermitAllMethodAuthorizationAsIndependentProtectionRequirement() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact methodAuthorization = methodAuthorization("orders", endpoint, "PERMIT_ALL");

        assertTrue(evaluate(List.of(endpoint, chain, methodAuthorization), readyStatuses(),
                List.of(methodAuthorizationRelation(endpoint, methodAuthorization))).isEmpty());
    }

    @Test
    void keepsFindingIdsAndEvidenceStableForRepeatedInput() {
        Fact endpoint = endpoint("reports", "/api/reports/summary");
        Fact broad = chain("broad", 1, "/api/reports/**");
        Fact protectedChain = chain("protected", 2, "/api/reports/summary");
        Fact objectAuthorization = objectAuthorization("reports", endpoint);
        List<Fact> facts = List.of(
                endpoint,
                broad,
                policy("broad-policy", broad, "PERMIT_ALL", "/api/reports/**", null),
                protectedChain,
                policy("protected-policy", protectedChain, "AUTHORITY_REQUIRED", "/api/reports/summary", "ROLE_STAFF"),
                objectAuthorization);

        List<Finding> first = evaluate(facts, readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));
        List<Fact> reversed = new ArrayList<>(facts);
        Collections.reverse(reversed);
        List<Finding> second = evaluate(reversed, readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertEquals(first, second);
    }

    private List<Finding> evaluate(List<Fact> facts, Map<String, AnalysisStatus> statuses) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        return evaluateWithEvidence(facts, statuses, evidence, List.of());
    }

    private List<Finding> evaluateWithEvidence(
            List<Fact> facts,
            Map<String, AnalysisStatus> statuses,
            List<Evidence> evidence
    ) {
        return evaluateWithEvidence(facts, statuses, evidence, List.of());
    }

    private List<Finding> evaluate(
            List<Fact> facts,
            Map<String, AnalysisStatus> statuses,
            List<Relation> additionalRelations
    ) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        return evaluateWithEvidence(facts, statuses, evidence, additionalRelations);
    }

    private List<Finding> evaluateWithEvidence(
            List<Fact> facts,
            Map<String, AnalysisStatus> statuses,
            List<Evidence> evidence,
            List<Relation> additionalRelations
    ) {
        CollectionReport collection = new CollectionReport(facts, evidence, statuses, List.of());
        AnalysisReport analyzed = new AnalysisProvider().execute(
                new AnalysisContext(collection, "main"), List.of(new EndpointChainMatchingAnalysisAdapter()));
        AnalysisReport report = new AnalysisReport(
                collection,
                java.util.stream.Stream.concat(analyzed.relations().stream(), additionalRelations.stream()).toList(),
                analyzed.evidence(),
                analyzed.statusByAdapter(),
                analyzed.diagnostics());
        return new SecurityRuleEngine().evaluate(report);
    }

    private Map<String, AnalysisStatus> readyStatuses() {
        return Map.of("starter-endpoint-mapping", AnalysisStatus.READY, "security-chain", AnalysisStatus.READY);
    }

    private Fact endpoint(String key, String path) {
        return fact("endpoint", key, "ENDPOINT_MAPPING", "endpoint|" + key, Map.of(
                "httpMethod", "GET",
                "path", path,
                "handler", "Reports#" + key,
                "mvcPathPatternSettings", "DEFAULT"));
    }

    private Fact chain(String key, int order, String condition) {
        return fact("chain", key, "SECURITY_CHAIN", "chain|" + key, Map.of(
                "chainKey", "proxy|" + key,
                "chainOrder", Integer.toString(order),
                "matcherType", "PATH",
                "matcherCondition", condition,
                "pathPatternSettings", "DEFAULT",
                "proxyBeanName", "proxy"));
    }

    private Fact policy(String key, Fact chain, String kind, String condition, String authority) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", chain.attributes().get("chainOrder"));
        attributes.put("policyOrder", "1");
        attributes.put("policyKind", kind);
        attributes.put("policyMatcherType", "PATH");
        attributes.put("policyMatcherCondition", condition);
        attributes.put("pathPatternSettings", "DEFAULT");
        attributes.put("policySource", "URL");
        attributes.put("proxyBeanName", "proxy");
        if (authority != null) {
            attributes.put("requiredAuthority", authority);
        }
        return fact("policy", key, "URL_AUTHORIZATION", "policy|" + key, attributes);
    }

    private Fact requiredState(String endpointKey) {
        return fact("state", endpointKey, "BUSINESS_SECURITY_STATE", "state|" + endpointKey, Map.of(
                "stateName", "IDENTITY_VERIFIED",
                "stateAction", "REQUIRES",
                "declaringMethod", "Reports#" + endpointKey));
    }

    private Fact methodAuthorization(String endpointKey, Fact endpoint) {
        return methodAuthorization(endpointKey, endpoint, "PRE_AUTHORIZE");
    }

    private Fact methodAuthorization(String endpointKey, Fact endpoint, String declarationKind) {
        return fact("method", endpointKey, "METHOD_AUTHORIZATION", "method|" + endpointKey, Map.of(
                "handler", endpoint.attributes().get("handler"),
                "declarationKind", declarationKind));
    }

    private Relation methodAuthorizationRelation(Fact endpoint, Fact methodAuthorization) {
        return new Relation(
                "method-relation-" + endpoint.subjectKey(),
                endpoint.attributes().get("handler"),
                methodAuthorization.subjectKey(),
                EdgeType.SECURED_BY,
                Map.of("securityKind", "AUTHORIZATION", "policySource", "METHOD"),
                Confidence.CONFIRMED,
                List.of(endpoint.evidenceIds().get(0), methodAuthorization.evidenceIds().get(0)));
    }

    private Fact objectAuthorization(String endpointKey, Fact endpoint) {
        return fact("object", endpointKey, "OBJECT_AUTHORIZATION", "object|" + endpointKey, Map.of(
                "codeLocation", endpoint.attributes().get("handler"),
                "checkKind", "OWNER_MATCH_WITH_DENY"));
    }

    private Relation objectAuthorizationRelation(Fact endpoint, Fact objectAuthorization) {
        return objectAuthorizationRelation(endpoint, objectAuthorization,
                List.of(endpoint.evidenceIds().get(0), objectAuthorization.evidenceIds().get(0)));
    }

    private Relation objectAuthorizationRelation(
            Fact endpoint,
            Fact objectAuthorization,
            List<String> evidenceIds
    ) {
        return new Relation(
                "object-relation-" + endpoint.subjectKey(),
                endpoint.attributes().get("handler"),
                objectAuthorization.subjectKey(),
                EdgeType.SECURED_BY,
                Map.of("securityKind", "AUTHORIZATION", "policySource", "OBJECT"),
                Confidence.CONFIRMED,
                evidenceIds);
    }

    private Fact withoutEvidence(Fact fact) {
        return new Fact(fact.id(), fact.type(), fact.subjectKey(), fact.attributes(), List.of());
    }

    private Fact fact(String prefix, String key, String type, String subjectKey, Map<String, String> attributes) {
        return new Fact(prefix + "-fact-" + key, type, subjectKey, attributes, List.of(prefix + "-evidence-" + key));
    }
}
