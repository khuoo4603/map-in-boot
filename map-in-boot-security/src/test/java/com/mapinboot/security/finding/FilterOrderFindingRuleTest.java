package com.mapinboot.security.finding;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FilterOrderFindingRuleTest {

    @Test
    void doesNotFlagAuthenticationProviderBeforeGuardedFilter() {
        Fact endpoint = endpoint("normal", "/normal");
        Fact chain = chain("normal");
        Fact bearer = securityFilter("bearer", chain, 1,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));
        Fact guard = guardedFilter("guard", chain, 2);

        AnalysisReport report = report(List.of(endpoint, chain, bearer, guard), List.of(
                matched(endpoint, chain), filtered(chain, bearer), filtered(chain, guard)));

        assertTrue(new FilterOrderFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void flagsAuthenticationGuardBeforeAuthenticationProviderWithLimitedConfidence() {
        Fact endpoint = endpoint("vulnerable", "/vulnerable");
        Fact chain = chain("vulnerable");
        Fact guard = guardedFilter("guard", chain, 1);
        Fact bearer = securityFilter("bearer", chain, 2,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));

        AnalysisReport report = report(List.of(endpoint, chain, guard, bearer), List.of(
                matched(endpoint, chain), filtered(chain, guard), filtered(chain, bearer)));

        List<Finding> findings = new FilterOrderFindingRule().evaluate(report);

        assertEquals(1, findings.size());
        assertEquals("FILTER_ORDER", findings.get(0).ruleId());
        assertEquals(Confidence.LIKELY, findings.get(0).confidence());
        assertTrue(findings.get(0).evidenceIds().stream()
                .allMatch(id -> report.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
    }

    @Test
    void doesNotInferAuthenticationDependencyFromLookupOnlyPattern() {
        Fact endpoint = endpoint("lookup", "/lookup");
        Fact chain = chain("lookup");
        Fact lookup = securityFilter("lookup-filter", chain, 1,
                LookupOnlyFilter.class.getName(),
                Map.of("codePattern", "AUTHENTICATION_LOOKUP"));
        Fact bearer = securityFilter("bearer", chain, 2,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));

        AnalysisReport report = report(List.of(endpoint, chain, lookup, bearer), List.of(
                matched(endpoint, chain), filtered(chain, lookup), filtered(chain, bearer)));

        assertTrue(new FilterOrderFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void doesNotTreatClassReuseAcrossChainsAsOrderFinding() {
        Fact firstEndpoint = endpoint("first", "/first");
        Fact secondEndpoint = endpoint("second", "/second");
        Fact firstChain = chain("first");
        Fact secondChain = chain("second");
        Fact firstFilter = securityFilter("shared-first", firstChain, 1,
                SharedFilter.class.getName(), Map.of("instanceReuse", "CROSS_CHAIN"));
        Fact secondFilter = securityFilter("shared-second", secondChain, 1,
                SharedFilter.class.getName(), Map.of("instanceReuse", "CROSS_CHAIN"));

        AnalysisReport report = report(
                List.of(firstEndpoint, secondEndpoint, firstChain, secondChain, firstFilter, secondFilter),
                List.of(
                        matched(firstEndpoint, firstChain), matched(secondEndpoint, secondChain),
                        filtered(firstChain, firstFilter), filtered(secondChain, secondFilter)));

        assertTrue(new FilterOrderFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void doesNotTreatRepeatedInstanceWithinChainAsFindingWithoutImpactEvidence() {
        Fact endpoint = endpoint("duplicate", "/duplicate");
        Fact chain = chain("duplicate");
        Fact first = securityFilter("duplicate-first", chain, 1,
                SharedFilter.class.getName(), Map.of("instanceReuse", "WITHIN_CHAIN"));
        Fact second = securityFilter("duplicate-second", chain, 2,
                SharedFilter.class.getName(), Map.of("instanceReuse", "WITHIN_CHAIN"));

        AnalysisReport report = report(List.of(endpoint, chain, first, second), List.of(
                matched(endpoint, chain), filtered(chain, first), filtered(chain, second)));

        assertTrue(new FilterOrderFindingRule().evaluate(report).isEmpty());
    }

    @Test
    void doesNotGuessWhenEndpointChainIsAmbiguousOrFilterEvidenceIsIncomplete() {
        Fact endpoint = endpoint("ambiguous", "/ambiguous");
        Fact firstChain = chain("ambiguous-first");
        Fact secondChain = chain("ambiguous-second");
        Fact guard = guardedFilter("ambiguous-guard", firstChain, 1);
        Fact bearer = securityFilter("ambiguous-bearer", firstChain, 2,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));

        AnalysisReport ambiguous = report(
                List.of(endpoint, firstChain, secondChain, guard, bearer),
                List.of(matched(endpoint, firstChain), matched(endpoint, secondChain),
                        filtered(firstChain, guard), filtered(firstChain, bearer)));
        assertTrue(new FilterOrderFindingRule().evaluate(ambiguous).isEmpty());

        List<Fact> factsWithoutBearer = List.of(endpoint, firstChain, guard);
        AnalysisReport incomplete = report(factsWithoutBearer,
                List.of(matched(endpoint, firstChain), filtered(firstChain, guard)));
        assertTrue(new FilterOrderFindingRule().evaluate(incomplete).isEmpty());
    }

    @Test
    void servletCollectionPartialDoesNotBlockCompleteSecurityChainEvaluation() {
        Fact endpoint = endpoint("partial-servlet", "/partial-servlet");
        Fact chain = chain("partial-servlet");
        Fact guard = guardedFilter("partial-guard", chain, 1);
        Fact bearer = securityFilter("partial-bearer", chain, 2,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));

        AnalysisReport report = report(
                List.of(endpoint, chain, guard, bearer),
                List.of(matched(endpoint, chain), filtered(chain, guard), filtered(chain, bearer)),
                Map.of("servlet-filter-registration", AnalysisStatus.PARTIAL),
                Map.of("filter-registration-analysis", AnalysisStatus.PARTIAL));

        assertEquals(1, new FilterOrderFindingRule().evaluate(report).size());
    }

    @Test
    void doesNotCreateFindingWhenEvidenceIsMissing() {
        Fact endpoint = endpoint("missing-evidence", "/missing-evidence");
        Fact chain = chain("missing-evidence");
        Fact guard = guardedFilter("missing-guard", chain, 1);
        Fact bearer = securityFilter("missing-bearer", chain, 2,
                "org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter",
                Map.of("filterRole", "AUTHENTICATION_PROVIDER"));
        AnalysisReport report = report(
                List.of(endpoint, chain, guard, bearer),
                List.of(matched(endpoint, chain), filtered(chain, guard), filtered(chain, bearer)));
        AnalysisReport withoutCodeEvidence = new AnalysisReport(
                report.collectionReport(), report.relations(),
                report.evidence().stream().filter(evidence -> !evidence.id().equals("filter-code-missing-guard")).toList(),
                report.statusByAdapter(), report.diagnostics());

        assertTrue(new FilterOrderFindingRule().evaluate(withoutCodeEvidence).isEmpty());
    }

    private AnalysisReport report(List<Fact> facts, List<Relation> relations) {
        return report(facts, relations, Map.of(), Map.of());
    }

    private AnalysisReport report(
            List<Fact> facts,
            List<Relation> relations,
            Map<String, AnalysisStatus> extraCollectionStatuses,
            Map<String, AnalysisStatus> extraAnalysisStatuses
    ) {
        Map<String, AnalysisStatus> collectionStatuses = new LinkedHashMap<>();
        collectionStatuses.put("starter-endpoint-mapping", AnalysisStatus.READY);
        collectionStatuses.put("security-chain", AnalysisStatus.READY);
        collectionStatuses.putAll(extraCollectionStatuses);
        Map<String, AnalysisStatus> analysisStatuses = new LinkedHashMap<>();
        analysisStatuses.put("security-endpoint-chain-matching", AnalysisStatus.READY);
        analysisStatuses.put("filter-registration-analysis", AnalysisStatus.READY);
        analysisStatuses.putAll(extraAnalysisStatuses);
        List<Evidence> evidence = new ArrayList<>();
        facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .forEach(id -> evidence.add(new Evidence(id, id.contains("code")
                        ? EvidenceSource.CODE_PATTERN : EvidenceSource.RUNTIME, "test", "test evidence")));
        relations.stream()
                .flatMap(relation -> relation.evidenceIds().stream())
                .distinct()
                .filter(id -> evidence.stream().noneMatch(item -> item.id().equals(id)))
                .forEach(id -> evidence.add(new Evidence(id, EvidenceSource.RUNTIME, "test", "relation evidence")));
        return new AnalysisReport(
                new CollectionReport(facts, evidence, collectionStatuses, List.of()),
                relations, evidence, analysisStatuses, List.of());
    }

    private Fact endpoint(String key, String path) {
        return fact("endpoint", key, "ENDPOINT_MAPPING", "endpoint|" + key, Map.of(
                "httpMethod", "POST", "path", path, "handler", "controller|" + key + "#handle"));
    }

    private Fact chain(String key) {
        return fact("chain", key, "SECURITY_CHAIN", "chain|" + key, Map.of(
                "chainKey", "proxy|" + key, "chainOrder", "1", "proxyBeanName", "proxy"));
    }

    private Fact guardedFilter(String key, Fact chain, int order) {
        return securityFilter(key, chain, order, GuardedFilter.class.getName(), Map.of(
                "codePattern", "AUTHENTICATION_GUARD",
                "authData", "SECURITY_CONTEXT_AUTHENTICATION",
                "authType", "JWT_AUTHENTICATION",
                "authCheck", "IS_AUTHENTICATED",
                "unauthenticatedAction", "HTTP_401",
                "filterChainContinuation", "AFTER_AUTHENTICATION"));
    }

    private Fact securityFilter(
            String key,
            Fact chain,
            int order,
            String filterClass,
            Map<String, String> additionalAttributes
    ) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("filterClass", filterClass);
        attributes.put("registrationKind", "SECURITY");
        attributes.put("proxyBeanName", chain.attributes().get("proxyBeanName"));
        attributes.put("chainKey", chain.attributes().get("chainKey"));
        attributes.put("chainOrder", chain.attributes().get("chainOrder"));
        attributes.put("filterOrder", Integer.toString(order));
        attributes.putAll(additionalAttributes);
        List<String> evidenceIds = new ArrayList<>(List.of("filter-runtime-" + key));
        if ("AUTHENTICATION_GUARD".equals(additionalAttributes.get("codePattern"))) {
            evidenceIds.add("filter-code-" + key);
        }
        return fact("filter", key, "FILTER_REGISTRATION",
                "filter|SECURITY|proxy|" + chain.attributes().get("chainKey") + "|" + order + "|" + filterClass,
                attributes, evidenceIds);
    }

    private Relation matched(Fact endpoint, Fact chain) {
        return relation("matched-" + endpoint.subjectKey() + "-" + chain.subjectKey(),
                endpoint.subjectKey(), chain.subjectKey(), EdgeType.MATCHED_BY,
                Map.of("chainKey", chain.attributes().get("chainKey"),
                        "chainOrder", chain.attributes().get("chainOrder")),
                List.of(endpoint.evidenceIds().get(0), chain.evidenceIds().get(0)));
    }

    private Relation filtered(Fact chain, Fact filter) {
        return relation("filtered-" + chain.subjectKey() + "-" + filter.subjectKey(),
                chain.subjectKey(), filter.subjectKey(), EdgeType.FILTERED_BY,
                Map.of("registrationKind", "SECURITY",
                        "chainKey", chain.attributes().get("chainKey"),
                        "chainOrder", chain.attributes().get("chainOrder"),
                        "proxyBeanName", chain.attributes().get("proxyBeanName"),
                        "filterClass", filter.attributes().get("filterClass"),
                        "filterOrder", filter.attributes().get("filterOrder")),
                List.of(chain.evidenceIds().get(0), filter.evidenceIds().get(0)));
    }

    private Relation relation(
            String id,
            String source,
            String target,
            EdgeType type,
            Map<String, String> attributes,
            List<String> evidenceIds
    ) {
        return new Relation(id, source, target, type, attributes, Confidence.CONFIRMED, evidenceIds);
    }

    private Fact fact(String prefix, String key, String type, String subjectKey, Map<String, String> attributes) {
        return fact(prefix, key, type, subjectKey, attributes, List.of(prefix + "-evidence-" + key));
    }

    private Fact fact(
            String prefix,
            String key,
            String type,
            String subjectKey,
            Map<String, String> attributes,
            List<String> evidenceIds
    ) {
        return new Fact(prefix + "-fact-" + key, type, subjectKey, attributes, evidenceIds);
    }

    static class GuardedFilter {
    }

    static class LookupOnlyFilter {
    }

    static class SharedFilter {
    }
}
