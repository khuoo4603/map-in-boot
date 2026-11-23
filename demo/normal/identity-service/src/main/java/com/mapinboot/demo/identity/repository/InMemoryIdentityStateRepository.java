package com.mapinboot.demo.identity.repository;

import com.mapinboot.demo.identity.model.DemoIdentityState;
import jakarta.annotation.PostConstruct;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 본인확인 상태 저장소
 */
@Repository
public class InMemoryIdentityStateRepository {

    private final Map<String, DemoIdentityState> statesByUserId = new ConcurrentHashMap<>();

    /**
     * 초기 본인확인 상태 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        statesByUserId.clear();

        // 고객 초기 본인확인 미완료 상태 등록
        save(new DemoIdentityState("USER001", false, false, null));
        save(new DemoIdentityState("USER002", false, false, null));
    }

    /**
     * 사용자 ID 기준 본인확인 상태 조회
     */
    public Optional<DemoIdentityState> findByUserId(String userId) {
        return Optional.ofNullable(statesByUserId.get(userId));
    }

    /**
     * 본인확인 상태 저장 및 갱신
     */
    public DemoIdentityState save(DemoIdentityState state) {
        statesByUserId.put(state.getUserId(), state);
        return state;
    }
}

