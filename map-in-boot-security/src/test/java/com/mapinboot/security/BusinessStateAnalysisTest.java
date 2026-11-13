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
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
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
}
