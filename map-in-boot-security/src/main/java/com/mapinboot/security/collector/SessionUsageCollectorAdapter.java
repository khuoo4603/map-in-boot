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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.context.ConfigurableApplicationContext;

// Session 및 인증 상태 API 호출 패턴의 Fact·Evidence 수집
public class SessionUsageCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "SESSION_USAGE";
    private static final String HTTP_SESSION = "jakarta/servlet/http/HttpSession";
    private static final String HTTP_SERVLET_REQUEST = "jakarta/servlet/http/HttpServletRequest";
    private static final String AUTHENTICATION = "org/springframework/security/core/Authentication";
    private static final String GET_ATTRIBUTE_DESCRIPTOR = "(Ljava/lang/String;)Ljava/lang/Object;";
    private static final String SET_ATTRIBUTE_DESCRIPTOR = "(Ljava/lang/String;Ljava/lang/Object;)V";
    private static final String REMOVE_ATTRIBUTE_DESCRIPTOR = "(Ljava/lang/String;)V";
    private static final String GET_SESSION_DESCRIPTOR = "()Ljakarta/servlet/http/HttpSession;";
    private static final String GET_SESSION_IF_EXISTS_DESCRIPTOR = "(Z)Ljakarta/servlet/http/HttpSession;";
    private static final String INVALIDATE_DESCRIPTOR = "()V";
    private static final String IS_AUTHENTICATED_DESCRIPTOR = "()Z";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public SessionUsageCollectorAdapter() {
        super("security-session-usage", "Session 및 인증 상태 API 호출 패턴 수집", Set.of(TYPE));
    }

    // ApplicationContext Bean 타입 기반 Session·인증 상태 Bytecode 수집
    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }
        if (!(context.applicationContext() instanceof ConfigurableApplicationContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                context.applicationContext(), id(), "Session 사용");
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(discovery.diagnostics());
        boolean partial = discovery.partial();
        List<Usage> usages = new ArrayList<>();
        for (Class<?> targetClass : ApplicationClassDiscovery.sortedClasses(discovery.targetClasses())) {
            if (ApplicationClassDiscovery.isFrameworkClass(targetClass)) {
                continue;
            }
            try {
                BytecodeUsageScanner.ScanResult result = BytecodeUsageScanner.scan(targetClass);
                if (result.diagnostic() != null) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Session 사용 대상 " + result.diagnostic()));
                }
                for (BytecodeUsageScanner.MethodCall call : result.calls()) {
                    UsagePattern pattern = usagePattern(call.owner(), call.name(), call.descriptor());
                    if (pattern == null) {
                        continue;
                    }
                    usages.add(new Usage(
                            pattern.operation(), pattern.sourceKind(), pattern.observationKind(), pattern.apiType(),
                            call.codeLocation(), call.owner(), call.name(), call.descriptor(),
                            pattern.attributeOperation() ? call.argumentLiteral(0) : null, call.occurrence()));
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Session 사용 바이트코드 분석 실패: " + targetClass.getName()));
            }
        }

        usages.sort(Comparator.comparing(Usage::codeLocation)
                .thenComparing(Usage::operation)
                .thenComparing(Usage::apiOwner)
                .thenComparing(Usage::apiName)
                .thenComparing(Usage::apiDescriptor)
                .thenComparing(usage -> Objects.toString(usage.attributeName(), ""))
                .thenComparingInt(Usage::occurrence));

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        for (Usage usage : usages) {
            String subjectKey = usage.subjectKey();
            String evidenceId = idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA,
                    "evidence|" + subjectKey);
            TreeMap<String, String> attributes = new TreeMap<>();
            attributes.put("apiDescriptor", usage.apiDescriptor());
            attributes.put("apiName", usage.apiName());
            attributes.put("apiOwner", usage.apiOwner().replace('/', '.'));
            attributes.put("apiType", usage.apiType());
            attributes.put("codeLocation", usage.codeLocation());
            attributes.put("operation", usage.operation());
            attributes.put("occurrence", Integer.toString(usage.occurrence()));
            attributes.put("observationKind", usage.observationKind());
            attributes.put("sourceKind", usage.sourceKind());
            if (usage.attributeName() != null) {
                attributes.put("attributeName", usage.attributeName());
            }
            facts.add(new Fact(
                    idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA, "fact|" + subjectKey),
                    TYPE,
                    subjectKey,
                    attributes,
                    List.of(evidenceId)));
            evidence.add(new Evidence(evidenceId, EvidenceSource.CODE_PATTERN, usage.codeLocation(),
                    "Session API 호출 패턴: " + usage.operation()));
        }

        AnalysisStatus status = partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY;
        return new CollectionResult(id(), facts, evidence, status, diagnostics);
    }

    private UsagePattern usagePattern(String owner, String name, String descriptor) {
        if (HTTP_SESSION.equals(owner)) {
            if ("getAttribute".equals(name) && GET_ATTRIBUTE_DESCRIPTOR.equals(descriptor)) {
                return new UsagePattern("READ", "HTTP_SESSION", "SESSION_ATTRIBUTE", "HTTP_SESSION");
            }
            if ("setAttribute".equals(name) && SET_ATTRIBUTE_DESCRIPTOR.equals(descriptor)) {
                return new UsagePattern("WRITE", "HTTP_SESSION", "SESSION_ATTRIBUTE", "HTTP_SESSION");
            }
            if ("removeAttribute".equals(name) && REMOVE_ATTRIBUTE_DESCRIPTOR.equals(descriptor)) {
                return new UsagePattern("REMOVE", "HTTP_SESSION", "SESSION_ATTRIBUTE", "HTTP_SESSION");
            }
            if ("invalidate".equals(name) && INVALIDATE_DESCRIPTOR.equals(descriptor)) {
                return new UsagePattern("INVALIDATE", "HTTP_SESSION", "SESSION_INVALIDATION", "HTTP_SESSION");
            }
        }
        if (HTTP_SERVLET_REQUEST.equals(owner) && "getSession".equals(name)
                && (GET_SESSION_DESCRIPTOR.equals(descriptor)
                || GET_SESSION_IF_EXISTS_DESCRIPTOR.equals(descriptor))) {
            return new UsagePattern("ACQUIRE", "HTTP_SESSION", "SESSION_ACQUISITION", "HTTP_SERVLET_REQUEST");
        }
        if (AUTHENTICATION.equals(owner) && "isAuthenticated".equals(name)
                && IS_AUTHENTICATED_DESCRIPTOR.equals(descriptor)) {
            return new UsagePattern("AUTH_STATUS", "AUTHENTICATION", "AUTHENTICATION_STATUS",
                    "SPRING_AUTHENTICATION");
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

    private record Usage(
            String operation,
            String sourceKind,
            String observationKind,
            String apiType,
            String codeLocation,
            String apiOwner,
            String apiName,
            String apiDescriptor,
            String attributeName,
            int occurrence
    ) {
        private String subjectKey() {
            return "session|" + operation + "|" + sourceKind + "|" + observationKind + "|"
                    + codeLocation + "|" + apiOwner + "|" + apiName + "|" + apiDescriptor + "|"
                    + Objects.toString(attributeName, "") + "|" + occurrence;
        }
    }

    private record UsagePattern(String operation, String sourceKind, String observationKind, String apiType) {
        private boolean attributeOperation() {
            return "SESSION_ATTRIBUTE".equals(observationKind);
        }
    }
}
