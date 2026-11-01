package com.mapinboot.demo.account;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.mapinboot.demo.account.model.DemoLoanProduct;
import com.mapinboot.demo.account.repository.InMemoryLoanApplicationRepository;
import com.mapinboot.demo.account.repository.InMemoryLoanProductRepository;
import com.mapinboot.demo.account.repository.InMemorySavingsSubscriptionRepository;
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
import org.springframework.http.MediaType;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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

    @Autowired
    private InMemorySavingsSubscriptionRepository subscriptionRepository;

    @Autowired
    private InMemoryLoanApplicationRepository loanApplicationRepository;

    @Autowired
    private InMemoryLoanProductRepository loanProductRepository;

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
        subscriptionRepository.initFixtures();
        loanApplicationRepository.initFixtures();
        this.mockMvc = MockMvcBuilders
                .webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    private String createToken(String userId, List<String> roles, String issuer, String audience, Instant expiresAt, RSAPrivateKey signerKey) throws Exception {
        return createToken(userId, roles, issuer, audience, expiresAt, signerKey, false);
    }

    private String createToken(String userId, List<String> roles, String issuer, String audience, Instant expiresAt, RSAPrivateKey signerKey, boolean identityVerified) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId)
                .issuer(issuer)
                .audience(List.of(audience))
                .issueTime(new Date())
                .expirationTime(Date.from(expiresAt))
                .claim("roles", roles)
                .claim("identity_verified", identityVerified)
                .build();

        SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
        signedJWT.sign(new RSASSASigner(signerKey));
        return signedJWT.serialize();
    }

    private String createTokenWithoutIdentityClaim(String userId, List<String> roles, String issuer, String audience, Instant expiresAt, RSAPrivateKey signerKey) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId)
                .issuer(issuer)
                .audience(List.of(audience))
                .issueTime(new Date())
                .expirationTime(Date.from(expiresAt))
                .claim("roles", roles)
                .build();

        SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claims);
        signedJWT.sign(new RSASSASigner(signerKey));
        return signedJWT.serialize();
    }

    private String createTokenWithIdentityClaim(String userId, List<String> roles, String issuer, String audience, Instant expiresAt, RSAPrivateKey signerKey, Object identityClaim) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId)
                .issuer(issuer)
                .audience(List.of(audience))
                .issueTime(new Date())
                .expirationTime(Date.from(expiresAt))
                .claim("roles", roles)
                .claim("identity_verified", identityClaim)
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
    @DisplayName("고객별 예적금 가입 목록을 본인 기준으로 분리")
    void customerSeesOnlyOwnSavings() throws Exception {
        String customerAToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String customerBToken = createToken("USER002", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/savings")
                        .header("Authorization", "Bearer " + customerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[*].subscriptionId", containsInAnyOrder("SAV001")));

        mockMvc.perform(get("/api/my/savings")
                        .header("Authorization", "Bearer " + customerBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[*].subscriptionId", containsInAnyOrder("SAV002")));
    }

    @Test
    @DisplayName("본인 예적금 가입 상세 조회")
    void customerSeesOwnSavingsDetail() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/savings/SAV001")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subscriptionId").value("SAV001"))
                .andExpect(jsonPath("$.productId").value("DEP-12M"))
                .andExpect(jsonPath("$.productName").isNotEmpty())
                .andExpect(jsonPath("$.principal").value(5000000))
                .andExpect(jsonPath("$.joinedAt").isNotEmpty())
                .andExpect(jsonPath("$.maturityDate").isNotEmpty())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("타인 예적금 가입 상세 조회 시 403 반환")
    void customerCannotSeeOtherSavingsDetail() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/savings/SAV002")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("존재하지 않는 예적금 가입 상세 조회 시 404 반환")
    void missingSavingsDetailReturns404() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/my/savings/UNKNOWN")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("인증 헤더 없이 예적금 가입 목록 요청 시 401 반환")
    void unauthenticatedSavingsListReturns401() throws Exception {
        mockMvc.perform(get("/api/my/savings"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("직원 토큰으로 예적금 가입 요청 시 403 반환")
    void staffCannotCreateSavings() throws Exception {
        String token = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":500000}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("활성 상품 예적금 가입 후 본인 소유로 저장")
    void customerCreatesSavingsOwnedByTokenSubject() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":500000,\"ownerId\":\"USER002\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.subscriptionId").value("SAVNEW1"))
                .andExpect(jsonPath("$.ownerId").value("USER001"))
                .andExpect(jsonPath("$.productId").value("DEP-12M"))
                .andExpect(jsonPath("$.principal").value(500000))
                .andExpect(jsonPath("$.joinedAt").isNotEmpty())
                .andExpect(jsonPath("$.maturityDate").isNotEmpty())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        mockMvc.perform(get("/api/my/savings")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].subscriptionId", containsInAnyOrder("SAV001", "SAVNEW1")));

        mockMvc.perform(get("/api/my/savings/SAVNEW1")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subscriptionId").value("SAVNEW1"))
                .andExpect(jsonPath("$.productName").isNotEmpty())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("예적금 가입 식별자는 동일 JVM에서 중복 생성되지 않음")
    void savingsSubscriptionIdsAreUnique() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":500000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.subscriptionId").value("SAVNEW1"));

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"SAV-12M\",\"principal\":600000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.subscriptionId").value("SAVNEW2"));
    }

    @Test
    @DisplayName("비활성 상품 예적금 가입 시 409 반환")
    void inactiveProductCannotBeSubscribed() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"SAV-CLOSED\",\"principal\":500000}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("존재하지 않는 상품 예적금 가입 시 404 반환")
    void missingProductCannotBeSubscribed() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"UNKNOWN\",\"principal\":500000}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("예적금 가입 금액이 양수가 아니면 400 반환")
    void invalidSavingsPrincipalReturns400() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":0}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":-1}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":500000.5}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.principal").value(500000.5));

        mockMvc.perform(post("/api/my/savings")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("인증 헤더 없이 예적금 가입 요청 시 401 반환")
    void unauthenticatedSavingsCreationReturns401() throws Exception {
        mockMvc.perform(post("/api/my/savings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"DEP-12M\",\"principal\":500000}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("본인확인 미완료 대출 신청은 403과 오류 코드를 반환하고 저장하지 않음")
    void unverifiedLoanApplicationIsRejectedWithoutSaving() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        int applicationCount = loanApplicationRepository.findAll().size();

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000,\"applicantId\":\"USER002\",\"purpose\":\"LIVING_COST\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.data").value(nullValue()))
                .andExpect(jsonPath("$.error.code").value("IDENTITY_VERIFICATION_REQUIRED"));

        org.assertj.core.api.Assertions.assertThat(loanApplicationRepository.findAll()).hasSize(applicationCount);
    }

    @Test
    @DisplayName("본인확인 완료 고객의 대출 신청은 JWT 주체를 소유자로 저장")
    void verifiedCustomerCreatesLoanApplicationOwnedByTokenSubject() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000,\"applicantId\":\"USER002\",\"purpose\":\"LIVING_COST\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.applicationId").value("LNAPPNEW1"))
                .andExpect(jsonPath("$.applicantId").value("USER001"))
                .andExpect(jsonPath("$.status").value("SUBMITTED"));

        mockMvc.perform(get("/api/loans/applications/my")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].applicationId", containsInAnyOrder("LNAPP001", "LNAPPNEW1")));

        mockMvc.perform(get("/api/loans/applications/my/LNAPPNEW1")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applicationId").value("LNAPPNEW1"))
                .andExpect(jsonPath("$.applicantId").value("USER001"))
                .andExpect(jsonPath("$.productId").value("LOAN-BASIC"))
                .andExpect(jsonPath("$.amount").value(1000000))
                .andExpect(jsonPath("$.status").value("SUBMITTED"))
                .andExpect(jsonPath("$.createdAt").isNotEmpty());
    }

    @Test
    @DisplayName("대출 신청 식별자는 Fixture와 충돌하지 않고 순차 요청에서 고유함")
    void loanApplicationIdsAreUnique() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.applicationId").value("LNAPPNEW1"));

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-HOUSE\",\"amount\":10000000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.applicationId").value("LNAPPNEW2"));
    }

    @Test
    @DisplayName("대출 신청 상품과 금액을 계약 범위에 맞게 검증")
    void loanApplicationValidatesProductAndAmount() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"UNKNOWN\",\"amount\":1000000}"))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":0}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":999999}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":50000001}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("비활성 대출상품 신청은 409 반환")
    void inactiveLoanProductCannotBeApplied() throws Exception {
        loanProductRepository.save(new DemoLoanProduct(
                "LOAN-CLOSED", "중단 대출", new java.math.BigDecimal("1000000"), new java.math.BigDecimal("5000000"), false));
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-CLOSED\",\"amount\":1000000}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("본인확인 미완료 고객도 본인 대출 목록은 조회 가능")
    void unverifiedCustomerCanListOwnLoanApplications() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/loans/applications/my")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].applicationId").value("LNAPP001"));
    }

    @Test
    @DisplayName("대출 상세는 소유자 확인 후 본인확인 상태를 검사")
    void loanDetailChecksOwnerBeforeIdentityVerification() throws Exception {
        String unverifiedCustomerAToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String unverifiedCustomerBToken = createToken("USER002", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String verifiedCustomerAToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(get("/api/loans/applications/my/LNAPP001")
                        .header("Authorization", "Bearer " + verifiedCustomerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applicationId").value("LNAPP001"))
                .andExpect(jsonPath("$.applicantId").value("USER001"))
                .andExpect(jsonPath("$.status").value("REVIEW"));

        mockMvc.perform(get("/api/loans/applications/my/LNAPP001")
                        .header("Authorization", "Bearer " + unverifiedCustomerAToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("IDENTITY_VERIFICATION_REQUIRED"));

        mockMvc.perform(get("/api/loans/applications/my/LNAPP001")
                        .header("Authorization", "Bearer " + unverifiedCustomerBToken))
                .andExpect(status().isForbidden())
                .andExpect(content().string(""));
    }

    @Test
    @DisplayName("고객별 대출 목록과 상세 소유권 분리")
    void customersSeeOnlyTheirOwnLoanApplications() throws Exception {
        String customerAToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);
        String customerBToken = createToken("USER002", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(get("/api/loans/applications/my")
                        .header("Authorization", "Bearer " + customerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].applicationId", containsInAnyOrder("LNAPP001")));

        mockMvc.perform(get("/api/loans/applications/my")
                        .header("Authorization", "Bearer " + customerBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].applicationId", containsInAnyOrder("LNAPP002")));

        mockMvc.perform(get("/api/loans/applications/my/LNAPP002")
                        .header("Authorization", "Bearer " + customerAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("직원 JWT의 sub 기준 담당 고객 목록을 분리")
    void staffSeesOnlyAssignedCustomers() throws Exception {
        String staffAToken = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String staffBToken = createToken("STAFF002", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/staff/assigned-customers")
                        .header("Authorization", "Bearer " + staffAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].customerId").value("CUST001"))
                .andExpect(jsonPath("$[0].displayName").value("고객 A"))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"));

        mockMvc.perform(get("/api/staff/assigned-customers")
                        .header("Authorization", "Bearer " + staffBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].customerId").value("CUST002"));
    }

    @Test
    @DisplayName("직원은 담당 고객의 예적금과 대출 신청 요약만 조회")
    void staffSeesAssignedSavingsAndLoans() throws Exception {
        String staffAToken = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String staffBToken = createToken("STAFF002", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/staff/assigned-customers/CUST001/savings")
                        .header("Authorization", "Bearer " + staffAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subscriptions", hasSize(1)))
                .andExpect(jsonPath("$.subscriptions[0].subscriptionId").value("SAV001"))
                .andExpect(jsonPath("$.subscriptions[0].productName").value("정기예금 12개월"))
                .andExpect(jsonPath("$.subscriptions[0].status").value("ACTIVE"))
                .andExpect(jsonPath("$.subscriptions[0].principal").value(5000000));

        mockMvc.perform(get("/api/staff/assigned-customers/CUST001/loans")
                        .header("Authorization", "Bearer " + staffAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].applicationId").value("LNAPP001"))
                .andExpect(jsonPath("$[0].productId").value("LOAN-BASIC"))
                .andExpect(jsonPath("$[0].amount").value(20000000))
                .andExpect(jsonPath("$[0].status").value("REVIEW"));

        mockMvc.perform(get("/api/staff/assigned-customers/CUST002/savings")
                        .header("Authorization", "Bearer " + staffBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subscriptions[0].subscriptionId").value("SAV002"));

        mockMvc.perform(get("/api/staff/assigned-customers/CUST002/loans")
                        .header("Authorization", "Bearer " + staffBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].applicationId").value("LNAPP002"));
    }

    @Test
    @DisplayName("미담당 고객과 조작된 직원 Header는 금융 조회를 거부")
    void staffCannotReadUnassignedCustomerData() throws Exception {
        String staffAToken = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String staffBToken = createToken("STAFF002", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/staff/assigned-customers/CUST002/savings")
                        .header("Authorization", "Bearer " + staffAToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers/CUST002/loans")
                        .header("Authorization", "Bearer " + staffAToken)
                        .header("X-Staff-Id", "STAFF002"))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers/CUST001/savings")
                        .header("Authorization", "Bearer " + staffBToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers/UNKNOWN/savings")
                        .header("Authorization", "Bearer " + staffAToken))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("직원 API는 직원 Role과 인증을 검증")
    void staffApisRequireStaffAuthentication() throws Exception {
        String customerToken = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String adminToken = createToken("ADMIN001", List.of("ROLE_BANK_ADMIN"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String developerToken = createToken("DEV001", List.of("MAP_IN_BOOT_ADMIN"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);

        mockMvc.perform(get("/api/staff/assigned-customers"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/staff/assigned-customers")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers/CUST001/savings")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers/CUST001/loans")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/staff/assigned-customers")
                        .header("Authorization", "Bearer " + developerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("본인확인 Claim 누락과 Boolean이 아닌 값은 미완료로 처리")
    void invalidIdentityClaimsAreRejected() throws Exception {
        String missingClaimToken = createTokenWithoutIdentityClaim("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey);
        String nonBooleanClaimToken = createTokenWithIdentityClaim("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, "true");

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + missingClaimToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("IDENTITY_VERIFICATION_REQUIRED"));

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + nonBooleanClaimToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("IDENTITY_VERIFICATION_REQUIRED"));
    }

    @Test
    @DisplayName("대출 API의 인증 및 고객 Role을 검증")
    void loanApisRequireCustomerAuthentication() throws Exception {
        mockMvc.perform(get("/api/loans/applications/my"))
                .andExpect(status().isUnauthorized());

        String staffToken = createToken("STAFF001", List.of("ROLE_STAFF"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(get("/api/loans/applications/my")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/secured/loans/applications")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"productId\":\"LOAN-BASIC\",\"amount\":1000000}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("존재하지 않는 대출 신청 상세는 404 반환")
    void missingLoanApplicationDetailReturns404() throws Exception {
        String token = createToken("USER001", List.of("ROLE_CUSTOMER"), "demo-identity", "demo-services", Instant.now().plusSeconds(3600), testPrivateKey, true);

        mockMvc.perform(get("/api/loans/applications/my/UNKNOWN")
                        .header("Authorization", "Bearer " + token))
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
