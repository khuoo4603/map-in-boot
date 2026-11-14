package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.core.annotation.ProducesSecurityState;
import com.mapinboot.core.annotation.RequiresSecurityState;
import com.mapinboot.security.analyzer.BusinessStateAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.BusinessStateCollectorAdapter;
import com.mapinboot.security.finding.StateBypassFindingRule;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

class BusinessStateAnalysisTest {

    @Test
    void collectsDeclarationsAndConnectsThemToRealHandlers() {
        try (AnnotationConfigApplicationContext context = context(FixtureConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "fixture", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new BusinessStateCollectorAdapter()));

            List<Fact> states = collection.facts().stream()
                    .filter(fact -> "BUSINESS_SECURITY_STATE".equals(fact.type()))
                    .toList();
            assertEquals(2, states.size());
            assertTrue(states.stream().anyMatch(fact ->
                    "REQUIRES".equals(fact.attributes().get("stateAction"))
                            && "identity_verified".equals(fact.attributes().get("stateName"))
                            && "verified".equals(fact.attributes().get("claim"))));
            assertTrue(states.stream().anyMatch(fact ->
                    "PRODUCES".equals(fact.attributes().get("stateAction"))
                            && "identity_verified".equals(fact.attributes().get("stateName"))
                            && !fact.attributes().containsKey("claim")));
            assertTrue(states.stream().allMatch(fact -> !fact.evidenceIds().isEmpty()));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "fixture"), List.of(new BusinessStateAnalysisAdapter()));
            assertEquals(2, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.SECURITY_STATE)
                    .count());
            assertTrue(analysis.relations().stream().anyMatch(relation ->
                    "REQUIRES".equals(relation.attributes().get("stateAction"))));
            assertTrue(analysis.relations().stream().anyMatch(relation ->
                    "PRODUCES".equals(relation.attributes().get("stateAction"))));
            assertTrue(analysis.relations().stream().allMatch(relation ->
                    !relation.attributes().containsKey("enforcement")));

            SecurityGraph graph = new GraphBuilder().build("fixture", analysis);
            assertNotNull(graph);
            assertEquals(2, graph.edges().stream()
                    .filter(edge -> edge.type() == EdgeType.SECURITY_STATE)
                    .count());

            Snapshot snapshot = new SnapshotAssembler(List.of(), "1")
                    .assemble(analysis, "fixture", "instance", "test");
            assertEquals(2, snapshot.edges().stream()
                    .filter(edge -> edge.type() == EdgeType.SECURITY_STATE)
                    .count());
            assertTrue(snapshot.analysisStatus().containsKey(new BusinessStateAnalysisAdapter().id()));
        }
    }

    @Test
    void registersBusinessStateAdapters() {
        try (AnnotationConfigApplicationContext context = context(
                FixtureConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(BusinessStateCollectorAdapter.class).size());
            assertEquals(1, context.getBeansOfType(BusinessStateAnalysisAdapter.class).size());
        }
    }

    @Test
    void evaluatesCompiledStateChecksAndBypassPaths() {
        try (AnnotationConfigApplicationContext context = context(LoanFixtureConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "fixture", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new BusinessStateCollectorAdapter()));

            List<Fact> evaluations = collection.facts().stream()
                    .filter(fact -> "BUSINESS_STATE_EVALUATION".equals(fact.type()))
                    .toList();
            assertEquals(2, evaluations.size());
            assertTrue(evaluations.stream().anyMatch(fact ->
                    "ENFORCED".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(evaluations.stream().anyMatch(fact ->
                    "BYPASS_PATH".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(evaluations.stream().allMatch(fact ->
                    "COMPLETE_SUPPORTED_PATH".equals(fact.attributes().get("coverage"))));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "fixture"),
                    List.of(new BusinessStateAnalysisAdapter()));
            SecurityGraph graph = new GraphBuilder().build("fixture", analysis);
            assertTrue(graph.nodes().stream().anyMatch(node ->
                    "BUSINESS_STATE_EVALUATION".equals(node.attributes().get("factType"))));

            var findings = new StateBypassFindingRule().evaluate(analysis);
            assertEquals(1, findings.size());
            assertEquals("STATE_BYPASS", findings.get(0).ruleId());
            assertTrue(findings.get(0).evidenceIds().stream()
                    .allMatch(id -> analysis.evidence().stream().anyMatch(item -> item.id().equals(id))));
        }
    }

    @Test
    void doesNotTreatUnreturnedOrUnresolvedStateChecksAsEnforced() {
        try (AnnotationConfigApplicationContext context = context(StateBoundaryConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "state-boundary", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new BusinessStateCollectorAdapter()));

            List<Fact> evaluations = collection.facts().stream()
                    .filter(fact -> "BUSINESS_STATE_EVALUATION".equals(fact.type()))
                    .toList();
            assertEquals(4, evaluations.size());
            assertTrue(evaluations.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("discardedForbidden")
                            && "BYPASS_PATH".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(evaluations.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("ignoredComparison")
                            && "BYPASS_PATH".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(evaluations.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("businessFirst")
                            && "BYPASS_PATH".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(evaluations.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("externalVerification")
                            && "UNRESOLVED".equals(fact.attributes().get("pathOutcome"))
                            && "INCOMPLETE".equals(fact.attributes().get("coverage"))));
            assertTrue(evaluations.stream().noneMatch(fact ->
                    "ENFORCED".equals(fact.attributes().get("pathOutcome"))));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "state-boundary"),
                    List.of(new BusinessStateAnalysisAdapter()));
            assertEquals(3, new StateBypassFindingRule().evaluate(analysis).size());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configurations);
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class FixtureConfiguration {
        @Bean
        StateController stateController() {
            return new StateController();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class LoanFixtureConfiguration {
        @Bean
        LoanStateController loanStateController() {
            return new LoanStateController(new LoanRepository());
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class StateBoundaryConfiguration {
        @Bean
        StateBoundaryController stateBoundaryController() {
            return new StateBoundaryController(new LoanRepository(), new ExternalStateVerifier());
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @RestController
    static class StateController {
        @GetMapping("/state/required")
        @RequiresSecurityState(value = "identity_verified", claim = "verified")
        public ResponseEntity<Void> required() {
            return ResponseEntity.ok().build();
        }

        @GetMapping("/state/produced")
        @ProducesSecurityState("identity_verified")
        public ResponseEntity<Void> produced() {
            return ResponseEntity.ok().build();
        }
    }

    @RestController
    static class LoanStateController {
        private final LoanRepository repository;

        LoanStateController(LoanRepository repository) {
            this.repository = repository;
        }

        @PostMapping("/loan/normal")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> normal(Jwt jwt) {
            if (!isIdentityVerified(jwt)) {
                return denied();
            }
            return submit();
        }

        @PostMapping("/loan/bypass")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> bypass(Jwt jwt) {
            if (jwt == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            return submit();
        }

        private boolean isIdentityVerified(Jwt jwt) {
            return Boolean.TRUE.equals(jwt.getClaims().get("identity_verified"));
        }

        private ResponseEntity<Void> denied() {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        private ResponseEntity<Void> submit() {
            repository.save();
            return ResponseEntity.status(HttpStatus.CREATED).build();
        }
    }

    @RestController
    static class StateBoundaryController {
        private final LoanRepository repository;
        private final ExternalStateVerifier stateVerifier;

        StateBoundaryController(LoanRepository repository, ExternalStateVerifier stateVerifier) {
            this.repository = repository;
            this.stateVerifier = stateVerifier;
        }

        @PostMapping("/state-boundary/discarded")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> discardedForbidden(Jwt jwt) {
            if (!isIdentityVerified(jwt)) {
                ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return submit();
        }

        @PostMapping("/state-boundary/ignored")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> ignoredComparison(Jwt jwt) {
            Boolean.TRUE.equals(jwt.getClaims().get("identity_verified"));
            return submit();
        }

        @PostMapping("/state-boundary/first")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> businessFirst(Jwt jwt) {
            ResponseEntity<Void> result = submit();
            if (!isIdentityVerified(jwt)) {
                return denied();
            }
            return result;
        }

        @PostMapping("/state-boundary/external")
        @RequiresSecurityState(value = "identity_verified", claim = "identity_verified")
        ResponseEntity<Void> externalVerification(Jwt jwt) {
            if (!stateVerifier.isVerified(jwt)) {
                return denied();
            }
            return submit();
        }

        private boolean isIdentityVerified(Jwt jwt) {
            return Boolean.TRUE.equals(jwt.getClaims().get("identity_verified"));
        }

        private ResponseEntity<Void> denied() {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        private ResponseEntity<Void> submit() {
            repository.save();
            return ResponseEntity.status(HttpStatus.CREATED).build();
        }
    }

    static class ExternalStateVerifier {
        boolean isVerified(Jwt jwt) {
            return false;
        }
    }

    static class LoanRepository {
        void save() {
        }
    }
}
