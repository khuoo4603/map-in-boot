package com.mapinboot.security.collector;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.collection.model.CollectionContext;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

class ApplicationClassDiscoveryTest {

    @Test
    void distinguishesSdkAndExternalClassOriginsWithoutPackageRules() throws Exception {
        Class<?> starterHandler = Class.forName(
                "com.mapinboot.starter.web.ui.MapInBootUiController", false,
                Thread.currentThread().getContextClassLoader());

        assertTrue(ApplicationClassDiscovery.isSdkOwnedClass(ApplicationClassDiscovery.class));
        assertTrue(ApplicationClassDiscovery.isSdkOwnedClass(starterHandler));
        assertFalse(ApplicationClassDiscovery.isSdkOwnedClass(HandlerFixture.class));
        assertTrue(ApplicationClassDiscovery.isExternalHandlerClass(RequestMappingHandlerMapping.class));
        assertFalse(ApplicationClassDiscovery.isExternalHandlerClass(HandlerFixture.class));
    }

    @Test
    void discoversRegisteredBeansAndHandlersWithinDerivedPackages() {
        try (AnnotationConfigApplicationContext context = context(FixtureConfiguration.class)) {
            ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                    context, "security-class-discovery-test", "후보");
            Set<String> classNames = discovery.targetClasses().stream()
                    .map(Class::getName)
                    .collect(Collectors.toSet());

            assertTrue(classNames.contains(HandlerFixture.class.getName()));
            assertTrue(classNames.contains(RegisteredService.class.getName()));
            assertTrue(classNames.contains(RegisteredContract.class.getName()));
            assertFalse(classNames.contains(UnregisteredPlainFixture.class.getName()));
            assertFalse(classNames.contains(UnregisteredComponent.class.getName()));
            assertTrue(discovery.metrics().acceptedPackages().contains("com.mapinboot.security.collector"));
            assertTrue(discovery.metrics().beanStartPoints() > 0);
            assertTrue(discovery.metrics().handlerStartPoints() > 0);
            assertTrue(discovery.metrics().metadataClassCount()
                    >= discovery.metrics().metadataCandidateCount());
            assertTrue(discovery.metrics().metadataCandidateCount() > 0);
            assertTrue(discovery.metrics().loadedCandidateCount() > 0);
            assertTrue(discovery.metrics().scanDurationMillis() >= 0);
        }
    }

    @Test
    void inspectsLazyBeanMetadataWithoutCreatingTheBean() {
        LazyFixture.created = false;
        try (AnnotationConfigApplicationContext context = context(LazyConfiguration.class)) {
            ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                    context, "security-class-discovery-test", "후보");

            assertTrue(discovery.targetClasses().stream()
                    .anyMatch(type -> type.getName().equals(LazyFixture.class.getName())));
            assertFalse(LazyFixture.created);
            assertTrue(discovery.diagnostics().isEmpty());
        }
    }

    @Test
    void excludesGeneratedJdkProxyBytecodeWhileRetainingItsInterface() {
        try (AnnotationConfigApplicationContext context = context(JdkProxyConfiguration.class)) {
            Class<?> proxyClass = context.getBean(ProxyContract.class).getClass();
            assertTrue(Proxy.isProxyClass(proxyClass));
            assertNotNull(BytecodeUsageScanner.scan(proxyClass).diagnostic());

            ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                    context, "security-class-discovery-test", "후보");

            assertFalse(discovery.targetClasses().contains(proxyClass));
            assertFalse(discovery.candidateClassNames().contains(proxyClass.getName()),
                    discovery.candidateClassNames().stream().filter(name -> name.contains("$Proxy")).toList().toString());
            List<String> affectedAdapters = new ArrayList<>();
            for (var adapter : List.of(
                    new JwtUsageCollectorAdapter(),
                    new SessionUsageCollectorAdapter(),
                    new HeaderUsageCollectorAdapter(),
                    new PrincipalUsageCollectorAdapter())) {
                var result = adapter.collect(new CollectionContext(context, "main", "instance"));
                result.diagnostics().stream()
                        .filter(diagnostic -> diagnostic.summary().contains(proxyClass.getName()))
                        .forEach(diagnostic -> affectedAdapters.add(
                                adapter.getClass().getSimpleName() + ": " + diagnostic.summary()));
            }
            assertTrue(affectedAdapters.isEmpty(), affectedAdapters.toString());
            assertTrue(discovery.targetClasses().contains(ProxyContract.class));
        }
    }

    @Test
    void resolvesSpringAopJdkAndCglibTargets() {
        try (AnnotationConfigApplicationContext context = context(AopProxyConfiguration.class)) {
            ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                    context, "security-class-discovery-test", "후보");
            Set<String> classNames = discovery.targetClasses().stream()
                    .map(Class::getName)
                    .collect(Collectors.toSet());

            assertTrue(classNames.contains(JdkAopTarget.class.getName()));
            assertTrue(classNames.contains(CglibAopTarget.class.getName()));
            assertFalse(discovery.targetClasses().stream().anyMatch(Proxy::isProxyClass));
            assertFalse(classNames.stream().anyMatch(name -> name.contains("$$SpringCGLIB$$")));
            assertTrue(discovery.diagnostics().isEmpty());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configuration);
        context.refresh();
        return context;
    }

    interface RegisteredContract {
    }

    interface ProxyContract {
        String principalName();
    }

    interface AopContract {
        String value();
    }

    static class JdkAopTarget implements AopContract {
        @Override
        public String value() {
            return "value";
        }
    }

    static class CglibAopTarget {
        public String value() {
            return "value";
        }
    }

    @Service
    static class RegisteredService implements RegisteredContract {
    }

    @RestController
    static class HandlerFixture {

        public void handle() {
        }
    }

    static class UnregisteredPlainFixture {
    }

    @Service
    static class UnregisteredComponent {
    }

    static class LazyFixture {
        private static boolean created;

        LazyFixture() {
            created = true;
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class JdkProxyConfiguration {

        @Bean
        ProxyContract jdkProxy() {
            return (ProxyContract) Proxy.newProxyInstance(
                    ProxyContract.class.getClassLoader(), new Class<?>[]{ProxyContract.class},
                    (proxy, method, arguments) -> null);
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class AopProxyConfiguration {

        @Bean
        AopContract jdkAopBean() {
            ProxyFactory factory = new ProxyFactory(new JdkAopTarget());
            factory.setInterfaces(AopContract.class);
            return (AopContract) factory.getProxy();
        }

        @Bean
        CglibAopTarget cglibAopBean() {
            ProxyFactory factory = new ProxyFactory(new CglibAopTarget());
            factory.setProxyTargetClass(true);
            return (CglibAopTarget) factory.getProxy();
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class FixtureConfiguration {

        @Bean
        HandlerFixture handlerFixture() {
            return new HandlerFixture();
        }

        @Bean
        RegisteredService registeredService() {
            return new RegisteredService();
        }

        @Bean
        RequestMappingHandlerMapping requestMappingHandlerMapping(HandlerFixture handlerFixture)
                throws NoSuchMethodException {
            RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
            Method handler = HandlerFixture.class.getDeclaredMethod("handle");
            mapping.registerMapping(
                    RequestMappingInfo.paths("/fixture").methods(RequestMethod.GET).build(), handlerFixture, handler);
            return mapping;
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class LazyConfiguration {

        @Bean
        @Lazy
        LazyFixture lazyFixture() {
            return new LazyFixture();
        }
    }
}
