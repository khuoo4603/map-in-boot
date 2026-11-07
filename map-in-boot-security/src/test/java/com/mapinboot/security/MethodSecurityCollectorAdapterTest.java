package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.MethodSecurityCollectorAdapter;
import jakarta.annotation.security.RolesAllowed;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.security.access.annotation.Secured;
import org.springframework.security.access.prepost.PostAuthorize;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

class MethodSecurityCollectorAdapterTest {

    @Test
    void collectsSupportedDeclarationsWithAdvisorAndProxyEvidence() {
        try (AnnotationConfigApplicationContext context = context(EnabledMethodSecurityConfiguration.class)) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            Map<String, Fact> factsByKind = result.facts().stream()
                    .filter(fact -> List.of(
                            "#find(java.lang.String)",
                            "#postCheck()",
                            "#secured()",
                            "#roleAllowed()")
                            .stream().anyMatch(suffix -> fact.attributes().get("handler").endsWith(suffix)))
                    .collect(Collectors.toMap(fact -> fact.attributes().get("annotationType"), fact -> fact));
            Fact preAuthorize = factsByKind.get("PRE_AUTHORIZE");

            assertEquals(AnalysisStatus.READY, result.status());
            assertEquals(4, factsByKind.size());
            assertEquals("METHOD", preAuthorize.attributes().get("declarationKind"));
            assertEquals("METHOD", preAuthorize.attributes().get("policySource"));
            assertEquals("ROLE_STAFF", preAuthorize.attributes().get("requiredAuthority"));
            assertEquals("HAS_AUTHORITY", preAuthorize.attributes().get("expressionKind"));
            assertEquals("true", preAuthorize.attributes().get("proxyDetected"));
            assertTrue(preAuthorize.attributes().get("handler").endsWith("#find(java.lang.String)"));
            assertFalse(preAuthorize.attributes().get("methodSecurityInfrastructure").isBlank());
            assertEquals(List.of(EvidenceSource.RUNTIME, EvidenceSource.SPRING_METADATA, EvidenceSource.DECLARATION),
                    evidenceSources(result, preAuthorize));
            assertTrue(result.diagnostics().isEmpty());
        }
    }

    @Test
    void preservesDeclarationWhenMethodSecurityInfrastructureIsUnavailable() {
        try (AnnotationConfigApplicationContext context = context(DeclarationOnlyConfiguration.class)) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            Fact fact = result.facts().get(0);

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertEquals("PRE_AUTHORIZE", fact.attributes().get("annotationType"));
            assertEquals("false", fact.attributes().get("proxyDetected"));
            assertEquals(List.of(EvidenceSource.DECLARATION), evidenceSources(result, fact));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("Method Security Advisor")));
        }
    }

    @Test
    void resolvesInterfaceDeclarationsWithoutDuplicateFactsAndKeepsIdsStable() {
        try (AnnotationConfigApplicationContext context = context(EnabledMethodSecurityConfiguration.class)) {
            MethodSecurityCollectorAdapter adapter = new MethodSecurityCollectorAdapter();

            CollectionResult first = adapter.collect(new CollectionContext(context, "account", "one"));
            CollectionResult second = adapter.collect(new CollectionContext(context, "account", "two"));
            List<Fact> interfaceFacts = first.facts().stream()
                    .filter(fact -> fact.attributes().get("handler").endsWith("#review(java.lang.String)"))
                    .toList();

            assertEquals(1, interfaceFacts.size());
            assertEquals("PRE_AUTHORIZE", interfaceFacts.get(0).attributes().get("annotationType"));
            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());
        }
    }

    @Test
    void preservesDifferentAnnotationTypesResolvedFromImplementationAndInterface() {
        try (AnnotationConfigApplicationContext context = context(EnabledMethodSecurityConfiguration.class)) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            List<String> annotationTypes = result.facts().stream()
                    .filter(fact -> fact.attributes().get("handler").endsWith("#approve(java.lang.String)"))
                    .map(fact -> fact.attributes().get("annotationType"))
                    .sorted()
                    .toList();

            assertEquals(List.of("PRE_AUTHORIZE", "SECURED"), annotationTypes);
        }
    }

    @Test
    void registersMethodSecurityCollectorWithoutChangingExistingSecurityAdapters() {
        try (AnnotationConfigApplicationContext context = context(
                EnabledMethodSecurityConfiguration.class, MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(MethodSecurityCollectorAdapter.class).size());
        }
    }

    @Test
    void isolatesBeanTypeLookupFailureAndPreservesFactsFromOtherBeans() {
        TypeLookupFailureApplicationContext context = contextWithBrokenBean(EnabledMethodSecurityConfiguration.class);
        try (context) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertTrue(result.facts().stream().anyMatch(fact ->
                    fact.attributes().get("handler").endsWith("#find(java.lang.String)")));
            assertTrue(result.diagnostics().stream().anyMatch(diagnostic ->
                    diagnostic.summary().contains("brokenBean")));
        }
    }

    @Test
    void keepsPartialStatusWhenBeanDiscoveryFailsBeforeAnyFactIsCollected() {
        TypeLookupFailureApplicationContext context = contextWithBrokenBean();
        try (context) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            assertTrue(result.facts().isEmpty());
            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertFalse(result.diagnostics().isEmpty());
        }
    }

    @Test
    void connectsOnlyTheAdvisorForEachAnnotationType() {
        try (AnnotationConfigApplicationContext context = context(PreAuthorizeOnlyConfiguration.class)) {
            CollectionResult result = new MethodSecurityCollectorAdapter().collect(
                    new CollectionContext(context, "account", "instance"));

            Fact preAuthorize = factFor(result, "#approve(java.lang.String)", "PRE_AUTHORIZE");
            Fact secured = factFor(result, "#approve(java.lang.String)", "SECURED");

            assertEquals(AnalysisStatus.PARTIAL, result.status());
            assertTrue(preAuthorize.attributes().get("methodSecurityInfrastructure")
                    .contains("preAuthorize"));
            assertFalse(secured.attributes().containsKey("methodSecurityInfrastructure"));
            assertTrue(evidenceSources(result, preAuthorize).contains(EvidenceSource.SPRING_METADATA));
            assertFalse(evidenceSources(result, secured).contains(EvidenceSource.SPRING_METADATA));
        }
    }

    private List<EvidenceSource> evidenceSources(CollectionResult result, Fact fact) {
        return fact.evidenceIds().stream()
                .map(evidenceId -> result.evidence().stream()
                        .filter(evidence -> evidence.id().equals(evidenceId))
                        .findFirst().orElseThrow())
                .map(Evidence::source)
                .sorted()
                .toList();
    }

    private Fact factFor(CollectionResult result, String handlerSuffix, String annotationType) {
        return result.facts().stream()
                .filter(fact -> fact.attributes().get("handler").endsWith(handlerSuffix))
                .filter(fact -> annotationType.equals(fact.attributes().get("annotationType")))
                .findFirst()
                .orElseThrow();
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configurations);
        context.refresh();
        return context;
    }

    private TypeLookupFailureApplicationContext contextWithBrokenBean(Class<?>... configurations) {
        TypeLookupFailureApplicationContext context = new TypeLookupFailureApplicationContext();
        if (configurations.length > 0) {
            context.register(configurations);
        }
        context.refresh();
        ((DefaultListableBeanFactory) context.getBeanFactory())
                .registerBeanDefinition("brokenBean", new RootBeanDefinition(UnknownBrokenService.class));
        return context;
    }

    static class TypeLookupFailureApplicationContext extends AnnotationConfigApplicationContext {

        @Override
        public Class<?> getType(String name, boolean allowFactoryBeanInit) {
            if ("brokenBean".equals(name)) {
                throw new IllegalStateException("simulated Bean type lookup failure");
            }
            return super.getType(name, allowFactoryBeanInit);
        }
    }

    static class UnknownBrokenService {
    }

    @Configuration(proxyBeanMethods = false)
    @EnableMethodSecurity(securedEnabled = true, jsr250Enabled = true)
    static class EnabledMethodSecurityConfiguration {

        @Bean
        ProtectedService protectedService() {
            return new ProtectedService();
        }

        @Bean
        InterfaceProtectedService interfaceProtectedService() {
            return new InterfaceProtectedServiceImpl();
        }

        @Bean
        MixedDeclarationService mixedDeclarationService() {
            return new MixedDeclarationServiceImpl();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class DeclarationOnlyConfiguration {

        @Bean
        DeclarationOnlyService declarationOnlyService() {
            return new DeclarationOnlyService();
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableMethodSecurity
    static class PreAuthorizeOnlyConfiguration {

        @Bean
        MixedDeclarationService mixedDeclarationService() {
            return new MixedDeclarationServiceImpl();
        }
    }

    static class ProtectedService {

        @PreAuthorize("hasAuthority('ROLE_STAFF')")
        public String find(String customerId) {
            return customerId;
        }

        @PostAuthorize("returnObject != null")
        public String postCheck() {
            return "ok";
        }

        @Secured("ROLE_AUDITOR")
        public String secured() {
            return "ok";
        }

        @RolesAllowed("ROLE_REVIEWER")
        public String roleAllowed() {
            return "ok";
        }
    }

    static class DeclarationOnlyService {

        @PreAuthorize("hasAuthority('ROLE_STAFF')")
        public String find(String customerId) {
            return customerId;
        }
    }

    interface InterfaceProtectedService {

        @PreAuthorize("hasAuthority('ROLE_REVIEWER')")
        String review(String customerId);
    }

    static class InterfaceProtectedServiceImpl implements InterfaceProtectedService {

        @Override
        @PreAuthorize("hasAuthority('ROLE_REVIEWER')")
        public String review(String customerId) {
            return customerId;
        }
    }

    interface MixedDeclarationService {

        @Secured("ROLE_APPROVER")
        String approve(String customerId);
    }

    static class MixedDeclarationServiceImpl implements MixedDeclarationService {

        @Override
        @PreAuthorize("hasAuthority('ROLE_STAFF')")
        public String approve(String customerId) {
            return customerId;
        }
    }
}
