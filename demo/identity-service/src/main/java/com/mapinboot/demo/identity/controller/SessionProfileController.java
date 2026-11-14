package com.mapinboot.demo.identity.controller;

import com.mapinboot.core.annotation.RequiresObjectAuthorization;
import com.mapinboot.demo.identity.model.DemoCustomerProfile;
import com.mapinboot.demo.identity.repository.InMemoryCustomerProfileRepository;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * Session 기반 고객 프로필 조회 API 컨트롤러
 */
@RestController
public class SessionProfileController {

    private final InMemoryCustomerProfileRepository profileRepository;

    public SessionProfileController(InMemoryCustomerProfileRepository profileRepository) {
        this.profileRepository = profileRepository;
    }

    /**
     * Session 사용자와 고객 프로필 소유자 비교를 수행하는 정상 프로필 조회
     */
    @GetMapping("/api/session/secured/customers/{customerId}/profile")
    @RequiresObjectAuthorization(
            kind = "OWNER", resourceType = DemoCustomerProfile.class, principalSource = "AUTHENTICATION_NAME")
    public ResponseEntity<?> getSecuredProfile(
            @PathVariable String customerId,
            Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoCustomerProfile profile = profileRepository.findByCustomerId(customerId).orElse(null);
        if (profile == null) {
            return ResponseEntity.notFound().build();
        }

        if (!profile.getUserId().equals(authentication.getName())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }

        return ResponseEntity.ok(Map.of(
                "customerId", profile.getCustomerId(),
                "displayName", profile.getDisplayName()));
    }

    /**
     * Session 인증만 수행하는 취약 프로필 조회
     */
    @GetMapping("/api/session/customers/{customerId}/profile")
    @RequiresObjectAuthorization(
            kind = "OWNER", resourceType = DemoCustomerProfile.class, principalSource = "AUTHENTICATION_NAME")
    public ResponseEntity<?> getProfileWithoutOwnerCheck(
            @PathVariable String customerId,
            Authentication authentication) {
        /*
         * Scenario: V06 (counterpart: N06)
         * Rule: OBJECT_BINDING
         * Session 사용자와 Profile.userId 비교 생략
         */
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        DemoCustomerProfile profile = profileRepository.findByCustomerId(customerId).orElse(null);
        if (profile == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
                "customerId", profile.getCustomerId(),
                "displayName", profile.getDisplayName()));
    }
}
