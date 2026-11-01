package com.mapinboot.demo.main;

import java.io.FileOutputStream;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
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

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void configureJwtKey(DynamicPropertyRegistry registry) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair keyPair = kpg.generateKeyPair();

        String publicPem = "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(keyPair.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----\n";

        Path publicKeyPath = tempDir.resolve("test-jwt-public.pem");
        try (FileOutputStream fos = new FileOutputStream(publicKeyPath.toFile())) {
            fos.write(publicPem.getBytes());
        }

        registry.add("demo.jwt.public-key-path", publicKeyPath::toString);
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
}
