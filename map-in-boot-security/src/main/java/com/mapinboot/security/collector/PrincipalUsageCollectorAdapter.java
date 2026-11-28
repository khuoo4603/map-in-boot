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
import org.springframework.security.core.annotation.AuthenticationPrincipal;

// Principal 조회 및 Authority 변환 패턴의 Fact·Evidence 수집
public class PrincipalUsageCollectorAdapter extends AbstractCollectorAdapter {
    private static final String PRINCIPAL_TYPE = "PRINCIPAL_USAGE";
    private static final String AUTHORITY_TYPE = "AUTHORITY_MAPPING";
    private static final String AUTHENTICATION = "org/springframework/security/core/Authentication";
    private static final String SECURITY_CONTEXT = "org/springframework/security/core/context/SecurityContext";
    private static final String JWT = "org/springframework/security/oauth2/jwt/Jwt";
    private static final String SIMPLE_GRANTED_AUTHORITY =
            "org/springframework/security/core/authority/SimpleGrantedAuthority";
    private static final String JWT_GRANTED_AUTHORITIES_CONVERTER =
            "org/springframework/security/oauth2/server/resource/authentication/JwtGrantedAuthoritiesConverter";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public PrincipalUsageCollectorAdapter() {
        super("security-principal-usage", "Principal 조회 및 Authority 변환 패턴 수집",
                Set.of(PRINCIPAL_TYPE, AUTHORITY_TYPE));
    }

    // ApplicationContext Bean 기반 Principal·Authority Bytecode 수집
    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }
        if (!(context.applicationContext() instanceof ConfigurableApplicationContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                context.applicationContext(), id(), "Principal 사용");
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(discovery.diagnostics());
        boolean partial = discovery.partial();
        Map<String, Usage> usageByKey = new TreeMap<>();
        for (Class<?> targetClass : ApplicationClassDiscovery.sortedClasses(discovery.targetClasses())) {
            if (ApplicationClassDiscovery.isFrameworkClass(targetClass)) {
                continue;
            }
            try {
                collectDeclarations(targetClass, usageByKey);
                BytecodeUsageScanner.ScanResult result = BytecodeUsageScanner.scan(targetClass);
                if (result.diagnostic() != null) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Principal 사용 대상 " + result.diagnostic()));
                }
                for (BytecodeUsageScanner.MethodCall call : result.calls()) {
                    Usage usage = usage(call);
                    if (usage != null) {
                        usageByKey.putIfAbsent(usage.subjectKey(), usage);
                    }
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Principal 사용 분석 실패: " + targetClass.getName()));
            }
        }

        List<Usage> usages = usageByKey.values().stream()
                .sorted(Comparator.comparing(Usage::factType)
                        .thenComparing(Usage::codeLocation)
                        .thenComparing(Usage::operation)
                        .thenComparing(Usage::sourceKind)
                        .thenComparing(Usage::principalType)
                        .thenComparing(Usage::mappingKind)
                        .thenComparing(Usage::apiOwner)
                        .thenComparing(Usage::apiName)
                        .thenComparing(Usage::apiDescriptor)
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
            attributes.put("observationKind", usage.observationKind());
            attributes.put("operation", usage.operation());
            attributes.put("occurrence", Integer.toString(usage.occurrence()));
            attributes.put("sourceKind", usage.sourceKind());
            if (usage.factType().equals(PRINCIPAL_TYPE)) {
                attributes.put("principalType", usage.principalType());
            } else {
                attributes.put("mappingKind", usage.mappingKind());
            }
            facts.add(new Fact(
                    idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA, "fact|" + subjectKey),
                    usage.factType(),
                    subjectKey,
                    attributes,
                    List.of(evidenceId)));
            evidence.add(new Evidence(evidenceId, usage.evidenceSource(), usage.codeLocation(),
                    usage.evidenceSummary()));
        }
        AnalysisStatus status = partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY;
        return new CollectionResult(id(), facts, evidence, status, diagnostics);
    }

    private void collectDeclarations(Class<?> targetClass, Map<String, Usage> usageByKey) {
        for (Method method : targetClass.getDeclaredMethods()) {
            String methodDescriptor = Type.getMethodDescriptor(method);
            Parameter[] parameters = method.getParameters();
            for (int index = 0; index < parameters.length; index++) {
                Parameter parameter = parameters[index];
                AuthenticationPrincipal annotation = parameter.getAnnotation(AuthenticationPrincipal.class);
                if (annotation == null) {
                    continue;
                }
                String codeLocation = targetClass.getName() + "#" + method.getName() + methodDescriptor
                        + "@parameter[" + index + "]";
                Usage usage = Usage.principal(
                        parameter.getType().getName(), codeLocation, methodDescriptor, index,
                        "AUTHENTICATION_PRINCIPAL", "DECLARATION", "DECLARE",
                        "org.springframework.security.core.annotation.AuthenticationPrincipal",
                        "parameter[" + index + "]", EvidenceSource.DECLARATION,
                        "AuthenticationPrincipal 선언: " + parameter.getType().getName());
                usageByKey.putIfAbsent(usage.subjectKey(), usage);
            }
        }
    }

    private Usage usage(BytecodeUsageScanner.MethodCall call) {
        String owner = call.owner();
        String name = call.name();
        String descriptor = call.descriptor();
        if (AUTHENTICATION.equals(owner) && "getPrincipal".equals(name)
                && "()Ljava/lang/Object;".equals(descriptor)) {
            return Usage.principal(owner.replace('/', '.'), call.codeLocation(), descriptor, call.occurrence(),
                    "AUTHENTICATION", "PRINCIPAL_LOOKUP", "READ", owner, name,
                    EvidenceSource.CODE_PATTERN, "Authentication Principal 조회: getPrincipal");
        }
        if (AUTHENTICATION.equals(owner) && "getName".equals(name)
                && "()Ljava/lang/String;".equals(descriptor)) {
            return Usage.principal(owner.replace('/', '.'), call.codeLocation(), descriptor, call.occurrence(),
                    "AUTHENTICATION", "PRINCIPAL_NAME", "READ", owner, name,
                    EvidenceSource.CODE_PATTERN, "Authentication Principal 이름 조회: getName");
        }
        if (AUTHENTICATION.equals(owner) && "getAuthorities".equals(name)
                && "()Ljava/util/Collection;".equals(descriptor)) {
            return Usage.principal(owner.replace('/', '.'), call.codeLocation(), descriptor, call.occurrence(),
                    "AUTHENTICATION", "AUTHORITY_LOOKUP", "READ", owner, name,
                    EvidenceSource.CODE_PATTERN, "Authentication Authority 조회: getAuthorities");
        }
        if (SECURITY_CONTEXT.equals(owner) && "getAuthentication".equals(name)
                && "()Lorg/springframework/security/core/Authentication;".equals(descriptor)) {
            return Usage.principal(AUTHENTICATION.replace('/', '.'), call.codeLocation(), descriptor, call.occurrence(),
                    "SECURITY_CONTEXT", "AUTHENTICATION_LOOKUP", "READ", owner, name,
                    EvidenceSource.CODE_PATTERN, "SecurityContext Authentication 조회");
        }
        if (JWT.equals(owner) && "getSubject".equals(name)
                && "()Ljava/lang/String;".equals(descriptor)) {
            return Usage.principal(owner.replace('/', '.'), call.codeLocation(), descriptor, call.occurrence(),
                    "JWT", "SUBJECT_LOOKUP", "READ", owner, name,
                    EvidenceSource.CODE_PATTERN, "JWT Subject 조회: getSubject");
        }
        if (SIMPLE_GRANTED_AUTHORITY.equals(owner) && "<init>".equals(name)
                && "(Ljava/lang/String;)V".equals(descriptor)) {
            return Usage.mapping("GRANTED_AUTHORITY_CREATION", call.codeLocation(), descriptor, call.occurrence(),
                    "AUTHORITY", "AUTHORITY_MAPPING", "CREATE", owner, name,
                    EvidenceSource.CODE_PATTERN, "GrantedAuthority 생성 패턴");
        }
        if (JWT_GRANTED_AUTHORITIES_CONVERTER.equals(owner) && "convert".equals(name)
                && "(Lorg/springframework/security/oauth2/jwt/Jwt;)Ljava/util/Collection;".equals(descriptor)) {
            return Usage.mapping("JWT_AUTHORITY_CONVERTER", call.codeLocation(), descriptor, call.occurrence(),
                    "JWT", "AUTHORITY_MAPPING", "CONVERT", owner, name,
                    EvidenceSource.CODE_PATTERN, "JWT Authority Converter 호출");
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
            String factType,
            String principalType,
            String mappingKind,
            String operation,
            String sourceKind,
            String observationKind,
            String apiOwner,
            String apiName,
            String apiDescriptor,
            String apiType,
            String codeLocation,
            int occurrence,
            EvidenceSource evidenceSource,
            String evidenceSummary
    ) {
        private static Usage principal(
                String principalType, String codeLocation, String descriptor, int occurrence,
                String sourceKind, String observationKind, String operation,
                String apiOwner, String apiName, EvidenceSource evidenceSource, String evidenceSummary) {
            return new Usage(PRINCIPAL_TYPE, principalType, "", operation, sourceKind, observationKind,
                    apiOwner.replace('/', '.'), apiName, descriptor, "PRINCIPAL", codeLocation, occurrence,
                    evidenceSource, evidenceSummary);
        }

        private static Usage mapping(
                String mappingKind, String codeLocation, String descriptor, int occurrence,
                String sourceKind, String observationKind, String operation,
                String apiOwner, String apiName, EvidenceSource evidenceSource, String evidenceSummary) {
            return new Usage(AUTHORITY_TYPE, "", mappingKind, operation, sourceKind, observationKind,
                    apiOwner.replace('/', '.'), apiName, descriptor, "AUTHORITY", codeLocation, occurrence,
                    evidenceSource, evidenceSummary);
        }

        private String subjectKey() {
            return "principal|" + factType + "|" + principalType + "|" + mappingKind + "|"
                    + operation + "|" + sourceKind + "|" + observationKind + "|" + codeLocation + "|"
                    + apiOwner + "|" + apiName + "|" + apiDescriptor + "|" + occurrence;
        }
    }
}
