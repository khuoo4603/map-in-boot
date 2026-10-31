package com.mapinboot.demo.identity.controller;

import com.mapinboot.demo.identity.dto.IdentityStatusResponse;
import com.mapinboot.demo.identity.dto.IdentityVerificationRequest;
import com.mapinboot.demo.identity.dto.IdentityVerificationResponse;
import com.mapinboot.demo.identity.dto.LoginRequest;
import com.mapinboot.demo.identity.dto.LoginResponse;
import com.mapinboot.demo.identity.dto.MeResponse;
import com.mapinboot.demo.identity.dto.UserSummary;
import com.mapinboot.demo.identity.model.DemoIdentityState;
import com.mapinboot.demo.identity.model.DemoUser;
import com.mapinboot.demo.identity.repository.InMemoryIdentityStateRepository;
import com.mapinboot.demo.identity.repository.InMemoryUserRepository;
import com.mapinboot.demo.identity.security.JwtIssuerService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 인증 및 현재 사용자 정보 API 컨트롤러
 */
@RestController
@RequestMapping("/api")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final InMemoryUserRepository userRepository;
    private final InMemoryIdentityStateRepository identityStateRepository;
    private final JwtIssuerService jwtIssuerService;
    private final SecurityContextRepository securityContextRepository;
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy;
    private final String demoOtp;

    public AuthController(
            AuthenticationManager authenticationManager,
            InMemoryUserRepository userRepository,
            InMemoryIdentityStateRepository identityStateRepository,
            JwtIssuerService jwtIssuerService,
            SecurityContextRepository securityContextRepository,
            SessionAuthenticationStrategy sessionAuthenticationStrategy,
            @Value("${demo.identity.demo-otp:123456}") String demoOtp) {
        this.authenticationManager = authenticationManager;
        this.userRepository = userRepository;
        this.identityStateRepository = identityStateRepository;
        this.jwtIssuerService = jwtIssuerService;
        this.securityContextRepository = securityContextRepository;
        this.sessionAuthenticationStrategy = sessionAuthenticationStrategy;
        this.demoOtp = demoOtp;
    }

    /**
     * 사용자 로그인 및 JWT 발급
     */
    @PostMapping("/auth/login")
    public ResponseEntity<?> login(
            @RequestBody LoginRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {
        if (request == null || request.username() == null || request.password() == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.username(), request.password())
            );

            DemoUser user = userRepository.findByUsername(authentication.getName())
                    .orElseThrow(() -> new BadCredentialsException("사용자 조회 실패"));

            boolean identityVerified = identityStateRepository.findByUserId(user.getUserId())
                    .map(DemoIdentityState::isIdentityVerified)
                    .orElse(false);

            String token = jwtIssuerService.issueToken(user, identityVerified);
            String primaryRole = user.getRoles().stream().findFirst().orElse("");

            Authentication sessionAuthentication = UsernamePasswordAuthenticationToken.authenticated(
                    user.getUserId(), null, authentication.getAuthorities());
            sessionAuthenticationStrategy.onAuthentication(sessionAuthentication, httpRequest, httpResponse);
            SecurityContext securityContext = SecurityContextHolder.createEmptyContext();
            securityContext.setAuthentication(sessionAuthentication);
            SecurityContextHolder.setContext(securityContext);
            securityContextRepository.saveContext(securityContext, httpRequest, httpResponse);

            LoginResponse response = new LoginResponse(
                    token,
                    jwtIssuerService.getExpirationSeconds(),
                    new UserSummary(user.getUserId(), primaryRole)
            );

            return ResponseEntity.ok(response);
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
    }

    /**
     * 현재 인증 사용자 정보 반환
     */
    @GetMapping("/auth/me")
    public ResponseEntity<MeResponse> me(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String userId = authentication.getName();
        List<String> roles = authentication.getAuthorities().stream()
                .map(authority -> authority.getAuthority())
                .toList();
        Boolean identityVerified = identityStateRepository.findByUserId(userId)
                .map(DemoIdentityState::isIdentityVerified)
                .orElse(false);
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            identityVerified = jwt.getClaim("identity_verified");
        }

        return ResponseEntity.ok(new MeResponse(userId, roles, identityVerified));
    }

    /**
     * 브라우저용 CSRF Token 발급
     */
    @GetMapping("/auth/csrf")
    public CsrfToken csrf(CsrfToken token) {
        return token;
    }

    /**
     * 현재 인증 사용자의 본인확인 상태 조회
     */
    @GetMapping("/identity/status")
    public ResponseEntity<IdentityStatusResponse> identityStatus(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoIdentityState state = identityStateRepository.findByUserId(authentication.getName())
                .orElse(new DemoIdentityState(authentication.getName(), false, false, null));
        return ResponseEntity.ok(new IdentityStatusResponse(
                state.isIdentityVerified(), state.getVerifiedAt()));
    }

    /**
     * 서버 보유 OTP 검증 및 본인확인 완료 JWT 재발급
     */
    @PostMapping("/identity/verify")
    public ResponseEntity<?> verify(
            @RequestBody IdentityVerificationRequest request,
            Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (request == null
                || !"DEMO_OTP".equals(request.method())
                || request.verificationCode() == null
                || !request.verificationCode().matches("\\d{6}")
                || !demoOtp.equals(request.verificationCode())) {
            return ResponseEntity.badRequest().build();
        }

        String userId = authentication.getName();
        DemoUser user = userRepository.findByUserId(userId).orElse(null);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        LocalDateTime verifiedAt = LocalDateTime.now();
        String token = jwtIssuerService.issueToken(user, true);
        identityStateRepository.save(new DemoIdentityState(userId, true, true, verifiedAt));

        return ResponseEntity.ok(new IdentityVerificationResponse(
                token,
                jwtIssuerService.getExpirationSeconds(),
                true,
                verifiedAt));
    }
}

