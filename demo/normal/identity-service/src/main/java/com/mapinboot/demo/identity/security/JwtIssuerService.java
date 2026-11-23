package com.mapinboot.demo.identity.security;

import com.mapinboot.demo.identity.model.DemoUser;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.annotation.PostConstruct;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * JWT 서명 토큰 발급 서비스
 */
@Service
public class JwtIssuerService {

    private final String privateKeyPath;
    private final String issuer;
    private final String audience;
    private final long expirationSeconds;
    private RSAPrivateKey privateKey;

    public JwtIssuerService(
            @Value("${demo.jwt.private-key-path:}") String privateKeyPath,
            @Value("${demo.jwt.issuer:demo-identity}") String issuer,
            @Value("${demo.jwt.audience:demo-services}") String audience,
            @Value("${demo.jwt.access-token-expiration-seconds:3600}") long expirationSeconds) {
        this.privateKeyPath = privateKeyPath;
        this.issuer = issuer;
        this.audience = audience;
        this.expirationSeconds = expirationSeconds;
    }

    /**
     * RSA 개인키 로드 및 초기화
     */
    @PostConstruct
    public void init() throws Exception {
        if (privateKeyPath == null || privateKeyPath.isBlank()) {
            throw new IllegalStateException("JWT 개인키 경로 미설정");
        }
        String pem = Files.readString(Path.of(privateKeyPath));
        String privateKeyPEM = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        byte[] encoded = Base64.getDecoder().decode(privateKeyPEM);
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        this.privateKey = (RSAPrivateKey) keyFactory.generatePrivate(new PKCS8EncodedKeySpec(encoded));
    }

    /**
     * 사용자 정보 및 본인확인 상태 기반 JWT 발급
     */
    public String issueToken(DemoUser user, boolean identityVerified) {
        Instant now = Instant.now();
        Instant expiresAt = now.plusSeconds(expirationSeconds);

        JWTClaimsSet claimsSet = new JWTClaimsSet.Builder()
                .subject(user.getUserId())
                .issuer(issuer)
                .audience(List.of(audience))
                .issueTime(Date.from(now))
                .expirationTime(Date.from(expiresAt))
                .claim("roles", new ArrayList<>(user.getRoles()))
                .claim("identity_verified", identityVerified)
                .build();

        SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.RS256), claimsSet);
        try {
            signedJWT.sign(new RSASSASigner(privateKey));
            return signedJWT.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("JWT 서명 실패", e);
        }
    }

    public long getExpirationSeconds() {
        return expirationSeconds;
    }

    public String getIssuer() {
        return issuer;
    }

    public String getAudience() {
        return audience;
    }
}

