package com.mapinboot.demo.account.service;

import com.mapinboot.demo.account.model.DemoCustomer;
import com.mapinboot.demo.account.model.DemoStaffAssignment;
import com.mapinboot.demo.account.repository.InMemoryCustomerRepository;
import com.mapinboot.demo.account.repository.InMemoryStaffAssignmentRepository;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/** 직원 고객 업무의 검색·객체 권한·담당 범위 처리 */
@Service
public class StaffCustomerService {

    private final InMemoryCustomerRepository customerRepository;
    private final InMemoryStaffAssignmentRepository assignmentRepository;

    public StaffCustomerService(
            InMemoryCustomerRepository customerRepository,
            InMemoryStaffAssignmentRepository assignmentRepository) {
        this.customerRepository = customerRepository;
        this.assignmentRepository = assignmentRepository;
    }

    /** 고객 ID·표시명 기준 고객 검색 */
    public List<DemoCustomer> searchCustomers(String query) {
        String keyword = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        return customerRepository.findAll().stream()
                .filter(customer -> keyword.isEmpty()
                        || customer.getCustomerId().toLowerCase(Locale.ROOT).contains(keyword)
                        || customer.getDisplayName().toLowerCase(Locale.ROOT).contains(keyword))
                .toList();
    }

    /*
     * Scenario: N04 (counterpart: V04)
     * API: GET /api/staff/secured/customers/{customerId}
     * Rule: METHOD_MISMATCH
     * Normal: Spring Security Method Security Proxy를 통한 ROLE_STAFF 검사
     * Vulnerable: 동일 Bean 내부 호출과 구분되는 보호 메서드
     */
    @PreAuthorize("hasAuthority('ROLE_STAFF')")
    public Optional<DemoCustomer> findCustomer(String customerId) {
        return customerRepository.findByCustomerId(customerId);
    }

    /*
     * Scenario: V04 (counterpart: N04)
     * API: GET /api/staff/customers/{customerId}
     * Rule: METHOD_MISMATCH
     * Vulnerable: 동일 Bean의 this 호출로 Method Security Proxy 우회
     * Normal: 외부 Bean 호출은 보호 메서드 Proxy 경유
     */
    public Optional<DemoCustomer> findCustomerThroughSelfInvocation(String customerId) {
        return this.findCustomer(customerId);
    }

    /** 직원 ID·고객 ID 기준 담당 관계 확인 */
    public boolean isAssigned(String staffId, String customerId) {
        return assignmentRepository.findByStaffIdAndCustomerId(staffId, customerId)
                .map(DemoStaffAssignment::isAssigned)
                .orElse(false);
    }
}
