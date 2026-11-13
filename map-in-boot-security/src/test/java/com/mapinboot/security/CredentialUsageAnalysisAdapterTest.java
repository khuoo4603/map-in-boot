package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.security.analyzer.CredentialUsageAnalysisAdapter;
import com.mapinboot.security.autoconfigure.MapInBootSecurityAutoConfiguration;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.Type;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

class CredentialUsageAnalysisAdapterTest {

    @Test
    void createsReadWriteAndAuthorityRelationsOnlyFromActualFixtureLocations() {
        Fact endpoint = endpoint("direct", CredentialFixture.class, "direct",
                Jwt.class, Authentication.class, jakarta.servlet.http.HttpSession.class,
                jakarta.servlet.http.HttpServletRequest.class);
        Fact jwtRead = usage("jwt-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact sessionWrite = usage("session-write", "SESSION_USAGE", "WRITE", endpointLocation(endpoint),
                "jakarta.servlet.http.HttpSession", "setAttribute",
                "(Ljava/lang/String;Ljava/lang/Object;)V", 1);
        Fact headerRead = usage("header-read", "HEADER_USAGE", "READ", endpointLocation(endpoint),
                "jakarta.servlet.http.HttpServletRequest", "getHeader", "(Ljava/lang/String;)Ljava/lang/String;", 2);
        Fact authStatus = usage("auth-status", "SESSION_USAGE", "AUTH_STATUS", endpointLocation(endpoint),
                "org.springframework.security.core.Authentication", "isAuthenticated", "()Z", 3);
        Fact verify = usage("verify", "JWT_USAGE", "VERIFY", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.JwtDecoder", "decode",
                "(Ljava/lang/String;)Lorg/springframework/security/oauth2/jwt/Jwt;", 4);

        AnalysisReport report = execute(List.of(endpoint, jwtRead, sessionWrite, headerRead, authStatus, verify));

        assertEquals(AnalysisStatus.READY, status(report));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(jwtRead.subjectKey())));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.WRITES_SECURITY_DATA && relation.targetKey().equals(sessionWrite.subjectKey())));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(headerRead.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.WRITES_SECURITY_DATA && relation.targetKey().equals(verify.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.USES_FOR_AUTHORIZATION && relation.targetKey().equals(authStatus.subjectKey())));
        assertTrue(report.relations().stream().allMatch(relation ->
                relation.confidence() == Confidence.CONFIRMED));
    }

    @Test
    void followsBoundedSameClassPathAndRequiresActualAuthorityInput() {
        Fact indirectEndpoint = endpoint("indirect", CredentialFixture.class, "indirect", Jwt.class);
        Fact indirectRead = usage("indirect-read", "JWT_USAGE", "READ",
                location(CredentialFixture.class, "helper", Jwt.class),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact mapEndpoint = endpoint("map", CredentialFixture.class, "map", Jwt.class);
        Fact principalRead = usage("principal-read", "PRINCIPAL_USAGE", "READ",
                location(CredentialFixture.class, "map", Jwt.class),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0,
                Map.of("sourceKind", "JWT", "observationKind", "SUBJECT_LOOKUP", "principalType", "JWT"));
        Fact authority = usage("authority", "AUTHORITY_MAPPING", "CREATE",
                location(CredentialFixture.class, "map", Jwt.class),
                "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 1,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));
        Fact authorityLookup = usage("authority-lookup", "PRINCIPAL_USAGE", "READ",
                location(CredentialFixture.class, "authorityLookup", Authentication.class),
                "org.springframework.security.core.Authentication", "getAuthorities",
                "()Ljava/util/Collection;", 0,
                Map.of("sourceKind", "AUTHENTICATION", "observationKind", "AUTHORITY_LOOKUP",
                        "principalType", "AUTHENTICATION"));
        Fact staticAuthority = usage("static-authority", "AUTHORITY_MAPPING", "CREATE",
                location(CredentialFixture.class, "staticAuthority"),
                "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 0,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));
        Fact staticEndpoint = endpoint("static", CredentialFixture.class, "staticAuthority");

        AnalysisReport report = execute(List.of(indirectEndpoint, indirectRead, mapEndpoint, principalRead,
                authority, authorityLookup, staticAuthority, staticEndpoint));

        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(indirectRead.subjectKey())));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY
                        && relation.sourceKey().equals(principalRead.subjectKey())
                        && relation.targetKey().equals(authority.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY
                        && relation.targetKey().equals(staticAuthority.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY
                        && relation.targetKey().equals(authorityLookup.subjectKey())));
        assertTrue(report.relations().stream().flatMap(relation -> relation.evidenceIds().stream())
                .allMatch(id -> report.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
    }

    @Test
    void preservesConfirmedConversionBeforeUnrelatedControlFlow() {
        Fact branchEndpoint = endpoint("map-before-branch", CredentialFixture.class,
                "mapBeforeUnrelatedBranch", Jwt.class, boolean.class);
        Fact branchRead = usage("map-before-branch-read", "JWT_USAGE", "READ",
                endpointLocation(branchEndpoint), "org.springframework.security.oauth2.jwt.Jwt", "getSubject",
                "()Ljava/lang/String;", 0);
        Fact branchAuthority = usage("map-before-branch-authority", "AUTHORITY_MAPPING", "CREATE",
                endpointLocation(branchEndpoint),
                "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 1,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));

        Fact exceptionEndpoint = endpoint("map-before-exception", CredentialFixture.class,
                "mapBeforeUnrelatedException", Jwt.class);
        Fact exceptionRead = usage("map-before-exception-read", "JWT_USAGE", "READ",
                endpointLocation(exceptionEndpoint), "org.springframework.security.oauth2.jwt.Jwt", "getSubject",
                "()Ljava/lang/String;", 0);
        Fact exceptionAuthority = usage("map-before-exception-authority", "AUTHORITY_MAPPING", "CREATE",
                endpointLocation(exceptionEndpoint),
                "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 1,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));

        AnalysisReport report = execute(List.of(branchEndpoint, branchRead, branchAuthority,
                exceptionEndpoint, exceptionRead, exceptionAuthority));

        assertEquals(AnalysisStatus.READY, status(report));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY
                        && relation.sourceKey().equals(branchRead.subjectKey())
                        && relation.targetKey().equals(branchAuthority.subjectKey())));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY
                        && relation.sourceKey().equals(exceptionRead.subjectKey())
                        && relation.targetKey().equals(exceptionAuthority.subjectKey())));
    }

    @Test
    void doesNotInferAuthorizationUseFromAnExistingAuthorizationFact() {
        Fact endpoint = endpoint("protected", CredentialFixture.class, "protectedRead", Jwt.class);
        Fact jwtRead = usage("protected-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact methodAuthorization = new Fact(
                "method-protected",
                "METHOD_AUTHORIZATION",
                "method|protected",
                Map.of("handler", endpoint.attributes().get("handler"), "declarationKind", "METHOD",
                        "annotationType", "PRE_AUTHORIZE"),
                List.of("evidence-method-protected"));
        Fact objectMissing = new Fact(
                "object-not-created",
                "SESSION_USAGE",
                "session|unrelated",
                Map.of("operation", "READ", "codeLocation", location(CredentialFixture.class, "unrelated")),
                List.of("evidence-object-not-created"));

        AnalysisReport report = execute(List.of(endpoint, jwtRead, methodAuthorization, objectMissing),
                Map.of("security-jwt-usage", AnalysisStatus.PARTIAL));

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(jwtRead.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.USES_FOR_AUTHORIZATION));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.USES_FOR_AUTHORIZATION
                        && relation.targetKey().equals(objectMissing.subjectKey())));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("부분 수집") || diagnostic.summary().contains("상태")));
    }

    @Test
    void doesNotInferAuthorizationUseFromLoggingOrMethodSecurityDeclaration() {
        Fact endpoint = endpoint("logging-only", CredentialFixture.class, "loggingOnly", Jwt.class);
        Fact jwtRead = usage("logging-only-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact methodAuthorization = new Fact(
                "method-logging-only",
                "METHOD_AUTHORIZATION",
                "method|logging-only",
                Map.of("handler", endpoint.attributes().get("handler"), "declarationKind", "METHOD",
                        "annotationType", "PRE_AUTHORIZE"),
                List.of("evidence-method-logging-only"));

        AnalysisReport report = execute(List.of(endpoint, jwtRead, methodAuthorization));

        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(jwtRead.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.USES_FOR_AUTHORIZATION));
    }

    @Test
    void doesNotInferAuthorizationUseFromPermitAllUrlPolicy() {
        Fact endpoint = endpoint("permit", CredentialFixture.class, "protectedRead", Jwt.class);
        Fact jwtRead = usage("permit-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact permitAll = new Fact(
                "url-permit-all",
                "URL_AUTHORIZATION",
                "policy|permit-all",
                Map.of("chainKey", "chain|test|1", "policyKind", "PERMIT_ALL",
                        "policySource", "URL", "policyMatcherType", "METHOD_PATH",
                        "policyMatcherCondition", "GET /permit"),
                List.of("evidence-url-permit-all"));

        AnalysisReport report = execute(List.of(endpoint, jwtRead, permitAll));

        assertTrue(report.relations().stream().anyMatch(relation ->
                relation.type() == EdgeType.READS_SECURITY_DATA && relation.targetKey().equals(jwtRead.subjectKey())));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.USES_FOR_AUTHORIZATION));
    }

    @Test
    void doesNotCreateAuthorityConversionWhenBranchSourcesAreMixed() {
        Fact endpoint = endpoint("branch-authority", CredentialFixture.class, "branchAuthority", Jwt.class,
                boolean.class);
        Fact jwtRead = usage("branch-authority-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact authority = usage("branch-authority-mapping", "AUTHORITY_MAPPING", "CREATE",
                endpointLocation(endpoint), "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 1,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));

        AnalysisReport report = execute(List.of(endpoint, jwtRead, authority));

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY));
    }

    @Test
    void doesNotCreateAuthorityConversionWhenInvokeDynamicSourceIsUnsupported() {
        Fact endpoint = endpoint("dynamic-authority", CredentialFixture.class, "dynamicAuthority", Jwt.class);
        Fact jwtRead = usage("dynamic-authority-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        Fact authority = usage("dynamic-authority-mapping", "AUTHORITY_MAPPING", "CREATE",
                endpointLocation(endpoint), "org.springframework.security.core.authority.SimpleGrantedAuthority", "<init>",
                "(Ljava/lang/String;)V", 1,
                Map.of("mappingKind", "GRANTED_AUTHORITY_CREATION", "sourceKind", "AUTHORITY",
                        "observationKind", "AUTHORITY_MAPPING"));

        AnalysisReport report = execute(List.of(endpoint, jwtRead, authority));

        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.relations().stream().noneMatch(relation ->
                relation.type() == EdgeType.CONVERTS_TO_AUTHORITY));
    }

    @Test
    void buildsGraphAndSnapshotWithStableRelationReferences() {
        Fact endpoint = endpoint("graph", CredentialFixture.class, "protectedRead", Jwt.class);
        Fact jwtRead = usage("graph-read", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);
        AnalysisReport report = execute(List.of(endpoint, jwtRead));

        SecurityGraph graph = new GraphBuilder().build("credential", report);
        assertEquals(1, graph.edges().size());
        assertEquals(EdgeType.READS_SECURITY_DATA, graph.edges().get(0).type());
        assertEquals(Confidence.CONFIRMED, graph.edges().get(0).confidence());

        AnalysisReport reordered = execute(List.of(jwtRead, endpoint));
        assertEquals(report.relations().get(0).id(), reordered.relations().get(0).id());

        Snapshot snapshot = new SnapshotAssembler(List.of(), "1")
                .assemble(report, "credential", "instance", "test");
        assertEquals(1, snapshot.edges().size());
        assertTrue(snapshot.edges().get(0).evidenceIds().stream()
                .allMatch(id -> snapshot.evidence().stream().anyMatch(evidence -> evidence.id().equals(id))));
    }

    @Test
    void excludesRelationWhenFactEvidenceIsMissing() {
        Fact endpoint = endpoint("missing-evidence", CredentialFixture.class, "protectedRead", Jwt.class);
        Fact jwtRead = usage("missing-fact-evidence", "JWT_USAGE", "READ", endpointLocation(endpoint),
                "org.springframework.security.oauth2.jwt.Jwt", "getSubject", "()Ljava/lang/String;", 0);

        AnalysisReport report = executeWithEvidence(List.of(endpoint, jwtRead), evidence(List.of(endpoint)), Map.of());

        assertTrue(report.relations().isEmpty());
        assertEquals(AnalysisStatus.PARTIAL, status(report));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("Evidence")));
    }

    @Test
    void registersAnalyzerAndDoesNotRequireFactTypes() {
        CredentialUsageAnalysisAdapter adapter = new CredentialUsageAnalysisAdapter();
        assertEquals(Set.of(), adapter.requiredFactTypes());
        assertEquals(Set.of("READS_SECURITY_DATA", "WRITES_SECURITY_DATA",
                "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION"), adapter.getSupportedTypes());

        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.register(MapInBootSecurityAutoConfiguration.class);
            context.refresh();
            assertEquals(1, context.getBeansOfType(CredentialUsageAnalysisAdapter.class).size());
        }
    }

    private AnalysisReport execute(List<Fact> facts) {
        return execute(facts, Map.of());
    }

    private AnalysisReport execute(List<Fact> facts, Map<String, AnalysisStatus> overrides) {
        return executeWithEvidence(facts, evidence(facts), overrides);
    }

    private AnalysisReport executeWithEvidence(
            List<Fact> facts, List<Evidence> evidence, Map<String, AnalysisStatus> overrides) {
        Map<String, AnalysisStatus> statuses = new LinkedHashMap<>();
        statuses.put("starter-endpoint-mapping", AnalysisStatus.READY);
        statuses.put("security-jwt-usage", AnalysisStatus.READY);
        statuses.put("security-session-usage", AnalysisStatus.READY);
        statuses.put("security-header-usage", AnalysisStatus.READY);
        statuses.put("security-principal-usage", AnalysisStatus.READY);
        statuses.put("security-method-authorization", AnalysisStatus.READY);
        statuses.putAll(overrides);
        CollectionReport collection = new CollectionReport(facts, evidence, statuses, List.of());
        return new AnalysisProvider().execute(
                new AnalysisContext(collection, "credential"), List.of(new CredentialUsageAnalysisAdapter()));
    }

    private List<Evidence> evidence(List<Fact> facts) {
        return facts.stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .distinct()
                .map(id -> new Evidence(id,
                        id.startsWith("evidence-endpoint") ? EvidenceSource.RUNTIME : EvidenceSource.CODE_PATTERN,
                        "test-fixture", "fixture evidence"))
                .toList();
    }

    private Fact endpoint(String id, Class<?> type, String method, Class<?>... parameters) {
        String handler = handler(type, method, parameters);
        return new Fact("endpoint-" + id, "ENDPOINT_MAPPING", "endpoint|" + id,
                Map.of("httpMethod", "GET", "path", "/" + id, "handler", handler),
                List.of("evidence-endpoint-" + id));
    }

    private Fact usage(String id, String type, String operation, String location,
                       String owner, String name, String descriptor, int occurrence) {
        return usage(id, type, operation, location, owner, name, descriptor, occurrence, Map.of());
    }

    private Fact usage(String id, String type, String operation, String location,
                       String owner, String name, String descriptor, int occurrence,
                       Map<String, String> extras) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("operation", operation);
        attributes.put("codeLocation", location);
        attributes.put("apiOwner", owner);
        attributes.put("apiName", name);
        attributes.put("apiDescriptor", descriptor);
        attributes.put("occurrence", Integer.toString(occurrence));
        if ("JWT_USAGE".equals(type)) {
            attributes.put("apiType", "SPRING_SECURITY_JWT");
        } else if ("SESSION_USAGE".equals(type)) {
            attributes.put("apiType", "HTTP_SESSION");
            attributes.put("sourceKind", "HTTP_SESSION");
            attributes.put("observationKind", "SESSION_ATTRIBUTE");
        } else if ("HEADER_USAGE".equals(type)) {
            attributes.put("apiType", "SERVLET_REQUEST");
            attributes.put("headerName", "X-Staff-Id");
            attributes.put("sourceKind", "SERVLET_REQUEST");
            attributes.put("observationKind", "HEADER_LOOKUP");
        } else if ("PRINCIPAL_USAGE".equals(type)) {
            attributes.put("apiType", "PRINCIPAL");
            attributes.put("principalType", "AUTHENTICATION");
            attributes.put("sourceKind", "AUTHENTICATION");
            attributes.put("observationKind", "PRINCIPAL_LOOKUP");
        } else if ("AUTHORITY_MAPPING".equals(type)) {
            attributes.put("apiType", "AUTHORITY");
        }
        attributes.putAll(extras);
        return new Fact("fact-" + id, type, type.toLowerCase() + "|" + id, attributes,
                List.of("evidence-" + id));
    }

    private String endpointLocation(Fact endpoint) {
        String handler = endpoint.attributes().get("handler");
        int open = handler.indexOf('(');
        String classAndMethod = handler.substring(0, open);
        String parameters = handler.substring(open + 1, handler.length() - 1);
        String descriptor = Type.getMethodDescriptor(resolveMethod(classAndMethod, parameters));
        return classAndMethod + descriptor;
    }

    private String location(Class<?> type, String method, Class<?>... parameters) {
        Method resolved;
        try {
            resolved = type.getDeclaredMethod(method, parameters);
        } catch (NoSuchMethodException exception) {
            throw new IllegalArgumentException(exception);
        }
        return type.getName() + "#" + method + Type.getMethodDescriptor(resolved);
    }

    private String handler(Class<?> type, String method, Class<?>... parameters) {
        return type.getName() + "#" + method + "("
                + Arrays.stream(parameters).map(Class::getName).collect(Collectors.joining(",")) + ")";
    }

    private Method resolveMethod(String classAndMethod, String parameters) {
        int separator = classAndMethod.indexOf('#');
        String className = classAndMethod.substring(0, separator);
        String methodName = classAndMethod.substring(separator + 1);
        try {
            Class<?> type = Class.forName(className, false, Thread.currentThread().getContextClassLoader());
            Class<?>[] parameterTypes = parameters.isBlank()
                    ? new Class<?>[0]
                    : Arrays.stream(parameters.split(","))
                    .map(name -> {
                        try {
                            return switch (name) {
                                case "boolean" -> boolean.class;
                                case "byte" -> byte.class;
                                case "char" -> char.class;
                                case "short" -> short.class;
                                case "int" -> int.class;
                                case "long" -> long.class;
                                case "float" -> float.class;
                                case "double" -> double.class;
                                case "void" -> void.class;
                                default -> Class.forName(name, false,
                                        Thread.currentThread().getContextClassLoader());
                            };
                        } catch (ClassNotFoundException exception) {
                            throw new IllegalArgumentException(exception);
                        }
                    }).toArray(Class<?>[]::new);
            return type.getDeclaredMethod(methodName, parameterTypes);
        } catch (ClassNotFoundException | NoSuchMethodException exception) {
            throw new IllegalArgumentException(exception);
        }
    }

    private AnalysisStatus status(AnalysisReport report) {
        return report.statusByAdapter().get("security-credential-usage-analysis");
    }

    static class CredentialFixture {

        public void direct(Jwt jwt, Authentication authentication,
                           jakarta.servlet.http.HttpSession session,
                           jakarta.servlet.http.HttpServletRequest request) {
            jwt.getSubject();
            session.setAttribute("session-key", "value");
            request.getHeader("X-Staff-Id");
            authentication.isAuthenticated();
        }

        public void indirect(Jwt jwt) {
            helper(jwt);
        }

        private void helper(Jwt jwt) {
            jwt.getSubject();
        }

        public void map(Jwt jwt) {
            new SimpleGrantedAuthority(jwt.getSubject());
        }

        public void mapBeforeUnrelatedBranch(Jwt jwt, boolean condition) {
            new SimpleGrantedAuthority(jwt.getSubject());
            if (condition) {
                unrelated();
            }
        }

        public void mapBeforeUnrelatedException(Jwt jwt) {
            new SimpleGrantedAuthority(jwt.getSubject());
            try {
                Integer.parseInt("1");
            } catch (NumberFormatException ignored) {
                unrelated();
            }
        }

        public void protectedRead(Jwt jwt) {
            jwt.getSubject();
        }

        @PreAuthorize("hasRole('USER')")
        public String loggingOnly(Jwt jwt) {
            return "subject=" + jwt.getSubject();
        }

        public void branchAuthority(Jwt jwt, boolean useJwt) {
            String authority = "ROLE_STATIC";
            if (useJwt) {
                authority = jwt.getSubject();
            }
            new SimpleGrantedAuthority(authority);
        }

        public void dynamicAuthority(Jwt jwt) {
            String subject = jwt.getSubject();
            String authority = "ROLE_" + subject;
            new SimpleGrantedAuthority(authority);
        }

        public void authorityLookup(Authentication authentication) {
            authentication.getAuthorities();
        }

        public void staticAuthority() {
            new SimpleGrantedAuthority("ROLE_STATIC");
        }

        public void unrelated() {
        }
    }
}
