package com.mapinboot.demo.identity;

import com.mapinboot.demo.identity.repository.InMemoryIdentityStateRepository;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.Filter;
import java.io.FileOutputStream;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
        mockMvc.perform(options("/api/auth/login")
                        .header(HttpHeaders.ORIGIN, "http://localhost:18080")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type,x-xsrf-token"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:18080"))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"));
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
