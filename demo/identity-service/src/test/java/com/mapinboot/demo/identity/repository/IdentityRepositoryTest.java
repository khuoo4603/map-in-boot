package com.mapinboot.demo.identity.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mapinboot.demo.identity.model.DemoIdentityState;
import com.mapinboot.demo.identity.model.DemoUser;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Identity 저장소 및 Fixture 관계 검증 테스트
 */
class IdentityRepositoryTest {

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final String rawPassword = "testPassword123!";

    @Test
    @DisplayName("사용자 6개 계정 구성 및 BCrypt 해시 저장 검증")
    void testUserFixturesAndBcryptHash() {
        InMemoryUserRepository userRepository = new InMemoryUserRepository(passwordEncoder, rawPassword);
        userRepository.initFixtures();

        assertThat(userRepository.findAll()).hasSize(6);

        // 계정별 ID, 권한, 활성 상태 검증
        DemoUser customerA = userRepository.findByUsername("customer.a").orElseThrow();
        assertThat(customerA.getUserId()).isEqualTo("USER001");
        assertThat(customerA.getRoles()).isEqualTo(Set.of("ROLE_CUSTOMER"));
        assertThat(customerA.isEnabled()).isTrue();

        DemoUser customerB = userRepository.findByUsername("customer.b").orElseThrow();
        assertThat(customerB.getUserId()).isEqualTo("USER002");
        assertThat(customerB.getRoles()).isEqualTo(Set.of("ROLE_CUSTOMER"));

        DemoUser staffA = userRepository.findByUsername("staff.a").orElseThrow();
        assertThat(staffA.getUserId()).isEqualTo("STAFF001");
        assertThat(staffA.getRoles()).isEqualTo(Set.of("ROLE_STAFF"));

        DemoUser staffB = userRepository.findByUsername("staff.b").orElseThrow();
        assertThat(staffB.getUserId()).isEqualTo("STAFF002");
        assertThat(staffB.getRoles()).isEqualTo(Set.of("ROLE_STAFF"));

        DemoUser admin = userRepository.findByUsername("bank.admin").orElseThrow();
        assertThat(admin.getUserId()).isEqualTo("ADMIN001");
        assertThat(admin.getRoles()).isEqualTo(Set.of("ROLE_BANK_ADMIN"));

        DemoUser dev = userRepository.findByUsername("mib.dev").orElseThrow();
        assertThat(dev.getUserId()).isEqualTo("DEV001");
        assertThat(dev.getRoles()).isEqualTo(Set.of("MAP_IN_BOOT_ADMIN"));

        // BCrypt 해시 저장 및 원문 일치 검증
        assertThat(customerA.getPasswordHash()).isNotEqualTo(rawPassword);
        assertThat(passwordEncoder.matches(rawPassword, customerA.getPasswordHash())).isTrue();
    }

    @Test
    @DisplayName("환경변수 누락 시 안전한 실패 처리 검증")
    void testMissingPasswordEnvironmentVariable() {
        InMemoryUserRepository missingRepo = new InMemoryUserRepository(passwordEncoder, null);
        assertThatThrownBy(missingRepo::initFixtures)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DEMO_TEST_PASSWORD");
    }

    @Test
    @DisplayName("본인확인 초기 상태 및 상태 갱신 검증")
    void testIdentityStateFixturesAndLifecycle() {
        InMemoryIdentityStateRepository stateRepository = new InMemoryIdentityStateRepository();
        stateRepository.initFixtures();

        // USER001, USER002 초기 미완료 상태 검증
        DemoIdentityState state1 = stateRepository.findByUserId("USER001").orElseThrow();
        assertThat(state1.isIdentityVerified()).isFalse();
        assertThat(state1.isOtpVerified()).isFalse();
        assertThat(state1.getVerifiedAt()).isNull();

        DemoIdentityState state2 = stateRepository.findByUserId("USER002").orElseThrow();
        assertThat(state2.isIdentityVerified()).isFalse();
        assertThat(state2.isOtpVerified()).isFalse();

        // 존재하지 않는 사용자 조회 시 빈 Optional 반환
        Optional<DemoIdentityState> unknownState = stateRepository.findByUserId("UNKNOWN");
        assertThat(unknownState).isEmpty();

        // 상태 갱신 및 재조회 검증
        LocalDateTime now = LocalDateTime.now();
        stateRepository.save(new DemoIdentityState("USER001", true, true, now));
        DemoIdentityState updated1 = stateRepository.findByUserId("USER001").orElseThrow();
        assertThat(updated1.isIdentityVerified()).isTrue();
        assertThat(updated1.isOtpVerified()).isTrue();
        assertThat(updated1.getVerifiedAt()).isEqualTo(now);

        // 재기동 시 초기화 원복 검증
        stateRepository.initFixtures();
        DemoIdentityState reset1 = stateRepository.findByUserId("USER001").orElseThrow();
        assertThat(reset1.isIdentityVerified()).isFalse();
    }
}

