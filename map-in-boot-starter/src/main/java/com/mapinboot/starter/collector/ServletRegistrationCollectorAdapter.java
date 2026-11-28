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
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletRegistration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.web.context.WebApplicationContext;

// Servlet Container 등록 수집기
public class ServletRegistrationCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "SERVLET_REGISTRATION";
    private static final String DISPATCHER_SERVLET_CLASS = "org.springframework.web.servlet.DispatcherServlet";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public ServletRegistrationCollectorAdapter() {
        super("starter-servlet-registration", "Servlet Container 등록 정보 수집", Set.of(TYPE));
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
        Map<String, ? extends ServletRegistration> registrations;
        try {
            registrations = new TreeMap<>(servletContext.getServletRegistrations());
        } catch (RuntimeException exception) {
            return new CollectionResult(id(), facts, evidence, AnalysisStatus.UNKNOWN,
                    List.of(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "Servlet 등록 목록 조회 실패")));
        }

        boolean partial = false;
        for (Map.Entry<String, ? extends ServletRegistration> entry : registrations.entrySet()) {
            try {
                String servletName = entry.getKey();
                ServletRegistration registration = entry.getValue();
                List<String> mappings = registration.getMappings().stream().filter(pattern -> !isBlank(pattern)).sorted().toList();
                if (mappings.isEmpty()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, "Servlet URL Pattern 미확인"));
                    continue;
                }
                for (String pattern : mappings) {
                    String subjectKey = "servlet|" + servletName + "|" + pattern;
                    String evidenceId = idGenerator.generate(context.serviceId(), NodeType.SERVLET, "evidence|" + subjectKey);
                    Map<String, String> attributes = new TreeMap<>();
                    attributes.put("servletName", servletName);
                    attributes.put("urlPattern", pattern);
                    String className = registration.getClassName();
                    if (!isBlank(className)) {
                        attributes.put("servletClass", className);
                        attributes.put("servletKind", DISPATCHER_SERVLET_CLASS.equals(className) ? "DISPATCHER" : "SERVLET");
                    }
                    facts.add(new Fact(idGenerator.generate(context.serviceId(), NodeType.SERVLET, "fact|" + subjectKey),
                            TYPE, subjectKey, attributes, List.of(evidenceId)));
                    evidence.add(new Evidence(evidenceId, EvidenceSource.RUNTIME, "servlet:" + servletName,
                            "Servlet 등록: " + servletName));
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "Servlet 등록 항목 처리 실패"));
            }
        }
        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
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
