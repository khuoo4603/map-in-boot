package com.mapinboot.security.analyzer;

import com.mapinboot.core.analysis.AbstractAnalysisAdapter;
import com.mapinboot.core.analysis.model.AnalysisContext;
import com.mapinboot.core.analysis.model.AnalysisResult;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.status.AnalysisStatus;
import com.mapinboot.core.common.status.Confidence;
import com.mapinboot.core.common.status.EvidenceSource;
import com.mapinboot.core.common.type.EdgeType;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Evidence;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.evidence.Relation;
import com.mapinboot.core.graph.StableIdGenerator;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

// 인증정보 사용 Fact와 기존 인가 Fact 사이의 확인 가능한 호출 관계 분석
public class CredentialUsageAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String JWT_TYPE = "JWT_USAGE";
    private static final String SESSION_TYPE = "SESSION_USAGE";
    private static final String HEADER_TYPE = "HEADER_USAGE";
    private static final String PRINCIPAL_TYPE = "PRINCIPAL_USAGE";
    private static final String AUTHORITY_TYPE = "AUTHORITY_MAPPING";
    private static final String METHOD_AUTHORIZATION_TYPE = "METHOD_AUTHORIZATION";
    private static final String URL_AUTHORIZATION_TYPE = "URL_AUTHORIZATION";
    private static final String OBJECT_AUTHORIZATION_TYPE = "OBJECT_AUTHORIZATION";
    private static final String ENDPOINT_COLLECTOR = "starter-endpoint-mapping";
    private static final String JWT_COLLECTOR = "security-jwt-usage";
    private static final String SESSION_COLLECTOR = "security-session-usage";
    private static final String HEADER_COLLECTOR = "security-header-usage";
    private static final String PRINCIPAL_COLLECTOR = "security-principal-usage";
    private static final String METHOD_AUTHORIZATION_COLLECTOR = "security-method-authorization";
    private static final int MAX_CALL_DEPTH = 2;
    private static final String JWT = "org/springframework/security/oauth2/jwt/Jwt";
    private static final String AUTHENTICATION = "org/springframework/security/core/Authentication";
    private static final String SECURITY_CONTEXT = "org/springframework/security/core/context/SecurityContext";
    private static final String JAVA_MAP = "java/util/Map";
    private static final String SIMPLE_GRANTED_AUTHORITY =
            "org/springframework/security/core/authority/SimpleGrantedAuthority";
    private static final String JWT_GRANTED_AUTHORITIES_CONVERTER =
            "org/springframework/security/oauth2/server/resource/authentication/JwtGrantedAuthoritiesConverter";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public CredentialUsageAnalysisAdapter() {
        super("security-credential-usage-analysis", "인증정보 사용·변환·인가 호출 관계 분석",
                Set.of("READS_SECURITY_DATA", "WRITES_SECURITY_DATA",
                        "CONVERTS_TO_AUTHORITY", "USES_FOR_AUTHORIZATION"));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("분석 입력 또는 서비스 식별자 부재");
        }

        CollectionReport report = context.collectionReport();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Map<String, Evidence> evidenceById = evidenceById(report.evidence());
        List<Fact> endpoints = facts(report, ENDPOINT_TYPE);
        List<Fact> credentialFacts = credentialFacts(report);
        List<Fact> authorityFacts = facts(report, AUTHORITY_TYPE);
        List<Fact> authorizationFacts = authorizationFacts(report);
        boolean partial = collectionStatus(report, endpoints, credentialFacts, authorityFacts, diagnostics);
        Map<RelationKey, RelationData> relationData = new TreeMap<>(relationKeyComparator());
        Map<String, Evidence> additionalEvidence = new TreeMap<>();
        Map<PathKey, PathResult> pathCache = new HashMap<>();
        Map<MethodLocation, ScanResult> scanCache = new HashMap<>();
        List<ResolvedUsage> resolvedUsages = new ArrayList<>();

        for (Fact endpoint : endpoints) {
            HandlerSignature handler = parseHandler(endpoint.attributes().get("handler"));
            MethodLocation handlerLocation = handlerLocation(handler);
            if (handlerLocation == null) {
                partial = true;
                diagnostics.add(diagnostic("Endpoint Handler 구조 확인 불가"));
                continue;
            }
            for (Fact fact : credentialFacts) {
                UsageKind usageKind = usageKind(fact);
                if (usageKind == UsageKind.NONE) {
                    continue;
                }
                MethodLocation usageLocation = parseLocation(fact.attributes().get("codeLocation"));
                if (usageLocation == null) {
                    partial = true;
                    diagnostics.add(diagnostic("인증정보 사용 위치 확인 불가"));
                    continue;
                }
                PathResult path = findPath(handlerLocation, usageLocation, pathCache, scanCache);
                if (path.kind() == PathKind.NONE) {
                    continue;
                }
                if (path.kind() == PathKind.UNKNOWN) {
                    partial = true;
                    diagnostics.add(diagnostic("인증정보 호출 Receiver 또는 호출 경로 확인 불가"));
                    continue;
                }
                Set<String> evidenceIds = validEvidence(fact, evidenceById, diagnostics);
                if (evidenceIds.isEmpty()) {
                    partial = true;
                    continue;
                }
                if (path.kind() == PathKind.CALL_PATH) {
                    Evidence pathEvidence = pathEvidence(context.serviceId(), handlerLocation, usageLocation,
                            path.location());
                    additionalEvidence.putIfAbsent(pathEvidence.id(), pathEvidence);
                    evidenceIds = mergeEvidence(evidenceIds, Set.of(pathEvidence.id()));
                }
                EdgeType edgeType = usageKind == UsageKind.READ
                        ? EdgeType.READS_SECURITY_DATA : EdgeType.WRITES_SECURITY_DATA;
                addRelation(relationData, endpoint.attributes().get("handler"),
                        fact.subjectKey(), edgeType, securityKind(fact), Confidence.CONFIRMED, evidenceIds);
                resolvedUsages.add(new ResolvedUsage(endpoint, fact, path, usageKind, handlerLocation));
            }
        }

        partial |= addAuthorityConversions(context.serviceId(), credentialFacts, authorityFacts,
                evidenceById, relationData, additionalEvidence, diagnostics, scanCache);
        partial |= addAuthorizationUses(resolvedUsages, authorizationFacts, diagnostics);

        List<Relation> relations = relationData.values().stream()
                .map(data -> data.relation(context.serviceId(), idGenerator))
                .toList();
        return result(relations, partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY,
                diagnostics, List.copyOf(additionalEvidence.values()));
    }

    @Override
    public Set<String> requiredFactTypes() {
        // 관련 Collector의 부분 실패에도 확인된 Fact 기반 관계 보존
        return Set.of();
    }

    private boolean addAuthorityConversions(
            String serviceId,
            List<Fact> credentialFacts,
            List<Fact> authorityFacts,
            Map<String, Evidence> evidenceById,
            Map<RelationKey, RelationData> relationData,
            Map<String, Evidence> additionalEvidence,
            List<AdapterDiagnostic> diagnostics,
            Map<MethodLocation, ScanResult> scanCache
    ) {
        boolean partial = false;
        List<Fact> sources = credentialFacts.stream()
                .filter(this::authoritySource)
                .toList();
        for (Fact authority : authorityFacts) {
            if (!authorityMapping(authority)) {
                continue;
            }
            MethodLocation authorityLocation = parseLocation(authority.attributes().get("codeLocation"));
            if (authorityLocation == null) {
                partial = true;
                diagnostics.add(diagnostic("Authority 변환 위치 확인 불가"));
                continue;
            }
            for (Fact source : sources) {
                MethodLocation sourceLocation = parseLocation(source.attributes().get("codeLocation"));
                if (sourceLocation == null) {
                    partial = true;
                    diagnostics.add(diagnostic("Authority 입력 인증정보 위치 확인 불가"));
                    continue;
                }
                PathResult path = conversionPath(source, authority, sourceLocation, authorityLocation, scanCache);
                if (path.kind() == PathKind.NONE) {
                    continue;
                }
                if (path.kind() == PathKind.UNKNOWN) {
                    partial = true;
                    diagnostics.add(diagnostic("Authority 변환 입력 흐름 확인 불가"));
                    continue;
                }
                Set<String> sourceEvidence = validEvidence(source, evidenceById, diagnostics);
                Set<String> authorityEvidence = validEvidence(authority, evidenceById, diagnostics);
                if (sourceEvidence.isEmpty() || authorityEvidence.isEmpty()) {
                    partial = true;
                    continue;
                }
                Set<String> evidenceIds = mergeEvidence(sourceEvidence, authorityEvidence);
                if (path.kind() == PathKind.CALL_PATH) {
                    Evidence pathEvidence = pathEvidence(serviceId, sourceLocation, authorityLocation,
                            path.location());
                    additionalEvidence.putIfAbsent(pathEvidence.id(), pathEvidence);
                    evidenceIds = mergeEvidence(evidenceIds, Set.of(pathEvidence.id()));
                }
                addRelation(relationData, source.subjectKey(), authority.subjectKey(),
                        EdgeType.CONVERTS_TO_AUTHORITY, "AUTHORITY_CONVERSION", Confidence.CONFIRMED, evidenceIds);
            }
        }
        return partial;
    }

    private boolean addAuthorizationUses(
            List<ResolvedUsage> resolvedUsages,
            List<Fact> authorizationFacts,
            List<AdapterDiagnostic> diagnostics
    ) {
        boolean partial = false;
        Map<String, List<ResolvedUsage>> byEndpoint = resolvedUsages.stream()
                .filter(usage -> usage.kind() == UsageKind.READ && authorizationCandidate(usage.fact()))
                .collect(java.util.stream.Collectors.groupingBy(
                        usage -> usage.endpoint().subjectKey(), LinkedHashMap::new, java.util.stream.Collectors.toList()));
        for (Map.Entry<String, List<ResolvedUsage>> entry : byEndpoint.entrySet()) {
            Fact endpoint = entry.getValue().get(0).endpoint();
            // URL Chain·Matcher·첫 적용 정책 판정은 기존 Endpoint Analyzer 책임이며 정책 Fact만으로 데이터 흐름은 입증되지 않음
            // Method Security 선언과 인증정보 조회만으로 정책 입력 데이터 흐름은 입증되지 않음
            List<Fact> matched = authorizationFacts.stream()
                    .filter(fact -> METHOD_AUTHORIZATION_TYPE.equals(fact.type()))
                    .filter(fact -> Objects.equals(endpoint.attributes().get("handler"),
                            fact.attributes().get("handler")))
                    .toList();
            if (matched.size() > 1) {
                partial = true;
                diagnostics.add(diagnostic("Endpoint Authorization Fact 매핑 모호"));
                continue;
            }
            if (matched.isEmpty()) {
                continue;
            }
            partial = true;
            diagnostics.add(diagnostic("인증정보 조회와 Method Security 선언만으로 정책 입력 데이터 흐름 확인 불가; 인가 사용 관계 보류"));
        }
        return partial;
    }

    private PathResult conversionPath(
            Fact source,
            Fact authority,
            MethodLocation sourceLocation,
            MethodLocation authorityLocation,
            Map<MethodLocation, ScanResult> scanCache
    ) {
        if (!sourceLocation.equals(authorityLocation)) {
            return PathResult.none();
        }
        ScanResult scan = scan(sourceLocation, scanCache);
        if (!scan.available() || !scan.found()) {
            return PathResult.unknown();
        }
        MethodCall mappingCall = scan.calls().stream()
                .filter(call -> matchesFact(call, authority))
                .findFirst()
                .orElse(null);
        if (mappingCall == null) {
            return scan.uncertain() ? PathResult.unknown() : PathResult.none();
        }
        if (mappingCall.argumentsUncertain()) {
            return PathResult.unknown();
        }
        if (!argumentContainsSource(mappingCall, source)) {
            return PathResult.none();
        }
        return PathResult.direct();
    }

    private PathResult findPath(
            MethodLocation start,
            MethodLocation target,
            Map<PathKey, PathResult> pathCache,
            Map<MethodLocation, ScanResult> scanCache
    ) {
        PathKey key = new PathKey(start, target);
        PathResult cached = pathCache.get(key);
        if (cached != null) {
            return cached;
        }
        if (start.equals(target)) {
            PathResult direct = PathResult.direct();
            pathCache.put(key, direct);
            return direct;
        }

        Set<String> roots = new LinkedHashSet<>();
        roots.add(applicationRoot(start.className()));
        roots.add(applicationRoot(target.className()));
        Deque<PathNode> pending = new ArrayDeque<>();
        pending.add(new PathNode(start, 0, null));
        Set<MethodLocation> visited = new LinkedHashSet<>();
        boolean unknown = false;
        PathResult confirmed = null;

        while (!pending.isEmpty()) {
            PathNode current = pending.removeFirst();
            if (!visited.add(current.location())) {
                continue;
            }
            ScanResult scan = scan(current.location(), scanCache);
            if (!scan.available() || !scan.found()) {
                unknown = true;
                continue;
            }
            for (MethodCall call : scan.calls()) {
                String ownerClass = call.owner().replace('/', '.');
                if (targetCall(call, ownerClass, target)) {
                    if (receiverAllowed(call, current.location().className(), target.className())) {
                        String location = current.firstCallLocation() == null
                                ? current.location().value() : current.firstCallLocation();
                        PathResult candidate = PathResult.callPath(location);
                        if (confirmed == null) {
                            confirmed = candidate;
                        }
                    } else {
                        unknown = true;
                    }
                    continue;
                }
                if (current.depth() >= MAX_CALL_DEPTH || !isApplicationClass(ownerClass, roots)) {
                    continue;
                }
                if (!receiverCanTraverse(call, current.location().className())) {
                    continue;
                }
                pending.addLast(new PathNode(
                        new MethodLocation(ownerClass, call.name(), call.descriptor()),
                        current.depth() + 1,
                        current.firstCallLocation() == null
                                ? current.location().value() : current.firstCallLocation()));
            }
        }

        PathResult result = confirmed != null && !unknown
                ? confirmed : (confirmed != null || unknown ? PathResult.unknown() : PathResult.none());
        pathCache.put(key, result);
        return result;
    }

    private boolean targetCall(MethodCall call, String ownerClass, MethodLocation target) {
        return (ownerClass.equals(target.className()) || relatedTypes(ownerClass, target.className()))
                && call.name().equals(target.methodName())
                && call.descriptor().equals(target.descriptor());
    }

    private boolean receiverAllowed(MethodCall call, String currentClass, String targetClass) {
        if (call.receiver().kind() == ReceiverKind.STATIC) {
            return true;
        }
        if (call.receiver().kind() == ReceiverKind.THIS) {
            return call.owner().replace('/', '.').equals(currentClass)
                    || relatedTypes(call.owner().replace('/', '.'), targetClass);
        }
        if (call.receiver().kind() != ReceiverKind.FIELD) {
            return false;
        }
        try {
            Class<?> source = loadClass(currentClass);
            Field field = findField(source, call.receiver().fieldName());
            if (field == null) {
                return false;
            }
            return relatedTypes(field.getType().getName(), targetClass)
                    || relatedTypes(field.getType().getName(), call.owner().replace('/', '.'));
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private boolean receiverCanTraverse(MethodCall call, String currentClass) {
        if (call.receiver().kind() == ReceiverKind.THIS || call.receiver().kind() == ReceiverKind.STATIC) {
            return true;
        }
        if (call.receiver().kind() != ReceiverKind.FIELD) {
            return false;
        }
        try {
            Field field = findField(loadClass(currentClass), call.receiver().fieldName());
            return field != null && !isFrameworkClass(field.getType().getName());
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private ScanResult scan(MethodLocation location, Map<MethodLocation, ScanResult> cache) {
        ScanResult cached = cache.get(location);
        if (cached != null) {
            return cached;
        }
        ScanResult result;
        try {
            Class<?> targetClass = loadClass(location.className());
            String resourceName = location.className().replace('.', '/') + ".class";
            ClassLoader loader = targetClass.getClassLoader() == null
                    ? classLoader() : targetClass.getClassLoader();
            try (InputStream input = loader.getResourceAsStream(resourceName)) {
                if (input == null) {
                    result = ScanResult.unavailable();
                } else {
                    MethodBytecodeVisitor visitor = new MethodBytecodeVisitor(location);
                    new ClassReader(input).accept(visitor, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
                    result = new ScanResult(true, visitor.found(), visitor.uncertain(), visitor.calls());
                }
            }
        } catch (IOException | LinkageError | RuntimeException exception) {
            result = ScanResult.unavailable();
        }
        cache.put(location, result);
        return result;
    }

    private boolean argumentContainsSource(MethodCall call, Fact source) {
        String operation = source.attributes().get("operation");
        String expectedOwner = source.attributes().get("apiOwner");
        String expectedName = source.attributes().get("apiName");
        String expectedDescriptor = source.attributes().get("apiDescriptor");
        int occurrence = integer(source.attributes().get("occurrence"), -1);
        boolean declaration = "DECLARE".equals(operation);
        for (Set<Origin> origins : call.argumentOrigins()) {
            for (Origin origin : origins) {
                if (declaration && origin.parameterIndex() == occurrence) {
                    return true;
                }
                if (!declaration && Objects.equals(expectedOwner, origin.owner().replace('/', '.'))
                        && Objects.equals(expectedName, origin.name())
                        && Objects.equals(expectedDescriptor, origin.descriptor())
                        && (JWT_TYPE.equals(source.type())
                        ? origin.securityOccurrence() == occurrence
                        : origin.globalOccurrence() == occurrence)) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean matchesFact(MethodCall call, Fact fact) {
        return Objects.equals(fact.attributes().get("apiOwner"), call.owner().replace('/', '.'))
                && Objects.equals(fact.attributes().get("apiName"), call.name())
                && Objects.equals(fact.attributes().get("apiDescriptor"), call.descriptor())
                && integer(fact.attributes().get("occurrence"), -1) == call.globalOccurrence();
    }

    private boolean authoritySource(Fact fact) {
        if (JWT_TYPE.equals(fact.type())) {
            return "READ".equals(fact.attributes().get("operation"));
        }
        if (!PRINCIPAL_TYPE.equals(fact.type())) {
            return false;
        }
        String operation = fact.attributes().get("operation");
        String observationKind = fact.attributes().get("observationKind");
        return ("READ".equals(operation) || "DECLARE".equals(operation))
                && !"AUTHORITY_LOOKUP".equals(observationKind)
                && !"AUTHENTICATION_LOOKUP".equals(observationKind);
    }

    private boolean authorityMapping(Fact fact) {
        if (!AUTHORITY_TYPE.equals(fact.type())) {
            return false;
        }
        String mappingKind = fact.attributes().get("mappingKind");
        return ("CREATE".equals(fact.attributes().get("operation"))
                && "GRANTED_AUTHORITY_CREATION".equals(mappingKind))
                || ("CONVERT".equals(fact.attributes().get("operation"))
                && "JWT_AUTHORITY_CONVERTER".equals(mappingKind));
    }

    private boolean authorizationCandidate(Fact fact) {
        if (SESSION_TYPE.equals(fact.type()) && "AUTH_STATUS".equals(fact.attributes().get("operation"))) {
            return false;
        }
        String observationKind = fact.attributes().get("observationKind");
        return !(PRINCIPAL_TYPE.equals(fact.type())
                && ("AUTHENTICATION_LOOKUP".equals(observationKind)
                || "AUTHORITY_LOOKUP".equals(observationKind)));
    }

    private UsageKind usageKind(Fact fact) {
        String operation = fact.attributes().get("operation");
        if (JWT_TYPE.equals(fact.type())) {
            return switch (operation) {
                case "READ" -> UsageKind.READ;
                case "WRITE" -> UsageKind.WRITE;
                default -> UsageKind.NONE;
            };
        }
        if (SESSION_TYPE.equals(fact.type())) {
            return switch (operation) {
                case "READ", "ACQUIRE", "AUTH_STATUS" -> UsageKind.READ;
                case "WRITE", "REMOVE", "INVALIDATE" -> UsageKind.WRITE;
                default -> UsageKind.NONE;
            };
        }
        if (HEADER_TYPE.equals(fact.type()) || PRINCIPAL_TYPE.equals(fact.type())) {
            return ("READ".equals(operation) || "DECLARE".equals(operation))
                    ? UsageKind.READ : UsageKind.NONE;
        }
        return UsageKind.NONE;
    }

    private String securityKind(Fact fact) {
        return switch (fact.type()) {
            case JWT_TYPE -> "JWT";
            case SESSION_TYPE -> "SESSION";
            case HEADER_TYPE -> "HEADER";
            case PRINCIPAL_TYPE -> "PRINCIPAL";
            default -> "SECURITY_DATA";
        };
    }

    private boolean collectionStatus(
            CollectionReport report,
            List<Fact> endpoints,
            List<Fact> credentialFacts,
            List<Fact> authorityFacts,
            List<AdapterDiagnostic> diagnostics
    ) {
        boolean partial = false;
        partial |= status(report, ENDPOINT_COLLECTOR, !endpoints.isEmpty(), diagnostics);
        partial |= status(report, JWT_COLLECTOR, credentialFacts.stream().anyMatch(f -> JWT_TYPE.equals(f.type())), diagnostics);
        partial |= status(report, SESSION_COLLECTOR,
                credentialFacts.stream().anyMatch(f -> SESSION_TYPE.equals(f.type())), diagnostics);
        partial |= status(report, HEADER_COLLECTOR, credentialFacts.stream().anyMatch(f -> HEADER_TYPE.equals(f.type())), diagnostics);
        partial |= status(report, PRINCIPAL_COLLECTOR,
                credentialFacts.stream().anyMatch(f -> PRINCIPAL_TYPE.equals(f.type())) || !authorityFacts.isEmpty(), diagnostics);
        return partial;
    }

    private boolean status(CollectionReport report, String adapterId, boolean factsPresent,
                           List<AdapterDiagnostic> diagnostics) {
        AnalysisStatus status = report.statusByAdapter().get(adapterId);
        if (status == null) {
            if (factsPresent) {
                diagnostics.add(diagnostic("관련 Collector 상태 부재"));
                return true;
            }
            return false;
        }
        if (status == AnalysisStatus.READY) {
            return false;
        }
        diagnostics.add(diagnostic("관련 Collector 부분 수집 또는 상태 UNKNOWN"));
        return true;
    }

    private List<Fact> credentialFacts(CollectionReport report) {
        return report.facts().stream()
                .filter(fact -> fact != null && (JWT_TYPE.equals(fact.type()) || SESSION_TYPE.equals(fact.type())
                        || HEADER_TYPE.equals(fact.type()) || PRINCIPAL_TYPE.equals(fact.type())))
                .toList();
    }

    private List<Fact> authorizationFacts(CollectionReport report) {
        return report.facts().stream()
                .filter(fact -> fact != null && (METHOD_AUTHORIZATION_TYPE.equals(fact.type())
                        || URL_AUTHORIZATION_TYPE.equals(fact.type())
                        || OBJECT_AUTHORIZATION_TYPE.equals(fact.type())))
                .toList();
    }

    private List<Fact> facts(CollectionReport report, String type) {
        return report.facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .toList();
    }

    private Map<String, Evidence> evidenceById(List<Evidence> evidence) {
        Map<String, Evidence> values = new LinkedHashMap<>();
        for (Evidence item : evidence) {
            if (item != null && !isBlank(item.id())) {
                values.putIfAbsent(item.id(), item);
            }
        }
        return values;
    }

    private Set<String> validEvidence(Fact fact, Map<String, Evidence> evidenceById,
                                      List<AdapterDiagnostic> diagnostics) {
        Set<String> ids = new TreeSet<>();
        for (String id : fact.evidenceIds()) {
            if (!isBlank(id) && evidenceById.containsKey(id)) {
                ids.add(id);
            }
        }
        if (ids.size() != fact.evidenceIds().size()) {
            diagnostics.add(diagnostic("인증정보 관계 Evidence 참조 확인 불가"));
            return Set.of();
        }
        return ids;
    }

    private Set<String> mergeEvidence(Set<String> first, Set<String> second) {
        TreeSet<String> values = new TreeSet<>(first);
        values.addAll(second);
        return Set.copyOf(values);
    }

    private void addRelation(
            Map<RelationKey, RelationData> relationData,
            String sourceKey,
            String targetKey,
            EdgeType type,
            String securityKind,
            Confidence confidence,
            Set<String> evidenceIds
    ) {
        if (isBlank(sourceKey) || isBlank(targetKey) || evidenceIds.isEmpty()) {
            return;
        }
        RelationKey key = new RelationKey(sourceKey, targetKey, type);
        relationData.computeIfAbsent(key, ignored -> new RelationData(
                sourceKey, targetKey, type, securityKind, confidence)).evidenceIds.addAll(evidenceIds);
    }

    private Comparator<RelationKey> relationKeyComparator() {
        return Comparator.comparing(RelationKey::sourceKey)
                .thenComparing(RelationKey::targetKey)
                .thenComparing(key -> key.type().name());
    }

    private Evidence pathEvidence(String serviceId, MethodLocation source, MethodLocation target, String location) {
        String key = "evidence|credential-path|" + source.value() + "|" + target.value() + "|" + location;
        String id = idGenerator.generate(serviceId, NodeType.HANDLER, key);
        return new Evidence(id, EvidenceSource.CODE_PATTERN, location,
                "인증정보 사용 메서드까지의 제한된 호출 경로 확인");
    }

    private MethodLocation handlerLocation(HandlerSignature handler) {
        if (handler == null) {
            return null;
        }
        try {
            Method method = resolveMethod(handler);
            return method == null ? null : new MethodLocation(
                    handler.className(), handler.methodName(), Type.getMethodDescriptor(method));
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private Method resolveMethod(HandlerSignature signature) {
        Class<?> type = loadClass(signature.className());
        List<Method> methods = new ArrayList<>();
        methods.addAll(Arrays.asList(type.getDeclaredMethods()));
        methods.addAll(Arrays.asList(type.getMethods()));
        return methods.stream()
                .filter(method -> method.getName().equals(signature.methodName()))
                .filter(method -> Arrays.equals(method.getParameterTypes(), signature.parameterTypes().stream()
                        .map(this::resolveType).toArray(Class<?>[]::new)))
                .findFirst()
                .orElse(null);
    }

    private Class<?> resolveType(String name) {
        try {
            return switch (name) {
                case "boolean" -> boolean.class;
                case "byte" -> byte.class;
                case "char" -> char.class;
                case "short" -> short.class;
                case "int" -> int.class;
                case "long" -> long.class;
                case "float" -> float.class;
                case "double" -> double.class;
                case "void" -> void.class;
                default -> name.endsWith("[]")
                        ? java.lang.reflect.Array.newInstance(resolveType(name.substring(0, name.length() - 2)), 0).getClass()
                        : Class.forName(name, false, classLoader());
            };
        } catch (ClassNotFoundException exception) {
            throw new IllegalArgumentException("Handler parameter type 확인 실패", exception);
        }
    }

    private HandlerSignature parseHandler(String value) {
        if (isBlank(value)) {
            return null;
        }
        int separator = value.indexOf('#');
        int open = value.indexOf('(', separator + 1);
        int close = value.lastIndexOf(')');
        if (separator <= 0 || open <= separator || close < open) {
            return null;
        }
        String parameters = value.substring(open + 1, close);
        List<String> parameterTypes = parameters.isBlank() ? List.of() : List.of(parameters.split(",", -1));
        return new HandlerSignature(value.substring(0, separator), value.substring(separator + 1, open), parameterTypes);
    }

    private MethodLocation parseLocation(String value) {
        if (isBlank(value)) {
            return null;
        }
        int separator = value.indexOf('#');
        int open = value.indexOf('(', separator + 1);
        int close = value.indexOf(')', open + 1);
        if (separator <= 0 || open <= separator || close < open) {
            return null;
        }
        int suffix = value.indexOf('@', close);
        String descriptor = suffix < 0 ? value.substring(open) : value.substring(open, suffix);
        return new MethodLocation(value.substring(0, separator), value.substring(separator + 1, open), descriptor);
    }

    private Class<?> loadClass(String name) {
        try {
            return Class.forName(name, false, classLoader());
        } catch (ClassNotFoundException exception) {
            throw new IllegalArgumentException("Bytecode Class 확인 실패", exception);
        }
    }

    private Field findField(Class<?> type, String name) {
        Class<?> current = type;
        while (current != null && current != Object.class) {
            try {
                return current.getDeclaredField(name);
            } catch (NoSuchFieldException exception) {
                current = current.getSuperclass();
            }
        }
        return null;
    }

    private boolean relatedTypes(String firstName, String secondName) {
        if (Objects.equals(firstName, secondName)) {
            return true;
        }
        try {
            Class<?> first = loadClass(firstName);
            Class<?> second = loadClass(secondName);
            return first.isAssignableFrom(second) || second.isAssignableFrom(first);
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private boolean isApplicationClass(String name, Set<String> roots) {
        return !isFrameworkClass(name) && roots.stream().anyMatch(root -> name.equals(root) || name.startsWith(root + "."));
    }

    private boolean isFrameworkClass(String name) {
        return name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jakarta.")
                || name.startsWith("org.springframework.") || name.startsWith("org.objectweb.asm.")
                || name.startsWith("com.nimbusds.");
    }

    private String applicationRoot(String name) {
        String[] parts = name.split("\\.");
        if (parts.length >= 2 && Set.of("com", "org", "net", "io").contains(parts[0])) {
            return parts[0] + "." + parts[1];
        }
        return parts.length == 0 ? name : parts[0];
    }

    private String jwtOperation(String owner, String name) {
        if ((JWT.equals(owner) || "com/nimbusds/jwt/JWTClaimsSet".equals(owner))
                && Set.of("getSubject", "getClaim", "getClaims").contains(name)) {
            return "READ";
        }
        if ("com/nimbusds/jwt/JWTClaimsSet$Builder".equals(owner)
                && Set.of("subject", "issuer", "audience", "claim").contains(name)) {
            return "WRITE";
        }
        if ("com/nimbusds/jwt/SignedJWT".equals(owner) && Set.of("sign", "verify").contains(name)) {
            return "sign".equals(name) ? "SIGN" : "VERIFY";
        }
        if ("org/springframework/security/oauth2/jwt/JwtDecoder".equals(owner)
                && "decode".equals(name)) {
            return "VERIFY";
        }
        if ("org/springframework/security/oauth2/jwt/NimbusJwtDecoder".equals(owner)
                && ("decode".equals(name) || name.startsWith("with") || "setJwtValidator".equals(name))) {
            return "decode".equals(name) ? "VERIFY" : "VERIFY_CONFIGURATION";
        }
        if (owner.startsWith("org/springframework/security/oauth2/jwt/NimbusJwtDecoder$")
                && "build".equals(name)) {
            return "VERIFY_CONFIGURATION";
        }
        if ("org/springframework/security/oauth2/jwt/JwtDecoders".equals(owner) && name.startsWith("from")) {
            return "VERIFY_CONFIGURATION";
        }
        if ("org/springframework/security/oauth2/jwt/JwtValidators".equals(owner) && name.startsWith("create")) {
            return "VERIFY_CONFIGURATION";
        }
        if ("com/nimbusds/jose/JWSObject".equals(owner) && "verify".equals(name)) {
            return "VERIFY";
        }
        if (name.equals("<init>") && Set.of(
                "com/nimbusds/jose/crypto/RSASSAVerifier",
                "com/nimbusds/jose/crypto/MACVerifier",
                "com/nimbusds/jose/crypto/ECDSAVerifier",
                "com/nimbusds/jose/crypto/Ed25519Verifier").contains(owner)) {
            return "VERIFY_CONFIGURATION";
        }
        return null;
    }

    private boolean securitySourceCall(String owner, String name, String descriptor) {
        return "READ".equals(jwtOperation(owner, name))
                || AUTHENTICATION.equals(owner) && Set.of("getPrincipal", "getName", "getAuthorities", "isAuthenticated")
                .contains(name)
                || SECURITY_CONTEXT.equals(owner) && "getAuthentication".equals(name);
    }

    private int integer(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private AnalysisResult unknown(String summary) {
        return result(List.of(), AnalysisStatus.UNKNOWN, List.of(diagnostic(summary)), List.of());
    }

    private AnalysisResult result(List<Relation> relations, AnalysisStatus status,
                                  List<AdapterDiagnostic> diagnostics, List<Evidence> evidence) {
        return new AnalysisResult(id(), relations, evidence, status, diagnostics);
    }

    private AdapterDiagnostic diagnostic(String summary) {
        return new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary);
    }

    private ClassLoader classLoader() {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        return loader == null ? CredentialUsageAnalysisAdapter.class.getClassLoader() : loader;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private enum UsageKind {
        READ,
        WRITE,
        NONE
    }

    private enum PathKind {
        DIRECT,
        CALL_PATH,
        NONE,
        UNKNOWN
    }

    private enum ReceiverKind {
        THIS,
        FIELD,
        STATIC,
        OTHER,
        UNKNOWN
    }

    private record HandlerSignature(String className, String methodName, List<String> parameterTypes) {
    }

    private record MethodLocation(String className, String methodName, String descriptor) {
        private String value() {
            return className + "#" + methodName + descriptor;
        }
    }

    private record PathKey(MethodLocation start, MethodLocation target) {
    }

    private record PathResult(PathKind kind, String location) {
        private static PathResult direct() {
            return new PathResult(PathKind.DIRECT, null);
        }

        private static PathResult callPath(String location) {
            return new PathResult(PathKind.CALL_PATH, location);
        }

        private static PathResult none() {
            return new PathResult(PathKind.NONE, null);
        }

        private static PathResult unknown() {
            return new PathResult(PathKind.UNKNOWN, null);
        }
    }

    private record PathNode(MethodLocation location, int depth, String firstCallLocation) {
    }

    private record ResolvedUsage(Fact endpoint, Fact fact, PathResult path, UsageKind kind,
                                 MethodLocation handlerLocation) {
    }

    private record RelationKey(String sourceKey, String targetKey, EdgeType type) {
    }

    private static final class RelationData {
        private final String sourceKey;
        private final String targetKey;
        private final EdgeType type;
        private final String securityKind;
        private final Confidence confidence;
        private final Set<String> evidenceIds = new TreeSet<>();

        private RelationData(String sourceKey, String targetKey, EdgeType type,
                             String securityKind, Confidence confidence) {
            this.sourceKey = sourceKey;
            this.targetKey = targetKey;
            this.type = type;
            this.securityKind = securityKind;
            this.confidence = confidence;
        }

        private Relation relation(String serviceId, StableIdGenerator idGenerator) {
            String sourceId = idGenerator.generate(serviceId, sourceType(type), sourceKey);
            String targetId = idGenerator.generate(serviceId, targetType(type), targetKey);
            Map<String, String> attributes = Map.of("securityKind", securityKind);
            String id = idGenerator.generateEdge(sourceId, targetId, type, attributes);
            return new Relation(id, sourceKey, targetKey, type, attributes, confidence, List.copyOf(evidenceIds));
        }

        private NodeType sourceType(EdgeType edgeType) {
            return edgeType == EdgeType.READS_SECURITY_DATA || edgeType == EdgeType.WRITES_SECURITY_DATA
                    ? NodeType.HANDLER : NodeType.SECURITY_DATA;
        }

        private NodeType targetType(EdgeType edgeType) {
            return edgeType == EdgeType.USES_FOR_AUTHORIZATION
                    ? NodeType.AUTHORIZATION : NodeType.SECURITY_DATA;
        }
    }

    private record ScanResult(boolean available, boolean found, boolean uncertain, List<MethodCall> calls) {
        private ScanResult {
            calls = List.copyOf(calls);
        }

        private static ScanResult unavailable() {
            return new ScanResult(false, false, true, List.of());
        }
    }

    private record MethodCall(
            String owner,
            String name,
            String descriptor,
            int opcode,
            ReceiverValue receiver,
            int globalOccurrence,
            int securityOccurrence,
            List<Set<Origin>> argumentOrigins,
            boolean argumentsUncertain
    ) {
        private MethodCall {
            argumentOrigins = argumentOrigins.stream().map(Set::copyOf).toList();
        }
    }

    private record ReceiverValue(ReceiverKind kind, String fieldOwner, String fieldName) {
        private static ReceiverValue thisValue() {
            return new ReceiverValue(ReceiverKind.THIS, null, null);
        }

        private static ReceiverValue field(String owner, String name) {
            return new ReceiverValue(ReceiverKind.FIELD, owner, name);
        }

        private static ReceiverValue staticValue() {
            return new ReceiverValue(ReceiverKind.STATIC, null, null);
        }

        private static ReceiverValue other() {
            return new ReceiverValue(ReceiverKind.OTHER, null, null);
        }

        private static ReceiverValue unknown() {
            return new ReceiverValue(ReceiverKind.UNKNOWN, null, null);
        }
    }

    private record Origin(String owner, String name, String descriptor,
                          int globalOccurrence, int securityOccurrence, int parameterIndex) {
        private static Origin parameter(int index) {
            return new Origin("", "", "", -1, -1, index);
        }
    }

    private record StackValue(ReceiverValue receiver, Set<Origin> origins, boolean uncertain) {
        private static StackValue thisValue() {
            return new StackValue(ReceiverValue.thisValue(), Set.of(), false);
        }

        private static StackValue parameter(int index) {
            return new StackValue(ReceiverValue.other(), Set.of(Origin.parameter(index)), false);
        }

        private static StackValue other() {
            return new StackValue(ReceiverValue.other(), Set.of(), false);
        }

        private static StackValue unknown() {
            return new StackValue(ReceiverValue.unknown(), Set.of(), true);
        }

        private static StackValue field(String owner, String name) {
            return new StackValue(ReceiverValue.field(owner, name), Set.of(), false);
        }
    }

    private final class MethodBytecodeVisitor extends ClassVisitor {
        private final MethodLocation location;
        private final List<MethodCall> calls = new ArrayList<>();
        private boolean found;
        private boolean uncertain;

        private MethodBytecodeVisitor(MethodLocation location) {
            super(Opcodes.ASM9);
            this.location = location;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            if (!location.methodName().equals(name) || !location.descriptor().equals(descriptor)) {
                return null;
            }
            found = true;
            return new UsageMethodVisitor(access, descriptor);
        }

        private List<MethodCall> calls() {
            return calls.stream()
                    .sorted(Comparator.comparingInt(MethodCall::globalOccurrence))
                    .toList();
        }

        private boolean found() {
            return found;
        }

        private boolean uncertain() {
            return uncertain;
        }

        private final class UsageMethodVisitor extends MethodVisitor {
            private final Deque<StackValue> stack = new ArrayDeque<>();
            private final Map<Integer, StackValue> locals = new LinkedHashMap<>();
            private final Set<Label> controlFlowTargets = new LinkedHashSet<>();
            private final Set<Label> exceptionHandlers = new LinkedHashSet<>();
            private final String methodDescriptor;
            private int globalOccurrence;
            private int securityOccurrence;
            private boolean uncertain;

            private UsageMethodVisitor(int access, String methodDescriptor) {
                super(Opcodes.ASM9);
                this.methodDescriptor = methodDescriptor;
                initializeLocals(access);
            }

            private void initializeLocals(int access) {
                int local = Modifier.isStatic(access) ? 0 : 1;
                if (!Modifier.isStatic(access)) {
                    locals.put(0, StackValue.thisValue());
                }
                int parameterIndex = 0;
                for (Type parameter : Type.getArgumentTypes(methodDescriptor)) {
                    locals.put(local, StackValue.parameter(parameterIndex++));
                    local += parameter.getSize();
                }
            }

            @Override
            public void visitVarInsn(int opcode, int variable) {
                if (opcode == Opcodes.ALOAD) {
                    stack.push(locals.getOrDefault(variable, StackValue.unknown()));
                } else if (opcode == Opcodes.ASTORE) {
                    locals.put(variable, popValue());
                } else if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.DSTORE) {
                    popValue();
                    locals.remove(variable);
                } else if (opcode >= Opcodes.ILOAD && opcode <= Opcodes.DLOAD) {
                    stack.push(StackValue.other());
                } else {
                    markUncertain();
                }
            }

            @Override
            public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                if (opcode == Opcodes.GETFIELD) {
                    popValue();
                    stack.push(StackValue.field(owner, name));
                } else if (opcode == Opcodes.GETSTATIC) {
                    stack.push(StackValue.other());
                } else if (opcode == Opcodes.PUTFIELD) {
                    popValue();
                    popValue();
                } else {
                    popValue();
                }
            }

            @Override
            public void visitMethodInsn(int opcode, String owner, String name, String descriptor,
                                        boolean isInterface) {
                List<StackValue> arguments = arguments(descriptor);
                StackValue receiver = opcode == Opcodes.INVOKESTATIC ? StackValue.other() : popValue();
                boolean carriesOrigin = receiver.uncertain() || !receiver.origins().isEmpty()
                        || arguments.stream().anyMatch(value -> !value.origins().isEmpty());
                boolean argumentsUncertain = arguments.stream().anyMatch(StackValue::uncertain);
                int currentGlobalOccurrence = globalOccurrence++;
                String jwtOperation = jwtOperation(owner, name);
                int currentSecurityOccurrence = jwtOperation == null ? -1 : securityOccurrence++;
                List<Set<Origin>> argumentOrigins = arguments.stream().map(StackValue::origins).toList();
                calls.add(new MethodCall(owner, name, descriptor, opcode, receiver.receiver(),
                        currentGlobalOccurrence, currentSecurityOccurrence, argumentOrigins, argumentsUncertain));
                boolean unsupportedOrigin = carriesOrigin && !securitySourceCall(owner, name, descriptor)
                        && !(JAVA_MAP.equals(owner) && "get".equals(name))
                        && !(SIMPLE_GRANTED_AUTHORITY.equals(owner) && "<init>".equals(name));
                if (unsupportedOrigin) {
                    markUncertain();
                }
                Type returnType = Type.getReturnType(descriptor);
                if (returnType.getSort() != Type.VOID) {
                    Set<Origin> origins = new LinkedHashSet<>();
                    boolean valueUncertain = false;
                    if (securitySourceCall(owner, name, descriptor)) {
                        origins.add(new Origin(owner, name, descriptor, currentGlobalOccurrence,
                                currentSecurityOccurrence, -1));
                    } else if (JAVA_MAP.equals(owner) && "get".equals(name)) {
                        origins.addAll(receiver.origins());
                        valueUncertain = receiver.uncertain();
                    }
                    if (unsupportedOrigin) {
                        origins.clear();
                        valueUncertain = true;
                    }
                    stack.push(new StackValue(StackValue.other().receiver(), origins, valueUncertain));
                }
            }

            @Override
            public void visitInvokeDynamicInsn(String name, String descriptor,
                                                Handle bootstrapMethodHandle, Object... bootstrapMethodArguments) {
                arguments(descriptor);
                markUncertain();
                Type returnType = Type.getReturnType(descriptor);
                if (returnType.getSort() != Type.VOID) {
                    stack.push(StackValue.unknown());
                }
            }

            @Override
            public void visitInsn(int opcode) {
                switch (opcode) {
                    case Opcodes.ACONST_NULL, Opcodes.ICONST_M1, Opcodes.ICONST_0, Opcodes.ICONST_1,
                            Opcodes.ICONST_2, Opcodes.ICONST_3, Opcodes.ICONST_4, Opcodes.ICONST_5,
                            Opcodes.FCONST_0, Opcodes.FCONST_1, Opcodes.FCONST_2,
                            Opcodes.LCONST_0, Opcodes.LCONST_1, Opcodes.DCONST_0, Opcodes.DCONST_1 ->
                            stack.push(StackValue.other());
                    case Opcodes.POP, Opcodes.POP2 -> popValue();
                    case Opcodes.IRETURN, Opcodes.FRETURN, Opcodes.ARETURN, Opcodes.ATHROW -> popValue();
                    case Opcodes.LRETURN, Opcodes.DRETURN, Opcodes.RETURN -> {
                        if (opcode != Opcodes.RETURN) {
                            popValue();
                        }
                    }
                    case Opcodes.DUP -> {
                        StackValue value = stack.isEmpty() ? StackValue.unknown() : stack.peek();
                        stack.push(value);
                    }
                    case Opcodes.SWAP -> {
                        StackValue first = popValue();
                        StackValue second = popValue();
                        stack.push(first);
                        stack.push(second);
                    }
                    case Opcodes.NOP -> {
                    }
                    default -> markUncertain();
                }
            }

            @Override
            public void visitTypeInsn(int opcode, String type) {
                if (opcode == Opcodes.NEW) {
                    stack.push(StackValue.other());
                } else if (opcode == Opcodes.CHECKCAST) {
                    StackValue value = popValue();
                    stack.push(value);
                } else if (opcode == Opcodes.ANEWARRAY || opcode == Opcodes.INSTANCEOF) {
                    popValue();
                    stack.push(StackValue.other());
                } else {
                    markUncertain();
                }
            }

            @Override
            public void visitLdcInsn(Object value) {
                stack.push(StackValue.other());
            }

            @Override
            public void visitIntInsn(int opcode, int operand) {
                if (opcode == Opcodes.NEWARRAY) {
                    popValue();
                }
                stack.push(StackValue.other());
            }

            @Override
            public void visitJumpInsn(int opcode, Label label) {
                controlFlowTargets.add(label);
                stack.clear();
                if (opcode == Opcodes.GOTO || opcode == Opcodes.JSR) {
                    locals.clear();
                }
                markUncertain();
            }

            @Override
            public void visitLookupSwitchInsn(Label defaultHandler, int[] keys, Label... labels) {
                controlFlowTargets.add(defaultHandler);
                controlFlowTargets.addAll(Arrays.asList(labels));
                stack.clear();
                locals.clear();
                markUncertain();
            }

            @Override
            public void visitTableSwitchInsn(int min, int max, Label defaultHandler, Label... labels) {
                controlFlowTargets.add(defaultHandler);
                controlFlowTargets.addAll(Arrays.asList(labels));
                stack.clear();
                locals.clear();
                markUncertain();
            }

            @Override
            public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
                exceptionHandlers.add(handler);
            }

            @Override
            public void visitLabel(Label label) {
                if (exceptionHandlers.contains(label)) {
                    markUncertain();
                    stack.push(StackValue.unknown());
                } else if (controlFlowTargets.contains(label)) {
                    stack.clear();
                    locals.clear();
                }
            }

            @Override
            public void visitMultiANewArrayInsn(String descriptor, int dimensions) {
                for (int index = 0; index < dimensions; index++) {
                    popValue();
                }
                stack.push(StackValue.other());
            }

            private List<StackValue> arguments(String descriptor) {
                Type[] types = Type.getArgumentTypes(descriptor);
                List<StackValue> values = new ArrayList<>();
                for (int index = types.length - 1; index >= 0; index--) {
                    values.add(popValue());
                }
                java.util.Collections.reverse(values);
                return values;
            }

            private StackValue popValue() {
                return stack.isEmpty() ? StackValue.unknown() : stack.pop();
            }

            private void markUncertain() {
                uncertain = true;
                stack.clear();
                locals.clear();
                MethodBytecodeVisitor.this.uncertain = true;
            }
        }
    }
}
