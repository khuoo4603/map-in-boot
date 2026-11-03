package com.mapinboot.demo.main;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Main 서비스 공개 공지 API 통합 테스트
 */
@SpringBootTest
@TestPropertySource(properties = {
    "demo.jwt.issuer=demo-identity",
    "demo.jwt.audience=demo-services"
})
class MainPublicApiIntegrationTest {

    @TempDir
    static Path tempDir;

    private static RSAPrivateKey testPrivateKey;
    private static HttpServer accountServer;
    private static final String INTERNAL_SERVICE_USERNAME = "main-service";
    private static final String INTERNAL_SERVICE_SECRET = UUID.randomUUID().toString();
    private static final AtomicReference<String> forwardedAuthorization = new AtomicReference<>();
    private static final AtomicReference<String> forwardedUser = new AtomicReference<>();

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void configureJwtKey(DynamicPropertyRegistry registry) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair keyPair = kpg.generateKeyPair();
        testPrivateKey = (RSAPrivateKey) keyPair.getPrivate();

        String publicPem = "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(keyPair.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----\n";

        Path publicKeyPath = tempDir.resolve("test-jwt-public.pem");
        try (FileOutputStream fos = new FileOutputStream(publicKeyPath.toFile())) {
            fos.write(publicPem.getBytes());
        }

        registry.add("demo.jwt.public-key-path", publicKeyPath::toString);

        accountServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        accountServer.createContext("/internal/secured/accounts/ACC001/summary",
                exchange -> respondAccountSummary(exchange, "ACC001", "USER001", 1250000));
        accountServer.createContext("/internal/accounts/ACC001/summary",
                exchange -> respondAccountSummary(exchange, "ACC001", "USER001", 1250000));
        accountServer.createContext("/internal/secured/accounts/ACC002/summary",
                MainPublicApiIntegrationTest::respondForbidden);
        accountServer.createContext("/internal/secured/accounts/AUTHFAIL/summary", exchange -> {
            exchange.sendResponseHeaders(401, -1);
            exchange.close();
        });
        accountServer.createContext("/internal/accounts/ACC002/summary",
                exchange -> respondAccountSummary(exchange, "ACC002", "USER002", 2800000));
        accountServer.start();

        registry.add("app.services.account-url",
                () -> "http://localhost:" + accountServer.getAddress().getPort());
        registry.add("app.services.account-service-username", () -> INTERNAL_SERVICE_USERNAME);
        registry.add("app.services.account-service-secret", () -> INTERNAL_SERVICE_SECRET);
    }

    @AfterAll
    static void stopAccountServer() {
        if (accountServer != null) {
            accountServer.stop(0);
        }
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    @DisplayName("익명 공지 조회 시 Fixture 3건 반환")
    void anonymousSeesPublicNotices() throws Exception {
        mockMvc.perform(get("/api/public/notices"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[*].noticeId", containsInAnyOrder("NOTICE001", "NOTICE002", "NOTICE003")));
    }

    @Test
    @DisplayName("공지 이외의 보호 API는 익명 요청 차단")
    void otherApiRemainsProtected() throws Exception {
        mockMvc.perform(get("/api/protected"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Portal 계좌 API가 JWT sub와 서비스 인증으로 Account를 호출")
    void portalAccountSummaryForwardsAuthenticatedUserToAccount() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), Instant.now().plusSeconds(3600));

        mockMvc.perform(get("/api/portal/secured/accounts/ACC001/summary")
                        .header("Authorization", "Bearer " + token)
                        .header("X-Authenticated-User", "USER002"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value("ACC001"))
                .andExpect(jsonPath("$.ownerId").value("USER001"))
                .andExpect(jsonPath("$.balance").value(1250000));

        assertThat(forwardedUser.get()).isEqualTo("USER001");
        assertThat(forwardedAuthorization.get()).isEqualTo("Basic " + Base64.getEncoder()
                .encodeToString((INTERNAL_SERVICE_USERNAME + ":" + INTERNAL_SERVICE_SECRET)
                        .getBytes(StandardCharsets.UTF_8)));

        mockMvc.perform(get("/api/portal/accounts/ACC001/summary")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value("ACC001"))
                .andExpect(jsonPath("$.ownerId").value("USER001"))
                .andExpect(jsonPath("$.balance").value(1250000));

        mockMvc.perform(get("/api/portal/accounts/ACC002/summary")
                        .header("Authorization", "Bearer " + token)
                        .header("X-Authenticated-User", "USER002"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value("ACC002"))
                .andExpect(jsonPath("$.ownerId").value("USER002"))
                .andExpect(jsonPath("$.balance").value(2800000));
        assertThat(forwardedUser.get()).isEqualTo("USER001");

        mockMvc.perform(get("/api/portal/secured/accounts/ACC002/summary")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/portal/secured/accounts/UNKNOWN/summary")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/portal/secured/accounts/AUTHFAIL/summary")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadGateway());
        mockMvc.perform(get("/api/portal/accounts/UNKNOWN/summary")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());

        String staffToken = createToken("STAFF001", List.of("ROLE_STAFF"), Instant.now().plusSeconds(3600));
        mockMvc.perform(get("/api/portal/secured/accounts/ACC001/summary")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/portal/accounts/ACC001/summary")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/portal/secured/accounts/ACC001/summary"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/portal/accounts/ACC001/summary"))
                .andExpect(status().isUnauthorized());
    }

    private static String createToken(String userId, List<String> roles, Instant expiresAt) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId)
                .issuer("demo-identity")
                .audience(List.of("demo-services"))
                .issueTime(new Date())
                .expirationTime(Date.from(expiresAt))
                .claim("roles", roles)
                .build();

        SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
        signedJWT.sign(new RSASSASigner(testPrivateKey));
        return signedJWT.serialize();
    }

    private static void respondAccountSummary(HttpExchange exchange, String accountId, String ownerId, int balance)
            throws IOException {
        forwardedAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
        forwardedUser.set(exchange.getRequestHeaders().getFirst("X-Authenticated-User"));
        byte[] body = ("{\"accountId\":\"" + accountId
                + "\",\"ownerId\":\"" + ownerId
                + "\",\"balance\":" + balance + "}").getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        try (var outputStream = exchange.getResponseBody()) {
            outputStream.write(body);
        }
    }

    private static void respondForbidden(HttpExchange exchange) throws IOException {
        exchange.sendResponseHeaders(403, -1);
        exchange.close();
    }
}
