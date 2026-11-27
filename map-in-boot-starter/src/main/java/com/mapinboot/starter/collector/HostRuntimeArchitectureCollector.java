package com.mapinboot.starter.collector;

import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.CoverageState;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.DeploymentMode;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeComponent;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeCoverage;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEnvironment;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEvidence;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.WebApplicationType;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureCollector;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureContribution;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.core.SpringVersion;

// 실제 ApplicationContext와 기동 완료 WebServer 구성 수집
public class HostRuntimeArchitectureCollector implements RuntimeArchitectureCollector {
    private final ApplicationContext applicationContext;

    public HostRuntimeArchitectureCollector(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public String id() { return "starter-host-architecture"; }

    @Override
    public RuntimeArchitectureContribution collect(String serviceId, CollectionReport collectionReport) {
        String contextId = contextScope(applicationContext);
        String contextClass = applicationContext.getClass().getName();
        String applicationId = componentId(serviceId, contextId, "APPLICATION_CONTEXT", contextClass, contextClass);
        List<RuntimeComponent> components = new ArrayList<>();
        List<RuntimeCoverage> coverage = new ArrayList<>();
        List<RuntimeEvidence> evidence = new ArrayList<>();
        addEvidence(evidence, applicationId, contextClass, "실제 ApplicationContext 유형");
        components.add(new RuntimeComponent(applicationId, "APPLICATION_CONTEXT", contextClass, null,
                contextId, null, Map.of("contextId", contextId), List.of(), List.of(applicationId)));

        WebApplicationType webType = webApplicationType();
        DeploymentMode deploymentMode = switch (webType) {
            case NON_WEB -> DeploymentMode.NOT_APPLICABLE;
            case SERVLET -> DeploymentMode.EXTERNAL;
            case REACTIVE -> DeploymentMode.UNKNOWN;
            case UNKNOWN -> DeploymentMode.UNKNOWN;
        };
        String serverKind = webType == WebApplicationType.NON_WEB ? "NONE" : "UNKNOWN";
        String serverClass = null;
        WebServer webServer = null;
        if (applicationContext instanceof WebServerApplicationContext webContext) {
            webServer = webContext.getWebServer();
            if (webServer != null) {
                serverClass = webServer.getClass().getName();
                serverKind = serverKind(serverClass);
                deploymentMode = DeploymentMode.EMBEDDED;
                String serverId = componentId(serviceId, contextId, "WEB_SERVER", contextClass, serverClass);
                int activePort = webServer.getPort();
                Map<String, String> attributes = activePort > 0
                        ? Map.of("serverKind", serverKind, "activePort", Integer.toString(activePort))
                        : Map.of("serverKind", serverKind);
                addEvidence(evidence, serverId, serverClass, "기동 완료된 WebServer 구현");
                components.add(new RuntimeComponent(serverId, "WEB_SERVER", serverClass, null,
                        contextId, applicationId, attributes, List.of(), List.of(serverId)));
            }
        }
        Map<String, String> versions = new TreeMap<>();
        addVersion(versions, "springBoot", SpringBootVersion.getVersion());
        addVersion(versions, "springFramework", SpringVersion.getVersion());
        RuntimeEnvironment environment = new RuntimeEnvironment(
                webType, serverKind, serverClass, deploymentMode, versions);

        coverage.add(new RuntimeCoverage(id(), "APPLICATION", contextId, CoverageState.PRESENT,
                "APPLICATION_CONTEXT_OBSERVED", List.of(applicationId)));
        coverage.add(new RuntimeCoverage(id(), "WEB_SERVER", contextId,
                webServer != null ? CoverageState.PRESENT
                        : webType == WebApplicationType.NON_WEB ? CoverageState.NOT_SUPPORTED
                        : webType == WebApplicationType.SERVLET ? CoverageState.NOT_SUPPORTED : CoverageState.UNKNOWN,
                webServer != null ? "EMBEDDED_SERVER_OBSERVED"
                        : webType == WebApplicationType.SERVLET ? "EXTERNAL_CONTAINER_OR_UNCONFIRMED" : "SERVER_UNCONFIRMED",
                webServer == null ? List.of(applicationId)
                        : List.of(componentId(serviceId, contextId, "WEB_SERVER", contextClass, serverClass))));
        CoverageState servletState = webType == WebApplicationType.SERVLET
                ? CoverageState.UNKNOWN : webType == WebApplicationType.UNKNOWN
                ? CoverageState.UNKNOWN : CoverageState.NOT_SUPPORTED;
        coverage.add(new RuntimeCoverage(id(), "SERVLET", contextId, servletState,
                servletState == CoverageState.UNKNOWN ? "SERVLET_COLLECTOR_PENDING" : "NON_SERVLET_APPLICATION",
                List.of(applicationId)));
        coverage.add(classCoverage(contextId, applicationId, "MVC",
                "org.springframework.web.servlet.DispatcherServlet", webType));
        coverage.add(classCoverage(contextId, applicationId, "SECURITY",
                "org.springframework.security.web.FilterChainProxy", webType));
        return new RuntimeArchitectureContribution(environment, components, List.of(), coverage, evidence);
    }

    private RuntimeCoverage classCoverage(String contextId, String applicationId, String area,
                                          String className, WebApplicationType webType) {
        if (webType == WebApplicationType.NON_WEB) {
            return new RuntimeCoverage(id(), area, contextId, CoverageState.NOT_SUPPORTED,
                    "NON_WEB_APPLICATION", List.of(applicationId));
        }
        if (webType == WebApplicationType.REACTIVE && "MVC".equals(area)) {
            return new RuntimeCoverage(id(), area, contextId, CoverageState.NOT_SUPPORTED,
                    "REACTIVE_APPLICATION", List.of(applicationId));
        }
        try {
            Class.forName(className, false, applicationContext.getClassLoader());
            return new RuntimeCoverage(id(), area, contextId, CoverageState.UNKNOWN,
                    "FRAMEWORK_PRESENT_AWAITING_COLLECTOR", List.of(applicationId));
        } catch (ClassNotFoundException | LinkageError exception) {
            return new RuntimeCoverage(id(), area, contextId, CoverageState.ABSENT,
                    "FRAMEWORK_CLASS_ABSENT", List.of(applicationId));
        }
    }

    private WebApplicationType webApplicationType() {
        if (applicationContext instanceof WebServerApplicationContext) {
            String className = applicationContext.getClass().getName();
            if (className.contains("Servlet")) return WebApplicationType.SERVLET;
            if (className.contains("Reactive")) return WebApplicationType.REACTIVE;
            return WebApplicationType.UNKNOWN;
        }
        if (implementsType(applicationContext.getClass(), "org.springframework.web.context.WebApplicationContext")) {
            return WebApplicationType.SERVLET;
        }
        if (implementsType(applicationContext.getClass(), "org.springframework.web.reactive.result.method.RequestMappingInfoHandlerMapping")) {
            return WebApplicationType.REACTIVE;
        }
        return WebApplicationType.NON_WEB;
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
        if (context instanceof org.springframework.web.context.WebApplicationContext webContext
                && webContext.getServletContext() != null) {
            try { path = webContext.getServletContext().getContextPath(); }
            catch (RuntimeException exception) { path = "UNKNOWN"; }
        }
        return RuntimeArchitectureAssembler.stableContextId(context.getId(), context.getClass().getName(),
                String.join(">", hierarchy) + "|" + path);
    }

    private boolean implementsType(Class<?> type, String targetName) {
        if (type == null) return false;
        if (targetName.equals(type.getName())) return true;
        for (Class<?> contract : type.getInterfaces()) if (implementsType(contract, targetName)) return true;
        return implementsType(type.getSuperclass(), targetName);
    }

    private String componentId(String serviceId, String contextId, String kind, String owner, String structure) {
        return RuntimeArchitectureAssembler.stableId(serviceId, kind, contextId, owner, structure);
    }

    private void addEvidence(List<RuntimeEvidence> evidence, String id, String location, String summary) {
        evidence.add(new RuntimeEvidence(id, "RUNTIME", location, summary));
    }

    private void addVersion(Map<String, String> versions, String key, String version) {
        if (version != null && !version.isBlank()) versions.put(key, version);
    }

    private String serverKind(String className) {
        String lower = className.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("tomcat")) return "TOMCAT";
        if (lower.contains("jetty")) return "JETTY";
        if (lower.contains("undertow")) return "UNDERTOW";
        return className.substring(className.lastIndexOf('.') + 1);
    }
}
