package com.mapinboot.starter.bootstrap;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.GraphFingerprintGenerator;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.starter.autoconfigure.MapInBootProperties;
import com.mapinboot.starter.collector.EndpointMappingCollectorAdapter;
import com.mapinboot.starter.collector.ServletFilterCollectorAdapter;
import com.mapinboot.starter.collector.ServletRegistrationCollectorAdapter;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletRegistration;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.test.context.FilteredClassLoader;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RuntimeCollectorIntegrationTest {
    @TempDir
    Path tempDirectory;

    @Test
    void runtimeCollectorsPreserveActualMvcServletAndFilterRegistrations() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            CollectionContext collectionContext = new CollectionContext(context, "runtime-host", "instance");
            EndpointMappingCollectorAdapter endpointCollector = context.getBean(EndpointMappingCollectorAdapter.class);
            ServletRegistrationCollectorAdapter servletCollector = context.getBean(ServletRegistrationCollectorAdapter.class);
            ServletFilterCollectorAdapter filterCollector = context.getBean(ServletFilterCollectorAdapter.class);

            CollectionResult endpoints = endpointCollector.collect(collectionContext);
            CollectionResult servlets = servletCollector.collect(collectionContext);
            CollectionResult filters = filterCollector.collect(collectionContext);
            CollectionResult repeatedEndpoints = endpointCollector.collect(collectionContext);

            RequestMappingHandlerMapping handlerMapping = context.getBean(RequestMappingHandlerMapping.class);
            List<Map.Entry<RequestMappingInfo, HandlerMethod>> errorMappings = handlerMapping.getHandlerMethods().entrySet().stream()
                    .filter(entry -> entry.getKey().getPatternValues().contains("/error")).toList();

            assertEquals(AnalysisStatus.READY, endpoints.status());
            assertEquals(2, errorMappings.size());
            assertTrue(errorMappings.stream().allMatch(entry -> entry.getKey().getMethodsCondition().getMethods().isEmpty()));
            assertFalse(endpoints.facts().isEmpty());
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/first")));
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/second")));
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/multi")
                    && fact.attributes().get("httpMethod").equals("GET")));
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/multi")
                    && fact.attributes().get("httpMethod").equals("POST")));
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/any")
                    && fact.attributes().get("httpMethod").equals("ANY")));
            List<com.mapinboot.core.evidence.Fact> errorFacts = endpoints.facts().stream()
                    .filter(fact -> fact.attributes().get("path").equals("/error")).toList();
            assertEquals(2, errorFacts.size());
            assertTrue(errorFacts.stream().allMatch(fact -> fact.attributes().get("httpMethod").equals("ANY")));
            assertTrue(errorFacts.stream().anyMatch(fact -> "text/html".equals(fact.attributes().get("produces"))));
            assertTrue(errorFacts.stream().anyMatch(fact -> !fact.attributes().containsKey("produces")));
            assertTrue(errorFacts.stream().allMatch(fact -> endpoints.evidence().stream().anyMatch(evidence ->
                    fact.evidenceIds().contains(evidence.id()) && evidence.summary().equals("등록 Endpoint: ANY /error"))));
            assertEquals(2, endpoints.facts().stream()
                    .filter(fact -> fact.attributes().get("path").equals("/runtime/condition"))
                    .count());
            assertTrue(endpoints.facts().stream().filter(fact -> fact.attributes().get("path").equals("/runtime/condition"))
                    .allMatch(fact -> fact.attributes().get("handler").contains("RuntimeController#")
                            && fact.attributes().containsKey("params")));
            assertEquals(2, endpoints.facts().stream().filter(fact -> fact.attributes().get("path").equals("/runtime/condition"))
                    .map(fact -> fact.attributes().get("params")).distinct().count());
            assertTrue(endpoints.facts().stream().allMatch(fact -> fact.attributes()
                    .get("handlerMapping").equals("requestMappingHandlerMapping")));
            assertTrue(endpoints.facts().stream().anyMatch(fact -> fact.attributes().get("handler")
                    .contains("SecondaryRuntimeController#secondary")));
            assertEquals(endpoints, repeatedEndpoints);
            assertTrue(endpoints.facts().stream().allMatch(fact -> endpoints.evidence().stream()
                    .anyMatch(evidence -> fact.evidenceIds().contains(evidence.id()))));

            assertTrue(servlets.facts().stream().anyMatch(fact -> fact.attributes().get("servletName").equals("dispatcherServlet")
                    && fact.attributes().get("servletKind").equals("DISPATCHER")));
            assertTrue(servlets.facts().stream().anyMatch(fact -> fact.attributes().get("servletName").equals("extraServlet")
                    && fact.attributes().get("urlPattern").equals("/extra/*")));
            assertTrue(servlets.facts().stream().anyMatch(fact -> fact.attributes().get("servletName").equals("extraServlet")
                    && fact.attributes().get("urlPattern").equals("/alternate/*")));

            assertEquals(3, filters.facts().stream()
                    .filter(fact -> fact.attributes().get("filterClass").equals(SharedFilter.class.getName()))
                    .count());
            assertTrue(filters.facts().stream().allMatch(fact -> fact.attributes().get("registrationKind").equals("SERVLET")));
            assertTrue(filters.facts().stream().anyMatch(fact -> fact.attributes().get("registrationName").equals("firstFilter")
                    && fact.attributes().get("urlPatterns").contains("/runtime/*")));
            assertTrue(filters.facts().stream().anyMatch(fact -> fact.attributes().get("registrationName").equals("secondFilter")
                    && fact.attributes().get("servletNames").contains("dispatcherServlet")));
            assertTrue(filters.facts().stream().anyMatch(fact -> fact.attributes().get("registrationName").equals("springSecurityFilterChain")
                    && fact.attributes().get("registrationKind").equals("SERVLET")));

            CollectionReport collectionReport = new CollectionProvider().execute(
                    collectionContext, List.of(endpointCollector, servletCollector, filterCollector));
            AnalysisReport analysisReport = new AnalysisProvider().execute(
                    new AnalysisContext(collectionReport, "runtime-host"), List.of());
            SecurityGraph graph = new GraphBuilder().build("runtime-host", analysisReport);
            CollectionReport repeatedReport = new CollectionProvider().execute(
                    collectionContext, List.of(endpointCollector, servletCollector, filterCollector));
            SecurityGraph repeatedGraph = new GraphBuilder().build("runtime-host", new AnalysisProvider().execute(
                    new AnalysisContext(repeatedReport, "runtime-host"), List.of()));
            assertTrue(graph.nodes().stream().anyMatch(node -> node.type() == NodeType.ENDPOINT));
            assertTrue(graph.nodes().stream().anyMatch(node -> node.type() == NodeType.HANDLER));
            assertTrue(graph.nodes().stream().anyMatch(node -> node.type() == NodeType.SERVLET));
            assertTrue(graph.nodes().stream().anyMatch(node -> node.type() == NodeType.FILTER));
            assertTrue(graph.nodes().stream().allMatch(node -> node.evidenceIds().stream()
                    .allMatch(id -> collectionReport.evidence().stream().anyMatch(evidence -> evidence.id().equals(id)))));
            assertEquals(new GraphFingerprintGenerator().generate(graph), new GraphFingerprintGenerator().generate(repeatedGraph));
        }
    }

    @Test
    void readyEndpointCollectionRunsAnalyzerThatRequiresEndpointFacts() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            EndpointMappingCollectorAdapter endpointCollector = context.getBean(EndpointMappingCollectorAdapter.class);
            CollectionContext collectionContext = new CollectionContext(context, "runtime-host", "instance");
            CollectionReport collectionReport = new CollectionProvider().execute(collectionContext, List.of(endpointCollector));
            EndpointRequiredAnalyzer analyzer = new EndpointRequiredAnalyzer();

            AnalysisReport analysisReport = new AnalysisProvider().execute(
                    new AnalysisContext(collectionReport, "runtime-host"), List.of(analyzer));

            assertEquals(AnalysisStatus.READY, collectionReport.statusByAdapter().get(endpointCollector.id()));
            assertTrue(collectionReport.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/multi")));
            assertEquals(1, analyzer.calls());
            assertEquals(AnalysisStatus.READY, analysisReport.statusByAdapter().get(analyzer.id()));
        }
    }

    @Test
    void partialEndpointMetadataFailurePreservesFactsAndSkipsRequiredAnalyzer() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            EndpointMappingCollectorAdapter endpointCollector = context.getBean(EndpointMappingCollectorAdapter.class);
            CollectionContext collectionContext = failedEndpointContext(context);
            EndpointRequiredAnalyzer analyzer = new EndpointRequiredAnalyzer();

            CollectionReport collectionReport = new CollectionProvider().execute(collectionContext, List.of(endpointCollector));
            AnalysisReport analysisReport = new AnalysisProvider().execute(
                    new AnalysisContext(collectionReport, "runtime-host"), List.of(analyzer));

            assertEquals(AnalysisStatus.PARTIAL, collectionReport.statusByAdapter().get(endpointCollector.id()));
            assertTrue(collectionReport.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/multi")));
            assertTrue(collectionReport.diagnostics().stream().anyMatch(diagnostic -> diagnostic.errorCode() == ErrorCode.ADAPTER_FAILED));
            assertEquals(0, analyzer.calls());
            assertEquals(AnalysisStatus.PARTIAL, analysisReport.statusByAdapter().get(analyzer.id()));
        }
    }

    @Test
    void servletAndFilterCollectorsKeepLaterRegistrationsAfterIndividualFailure() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            ServletContext servletContext = ((WebApplicationContext) context).getServletContext();
            CollectionContext failedServletContext = collectionContext(context,
                    registrationFailureContext(servletContext, "getServletRegistrations", "dispatcherServlet", "getMappings"));
            CollectionContext failedFilterContext = collectionContext(context,
                    registrationFailureContext(servletContext, "getFilterRegistrations", "characterEncodingFilter", "getClassName"));
            ServletRegistrationCollectorAdapter servletCollector = context.getBean(ServletRegistrationCollectorAdapter.class);
            ServletFilterCollectorAdapter filterCollector = context.getBean(ServletFilterCollectorAdapter.class);

            CollectionResult servlets = servletCollector.collect(failedServletContext);
            CollectionResult filters = filterCollector.collect(failedFilterContext);

            assertEquals(AnalysisStatus.PARTIAL, servlets.status());
            assertTrue(servlets.diagnostics().stream().anyMatch(diagnostic -> diagnostic.errorCode() == ErrorCode.ADAPTER_FAILED));
            assertTrue(servlets.facts().stream().anyMatch(fact -> fact.attributes().get("servletName").equals("extraServlet")));
            assertEquals(AnalysisStatus.PARTIAL, filters.status());
            assertTrue(filters.diagnostics().stream().anyMatch(diagnostic -> diagnostic.errorCode() == ErrorCode.ADAPTER_FAILED));
            assertTrue(filters.facts().stream().anyMatch(fact -> fact.attributes().get("registrationName").equals("secondFilter")));
        }
    }

    @Test
    void registrationListLookupFailureIsUnknown() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            ServletContext servletContext = ((WebApplicationContext) context).getServletContext();
            ServletRegistrationCollectorAdapter servletCollector = context.getBean(ServletRegistrationCollectorAdapter.class);
            ServletFilterCollectorAdapter filterCollector = context.getBean(ServletFilterCollectorAdapter.class);

            CollectionResult servlets = servletCollector.collect(collectionContext(context,
                    listFailureContext(servletContext, "getServletRegistrations")));
            CollectionResult filters = filterCollector.collect(collectionContext(context,
                    listFailureContext(servletContext, "getFilterRegistrations")));

            assertEquals(AnalysisStatus.UNKNOWN, servlets.status());
            assertEquals(AnalysisStatus.UNKNOWN, filters.status());
            assertTrue(servlets.facts().isEmpty());
            assertTrue(filters.facts().isEmpty());
        }
    }

    @Test
    void providerPreservesEndpointFactsWhenAnotherCollectorFails() {
        try (ConfigurableApplicationContext context = webContext(Map.of())) {
            EndpointMappingCollectorAdapter endpointCollector = context.getBean(EndpointMappingCollectorAdapter.class);
            AbstractCollectorAdapter failingCollector = new AbstractCollectorAdapter("failing-collector", "실패 수집기", java.util.Set.of()) {
                @Override
                public CollectionResult collect(CollectionContext ignored) {
                    throw new MapInBootException(ErrorCode.INVALID_STATE, "테스트 실패");
                }
            };

            CollectionReport report = new CollectionProvider().execute(collectionContext(context), List.of(endpointCollector, failingCollector));

            assertTrue(report.facts().stream().anyMatch(fact -> fact.attributes().get("path").equals("/runtime/multi")));
            assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get(failingCollector.id()));
        }
    }

    @Test
    void runtimeAutoConfigurationRunsOnceKeepsCustomAdaptersAndRemainsActiveWhenWebIsDisabled() {
        try (ConfigurableApplicationContext context = webContext(Map.of("mapinboot.web.enabled", "false"))) {
            MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
            CountingCollector collector = context.getBean(CountingCollector.class);
            CountingAnalyzer analyzer = context.getBean(CountingAnalyzer.class);

            await(() -> bootstrap.analysisReport() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertEquals(1, collector.calls());
            assertEquals(1, analyzer.calls());
            assertNotNull(context.getBean(EndpointMappingCollectorAdapter.class));
            assertNotNull(context.getBean(ServletRegistrationCollectorAdapter.class));
            assertNotNull(context.getBean(ServletFilterCollectorAdapter.class));
            assertFalse(context.getBean(MapInBootProperties.class).getWeb().isEnabled());
        }

        Path starterOnlyDirectory = tempDirectory.resolve("starter-only");
        Map<String, Object> starterOnlyProperties = Map.of(
                "test.analyzer", "false",
                "mapinboot.snapshot.directory", starterOnlyDirectory.toString());
        String starterOnlySnapshotId;
        try (ConfigurableApplicationContext starterOnly = context(
                RuntimeHost.class, WebApplicationType.SERVLET, starterOnlyProperties)) {
            MapInBootBootstrap bootstrap = starterOnly.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertNotNull(bootstrap.collectionReport());
            assertNotNull(bootstrap.analysisReport());
            assertTrue(bootstrap.analysisReport().statusByAdapter().isEmpty());
            assertNotNull(bootstrap.snapshot());
            assertNotNull(bootstrap.persistedSnapshot());
            starterOnlySnapshotId = bootstrap.persistedSnapshot().snapshotId();
        }

        try (ConfigurableApplicationContext restarted = context(
                RuntimeHost.class, WebApplicationType.SERVLET, starterOnlyProperties)) {
            MapInBootBootstrap bootstrap = restarted.getBean(MapInBootBootstrap.class);
            await(() -> bootstrap.persistedSnapshot() != null || bootstrap.failure() != null);

            assertNull(bootstrap.failure());
            assertEquals(starterOnlySnapshotId, bootstrap.persistedSnapshot().snapshotId());
        }
    }

    @Test
    void disabledStarterDoesNotCreateRuntimeCollectorsOrBootstrap() {
        try (ConfigurableApplicationContext context = webContext(Map.of("mapinboot.enabled", "false"))) {
            assertTrue(context.getBeansOfType(EndpointMappingCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(ServletRegistrationCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(ServletFilterCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(MapInBootBootstrap.class).isEmpty());
            assertFalse(context.containsBean("mapInBootExecutor"));
        }
    }

    @Test
    void nonWebHostStartsWithoutServletCollectors() {
        try (ConfigurableApplicationContext context = context(NonWebHost.class, WebApplicationType.NONE, Map.of())) {
            assertTrue(context.getBeansOfType(EndpointMappingCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(ServletRegistrationCollectorAdapter.class).isEmpty());
            assertTrue(context.getBeansOfType(ServletFilterCollectorAdapter.class).isEmpty());
        }
    }

    @Test
    void servletHostWithoutMvcStartsWithServletCollectorsOnly() throws Exception {
        try (FilteredClassLoader filtered = new FilteredClassLoader("org.springframework.web.servlet")) {
            SpringApplication application = new SpringApplication(
                    new DefaultResourceLoader(filtered), ServletOnlyHost.class);
            application.setWebApplicationType(WebApplicationType.SERVLET);
            application.setDefaultProperties(Map.ofEntries(
                    Map.entry("spring.application.name", "servlet-only-host"),
                    Map.entry("server.port", "0"),
                    Map.entry("spring.main.banner-mode", "off"),
                    Map.entry("mapinboot.snapshot.directory", tempDirectory.resolve("servlet-only").toString()),
                    Map.entry("logging.level.root", "OFF")));

            try (ConfigurableApplicationContext context = application.run()) {
                assertTrue(context.getBeansOfType(EndpointMappingCollectorAdapter.class).isEmpty());
                assertNotNull(context.getBean(ServletRegistrationCollectorAdapter.class));
                assertNotNull(context.getBean(ServletFilterCollectorAdapter.class));
                MapInBootBootstrap bootstrap = context.getBean(MapInBootBootstrap.class);
                await(() -> bootstrap.analysisReport() != null || bootstrap.failure() != null);
                assertNull(bootstrap.failure());
            }
        }
    }

    private ConfigurableApplicationContext webContext(Map<String, Object> properties) {
        return context(RuntimeHost.class, WebApplicationType.SERVLET, properties);
    }

    private CollectionContext collectionContext(ConfigurableApplicationContext context) {
        return new CollectionContext(context, "runtime-host", "instance");
    }

    private CollectionContext collectionContext(ConfigurableApplicationContext context, ServletContext servletContext) {
        WebApplicationContext decorated = (WebApplicationContext) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {WebApplicationContext.class}, (proxy, method, arguments) -> {
                    if (method.getName().equals("getServletContext")) {
                        return servletContext;
                    }
                    return invoke(context, method, arguments);
                });
        return new CollectionContext(decorated, "runtime-host", "instance");
    }

    private CollectionContext failedEndpointContext(ConfigurableApplicationContext context) {
        ApplicationContext decorated = (ApplicationContext) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {ApplicationContext.class}, (proxy, method, arguments) -> {
                    if (method.getName().equals("getBeansOfType") && arguments.length == 1
                            && arguments[0] == RequestMappingHandlerMapping.class) {
                        return Map.of(
                                "failingHandlerMapping", new FailingHandlerMapping(),
                                "requestMappingHandlerMapping", context.getBean(RequestMappingHandlerMapping.class));
                    }
                    return invoke(context, method, arguments);
                });
        return new CollectionContext(decorated, "runtime-host", "instance");
    }

    private ServletContext registrationFailureContext(
            ServletContext servletContext, String registrationsMethod, String registrationName, String failingMethod) {
        return (ServletContext) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {ServletContext.class},
                (proxy, method, arguments) -> {
                    if (!method.getName().equals(registrationsMethod)) {
                        return invoke(servletContext, method, arguments);
                    }
                    Map<?, ?> source = (Map<?, ?>) invoke(servletContext, method, arguments);
                    Map<String, Object> registrations = new TreeMap<>();
                    source.forEach((name, value) -> registrations.put((String) name, value));
                    Object registration = registrations.get(registrationName);
                    Class<?> type = registrationsMethod.equals("getServletRegistrations")
                            ? ServletRegistration.class : FilterRegistration.class;
                    registrations.put(registrationName, Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {type},
                            (registrationProxy, registrationMethod, registrationArguments) -> {
                                if (registrationMethod.getName().equals(failingMethod)) {
                                    throw new IllegalStateException("등록 메타데이터 접근 실패");
                                }
                                return invoke(registration, registrationMethod, registrationArguments);
                            }));
                    return registrations;
                });
    }

    private ServletContext listFailureContext(ServletContext servletContext, String failingMethod) {
        return (ServletContext) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {ServletContext.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals(failingMethod)) {
                        throw new IllegalStateException("등록 목록 접근 실패");
                    }
                    return invoke(servletContext, method, arguments);
                });
    }

    private Object invoke(Object target, Method method, Object[] arguments) throws Throwable {
        try {
            return method.invoke(target, arguments);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }

    private ConfigurableApplicationContext context(
            Class<?> source, WebApplicationType type, Map<String, Object> properties) {
        SpringApplication application = new SpringApplication(source);
        application.setWebApplicationType(type);
        application.setDefaultProperties(merge(Map.ofEntries(
                Map.entry("spring.application.name", "runtime-host"),
                Map.entry("server.port", "0"),
                Map.entry("spring.main.banner-mode", "off"),
                Map.entry("mapinboot.snapshot.directory", tempDirectory.resolve("runtime-" + System.nanoTime()).toString()),
                Map.entry("logging.level.root", "OFF")), properties));
        return application.run();
    }

    private Map<String, Object> merge(Map<String, Object> defaults, Map<String, Object> properties) {
        java.util.LinkedHashMap<String, Object> merged = new java.util.LinkedHashMap<>(defaults);
        merged.putAll(properties);
        return merged;
    }

    private void await(Check check) {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (!check.done() && System.nanoTime() < deadline) {
            Thread.onSpinWait();
        }
        assertTrue(check.done(), "비동기 분석 결과가 제한 시간 안에 생성되어야 함");
    }

    @FunctionalInterface
    private interface Check {
        boolean done();
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    static class RuntimeHost {
        @Bean
        RuntimeController runtimeController() {
            return new RuntimeController();
        }

        @Bean
        SecondaryRuntimeController secondaryRuntimeController() {
            return new SecondaryRuntimeController();
        }

        @Bean
        ServletRegistrationBean<HttpServlet> extraServlet() {
            ServletRegistrationBean<HttpServlet> registration = new ServletRegistrationBean<>(new ExtraServlet(), "/extra/*", "/alternate/*");
            registration.setName("extraServlet");
            return registration;
        }

        @Bean
        FilterRegistrationBean<SharedFilter> firstFilter() {
            FilterRegistrationBean<SharedFilter> registration = new FilterRegistrationBean<>(new SharedFilter());
            registration.setName("firstFilter");
            registration.addUrlPatterns("/runtime/*");
            return registration;
        }

        @Bean
        FilterRegistrationBean<SharedFilter> secondFilter() {
            FilterRegistrationBean<SharedFilter> registration = new FilterRegistrationBean<>(new SharedFilter());
            registration.setName("secondFilter");
            registration.addServletNames("dispatcherServlet");
            return registration;
        }

        @Bean
        FilterRegistrationBean<SharedFilter> springSecurityFilterChain() {
            FilterRegistrationBean<SharedFilter> registration = new FilterRegistrationBean<>(new SharedFilter());
            registration.setName("springSecurityFilterChain");
            registration.addUrlPatterns("/*");
            return registration;
        }

        @Bean
        CountingCollector countingCollector() {
            return new CountingCollector();
        }

        @Bean
        @ConditionalOnProperty(prefix = "test", name = "analyzer", havingValue = "true", matchIfMissing = true)
        CountingAnalyzer countingAnalyzer() {
            return new CountingAnalyzer();
        }
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    static class NonWebHost {
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    static class ServletOnlyHost {
    }

    @RestController
    @RequestMapping("/runtime")
    static class RuntimeController {
        @GetMapping({"/first", "/second"})
        String multiplePaths() {
            return "ok";
        }

        @RequestMapping(path = "/multi", method = {org.springframework.web.bind.annotation.RequestMethod.GET,
                org.springframework.web.bind.annotation.RequestMethod.POST})
        String multipleMethods() {
            return "ok";
        }

        @GetMapping(value = "/condition", params = "mode=first")
        String firstCondition(@RequestParam String mode) {
            return mode;
        }

        @GetMapping(value = "/condition", params = "mode=second")
        String secondCondition(@RequestParam String mode) {
            return mode;
        }

        @RequestMapping("/any")
        String anyMethod() {
            return "ok";
        }
    }

    @RestController
    @RequestMapping("/secondary")
    static class SecondaryRuntimeController {
        @GetMapping
        String secondary() {
            return "ok";
        }
    }

    static class ExtraServlet extends HttpServlet {
    }

    static class SharedFilter implements Filter {
        @Override
        public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
                throws IOException, ServletException {
            chain.doFilter(request, response);
        }
    }

    static class CountingCollector extends AbstractCollectorAdapter {
        private final AtomicInteger calls = new AtomicInteger();

        CountingCollector() {
            super("counting-collector", "실행 횟수 확인용 수집기", java.util.Set.of());
        }

        @Override
        public CollectionResult collect(CollectionContext context) {
            calls.incrementAndGet();
            return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.READY, List.of());
        }

        int calls() {
            return calls.get();
        }
    }

    static class CountingAnalyzer extends AbstractAnalysisAdapter {
        private final AtomicInteger calls = new AtomicInteger();

        CountingAnalyzer() {
            super("counting-analyzer", "실행 횟수 확인용 분석기", java.util.Set.of());
        }

        @Override
        public java.util.Set<String> requiredFactTypes() {
            return java.util.Set.of();
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            calls.incrementAndGet();
            return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.READY, List.of());
        }

        int calls() {
            return calls.get();
        }
    }

    static class EndpointRequiredAnalyzer extends AbstractAnalysisAdapter {
        private final AtomicInteger calls = new AtomicInteger();

        EndpointRequiredAnalyzer() {
            super("endpoint-required-analyzer", "Endpoint 입력 분석기", java.util.Set.of());
        }

        @Override
        public java.util.Set<String> requiredFactTypes() {
            return java.util.Set.of("ENDPOINT_MAPPING");
        }

        @Override
        public AnalysisResult analyze(AnalysisContext context) {
            calls.incrementAndGet();
            return new AnalysisResult(id(), List.of(), List.of(), AnalysisStatus.READY, List.of());
        }

        int calls() {
            return calls.get();
        }
    }

    static class FailingHandlerMapping extends RequestMappingHandlerMapping {
        @Override
        public Map<RequestMappingInfo, HandlerMethod> getHandlerMethods() {
            throw new IllegalStateException("HandlerMapping 메타데이터 조회 실패");
        }
    }
}
