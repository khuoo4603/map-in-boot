package com.mapinboot.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapinboot.core.analysis.AnalysisProvider;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisReport;
import com.mapinboot.core.collection.CollectionProvider;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.GraphBuilder;
import com.mapinboot.core.graph.model.SecurityGraph;
import com.mapinboot.security.analyzer.FilterRegistrationAnalysisAdapter;
import com.mapinboot.security.collector.SecurityChainCollectorAdapter;
import com.mapinboot.starter.collector.ServletFilterCollectorAdapter;
import com.mapinboot.starter.collector.ServletRegistrationCollectorAdapter;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletRegistration;
import jakarta.servlet.http.HttpServlet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import java.lang.reflect.Proxy;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;

class FilterRegistrationAnalysisAdapterTest {

    @Test
    void linksEverySecurityFilterToItsChainAndBuildsGraphEdges() {
        try (AnnotationConfigApplicationContext context = context(
                SecurityChainCollectorAdapterTest.MultipleFilterSecurityConfiguration.class)) {
            SecurityChainCollectorAdapter collector = new SecurityChainCollectorAdapter();
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "main", "instance"), List.of(collector));

            AnalysisReport report = analyze(collection);
            List<com.mapinboot.core.evidence.Relation> relations = report.relations().stream()
                    .filter(relation -> relation.type() == EdgeType.FILTERED_BY)
                    .toList();

            assertEquals(AnalysisStatus.READY, report.statusByAdapter().get(
                    "security-filter-registration-analysis"));
            assertEquals(5, relations.size());
            assertTrue(relations.stream().allMatch(relation ->
                    relation.confidence() == Confidence.CONFIRMED
                            && "SECURITY".equals(relation.attributes().get("registrationKind"))
                            && relation.attributes().containsKey("filterOrder")));
            assertTrue(relations.stream().allMatch(relation -> relation.evidenceIds().stream()
                    .allMatch(id -> report.evidence().stream().anyMatch(evidence -> evidence.id().equals(id)))));

            SecurityGraph graph = new GraphBuilder().build("main", report);
            assertEquals(2, graph.nodes().stream()
                    .filter(node -> node.type().name().equals("SECURITY_CHAIN"))
                    .count());
            assertEquals(5, graph.nodes().stream()
                    .filter(node -> node.type().name().equals("FILTER"))
                    .count());
            assertEquals(5, graph.edges().stream()
                    .filter(edge -> edge.type() == EdgeType.FILTERED_BY)
                    .count());
        }
    }

    @Test
    void connectsExplicitServletNameMappingButDoesNotGuessUrlPatternMapping() {
        Fact servlet = fact("servlet", "SERVLET_REGISTRATION", "servlet|dispatcherServlet|/",
                Map.of("servletName", "dispatcherServlet", "urlPattern", "/"), "e-servlet");
        Fact namedFilter = fact("named-filter", "FILTER_REGISTRATION",
                "filter|named", Map.of(
                        "filterClass", "example.NamedFilter",
                        "registrationKind", "SERVLET",
                        "registrationName", "namedFilter",
                        "servletNames", "dispatcherServlet"), "e-named-filter");
        Fact urlFilter = fact("url-filter", "FILTER_REGISTRATION",
                "filter|url", Map.of(
                        "filterClass", "example.UrlFilter",
                        "registrationKind", "SERVLET",
                        "registrationName", "urlFilter",
                        "urlPatterns", "/api/*"), "e-url-filter");
        CollectionReport collection = new CollectionReport(
                List.of(servlet, namedFilter, urlFilter),
                evidence("e-servlet", "e-named-filter", "e-url-filter"),
                Map.of(
                        "starter-servlet-registration", AnalysisStatus.READY,
                        "starter-servlet-filter", AnalysisStatus.READY),
                List.of());

        AnalysisReport report = analyze(collection);

        assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get(
                "security-filter-registration-analysis"));
        assertEquals(1, report.relations().size());
        assertEquals("servlet|dispatcherServlet|/", report.relations().get(0).sourceKey());
        assertEquals("filter|named", report.relations().get(0).targetKey());
        assertEquals("SERVLET", report.relations().get(0).attributes().get("registrationKind"));
        assertTrue(report.diagnostics().stream().anyMatch(diagnostic ->
                diagnostic.summary().contains("URL")));
    }

    @Test
    void reusesStarterServletFactsForExplicitServletNameMapping() {
        ServletRegistration servletRegistration = registration(
                ServletRegistration.class, "dispatcherServlet", TestServlet.class.getName());
        FilterRegistration filterRegistration = filterRegistration(
                "namedFilter", SecurityChainCollectorAdapterTest.OrderFilter.class.getName());
        MockServletContext servletContext = new MockServletContext() {
            @Override
            public Map<String, ? extends ServletRegistration> getServletRegistrations() {
                return Map.of("dispatcherServlet", servletRegistration);
            }

            @Override
            public Map<String, ? extends FilterRegistration> getFilterRegistrations() {
                return Map.of("namedFilter", filterRegistration);
            }
        };

        AnnotationConfigWebApplicationContext applicationContext = new AnnotationConfigWebApplicationContext();
        applicationContext.setServletContext(servletContext);
        try (applicationContext) {
            CollectionContext collectionContext = new CollectionContext(applicationContext, "main", "instance");
            ServletRegistrationCollectorAdapter servletCollector = new ServletRegistrationCollectorAdapter();
            ServletFilterCollectorAdapter filterCollector = new ServletFilterCollectorAdapter();
            CollectionResult servletResult = servletCollector.collect(collectionContext);
            CollectionResult filterResult = filterCollector.collect(collectionContext);
            List<Fact> facts = new ArrayList<>(servletResult.facts());
            facts.addAll(filterResult.facts());
            List<Evidence> evidence = new ArrayList<>(servletResult.evidence());
            evidence.addAll(filterResult.evidence());
            CollectionReport collection = new CollectionReport(
                    facts,
                    evidence,
                    Map.of(
                            servletCollector.id(), servletResult.status(),
                            filterCollector.id(), filterResult.status()),
                    List.of());

            AnalysisReport report = analyze(collection);

            assertEquals(AnalysisStatus.READY, report.statusByAdapter().get(
                    "security-filter-registration-analysis"));
            assertEquals(1, report.relations().size());
            assertEquals("SERVLET", report.relations().get(0).attributes().get("registrationKind"));
        }
    }

    @Test
    void preservesReadableChainFiltersWhenAnotherChainFilterLookupFails() {
        try (AnnotationConfigApplicationContext context = context(FailingFilterListConfiguration.class)) {
            SecurityChainCollectorAdapter collector = new SecurityChainCollectorAdapter();
            CollectionReport collection = new CollectionProvider().execute(
                    new CollectionContext(context, "main", "instance"), List.of(collector));

            AnalysisReport report = analyze(collection);

            assertEquals(AnalysisStatus.PARTIAL, collection.statusByAdapter().get("security-chain"));
            assertEquals(AnalysisStatus.PARTIAL, report.statusByAdapter().get(
                    "security-filter-registration-analysis"));
            assertEquals(1, report.relations().size());
            assertTrue(!report.diagnostics().isEmpty());
        }
    }

    @Test
    void returnsUnknownWhenSecurityChainCollectionIsUnknown() {
        CollectionReport collection = new CollectionReport(
                List.of(), List.of(), Map.of("security-chain", AnalysisStatus.UNKNOWN), List.of());

        AnalysisReport report = analyze(collection);

        assertEquals(AnalysisStatus.UNKNOWN, report.statusByAdapter().get(
                "security-filter-registration-analysis"));
        assertTrue(report.relations().isEmpty());
    }

    private AnalysisReport analyze(CollectionReport collection) {
        return new AnalysisProvider().execute(
                new AnalysisContext(collection, "main"), List.of(new FilterRegistrationAnalysisAdapter()));
    }

    private AnnotationConfigApplicationContext context(Class<?> configuration) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.register(configuration);
        context.refresh();
        return context;
    }

    private Fact fact(String id, String type, String subjectKey, Map<String, String> attributes,
                      String evidenceId) {
        return new Fact(id, type, subjectKey, attributes, List.of(evidenceId));
    }

    @SuppressWarnings("unchecked")
    private <T> T registration(Class<T> type, String name, String className) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            return switch (method.getName()) {
                case "getName" -> name;
                case "getClassName" -> className;
                case "getMappings" -> java.util.Set.of("/");
                default -> defaultValue(method.getReturnType());
            };
        });
    }

    private FilterRegistration filterRegistration(String name, String className) {
        return (FilterRegistration) Proxy.newProxyInstance(
                FilterRegistration.class.getClassLoader(),
                new Class<?>[]{FilterRegistration.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getName" -> name;
                    case "getClassName" -> className;
                    case "getServletNameMappings" -> java.util.Set.of("dispatcherServlet");
                    case "getUrlPatternMappings" -> java.util.Set.of();
                    default -> defaultValue(method.getReturnType());
                });
    }

    private Object defaultValue(Class<?> type) {
        if (type == boolean.class) {
            return false;
        }
        if (type == int.class) {
            return 0;
        }
        if (type == long.class) {
            return 0L;
        }
        if (type == float.class) {
            return 0F;
        }
        if (type == double.class) {
            return 0D;
        }
        if (type == short.class) {
            return (short) 0;
        }
        if (type == byte.class) {
            return (byte) 0;
        }
        if (type == char.class) {
            return (char) 0;
        }
        return null;
    }

    private List<Evidence> evidence(String... ids) {
        return java.util.Arrays.stream(ids)
                .map(id -> new Evidence(id, EvidenceSource.RUNTIME, "test", "test evidence"))
                .toList();
    }

    @Configuration(proxyBeanMethods = false)
    static class FailingFilterListConfiguration {

        @Bean
        FilterChainProxy springSecurityFilterChain() {
            SecurityFilterChain failing = new SecurityFilterChain() {
                @Override
                public boolean matches(jakarta.servlet.http.HttpServletRequest request) {
                    return false;
                }

                @Override
                public List<jakarta.servlet.Filter> getFilters() {
                    throw new IllegalStateException("filter list unavailable");
                }
            };
            return new FilterChainProxy(List.of(
                    new DefaultSecurityFilterChain(
                            PathPatternRequestMatcher.pathPattern("/ok/**"),
                            List.of(new SecurityChainCollectorAdapterTest.OrderFilter())),
                    failing));
        }
    }

    static class TestServlet extends HttpServlet {
    }
}
