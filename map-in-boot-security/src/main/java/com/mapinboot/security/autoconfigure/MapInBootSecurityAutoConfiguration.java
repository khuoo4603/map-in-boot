package com.mapinboot.security.autoconfigure;

import com.mapinboot.security.analyzer.EndpointChainMatchingAnalysisAdapter;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
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
    @ConditionalOnMissingBean(EndpointChainMatchingAnalysisAdapter.class)
    EndpointChainMatchingAnalysisAdapter endpointChainMatchingAnalysisAdapter() {
        return new EndpointChainMatchingAnalysisAdapter();
    }
}
