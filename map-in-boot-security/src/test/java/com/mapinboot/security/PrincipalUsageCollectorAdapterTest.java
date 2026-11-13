package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.collector.PrincipalUsageCollectorAdapter;
import com.mapinboot.security.collector.SessionUsageCollectorAdapter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

class PrincipalUsageCollectorAdapterTest {

    @Test
    void collectsPrincipalSourcesAndAuthorityMappingWithoutConfusingLookups() {
        try (AnnotationConfigApplicationContext context = context()) {
            PrincipalUsageCollectorAdapter adapter = new PrincipalUsageCollectorAdapter();
            var result = adapter.collect(new CollectionContext(context, "account", "instance"));

            assertEquals("security-principal-usage", adapter.id());
            assertEquals(Set.of("PRINCIPAL_USAGE", "AUTHORITY_MAPPING"), adapter.getSupportedTypes());
            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.diagnostics().isEmpty());
            assertEquals(6, facts(result.facts(), "PRINCIPAL_USAGE").size());
            assertEquals(1, facts(result.facts(), "AUTHORITY_MAPPING").size());
            assertTrue(result.facts().stream().allMatch(fact ->
                    fact.evidenceIds().stream().allMatch(id -> result.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id)))));
            assertTrue(result.evidence().stream().anyMatch(evidence ->
                    evidence.source() == EvidenceSource.DECLARATION));
            assertTrue(result.evidence().stream().anyMatch(evidence ->
                    evidence.source() == EvidenceSource.CODE_PATTERN));

            assertTrue(result.facts().stream().anyMatch(fact ->
                    "PRINCIPAL_USAGE".equals(fact.type())
                            && Jwt.class.getName().equals(fact.attributes().get("principalType"))
                            && "AUTHENTICATION_PRINCIPAL".equals(fact.attributes().get("sourceKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "getPrincipal".equals(fact.attributes().get("apiName"))
                            && "PRINCIPAL_LOOKUP".equals(fact.attributes().get("observationKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "getName".equals(fact.attributes().get("apiName"))
                            && "PRINCIPAL_NAME".equals(fact.attributes().get("observationKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "getAuthorities".equals(fact.attributes().get("apiName"))
                            && "AUTHORITY_LOOKUP".equals(fact.attributes().get("observationKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "getAuthentication".equals(fact.attributes().get("apiName"))
                            && "SECURITY_CONTEXT".equals(fact.attributes().get("sourceKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "getSubject".equals(fact.attributes().get("apiName"))
                            && "JWT".equals(fact.attributes().get("sourceKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "AUTHORITY_MAPPING".equals(fact.type())
                            && "GRANTED_AUTHORITY_CREATION".equals(fact.attributes().get("mappingKind"))
                            && "<init>".equals(fact.attributes().get("apiName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "getAuthorities".equals(fact.attributes().get("apiName"))
                            && "AUTHORITY_MAPPING".equals(fact.type())));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("apiOwner", "").contains("OtherPrincipalLike")));
            assertFalse(result.facts().toString().contains("ROLE_TEST"));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "hasRole".equals(fact.attributes().get("apiName"))
                            || "hasAuthority".equals(fact.attributes().get("apiName"))));
        }
    }

    @Test
    void separatesSessionStatusFromPrincipalFactsAndPreservesGraphReferences() {
        try (AnnotationConfigApplicationContext context = context()) {
            CollectionContext collectionContext = new CollectionContext(context, "account", "instance");
            SessionUsageCollectorAdapter session = new SessionUsageCollectorAdapter();
            PrincipalUsageCollectorAdapter principal = new PrincipalUsageCollectorAdapter();
            CollectionReport collection = new CollectionProvider().execute(
                    collectionContext, List.of(session, principal));
            AnalysisReport report = new AnalysisReport(
                    collection, List.of(), collection.evidence(), Map.of(), List.of());
            SecurityGraph graph = new GraphBuilder().build("account", report);

            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get(session.id()));
            assertEquals(AnalysisStatus.READY, collection.statusByAdapter().get(principal.id()));
            assertTrue(collection.facts().stream().anyMatch(fact ->
                    "SESSION_USAGE".equals(fact.type())
                            && "AUTH_STATUS".equals(fact.attributes().get("operation"))));
            assertTrue(collection.facts().stream().anyMatch(fact ->
                    "PRINCIPAL_USAGE".equals(fact.type())
                            && "getName".equals(fact.attributes().get("apiName"))));
            assertEquals(collection.facts().size(), graph.nodes().size());
        }
    }

    @Test
    void doesNotTreatAuthorityLookupAsMappingWithoutConversionCode() {
        try (AnnotationConfigApplicationContext context = lookupOnlyContext()) {
            var result = new PrincipalUsageCollectorAdapter().collect(
                    new CollectionContext(context, "lookup-only", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "PRINCIPAL_USAGE".equals(fact.type())
                            && "getAuthorities".equals(fact.attributes().get("apiName"))));
            assertTrue(facts(result.facts(), "AUTHORITY_MAPPING").isEmpty());
        }
    }

    @Test
    void keepsUnsupportedContextReadyWithoutFacts() {
        try (AnnotationConfigApplicationContext context = emptyContext()) {
            var result = new PrincipalUsageCollectorAdapter().collect(
                    new CollectionContext(context, "empty", "instance"));

            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.facts().isEmpty());
            assertTrue(result.evidence().isEmpty());
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    private List<Fact> facts(List<Fact> facts, String type) {
        return facts.stream().filter(fact -> type.equals(fact.type())).toList();
    }

    private AnnotationConfigApplicationContext context() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(FixtureConfiguration.class);
        context.refresh();
        return context;
    }

    private AnnotationConfigApplicationContext emptyContext() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(EmptyConfiguration.class);
        context.refresh();
        return context;
    }

    private AnnotationConfigApplicationContext lookupOnlyContext() {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(LookupOnlyConfiguration.class);
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class FixtureConfiguration {

        @Bean
        PrincipalFixture principalFixture() {
            return new PrincipalFixture();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class EmptyConfiguration {
    }

    @Configuration(proxyBeanMethods = false)
    static class LookupOnlyConfiguration {

        @Bean
        AuthorityLookupFixture authorityLookupFixture() {
            return new AuthorityLookupFixture();
        }
    }

    @RestController
    static class PrincipalFixture {

        @GetMapping("/principal")
        void observe(
                @AuthenticationPrincipal Jwt jwt,
                Authentication authentication
        ) {
            jwt.getSubject();
            authentication.isAuthenticated();
            authentication.getPrincipal();
            authentication.getName();
            authentication.getAuthorities();
            SecurityContextHolder.getContext().getAuthentication();
            new SimpleGrantedAuthority("ROLE_TEST");
            new OtherPrincipalLike().getName();
            new Policy().hasRole("ROLE_TEST");
            new Policy().hasAuthority("ROLE_TEST");
        }
    }

    static class OtherPrincipalLike {

        String getName() {
            return "name";
        }
    }

    static class Policy {

        boolean hasRole(String role) {
            return role != null;
        }

        boolean hasAuthority(String authority) {
            return authority != null;
        }
    }

    static class AuthorityLookupFixture {

        void observe(Authentication authentication) {
            authentication.getAuthorities();
        }
    }
}
