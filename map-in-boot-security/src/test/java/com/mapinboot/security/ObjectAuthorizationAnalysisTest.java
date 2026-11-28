package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertAll;

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
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.security.analyzer.AuthorizationAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.HeaderUsageCollectorAdapter;
import com.mapinboot.security.collector.JwtUsageCollectorAdapter;
import com.mapinboot.security.collector.ObjectAuthorizationCollectorAdapter;
import com.mapinboot.security.collector.PrincipalUsageCollectorAdapter;
import com.mapinboot.security.finding.ObjectBindingFindingRule;
import com.mapinboot.security.finding.SecurityRuleEngine;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.io.InputStream;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
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
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
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
            assertTrue(paths.stream().anyMatch(fact -> "GUARDED".equals(fact.attributes().get("pathOutcome"))),
                    () -> paths.toString());
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

            var integratedFindings = new SecurityRuleEngine().evaluate(analysis);
            assertEquals(1, integratedFindings.stream()
                    .filter(finding -> "OBJECT_BINDING".equals(finding.ruleId()))
                    .count());

            Snapshot snapshot = new SnapshotAssembler(List.of(new SecurityRuleEngine()))
                    .assemble(analysis, "fixture", "instance", "test", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
            assertEquals(1, snapshot.findings().stream()
                    .filter(finding -> "OBJECT_BINDING".equals(finding.ruleId()))
                    .count());
            assertTrue(snapshot.findings().stream()
                    .flatMap(finding -> finding.evidenceIds().stream())
                    .allMatch(id -> snapshot.evidence().stream().anyMatch(item -> item.id().equals(id))));
            var objectFinding = snapshot.findings().stream()
                    .filter(finding -> "OBJECT_BINDING".equals(finding.ruleId()))
                    .findFirst().orElseThrow();
            assertEquals(2, objectFinding.nodeIds().size());
            assertTrue(objectFinding.nodeIds().stream()
                    .allMatch(id -> snapshot.nodes().stream().anyMatch(node -> node.id().equals(id))));
            assertTrue(objectFinding.edgeIds().isEmpty());
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

    @Test
    void followsConcreteServiceAndRepositoryOwnershipCheck() {
        try (AnnotationConfigApplicationContext context = context(InterClassConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "inter-class", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new JwtUsageCollectorAdapter(),
                            new ObjectAuthorizationCollectorAdapter()));

            List<Fact> checks = collection.facts().stream()
                    .filter(fact -> "OBJECT_AUTHORIZATION".equals(fact.type()))
                    .toList();
            assertTrue(checks.stream().anyMatch(fact ->
                    "OWNER_MATCH_WITH_DENY".equals(fact.attributes().get("checkKind"))
                            && "JWT_SUBJECT".equals(fact.attributes().get("credentialSource"))
                            && fact.attributes().get("codeLocation").contains("InterClassService#fetch")));
            assertTrue(checks.stream().flatMap(fact -> fact.evidenceIds().stream())
                    .allMatch(id -> collection.evidence().stream().anyMatch(item -> item.id().equals(id))));
        }
    }

    @Test
    void confirmsOnlyFailClosedSameResourceServiceChecks() {
        try (AnnotationConfigApplicationContext context = context(CrossClassBoundaryConfiguration.class)) {
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "cross-class-boundary", "instance"),
                    List.of(new EndpointMappingCollectorAdapter(), new ObjectAuthorizationCollectorAdapter()));

            assertAll(
                    () -> assertCrossClassPath(collection, "checkedAndDenied", "GUARDED"),
                    () -> assertCrossClassPath(collection, "ignoredDecision", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "conditionallyChecked", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "checkedDifferentObject", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "partiallyProtectedMultiple", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "sameDescriptorForwarding", "GUARDED"),
                    () -> assertCrossClassPath(collection, "finalReceiverState", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "depthLimitedCheck", "UNRESOLVED"),
                    () -> assertCrossClassPath(collection, "unknownDispatch", "UNRESOLVED"));
            assertCrossClassPath(collection, "unrelatedOptional", "UNGUARDED");
            assertTrue(collection.facts().stream().anyMatch(fact ->
                    "OBJECT_AUTHORIZATION".equals(fact.type())
                            && fact.attributes().get("codeLocation").contains("CrossClassService#deniedResponse")),
                    "하위 Service의 실제 거부 근거 보존");
            List<Fact> partialCheckFacts = collection.facts().stream()
                    .filter(fact -> "OBJECT_AUTHORIZATION".equals(fact.type()))
                    .filter(fact -> fact.attributes().getOrDefault("handler", "")
                            .contains("#partiallyProtectedMultiple("))
                    .toList();
            assertEquals(1, partialCheckFacts.size(), () -> partialCheckFacts.toString());
            assertFalse(partialCheckFacts.get(0).evidenceIds().isEmpty());
            assertTrue(partialCheckFacts.get(0).evidenceIds().stream()
                    .allMatch(id -> collection.evidence().stream().anyMatch(item -> item.id().equals(id))));
        }
    }

    @Test
    void analyzesRegisteredExternalHandlersOnlyWhenAuthorizationIsDeclared(@TempDir Path temporaryDirectory)
            throws Exception {
        Path externalJar = temporaryDirectory.resolve(
                ".gradle/caches/modules-2/files-2.1/fixture/handlers/1/handlers.jar");
        Files.createDirectories(externalJar.getParent());
        try (JarOutputStream jar = new JarOutputStream(Files.newOutputStream(externalJar))) {
            for (Class<?> fixture : List.of(
                    com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures.class,
                    com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures.Resource.class,
                    com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures.ResourceRepository.class,
                    com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures.AuthorizedHandler.class,
                    com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures.OrdinaryHandler.class)) {
                String entryName = fixture.getName().replace('.', '/') + ".class";
                jar.putNextEntry(new JarEntry(entryName));
                try (InputStream input = fixture.getResourceAsStream("/" + entryName)) {
                    assertNotNull(input);
                    input.transferTo(jar);
                }
                jar.closeEntry();
            }
        }

        try (URLClassLoader externalLoader = new URLClassLoader(new java.net.URL[]{externalJar.toUri().toURL()},
                getClass().getClassLoader()) {
            @Override
            protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                if (name.startsWith("com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures")) {
                    synchronized (getClassLoadingLock(name)) {
                        Class<?> loaded = findLoadedClass(name);
                        if (loaded == null) {
                            loaded = findClass(name);
                        }
                        if (resolve) {
                            resolveClass(loaded);
                        }
                        return loaded;
                    }
                }
                return super.loadClass(name, resolve);
            }

            @Override
            public java.net.URL getResource(String name) {
                if (name.startsWith("com/mapinboot/security/externalfixture/ExternalAuthorizationFixtures")
                        && name.endsWith(".class")) {
                    return findResource(name);
                }
                return super.getResource(name);
            }
        }) {
            String authorizedName = "com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures$AuthorizedHandler";
            String ordinaryName = "com.mapinboot.security.externalfixture.ExternalAuthorizationFixtures$OrdinaryHandler";
            Class<?> authorizedType = Class.forName(authorizedName, true, externalLoader);
            Class<?> ordinaryType = Class.forName(ordinaryName, true, externalLoader);
            assertTrue(authorizedType.getResource("/" + authorizedName.replace('.', '/') + ".class")
                    .toExternalForm().contains("handlers.jar"));

            try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
                context.registerBean(RequestMappingHandlerMapping.class);
                context.refresh();
                Object authorized = authorizedType.getConstructor().newInstance();
                Object ordinary = ordinaryType.getConstructor().newInstance();
                context.getBeanFactory().registerSingleton("externalAuthorizedHandler", authorized);
                context.getBeanFactory().registerSingleton("externalOrdinaryHandler", ordinary);
                RequestMappingHandlerMapping mapping = context.getBean(RequestMappingHandlerMapping.class);
                mapping.registerMapping(RequestMappingInfo.paths("/external/authorized")
                        .methods(RequestMethod.GET).build(), authorized,
                        authorizedType.getMethod("authorize",
                                String.class,
                                Jwt.class));
                mapping.registerMapping(RequestMappingInfo.paths("/external/ordinary")
                        .methods(RequestMethod.GET).build(), ordinary, ordinaryType.getMethod("handle"));

                CollectionReport collection = new CollectionProvider().execute(
                        new CollectionContext(context, "external-handler", "instance"),
                        List.of(new EndpointMappingCollectorAdapter(), new ObjectAuthorizationCollectorAdapter()));
                List<Fact> authorizedFacts = collection.facts().stream()
                        .filter(fact -> fact.attributes().getOrDefault("handler", "").contains("AuthorizedHandler#"))
                        .toList();
                assertTrue(authorizedFacts.stream().anyMatch(fact ->
                        "OBJECT_AUTHORIZATION_REQUIREMENT".equals(fact.type())));
                assertTrue(authorizedFacts.stream().anyMatch(fact ->
                        "OBJECT_AUTHORIZATION".equals(fact.type())
                                && "getOwnerId".equals(fact.attributes().get("ownerGetter"))),
                        () -> "facts=" + collection.facts() + "; diagnostics=" + collection.diagnostics());
                assertFalse(collection.facts().stream().anyMatch(fact ->
                        fact.attributes().getOrDefault("handler", "").contains("OrdinaryHandler#")
                                && "OBJECT_AUTHORIZATION_REQUIREMENT".equals(fact.type())));
            }
        }
    }

    private void assertCrossClassPath(CollectionReport collection, String method, String expected) {
        List<Fact> paths = collection.facts().stream()
                .filter(fact -> "OBJECT_ACCESS_PATH".equals(fact.type()))
                .filter(fact -> fact.attributes().getOrDefault("handler", "").contains("#" + method + "("))
                .toList();
        assertEquals(1, paths.size(), () -> method + " paths=" + paths);
        assertEquals(expected, paths.get(0).attributes().get("pathOutcome"),
                () -> method + " path=" + paths.get(0) + " diagnostics=" + collection.diagnostics());
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

    @Configuration(proxyBeanMethods = false)
    static class InterClassConfiguration {

        @Bean
        InterClassController interClassController() {
            return new InterClassController(new InterClassService(new InterClassRepository()));
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @RestController
    static final class InterClassController {
        private final InterClassService service;

        InterClassController(InterClassService service) {
            this.service = service;
        }

        @GetMapping("/accounts/{id}/inter-class")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = LayeredAccount.class,
                principalSource = "JWT_SUBJECT")
        ResponseEntity<?> handle(@PathVariable String id, Jwt jwt) {
            return ResponseEntity.ok(service.fetch(id, jwt));
        }
    }

    static final class InterClassService {
        private final InterClassRepository repository;

        InterClassService(InterClassRepository repository) {
            this.repository = repository;
        }

        LayeredAccount fetch(String id, Jwt jwt) {
            LayeredAccount account = repository.findById(id).orElse(null);
            if (account == null) {
                return null;
            }
            if (!account.getOwnerId().equals(jwt.getSubject())) {
                throw new org.springframework.security.access.AccessDeniedException("denied");
            }
            return account;
        }
    }

    static final class InterClassRepository {
        Optional<LayeredAccount> findById(String id) {
            return Optional.of(new LayeredAccount("owner"));
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class CrossClassBoundaryConfiguration {

        @Bean
        CrossClassBoundaryController crossClassBoundaryController() {
            CrossClassRepository repository = new CrossClassRepository();
            CrossClassService service = new CrossClassService();
            return new CrossClassBoundaryController(repository, service, service,
                    new CrossClassForwarder(), new CrossClassLevelOne(), new CrossClassUnrelatedLookupImpl(),
                    new CrossClassProtectedAccessImpl());
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping() {
            return new RequestMappingHandlerMapping();
        }
    }

    @RestController
    static class CrossClassBoundaryController {
        private final CrossClassRepository repository;
        private final CrossClassService service;
        private final CrossClassGate gate;
        private final CrossClassForwarder forwarder;
        private final CrossClassFinalStateService finalStateService;
        private final CrossClassLevelOne levelOne;
        private final CrossClassUnrelatedLookup unrelatedLookup;
        private final CrossClassProtectedAccess protectedAccess;

        CrossClassBoundaryController(CrossClassRepository repository, CrossClassService service, CrossClassGate gate,
                                     CrossClassForwarder forwarder, CrossClassLevelOne levelOne,
                                     CrossClassUnrelatedLookup unrelatedLookup,
                                     CrossClassProtectedAccess protectedAccess) {
            this.repository = repository;
            this.service = service;
            this.gate = gate;
            this.forwarder = forwarder;
            this.finalStateService = new CrossClassFinalStateService(true);
            this.levelOne = levelOne;
            this.unrelatedLookup = unrelatedLookup;
            this.protectedAccess = protectedAccess;
        }

        @GetMapping("/cross-class/safe/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> checkedAndDenied(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            service.requireOwned(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/ignored/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> ignoredDecision(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            service.deniedResponse(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/conditional/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> conditionallyChecked(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            if (id.startsWith("check")) {
                service.requireOwned(account, jwt.getSubject());
            }
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/different/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> checkedDifferentObject(@PathVariable String id, Jwt jwt) {
            Account target = repository.findById(id).orElse(null);
            Account checked = repository.findById("different").orElse(null);
            service.requireOwned(checked, jwt.getSubject());
            return ResponseEntity.ok(target);
        }

        @GetMapping("/cross-class/partially-protected-multiple/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> partiallyProtectedMultiple(@PathVariable String id, Jwt jwt) {
            Account checked = repository.findById(id).orElse(null);
            Account unchecked = repository.findById("other").orElse(null);
            service.requireOwned(checked, jwt.getSubject());
            protectedAccess.save(checked);
            protectedAccess.save(unchecked);
            return ResponseEntity.ok(unchecked);
        }

        @GetMapping("/cross-class/unknown/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> unknownDispatch(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            gate.requireOwned(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/same-descriptor/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> sameDescriptorForwarding(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            forwarder.requireOwned(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/final-receiver/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> finalReceiverState(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            finalStateService.requireOwned(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/depth-limited/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> depthLimitedCheck(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            levelOne.requireOwned(account, jwt.getSubject());
            return ResponseEntity.ok(account);
        }

        @GetMapping("/cross-class/unrelated-optional/{id}")
        @RequiresObjectAuthorization(kind = "OWNER", resourceType = Account.class, principalSource = "JWT_SUBJECT")
        ResponseEntity<?> unrelatedOptional(@PathVariable String id, Jwt jwt) {
            Account account = repository.findById(id).orElse(null);
            unrelatedLookup.findAlias(id);
            return ResponseEntity.ok(account);
        }
    }

    static final class CrossClassRepository {
        Optional<Account> findById(String id) {
            return Optional.of(new Account("owner"));
        }

    }

    interface CrossClassProtectedAccess {
        void save(Account account);
    }

    static final class CrossClassProtectedAccessImpl implements CrossClassProtectedAccess {
        @Override
        public void save(Account account) {
        }
    }

    static final class CrossClassService implements CrossClassGate {
        @Override
        public void requireOwned(Account account, String subject) {
            if (!account.getOwnerId().equals(subject)) {
                throw new org.springframework.security.access.AccessDeniedException("denied");
            }
        }

        ResponseEntity<?> deniedResponse(Account account, String subject) {
            if (!account.getOwnerId().equals(subject)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
            return ResponseEntity.ok(account);
        }
    }

    interface CrossClassGate {
        void requireOwned(Account account, String subject);
    }

    static final class CrossClassForwarder {
        private final CrossClassService service = new CrossClassService();

        void requireOwned(Account account, String subject) {
            service.requireOwned(account, subject);
        }
    }

    static final class CrossClassFinalStateService {
        private final boolean enforcementEnabled;

        CrossClassFinalStateService(boolean enforcementEnabled) {
            this.enforcementEnabled = enforcementEnabled;
        }

        void requireOwned(Account account, String subject) {
            if (!enforcementEnabled) {
                return;
            }
            if (!account.getOwnerId().equals(subject)) {
                throw new org.springframework.security.access.AccessDeniedException("denied");
            }
        }
    }

    static final class CrossClassLevelOne {
        private final CrossClassLevelTwo next = new CrossClassLevelTwo();

        void requireOwned(Account account, String subject) {
            next.requireOwned(account, subject);
        }
    }

    static final class CrossClassLevelTwo {
        private final CrossClassService service = new CrossClassService();

        void requireOwned(Account account, String subject) {
            service.requireOwned(account, subject);
        }
    }

    interface CrossClassUnrelatedLookup {
        Optional<String> findAlias(String id);
    }

    static final class CrossClassUnrelatedLookupImpl implements CrossClassUnrelatedLookup {
        @Override
        public Optional<String> findAlias(String id) {
            return Optional.of(id);
        }
    }

    record LayeredAccount(String ownerId) {
        String getOwnerId() {
            return ownerId;
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
