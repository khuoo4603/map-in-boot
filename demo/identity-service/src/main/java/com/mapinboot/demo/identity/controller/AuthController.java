package com.mapinboot.demo.identity.controller;

import com.mapinboot.demo.identity.dto.LoginRequest;
import com.mapinboot.demo.identity.dto.LoginResponse;
import com.mapinboot.demo.identity.dto.MeResponse;
import com.mapinboot.demo.identity.dto.UserSummary;
import com.mapinboot.demo.identity.model.DemoIdentityState;
import com.mapinboot.demo.identity.model.DemoUser;
import com.mapinboot.demo.identity.repository.InMemoryIdentityStateRepository;
import com.mapinboot.demo.identity.repository.InMemoryUserRepository;
import com.mapinboot.demo.identity.security.JwtIssuerService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 인증 및 현재 사용자 정보 API 컨트롤러
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final InMemoryUserRepository userRepository;
    private final InMemoryIdentityStateRepository identityStateRepository;
    private final JwtIssuerService jwtIssuerService;

    public AuthController(
            AuthenticationManager authenticationManager,
            InMemoryUserRepository userRepository,
            InMemoryIdentityStateRepository identityStateRepository,
            JwtIssuerService jwtIssuerService) {
        this.authenticationManager = authenticationManager;
        this.userRepository = userRepository;
        this.identityStateRepository = identityStateRepository;
        this.jwtIssuerService = jwtIssuerService;
    }

    /**
     * 사용자 로그인 및 JWT 발급
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
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

            LoginResponse response = new LoginResponse(
                    token,
                    jwtIssuerService.getExpirationSeconds(),
                    new UserSummary(user.getUserId(), primaryRole)
            );

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
    }

    /**
     * 현재 인증 사용자 정보 반환
     */
    @GetMapping("/me")
    public ResponseEntity<MeResponse> me(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String userId = jwt.getSubject();
        List<String> roles = jwt.getClaimAsStringList("roles");
        Boolean identityVerified = jwt.getClaim("identity_verified");

        return ResponseEntity.ok(new MeResponse(userId, roles, identityVerified));
    }
}

