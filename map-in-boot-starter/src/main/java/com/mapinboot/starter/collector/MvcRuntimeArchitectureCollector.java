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
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.handler.MappedInterceptor;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.http.converter.HttpMessageConverter;

// DispatcherServlet에 실제 연결된 MVC 등록·Handler 구성 수집
public class MvcRuntimeArchitectureCollector implements RuntimeArchitectureCollector {
    private final ApplicationContext applicationContext;
    private final StableIdGenerator graphIdGenerator = new StableIdGenerator();

    public MvcRuntimeArchitectureCollector(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public String id() { return "starter-mvc-architecture"; }

    @Override
    public RuntimeArchitectureContribution collect(String serviceId, CollectionReport collectionReport) {
        String contextId = contextScope(applicationContext);
        List<RuntimeComponent> components = new ArrayList<>();
        List<RuntimeRelationship> relationships = new ArrayList<>();
        List<RuntimeCoverage> coverage = new ArrayList<>();
        List<RuntimeEvidence> evidence = new ArrayList<>();
        List<Fact> facts = collectionReport == null ? List.of() : collectionReport.facts();
        List<Map.Entry<String, RequestMappingHandlerMapping>> mappings = singletonBeans(RequestMappingHandlerMapping.class);
        List<Map.Entry<String, RequestMappingHandlerAdapter>> adapters = singletonBeans(RequestMappingHandlerAdapter.class);
        List<Map.Entry<String, MappedInterceptor>> interceptors = singletonBeans(MappedInterceptor.class);
        boolean partial = false;

        for (Map.Entry<String, RequestMappingHandlerMapping> entry : mappings) {
            try {
                RequestMappingHandlerMapping mapping = entry.getValue();
                String beanName = beanName(entry.getKey());
                String applicationId = applicationContextId(serviceId, contextId);
                String mappingId = componentId(serviceId, contextId, "HANDLER_MAPPING", entry.getKey(), mapping.getClass().getName());
                addEvidence(evidence, mappingId, beanName, "실제 HandlerMapping Bean 구성");
                Map<String, String> attributes = Map.of("registeredHandlerCount", Integer.toString(mapping.getHandlerMethods().size()));
                components.add(new RuntimeComponent(mappingId, "HANDLER_MAPPING", mapping.getClass().getName(),
                        beanName, contextId, applicationId, attributes, List.of(), List.of(mappingId)));
                relationships.add(relationship(serviceId, contextId, applicationId, mappingId, "CONTAINS"));
                List<Map.Entry<RequestMappingInfo, HandlerMethod>> methods = new ArrayList<>(mapping.getHandlerMethods().entrySet());
                methods.sort(Comparator.comparing(item -> item.getKey().toString() + "|" + handlerKey(item.getValue())));
                for (Map.Entry<RequestMappingInfo, HandlerMethod> item : methods) {
                    String handler = handlerKey(item.getValue());
                    List<String> graphNodeIds = facts.stream()
                            .filter(fact -> "ENDPOINT_MAPPING".equals(fact.type())
                                    && beanName.equals(fact.attributes().get("handlerMapping"))
                                    && handler.equals(fact.attributes().get("handler")))
                            .map(fact -> graphIdGenerator.generate(serviceId, NodeType.ENDPOINT, fact.subjectKey()))
                            .sorted().toList();
                    String methodId = componentId(serviceId, contextId, "HANDLER_METHOD", entry.getKey(),
                            item.getKey().toString() + "|" + handler);
                    Map<String, String> methodAttributes = new TreeMap<>();
                    methodAttributes.put("mapping", item.getKey().toString());
                    methodAttributes.put("handler", handler);
                    addEvidence(evidence, methodId, beanName, "실제 HandlerMethod 등록");
                    components.add(new RuntimeComponent(methodId, "HANDLER_METHOD",
                            item.getValue().getMethod().getDeclaringClass().getName(), entry.getKey(),
                            contextId, mappingId, methodAttributes, graphNodeIds, List.of(methodId)));
                    relationships.add(relationship(serviceId, contextId, mappingId, methodId, "REGISTERS"));
                }
            } catch (RuntimeException exception) {
                partial = true;
            }
        }

        for (Map.Entry<String, RequestMappingHandlerAdapter> entry : adapters) {
            try {
                RequestMappingHandlerAdapter adapter = entry.getValue();
                String beanName = beanName(entry.getKey());
                String applicationId = applicationContextId(serviceId, contextId);
                String adapterId = componentId(serviceId, contextId, "HANDLER_ADAPTER", entry.getKey(), adapter.getClass().getName());
                addEvidence(evidence, adapterId, beanName, "실제 HandlerAdapter Bean 구성");
                components.add(new RuntimeComponent(adapterId, "HANDLER_ADAPTER", adapter.getClass().getName(),
                        beanName, contextId, applicationId, Map.of(), List.of(), List.of(adapterId)));
                relationships.add(relationship(serviceId, contextId, applicationId, adapterId, "CONTAINS"));
                List<HandlerMethodArgumentResolver> resolvers = adapter.getArgumentResolvers() == null
                        ? List.of() : adapter.getArgumentResolvers();
                for (int index = 0; index < resolvers.size(); index++) {
                    HandlerMethodArgumentResolver resolver = resolvers.get(index);
                    String resolverClass = resolver.getClass().getName();
                    String resolverId = componentId(serviceId, contextId, "ARGUMENT_RESOLVER", entry.getKey(),
                            index + "|" + resolverClass);
                    addEvidence(evidence, resolverId, entry.getKey(), "실제 ArgumentResolver 등록 순서");
                    components.add(new RuntimeComponent(resolverId, "ARGUMENT_RESOLVER", resolverClass, null,
                            contextId, adapterId, Map.of("registrationOrder", Integer.toString(index + 1)),
                            List.of(), List.of(resolverId)));
                    relationships.add(relationship(serviceId, contextId, adapterId, resolverId, "CONFIGURES"));
                }
                List<HttpMessageConverter<?>> converters = adapter.getMessageConverters();
                for (int index = 0; index < converters.size(); index++) {
                    HttpMessageConverter<?> converter = converters.get(index);
                    String converterClass = converter.getClass().getName();
                    String converterId = componentId(serviceId, contextId, "MESSAGE_CONVERTER", entry.getKey(),
                            index + "|" + converterClass);
                    addEvidence(evidence, converterId, entry.getKey(), "실제 MessageConverter 등록 순서");
                    components.add(new RuntimeComponent(converterId, "MESSAGE_CONVERTER", converterClass, null,
                            contextId, adapterId, Map.of("registrationOrder", Integer.toString(index + 1)),
                            List.of(), List.of(converterId)));
                    relationships.add(relationship(serviceId, contextId, adapterId, converterId, "CONFIGURES"));
                }
            } catch (RuntimeException exception) {
                partial = true;
            }
        }

        for (Map.Entry<String, MappedInterceptor> entry : interceptors) {
            try {
                MappedInterceptor interceptor = entry.getValue();
                String beanName = beanName(entry.getKey());
                String applicationId = applicationContextId(serviceId, contextId);
                Object interceptorObject = interceptor.getInterceptor();
                String interceptorClass = interceptorObject == null ? "UNKNOWN" : interceptorObject.getClass().getName();
                String interceptorId = componentId(serviceId, contextId, "MVC_INTERCEPTOR", entry.getKey(), interceptorClass);
                Map<String, String> attributes = new TreeMap<>();
                String[] patterns = interceptor.getIncludePathPatterns();
                if (patterns != null && patterns.length > 0) {
                    attributes.put("pathPatterns", java.util.Arrays.stream(patterns).sorted()
                            .collect(java.util.stream.Collectors.joining(",")));
                }
                String[] excludedPatterns = interceptor.getExcludePathPatterns();
                if (excludedPatterns != null && excludedPatterns.length > 0) {
                    attributes.put("excludedPathPatterns", java.util.Arrays.stream(excludedPatterns).sorted()
                            .collect(java.util.stream.Collectors.joining(",")));
                }
                addEvidence(evidence, interceptorId, beanName, "실제 MappedInterceptor 등록");
                components.add(new RuntimeComponent(interceptorId, "MVC_INTERCEPTOR", interceptorClass,
                        beanName, contextId, applicationId, attributes, List.of(), List.of(interceptorId)));
                relationships.add(relationship(serviceId, contextId, applicationId, interceptorId, "CONTAINS"));
            } catch (RuntimeException exception) {
                partial = true;
            }
        }

        CoverageState state = mappings.isEmpty() && adapters.isEmpty()
                ? CoverageState.ABSENT : partial ? CoverageState.PARTIAL : CoverageState.PRESENT;
        coverage.add(new RuntimeCoverage(id(), "MVC", contextId, state,
                state == CoverageState.ABSENT ? "MVC_CONFIGURATION_ABSENT"
                        : state == CoverageState.PARTIAL ? "MVC_CONFIGURATION_PARTIAL" : "MVC_CONFIGURATION_OBSERVED",
                List.of()));
        return new RuntimeArchitectureContribution(null, components, relationships, coverage, evidence);
    }

    private <T> List<Map.Entry<String, T>> singletonBeans(Class<T> type) {
        Map<String, T> result = new TreeMap<>();
        ApplicationContext current = applicationContext;
        while (current != null) {
            if (current instanceof ConfigurableApplicationContext configurable) {
                ConfigurableListableBeanFactory beanFactory = configurable.getBeanFactory();
                for (String name : beanFactory.getBeanNamesForType(type, false, false)) {
                    if (!beanFactory.containsSingleton(name)) continue;
                    Object bean = beanFactory.getSingleton(name);
                    if (type.isInstance(bean)) result.put(contextScope(current) + ":" + name, type.cast(bean));
                }
            }
            current = current.getParent();
        }
        return List.copyOf(result.entrySet());
    }

    private String handlerKey(HandlerMethod handlerMethod) {
        if (handlerMethod == null || handlerMethod.getBeanType() == null || handlerMethod.getMethod() == null) return "UNKNOWN";
        Method method = handlerMethod.getMethod();
        String parameters = java.util.Arrays.stream(method.getParameterTypes())
                .map(Class::getName).collect(java.util.stream.Collectors.joining(","));
        return handlerMethod.getBeanType().getName() + "#" + method.getName() + "(" + parameters + ")";
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

    private RuntimeRelationship relationship(String serviceId, String contextId, String sourceId,
                                             String targetId, String kind) {
        String id = RuntimeArchitectureAssembler.stableId(serviceId, "RELATIONSHIP", contextId, kind,
                sourceId + "|" + targetId);
        return new RuntimeRelationship(id, sourceId, targetId, kind, RuntimeArchitecture.Confidence.CONFIRMED,
                Map.of(), List.of());
    }

    private String componentId(String serviceId, String contextId, String kind, String owner, String structure) {
        return RuntimeArchitectureAssembler.stableId(serviceId, kind, contextId, owner, structure);
    }

    private String applicationContextId(String serviceId, String contextId) {
        String contextClass = applicationContext.getClass().getName();
        return RuntimeArchitectureAssembler.stableId(serviceId, "APPLICATION_CONTEXT", contextId, contextClass, contextClass);
    }

    private String beanName(String qualifiedName) {
        int separator = qualifiedName.lastIndexOf(':');
        return separator < 0 ? qualifiedName : qualifiedName.substring(separator + 1);
    }

    private void addEvidence(List<RuntimeEvidence> evidence, String id, String location, String summary) {
        evidence.add(new RuntimeEvidence(id, "RUNTIME", location, summary));
    }
}
