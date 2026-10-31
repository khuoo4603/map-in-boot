package com.mapinboot.demo.account;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.FileOutputStream;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
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

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Account 서비스 JWT 검증 및 본인 계좌 조회 인가 테스트
 */
@SpringBootTest
@TestPropertySource(properties = {
    "demo.jwt.issuer=demo-identity",
    "demo.jwt.audience=demo-services"
})
class AccountAuthIntegrationTest {

    @TempDir
    static Path tempDir;

    private static RSAPrivateKey testPrivateKey;

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void configureJwtKeys(DynamicPropertyRegistry registry) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();
        testPrivateKey = (RSAPrivateKey) kp.getPrivate();

        String pubPem = "-----BEGIN PUBLIC KEY-----\n" +
                Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(kp.getPublic().getEncoded()) +
                "\n-----END PUBLIC KEY-----\n";

        Path pubPath = tempDir.resolve("test-jwt-public.pem");
        try (FileOutputStream fos = new FileOutputStream(pubPath.toFile())) {
            fos.write(pubPem.getBytes());
        }

        registry.add("demo.jwt.public-key-path", pubPath::toString);
    }

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders
                .webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    private String createToken(String userId, List<String> roles, String issuer, String audience, Instant expiresAt, RSAPrivateKey signerKey) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId)
                .issuer(issuer)
                .audience(List.of(audience))
                .issueTime(new Date())
                .expirationTime(Date.from(expiresAt))
                .claim("roles", roles)
                .claim("identity_verified", false)
                .build();

        SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
        signedJWT.sign(new RSASSASigner(signerKey));
        return signedJWT.serialize();
    }

    @Test
    @DisplayName("고객 A 토큰으로 요청 시 본인 계좌 ACC001만 200 반환")
    void customerASeesOnlyOwnAccount() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].accountId").value("ACC001"))
                .andExpect(jsonPath("$[0].ownerId").value("USER001"))
                .andExpect(jsonPath("$[0].balance").value(1250000));
    }

    @Test
    @DisplayName("고객 B 토큰으로 요청 시 본인 계좌 ACC002만 200 반환")
    void customerBSeesOnlyOwnAccount() throws Exception {
        String token = createToken("USER002", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].accountId").value("ACC002"))
                .andExpect(jsonPath("$[0].ownerId").value("USER002"))
                .andExpect(jsonPath("$[0].balance").value(2800000));
    }

    @Test
    @DisplayName("인증 헤더 없이 요청 시 401 반환")
    void unauthenticatedRequestReturns401() throws Exception {
        mockMvc.perform(get("/api/my/accounts"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("직원 토큰(비고객 Role)으로 요청 시 403 반환")
    void staffTokenReturns403() throws Exception {
        String token = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("위조된 키로 서명된 토큰 요청 시 401 반환")
    void forgedTokenReturns401() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair fakePair = kpg.generateKeyPair();
        String fakeToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), (RSAPrivateKey) fakePair.getPrivate());

        mockMvc.perform(get("/api/my/accounts")
                        .header("Authorization", "Bearer " + fakeToken))
                .andExpect(status().isUnauthorized());
    }
}
