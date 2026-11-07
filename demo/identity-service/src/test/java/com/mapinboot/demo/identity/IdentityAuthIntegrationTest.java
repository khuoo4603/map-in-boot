package com.mapinboot.demo.identity;

import com.mapinboot.demo.identity.repository.InMemoryIdentityStateRepository;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.CollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.finding.Finding;
import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.analyzer.FilterRegistrationAnalysisAdapter;
import com.mapinboot.security.analyzer.MethodSecurityAnalysisAdapter;
import com.mapinboot.security.collector.MethodSecurityCollectorAdapter;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import com.mapinboot.security.finding.SecurityRuleEngine;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.collector.ServletFilterCollectorAdapter;
import com.mapinboot.starter.collector.ServletRegistrationCollectorAdapter;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.Filter;
import java.io.FileOutputStream;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Identity 서비스 로그인 및 JWT 인증 통합 테스트
 */
@SpringBootTest
@TestPropertySource(properties = {
    "DEMO_TEST_PASSWORD=demoTestSecret123!",
    "demo.jwt.issuer=demo-identity",
    "demo.jwt.audience=demo-services"
})
class IdentityAuthIntegrationTest {

    @TempDir
    static Path tempDir;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private InMemoryIdentityStateRepository identityStateRepository;

    @Autowired
    private FilterChainProxy filterChainProxy;

    @Value("${DEMO_CORS_ALLOWED_ORIGINS:http://localhost:8080}")
    private String corsAllowedOrigins;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void configureJwtKeys(DynamicPropertyRegistry registry) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();

        String privPem = "-----BEGIN PRIVATE KEY-----\n" +
                Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(kp.getPrivate().getEncoded()) +
                "\n-----END PRIVATE KEY-----\n";
        String pubPem = "-----BEGIN PUBLIC KEY-----\n" +
                Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(kp.getPublic().getEncoded()) +
                "\n-----END PUBLIC KEY-----\n";

        Path privPath = tempDir.resolve("test-jwt-private.pem");
        Path pubPath = tempDir.resolve("test-jwt-public.pem");

        try (FileOutputStream fos = new FileOutputStream(privPath.toFile())) {
            fos.write(privPem.getBytes());
        }
        try (FileOutputStream fos = new FileOutputStream(pubPath.toFile())) {
            fos.write(pubPem.getBytes());
        }

        registry.add("demo.jwt.private-key-path", privPath::toString);
        registry.add("demo.jwt.public-key-path", pubPath::toString);
    }

    @BeforeEach
    void setUp() {
        identityStateRepository.initFixtures();
        this.mockMvc = MockMvcBuilders
                .webAppContextSetup(context)
                .addFilters(context.getBean("springSessionRepositoryFilter", Filter.class))
                .apply(springSecurity())
                .build();
    }

    @Test
    @DisplayName("N08/V08 Refresh Filter의 Bearer 인증 Filter 상대 순서 검증")
    void refreshFilterOrderDiffersByEndpoint() {
        List<Filter> normalFilters = filterChainProxy.getFilters("/api/auth/secured/refresh");
        List<Filter> vulnerableFilters = filterChainProxy.getFilters("/api/auth/refresh");

        int normalBearerIndex = filterIndex(normalFilters, "BearerTokenAuthenticationFilter");
        int normalRefreshIndex = filterIndex(normalFilters, "RefreshTokenFilter");
        int vulnerableBearerIndex = filterIndex(vulnerableFilters, "BearerTokenAuthenticationFilter");
        int vulnerableRefreshIndex = filterIndex(vulnerableFilters, "RefreshTokenFilter");

        assertThat(normalRefreshIndex).isGreaterThan(normalBearerIndex);
        assertThat(vulnerableRefreshIndex).isLessThan(vulnerableBearerIndex);
    }

    @Test
    @DisplayName("실제 Identity Context의 N08/V08 Filter 순서와 FILTER_ORDER 근거 비교")
    void sdkFindingUsesActualIdentityFilterFactsAndSeparatesN08FromV08() {
        CollectionProvider collectionProvider = context.getBean(CollectionProvider.class);
        AnalysisProvider analysisProvider = context.getBean(AnalysisProvider.class);
        SecurityRuleEngine ruleEngine = context.getBean(SecurityRuleEngine.class);

        List<CollectorAdapter> collectors = List.of(
                new EndpointMappingCollectorAdapter(),
                new ServletFilterCollectorAdapter(),
                new ServletRegistrationCollectorAdapter(),
                new MethodSecurityCollectorAdapter(),
                new SecurityChainCollectorAdapter());
        CollectionReport collection = collectionProvider.execute(
                new CollectionContext(context, "identity", "test"), collectors);
        AnalysisReport analysis = analysisProvider.execute(
                new AnalysisContext(collection, "identity"), List.of(
                        new EndpointChainMatchingAnalysisAdapter(),
                        new FilterRegistrationAnalysisAdapter(),
                        new MethodSecurityAnalysisAdapter()));

        assertThat(collection.statusByAdapter().get("security-chain"))
                .isNotEqualTo(AnalysisStatus.UNKNOWN);
        assertThat(analysis.relations()).anyMatch(relation -> relation.type() == EdgeType.MATCHED_BY);

        Fact normalEndpoint = endpoint(collection, "/api/auth/secured/refresh");
        Fact vulnerableEndpoint = endpoint(collection, "/api/auth/refresh");
        Fact normalChain = selectedChain(analysis, normalEndpoint);
        Fact vulnerableChain = selectedChain(analysis, vulnerableEndpoint);
        assertThat(normalChain.attributes().get("chainKey"))
                .isNotEqualTo(vulnerableChain.attributes().get("chainKey"));

        List<Fact> normalFilters = securityFilters(collection, normalChain);
        List<Fact> vulnerableFilters = securityFilters(collection, vulnerableChain);
        List<com.mapinboot.core.evidence.Relation> vulnerableFilterRelations = analysis.relations().stream()
                .filter(relation -> relation.type() == EdgeType.FILTERED_BY
                        && vulnerableChain.subjectKey().equals(relation.sourceKey()))
                .toList();
        assertThat(vulnerableFilters).hasSize(vulnerableFilterRelations.size());
        assertThat(vulnerableFilterRelations).allMatch(relation -> vulnerableFilters.stream()
                .anyMatch(filter -> filter.subjectKey().equals(relation.targetKey())));
        assertThat(filterOrder(normalFilters, "BearerTokenAuthenticationFilter"))
                .isLessThan(filterOrder(normalFilters, "RefreshTokenFilter"));
        assertThat(filterOrder(vulnerableFilters, "RefreshTokenFilter"))
                .isLessThan(filterOrder(vulnerableFilters, "BearerTokenAuthenticationFilter"));
        assertThat(vulnerableFilters.stream()
                .filter(fact -> fact.attributes().get("filterClass").endsWith("RefreshTokenFilter"))
                .flatMap(fact -> fact.evidenceIds().stream())
                .anyMatch(id -> collection.evidence().stream().anyMatch(evidence ->
                        evidence.id().equals(id)
                                && evidence.source() == com.mapinboot.core.common.status.EvidenceSource.CODE_PATTERN)))
                .isTrue();

        List<Finding> findings = ruleEngine.evaluate(analysis);
        assertThat(findings.stream().map(Finding::ruleId).toList())
                .contains("FILTER_ORDER");
        assertThat(findings.stream()
                .filter(finding -> "FILTER_ORDER".equals(finding.ruleId()))
                .filter(finding -> finding.evidenceIds().stream().anyMatch(id -> vulnerableEndpoint.evidenceIds().contains(id)))
                .count()).isEqualTo(1);
        assertThat(findings.stream()
                .filter(finding -> "FILTER_ORDER".equals(finding.ruleId()))
                .filter(finding -> finding.evidenceIds().stream().anyMatch(id -> normalEndpoint.evidenceIds().contains(id)))
                .count()).isZero();
        assertThat(findings.stream().filter(finding -> "FILTER_ORDER".equals(finding.ruleId()))
                .findFirst().orElseThrow().confidence()).isEqualTo(Confidence.LIKELY);
    }

    @Test
    @DisplayName("N08 유효 JWT로 Refresh 시 새 JWT 발급")
    void normalRefreshReissuesJwt() throws Exception {
        String oldToken = accessToken(login("customer.a", csrfSession()));

        MvcResult refreshResult = mockMvc.perform(post("/api/auth/secured/refresh")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + oldToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.expiresIn").isNumber())
                .andExpect(jsonPath("$.user.id").value("USER001"))
                .andReturn();

        mockMvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken(refreshResult)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("USER001"));
    }

    @Test
    @DisplayName("Refresh는 Bearer JWT 없이 Session Cookie만으로 처리하지 않음")
    void refreshRejectsMissingOrSessionOnlyAuthentication() throws Exception {
        MvcResult loginResult = login("customer.a", csrfSession());
        Cookie sessionCookie = loginResult.getResponse().getCookie("MIB_IDENTITY_SESSION");

        mockMvc.perform(post("/api/auth/secured/refresh"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/secured/refresh").cookie(sessionCookie))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/refresh"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/refresh").cookie(sessionCookie))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("V08 유효 JWT는 Bearer 인증 전 Refresh Filter에서 거부")
    void vulnerableRefreshRejectsJwtBeforeBearerAuthentication() throws Exception {
        String token = accessToken(login("customer.a", csrfSession()));

        mockMvc.perform(post("/api/auth/refresh")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("RefreshTokenFilter는 Servlet Filter로 중복 등록되지 않음")
    void refreshFilterIsNotServletRegistered() {
        assertThat(context.getServletContext().getFilterRegistrations().keySet())
                .noneMatch(filterName -> filterName.contains("RefreshTokenFilter"));
    }

    @Test
    @DisplayName("정상 로그인 시 JWT 발급 및 me 조회 성공")
    void loginAndMeSuccess() throws Exception {
        MvcResult loginResult = login("customer.a", csrfSession());
        String token = accessToken(loginResult);
        assertThat(token).isNotBlank();

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("USER001"))
                .andExpect(jsonPath("$.roles[0]").value("ROLE_CUSTOMER"))
                .andExpect(jsonPath("$.identityVerified").value(false));
    }

    @Test
    @DisplayName("로그인 Session Cookie로 Bearer 없이 Principal 복원")
    void sessionCookieRestoresPrincipal() throws Exception {
        MvcResult loginResult = login("customer.a", csrfSession());
        Cookie sessionCookie = loginResult.getResponse().getCookie("MIB_IDENTITY_SESSION");

        assertThat(sessionCookie).isNotNull();

        mockMvc.perform(get("/api/auth/me").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("USER001"))
                .andExpect(jsonPath("$.roles[0]").value("ROLE_CUSTOMER"))
                .andExpect(jsonPath("$.identityVerified").value(false));
    }

    @Test
    @DisplayName("N06/V06 Session 프로필 Owner 검증 차이와 JWT 접근 경계 확인")
    void sessionProfileNormalAndVulnerablePathsDifferByOwnerCheck() throws Exception {
        MvcResult customerLogin = login("customer.a", csrfSession());
        Cookie customerSession = customerLogin.getResponse().getCookie("MIB_IDENTITY_SESSION");
        String customerToken = accessToken(customerLogin);

        mockMvc.perform(get("/api/session/secured/customers/CUST001/profile")
                        .cookie(customerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.customerId").value("CUST001"))
                .andExpect(jsonPath("$.displayName").value("고객 A"));
        mockMvc.perform(get("/api/session/customers/CUST001/profile")
                        .cookie(customerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.customerId").value("CUST001"))
                .andExpect(jsonPath("$.displayName").value("고객 A"));

        mockMvc.perform(get("/api/session/secured/customers/CUST002/profile")
                        .cookie(customerSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/session/customers/CUST002/profile")
                        .cookie(customerSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.customerId").value("CUST002"))
                .andExpect(jsonPath("$.displayName").value("고객 B"));

        mockMvc.perform(get("/api/session/secured/customers/CUST001/profile"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/session/customers/CUST001/profile"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/session/secured/customers/CUST001/profile")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/session/customers/CUST001/profile")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isUnauthorized());

        MvcResult staffLogin = login("staff.a", csrfSession());
        Cookie staffSession = staffLogin.getResponse().getCookie("MIB_IDENTITY_SESSION");
        mockMvc.perform(get("/api/session/secured/customers/CUST001/profile")
                        .cookie(staffSession))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/session/customers/CUST001/profile")
                        .cookie(staffSession))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/session/secured/customers/UNKNOWN/profile")
                        .cookie(customerSession))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/session/customers/UNKNOWN/profile")
                        .cookie(customerSession))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Session 프로필 API의 허용 Origin CORS preflight 응답")
    void sessionProfileCorsPreflightUsesExistingPolicy() throws Exception {
        String allowedOrigin = corsAllowedOrigins.split(",")[0].trim();

        mockMvc.perform(options("/api/session/secured/customers/CUST001/profile")
                        .header(HttpHeaders.ORIGIN, allowedOrigin)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, allowedOrigin))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"));
    }

    @Test
    @DisplayName("Session Cookie 속성 및 JWT 로그인 응답 계약 유지")
    void sessionCookiePolicyAndLoginContract() throws Exception {
        MvcResult loginResult = login("customer.a", csrfSession());
        String sessionSetCookie = loginResult.getResponse().getHeaders(HttpHeaders.SET_COOKIE).stream()
                .filter(value -> value.startsWith("MIB_IDENTITY_SESSION="))
                .findFirst()
                .orElseThrow();

        assertThat(sessionSetCookie)
                .contains("Path=/")
                .contains("HttpOnly")
                .contains("SameSite=Lax")
                .doesNotContain("; Secure");
        assertThat(loginResult.getResponse().getContentAsString()).contains("accessToken");
    }

    @Test
    @DisplayName("기존 Session으로 로그인할 때 Session ID 교체")
    void loginRotatesExistingSessionId() throws Exception {
        CsrfSession csrf = csrfSession();
        Cookie existingSessionCookie = login("customer.a", csrf).getResponse()
                .getCookie("MIB_IDENTITY_SESSION");
        assertThat(existingSessionCookie).isNotNull();

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .cookie(existingSessionCookie, csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"customer.a\",\"password\":\"demoTestSecret123!\"}"))
                .andExpect(status().isOk())
                .andReturn();

        Cookie rotatedSessionCookie = loginResult.getResponse().getCookie("MIB_IDENTITY_SESSION");
        assertThat(rotatedSessionCookie).isNotNull();
        assertThat(rotatedSessionCookie.getValue()).isNotEqualTo(existingSessionCookie.getValue());
    }

    @Test
    @DisplayName("JWT Bearer 요청은 Session Cookie를 새로 생성하지 않음")
    void bearerRequestDoesNotCreateSession() throws Exception {
        MvcResult loginResult = login("customer.a", csrfSession());
        MvcResult meResult = mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + accessToken(loginResult)))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(meResult.getResponse().getCookie("MIB_IDENTITY_SESSION")).isNull();
    }

    @Test
    @DisplayName("로그아웃 시 Session 무효화 및 Cookie 삭제")
    void logoutInvalidatesSession() throws Exception {
        CsrfSession csrf = csrfSession();
        MvcResult loginResult = login("customer.a", csrf);
        Cookie sessionCookie = loginResult.getResponse().getCookie("MIB_IDENTITY_SESSION");

        MvcResult logoutResult = mockMvc.perform(post("/api/auth/logout")
                        .cookie(sessionCookie, csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token()))
                .andExpect(status().isNoContent())
                .andReturn();

        assertThat(logoutResult.getResponse().getHeaders(HttpHeaders.SET_COOKIE).stream()
                .anyMatch(value -> value.startsWith("MIB_IDENTITY_SESSION=") && value.contains("Max-Age=0")))
                .isTrue();

        mockMvc.perform(get("/api/auth/me").cookie(sessionCookie))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/session/customers/CUST001/profile").cookie(sessionCookie))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Session 상태 변경 요청의 CSRF Token 누락 차단")
    void stateChangingRequestWithoutCsrfFails() throws Exception {
        CsrfSession csrf = csrfSession();

        mockMvc.perform(post("/api/auth/login")
                        .cookie(csrf.cookie())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"customer.a\",\"password\":\"demoTestSecret123!\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("허용 Origin의 credentialed CORS preflight 응답")
    void allowedCorsPreflight() throws Exception {
        String allowedOrigin = corsAllowedOrigins.split(",")[0].trim();
        mockMvc.perform(options("/api/auth/login")
                        .header(HttpHeaders.ORIGIN, allowedOrigin)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type,x-xsrf-token"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, allowedOrigin))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"));
    }

    @Test
    @DisplayName("미허용 Origin의 credentialed CORS preflight 거부")
    void disallowedCorsPreflight() throws Exception {
        mockMvc.perform(options("/api/auth/login")
                        .header(HttpHeaders.ORIGIN, "https://example.com")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type,x-xsrf-token"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    @DisplayName("잘못된 비밀번호 로그인 시 401 응답")
    void loginWithWrongPasswordFails() throws Exception {
        CsrfSession csrf = csrfSession();

        mockMvc.perform(post("/api/auth/login")
                        .cookie(csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"customer.a\",\"password\":\"wrongPassword!\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("인증 헤더 없이 me 조회 시 401 응답")
    void meWithoutTokenFails() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("고객 A와 B의 초기 본인확인 상태 조회")
    void identityStatusStartsUnverifiedForCustomers() throws Exception {
        CsrfSession csrf = csrfSession();
        Cookie customerACookie = login("customer.a", csrf)
                .getResponse().getCookie("MIB_IDENTITY_SESSION");
        Cookie customerBCookie = login("customer.b", csrf)
                .getResponse().getCookie("MIB_IDENTITY_SESSION");

        mockMvc.perform(get("/api/identity/status").cookie(customerACookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());
        mockMvc.perform(get("/api/identity/status").cookie(customerBCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());
    }

    @Test
    @DisplayName("인증 없는 본인확인 API는 401 응답")
    void identityApisRequireAuthentication() throws Exception {
        mockMvc.perform(get("/api/identity/status"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/identity/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("고객이 아닌 Principal의 본인확인 API 접근 차단")
    void nonCustomerCannotUseIdentityApis() throws Exception {
        MvcResult loginResult = login("staff.a", csrfSession());
        String token = accessToken(loginResult);

        mockMvc.perform(get("/api/identity/status")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/identity/verify")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("잘못된 OTP는 본인확인 상태와 JWT를 변경하지 않음")
    void invalidOtpDoesNotChangeIdentityState() throws Exception {
        CsrfSession csrf = csrfSession();
        Cookie sessionCookie = login("customer.a", csrf)
                .getResponse().getCookie("MIB_IDENTITY_SESSION");

        mockMvc.perform(post("/api/identity/verify")
                        .cookie(sessionCookie, csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"000000\"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/identity/status").cookie(sessionCookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());
    }

    @Test
    @DisplayName("Session OTP 검증은 CSRF Token을 사용하고 성공 상태를 저장")
    void sessionOtpVerificationUsesCsrfToken() throws Exception {
        CsrfSession csrf = csrfSession();
        Cookie sessionCookie = login("customer.a", csrf)
                .getResponse().getCookie("MIB_IDENTITY_SESSION");

        mockMvc.perform(post("/api/identity/verify")
                        .cookie(sessionCookie)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/identity/verify")
                        .cookie(sessionCookie, csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(true));
    }

    @Test
    @DisplayName("잘못된 method와 OTP 형식 차단")
    void invalidIdentityVerificationRequestFails() throws Exception {
        String token = accessToken(login("customer.a", csrfSession()));

        mockMvc.perform(post("/api/identity/verify")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"SMS\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/identity/verify")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"12345\"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/identity/status")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false));
    }

    @Test
    @DisplayName("정상 OTP 후 상태 저장 및 identity_verified true JWT 재발급")
    void validOtpUpdatesStateAndReissuesJwt() throws Exception {
        String oldToken = accessToken(login("customer.a", csrfSession()));

        MvcResult verifyResult = mockMvc.perform(post("/api/identity/verify")
                        .header("Authorization", "Bearer " + oldToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(true))
                .andExpect(jsonPath("$.verifiedAt").isNotEmpty())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andReturn();
        assertThat(verifyResult.getResponse().getCookie("MIB_IDENTITY_SESSION")).isNull();
        String newToken = accessToken(verifyResult);

        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + oldToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false));
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + newToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(true));
        mockMvc.perform(get("/api/identity/status")
                        .header("Authorization", "Bearer " + newToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(true))
                .andExpect(jsonPath("$.verifiedAt").isNotEmpty());
    }

    @Test
    @DisplayName("고객 A 본인확인이 고객 B 상태에 영향을 주지 않음")
    void identityStateIsSeparatedByUser() throws Exception {
        String customerAToken = accessToken(login("customer.a", csrfSession()));
        mockMvc.perform(post("/api/identity/verify")
                        .header("Authorization", "Bearer " + customerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"method\":\"DEMO_OTP\",\"verificationCode\":\"123456\"}"))
                .andExpect(status().isOk());

        String customerBToken = accessToken(login("customer.b", csrfSession()));
        mockMvc.perform(get("/api/identity/status")
                        .header("Authorization", "Bearer " + customerBToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identityVerified").value(false))
                .andExpect(jsonPath("$.verifiedAt").doesNotExist());
    }

    private Fact endpoint(CollectionReport collection, String path) {
        return collection.facts().stream()
                .filter(fact -> "ENDPOINT_MAPPING".equals(fact.type()))
                .filter(fact -> path.equals(fact.attributes().get("path")))
                .findFirst().orElseThrow();
    }

    private Fact selectedChain(AnalysisReport analysis, Fact endpoint) {
        String chainKey = analysis.relations().stream()
                .filter(relation -> relation.type() == EdgeType.MATCHED_BY)
                .filter(relation -> endpoint.subjectKey().equals(relation.sourceKey()))
                .findFirst().orElseThrow().targetKey();
        return analysis.collectionReport().facts().stream()
                .filter(fact -> chainKey.equals(fact.subjectKey()))
                .findFirst().orElseThrow();
    }

    private List<Fact> securityFilters(CollectionReport collection, Fact chain) {
        return collection.facts().stream()
                .filter(fact -> "FILTER_REGISTRATION".equals(fact.type()))
                .filter(fact -> "SECURITY".equals(fact.attributes().get("registrationKind")))
                .filter(fact -> chain.attributes().get("chainKey").equals(fact.attributes().get("chainKey")))
                .filter(fact -> chain.attributes().get("chainOrder").equals(fact.attributes().get("chainOrder")))
                .sorted(java.util.Comparator.comparingInt(this::filterOrder))
                .toList();
    }

    private int filterOrder(List<Fact> filters, String simpleName) {
        return filters.stream()
                .filter(candidate -> candidate.attributes().get("filterClass").endsWith(simpleName))
                .findFirst()
                .map(this::filterOrder)
                .orElseThrow();
    }

    private int filterOrder(Fact filter) {
        return Integer.parseInt(filter.attributes().get("filterOrder"));
    }

    private int filterIndex(List<Filter> filters, String simpleName) {
        for (int index = 0; index < filters.size(); index++) {
            if (filters.get(index).getClass().getSimpleName().equals(simpleName)) {
                return index;
            }
        }
        return -1;
    }

    private MvcResult login(String username, CsrfSession csrf) throws Exception {
        String loginJson = "{\"username\":\"" + username
                + "\",\"password\":\"demoTestSecret123!\"}";
        return mockMvc.perform(post("/api/auth/login")
                        .cookie(csrf.cookie())
                        .header("X-XSRF-TOKEN", csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginJson))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.user.id").value(userId(username)))
                .andExpect(jsonPath("$.user.role").value(role(username)))
                .andReturn();
    }

    private String userId(String username) {
        return switch (username) {
            case "customer.a" -> "USER001";
            case "customer.b" -> "USER002";
            case "staff.a" -> "STAFF001";
            default -> throw new IllegalArgumentException("지원하지 않는 테스트 사용자");
        };
    }

    private String role(String username) {
        return username.startsWith("staff") ? "ROLE_STAFF" : "ROLE_CUSTOMER";
    }

    private CsrfSession csrfSession() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        String token = result.getResponse().getContentAsString()
                .replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
        Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
        assertThat(token).isNotBlank();
        assertThat(cookie).isNotNull();
        return new CsrfSession(token, cookie);
    }

    private String accessToken(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString()
                .replaceAll(".*\"accessToken\":\"([^\"]+)\".*", "$1");
    }

    private record CsrfSession(String token, Cookie cookie) {
    }
}
