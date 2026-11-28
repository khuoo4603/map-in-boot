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
import com.mapinboot.starter.web.api.StatusController;
import com.mapinboot.starter.web.access.WebAccessGuard;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.web.auth.LoginController;
import com.mapinboot.starter.web.auth.SdkLoginService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WebAccessSmokeIntegrationTest {
    @TempDir
    Path tempDirectory;

    @Test
    void loginRequestToStringDoesNotExposePassword() {
        String password = "sensitive-sdk-password";
        var request = new com.mapinboot.starter.web.auth.LoginController.LoginRequest(password);

        assertFalse(request.toString().contains(password));
    }

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
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("data-ui-shell")));
            mvc.perform(get("/mapinboot/app.css"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/css")));
            mvc.perform(get("/mapinboot/app.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")));
            mvc.perform(get("/mapinboot/spotlight.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("MapInBootSpotlight")));
            mvc.perform(get("/mapinboot/graph-flow.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")));
            mvc.perform(get("/mapinboot/request-flow-animation.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")));
            mvc.perform(get("/mapinboot/graph-standard-filters.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")));
            mvc.perform(get("/mapinboot/graph-navigation.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("MapInBootNavigation")));
            mvc.perform(get("/mapinboot/graph-inspector.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("MapInBootInspector")));
            mvc.perform(get("/mapinboot/vendor/elk-api.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("ELK")));
            mvc.perform(get("/mapinboot/vendor/elk-worker.min.js"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")));
            mvc.perform(get("/mapinboot/assets/mapinboot_logo_transparent.png"))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.IMAGE_PNG));
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
    void developAnonymousPreviewAllowsOnlySdkUiAndReadOnlyApis() throws Exception {
        Path directory = tempDirectory.resolve("preview-file-target");
        Files.writeString(directory, "not-a-directory");

        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.anonymous-preview", "true",
                        "mapinboot.snapshot.directory", directory.toString()))) {
            assertTrue(WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(
                    context.getBean(MapInBootProperties.class), context.getEnvironment()));
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.failureCode() != null || bootstrap.snapshot() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.persistedSnapshotPresent").value(false));
            mvc.perform(get("/mapinboot/api/snapshot")).andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test/api/report")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/smoke.txt")).andExpect(status().isUnauthorized());
            mvc.perform(post("/mapinboot/api/snapshot")).andExpect(status().isMethodNotAllowed());
        }
    }

    @Test
    void explicitHostModeKeepsUiPublicAndDisablesAnonymousPreview() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "HOST",
                        "mapinboot.web.anonymous-preview", "true",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("explicit-host").toString()))) {
            assertFalse(WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(
                    context.getBean(MapInBootProperties.class), context.getEnvironment()));
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/app.css")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/status").with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void noneModeAllowsFormalUiAndReadOnlyApisButKeepsDiagnosticsProtected() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "NONE",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("none-mode").toString()))) {
            assertTrue(WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(
                    context.getBean(MapInBootProperties.class), context.getEnvironment()));
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/app.css")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/snapshot")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/test")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test").with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/test").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/smoke.txt")).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void passwordUiUsesSdkEntryPathAndProtectsApiAndSdkResources() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-login-ui").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/").header("Accept", "text/html"))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"login-form\"")));
            mvc.perform(get("/mapinboot/index.html").header("Accept", "text/html"))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"login-form\"")));
            mvc.perform(get("/mapinboot/app.js")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/status")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/login")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/login.css")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/login.js")).andExpect(status().isOk());

            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"test-secret\"}"))
                    .andExpect(status().isOk());
            mvc.perform(get("/mapinboot/").session(session).header("Accept", "text/html"))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("data-ui-shell")));
        }
    }

    @Test
    void passwordModeBindsSpringConfigurationProperties() {
        MockEnvironment environment = new MockEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("test-configuration", Map.of(
                "mapinboot.enabled", "true",
                "mapinboot.web.enabled", "true",
                "mapinboot.web.auth-mode", "PASSWORD",
                "mapinboot.web.login.password", "environment-test-secret",
                "mapinboot.web.login.session-timeout", "45m",
                "mapinboot.snapshot.directory", tempDirectory.resolve("password-env-binding").toString())));
        MapInBootProperties properties = Binder.get(environment)
                .bind("mapinboot", Bindable.of(MapInBootProperties.class))
                .orElseThrow(IllegalStateException::new);
        properties.afterPropertiesSet();

        assertEquals(com.mapinboot.starter.autoconfigure.WebAuthMode.PASSWORD,
                properties.getWeb().getAuthMode());
        assertEquals("environment-test-secret", properties.getWeb().getLogin().getPassword());
        assertEquals(Duration.ofMinutes(45), properties.getWeb().getLogin().getSessionTimeout());
    }

    @Test
    void authStatusIsAvailableInEveryModeAndCreatesSessionOnlyForPassword() throws Exception {
        try (ConfigurableApplicationContext hostContext = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "HOST",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("auth-status-host").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) hostContext).build();
            MvcResult result = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.mode").value("HOST"))
                    .andExpect(jsonPath("$.authenticated").value(false))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andReturn();
            assertNull(result.getRequest().getSession(false));
            mvc.perform(get("/mapinboot/api/auth/status").with(principal(false)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(true));
            mvc.perform(post("/mapinboot/api/auth/login").content("{}"))
                    .andExpect(status().isNotFound());
            mvc.perform(post("/mapinboot/api/auth/logout"))
                    .andExpect(status().isNotFound());
        }

        try (ConfigurableApplicationContext noneContext = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "NONE",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("auth-status-none").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) noneContext).build();
            MvcResult result = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.mode").value("NONE"))
                    .andExpect(jsonPath("$.authenticated").value(false))
                    .andReturn();
            assertNull(result.getRequest().getSession(false));
            mvc.perform(post("/mapinboot/api/auth/login").content("{}"))
                    .andExpect(status().isNotFound());
            mvc.perform(post("/mapinboot/api/auth/logout"))
                    .andExpect(status().isNotFound());
        }

        try (ConfigurableApplicationContext passwordContext = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("auth-status-password").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) passwordContext).build();
            MvcResult result = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.mode").value("PASSWORD"))
                    .andExpect(jsonPath("$.authenticated").value(false))
                    .andExpect(jsonPath("$.csrfToken").isNotEmpty())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andReturn();
            assertNotNull(result.getRequest().getSession(false));
        }
    }

    @Test
    void passwordLoginRotatesSessionAndLogoutPreservesHostAttributes() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "correct horse battery",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-login").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String originalSessionId = session.getId();
            session.setAttribute("host.attribute", "preserved");
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();

            MvcResult loginResult = mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"correct horse battery\"}"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(content().string(org.hamcrest.Matchers.not(
                            org.hamcrest.Matchers.containsString("correct horse battery"))))
                    .andReturn();
            assertNotEquals(originalSessionId, session.getId());
            assertEquals("preserved", session.getAttribute("host.attribute"));

            MvcResult authenticatedStatus = mvc.perform(get("/mapinboot/api/auth/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(true))
                    .andReturn();
            String rotatedToken = JsonMapper.builder().build()
                    .readTree(authenticatedStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            assertNotEquals(csrfToken, rotatedToken);

            mvc.perform(post("/mapinboot/api/auth/logout")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/mapinboot/api/auth/logout")
                            .session(session)
                            .header("X-MapInBoot-CSRF", rotatedToken))
                    .andExpect(status().isNoContent())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/api/auth/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false));
            assertEquals("preserved", session.getAttribute("host.attribute"));
            assertNotNull(loginResult.getRequest().getSession(false));
        }
    }

    @Test
    void passwordLoginRejectsMalformedInputWrongPasswordAndMissingCsrf() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-errors").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();

            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.TEXT_PLAIN)
                            .content("{\"password\":\"test-secret\"}"))
                    .andExpect(status().isBadRequest());
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"username\":\"admin\"}"))
                    .andExpect(status().isBadRequest());
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":"))
                    .andExpect(status().isBadRequest());
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"wrong\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"wrong\"}"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/auth/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false));
        }
    }

    @Test
    void passwordSessionExpiresAfterConfiguredAbsoluteTimeout() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.web.login.session-timeout", "300ms",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-expiry").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"test-secret\"}"))
                    .andExpect(status().isOk());
            MvcResult authenticatedStatus = mvc.perform(get("/mapinboot/api/auth/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(true))
                    .andReturn();
            String authenticatedCsrfToken = JsonMapper.builder().build()
                    .readTree(authenticatedStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();

            Thread.sleep(400);

            mvc.perform(post("/mapinboot/api/auth/logout")
                            .session(session)
                            .header("X-MapInBoot-CSRF", authenticatedCsrfToken))
                    .andExpect(status().isForbidden());
            MvcResult expiredStatus = mvc.perform(get("/mapinboot/api/auth/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false))
                    .andReturn();
            assertNotNull(JsonMapper.builder().build()
                    .readTree(expiredStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText());
            mvc.perform(get("/mapinboot/").session(session))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"login-form\"")));
        }
    }

    @Test
    void passwordCsrfTokenIssuanceIsAtomicWithinSession() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-csrf-race").toString()))) {
            SdkLoginService loginService = context.getBean(SdkLoginService.class);
            CoordinatedCsrfSession session = new CoordinatedCsrfSession();
            var firstRequest = new MockHttpServletRequest();
            firstRequest.setSession(session);
            var secondRequest = new MockHttpServletRequest();
            secondRequest.setSession(session);

            ExecutorService executor = Executors.newFixedThreadPool(2);
            try {
                Future<String> first = executor.submit(() -> loginService.csrfToken(firstRequest));
                Future<String> second = executor.submit(() -> loginService.csrfToken(secondRequest));
                assertEquals(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS));
            } finally {
                executor.shutdownNow();
            }
        }
    }

    @Test
    void authStatusStringRepresentationDoesNotContainCsrfToken() {
        LoginController.AuthStatus status = new LoginController.AuthStatus(
                com.mapinboot.starter.autoconfigure.WebAuthMode.PASSWORD,
                false,
                "sensitive-csrf-token");

        assertFalse(status.toString().contains("sensitive-csrf-token"));
    }

    @Test
    void passwordModeProtectsMvcMappedAliasesFromHostOnlyAccess() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-mapped-aliases").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status;version=1").with(principal(true)))
                    .andExpect(status().isBadRequest());
            mvc.perform(get("/mapinboot/test;version=1").with(principal(true)))
                    .andExpect(status().isBadRequest());
            mvc.perform(get("/mapinboot//app.js").with(principal(true)))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void passwordAuthExceptionsUseExactContextAwarePaths() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-context-path").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            MvcResult statusResult = mvc.perform(get("/tenant/mapinboot/api/auth/status").contextPath("/tenant"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/tenant/mapinboot/api/auth/login")
                            .contextPath("/tenant")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"test-secret\"}"))
                    .andExpect(status().isOk());
            mvc.perform(get("/tenant/mapinboot/").contextPath("/tenant").session(session))
                    .andExpect(status().isOk());
            mvc.perform(get("/tenant/mapinboot/api/status").contextPath("/tenant").session(session))
                    .andExpect(status().isOk());

            MapInBootProperties properties = context.getBean(MapInBootProperties.class);
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setContextPath("/tenant");
            request.setRequestURI("/tenant/mapinboot/api/auth/status");
            request.setMethod("POST");
            request.setSession(session);
            assertEquals(HttpStatus.UNAUTHORIZED,
                    WebAccessGuard.deniedStatus(request, properties, context.getEnvironment()));
            request.setMethod("GET");
            request.setRequestURI("/tenant/mapinboot/api/auth/login");
            assertEquals(HttpStatus.UNAUTHORIZED,
                    WebAccessGuard.deniedStatus(request, properties, context.getEnvironment()));
            request.setMethod("POST");
            request.setRequestURI("/tenant/mapinboot/api/auth/login/");
            assertEquals(HttpStatus.UNAUTHORIZED,
                    WebAccessGuard.deniedStatus(request, properties, context.getEnvironment()));
            request.setMethod("GET");
            request.setRequestURI("/tenant/mapinboot/api/auth/status");
            assertNull(WebAccessGuard.deniedStatus(request, properties, context.getEnvironment()));
        }
    }

    @Test
    void passwordLoginFailsClosedWhenSecretIsBlankWithoutStoppingSdk() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "   ",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-missing-secret").toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session((MockHttpSession) statusResult.getRequest().getSession(false))
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"any\"}"))
                    .andExpect(status().isServiceUnavailable());
            assertNotNull(bootstrap.persistedSnapshot());
        }
    }

    @Test
    void passwordLoginLimitSurvivesNewSessionsAndIgnoresForwardedAddress() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-limit").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            for (int attempt = 0; attempt < 5; attempt++) {
                MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status")
                                .with(request -> {
                                    request.setRemoteAddr("198.51.100.23");
                                    return request;
                                }))
                        .andExpect(status().isOk())
                        .andReturn();
                MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
                String csrfToken = JsonMapper.builder().build()
                        .readTree(statusResult.getResponse().getContentAsString())
                        .get("csrfToken").asText();
                mvc.perform(post("/mapinboot/api/auth/login")
                                .session(session)
                                .header("X-MapInBoot-CSRF", csrfToken)
                                .header("X-Forwarded-For", "203.0.113." + (attempt + 1))
                                .with(request -> {
                                    request.setRemoteAddr("198.51.100.23");
                                    return request;
                                })
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"password\":\"wrong\"}"))
                        .andExpect(status().isUnauthorized());
            }

            MvcResult newStatus = mvc.perform(get("/mapinboot/api/auth/status")
                            .with(request -> {
                                request.setRemoteAddr("198.51.100.23");
                                return request;
                            }))
                    .andExpect(status().isOk())
                    .andReturn();
            String csrfToken = JsonMapper.builder().build()
                    .readTree(newStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session((MockHttpSession) newStatus.getRequest().getSession(false))
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .header("X-Forwarded-For", "192.0.2.99")
                            .with(request -> {
                                request.setRemoteAddr("198.51.100.23");
                                return request;
                            })
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"wrong\"}"))
                    .andExpect(status().isTooManyRequests());
        }
    }

    @Test
    void passwordModeProtectsSdkResourcesAndKeepsDiagnosticsHostProtected() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.anonymous-preview", "true",
                        "mapinboot.web.login.password", "test-secret",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-policy").toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/"))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"login-form\"")));
            mvc.perform(get("/mapinboot/app.js")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/status")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isUnauthorized());

            MvcResult statusResult = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession session = (MockHttpSession) statusResult.getRequest().getSession(false);
            String csrfToken = JsonMapper.builder().build()
                    .readTree(statusResult.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(session)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"test-secret\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get("/mapinboot/").session(session))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/app.js").session(session))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/api/status").session(session))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/api/snapshot").session(session))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));

            mvc.perform(get("/mapinboot/test").session(session)).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test").session(session).with(principal(false)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/test").session(session).with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/test/api/report").session(session).with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css")
                            .session(session)
                            .with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/smoke.txt").session(session)).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/smoke.txt").session(session).with(principal(true)))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void passwordModeWithBlankSecretFailsClosedWithoutHostFallback() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "  ",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-blank-policy").toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"login-form\"")));
            mvc.perform(get("/mapinboot/app.js").with(principal(true))).andExpect(status().isServiceUnavailable());
            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isServiceUnavailable());
            mvc.perform(get("/mapinboot/test").with(principal(true)))
                    .andExpect(status().isServiceUnavailable());
            assertNotNull(bootstrap.persistedSnapshot());
        }
    }

    @Test
    void noneModeReadResponsesAreNotCachedAndSdkDisableOverridesMode() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "NONE",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("none-no-store").toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/api/snapshot"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/smoke.txt")).andExpect(status().isUnauthorized());
            mvc.perform(post("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isMethodNotAllowed());
        }

        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "mapinboot.enabled", "false",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "NONE",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("sdk-disabled").toString()))) {
            assertFalse(WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(
                    context.getBean(MapInBootProperties.class), context.getEnvironment()));
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/").with(principal(true))).andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/api/auth/status")).andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/api/status").with(principal(true))).andExpect(status().isNotFound());
        }
    }

    @Test
    void anonymousPreviewFlagDoesNotOpenApiOutsideDevelopProfile() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "production",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.anonymous-preview", "true",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("production-preview").toString()))) {
            assertFalse(WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(
                    context.getBean(MapInBootProperties.class), context.getEnvironment()));
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/")).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status")).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/snapshot")).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void disabledWebDoesNotRegisterSdkRoutes() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "false",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("snapshots").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css").with(principal(true)))
                    .andExpect(status().isNotFound());
        }

        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.enabled", "false",
                        "mapinboot.web.enabled", "true"))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/smoke.txt").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css").with(principal(true)))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void developmentDiagnosticRouteIsUnavailableOutsideDevelopProfile() throws Exception {
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "production",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("production-snapshots").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/test").with(principal(true)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true)))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void diagnosticConversionPreservesDetailedSummaryAndUsesSafeFallback() {
        List<StatusController.DiagnosticResponse> responses = StatusController.StatusResponse.toDiagnostics(List.of(
                new AdapterDiagnostic("adapter-a", ErrorCode.INVALID_STATE, "객체 인가 경로 2건의 매핑 범위 미확인"),
                new AdapterDiagnostic("adapter-b", ErrorCode.INVALID_STATE, "객체 인가 경로 1건의 매핑 범위 미확인"),
                new AdapterDiagnostic("adapter-c", ErrorCode.INVALID_STATE, null),
                new AdapterDiagnostic("adapter-d", ErrorCode.INVALID_STATE, "   "),
                new AdapterDiagnostic("adapter-e", null, "상세 원인")));

        assertEquals("adapter-a", responses.get(0).adapterId());
        assertEquals("MIB-004", responses.get(0).errorCode());
        assertEquals("객체 인가 경로 2건의 매핑 범위 미확인", responses.get(0).summary());
        assertEquals("객체 인가 경로 1건의 매핑 범위 미확인", responses.get(1).summary());
        assertEquals(ErrorCode.INVALID_STATE.getDescription(), responses.get(2).summary());
        assertEquals(ErrorCode.INVALID_STATE.getDescription(), responses.get(3).summary());
        assertEquals("상세 원인", responses.get(4).summary());
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
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.snapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.analysisStatuses.analyzer").value("PARTIAL"))
                    .andExpect(jsonPath("$.diagnostics[0].summary").value("분석 대상 경로의 일부를 확인하지 못함"))
                    .andExpect(jsonPath("$.persistedSnapshotPresent").value(true))
                    .andExpect(jsonPath("$.persistedSnapshotId").value(previous.snapshotId()));
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.snapshotId").value(previous.snapshotId()));
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.phase").value("PARTIAL"))
                    .andExpect(jsonPath("$.collectionPresent").value(true))
                    .andExpect(jsonPath("$.analysisPresent").value(true))
                    .andExpect(jsonPath("$.analysisStatuses.analyzer").value("PARTIAL"))
                    .andExpect(jsonPath("$.diagnostics[0].summary").value("분석 대상 경로의 일부를 확인하지 못함"))
                    .andExpect(jsonPath("$.currentSnapshotPresent").value(true))
                    .andExpect(jsonPath("$.currentSnapshot.snapshotId").value(bootstrap.snapshot().snapshotId()))
                    .andExpect(jsonPath("$.persistedSnapshotPresent").value(true))
                    .andExpect(jsonPath("$.persistedSnapshot.snapshotId").value(previous.snapshotId()))
                    .andExpect(jsonPath("$.persistedSnapshot.capturedAt").value(previous.capturedAt().toString()));
        }
    }

    @Test
    void readOnlyRequestsDoNotChangePersistedSnapshot() throws Exception {
        Path directory = tempDirectory.resolve("read-only-snapshots");
        try (ConfigurableApplicationContext context = start(
                AccessHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).build();
            Instant capturedAt = bootstrap.persistedSnapshot().capturedAt();
            String currentSnapshotId = bootstrap.snapshot().snapshotId();
            String phase = bootstrap.executionPhase();
            long filesBefore = managedFileCount(directory);

            mvc.perform(get("/mapinboot/api/status").with(principal(true)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.phase").value("COMPLETED"));
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/snapshot").with(principal(true))).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/test/api/report").with(principal(true))).andExpect(status().isOk());

            assertEquals(capturedAt, bootstrap.persistedSnapshot().capturedAt());
            assertEquals(currentSnapshotId, bootstrap.snapshot().snapshotId());
            assertEquals(phase, bootstrap.executionPhase());
            assertEquals(filesBefore, managedFileCount(directory));
        }
    }

    @Test
    void actualSecurityFilterChainProvidesPrincipalAndRoleToSdkAccessGuard() throws Exception {
        try (ConfigurableApplicationContext context = start(
                SecurityHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("security-snapshots").toString()))) {
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
            mvc.perform(get("/mapinboot/test"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test").with(basic("viewer", "password")))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/test").with(basic("admin", "password")))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("Map in Boot Development Diagnostics")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("data-view=\"object-authorization\"")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("data-view=\"business-state\"")));
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css").with(basic("viewer", "password")))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.css").with(basic("admin", "password")))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/css")));
            mvc.perform(get("/mapinboot/test/assets/development-diagnostic.js").with(basic("admin", "password")))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.valueOf("text/javascript")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("OBJECT_AUTHORIZATION_REQUIREMENT")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("BUSINESS_STATE_EVALUATION")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("findingsForObjectRow")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("findingsForStateRow")))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("Graph Node ID")))
                    .andExpect(content().string(org.hamcrest.Matchers.not(
                            org.hamcrest.Matchers.containsString("item.severity"))))
                    .andExpect(content().string(org.hamcrest.Matchers.not(
                            org.hamcrest.Matchers.containsString("OBJECT_BINDING Rule 미통합"))))
                    .andExpect(content().string(org.hamcrest.Matchers.not(
                            org.hamcrest.Matchers.containsString("STATE_BYPASS Rule 미통합"))));
            mvc.perform(get("/mapinboot/test/api/report"))
                    .andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/test/api/report").with(basic("viewer", "password")))
                    .andExpect(status().isForbidden());
            Snapshot beforeReport = bootstrap.snapshot();
            Snapshot beforePersisted = bootstrap.persistedSnapshot();
            assertOriginalEvidenceReferences(bootstrap);
            MvcResult firstReport = mvc.perform(get("/mapinboot/test/api/report").with(basic("admin", "password")))
                    .andExpect(status().isOk())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.collectionPresent").value(true))
                    .andExpect(jsonPath("$.analysisPresent").value(true))
                    .andExpect(jsonPath("$.currentSnapshotPresent").value(true))
                    .andExpect(jsonPath("$.facts").isArray())
                    .andExpect(jsonPath("$.facts[0].id").value(bootstrap.collectionReport().facts().get(0).id()))
                    .andExpect(jsonPath("$.relations").isArray())
                    .andExpect(jsonPath("$.evidence").isArray())
                    .andExpect(jsonPath("$.evidenceDisplayCodes").isMap())
                    .andExpect(jsonPath("$.evidenceDisplayCodes").isNotEmpty())
                    .andExpect(jsonPath("$.evidence[0].id").value(bootstrap.collectionReport().evidence().get(0).id()))
                    .andReturn();
            MvcResult secondReport = mvc.perform(get("/mapinboot/test/api/report").with(basic("admin", "password")))
                    .andExpect(status().isOk())
                    .andReturn();

            assertEquals(firstReport.getResponse().getContentAsString(), secondReport.getResponse().getContentAsString());
            assertEquals(beforeReport, bootstrap.snapshot());
            assertEquals(beforePersisted, bootstrap.persistedSnapshot());
            assertDisplayCodeMapping(firstReport.getResponse().getContentAsString());
            mvc.perform(get("/mapinboot/smoke.txt").with(basic("admin", "password")))
                    .andExpect(status().isOk());
            mvc.perform(post("/mapinboot/api/snapshot").with(basic("admin", "password")))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    void passwordSdkSessionPreservesHostSecurityAndHostCsrfInActualFilterChain() throws Exception {
        Path directory = tempDirectory.resolve("password-security-chain");
        try (ConfigurableApplicationContext context = start(
                SecurityHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "sdk-password-secret",
                        "mapinboot.snapshot.directory", directory.toString()))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failureCode() != null);
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                    .addFilters(context.getBean(FilterChainProxy.class))
                    .build();
            var collectionBefore = bootstrap.collectionReport();
            var analysisBefore = bootstrap.analysisReport();
            Snapshot currentBefore = bootstrap.snapshot();
            Snapshot persistedBefore = bootstrap.persistedSnapshot();
            long filesBefore = managedFileCount(directory);

            mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false));
            MvcResult loginPage = mvc.perform(get("/login"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession hostSession = (MockHttpSession) loginPage.getRequest().getSession(false);
            String loginCsrfToken = hostCsrfToken(loginPage);
            MvcResult hostLogin = mvc.perform(post("/login")
                            .session(hostSession)
                            .param("_csrf", loginCsrfToken)
                            .param("username", "admin")
                            .param("password", "password"))
                    .andExpect(status().is3xxRedirection())
                    .andReturn();
            hostSession = (MockHttpSession) hostLogin.getRequest().getSession(false);
            MockHttpSession identifiedHostSession = new MockHttpSession(
                    hostSession.getServletContext(), "host-session-id-auth-01-test-value");
            Enumeration<String> hostAttributes = hostSession.getAttributeNames();
            while (hostAttributes.hasMoreElements()) {
                String attributeName = hostAttributes.nextElement();
                identifiedHostSession.setAttribute(attributeName, hostSession.getAttribute(attributeName));
            }
            hostSession = identifiedHostSession;
            assertNotNull(hostSession);
            hostSession.setAttribute("host.integration.attribute", "preserved");
            String originalSessionId = hostSession.getId();
            mvc.perform(get("/host").session(hostSession)).andExpect(status().isOk());

            MvcResult sdkStatus = mvc.perform(get("/mapinboot/api/auth/status").session(hostSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false))
                    .andReturn();
            String csrfToken = JsonMapper.builder().build()
                    .readTree(sdkStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            MvcResult sdkLogin = mvc.perform(post("/mapinboot/api/auth/login")
                            .session(hostSession)
                            .header("X-MapInBoot-CSRF", csrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"sdk-password-secret\"}"))
                    .andReturn();
            assertEquals(200, sdkLogin.getResponse().getStatus());

            assertNotEquals(originalSessionId, hostSession.getId());
            assertEquals("preserved", hostSession.getAttribute("host.integration.attribute"));
            mvc.perform(get("/host").session(hostSession)).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").session(hostSession))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"));
            mvc.perform(get("/mapinboot/test").session(hostSession)).andExpect(status().isOk());

            String businessCsrfToken = hostCsrfToken(
                    mvc.perform(get("/login").session(hostSession)).andExpect(status().isOk()).andReturn());
            mvc.perform(post("/host/update").session(hostSession)).andExpect(status().isForbidden());
            mvc.perform(post("/host/update")
                            .session(hostSession)
                            .param("_csrf", businessCsrfToken))
                    .andExpect(status().isOk());
            mvc.perform(post("/mapinboot/api/auth/status").session(hostSession))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/mapinboot/api/auth/login/extra").session(hostSession))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/mapinboot/api/snapshot").session(hostSession))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/mapinboot/api/snapshot")
                            .session(hostSession)
                            .param("_csrf", businessCsrfToken))
                    .andExpect(status().isMethodNotAllowed());

            MvcResult anonymousStatus = mvc.perform(get("/mapinboot/api/auth/status"))
                    .andExpect(status().isOk())
                    .andReturn();
            MockHttpSession sdkOnlySession = (MockHttpSession) anonymousStatus.getRequest().getSession(false);
            String anonymousCsrfToken = JsonMapper.builder().build()
                    .readTree(anonymousStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(sdkOnlySession)
                            .header("X-MapInBoot-CSRF", anonymousCsrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"sdk-password-secret\"}"))
                    .andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").session(sdkOnlySession)).andExpect(status().isOk());
            mvc.perform(get("/host").session(sdkOnlySession)).andExpect(status().isUnauthorized());
            String sdkOnlyHostCsrfToken = hostCsrfToken(
                    mvc.perform(get("/login").session(sdkOnlySession)).andExpect(status().isOk()).andReturn());
            mvc.perform(post("/host/update").session(sdkOnlySession)
                            .param("_csrf", sdkOnlyHostCsrfToken))
                    .andExpect(status().isUnauthorized());

            MvcResult hostSdkStatus = mvc.perform(get("/mapinboot/api/auth/status").session(hostSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(true))
                    .andReturn();
            String logoutToken = JsonMapper.builder().build()
                    .readTree(hostSdkStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/logout")
                            .session(hostSession)
                            .header("X-MapInBoot-CSRF", logoutToken))
                    .andExpect(status().isNoContent());
            mvc.perform(get("/host").session(hostSession)).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").session(hostSession)).andExpect(status().isUnauthorized());
            assertEquals("preserved", hostSession.getAttribute("host.integration.attribute"));

            assertTrue(bootstrap.collectionReport().facts().stream().anyMatch(fact ->
                    "POST".equals(fact.attributes().get("httpMethod"))
                            && "/mapinboot/api/auth/login".equals(fact.attributes().get("path"))));
            String collected = bootstrap.collectionReport().facts().toString()
                    + bootstrap.collectionReport().evidence()
                    + bootstrap.snapshot()
                    + bootstrap.persistedSnapshot();
            assertFalse(collected.contains("sdk-password-secret"));
            assertFalse(collected.contains(originalSessionId));
            assertFalse(collected.contains(csrfToken));
            assertFalse(collected.contains(logoutToken));
            assertEquals(collectionBefore, bootstrap.collectionReport());
            assertEquals(analysisBefore, bootstrap.analysisReport());
            assertEquals(currentBefore, bootstrap.snapshot());
            assertEquals(persistedBefore, bootstrap.persistedSnapshot());
            assertEquals(filesBefore, managedFileCount(directory));
        }
    }

    @Test
    void sdkSessionExpiryPreservesHostPrincipalAndRole() throws Exception {
        try (ConfigurableApplicationContext context = start(
                SecurityHost.class,
                Map.of(
                        "spring.profiles.active", "develop",
                        "mapinboot.web.enabled", "true",
                        "mapinboot.web.auth-mode", "PASSWORD",
                        "mapinboot.web.login.password", "sdk-password-secret",
                        "mapinboot.web.login.session-timeout", "300ms",
                        "mapinboot.snapshot.directory", tempDirectory.resolve("password-expiry-host").toString()))) {
            MockMvc mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                    .addFilters(context.getBean(FilterChainProxy.class))
                    .build();
            MvcResult loginPage = mvc.perform(get("/login")).andExpect(status().isOk()).andReturn();
            MockHttpSession hostSession = (MockHttpSession) loginPage.getRequest().getSession(false);
            String hostCsrfToken = hostCsrfToken(loginPage);
            MvcResult hostLogin = mvc.perform(post("/login")
                            .session(hostSession)
                            .param("_csrf", hostCsrfToken)
                            .param("username", "admin")
                            .param("password", "password"))
                    .andExpect(status().is3xxRedirection())
                    .andReturn();
            hostSession = (MockHttpSession) hostLogin.getRequest().getSession(false);

            MvcResult sdkStatus = mvc.perform(get("/mapinboot/api/auth/status").session(hostSession))
                    .andExpect(status().isOk())
                    .andReturn();
            String sdkCsrfToken = JsonMapper.builder().build()
                    .readTree(sdkStatus.getResponse().getContentAsString())
                    .get("csrfToken").asText();
            mvc.perform(post("/mapinboot/api/auth/login")
                            .session(hostSession)
                            .header("X-MapInBoot-CSRF", sdkCsrfToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"password\":\"sdk-password-secret\"}"))
                    .andExpect(status().isOk());

            Thread.sleep(400);

            mvc.perform(get("/host").session(hostSession)).andExpect(status().isOk());
            mvc.perform(get("/mapinboot/api/status").session(hostSession)).andExpect(status().isUnauthorized());
            mvc.perform(get("/mapinboot/api/auth/status").session(hostSession))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.authenticated").value(false));
        }
    }

    private void assertDisplayCodeMapping(String responseBody) throws Exception {
        JsonNode report = JsonMapper.builder().build().readTree(responseBody);
        JsonNode evidence = report.get("evidence");
        JsonNode displayCodes = report.get("evidenceDisplayCodes");
        Set<String> evidenceIds = new HashSet<>();
        Set<String> codes = new HashSet<>();
        for (JsonNode item : evidence) {
            String evidenceId = item.get("id").asText();
            evidenceIds.add(evidenceId);
            assertTrue(displayCodes.has(evidenceId));
            String displayCode = displayCodes.get(evidenceId).asText();
            assertTrue(displayCode.matches("[A-Z]{2}-[A-Z0-9_]+-[0-9]{3,}"));
            codes.add(displayCode);
        }
        assertEquals(evidenceIds.size(), displayCodes.size());
        assertEquals(evidenceIds.size(), codes.size());
        for (String fieldName : displayCodes.propertyNames()) {
            assertTrue(evidenceIds.contains(fieldName));
        }
        assertReferencesHaveDisplayCodes(report.get("facts"), displayCodes);
        assertReferencesHaveDisplayCodes(report.get("relations"), displayCodes);
        JsonNode currentSnapshot = report.get("currentSnapshot");
        assertReferencesHaveDisplayCodes(currentSnapshot.get("nodes"), displayCodes);
        assertReferencesHaveDisplayCodes(currentSnapshot.get("edges"), displayCodes);
        assertReferencesHaveDisplayCodes(currentSnapshot.get("findings"), displayCodes);
    }

    private void assertReferencesHaveDisplayCodes(JsonNode objects, JsonNode displayCodes) {
        for (JsonNode object : objects) {
            for (JsonNode evidenceId : object.get("evidenceIds")) {
                assertTrue(displayCodes.has(evidenceId.asText()));
            }
        }
    }

    private void assertOriginalEvidenceReferences(MapInBootBootstrap bootstrap) {
        Set<String> evidenceIds = new HashSet<>();
        bootstrap.snapshot().evidence().forEach(evidence -> evidenceIds.add(evidence.id()));
        assertTrue(bootstrap.collectionReport().facts().stream()
                .flatMap(fact -> fact.evidenceIds().stream())
                .allMatch(evidenceIds::contains));
        assertTrue(bootstrap.analysisReport().relations().stream()
                .flatMap(relation -> relation.evidenceIds().stream())
                .allMatch(evidenceIds::contains));
        assertTrue(bootstrap.snapshot().nodes().stream()
                .flatMap(node -> node.evidenceIds().stream())
                .allMatch(evidenceIds::contains));
        assertTrue(bootstrap.snapshot().edges().stream()
                .flatMap(edge -> edge.evidenceIds().stream())
                .allMatch(evidenceIds::contains));
        assertTrue(bootstrap.snapshot().findings().stream()
                .flatMap(finding -> finding.evidenceIds().stream())
                .allMatch(evidenceIds::contains));
    }

    private RequestPostProcessor basic(String username, String password) {
        String credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));
        return request -> {
            request.addHeader("Authorization", "Basic " + credentials);
            return request;
        };
    }

    private String hostCsrfToken(MvcResult loginPage) throws Exception {
        Matcher matcher = Pattern.compile("name=\"_csrf\"[^>]*value=\"([^\"]+)\"")
                .matcher(loginPage.getResponse().getContentAsString());
        if (!matcher.find()) {
            throw new AssertionError("호스트 로그인 화면에서 CSRF 입력값을 찾지 못했습니다.");
        }
        return matcher.group(1);
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
        Snapshot assembled = new SnapshotAssembler(List.of())
                .assemble(analysis, "partial-host", "previous-instance", "test", com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler.unknown());
        return new Snapshot(assembled.snapshotId(), Instant.parse("2026-10-30T00:00:00Z"), assembled.schemaVersion(),
                assembled.sdkVersion(), assembled.serviceId(), assembled.instanceId(), assembled.applicationVersion(),
                assembled.graphFingerprint(), assembled.nodes(), assembled.edges(), assembled.evidence(), assembled.findings(),
                assembled.analysisStatus(), assembled.evidenceDisplayCodes(), assembled.runtimeArchitecture());
    }

    @FunctionalInterface
    private interface Check {
        boolean done();
    }

    private static final class CoordinatedCsrfSession extends MockHttpSession {
        private static final String CSRF_TOKEN = "mapinboot.sdk.auth.csrf-token";
        private static final String CSRF_EXPIRES_AT = "mapinboot.sdk.auth.csrf-expires-at";

        private final CountDownLatch tokenReads = new CountDownLatch(2);
        private final CountDownLatch expiryReads = new CountDownLatch(2);

        @Override
        public Object getAttribute(String name) {
            Object value = super.getAttribute(name);
            CountDownLatch latch = CSRF_TOKEN.equals(name) ? tokenReads
                    : CSRF_EXPIRES_AT.equals(name) ? expiryReads : null;
            if (value == null && latch != null && !Thread.holdsLock(this)) {
                latch.countDown();
                try {
                    if (!latch.await(2, TimeUnit.SECONDS)) {
                        throw new AssertionError("동시 CSRF 발급 요청이 대기 시간 안에 도달하지 못했습니다.");
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError("동시 CSRF 발급 요청이 중단되었습니다.", exception);
                }
            }
            return value;
        }
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
        SecurityFilterChain securityFilterChain(
                HttpSecurity http, MapInBootProperties properties, Environment environment) throws Exception {
            Set<String> sdkAuthPosts = Set.of(WebAccessGuard.authPostPaths());
            boolean sdkReadApiPassThrough = WebAccessGuard.isSdkReadApiFilterPassThroughEnabled(properties, environment);
            return http
                    .csrf(csrf -> csrf.ignoringRequestMatchers(request ->
                            "POST".equalsIgnoreCase(request.getMethod())
                                    && sdkAuthPosts.contains(applicationPath(request.getRequestURI(), request.getContextPath()))))
                    .authorizeHttpRequests(authorize -> {
                        authorize.requestMatchers(HttpMethod.GET, WebAccessGuard.publicUiPaths()).permitAll();
                        authorize.requestMatchers(HttpMethod.GET, WebAccessGuard.authStatusPaths()).permitAll();
                        authorize.requestMatchers(HttpMethod.POST, WebAccessGuard.authPostPaths()).permitAll();
                        if (sdkReadApiPassThrough) {
                            authorize.requestMatchers(HttpMethod.GET, WebAccessGuard.previewApiPaths()).permitAll();
                        }
                        authorize.anyRequest().authenticated();
                    })
                    .formLogin(form -> form.permitAll())
                    .httpBasic(Customizer.withDefaults())
                    .build();
        }

        private static String applicationPath(String requestUri, String contextPath) {
            return contextPath == null || contextPath.isEmpty() || !requestUri.startsWith(contextPath)
                    ? requestUri
                    : requestUri.substring(contextPath.length());
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

            @PostMapping("/host/update")
            String update() {
                return "updated";
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
                            "분석 대상 경로의 일부를 확인하지 못함")));
        }
    }
}
