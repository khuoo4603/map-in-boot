package com.mapinboot.starter.collector;

import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.StableIdGenerator;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.CoverageState;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeComponent;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeCoverage;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEvidence;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeRelationship;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureCollector;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureContribution;
import java.lang.reflect.Array;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletRegistration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.web.context.WebApplicationContext;

// 실제 ServletContext와 등록된 Servlet·Filter 구성 수집
public class ServletRuntimeArchitectureCollector implements RuntimeArchitectureCollector {
    private static final String DISPATCHER_SERVLET = "org.springframework.web.servlet.DispatcherServlet";
    private final ApplicationContext applicationContext;
    private final StableIdGenerator graphIdGenerator = new StableIdGenerator();

    public ServletRuntimeArchitectureCollector(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public String id() { return "starter-servlet-architecture"; }

    @Override
    public RuntimeArchitectureContribution collect(String serviceId, CollectionReport collectionReport) {
        String contextId = contextScope(applicationContext);
        List<RuntimeComponent> components = new ArrayList<>();
        List<RuntimeRelationship> relationships = new ArrayList<>();
        List<RuntimeCoverage> coverage = new ArrayList<>();
        List<RuntimeEvidence> evidence = new ArrayList<>();
        List<Fact> facts = collectionReport == null ? List.of() : collectionReport.facts();
        ServletContext servletContext = servletContext();
        if (servletContext == null) {
            coverage.add(new RuntimeCoverage(id(), "SERVLET", contextId, CoverageState.UNKNOWN,
                    "SERVLET_CONTEXT_UNAVAILABLE", List.of()));
            return new RuntimeArchitectureContribution(null, components, relationships, coverage, evidence);
        }

        String rootId = applicationContextId(serviceId, contextId);
        String className = servletContext.getClass().getName();
        String contextPath;
        String serverInfo;
        try {
            contextPath = servletContext.getContextPath();
            serverInfo = servletContext.getServerInfo();
        } catch (RuntimeException exception) {
            coverage.add(new RuntimeCoverage(id(), "SERVLET", contextId, CoverageState.PARTIAL,
                    "SERVLET_CONTEXT_READ_FAILED", List.of()));
            return new RuntimeArchitectureContribution(null, components, relationships, coverage, evidence);
        }
        String serverId = serverId(serviceId, contextId);
        TomcatCollection tomcat = collectTomcat(serviceId, contextId, servletContext, serverId,
                components, relationships, evidence);
        String containerId = componentId(serviceId, contextId, "SERVLET_CONTEXT", contextPath, className);
        Map<String, String> contextAttributes = new TreeMap<>();
        contextAttributes.put("contextPath", value(contextPath));
        contextAttributes.put("serverInfo", value(serverInfo));
        addEvidence(evidence, containerId, className, "실제 ServletContext");
        components.add(new RuntimeComponent(containerId, "SERVLET_CONTEXT", className, null,
                contextId, tomcat.servletContextParentId() == null
                ? serverId == null ? rootId : serverId : tomcat.servletContextParentId(),
                contextAttributes, List.of(), List.of(containerId)));
        relationships.add(relationship(serviceId, contextId, tomcat.servletContextParentId() == null
                        ? serverId == null ? rootId : serverId : tomcat.servletContextParentId(),
                containerId, "CONTAINS"));

        boolean partial = collectServletRegistrations(serviceId, contextId, containerId, servletContext,
                facts, components, relationships, evidence);
        partial |= collectFilterRegistrations(serviceId, contextId, containerId, servletContext,
                facts, components, relationships, evidence);
        coverage.add(new RuntimeCoverage(id(), "SERVLET", contextId,
                partial || tomcat.partial() ? CoverageState.PARTIAL : CoverageState.PRESENT,
                partial ? "REGISTRATION_READ_PARTIAL" : tomcat.partial() ? "TOMCAT_STRUCTURE_PARTIAL"
                        : "SERVLET_CONTEXT_OBSERVED", List.of(containerId)));
        return new RuntimeArchitectureContribution(null, components, relationships, coverage, evidence);
    }

    private boolean collectServletRegistrations(String serviceId, String contextId, String containerId,
                                                ServletContext servletContext, List<Fact> facts,
                                                List<RuntimeComponent> components,
                                                List<RuntimeRelationship> relationships,
                                                List<RuntimeEvidence> evidence) {
        Map<String, ? extends ServletRegistration> registrations;
        try { registrations = new TreeMap<>(servletContext.getServletRegistrations()); }
        catch (RuntimeException exception) { return true; }
        boolean partial = false;
        for (Map.Entry<String, ? extends ServletRegistration> entry : registrations.entrySet()) {
            try {
                String name = entry.getKey();
                ServletRegistration registration = entry.getValue();
                List<String> mappings = registration.getMappings().stream().sorted().toList();
                String servletClass = registration.getClassName();
                String kind = DISPATCHER_SERVLET.equals(servletClass) ? "DISPATCHER_SERVLET" : "SERVLET_REGISTRATION";
                String id = componentId(serviceId, contextId, kind, name, String.join("|", mappings) + "|" + servletClass);
                List<String> graphNodeIds = facts.stream()
                        .filter(fact -> "SERVLET_REGISTRATION".equals(fact.type())
                                && name.equals(fact.attributes().get("servletName")))
                        .map(fact -> graphIdGenerator.generate(serviceId, NodeType.SERVLET, fact.subjectKey()))
                        .sorted().toList();
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("registrationName", name);
                attributes.put("urlPatterns", String.join(",", mappings));
                if (servletClass != null && !servletClass.isBlank()) attributes.put("servletClass", servletClass);
                addEvidence(evidence, id, "servlet:" + name, "실제 Servlet 등록");
                components.add(new RuntimeComponent(id, kind, servletClass, name, contextId, containerId,
                        attributes, graphNodeIds, List.of(id)));
                relationships.add(relationship(serviceId, contextId, containerId, id, "REGISTERED_IN"));
            } catch (RuntimeException exception) { partial = true; }
        }
        return partial;
    }

    private boolean collectFilterRegistrations(String serviceId, String contextId, String containerId,
                                               ServletContext servletContext, List<Fact> facts,
                                               List<RuntimeComponent> components,
                                               List<RuntimeRelationship> relationships,
                                               List<RuntimeEvidence> evidence) {
        Map<String, ? extends FilterRegistration> registrations;
        try { registrations = new TreeMap<>(servletContext.getFilterRegistrations()); }
        catch (RuntimeException exception) { return true; }
        boolean partial = false;
        for (Map.Entry<String, ? extends FilterRegistration> entry : registrations.entrySet()) {
            try {
                String name = entry.getKey();
                FilterRegistration registration = entry.getValue();
                String filterClass = registration.getClassName();
                String id = componentId(serviceId, contextId, "SERVLET_FILTER_REGISTRATION", name, filterClass);
                List<String> graphNodeIds = facts.stream()
                        .filter(fact -> "FILTER_REGISTRATION".equals(fact.type())
                                && "SERVLET".equals(fact.attributes().get("registrationKind"))
                                && name.equals(fact.attributes().get("registrationName")))
                        .map(fact -> graphIdGenerator.generate(serviceId, NodeType.FILTER, fact.subjectKey()))
                        .sorted().toList();
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("registrationName", name);
                attributes.put("filterClass", value(filterClass));
                attributes.put("urlPatterns", join(registration.getUrlPatternMappings()));
                attributes.put("servletNames", join(registration.getServletNameMappings()));
                addEvidence(evidence, id, "filter:" + name, "실제 Servlet Filter 등록");
                components.add(new RuntimeComponent(id, "SERVLET_FILTER_REGISTRATION", filterClass, name,
                        contextId, containerId, attributes, graphNodeIds, List.of(id)));
                relationships.add(relationship(serviceId, contextId, containerId, id, "REGISTERED_IN"));
            } catch (RuntimeException exception) { partial = true; }
        }
        return partial;
    }

    private ServletContext servletContext() {
        try {
            if (applicationContext instanceof WebApplicationContext webContext) return webContext.getServletContext();
        } catch (RuntimeException ignored) {
            // ApplicationReady 시점의 미가용 ServletContext는 미확인 상태로 유지
        }
        return null;
    }

    private String contextScope(ApplicationContext context) {
        List<String> hierarchy = new ArrayList<>();
        ApplicationContext current = context;
        while (current != null) {
            hierarchy.add(current.getClass().getName());
            current = current.getParent();
        }
        java.util.Collections.reverse(hierarchy);
        String path = "";
        if (context instanceof WebApplicationContext webContext && webContext.getServletContext() != null) {
            try { path = webContext.getServletContext().getContextPath(); }
            catch (RuntimeException exception) { path = "UNKNOWN"; }
        }
        return RuntimeArchitectureAssembler.stableContextId(context.getId(), context.getClass().getName(),
                String.join(">", hierarchy) + "|" + path);
    }

    private String applicationContextId(String serviceId, String contextId) {
        String applicationClass = applicationContext.getClass().getName();
        return RuntimeArchitectureAssembler.stableId(serviceId, "APPLICATION_CONTEXT", contextId,
                applicationClass, applicationClass);
    }

    private String serverId(String serviceId, String contextId) {
        if (!(applicationContext instanceof WebServerApplicationContext webContext)) return null;
        WebServer server = webContext.getWebServer();
        return server == null ? null : componentId(serviceId, contextId, "WEB_SERVER",
                applicationContext.getClass().getName(), server.getClass().getName());
    }

    // 기동 완료 Tomcat의 공개 Container API를 통해 실제 배포 객체 트리와 Servlet 연결 수집
    private TomcatCollection collectTomcat(String serviceId, String contextId, ServletContext servletContext,
                                          String webServerId, List<RuntimeComponent> components,
                                          List<RuntimeRelationship> relationships, List<RuntimeEvidence> evidence) {
        if (!(applicationContext instanceof WebServerApplicationContext webContext)
                || webContext.getWebServer() == null
                || !webContext.getWebServer().getClass().getName().contains("TomcatWebServer")) {
            return TomcatCollection.notApplicable();
        }
        boolean partial = false;
        String matchedContextId = null;
        try {
            Object tomcat = invoke(webContext.getWebServer(), "getTomcat");
            Object server = invoke(tomcat, "getServer");
            String serverClass = server.getClass().getName();
            String serverId = addTomcatComponent(serviceId, contextId, "TOMCAT_SERVER", "server", serverClass,
                    Map.of(), webServerId, components, evidence);
            relationships.add(relationship(serviceId, contextId, webServerId, serverId, "CONTAINS"));

            Object[] services = array(invoke(server, "findServices"));
            for (int serviceIndex = 0; serviceIndex < services.length; serviceIndex++) {
                Object service = services[serviceIndex];
                String serviceName = text(invoke(service, "getName"), "service-" + serviceIndex);
                String tomcatServiceId = addTomcatComponent(serviceId, contextId, "TOMCAT_SERVICE", serviceName,
                        service.getClass().getName(), Map.of("serviceName", serviceName), serverId,
                        components, evidence);
                relationships.add(relationship(serviceId, contextId, serverId, tomcatServiceId, "CONTAINS"));

                Object[] connectors = array(invoke(service, "findConnectors"));
                for (int connectorIndex = 0; connectorIndex < connectors.length; connectorIndex++) {
                    Object connector = connectors[connectorIndex];
                    String protocol = text(invoke(connector, "getProtocol"), "UNKNOWN");
                    String port = text(invoke(connector, "getPort"), "-1");
                    Object handler = invoke(connector, "getProtocolHandler");
                    Map<String, String> attributes = new TreeMap<>();
                    attributes.put("protocol", protocol);
                    attributes.put("configuredPort", port);
                    if (handler != null) attributes.put("protocolHandlerClass", handler.getClass().getName());
                    String connectorId = addTomcatComponent(serviceId, contextId, "TOMCAT_CONNECTOR",
                            serviceName + "-" + connectorIndex, connector.getClass().getName(), attributes,
                            tomcatServiceId, components, evidence);
                    relationships.add(relationship(serviceId, contextId, tomcatServiceId, connectorId, "CONTAINS"));
                }

                Object engine = invoke(service, "getContainer");
                if (engine == null) { partial = true; continue; }
                String engineName = text(invoke(engine, "getName"), "engine-" + serviceIndex);
                String engineId = addTomcatComponent(serviceId, contextId, "TOMCAT_ENGINE", engineName,
                        engine.getClass().getName(), Map.of("engineName", engineName), tomcatServiceId,
                        components, evidence);
                relationships.add(relationship(serviceId, contextId, tomcatServiceId, engineId, "CONTAINS"));
                Object[] hosts = array(invoke(engine, "findChildren"));
                for (int hostIndex = 0; hostIndex < hosts.length; hostIndex++) {
                    Object host = hosts[hostIndex];
                    String hostName = text(invoke(host, "getName"), "host-" + hostIndex);
                    String hostId = addTomcatComponent(serviceId, contextId, "TOMCAT_HOST", hostName,
                            host.getClass().getName(), Map.of("hostName", hostName), engineId, components, evidence);
                    relationships.add(relationship(serviceId, contextId, engineId, hostId, "CONTAINS"));
                    Object[] contexts = array(invoke(host, "findChildren"));
                    for (int appIndex = 0; appIndex < contexts.length; appIndex++) {
                        Object tomcatContext = contexts[appIndex];
                        Object deployedServletContext = invoke(tomcatContext, "getServletContext");
                        if (deployedServletContext != servletContext) continue;
                        String path = text(invoke(tomcatContext, "getPath"), "");
                        String name = text(invoke(tomcatContext, "getName"), path);
                        String tomcatContextId = addTomcatComponent(serviceId, contextId, "TOMCAT_CONTEXT", name,
                                tomcatContext.getClass().getName(), Map.of("contextPath", path), hostId,
                                components, evidence);
                        matchedContextId = tomcatContextId;
                        relationships.add(relationship(serviceId, contextId, hostId, tomcatContextId, "CONTAINS"));

                        Object[] wrappers = array(invoke(tomcatContext, "findChildren"));
                        for (int wrapperIndex = 0; wrapperIndex < wrappers.length; wrapperIndex++) {
                            Object wrapper = wrappers[wrapperIndex];
                            String wrapperName = text(invoke(wrapper, "getName"), "wrapper-" + wrapperIndex);
                            String servletClass = text(invoke(wrapper, "getServletClass"), "UNKNOWN");
                            Object mappingsValue = invoke(wrapper, "findMappings");
                            Map<String, String> wrapperAttributes = new TreeMap<>();
                            wrapperAttributes.put("servletClass", servletClass);
                            wrapperAttributes.put("urlPatterns", String.join(",", strings(mappingsValue)));
                            String wrapperId = addTomcatComponent(serviceId, contextId, "TOMCAT_WRAPPER",
                                    wrapperName, wrapper.getClass().getName(), wrapperAttributes, tomcatContextId,
                                    components, evidence);
                            relationships.add(relationship(serviceId, contextId, tomcatContextId, wrapperId, "CONTAINS"));
                        }
                        partial |= collectTomcatFilterMaps(serviceId, contextId, tomcatContext, tomcatContextId,
                                components, relationships, evidence);
                    }
                }
            }
        } catch (ReflectiveOperationException | RuntimeException exception) {
            partial = true;
        }
        return new TomcatCollection(matchedContextId, partial);
    }

    private boolean collectTomcatFilterMaps(String serviceId, String contextId, Object tomcatContext,
                                            String parentId, List<RuntimeComponent> components,
                                            List<RuntimeRelationship> relationships, List<RuntimeEvidence> evidence) {
        try {
            Object[] filterMaps = array(invoke(tomcatContext, "findFilterMaps"));
            boolean partial = false;
            for (int index = 0; index < filterMaps.length; index++) {
                Object filterMap = filterMaps[index];
                String filterName = text(invoke(filterMap, "getFilterName"), "UNKNOWN");
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("filterName", filterName);
                attributes.put("urlPatterns", String.join(",", strings(invoke(filterMap, "getURLPatterns"))));
                attributes.put("servletNames", String.join(",", strings(invoke(filterMap, "getServletNames"))));
                attributes.put("dispatcherTypes", String.join(",", strings(invoke(filterMap, "getDispatcherNames"))));
                attributes.put("registrationOrder", Integer.toString(index + 1));
                attributes.put("matchAllUrlPatterns", Boolean.toString(Boolean.TRUE.equals(
                        invoke(filterMap, "getMatchAllUrlPatterns"))));
                attributes.put("matchAllServletNames", Boolean.toString(Boolean.TRUE.equals(
                        invoke(filterMap, "getMatchAllServletNames"))));
                String filterMapId = addTomcatComponent(serviceId, contextId, "TOMCAT_FILTER_MAPPING",
                        index + "|" + filterName, filterMap.getClass().getName(), attributes, parentId,
                        components, evidence);
                relationships.add(relationship(serviceId, contextId, parentId, filterMapId, "REGISTERS"));
            }
            return partial;
        } catch (ReflectiveOperationException | RuntimeException exception) {
            return true;
        }
    }

    private String addTomcatComponent(String serviceId, String contextId, String kind, String owner,
                                      String className, Map<String, String> attributes, String parentId,
                                      List<RuntimeComponent> components, List<RuntimeEvidence> evidence) {
        String id = componentId(serviceId, contextId, kind, owner, className);
        addEvidence(evidence, id, className, "실제 Tomcat 내부 객체");
        components.add(new RuntimeComponent(id, kind, className, null, contextId, parentId,
                attributes, List.of(), List.of(id)));
        return id;
    }

    private Object invoke(Object target, String methodName) throws ReflectiveOperationException {
        if (target == null) throw new NoSuchMethodException(methodName);
        Method method = target.getClass().getMethod(methodName);
        try {
            return method.invoke(target);
        } catch (InvocationTargetException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof RuntimeException runtimeException) throw runtimeException;
            throw new ReflectiveOperationException("Tomcat runtime accessor failed", cause);
        }
    }

    private Object[] array(Object value) {
        if (value == null || !value.getClass().isArray()) return new Object[0];
        int length = Array.getLength(value);
        Object[] items = new Object[length];
        for (int index = 0; index < length; index++) items[index] = Array.get(value, index);
        return items;
    }

    private List<String> strings(Object value) {
        Object[] items = array(value);
        List<String> result = new ArrayList<>(items.length);
        for (Object item : items) if (item != null) result.add(item.toString());
        return result.stream().sorted().toList();
    }

    private String text(Object value, String fallback) {
        if (value == null) return fallback;
        String text = value.toString();
        return text.isBlank() ? fallback : text;
    }

    private RuntimeRelationship relationship(String serviceId, String contextId, String sourceId,
                                             String targetId, String kind) {
        String id = RuntimeArchitectureAssembler.stableId(serviceId, "RELATIONSHIP", contextId, kind,
                sourceId + "|" + targetId);
        return new RuntimeRelationship(id, sourceId, targetId, kind,
                RuntimeArchitecture.Confidence.CONFIRMED, Map.of(), List.of());
    }

    private String componentId(String serviceId, String contextId, String kind, String owner, String structure) {
        return RuntimeArchitectureAssembler.stableId(serviceId, kind, contextId, owner, structure);
    }

    private void addEvidence(List<RuntimeEvidence> evidence, String id, String location, String summary) {
        evidence.add(new RuntimeEvidence(id, "RUNTIME", location, summary));
    }

    private String join(java.util.Collection<String> values) {
        return values == null ? "" : values.stream().filter(value -> value != null && !value.isBlank())
                .sorted().collect(java.util.stream.Collectors.joining(","));
    }

    private String value(String value) { return value == null ? "UNKNOWN" : value; }

    private record TomcatCollection(String servletContextParentId, boolean partial) {
        private static TomcatCollection notApplicable() { return new TomcatCollection(null, false); }
    }
}
