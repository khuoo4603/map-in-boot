package com.mapinboot.security.collector;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
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

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configuration);
        context.refresh();
        return context;
    }

    interface RegisteredContract {
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
