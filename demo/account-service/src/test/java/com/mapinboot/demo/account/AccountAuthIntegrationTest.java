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

import static org.hamcrest.Matchers.containsInAnyOrder;
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
    @DisplayName("고객 A가 본인 계좌 거래내역 3건 조회")
    void customerASeesOwnTransactions() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts/ACC001/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[*].transactionId", containsInAnyOrder("TX001", "TX002", "TX003")));
    }

    @Test
    @DisplayName("고객 B가 고객 A 계좌 거래내역 조회 시 403 반환")
    void customerBCannotSeeCustomerATransactions() throws Exception {
        String token = createToken("USER002", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts/ACC001/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("고객 A가 고객 B 계좌 거래내역 조회 시 403 반환")
    void customerACannotSeeCustomerBTransactions() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts/ACC002/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("인증 헤더 없이 거래내역 요청 시 401 반환")
    void unauthenticatedTransactionRequestReturns401() throws Exception {
        mockMvc.perform(get("/api/my/accounts/ACC001/transactions"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("직원 토큰으로 거래내역 요청 시 403 반환")
    void staffCannotSeeTransactions() throws Exception {
        String token = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts/ACC001/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("존재하지 않는 계좌 거래내역 요청 시 404 반환")
    void missingAccountTransactionsReturns404() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/accounts/UNKNOWN/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("익명 예금·적금 상품 목록은 활성 상품만 반환")
    void anonymousSeesActiveSavingsProducts() throws Exception {
        mockMvc.perform(get("/api/public/savings/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].productId", containsInAnyOrder("DEP-12M", "SAV-12M")));
    }

    @Test
    @DisplayName("예금·적금 상품 상세에서 비활성 상태 확인")
    void savingsProductDetailShowsInactiveState() throws Exception {
        mockMvc.perform(get("/api/public/savings/products/SAV-CLOSED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.productId").value("SAV-CLOSED"))
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    @DisplayName("존재하지 않는 예금·적금 상품 상세 요청 시 404 반환")
    void missingSavingsProductReturns404() throws Exception {
        mockMvc.perform(get("/api/public/savings/products/UNKNOWN"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("익명 대출상품 목록은 판매 중 상품 반환")
    void anonymousSeesLoanProducts() throws Exception {
        mockMvc.perform(get("/api/public/loans/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].productId", containsInAnyOrder("LOAN-BASIC", "LOAN-HOUSE")));
    }

    @Test
    @DisplayName("대출상품 상세 조회 성공")
    void loanProductDetailReturnsProduct() throws Exception {
        mockMvc.perform(get("/api/public/loans/products/LOAN-BASIC"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.productId").value("LOAN-BASIC"))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    @DisplayName("존재하지 않는 대출상품 상세 요청 시 404 반환")
    void missingLoanProductReturns404() throws Exception {
        mockMvc.perform(get("/api/public/loans/products/UNKNOWN"))
                .andExpect(status().isNotFound());
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
