package com.mapinboot.demo.identity.repository;

import com.mapinboot.demo.identity.model.DemoUser;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 사용자 저장소
 */
@Repository
public class InMemoryUserRepository {

    private final Map<String, DemoUser> usersByUsername = new ConcurrentHashMap<>();
    private final Map<String, DemoUser> usersByUserId = new ConcurrentHashMap<>();
    private final PasswordEncoder passwordEncoder;
    private final String demoTestPassword;

    public InMemoryUserRepository(
            PasswordEncoder passwordEncoder,
            @Value("${DEMO_TEST_PASSWORD:#{null}}") String demoTestPassword) {
        this.passwordEncoder = passwordEncoder;
        this.demoTestPassword = demoTestPassword;
    }

    /**
     * 초기 사용자 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        if (demoTestPassword == null || demoTestPassword.isBlank()) {
            throw new IllegalStateException("DEMO_TEST_PASSWORD 환경변수 누락으로 초기화 중단");
        }

        usersByUsername.clear();
        usersByUserId.clear();

        String encodedPassword = passwordEncoder.encode(demoTestPassword);

        // 6개 기본 계정 Fixture 등록
        saveUser(new DemoUser("USER001", "customer.a", encodedPassword, Set.of("ROLE_CUSTOMER"), true));
        saveUser(new DemoUser("USER002", "customer.b", encodedPassword, Set.of("ROLE_CUSTOMER"), true));
        saveUser(new DemoUser("STAFF001", "staff.a", encodedPassword, Set.of("ROLE_STAFF"), true));
        saveUser(new DemoUser("STAFF002", "staff.b", encodedPassword, Set.of("ROLE_STAFF"), true));
        saveUser(new DemoUser("ADMIN001", "bank.admin", encodedPassword, Set.of("ROLE_BANK_ADMIN"), true));
        saveUser(new DemoUser("DEV001", "mib.dev", encodedPassword, Set.of("MAP_IN_BOOT_ADMIN"), true));
    }

    /**
     * 사용자 단건 저장
     */
    public void saveUser(DemoUser user) {
        usersByUsername.put(user.getUsername(), user);
        usersByUserId.put(user.getUserId(), user);
    }

    /**
     * 사용자명 기준 단건 조회
     */
    public Optional<DemoUser> findByUsername(String username) {
        return Optional.ofNullable(usersByUsername.get(username));
    }

    /**
     * 사용자 ID 기준 단건 조회
     */
    public Optional<DemoUser> findByUserId(String userId) {
        return Optional.ofNullable(usersByUserId.get(userId));
    }

    /**
     * 전체 사용자 목록 조회
     */
    public List<DemoUser> findAll() {
        return new ArrayList<>(usersByUsername.values());
    }
}

