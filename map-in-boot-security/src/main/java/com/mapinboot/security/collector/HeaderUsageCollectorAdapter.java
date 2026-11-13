package com.mapinboot.security.collector;

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
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.objectweb.asm.Type;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.bind.annotation.RequestHeader;

// Request Header 선언·조회 패턴의 Fact·Evidence 수집
public class HeaderUsageCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "HEADER_USAGE";
    private static final String HTTP_SERVLET_REQUEST = "jakarta/servlet/http/HttpServletRequest";
    private static final String GET_HEADER_DESCRIPTOR = "(Ljava/lang/String;)Ljava/lang/String;";
    private static final String GET_HEADERS_DESCRIPTOR = "(Ljava/lang/String;)Ljava/util/Enumeration;";
    private static final String GET_DATE_HEADER_DESCRIPTOR = "(Ljava/lang/String;)J";
    private static final String GET_INT_HEADER_DESCRIPTOR = "(Ljava/lang/String;)I";
    private static final String GET_HEADER_NAMES_DESCRIPTOR = "()Ljava/util/Enumeration;";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public HeaderUsageCollectorAdapter() {
        super("security-header-usage", "Request Header 선언 및 조회 패턴 수집", Set.of(TYPE));
    }

    // ApplicationContext Bean 기반 Request Header 선언·조회 수집
    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }
        if (!(context.applicationContext() instanceof ConfigurableApplicationContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                context.applicationContext(), id(), "Header 사용");
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(discovery.diagnostics());
        boolean partial = discovery.partial();
        Map<String, Usage> usageByKey = new TreeMap<>();
        for (Class<?> targetClass : ApplicationClassDiscovery.sortedClasses(discovery.targetClasses())) {
            if (ApplicationClassDiscovery.isFrameworkClass(targetClass)) {
                continue;
            }
            try {
                partial |= collectDeclarations(targetClass, usageByKey, diagnostics);
                BytecodeUsageScanner.ScanResult result = BytecodeUsageScanner.scan(targetClass);
                if (result.diagnostic() != null) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Header 사용 대상 " + result.diagnostic()));
                }
                for (BytecodeUsageScanner.MethodCall call : result.calls()) {
                    if (!HTTP_SERVLET_REQUEST.equals(call.owner())) {
                        continue;
                    }
                    if (isHeaderLookup(call.name(), call.descriptor())) {
                        String headerName = call.argumentLiteral(0);
                        if (headerName == null) {
                            partial = true;
                            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                                    "동적 Header 이름 확인 불가: " + call.codeLocation() + "|"
                                            + call.name() + "|" + call.descriptor()));
                            continue;
                        }
                        Usage usage = Usage.lookup(headerName, call);
                        usageByKey.putIfAbsent(usage.subjectKey(), usage);
                    } else if ("getHeaderNames".equals(call.name())
                            && GET_HEADER_NAMES_DESCRIPTOR.equals(call.descriptor())) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                                "Header 이름 확인 불가: " + call.codeLocation() + "|"
                                        + call.name() + "|" + call.descriptor()));
                    }
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Header 사용 분석 실패: " + targetClass.getName()));
            }
        }

        List<Usage> usages = usageByKey.values().stream()
                .sorted(Comparator.comparing(Usage::codeLocation)
                        .thenComparing(Usage::operation)
                        .thenComparing(Usage::sourceKind)
                        .thenComparing(Usage::apiOwner)
                        .thenComparing(Usage::apiName)
                        .thenComparing(Usage::apiDescriptor)
                        .thenComparing(Usage::headerName)
                        .thenComparingInt(Usage::occurrence))
                .toList();

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        for (Usage usage : usages) {
            String subjectKey = usage.subjectKey();
            String evidenceId = idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA,
                    "evidence|" + subjectKey);
            TreeMap<String, String> attributes = new TreeMap<>();
            attributes.put("apiDescriptor", usage.apiDescriptor());
            attributes.put("apiName", usage.apiName());
            attributes.put("apiOwner", usage.apiOwner());
            attributes.put("apiType", usage.apiType());
            attributes.put("codeLocation", usage.codeLocation());
            attributes.put("headerName", usage.headerName());
            attributes.put("observationKind", usage.observationKind());
            attributes.put("operation", usage.operation());
            attributes.put("occurrence", Integer.toString(usage.occurrence()));
            attributes.put("sourceKind", usage.sourceKind());
            if (usage.required() != null) {
                attributes.put("required", usage.required());
            }
            if (usage.hasDefaultValue() != null) {
                attributes.put("hasDefaultValue", usage.hasDefaultValue());
            }
            facts.add(new Fact(
                    idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA, "fact|" + subjectKey),
                    TYPE,
                    subjectKey,
                    attributes,
                    List.of(evidenceId)));
            evidence.add(new Evidence(evidenceId, usage.evidenceSource(), usage.codeLocation(),
                    usage.evidenceSummary()));
        }
        AnalysisStatus status = partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY;
        return new CollectionResult(id(), facts, evidence, status, diagnostics);
    }

    private boolean collectDeclarations(
            Class<?> targetClass,
            Map<String, Usage> usageByKey,
            List<AdapterDiagnostic> diagnostics
    ) {
        Method[] methods;
        try {
            methods = targetClass.getDeclaredMethods();
        } catch (RuntimeException exception) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "Header 선언 Method 조회 불완전: " + targetClass.getName()));
            return true;
        }
        boolean partial = false;
        for (Method method : methods) {
            String methodDescriptor = Type.getMethodDescriptor(method);
            Parameter[] parameters = method.getParameters();
            for (int index = 0; index < parameters.length; index++) {
                Parameter parameter = parameters[index];
                RequestHeader annotation = parameter.getAnnotation(RequestHeader.class);
                if (annotation == null) {
                    continue;
                }
                String headerName = annotation.name().isBlank() ? annotation.value() : annotation.name();
                if (headerName.isBlank() && parameter.isNamePresent()) {
                    headerName = parameter.getName();
                }
                String codeLocation = targetClass.getName() + "#" + method.getName() + methodDescriptor
                        + "@parameter[" + index + "]";
                if (headerName.isBlank()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Header 이름 확인 불가: " + codeLocation));
                    continue;
                }
                Usage usage = Usage.declaration(headerName, codeLocation, methodDescriptor, index,
                        annotation.required(), !org.springframework.web.bind.annotation.ValueConstants.DEFAULT_NONE
                                .equals(annotation.defaultValue()));
                usageByKey.putIfAbsent(usage.subjectKey(), usage);
            }
        }
        return partial;
    }

    private boolean isHeaderLookup(String name, String descriptor) {
        return ("getHeader".equals(name) && GET_HEADER_DESCRIPTOR.equals(descriptor))
                || ("getHeaders".equals(name) && GET_HEADERS_DESCRIPTOR.equals(descriptor))
                || ("getDateHeader".equals(name) && GET_DATE_HEADER_DESCRIPTOR.equals(descriptor))
                || ("getIntHeader".equals(name) && GET_INT_HEADER_DESCRIPTOR.equals(descriptor));
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record Usage(
            String operation,
            String sourceKind,
            String observationKind,
            String apiType,
            String codeLocation,
            String apiOwner,
            String apiName,
            String apiDescriptor,
            String headerName,
            int occurrence,
            String required,
            String hasDefaultValue,
            EvidenceSource evidenceSource,
            String evidenceSummary
    ) {
        private static Usage declaration(
                String headerName, String codeLocation, String methodDescriptor, int parameterIndex,
                boolean required, boolean hasDefaultValue) {
            return new Usage("DECLARE", "REQUEST_HEADER", "DECLARATION", "REQUEST_HEADER", codeLocation,
                    "org.springframework.web.bind.annotation.RequestHeader", "parameter[" + parameterIndex + "]",
                    methodDescriptor, headerName, parameterIndex, Boolean.toString(required),
                    Boolean.toString(hasDefaultValue), EvidenceSource.DECLARATION,
                    "RequestHeader 선언: " + headerName);
        }

        private static Usage lookup(String headerName, BytecodeUsageScanner.MethodCall call) {
            return new Usage("READ", "SERVLET_REQUEST", "HEADER_LOOKUP", "SERVLET_REQUEST",
                    call.codeLocation(), call.owner().replace('/', '.'), call.name(), call.descriptor(), headerName,
                    call.occurrence(), null, null, EvidenceSource.CODE_PATTERN,
                    "Request Header 조회 패턴: " + call.name());
        }

        private String subjectKey() {
            return "header|" + operation + "|" + sourceKind + "|" + observationKind + "|"
                    + codeLocation + "|" + apiOwner + "|" + apiName + "|" + apiDescriptor + "|"
                    + headerName + "|" + occurrence;
        }
    }
}
