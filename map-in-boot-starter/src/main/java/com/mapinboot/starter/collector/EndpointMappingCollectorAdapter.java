package com.mapinboot.starter.collector;

import com.mapinboot.core.collection.AbstractCollectorAdapter;
import com.mapinboot.core.collection.model.CollectionContext;
import com.mapinboot.core.collection.model.CollectionResult;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.StableIdGenerator;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

// Spring MVC Runtime Endpoint 수집기
public class EndpointMappingCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "ENDPOINT_MAPPING";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public EndpointMappingCollectorAdapter() {
        super("starter-endpoint-mapping", "Spring MVC 등록 Endpoint 수집", Set.of(TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }

        ApplicationContext applicationContext = context.applicationContext();
        Map<String, RequestMappingHandlerMapping> mappings = new TreeMap<>(
                applicationContext.getBeansOfType(RequestMappingHandlerMapping.class));
        if (mappings.isEmpty()) {
            return unavailable("RequestMappingHandlerMapping 미등록");
        }

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        boolean partial = false;

        for (Map.Entry<String, RequestMappingHandlerMapping> mappingEntry : mappings.entrySet()) {
            List<Map.Entry<RequestMappingInfo, HandlerMethod>> entries;
            try {
                entries = new ArrayList<>(mappingEntry.getValue().getHandlerMethods().entrySet());
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "HandlerMapping 등록 정보 조회 실패"));
                continue;
            }
            entries.sort(Comparator.comparing(entry -> entry.getKey().toString()));
            for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : entries) {
                try {
                    partial |= collectMapping(context.serviceId(), mappingEntry.getKey(), entry.getKey(), entry.getValue(), facts, evidence, diagnostics);
                } catch (RuntimeException exception) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "Endpoint 등록 정보 처리 실패"));
                }
            }
        }
        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    private boolean collectMapping(
            String serviceId,
            String mappingName,
            RequestMappingInfo mapping,
            HandlerMethod handlerMethod,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        if (mapping.getCustomCondition() != null) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, "사용자 정의 Endpoint 조건 미지원"));
            return true;
        }
        String handler = handler(handlerMethod);
        List<String> methods = mapping.getMethodsCondition().getMethods().stream()
                .map(RequestMethod::name).sorted().toList();
        List<String> paths = mapping.getPatternValues().stream().filter(path -> !isBlank(path)).sorted().toList();
        if (isBlank(handler) || paths.isEmpty()) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, "Endpoint 필수 등록 정보 부재"));
            return true;
        }
        if (methods.isEmpty()) {
            methods = List.of("ANY");
        }

        Map<String, String> conditions = conditions(mapping);
        String conditionKey = conditions.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + entry.getValue())
                .collect(Collectors.joining("|"));
        for (String method : methods) {
            for (String path : paths) {
                String subjectKey = "endpoint|" + mappingName + "|" + method + "|" + path + "|" + handler + "|" + conditionKey;
                String evidenceId = idGenerator.generate(serviceId, NodeType.ENDPOINT, "evidence|" + subjectKey);
                Map<String, String> attributes = new TreeMap<>(conditions);
                attributes.put("httpMethod", method);
                attributes.put("path", path);
                attributes.put("handler", handler);
                attributes.put("handlerMapping", mappingName);
                facts.add(new Fact(
                        idGenerator.generate(serviceId, NodeType.ENDPOINT, "fact|" + subjectKey),
                        TYPE, subjectKey, attributes, List.of(evidenceId)));
                evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME, mappingName + ":" + handler,
                        "등록 Endpoint: " + method + " " + path));
            }
        }
        return false;
    }

    private Map<String, String> conditions(RequestMappingInfo mapping) {
        Map<String, String> conditions = new TreeMap<>();
        addCondition(conditions, "params", mapping.getParamsCondition().getExpressions().stream()
                .map(Object::toString).sorted().toList());
        addCondition(conditions, "headers", mapping.getHeadersCondition().getExpressions().stream()
                .map(Object::toString).sorted().toList());
        addCondition(conditions, "consumes", mapping.getConsumesCondition().getExpressions().stream()
                .map(Object::toString).sorted().toList());
        addCondition(conditions, "produces", mapping.getProducesCondition().getExpressions().stream()
                .map(Object::toString).sorted().toList());
        if (mapping.getVersionCondition() != null && !isBlank(mapping.getVersionCondition().getVersion())) {
            conditions.put("version", mapping.getVersionCondition().getVersion());
        }
        return conditions;
    }

    private void addCondition(Map<String, String> conditions, String name, List<String> values) {
        if (!values.isEmpty()) {
            conditions.put(name, String.join(",", values));
        }
    }

    private String handler(HandlerMethod handlerMethod) {
        if (handlerMethod == null || handlerMethod.getBeanType() == null || handlerMethod.getMethod() == null) {
            return null;
        }
        Method method = handlerMethod.getMethod();
        String parameters = java.util.Arrays.stream(method.getParameterTypes())
                .map(Class::getName).collect(Collectors.joining(","));
        return handlerMethod.getBeanType().getName() + "#" + method.getName() + "(" + parameters + ")";
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
