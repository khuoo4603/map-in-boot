package com.mapinboot.security.autoconfigure;

import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.analyzer.FilterRegistrationAnalysisAdapter;
import com.mapinboot.security.analyzer.MethodSecurityAnalysisAdapter;
import com.mapinboot.security.analyzer.CredentialUsageAnalysisAdapter;
import com.mapinboot.security.analyzer.AuthorizationAnalysisAdapter;
import com.mapinboot.security.analyzer.BusinessStateAnalysisAdapter;
import com.mapinboot.security.collector.MethodSecurityCollectorAdapter;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import com.mapinboot.security.collector.JwtUsageCollectorAdapter;
import com.mapinboot.security.collector.SessionUsageCollectorAdapter;
import com.mapinboot.security.collector.HeaderUsageCollectorAdapter;
import com.mapinboot.security.collector.PrincipalUsageCollectorAdapter;
import com.mapinboot.security.collector.ObjectAuthorizationCollectorAdapter;
import com.mapinboot.security.collector.BusinessStateCollectorAdapter;
import com.mapinboot.security.finding.SecurityRuleEngine;
import com.mapinboot.core.finding.FindingEvaluator;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.security.web.FilterChainProxy;

// Spring Security Runtime Collector 자동 구성
@AutoConfiguration
@ConditionalOnClass(FilterChainProxy.class)
@ConditionalOnProperty(prefix = "mapinboot", name = "enabled", havingValue = "true", matchIfMissing = true)
public class MapInBootSecurityAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(SecurityChainCollectorAdapter.class)
    SecurityChainCollectorAdapter securityChainCollectorAdapter() {
        return new SecurityChainCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(MethodSecurityCollectorAdapter.class)
    MethodSecurityCollectorAdapter methodSecurityCollectorAdapter() {
        return new MethodSecurityCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(JwtUsageCollectorAdapter.class)
    JwtUsageCollectorAdapter jwtUsageCollectorAdapter() {
        return new JwtUsageCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(SessionUsageCollectorAdapter.class)
    SessionUsageCollectorAdapter sessionUsageCollectorAdapter() {
        return new SessionUsageCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(HeaderUsageCollectorAdapter.class)
    HeaderUsageCollectorAdapter headerUsageCollectorAdapter() {
        return new HeaderUsageCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(PrincipalUsageCollectorAdapter.class)
    PrincipalUsageCollectorAdapter principalUsageCollectorAdapter() {
        return new PrincipalUsageCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(ObjectAuthorizationCollectorAdapter.class)
    ObjectAuthorizationCollectorAdapter objectAuthorizationCollectorAdapter() {
        return new ObjectAuthorizationCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(BusinessStateCollectorAdapter.class)
    BusinessStateCollectorAdapter businessStateCollectorAdapter() {
        return new BusinessStateCollectorAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(EndpointChainMatchingAnalysisAdapter.class)
    EndpointChainMatchingAnalysisAdapter endpointChainMatchingAnalysisAdapter() {
        return new EndpointChainMatchingAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(MethodSecurityAnalysisAdapter.class)
    MethodSecurityAnalysisAdapter methodSecurityAnalysisAdapter() {
        return new MethodSecurityAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(FilterRegistrationAnalysisAdapter.class)
    FilterRegistrationAnalysisAdapter filterRegistrationAnalysisAdapter() {
        return new FilterRegistrationAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(CredentialUsageAnalysisAdapter.class)
    CredentialUsageAnalysisAdapter credentialUsageAnalysisAdapter() {
        return new CredentialUsageAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(AuthorizationAnalysisAdapter.class)
    AuthorizationAnalysisAdapter authorizationAnalysisAdapter() {
        return new AuthorizationAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(BusinessStateAnalysisAdapter.class)
    BusinessStateAnalysisAdapter businessStateAnalysisAdapter() {
        return new BusinessStateAnalysisAdapter();
    }

    @Bean
    @ConditionalOnMissingBean(FindingEvaluator.class)
    SecurityRuleEngine securityRuleEngine() {
        return new SecurityRuleEngine();
    }
}
