package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.mapinboot.core.collection.CollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.security.collector.JwtUsageCollectorAdapter;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

class JwtUsageCollectorAdapterTest {

    @Test
    void collectsStaticJwtCreationReadSigningAndVerificationPatterns() throws Exception {
        try (AnnotationConfigApplicationContext context = context()) {
            CollectorAdapter adapter = new JwtUsageCollectorAdapter();
            CollectionResult result = adapter.collect(new CollectionContext(context, "identity", "instance"));

            assertEquals("security-jwt-usage", adapter.id());
            assertEquals(Set.of("JWT_USAGE"), adapter.getSupportedTypes());
            assertEquals(AnalysisStatus.READY, result.status());
            assertTrue(result.diagnostics().isEmpty());
            assertTrue(result.evidence().stream().allMatch(evidence -> evidence.source() == EvidenceSource.CODE_PATTERN));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "WRITE".equals(fact.attributes().get("operation"))
                            && "sub".equals(fact.attributes().get("claimName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && "role".equals(fact.attributes().get("claimName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "WRITE".equals(fact.attributes().get("operation"))
                            && "roles".equals(fact.attributes().get("claimName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "WRITE".equals(fact.attributes().get("operation"))
                            && "identity_verified".equals(fact.attributes().get("claimName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && "identity_verified".equals(fact.attributes().get("claimName"))));
            assertFalse(result.facts().stream().anyMatch(fact ->
                    "notJwtClaim".equals(fact.attributes().get("claimName"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "SIGN".equals(fact.attributes().get("operation"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "VERIFY".equals(fact.attributes().get("operation"))
                            && "INVOCATION".equals(fact.attributes().get("verificationKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "VERIFY_CONFIGURATION".equals(fact.attributes().get("operation"))
                            && "CONFIGURATION".equals(fact.attributes().get("verificationKind"))));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "READ".equals(fact.attributes().get("operation"))
                            && !fact.attributes().containsKey("claimName")));
            assertTrue(result.facts().stream().anyMatch(fact ->
                    "WRITE".equals(fact.attributes().get("operation"))
                            && !fact.attributes().containsKey("claimName")));
            assertTrue(result.facts().stream().allMatch(fact ->
                    fact.evidenceIds().stream().allMatch(id -> result.evidence().stream()
                            .anyMatch(evidence -> evidence.id().equals(id)))));
        }
    }

    @Test
    void keepsFactAndEvidenceIdsStableAndDoesNotInitializeLazyBeans() throws Exception {
        LazyJwtUsageFixture.initialized = false;
        try (AnnotationConfigApplicationContext context = context()) {
            CollectorAdapter adapter = new JwtUsageCollectorAdapter();
            CollectionResult first = adapter.collect(new CollectionContext(context, "identity", "instance"));
            CollectionResult second = adapter.collect(new CollectionContext(context, "identity", "other"));

            assertFalse(LazyJwtUsageFixture.initialized);
            assertEquals(first.facts(), second.facts());
            assertEquals(first.evidence(), second.evidence());
            assertEquals(first.facts().stream().map(Fact::id).collect(Collectors.toSet()).size(),
                    first.facts().size());
        }
    }

    @Test
    void registersCollectorThroughSecurityAutoConfiguration() throws Exception {
        try (AnnotationConfigApplicationContext context = context(MapInBootSecurityAutoConfiguration.class)) {
            assertEquals(1, context.getBeansOfType(JwtUsageCollectorAdapter.class).size());
        }
    }

    private AnnotationConfigApplicationContext context(Class<?>... configurations) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(FixtureConfiguration.class);
        if (configurations.length > 0) {
            context.register(configurations);
        }
        context.refresh();
        return context;
    }

    @Configuration(proxyBeanMethods = false)
    static class FixtureConfiguration {

        @Bean
        JwtUsageFixture jwtUsageFixture() {
            return new JwtUsageFixture();
        }

        @Bean
        @Lazy
        LazyJwtUsageFixture lazyJwtUsageFixture() {
            return new LazyJwtUsageFixture();
        }

        @Bean
        Runnable lambdaBean() {
            return () -> {
            };
        }
    }

    static class JwtUsageFixture {

        private JwtDecoder decoder;

        void useJwt(String dynamicClaim) throws Exception {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject("USER001")
                    .issuer("issuer")
                    .audience("audience")
                    .claim("role", "ROLE_USER")
                    .claim("roles", java.util.List.of("ROLE_USER"))
                    .claim("identity_verified", true)
                    .claim(dynamicClaim, "dynamic")
                    .build();
            claims.getSubject();
            claims.getClaim("role");
            claims.getClaim(dynamicClaim);
            claims.getClaims();

            SignedJWT signedJWT = new SignedJWT(null, claims);
            signedJWT.sign(null);
            signedJWT.verify(null);

            Jwt jwt = Jwt.withTokenValue("token")
                    .header("alg", "RS256")
                    .claim("sub", "USER001")
                    .claim("role", "ROLE_USER")
                    .build();
            jwt.getSubject();
            jwt.getClaim("role");
            jwt.getClaim(dynamicClaim);
            jwt.getClaims();
            jwt.getClaims().get("identity_verified");
            java.util.Map<String, Object> ordinaryClaims = java.util.Map.of("notJwtClaim", true);
            ordinaryClaims.get("notJwtClaim");

            decoder.decode("token");
        }

        Object decoderConfiguration() {
            return NimbusJwtDecoder.withJwkSetUri("https://issuer.example/jwks").build();
        }
    }

    static class LazyJwtUsageFixture {

        private static boolean initialized;

        LazyJwtUsageFixture() {
            initialized = true;
        }
    }
}
