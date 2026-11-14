package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.annotation.RequiresObjectAuthorization;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.analyzer.AuthorizationAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.HeaderUsageCollectorAdapter;
import com.mapinboot.security.collector.JwtUsageCollectorAdapter;
import com.mapinboot.security.collector.ObjectAuthorizationCollectorAdapter;
import com.mapinboot.security.collector.PrincipalUsageCollectorAdapter;
import com.mapinboot.security.finding.ObjectBindingFindingRule;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

class ObjectAuthorizationAnalysisTest {

    @Test
    void connectsDirectAndHelperObjectChecksToActualGraphNodes() {
        try (AnnotationConfigApplicationContext context = context(FixtureConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "fixture", "instance"),
                    List.of(
                            new EndpointMappingCollectorAdapter(),
                            new JwtUsageCollectorAdapter(),
                            new HeaderUsageCollectorAdapter(),
                            new PrincipalUsageCollectorAdapter(),
                            new ObjectAuthorizationCollectorAdapter()));

            List<Fact> objectFacts = collection.facts().stream()
                    .filter(fact -> "OBJECT_AUTHORIZATION".equals(fact.type()))
                    .toList();
            assertEquals(5, objectFacts.size(), () -> objectFacts + " diagnostics=" + collection.diagnostics());
            assertTrue(objectFacts.stream().anyMatch(fact ->
                    "OWNER_MATCH_WITH_DENY".equals(fact.attributes().get("checkKind"))
                            && "JWT_SUBJECT".equals(fact.attributes().get("credentialSource"))));
            assertTrue(objectFacts.stream().anyMatch(fact ->
                    "OWNER_MATCH_WITH_DENY".equals(fact.attributes().get("checkKind"))
                            && "AUTHENTICATION_NAME".equals(fact.attributes().get("credentialSource"))));
            assertTrue(objectFacts.stream().anyMatch(fact ->
                    "ASSIGNMENT_DENY".equals(fact.attributes().get("checkKind"))
                            && "JWT_SUBJECT".equals(fact.attributes().get("credentialSource"))));
            assertTrue(objectFacts.stream().anyMatch(fact ->
                    "ASSIGNMENT_DENY".equals(fact.attributes().get("checkKind"))
                            && "REQUEST_HEADER".equals(fact.attributes().get("credentialSource"))));
            assertTrue(objectFacts.stream().anyMatch(fact ->
                    "OWNER_MATCH_WITH_DENY".equals(fact.attributes().get("checkKind"))
                            && "REQUEST_HEADER".equals(fact.attributes().get("credentialSource"))));

            assertFalse(objectFacts.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("unsecured")));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "fixture"), List.of(new AuthorizationAnalysisAdapter()));
            assertEquals(5, analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.SECURED_BY)
                    .count());
            assertTrue(analysis.relations().stream()
                    .anyMatch(relation -> relation.type() == EdgeType.USES_FOR_AUTHORIZATION));
            assertTrue(analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.USES_FOR_AUTHORIZATION)
                    .anyMatch(relation -> "JWT_SUBJECT".equals(relation.attributes().get("credentialSource"))));
            assertTrue(analysis.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.USES_FOR_AUTHORIZATION)
                    .anyMatch(relation -> "REQUEST_HEADER".equals(relation.attributes().get("credentialSource"))));

            SecurityGraph graph = new GraphBuilder().build("fixture", analysis);
            assertNotNull(graph);
            assertEquals(5, graph.edges().stream()
                    .filter(edge -> edge.type() == EdgeType.SECURED_BY)
                    .count());
            assertTrue(graph.edges().stream()
                    .anyMatch(edge -> edge.type() == EdgeType.USES_FOR_AUTHORIZATION));
        }
    }

    @Test
    void registersObjectAdaptersWithoutChangingExistingRuleEngine() {
        try (AnnotationConfigApplicationContext context = context(
                FixtureConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(ObjectAuthorizationCollectorAdapter.class).size());
            assertEquals(1, context.getBeansOfType(AuthorizationAnalysisAdapter.class).size());
        }
    }

    @Test
    void evaluatesDeclaredObjectBindingRequirementAgainstCompiledAccessPaths() {
        try (AnnotationConfigApplicationContext context = context(FixtureConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "fixture", "instance"),
                    List.of(
                            new EndpointMappingCollectorAdapter(),
                            new JwtUsageCollectorAdapter(),
                            new HeaderUsageCollectorAdapter(),
                            new PrincipalUsageCollectorAdapter(),
                            new ObjectAuthorizationCollectorAdapter()));

            List<Fact> requirements = collection.facts().stream()
                    .filter(fact -> "OBJECT_AUTHORIZATION_REQUIREMENT".equals(fact.type()))
                    .toList();
            assertEquals(2, requirements.size());
            assertTrue(requirements.stream().allMatch(fact ->
                    "OWNER".equals(fact.attributes().get("requirementKind"))
                            && Account.class.getName().equals(fact.attributes().get("resourceType"))
                            && "JWT_SUBJECT".equals(fact.attributes().get("principalSource"))));

            List<Fact> paths = collection.facts().stream()
                    .filter(fact -> "OBJECT_ACCESS_PATH".equals(fact.type()))
                    .toList();
            assertEquals(2, paths.size());
            assertTrue(paths.stream().anyMatch(fact -> "GUARDED".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(paths.stream().anyMatch(fact -> "UNGUARDED".equals(fact.attributes().get("pathOutcome"))));
            assertTrue(paths.stream().allMatch(fact ->
                    "COMPLETE_SUPPORTED_PATH".equals(fact.attributes().get("coverage"))));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "fixture"),
                    List.of(new AuthorizationAnalysisAdapter()));
            SecurityGraph graph = new GraphBuilder().build("fixture", analysis);
            assertTrue(graph.nodes().stream().anyMatch(node ->
                    "OBJECT_AUTHORIZATION_REQUIREMENT".equals(node.attributes().get("factType"))));
            assertTrue(graph.nodes().stream().anyMatch(node ->
                    "OBJECT_ACCESS_PATH".equals(node.attributes().get("factType"))));

            var findings = new ObjectBindingFindingRule().evaluate(analysis);
            assertEquals(1, findings.size());
            assertEquals("OBJECT_BINDING", findings.get(0).ruleId());
            assertTrue(findings.get(0).evidenceIds().stream()
                    .allMatch(id -> analysis.evidence().stream().anyMatch(item -> item.id().equals(id))));
        }
    }

    @Test
    void doesNotConfirmObjectBindingOutsideCompleteProtectedAccess() {
        try (AnnotationConfigApplicationContext context = context(PathBoundaryConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "boundary", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new ObjectAuthorizationCollectorAdapter()));

            List<Fact> paths = collection.facts().stream()
                    .filter(fact -> "OBJECT_ACCESS_PATH".equals(fact.type()))
                    .toList();
            assertTrue(paths.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("calculatedOnly")
                            && "UNRESOLVED".equals(fact.attributes().get("pathOutcome"))
                            && "INCOMPLETE".equals(fact.attributes().get("coverage"))));
            assertTrue(paths.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("discardedForbidden")
                            && "UNRESOLVED".equals(fact.attributes().get("pathOutcome"))
                            && "INCOMPLETE".equals(fact.attributes().get("coverage"))));
            assertTrue(paths.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("delegated")
                            && "UNRESOLVED".equals(fact.attributes().get("pathOutcome"))
                            && "INCOMPLETE".equals(fact.attributes().get("coverage"))));
            assertTrue(paths.stream().anyMatch(fact ->
                    fact.attributes().getOrDefault("handler", "").contains("conditionalOwnerCheck")
                            && "UNRESOLVED".equals(fact.attributes().get("pathOutcome"))
                            && "INCOMPLETE".equals(fact.attributes().get("coverage"))));

            AnalysisReport analysis = new AnalysisProvider().execute(
                    new AnalysisContext(collection, "boundary"), List.of(new AuthorizationAnalysisAdapter()));
            assertTrue(new ObjectBindingFindingRule().evaluate(analysis).isEmpty());
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
        FixtureController fixtureController() {
            return new FixtureController(accountRepository(), profileRepository(), assignmentService());
        }

        @Bean
        AccountRepository accountRepository() {
            return new AccountRepository();
        }

        @Bean
        ProfileRepository profileRepository() {
            return new ProfileRepository();
        }

        @Bean
        AssignmentService assignmentService() {
            return new AssignmentService();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class PathBoundaryConfiguration {

        @Bean
        PathBoundaryController pathBoundaryController() {
            return new PathBoundaryController(new BoundaryRepository(), new BoundaryAuditService());
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @RestController
    static class FixtureController {
        private final AccountRepository accountRepository;
        private final ProfileRepository profileRepository;
        private final AssignmentService assignmentService;

        FixtureController(
                AccountRepository accountRepository,
                ProfileRepository profileRepository,
                AssignmentService assignmentService) {
            this.accountRepository = accountRepository;
            this.profileRepository = profileRepository;
            this.assignmentService = assignmentService;
        }

        @RequestMapping(path = "/accounts/{id}/secured", method = RequestMethod.GET)
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> securedJwt(@PathVariable String id, Jwt jwt) {
            if (jwt == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            Account account = accountRepository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            if (!account.getOwnerId().equals(jwt.getSubject())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(account);
        }

        @GetMapping("/accounts/{id}/unsecured")
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> unsecuredJwt(@PathVariable String id, Jwt jwt) {
            if (jwt == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            Account account = accountRepository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(account);
        }

        @GetMapping("/profiles/{id}/secured")
        ResponseEntity<?> securedSession(@PathVariable String id, Authentication authentication) {
            if (authentication == null || !authentication.isAuthenticated()) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            Profile profile = profileRepository.findById(id).orElse(null);
            if (profile == null) {
                return ResponseEntity.notFound().build();
            }
            if (!profile.getUserId().equals(authentication.getName())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(profile);
        }

        @GetMapping("/profiles/{id}/unsecured")
        ResponseEntity<?> unsecuredSession(@PathVariable String id, Authentication authentication) {
            if (authentication == null || !authentication.isAuthenticated()) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            Profile profile = profileRepository.findById(id).orElse(null);
            if (profile == null) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(profile);
        }

        @GetMapping("/customers/{id}/jwt-assignment")
        ResponseEntity<?> jwtAssignment(@PathVariable String id, Jwt jwt) {
            return contact(id, jwt.getSubject());
        }

        @GetMapping("/customers/{id}/header-assignment")
        ResponseEntity<?> headerAssignment(
                @PathVariable String id,
                @RequestHeader(name = "X-Staff-Id", required = false) String staffId) {
            return contact(id, staffId);
        }

        private ResponseEntity<?> contact(String id, String staffId) {
            if (!assignmentService.isAssigned(staffId, id)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(Map.of("id", id));
        }

        @GetMapping("/accounts/{id}/header-owner")
        ResponseEntity<?> securedHeaderOwner(
                @PathVariable String id,
                @RequestHeader("X-Authenticated-User") String userId) {
            Account account = accountRepository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            if (!account.getOwnerId().equals(userId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(account);
        }
    }

    static class AccountRepository {
        Optional<Account> findById(String id) {
            return Optional.empty();
        }
    }

    static class ProfileRepository {
        Optional<Profile> findById(String id) {
            return Optional.empty();
        }
    }

    static class AssignmentService {
        boolean isAssigned(String staffId, String customerId) {
            return false;
        }
    }

    @RestController
    static class PathBoundaryController {
        private final BoundaryRepository repository;
        private final BoundaryAuditService auditService;

        PathBoundaryController(BoundaryRepository repository, BoundaryAuditService auditService) {
            this.repository = repository;
            this.auditService = auditService;
        }

        @GetMapping("/boundary/{id}/calculated")
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> calculatedOnly(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            String owner = account.getOwnerId();
            return ResponseEntity.ok(owner + jwt.getSubject());
        }

        @GetMapping("/boundary/{id}/discarded")
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> discardedForbidden(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            if (!account.getOwnerId().equals(jwt.getSubject())) {
                ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(account);
        }

        @GetMapping("/boundary/{id}/delegated")
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> delegated(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            auditService.inspect(account);
            return ResponseEntity.ok(account);
        }

        @GetMapping("/boundary/{id}/conditional")
        @RequiresObjectAuthorization(
                kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> conditionalOwnerCheck(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            if (account == null) {
                return ResponseEntity.notFound().build();
            }
            if (id.startsWith("checked") && !account.getOwnerId().equals(jwt.getSubject())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(account);
        }
    }

    static class BoundaryRepository {
        Optional<Account> findById(String id) {
            return Optional.of(new Account("owner"));
        }
    }

    static class BoundaryAuditService {
        void inspect(Account account) {
            account.getOwnerId();
        }
    }

    record Account(String ownerId) {
        String getOwnerId() {
            return ownerId;
        }
    }

    record Profile(String userId) {
        String getUserId() {
            return userId;
        }
    }
}
