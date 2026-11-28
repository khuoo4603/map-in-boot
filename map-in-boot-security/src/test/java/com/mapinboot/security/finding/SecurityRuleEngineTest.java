package com.mapinboot.security.finding;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.FindingEvaluationException;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.core.finding.FindingEvaluation;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.GraphNode;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.jeasy.rules.api.Facts;
import org.jeasy.rules.api.Rule;

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
    void doesNotTreatProducedBusinessStateAsRequiredState() {
        Fact requirement = fact("state", "produced", "BUSINESS_SECURITY_STATE", "state|produced", Map.of(
                "handler", "OrdersController#submit()",
                "stateName", "IDENTITY_VERIFIED",
                "stateAction", "PRODUCES",
                "claim", "identity_verified",
                "declaringMethod", "OrdersController#submit()"));
        Fact evaluation = fact("state-evaluation", "produced", "BUSINESS_STATE_EVALUATION",
                "state-evaluation|produced", Map.of(
                        "handler", "OrdersController#submit()",
                        "requirementKey", requirement.subjectKey(),
                        "stateName", "IDENTITY_VERIFIED",
                        "claimName", "identity_verified",
                        "codeLocation", "OrdersController#submit():21",
                        "pathOutcome", "BYPASS_PATH",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "evaluationScope", "HANDLER_LOCAL"));

        assertTrue(evaluate(List.of(requirement, evaluation), Map.of()).stream()
                .noneMatch(finding -> "STATE_BYPASS".equals(finding.ruleId())));
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

        Finding chainOrder = findings.stream()
                .filter(finding -> "CHAIN_ORDER".equals(finding.ruleId()))
                .findFirst().orElseThrow();
        assertEquals(Confidence.CONFIRMED, chainOrder.confidence());
        assertTrue(chainOrder.evidenceIds().contains("object-evidence-reports"));
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

        assertTrue(findings.stream().noneMatch(finding -> "CHAIN_ORDER".equals(finding.ruleId())));
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
    void createsLikelyPublicEndpointForActualPermitAllWithObjectAuthorization() {
        Fact endpoint = endpoint("customers", "/api/customers/search");
        Fact chain = chain("customers", 1, "/api/customers/**");
        Fact objectAuthorization = objectAuthorization("customers", endpoint);

        List<Finding> findings = evaluate(List.of(
                endpoint,
                chain,
                policy("customers-policy", chain, "PERMIT_ALL", "/api/customers/search", null),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertEquals(1, findings.size());
        assertEquals("PUBLIC_ENDPOINT", findings.get(0).ruleId());
        assertEquals(Confidence.LIKELY, findings.get(0).confidence());
        assertTrue(findings.get(0).evidenceIds().contains("endpoint-evidence-customers"));
        assertTrue(findings.get(0).evidenceIds().contains("policy-evidence-customers-policy"));
        assertTrue(findings.get(0).evidenceIds().contains("object-evidence-customers"));
    }

    @Test
    void doesNotCreatePublicEndpointForNormalOrUncertainPolicies() {
        Fact endpoint = endpoint("customers", "/api/customers/search");
        Fact chain = chain("customers", 1, "/api/customers/**");
        Fact objectAuthorization = objectAuthorization("customers", endpoint);

        assertTrue(evaluate(List.of(
                endpoint,
                chain,
                policy("permit-policy", chain, "PERMIT_ALL", "/api/customers/search", null)),
                readyStatuses()).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                chain,
                policy("authority-policy", chain, "AUTHORITY_REQUIRED", "/api/customers/search", "ROLE_STAFF"),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization))).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                chain,
                policy("deny-policy", chain, "DENY_ALL", "/api/customers/**", null, "PATH", 1),
                policy("later-permit-policy", chain, "PERMIT_ALL", "ANY", null, "ANY", 2),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization))).isEmpty());
        Fact unsupportedPolicy = policy("unsupported-policy", chain, "PERMIT_ALL", "/api/customers/search", null,
                "UNSUPPORTED", 1);
        assertTrue(evaluate(List.of(endpoint, chain, unsupportedPolicy, objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization))).isEmpty());
        assertTrue(evaluate(List.of(
                endpoint,
                chain,
                policy("state-policy", chain, "PERMIT_ALL", "/api/customers/search", null),
                requiredState("customers")), readyStatuses()).isEmpty());
    }

    @Test
    void createsPublicEndpointOnlyForPermitAllEndpointOfSharedHandler() {
        Fact publicEndpoint = endpoint("customers-public", "/api/customers/public", "Customers#search");
        Fact protectedEndpoint = endpoint("customers-protected", "/api/customers/protected", "Customers#search");
        Fact chain = chain("customers", 1, "/api/customers/**");
        Fact objectAuthorization = objectAuthorization("customers", publicEndpoint);

        List<Finding> findings = evaluate(List.of(
                publicEndpoint,
                protectedEndpoint,
                chain,
                policy("public-policy", chain, "PERMIT_ALL", "/api/customers/public", null, "PATH", 1),
                policy("protected-policy", chain, "AUTHORITY_REQUIRED", "/api/customers/protected", "ROLE_STAFF", "PATH", 2),
                objectAuthorization), readyStatuses(),
                List.of(objectAuthorizationRelation(publicEndpoint, objectAuthorization)));

        assertEquals(1, findings.size());
        assertEquals("PUBLIC_ENDPOINT", findings.get(0).ruleId());
        assertTrue(findings.get(0).evidenceIds().contains("endpoint-evidence-customers-public"));
        assertTrue(!findings.get(0).evidenceIds().contains("endpoint-evidence-customers-protected"));
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

    @Test
    void keepsIntegratedObjectAndStateFindingIdsAndEvidenceStableForRepeatedInput() {
        Fact objectRequirement = fact("object-requirement", "stable",
                "OBJECT_AUTHORIZATION_REQUIREMENT", "object-requirement|stable", Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "declaringMethod", "OrdersController#load(java.lang.String)",
                        "requirementKind", "OWNER",
                        "resourceType", "com.example.Account",
                        "principalSource", "JWT_SUBJECT"));
        Fact objectPath = fact("object-path", "stable", "OBJECT_ACCESS_PATH", "object-path|stable", Map.of(
                "handler", "OrdersController#load(java.lang.String)",
                "codeLocation", "OrdersController#load(java.lang.String):20",
                "resourceType", "com.example.Account",
                "requirementKey", objectRequirement.subjectKey(),
                "pathOutcome", "UNGUARDED",
                "coverage", "COMPLETE_SUPPORTED_PATH",
                "principalSource", "JWT_SUBJECT"));
        Fact stateRequirement = fact("state-requirement", "stable",
                "BUSINESS_SECURITY_STATE", "state-requirement|stable", Map.of(
                        "handler", "OrdersController#submit()",
                        "stateName", "IDENTITY_VERIFIED",
                        "stateAction", "REQUIRES",
                        "claim", "identity_verified",
                        "declaringMethod", "OrdersController#submit()"));
        Fact stateEvaluation = fact("state-evaluation", "stable", "BUSINESS_STATE_EVALUATION",
                "state-evaluation|stable", Map.of(
                        "handler", "OrdersController#submit()",
                        "requirementKey", stateRequirement.subjectKey(),
                        "stateName", "IDENTITY_VERIFIED",
                        "claimName", "identity_verified",
                        "codeLocation", "OrdersController#submit():21",
                        "pathOutcome", "BYPASS_PATH",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "evaluationScope", "HANDLER_LOCAL"));
        List<Fact> facts = List.of(objectRequirement, objectPath, stateRequirement, stateEvaluation);

        List<Finding> first = evaluate(facts, Map.of());
        List<Fact> reversed = new ArrayList<>(facts);
        Collections.reverse(reversed);
        List<Finding> second = evaluate(reversed, Map.of());

        assertEquals(first, second);
        assertEquals(2, first.size());
        assertTrue(first.stream().flatMap(finding -> finding.evidenceIds().stream())
                .allMatch(id -> facts.stream().flatMap(fact -> fact.evidenceIds().stream())
                        .anyMatch(id::equals)));
    }

    @Test
    void linksObjectFindingToItsOwnRequirementAndPathWhenHandlersShareEvidence() {
        String sharedEvidenceId = "shared-object-evidence";
        Fact firstRequirement = objectRequirement("OrdersController#loadA(java.lang.String)", "object-requirement|a",
                sharedEvidenceId);
        Fact firstPath = objectPath(firstRequirement, "OrdersController#loadA(java.lang.String):20", "object-path|a",
                sharedEvidenceId);
        Fact secondRequirement = objectRequirement("OrdersController#loadB(java.lang.String)", "object-requirement|b",
                sharedEvidenceId);
        Fact secondPath = objectPath(secondRequirement, "OrdersController#loadB(java.lang.String):20", "object-path|b",
                sharedEvidenceId);
        List<Fact> facts = List.of(firstRequirement, firstPath, secondRequirement, secondPath);
        List<Evidence> evidence = List.of(
                new Evidence(sharedEvidenceId, EvidenceSource.RUNTIME, "test", "shared evidence"));
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(facts, evidence, Map.of(), List.of()),
                List.of(), evidence, Map.of(), List.of());
        SecurityGraph graph = new GraphBuilder().build("orders", report);

        FindingEvaluation evaluation = new SecurityRuleEngine().evaluateWithDiagnostics(report, graph);

        assertTrue(evaluation.diagnostics().isEmpty());
        Finding firstFinding = evaluation.findings().stream()
                .filter(finding -> finding.id().equals(new FindingIdGenerator().generate(
                        "OBJECT_BINDING", List.of(firstRequirement.subjectKey(), firstPath.subjectKey()))))
                .findFirst().orElseThrow();
        Finding secondFinding = evaluation.findings().stream()
                .filter(finding -> finding.id().equals(new FindingIdGenerator().generate(
                        "OBJECT_BINDING", List.of(secondRequirement.subjectKey(), secondPath.subjectKey()))))
                .findFirst().orElseThrow();

        assertEquals(List.of(nodeId(graph, firstRequirement.subjectKey()), nodeId(graph, firstPath.subjectKey()))
                        .stream().sorted().toList(), firstFinding.nodeIds());
        assertEquals(List.of(nodeId(graph, secondRequirement.subjectKey()), nodeId(graph, secondPath.subjectKey()))
                        .stream().sorted().toList(), secondFinding.nodeIds());
    }

    @Test
    void linksStateFindingToRequiredStateAndEvaluationWhenProducedStateSharesEvidence() {
        String sharedEvidenceId = "shared-state-evidence";
        Fact firstRequirement = stateRequirement("OrdersController#submitA()", "state-requirement|a", "REQUIRES",
                sharedEvidenceId);
        Fact firstEvaluation = stateEvaluation(firstRequirement, "OrdersController#submitA()", "state-evaluation|a",
                sharedEvidenceId);
        Fact secondRequirement = stateRequirement("OrdersController#submitB()", "state-requirement|b", "REQUIRES",
                sharedEvidenceId);
        Fact secondEvaluation = stateEvaluation(secondRequirement, "OrdersController#submitB()", "state-evaluation|b",
                sharedEvidenceId);
        Fact producedState = stateRequirement("OrdersController#produce()", "state-produced", "PRODUCES",
                sharedEvidenceId);
        List<Fact> facts = List.of(firstRequirement, firstEvaluation, secondRequirement, secondEvaluation, producedState);
        List<Evidence> evidence = List.of(
                new Evidence(sharedEvidenceId, EvidenceSource.RUNTIME, "test", "shared evidence"));
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(facts, evidence, Map.of(), List.of()),
                List.of(), evidence, Map.of(), List.of());
        SecurityGraph graph = new GraphBuilder().build("orders", report);

        FindingEvaluation evaluation = new SecurityRuleEngine().evaluateWithDiagnostics(report, graph);

        assertTrue(evaluation.diagnostics().isEmpty());
        Finding firstFinding = evaluation.findings().stream()
                .filter(finding -> finding.id().equals(new FindingIdGenerator().generate(
                        "STATE_BYPASS", List.of(firstRequirement.subjectKey(), firstEvaluation.subjectKey()))))
                .findFirst().orElseThrow();
        Finding secondFinding = evaluation.findings().stream()
                .filter(finding -> finding.id().equals(new FindingIdGenerator().generate(
                        "STATE_BYPASS", List.of(secondRequirement.subjectKey(), secondEvaluation.subjectKey()))))
                .findFirst().orElseThrow();

        assertEquals(List.of(nodeId(graph, firstRequirement.subjectKey()), nodeId(graph, firstEvaluation.subjectKey()))
                        .stream().sorted().toList(), firstFinding.nodeIds());
        assertEquals(List.of(nodeId(graph, secondRequirement.subjectKey()), nodeId(graph, secondEvaluation.subjectKey()))
                        .stream().sorted().toList(), secondFinding.nodeIds());
        assertTrue(firstFinding.nodeIds().stream().noneMatch(id -> id.equals(nodeId(graph, producedState.subjectKey()))));
        assertTrue(secondFinding.nodeIds().stream().noneMatch(id -> id.equals(nodeId(graph, producedState.subjectKey()))));
    }

    @Test
    void keepsExistingChainFindingWhenMethodMismatchHasNoStructuredBypassEvidence() {
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

        assertEquals(1, findings.stream().filter(finding -> "CHAIN_ORDER".equals(finding.ruleId())).count());
        assertTrue(findings.stream().noneMatch(finding -> "METHOD_MISMATCH".equals(finding.ruleId())));
    }

    @Test
    void registersFilterOrderRuleWithoutChangingExistingRuleEvaluation() {
        Fact endpoint = endpoint("filter-order", "/api/filter-order");
        Fact chain = chain("filter-order", 1, "/api/filter-order");
        Fact guard = new Fact(
                "filter-fact-guard", "FILTER_REGISTRATION",
                "filter|SECURITY|proxy|proxy|filter-order|1|GuardedFilter",
                Map.ofEntries(
                        Map.entry("filterClass", "GuardedFilter"),
                        Map.entry("registrationKind", "SECURITY"),
                        Map.entry("proxyBeanName", "proxy"),
                        Map.entry("chainKey", "proxy|filter-order"),
                        Map.entry("chainOrder", "1"),
                        Map.entry("filterOrder", "1"),
                        Map.entry("codePattern", "AUTHENTICATION_GUARD"),
                        Map.entry("authData", "SECURITY_CONTEXT_AUTHENTICATION"),
                        Map.entry("authType", "JWT_AUTHENTICATION"),
                        Map.entry("authCheck", "IS_AUTHENTICATED"),
                        Map.entry("unauthenticatedAction", "HTTP_401"),
                        Map.entry("filterChainContinuation", "AFTER_AUTHENTICATION")),
                List.of("filter-runtime-guard", "filter-code-guard"));
        Fact bearer = new Fact(
                "filter-fact-bearer", "FILTER_REGISTRATION",
                "filter|SECURITY|proxy|proxy|filter-order|2|org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of(
                        "filterClass", "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                        "registrationKind", "SECURITY",
                        "proxyBeanName", "proxy",
                        "chainKey", "proxy|filter-order",
                        "chainOrder", "1",
                        "filterOrder", "2",
                        "filterRole", "AUTHENTICATION_PROVIDER"),
                List.of("filter-runtime-bearer"));
        Relation matched = new Relation(
                "matched-filter-order", endpoint.subjectKey(), chain.subjectKey(), EdgeType.MATCHED_BY,
                Map.of("chainKey", "proxy|filter-order", "chainOrder", "1", "proxyBeanName", "proxy"),
                Confidence.CONFIRMED, List.of(endpoint.evidenceIds().get(0), chain.evidenceIds().get(0)));
        Relation guardRelation = filterRelation("guard", chain, guard);
        Relation bearerRelation = filterRelation("bearer", chain, bearer);
        List<Fact> facts = List.of(endpoint, chain, guard, bearer);
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .map(id -> new Evidence(id,
                        id.contains("code") ? EvidenceSource.CODE_PATTERN : EvidenceSource.RUNTIME,
                        "test", "test evidence"))
                .toList();
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(facts, evidence,
                        Map.of("starter-endpoint-mapping", AnalysisStatus.READY, "security-chain", AnalysisStatus.READY),
                        List.of()),
                List.of(matched, guardRelation, bearerRelation), evidence,
                Map.of("security-endpoint-chain-matching", AnalysisStatus.READY), List.of());

        List<Finding> findings = new SecurityRuleEngine().evaluate(report);

        assertEquals(1, findings.stream().filter(finding -> "FILTER_ORDER".equals(finding.ruleId())).count());
    }

    @Test
    void ignoresIncompleteRuleInputWhileContinuingOtherRules() {
        Fact endpoint = endpoint("orders", "/api/orders");
        Fact chain = chain("admin", 1, "/api/admin/**");
        Fact objectAuthorization = objectAuthorization("orders", endpoint);
        Fact malformedRequirement = fact("object-requirement", "broken",
                "OBJECT_AUTHORIZATION_REQUIREMENT", "object-requirement|broken", Map.of(
                        "resourceType", "com.example.Account",
                        "requirementKind", "OWNER",
                        "principalSource", "JWT_SUBJECT"));
        Fact malformedPath = fact("object-path", "broken", "OBJECT_ACCESS_PATH", "object-path|broken", Map.of(
                "resourceType", "com.example.Account",
                "requirementKey", malformedRequirement.subjectKey(),
                "pathOutcome", "UNGUARDED",
                "coverage", "COMPLETE_SUPPORTED_PATH",
                "principalSource", "JWT_SUBJECT"));

        FindingEvaluation evaluation = evaluateWithDiagnostics(
                List.of(endpoint, chain, objectAuthorization, malformedRequirement, malformedPath),
                readyStatuses(),
                List.of(objectAuthorizationRelation(endpoint, objectAuthorization)));

        assertTrue(evaluation.findings().stream().anyMatch(finding -> "CHAIN_MISSING".equals(finding.ruleId())));
        assertTrue(evaluation.findings().stream().noneMatch(finding -> "OBJECT_BINDING".equals(finding.ruleId())));
        assertTrue(evaluation.diagnostics().isEmpty());
    }

    @Test
    void reportsRuleFailureWithoutHidingLaterPositiveFinding() {
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(List.of(), List.of(), Map.of(), List.of()),
                List.of(), List.of(), Map.of(), List.of());
        Finding laterFinding = new Finding(
                "later-finding", "TEST_RULE", "테스트 Finding", "후속 Rule 양성", Confidence.LIKELY,
                List.of(), List.of(), List.of(), "후속 Rule 근거 확인");
        Rule firstFailure = rule("FIRST_FAILURE", 1, facts -> {
            throw new IllegalStateException("secret details must not be exposed");
        });
        Rule laterPositive = rule("LATER_POSITIVE", 2,
                facts -> facts.<List<Finding>>get("findings").add(laterFinding));

        SecurityRuleEngine engine = new SecurityRuleEngine(List.of(firstFailure, laterPositive));

        FindingEvaluation evaluation = engine.evaluateWithDiagnostics(report);

        assertEquals(List.of(laterFinding), evaluation.findings());
        assertEquals(1, evaluation.diagnostics().size());
        assertEquals("finding-rule:FIRST_FAILURE", evaluation.diagnostics().get(0).adapterId());
        assertThrows(FindingEvaluationException.class, () -> engine.evaluate(report));
    }

    @Test
    void reportsConflictingDuplicateObjectRequirementsInsteadOfDroppingOne() {
        String requirementKey = "object-requirement|duplicate";
        Fact firstRequirement = fact("object-requirement-a", "duplicate",
                "OBJECT_AUTHORIZATION_REQUIREMENT", requirementKey, Map.of(
                        "handler", "OrdersController#loadA(java.lang.String)",
                        "declaringMethod", "OrdersController#loadA(java.lang.String)",
                        "requirementKind", "OWNER",
                        "resourceType", "com.example.Account",
                        "principalSource", "JWT_SUBJECT"));
        Fact secondRequirement = fact("object-requirement-b", "duplicate",
                "OBJECT_AUTHORIZATION_REQUIREMENT", requirementKey, Map.of(
                        "handler", "OrdersController#loadB(java.lang.String)",
                        "declaringMethod", "OrdersController#loadB(java.lang.String)",
                        "requirementKind", "OWNER",
                        "resourceType", "com.example.Account",
                        "principalSource", "JWT_SUBJECT"));
        Fact path = fact("object-path", "duplicate", "OBJECT_ACCESS_PATH", "object-path|duplicate", Map.of(
                "handler", "OrdersController#loadB(java.lang.String)",
                "codeLocation", "OrdersController#loadB(java.lang.String):20",
                "resourceType", "com.example.Account",
                "requirementKey", requirementKey,
                "pathOutcome", "UNGUARDED",
                "coverage", "COMPLETE_SUPPORTED_PATH",
                "principalSource", "JWT_SUBJECT"));
        List<Fact> facts = List.of(firstRequirement, secondRequirement, path);
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(facts, evidenceFor(facts), Map.of(), List.of()),
                List.of(), evidenceFor(facts), Map.of(), List.of());

        FindingEvaluation evaluation = new SecurityRuleEngine().evaluateWithDiagnostics(report);

        assertTrue(evaluation.findings().isEmpty());
        assertEquals(List.of("finding-rule:OBJECT_BINDING"),
                evaluation.diagnostics().stream().map(diagnostic -> diagnostic.adapterId()).toList());
    }

    @Test
    void keepsDistinctFindingIdsForMultiplePathsOfOneHandler() {
        Fact requirement = fact("object-requirement", "multi-path",
                "OBJECT_AUTHORIZATION_REQUIREMENT", "object-requirement|multi-path", Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "declaringMethod", "OrdersController#load(java.lang.String)",
                        "requirementKind", "OWNER",
                        "resourceType", "com.example.Account",
                        "principalSource", "JWT_SUBJECT"));
        Fact firstPath = fact("object-path", "multi-path-a", "OBJECT_ACCESS_PATH", "object-path|multi-path-a",
                Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "codeLocation", "OrdersController#load(java.lang.String):20",
                        "resourceType", "com.example.Account",
                        "requirementKey", requirement.subjectKey(),
                        "pathOutcome", "UNGUARDED",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "principalSource", "JWT_SUBJECT"));
        Fact secondPath = fact("object-path", "multi-path-b", "OBJECT_ACCESS_PATH", "object-path|multi-path-b",
                Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "codeLocation", "OrdersController#load(java.lang.String):30",
                        "resourceType", "com.example.Account",
                        "requirementKey", requirement.subjectKey(),
                        "pathOutcome", "SOURCE_MISMATCH",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "principalSource", "JWT_SUBJECT"));

        List<Finding> findings = evaluate(List.of(requirement, firstPath, secondPath), Map.of());

        assertEquals(2, findings.size());
        assertNotEquals(findings.get(0).id(), findings.get(1).id());
        assertTrue(findings.stream().allMatch(finding -> finding.confidence() == Confidence.CONFIRMED));
        assertTrue(findings.stream().allMatch(finding -> finding.guide().contains("확인하세요")));
    }

    @Test
    void doesNotCreateStateBypassWhenRequirementEvidenceIsMissing() {
        Fact requirement = fact("state-requirement", "missing-evidence",
                "BUSINESS_SECURITY_STATE", "state-requirement|missing-evidence", Map.of(
                        "handler", "OrdersController#submit()",
                        "stateName", "IDENTITY_VERIFIED",
                        "stateAction", "REQUIRES",
                        "claim", "identity_verified",
                        "declaringMethod", "OrdersController#submit()"));
        Fact evaluation = fact("state-evaluation", "missing-evidence", "BUSINESS_STATE_EVALUATION",
                "state-evaluation|missing-evidence", Map.of(
                        "handler", "OrdersController#submit()",
                        "requirementKey", requirement.subjectKey(),
                        "stateName", "IDENTITY_VERIFIED",
                        "claimName", "identity_verified",
                        "codeLocation", "OrdersController#submit():21",
                        "pathOutcome", "BYPASS_PATH",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "evaluationScope", "HANDLER_LOCAL"));

        assertTrue(evaluate(List.of(withoutEvidence(requirement), evaluation), Map.of()).isEmpty());
    }

    @Test
    void diagnosesConflictingEvidenceIdsInsteadOfCreatingFinding() {
        Fact requirement = new Fact(
                "object-requirement-fact", "OBJECT_AUTHORIZATION_REQUIREMENT", "object-requirement|evidence-conflict",
                Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "declaringMethod", "OrdersController#load(java.lang.String)",
                        "requirementKind", "OWNER",
                        "resourceType", "com.example.Account",
                        "principalSource", "JWT_SUBJECT"),
                List.of("evidence-conflict"));
        Fact path = new Fact(
                "object-path-fact", "OBJECT_ACCESS_PATH", "object-path|evidence-conflict",
                Map.of(
                        "handler", "OrdersController#load(java.lang.String)",
                        "codeLocation", "OrdersController#load(java.lang.String):20",
                        "resourceType", "com.example.Account",
                        "requirementKey", requirement.subjectKey(),
                        "pathOutcome", "UNGUARDED",
                        "coverage", "COMPLETE_SUPPORTED_PATH",
                        "principalSource", "JWT_SUBJECT"),
                List.of("path-evidence"));
        List<Evidence> evidence = List.of(
                new Evidence("evidence-conflict", EvidenceSource.RUNTIME, "test", "first"),
                new Evidence("evidence-conflict", EvidenceSource.CODE_PATTERN, "test", "second"),
                new Evidence("path-evidence", EvidenceSource.RUNTIME, "test", "path"));
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(List.of(requirement, path), evidence, Map.of(), List.of()),
                List.of(), evidence, Map.of(), List.of());

        FindingEvaluation evaluation = new SecurityRuleEngine().evaluateWithDiagnostics(report);

        assertTrue(evaluation.findings().isEmpty());
        assertTrue(evaluation.diagnostics().stream()
                .anyMatch(diagnostic -> "finding-rule:OBJECT_BINDING".equals(diagnostic.adapterId())));
    }

    @Test
    void diagnosesConflictingFindingIdsInsteadOfKeepingOneContent() {
        Finding first = new Finding("collision", "TEST_RULE", "첫 번째", "첫 번째", Confidence.CONFIRMED,
                List.of(), List.of(), List.of(), "첫 번째 근거");
        Finding second = new Finding("collision", "TEST_RULE", "두 번째", "두 번째", Confidence.LIKELY,
                List.of(), List.of(), List.of(), "두 번째 근거");
        SecurityRuleEngine engine = new SecurityRuleEngine(List.of(
                rule("FIRST", 1, facts -> facts.<List<Finding>>get("findings").add(first)),
                rule("SECOND", 2, facts -> facts.<List<Finding>>get("findings").add(second))));
        AnalysisReport report = new AnalysisReport(
                new CollectionReport(List.of(), List.of(), Map.of(), List.of()),
                List.of(), List.of(), Map.of(), List.of());

        FindingEvaluation evaluation = engine.evaluateWithDiagnostics(report);

        assertTrue(evaluation.findings().isEmpty());
        assertEquals(List.of("finding-engine"),
                evaluation.diagnostics().stream().map(diagnostic -> diagnostic.adapterId()).toList());
    }

    private Rule rule(String name, int priority, Consumer<Facts> action) {
        return new Rule() {
            @Override
            public String getName() {
                return name;
            }

            @Override
            public int getPriority() {
                return priority;
            }

            @Override
            public boolean evaluate(Facts facts) {
                return true;
            }

            @Override
            public void execute(Facts facts) {
                action.accept(facts);
            }

            @Override
            public int compareTo(Rule other) {
                return Integer.compare(priority, other.getPriority());
            }
        };
    }

    private Fact objectRequirement(String handler, String subjectKey, String evidenceId) {
        return new Fact("requirement-" + subjectKey, "OBJECT_AUTHORIZATION_REQUIREMENT", subjectKey, Map.of(
                "handler", handler,
                "declaringMethod", handler,
                "requirementKind", "OWNER",
                "resourceType", "com.example.Account",
                "principalSource", "JWT_SUBJECT"), List.of(evidenceId));
    }

    private Fact objectPath(Fact requirement, String codeLocation, String subjectKey, String evidenceId) {
        return new Fact("path-" + subjectKey, "OBJECT_ACCESS_PATH", subjectKey, Map.of(
                "handler", requirement.attributes().get("handler"),
                "codeLocation", codeLocation,
                "resourceType", "com.example.Account",
                "requirementKey", requirement.subjectKey(),
                "pathOutcome", "UNGUARDED",
                "coverage", "COMPLETE_SUPPORTED_PATH",
                "principalSource", "JWT_SUBJECT"), List.of(evidenceId));
    }

    private Fact stateRequirement(String handler, String subjectKey, String action, String evidenceId) {
        return new Fact("state-" + subjectKey, "BUSINESS_SECURITY_STATE", subjectKey, Map.of(
                "handler", handler,
                "stateName", "IDENTITY_VERIFIED",
                "stateAction", action,
                "claim", "identity_verified",
                "declaringMethod", handler), List.of(evidenceId));
    }

    private Fact stateEvaluation(Fact requirement, String handler, String subjectKey, String evidenceId) {
        return new Fact("evaluation-" + subjectKey, "BUSINESS_STATE_EVALUATION", subjectKey, Map.of(
                "handler", handler,
                "requirementKey", requirement.subjectKey(),
                "stateName", "IDENTITY_VERIFIED",
                "claimName", "identity_verified",
                "codeLocation", handler + ":20",
                "pathOutcome", "BYPASS_PATH",
                "coverage", "COMPLETE_SUPPORTED_PATH",
                "evaluationScope", "HANDLER_LOCAL"), List.of(evidenceId));
    }

    private String nodeId(SecurityGraph graph, String label) {
        return graph.nodes().stream()
                .filter(node -> label.equals(node.label()))
                .map(GraphNode::id)
                .findFirst().orElseThrow();
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

    private FindingEvaluation evaluateWithDiagnostics(
            List<Fact> facts,
            Map<String, AnalysisStatus> statuses,
            List<Relation> additionalRelations
    ) {
        List<Evidence> evidence = facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
        CollectionReport collection = new CollectionReport(facts, evidence, statuses, List.of());
        AnalysisReport analyzed = new AnalysisProvider().execute(
                new AnalysisContext(collection, "main"), List.of(new EndpointChainMatchingAnalysisAdapter()));
        AnalysisReport report = new AnalysisReport(
                collection,
                java.util.stream.Stream.concat(analyzed.relations().stream(), additionalRelations.stream()).toList(),
                analyzed.evidence(),
                analyzed.statusByAdapter(),
                analyzed.diagnostics());
        return new SecurityRuleEngine().evaluateWithDiagnostics(report);
    }

    private List<Evidence> evidenceFor(List<Fact> facts) {
        return facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
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
        return endpoint(key, path, "Reports#" + key);
    }

    private Fact endpoint(String key, String path, String handler) {
        return fact("endpoint", key, "ENDPOINT_MAPPING", "endpoint|" + key, Map.of(
                "httpMethod", "GET",
                "path", path,
                "handler", handler,
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
        return policy(key, chain, kind, condition, authority, "PATH", 1);
    }

    private Fact policy(
            String key,
            Fact chain,
            String kind,
            String condition,
            String authority,
            String matcherType,
            int order
    ) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", chain.attributes().get("chainOrder"));
        attributes.put("policyOrder", Integer.toString(order));
        attributes.put("policyKind", kind);
        attributes.put("policyMatcherType", matcherType);
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

    private Relation filterRelation(String key, Fact chain, Fact filter) {
        return new Relation(
                "filter-relation-" + key,
                chain.subjectKey(), filter.subjectKey(), EdgeType.FILTERED_BY,
                Map.of("registrationKind", "SECURITY",
                        "filterClass", filter.attributes().get("filterClass"),
                        "proxyBeanName", chain.attributes().get("proxyBeanName"),
                        "chainKey", chain.attributes().get("chainKey"),
                        "chainOrder", chain.attributes().get("chainOrder"),
                        "filterOrder", filter.attributes().get("filterOrder")),
                Confidence.CONFIRMED,
                List.of(chain.evidenceIds().get(0), filter.evidenceIds().get(0)));
    }
}
