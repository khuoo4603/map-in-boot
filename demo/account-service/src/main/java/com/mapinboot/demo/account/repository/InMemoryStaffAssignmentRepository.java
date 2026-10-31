package com.mapinboot.demo.account.repository;

import com.mapinboot.demo.account.model.DemoStaffAssignment;
import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

/**
 * 인메모리 직원-고객 배정 저장소
 */
@Repository
public class InMemoryStaffAssignmentRepository {

    private final Map<String, DemoStaffAssignment> assignmentsByKey = new ConcurrentHashMap<>();

    /**
     * 초기 직원 배정 Fixture 생성 및 적재
     */
    @PostConstruct
    public void initFixtures() {
        assignmentsByKey.clear();

        save(new DemoStaffAssignment("STAFF001", "CUST001", true, "BRANCH_ASSIGNED"));
        save(new DemoStaffAssignment("STAFF002", "CUST002", true, "BRANCH_ASSIGNED"));
    }

    /**
     * 배정 정보 저장
     */
    public void save(DemoStaffAssignment assignment) {
        String key = assignment.getStaffId() + ":" + assignment.getCustomerId();
        assignmentsByKey.put(key, assignment);
    }

    /**
     * 직원 ID 기준 담당 고객 배정 목록 조회
     */
    public List<DemoStaffAssignment> findByStaffId(String staffId) {
        return assignmentsByKey.values().stream()
                .filter(assignment -> assignment.getStaffId().equals(staffId))
                .toList();
    }

    /**
     * 직원 ID 및 고객 ID 기준 단건 배정 정보 조회
     */
    public Optional<DemoStaffAssignment> findByStaffIdAndCustomerId(String staffId, String customerId) {
        String key = staffId + ":" + customerId;
        return Optional.ofNullable(assignmentsByKey.get(key));
    }

    /**
     * 고객 ID 기준 배정 정보 목록 조회
     */
    public List<DemoStaffAssignment> findByCustomerId(String customerId) {
        return assignmentsByKey.values().stream()
                .filter(assignment -> assignment.getCustomerId().equals(customerId))
                .toList();
    }

    /**
     * 전체 배정 정보 목록 조회
     */
    public List<DemoStaffAssignment> findAll() {
        return new ArrayList<>(assignmentsByKey.values());
    }
}

