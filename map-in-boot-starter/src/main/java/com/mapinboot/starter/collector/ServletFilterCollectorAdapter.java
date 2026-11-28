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
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.web.context.WebApplicationContext;

// Servlet Container Filter 등록 수집기
public class ServletFilterCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "FILTER_REGISTRATION";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public ServletFilterCollectorAdapter() {
        super("starter-servlet-filter", "Servlet Container Filter 등록 정보 수집", Set.of(TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }
        ServletContext servletContext = servletContext(context);
        if (servletContext == null) {
            return unavailable("ServletContext 미제공 환경");
        }

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Map<String, ? extends FilterRegistration> registrations;
        try {
            registrations = new TreeMap<>(servletContext.getFilterRegistrations());
        } catch (RuntimeException exception) {
            return new CollectionResult(id(), facts, evidence, AnalysisStatus.UNKNOWN,
                    List.of(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "Filter 등록 목록 조회 실패")));
        }

        boolean partial = false;
        for (Map.Entry<String, ? extends FilterRegistration> entry : registrations.entrySet()) {
            try {
                String registrationName = entry.getKey();
                FilterRegistration registration = entry.getValue();
                String filterClass = registration.getClassName();
                if (isBlank(filterClass)) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, "Filter 클래스 미확인"));
                    continue;
                }
                String subjectKey = "filter|" + registrationName + "|" + filterClass;
                String evidenceId = idGenerator.generate(context.serviceId(), NodeType.FILTER, "evidence|" + subjectKey);
                Map<String, String> attributes = new TreeMap<>();
                attributes.put("filterClass", filterClass);
                attributes.put("registrationKind", "SERVLET");
                attributes.put("registrationName", registrationName);
                addMappings(attributes, "urlPatterns", registration.getUrlPatternMappings());
                addMappings(attributes, "servletNames", registration.getServletNameMappings());
                facts.add(new Fact(idGenerator.generate(context.serviceId(), NodeType.FILTER, "fact|" + subjectKey),
                        TYPE, subjectKey, attributes, List.of(evidenceId)));
                evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME, "filter:" + registrationName,
                        "Filter 등록: " + registrationName));
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "Filter 등록 항목 처리 실패"));
            }
        }
        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    private void addMappings(Map<String, String> attributes, String name, java.util.Collection<String> values) {
        if (values != null && !values.isEmpty()) {
            attributes.put(name, values.stream().filter(value -> !isBlank(value)).sorted().collect(java.util.stream.Collectors.joining(",")));
        }
    }

    private ServletContext servletContext(CollectionContext context) {
        if (context.applicationContext() instanceof WebApplicationContext webApplicationContext) {
            return webApplicationContext.getServletContext();
        }
        return null;
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
