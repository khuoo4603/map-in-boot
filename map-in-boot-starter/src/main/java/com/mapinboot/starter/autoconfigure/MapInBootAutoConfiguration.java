package com.mapinboot.starter.autoconfigure;

import com.mapinboot.core.analysis.AnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.CollectorAdapter;
import com.mapinboot.core.finding.FindingEvaluator;
import com.mapinboot.starter.bootstrap.MapInBootBootstrap;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.collector.ServletFilterCollectorAdapter;
import com.mapinboot.starter.collector.ServletRegistrationCollectorAdapter;
import com.mapinboot.starter.snapshot.SnapshotAssembler;
import com.mapinboot.starter.snapshot.SnapshotJsonCodec;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Starter Runtime 자동 구성
@AutoConfiguration
@EnableConfigurationProperties(MapInBootProperties.class)
public class MapInBootAutoConfiguration {

    // SDK 실행 자원 조건부 구성
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnProperty(prefix = "mapinboot", name = "enabled", havingValue = "true", matchIfMissing = true)
    static class RuntimeConfiguration {

        @Bean
        @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
        @ConditionalOnClass(name = "jakarta.servlet.ServletContext")
        @ConditionalOnMissingBean(ServletRegistrationCollectorAdapter.class)
        ServletRegistrationCollectorAdapter servletRegistrationCollectorAdapter() {
            return new ServletRegistrationCollectorAdapter();
        }

        @Bean
        @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
        @ConditionalOnClass(name = "jakarta.servlet.ServletContext")
        @ConditionalOnMissingBean(ServletFilterCollectorAdapter.class)
        ServletFilterCollectorAdapter servletFilterCollectorAdapter() {
            return new ServletFilterCollectorAdapter();
        }

        @Bean
        @ConditionalOnMissingBean
        CollectionProvider collectionProvider() {
            return new CollectionProvider();
        }

        @Bean
        @ConditionalOnMissingBean
        AnalysisProvider analysisProvider() {
            return new AnalysisProvider();
        }

        @Bean
        @ConditionalOnMissingBean
        SnapshotAssembler snapshotAssembler(List<FindingEvaluator> findingEvaluators) {
            return new SnapshotAssembler(findingEvaluators, "1");
        }

        @Bean
        @ConditionalOnMissingBean
        SnapshotJsonCodec snapshotJsonCodec() {
            return new SnapshotJsonCodec();
        }

        @Bean(name = "mapInBootExecutor", destroyMethod = "shutdown", defaultCandidate = false)
        @ConditionalOnMissingBean(name = "mapInBootExecutor")
        ExecutorService mapInBootExecutor() {
            return Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "map-in-boot-runtime");
                thread.setDaemon(true);
                return thread;
            });
        }

        @Bean
        @ConditionalOnMissingBean
        MapInBootBootstrap mapInBootBootstrap(
                ApplicationContext applicationContext,
                CollectionProvider collectionProvider,
                AnalysisProvider analysisProvider,
                List<CollectorAdapter> collectorAdapters,
                List<AnalysisAdapter> analysisAdapters,
                @Qualifier("mapInBootExecutor") ExecutorService executor,
                SnapshotAssembler snapshotAssembler,
                SnapshotJsonCodec snapshotJsonCodec
        ) {
            return new MapInBootBootstrap(
                    applicationContext, collectionProvider, analysisProvider, collectorAdapters, analysisAdapters, executor,
                    snapshotAssembler, snapshotJsonCodec);
        }
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnProperty(prefix = "mapinboot", name = "enabled", havingValue = "true", matchIfMissing = true)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnClass(name = "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping")
    static class MvcRuntimeConfiguration {

        @Bean
        @ConditionalOnMissingBean(EndpointMappingCollectorAdapter.class)
        EndpointMappingCollectorAdapter endpointMappingCollectorAdapter() {
            return new EndpointMappingCollectorAdapter();
        }
    }
}
