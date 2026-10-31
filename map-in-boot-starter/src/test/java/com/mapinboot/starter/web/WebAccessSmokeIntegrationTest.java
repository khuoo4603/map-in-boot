package com.mapinboot.starter.web;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.snapshot.Snapshot;
import com.mapinboot.starter.bootstrap.MapInBootBootstrap;
import com.mapinboot.starter.snapshot.LocalSnapshotStore;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertEquals;

class WebAccessSmokeIntegrationTest {
    @TempDir
    Path tempDirectory;

    @Test
    void enabledWebRequiresPrincipalAndRoleAndDoesNotExposeMissingSnapshot() throws Exception {
        Path directory = tempDirectory.resolve("file-target");
        Files.writeString(directory, "not-a-directory");

        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of("mapinboot.web.enabled", "true", "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.failureCode() != null || bootstrap.snapshot() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/status").with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.phase").exists())
                    .andExpect(jsonPath("$.persistedSnapshotPresent").value(false))
                    .andExpect(jsonPath("$.errorCode").value("MIB-007"));
            mvc.perform(get("/mapinboot/"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/").with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/smoke.txt"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(true)))
                    .andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(post("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isMethodNotAllowed());
        }
    }

    @Test
    void disabledWebDoesNotRegisterSdkRoutes() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of("mapinboot.web.enabled", "false", "mapinboot.snapshot.directory",
                        tempDirectory.resolve("snapshots").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(true)))
                    .andExpect(status().isNotFound());
        }

        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of("mapinboot.enabled", "false", "mapinboot.web.enabled", "true"))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(true)))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void persistedSnapshotAndCurrentPartialStatusRemainSeparate() throws Exception {
        Path directory = tempDirectory.resolve("partial-snapshots");
        Snapshot previous = previousSnapshot();
        new LocalSnapshotStore(directory, 7, new com.mapinboot.starter.snapshot.SnapshotJsonCodec())
                .save(previous, true);

        try (ConfigurableApplicationContext context = start(
                PartialHost.class,
                Map.of(
                        "spring.application.name", "partial-host",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.analysisReport() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.analysisStatuses.analyzer").value("PARTIAL"))
                    .andExpect(jsonPath("$.diagnostics[0].summary").value(ErrorCode.ADAPTER_FAILED.getDescription()))
                    .andExpect(jsonPath("$.persistedSnapshotPresent").value(true))
                    .andExpect(jsonPath("$.persistedSnapshotId").value(previous.snapshotId()));
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.snapshotId").value(previous.snapshotId()));
        }
    }

    @Test
    void readOnlyRequestsDoNotChangePersistedSnapshot() throws Exception {
        Path directory = tempDirectory.resolve("read-only-snapshots");
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of("mapinboot.web.enabled", "true", "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            Instant capturedAt = bootstrap.persistedSnapshot().capturedAt();
            long filesBefore = managedFileCount(directory);

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.phase").value("COMPLETED"));
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true))).andExpect(status().isOk());

            assertEquals(capturedAt, bootstrap.persistedSnapshot().capturedAt());
            assertEquals(filesBefore, managedFileCount(directory));
        }
    }

    @Test
    void actualSecurityFilterChainProvidesPrincipalAndRoleToSdkAccessGuard() throws Exception {
        try (ConfigurableApplicationContext context = start(
                SecurityHost.class,
                Map.of("mapinboot.web.enabled", "true", "mapinboot.snapshot.directory",
                        tempDirectory.resolve("security-snapshots").toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                    .addFilters(context.getBean(FilterChainProxy.class))
                    .build();

            mvc.perform(get("/mapinboot/api/status"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/status").with(basic("viewer", "password")))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/api/status").with(basic("admin", "password")))
                    .andExpect(status().isOk());
            mvc.perform(get("/mapinboot/smoke.txt").with(basic("admin", "password")))
                    .andExpect(status().isOk());
            mvc.perform(post("/mapinboot/api/snapshot").with(basic("admin", "password")))
                    .andExpect(status().isMethodNotAllowed());
        }
    }

    private RequestPostProcessor basic(String username, String password) {
        String credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));
        return request -> {
            request.addHeader("Authorization", "Basic " + credentials);
            return request;
        };
    }

    private ConfigurableApplicationContext start(Class<?> source, Map<String, Object> properties) {
        SpringApplication application = new SpringApplication(source);
        application.setWebApplicationType(WebApplicationType.SERVLET);
        java.util.LinkedHashMap<String, Object> defaults = new java.util.LinkedHashMap<>(Map.of(
                "spring.application.name", "web-test-host",
                "server.port", "0",
                "logging.level.root", "OFF"));
        defaults.putAll(properties);
        application.setDefaultProperties(defaults);
        return application.run();
    }

    private RequestPostProcessor principal(boolean role) {
        return request -> {
            request.setUserPrincipal(() -> "test-user");
            if (role) {
                request.addUserRole("MAP_IN_BOOT_ADMIN");
            }
            return request;
        };
    }

    private void await(Check check) {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!check.done() && System.nanoTime() < deadline) {
            Thread.onSpinWait();
        }
        if (!check.done()) {
            throw new AssertionError("비동기 분석 결과가 제한 시간 내 생성되지 않았습니다.");
        }
    }

    private long managedFileCount(Path directory) throws Exception {
        try (var paths = Files.list(directory)) {
            return paths.filter(path -> path.getFileName().toString().matches("snapshot-[0-9a-fA-F-]{36}\\.json"))
                    .count();
        }
    }

    private Snapshot previousSnapshot() {
        Evidence evidence = new Evidence("previous-evidence", EvidenceSource.RUNTIME, "runtime", "previous endpoint");
        Fact fact = new Fact("previous-fact", "ENDPOINT_MAPPING", "previous-endpoint",
                Map.of("httpMethod", "GET", "path", "/previous", "handler", "Previous#handle"),
                List.of(evidence.id()));
        CollectionReport collection = new CollectionReport(
                List.of(fact), List.of(evidence), Map.of("collector", AnalysisStatus.READY), List.of());
        AnalysisResult result = new AnalysisResult("analyzer", List.of(), List.of(), AnalysisStatus.READY, List.of());
        com.mapinboot.core.analysis.model.AnalysisReport analysis = new com.mapinboot.core.analysis.model.AnalysisReport(
                collection, result.relations(), List.of(evidence), Map.of("analyzer", AnalysisStatus.READY), List.of());
        Snapshot assembled = new SnapshotAssembler(List.of(), "1")
                .assemble(analysis, "partial-host", "previous-instance", "test");
        return new Snapshot(assembled.snapshotId(), Instant.parse("2026-10-30T00:00:00Z"), assembled.schemaVersion(),
                assembled.sdkVersion(), assembled.serviceId(), assembled.instanceId(), assembled.applicationVersion(),
                assembled.graphFingerprint(), assembled.nodes(), assembled.edges(), assembled.evidence(), assembled.findings(),
                assembled.analysisStatus());
    }

    @FunctionalInterface
    private interface Check {
        boolean done();
    }

    @SpringBootApplication(scanBasePackages = "com.mapinboot.testhost")
    @EnableAutoConfiguration
    static class AccessHost {
        @RestController
        static class HostController {
            @GetMapping("/host")
            String host() {
                return "ok";
            }
        }
    }

    @SpringBootApplication(scanBasePackages = "com.mapinboot.testhost")
    @EnableAutoConfiguration
    static class PartialHost {
        @Bean
        PartialAnalyzer partialAnalyzer() {
            return new PartialAnalyzer();
        }

        @RestController
        static class HostController {
            @GetMapping("/partial")
            String partial() {
                return "ok";
            }
        }
    }

    @SpringBootApplication(scanBasePackages = "com.mapinboot.testhost")
    @EnableAutoConfiguration
    static class SecurityHost {
        @Bean
        SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
            return http
                    .csrf(csrf -> csrf.disable())
                    .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
                    .httpBasic(Customizer.withDefaults())
                    .build();
        }

        @Bean
        UserDetailsService userDetailsService() {
            return new InMemoryUserDetailsManager(
                    User.withUsername("admin")
                            .password("{noop}password")
                            .roles("MAP_IN_BOOT_ADMIN")
                            .build(),
                    User.withUsername("viewer")
                            .password("{noop}password")
                            .roles("MAP_IN_BOOT_VIEWER")
                            .build());
        }

        @RestController
        static class HostController {
            @GetMapping("/host")
            String host() {
                return "ok";
            }
        }
    }

    static class PartialAnalyzer extends AbstractAnalysisAdapter {
        PartialAnalyzer() {
            super("analyzer", "test partial analyzer", Set.of(EdgeType.FLOWS_TO.name()));
        }

        @Override
        public Set<String> requiredFactTypes() {
            return Set.of("ENDPOINT_MAPPING");
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.PARTIAL,
                    List.of(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                            "secret-token=/var/run/mapinboot/token")));
        }
    }
}
