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
import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

// Endpoint Handler와 Method Security 선언의 실제 적용 가능 경로 분석
public class MethodSecurityAnalysisAdapter extends AbstractAnalysisAdapter {
    private static final String ENDPOINT_TYPE = "ENDPOINT_MAPPING";
    private static final String METHOD_TYPE = "METHOD_AUTHORIZATION";
    private static final String ENDPOINT_COLLECTOR = "starter-endpoint-mapping";
    private static final String METHOD_COLLECTOR = "security-method-authorization";
    private static final String CHAIN_COLLECTOR = "security-chain";
    private static final int MAX_CALL_DEPTH = 2;
    private static final Set<String> METHOD_ANNOTATIONS = Set.of(
            "PRE_AUTHORIZE", "POST_AUTHORIZE", "SECURED", "ROLES_ALLOWED");

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public MethodSecurityAnalysisAdapter() {
        super("security-method-authorization-analysis", "URL Endpoint와 Method Security 적용 가능 경로 분석",
                Set.of("SECURED_BY"));
    }

    @Override
    public AnalysisResult analyze(AnalysisContext context) {
        if (context == null || context.collectionReport() == null || isBlank(context.serviceId())) {
            return unknown("분석 입력 또는 서비스 식별자 부재");
        }

        CollectionReport report = context.collectionReport();
        List<Fact> endpoints = facts(report, ENDPOINT_TYPE);
        List<Fact> methods = facts(report, METHOD_TYPE);
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        AnalysisStatus endpointStatus = report.statusByAdapter().get(ENDPOINT_COLLECTOR);
        AnalysisStatus methodStatus = report.statusByAdapter().get(METHOD_COLLECTOR);

        if (endpointStatus == null) {
            diagnostics.add(diagnostic("Endpoint 수집 상태 부재"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (methodStatus == null) {
            diagnostics.add(diagnostic("Method Security 수집 상태 부재"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (endpointStatus == AnalysisStatus.UNKNOWN || (endpoints.isEmpty() && endpointStatus != AnalysisStatus.READY)) {
            diagnostics.add(diagnostic("Endpoint Fact 부재 또는 수집 상태 UNKNOWN"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }
        if (methodStatus == AnalysisStatus.UNKNOWN) {
            diagnostics.add(diagnostic("Method Security Fact 수집 상태 UNKNOWN"));
            return result(List.of(), AnalysisStatus.UNKNOWN, diagnostics);
        }

        boolean partial = endpointStatus != AnalysisStatus.READY || methodStatus != AnalysisStatus.READY;
        if (endpointStatus != AnalysisStatus.READY) {
            diagnostics.add(diagnostic("Endpoint 수집 상태 불완전"));
        }
        if (methodStatus != AnalysisStatus.READY) {
            diagnostics.add(diagnostic("Method Security 수집 상태 불완전"));
        }
        if (methods.isEmpty()) {
            return result(List.of(), partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
        }

        Map<String, List<Fact>> methodsByHandler = methods.stream()
                .filter(fact -> !isBlank(fact.attributes().get("handler")))
                .collect(Collectors.groupingBy(
                        fact -> fact.attributes().get("handler"),
                        LinkedHashMap::new,
                        Collectors.toList()));
        List<Relation> relations = new ArrayList<>();
        Map<String, Evidence> additionalEvidence = new LinkedHashMap<>();
        UrlAnalysis urlAnalysis = urlAnalysis(context, endpoints, diagnostics);

        for (Fact endpoint : endpoints) {
            Set<String> directlyResolved = new LinkedHashSet<>();
            Set<String> endpointRelatedMethods = new LinkedHashSet<>();
            String handler = endpoint.attributes().get("handler");
            if (isBlank(handler)) {
                partial = true;
                diagnostics.add(diagnostic("Endpoint Handler 구조 부재: " + endpoint.subjectKey()));
                continue;
            }

            for (Fact method : methodsByHandler.getOrDefault(handler, List.of())) {
                directlyResolved.add(method.subjectKey());
                endpointRelatedMethods.add(method.subjectKey());
                Applicability applicability = applicability(method);
                if (applicability != Applicability.CONFIRMED) {
                    partial = true;
                    diagnostics.add(diagnostic("Method Security Advisor 또는 Proxy 적용 여부 미확인: "
                            + method.subjectKey()));
                    continue;
                }
                relations.add(relation(context.serviceId(), endpoint, method,
                        "DIRECT_HANDLER", null));
            }

            for (Fact method : methods) {
                if (directlyResolved.contains(method.subjectKey())) {
                    continue;
                }
                CallPath path = findCallPath(endpoint, method);
                if (path.kind() == CallPathKind.NONE) {
                    continue;
                }
                endpointRelatedMethods.add(method.subjectKey());
                if (applicability(method) != Applicability.CONFIRMED) {
                    partial = true;
                    diagnostics.add(diagnostic("Method Security 호출 경로의 Advisor 또는 Proxy 적용 여부 미확인: "
                            + method.subjectKey()));
                    continue;
                }
                if (path.kind() == CallPathKind.EXTERNAL_UNCONFIRMED) {
                    partial = true;
                    diagnostics.add(diagnostic("Spring 관리 Proxy Bean 경유 여부 미확인: "
                            + method.subjectKey()));
                    continue;
                }
                if (path.kind() == CallPathKind.SELF_INVOCATION) {
                    partial = true;
                    diagnostics.add(diagnostic("Self Invocation으로 Method Security 보호 경로 미확인: "
                            + method.subjectKey()));
                    continue;
                }
                if (path.kind() == CallPathKind.UNKNOWN) {
                    partial = true;
                    diagnostics.add(diagnostic("Method Security 호출 Receiver 확인 불가: "
                            + method.subjectKey()));
                    continue;
                }
                Evidence codeEvidence = codeEvidence(context.serviceId(), endpoint, method, path.location());
                additionalEvidence.putIfAbsent(codeEvidence.id(), codeEvidence);
                relations.add(relation(context.serviceId(), endpoint, method,
                        "EXTERNAL_BEAN", codeEvidence.id(), Confidence.UNKNOWN, "UNKNOWN"));
                partial = true;
                diagnostics.add(diagnostic("External Bean Receiver와 Spring Proxy Bean 동일성 미확인: "
                        + method.subjectKey()));
            }

            if (compareUrlMethod(endpoint, endpointRelatedMethods, relations,
                    urlAnalysis, diagnostics)) {
                partial = true;
            }
        }

        if (urlAnalysis.status() == AnalysisStatus.UNKNOWN) {
            partial = true;
            diagnostics.add(diagnostic("URL 정책과 Method Security 비교 불가"));
        } else if (urlAnalysis.status() == AnalysisStatus.PARTIAL) {
            partial = true;
            diagnostics.add(diagnostic("URL 정책 적용 결과 불완전"));
        }

        RelationAggregation aggregation = aggregateRelations(relations, diagnostics);
        return result(aggregation.relations(), partial || aggregation.partial()
                        ? AnalysisStatus.PARTIAL : AnalysisStatus.READY,
                diagnostics, List.copyOf(additionalEvidence.values()));
    }

    @Override
    public Set<String> requiredFactTypes() {
        // 관련 없는 Collector 상태로 분석 전체가 차단되지 않도록 개별 상태 확인
        return Set.of();
    }

    private List<Fact> facts(CollectionReport report, String type) {
        return report.facts().stream()
                .filter(fact -> fact != null && type.equals(fact.type()))
                .toList();
    }

    private Applicability applicability(Fact method) {
        String annotationType = method.attributes().get("annotationType");
        if (!METHOD_ANNOTATIONS.contains(annotationType)) {
            return Applicability.UNKNOWN;
        }
        if (!"true".equalsIgnoreCase(method.attributes().get("proxyDetected"))) {
            return Applicability.UNKNOWN;
        }
        return isBlank(method.attributes().get("methodSecurityInfrastructure"))
                ? Applicability.UNKNOWN : Applicability.CONFIRMED;
    }

    private UrlAnalysis urlAnalysis(
            AnalysisContext context,
            List<Fact> endpoints,
            List<AdapterDiagnostic> diagnostics
    ) {
        CollectionReport report = context.collectionReport();
        if (!report.statusByAdapter().containsKey(CHAIN_COLLECTOR)) {
            diagnostics.add(diagnostic("SecurityChain 수집 상태 부재로 URL 정책 확인 불가"));
            return new UrlAnalysis(AnalysisStatus.UNKNOWN, Map.of());
        }
        try {
            AnalysisResult result = new EndpointChainMatchingAnalysisAdapter().analyze(context);
            if (result.status() == AnalysisStatus.UNKNOWN) {
                diagnostics.add(diagnostic("기존 Endpoint·URL 정책 분석 결과 UNKNOWN"));
            }
            Map<String, List<UrlPolicy>> policiesByEndpoint = endpointPolicies(endpoints, result.relations());
            boolean missingPolicy = endpoints.stream()
                    .anyMatch(endpoint -> endpointPoliciesFor(endpoint, policiesByEndpoint).isEmpty());
            AnalysisStatus status = result.status();
            if (missingPolicy && status == AnalysisStatus.READY) {
                status = AnalysisStatus.PARTIAL;
                diagnostics.add(diagnostic("일부 Endpoint의 URL 정책 확인 불가"));
            }
            return new UrlAnalysis(status, policiesByEndpoint);
        } catch (RuntimeException exception) {
            diagnostics.add(diagnostic("기존 Endpoint·URL 정책 분석 실행 실패"));
            return new UrlAnalysis(AnalysisStatus.PARTIAL, Map.of());
        }
    }

    private Map<String, List<UrlPolicy>> endpointPolicies(List<Fact> endpoints, List<Relation> relations) {
        Map<String, Set<String>> chainKeysByEndpoint = new LinkedHashMap<>();
        for (Fact endpoint : endpoints) {
            Set<String> chainKeys = relations.stream()
                    .filter(relation -> relation.type() == EdgeType.MATCHED_BY
                            && endpoint.subjectKey().equals(relation.sourceKey()))
                    .map(relation -> relation.attributes().get("chainKey"))
                    .filter(value -> !isBlank(value))
                    .collect(Collectors.toCollection(LinkedHashSet::new));
            chainKeysByEndpoint.put(endpoint.subjectKey(), chainKeys);
        }

        Map<String, List<UrlPolicy>> policiesByEndpoint = new LinkedHashMap<>();
        for (Fact endpoint : endpoints) {
            Set<String> chainKeys = chainKeysByEndpoint.getOrDefault(endpoint.subjectKey(), Set.of());
            List<UrlPolicy> policies = relations.stream()
                    .filter(relation -> relation.type() == EdgeType.SECURED_BY
                            && "URL".equals(relation.attributes().get("policySource"))
                            && Objects.equals(endpoint.attributes().get("handler"), relation.sourceKey())
                            && chainKeys.contains(relation.attributes().get("chainKey")))
                    .map(relation -> new UrlPolicy(
                            relation.targetKey(),
                            relation.attributes().get("policyKind"),
                            relation.attributes().get("requiredAuthority"),
                            relation.attributes().get("authorityOperator"),
                            relation.evidenceIds()))
                    .distinct()
                    .toList();
            policiesByEndpoint.put(endpoint.subjectKey(), policies);
        }
        return policiesByEndpoint;
    }

    private List<UrlPolicy> endpointPoliciesFor(Fact endpoint, Map<String, List<UrlPolicy>> policiesByEndpoint) {
        return policiesByEndpoint.getOrDefault(endpoint.subjectKey(), List.of());
    }

    private boolean compareUrlMethod(
            Fact endpoint,
            Set<String> endpointRelatedMethods,
            List<Relation> relations,
            UrlAnalysis urlAnalysis,
            List<AdapterDiagnostic> diagnostics
    ) {
        List<UrlPolicy> policies = endpointPoliciesFor(endpoint, urlAnalysis.policiesByEndpoint());
        if (policies.isEmpty()) {
            return urlAnalysis.status() != AnalysisStatus.READY;
        }

        List<Relation> methodRelations = relations.stream()
                .filter(relation -> relation.type() == EdgeType.SECURED_BY
                        && "METHOD".equals(relation.attributes().get("policySource"))
                        && Objects.equals(endpoint.attributes().get("handler"), relation.sourceKey()))
                .toList();
        if (methodRelations.isEmpty()) {
            if (endpointRelatedMethods.isEmpty()) {
                return false;
            }
            diagnostics.add(diagnostic("URL 정책 확인, Method 적용 경로 미확인: " + endpoint.subjectKey()));
            return true;
        }
        boolean uncertain = false;
        for (Relation methodRelation : methodRelations) {
            if (methodRelation.confidence() != Confidence.CONFIRMED) {
                uncertain = true;
                continue;
            }
            for (UrlPolicy policy : policies) {
                if (comparePolicy(policy, methodRelation) == PolicyComparison.UNKNOWN) {
                    uncertain = true;
                }
            }
        }
        if (uncertain) {
            diagnostics.add(diagnostic("URL·Method 정책 의미 비교 불가: " + endpoint.subjectKey()));
            return true;
        }
        return false;
    }

    private PolicyComparison comparePolicy(UrlPolicy policy, Relation methodRelation) {
        String expressionKind = methodRelation.attributes().get("expressionKind");
        Set<String> methodAuthorities = methodAuthorities(methodRelation);
        boolean knownMethodPolicy = expressionKind != null
                && Set.of("SECURED", "ROLES_ALLOWED", "HAS_AUTHORITY", "HAS_ROLE")
                .contains(expressionKind) && !methodAuthorities.isEmpty();
        if (!knownMethodPolicy) {
            return PolicyComparison.UNKNOWN;
        }

        if ("PERMIT_ALL".equals(policy.policyKind()) || "AUTHENTICATED".equals(policy.policyKind())) {
            return methodAuthorities.isEmpty() ? PolicyComparison.MATCH : PolicyComparison.DIFFERENT;
        }
        if (!"AUTHORITY_REQUIRED".equals(policy.policyKind()) || isBlank(policy.requiredAuthority())) {
            return PolicyComparison.UNKNOWN;
        }

        Set<String> urlAuthorities = authorities(policy.requiredAuthority());
        if (urlAuthorities.size() != 1 || methodAuthorities.size() != 1) {
            return PolicyComparison.UNKNOWN;
        }
        return urlAuthorities.equals(methodAuthorities)
                ? PolicyComparison.MATCH : PolicyComparison.DIFFERENT;
    }

    private Set<String> methodAuthorities(Relation methodRelation) {
        Set<String> authorities = authorities(methodRelation.attributes().get("requiredAuthority"));
        if ("HAS_ROLE".equals(methodRelation.attributes().get("expressionKind"))) {
            return authorities.stream()
                    .map(value -> value.startsWith("ROLE_") ? value : "ROLE_" + value)
                    .collect(Collectors.toCollection(LinkedHashSet::new));
        }
        return authorities;
    }

    private Set<String> authorities(String value) {
        if (isBlank(value)) {
            return Set.of();
        }
        return java.util.Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(item -> !item.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private CallPath findCallPath(Fact endpoint, Fact target) {
        HandlerSignature start = parseHandler(endpoint.attributes().get("handler"));
        HandlerSignature expectedTarget = parseHandler(target.attributes().get("handler"));
        if (start == null || expectedTarget == null) {
            return CallPath.none();
        }
        String targetClass = target.attributes().get("targetClass");
        if (isBlank(targetClass)) {
            targetClass = expectedTarget.className();
        }
        Method targetMethod = resolveMethod(expectedTarget);
        if (targetMethod == null) {
            return CallPath.unknown();
        }
        String targetDescriptor = Type.getMethodDescriptor(targetMethod);
        String startDescriptor = descriptor(start);
        if (isBlank(startDescriptor)) {
            return CallPath.unknown();
        }
        Deque<MethodLocation> pending = new ArrayDeque<>();
        pending.add(new MethodLocation(start.className(), start.methodName(), startDescriptor));
        Set<MethodLocation> visited = new LinkedHashSet<>();
        boolean relatedCall = false;
        boolean confirmedCall = false;
        boolean unconfirmedCall = false;
        boolean selfCall = false;
        boolean unknownCall = false;
        String callLocation = null;

        while (!pending.isEmpty()) {
            MethodLocation current = pending.removeFirst();
            if (!visited.add(current) || current.depth() > MAX_CALL_DEPTH) {
                continue;
            }
            List<CallSite> calls = calls(current);
            if (calls == null) {
                return CallPath.unknown();
            }
            for (CallSite call : calls) {
                String ownerClass = call.owner().replace('/', '.');
                if (!sameOrRelatedType(ownerClass, targetClass)) {
                    continue;
                }
                relatedCall = true;
                boolean targetMethodCall = call.name().equals(expectedTarget.methodName())
                        && call.descriptor().equals(targetDescriptor);
                if (targetMethodCall) {
                    if (call.opcode() != Opcodes.INVOKEVIRTUAL && call.opcode() != Opcodes.INVOKEINTERFACE) {
                        unknownCall = true;
                        continue;
                    }
                    callLocation = current.className() + "#" + current.methodName();
                    if (ownerClass.equals(targetClass) && current.className().equals(targetClass)
                            && call.receiver().kind() == ReceiverKind.THIS) {
                        selfCall = true;
                        continue;
                    }
                    if (call.receiver().kind() != ReceiverKind.FIELD) {
                        unknownCall = true;
                        continue;
                    }
                    boolean beanReference = hasBeanReference(
                            current.className().equals(targetClass) ? current.className() : start.className(),
                            targetClass, target.attributes().get("beanName"),
                            call.receiver().fieldName(), call.receiver().fieldOwner());
                    if (beanReference) {
                        confirmedCall = true;
                    } else {
                        unconfirmedCall = true;
                    }
                    continue;
                }
                if (current.depth() < MAX_CALL_DEPTH
                        && !ownerClass.equals(current.className())
                        && (call.opcode() == Opcodes.INVOKEVIRTUAL || call.opcode() == Opcodes.INVOKEINTERFACE)) {
                    pending.addLast(new MethodLocation(ownerClass, call.name(), call.descriptor(), current.depth() + 1));
                }
            }
        }
        if (selfCall && !confirmedCall && !unconfirmedCall && !unknownCall) {
            return new CallPath(CallPathKind.SELF_INVOCATION, callLocation);
        }
        if (unconfirmedCall && !confirmedCall && !selfCall && !unknownCall) {
            return new CallPath(CallPathKind.EXTERNAL_UNCONFIRMED, callLocation);
        }
        if (confirmedCall && !unconfirmedCall && !selfCall && !unknownCall) {
            return new CallPath(CallPathKind.EXTERNAL_CONFIRMED, callLocation);
        }
        return relatedCall || confirmedCall || unconfirmedCall || selfCall || unknownCall
                ? CallPath.unknown() : CallPath.none();
    }

    private List<CallSite> calls(MethodLocation location) {
        String resource = location.className().replace('.', '/') + ".class";
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (loader == null) {
            loader = MethodSecurityAnalysisAdapter.class.getClassLoader();
        }
        try (InputStream input = loader.getResourceAsStream(resource)) {
            if (input == null) {
                return null;
            }
            ClassReader reader = new ClassReader(input);
            List<CallSite> calls = new ArrayList<>();
            reader.accept(new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(int access, String name, String descriptor,
                                                  String signature, String[] exceptions) {
                    if (!name.equals(location.methodName()) || !descriptor.equals(location.descriptor())) {
                        return null;
                    }
                    return new MethodVisitor(Opcodes.ASM9) {
                        private final Deque<ReceiverValue> stack = new ArrayDeque<>();
                        private final Map<Integer, ReceiverValue> locals = new LinkedHashMap<>();

                        {
                            locals.put(0, ReceiverValue.thisValue());
                        }

                        @Override
                        public void visitVarInsn(int opcode, int variable) {
                            if (opcode == Opcodes.ALOAD) {
                                stack.push(locals.getOrDefault(variable, ReceiverValue.unknown()));
                            } else if (opcode == Opcodes.ASTORE) {
                                locals.put(variable, pop());
                            } else if (opcode >= Opcodes.ILOAD && opcode <= Opcodes.DLOAD) {
                                stack.push(ReceiverValue.other());
                            } else if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.DSTORE) {
                                pop();
                            }
                        }

                        @Override
                        public void visitFieldInsn(int opcode, String owner, String name,
                                                   String descriptor) {
                            if (opcode == Opcodes.GETFIELD) {
                                pop();
                                stack.push(ReceiverValue.field(owner, name));
                            } else if (opcode == Opcodes.GETSTATIC) {
                                stack.push(ReceiverValue.other());
                            } else if (opcode == Opcodes.PUTFIELD) {
                                pop();
                                pop();
                            } else if (opcode == Opcodes.PUTSTATIC) {
                                pop();
                            }
                        }

                        @Override
                        public void visitMethodInsn(int opcode, String owner, String name,
                                                    String descriptor, boolean isInterface) {
                            Type[] arguments = Type.getArgumentTypes(descriptor);
                            for (int index = 0; index < arguments.length; index++) {
                                pop();
                            }
                            ReceiverValue receiver = opcode == Opcodes.INVOKESTATIC
                                    ? ReceiverValue.other() : pop();
                            calls.add(new CallSite(opcode, owner, name, descriptor, receiver));
                            if (Type.getReturnType(descriptor).getSort() != Type.VOID) {
                                stack.push(ReceiverValue.other());
                            }
                        }

                        @Override
                        public void visitInsn(int opcode) {
                            switch (opcode) {
                                case Opcodes.ACONST_NULL, Opcodes.ICONST_M1, Opcodes.ICONST_0,
                                        Opcodes.ICONST_1, Opcodes.ICONST_2, Opcodes.ICONST_3,
                                        Opcodes.ICONST_4, Opcodes.ICONST_5, Opcodes.FCONST_0,
                                        Opcodes.FCONST_1, Opcodes.FCONST_2, Opcodes.LCONST_0,
                                        Opcodes.LCONST_1, Opcodes.DCONST_0, Opcodes.DCONST_1 ->
                                        stack.push(ReceiverValue.other());
                                case Opcodes.POP, Opcodes.POP2 -> pop();
                                case Opcodes.DUP -> {
                                    ReceiverValue value = pop();
                                    stack.push(value);
                                    stack.push(value);
                                }
                                case Opcodes.SWAP -> {
                                    ReceiverValue first = pop();
                                    ReceiverValue second = pop();
                                    stack.push(first);
                                    stack.push(second);
                                }
                                default -> stack.clear();
                            }
                        }

                        @Override
                        public void visitIntInsn(int opcode, int operand) {
                            if (opcode == Opcodes.NEWARRAY) {
                                pop();
                            }
                            stack.push(ReceiverValue.other());
                        }

                        @Override
                        public void visitTypeInsn(int opcode, String type) {
                            if (opcode == Opcodes.CHECKCAST) {
                                ReceiverValue value = pop();
                                stack.push(value);
                            } else if (opcode == Opcodes.ANEWARRAY) {
                                pop();
                                stack.push(ReceiverValue.other());
                            } else {
                                stack.push(ReceiverValue.other());
                            }
                        }

                        @Override
                        public void visitLdcInsn(Object value) {
                            stack.push(ReceiverValue.other());
                        }

                        @Override
                        public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
                            stack.clear();
                        }

                        @Override
                        public void visitMultiANewArrayInsn(String descriptor, int dimensions) {
                            for (int index = 0; index < dimensions; index++) {
                                pop();
                            }
                            stack.push(ReceiverValue.other());
                        }

                        private ReceiverValue pop() {
                            return stack.isEmpty() ? ReceiverValue.unknown() : stack.pop();
                        }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            return calls;
        } catch (IOException | RuntimeException exception) {
            return null;
        }
    }

    private boolean sameOrRelatedType(String ownerClass, String targetClass) {
        if (ownerClass.equals(targetClass)) {
            return true;
        }
        try {
            Class<?> owner = Class.forName(ownerClass, false, classLoader());
            Class<?> target = Class.forName(targetClass, false, classLoader());
            return owner.isAssignableFrom(target) || target.isAssignableFrom(owner);
        } catch (ClassNotFoundException | LinkageError | SecurityException exception) {
            return false;
        }
    }

    private boolean hasBeanReference(
            String sourceClass,
            String targetClass,
            String beanName,
            String receiverFieldName,
            String receiverFieldOwner
    ) {
        if (isBlank(beanName) || isBlank(receiverFieldName) || isBlank(receiverFieldOwner)
                || !beanName.equals(receiverFieldName)) {
            return false;
        }
        try {
            Class<?> source = Class.forName(sourceClass, false, classLoader());
            Class<?> target = Class.forName(targetClass, false, classLoader());
            Class<?> fieldOwner = Class.forName(receiverFieldOwner.replace('/', '.'), false, classLoader());
            if (!fieldOwner.isAssignableFrom(source)) {
                return false;
            }
            java.lang.reflect.Field field = findField(source, receiverFieldName);
            if (field == null || !relatedTypes(field.getType(), target)) {
                return false;
            }
            return constructorAssignsParameter(sourceClass, receiverFieldName, field.getType());
        } catch (ClassNotFoundException | LinkageError | SecurityException exception) {
            return false;
        }
    }

    private java.lang.reflect.Field findField(Class<?> source, String name) {
        Class<?> current = source;
        while (current != null && current != Object.class) {
            try {
                return current.getDeclaredField(name);
            } catch (NoSuchFieldException exception) {
                current = current.getSuperclass();
            }
        }
        return null;
    }

    // 제한된 생성자 주입 패턴만 Bean Receiver 근거로 인정
    private boolean constructorAssignsParameter(String sourceClass, String fieldName, Class<?> fieldType) {
        String resource = sourceClass.replace('.', '/') + ".class";
        ClassLoader loader = classLoader();
        try (InputStream input = loader.getResourceAsStream(resource)) {
            if (input == null) {
                return false;
            }
            String fieldDescriptor = Type.getDescriptor(fieldType);
            boolean[] assigned = {false};
            new ClassReader(input).accept(new ClassVisitor(Opcodes.ASM9) {
                @Override
                public MethodVisitor visitMethod(int access, String name, String descriptor,
                                                  String signature, String[] exceptions) {
                    if (!"<init>".equals(name)) {
                        return null;
                    }
                    Type[] arguments = Type.getArgumentTypes(descriptor);
                    return new MethodVisitor(Opcodes.ASM9) {
                        private int lastParameter = -1;

                        @Override
                        public void visitVarInsn(int opcode, int variable) {
                            lastParameter = opcode == Opcodes.ALOAD
                                    && parameterDescriptor(arguments, variable, fieldDescriptor) ? variable : -1;
                        }

                        @Override
                        public void visitTypeInsn(int opcode, String type) {
                            lastParameter = -1;
                        }

                        @Override
                        public void visitMethodInsn(int opcode, String owner, String name,
                                                    String descriptor, boolean isInterface) {
                            lastParameter = -1;
                        }

                        @Override
                        public void visitFieldInsn(int opcode, String owner, String name,
                                                   String descriptor) {
                            if (opcode == Opcodes.PUTFIELD && fieldName.equals(name)
                                    && fieldDescriptor.equals(descriptor) && lastParameter >= 0) {
                                assigned[0] = true;
                            }
                            lastParameter = -1;
                        }

                        @Override
                        public void visitInsn(int opcode) {
                            if (opcode != Opcodes.NOP) {
                                lastParameter = -1;
                            }
                        }
                    };
                }
            }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
            return assigned[0];
        } catch (IOException | RuntimeException exception) {
            return false;
        }
    }

    private boolean parameterDescriptor(Type[] arguments, int variable, String fieldDescriptor) {
        int local = 1;
        for (Type argument : arguments) {
            if (local == variable) {
                return fieldDescriptor.equals(argument.getDescriptor());
            }
            local += argument.getSize();
        }
        return false;
    }

    private boolean relatedTypes(Class<?> first, Class<?> second) {
        return first.equals(second) || first.isAssignableFrom(second) || second.isAssignableFrom(first);
    }

    private Method resolveMethod(HandlerSignature signature) {
        try {
            Class<?> type = Class.forName(signature.className(), false, classLoader());
            Class<?>[] parameterTypes = signature.parameterTypes().stream()
                    .map(this::resolveType)
                    .toArray(Class<?>[]::new);
            for (Method method : type.getMethods()) {
                if (method.getName().equals(signature.methodName())
                        && java.util.Arrays.equals(method.getParameterTypes(), parameterTypes)) {
                    return method;
                }
            }
        } catch (ClassNotFoundException | LinkageError | IllegalArgumentException | SecurityException exception) {
            return null;
        }
        return null;
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
                default -> Class.forName(name, false, classLoader());
            };
        } catch (ClassNotFoundException exception) {
            throw new IllegalArgumentException("Type 해석 실패: " + name, exception);
        }
    }

    private String descriptor(HandlerSignature signature) {
        Method method = resolveMethod(signature);
        return method == null ? "" : Type.getMethodDescriptor(method);
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
        List<String> parameterTypes = parameters.isBlank()
                ? List.of()
                : List.of(parameters.split(",", -1));
        return new HandlerSignature(value.substring(0, separator), value.substring(separator + 1, open), parameterTypes);
    }

    private Relation relation(String serviceId, Fact endpoint, Fact method,
                              String invocationKind, String codeEvidenceId) {
        return relation(serviceId, endpoint, method, invocationKind, codeEvidenceId,
                Confidence.CONFIRMED, "CONFIRMED");
    }

    private Relation relation(String serviceId, Fact endpoint, Fact method,
                              String invocationKind, String codeEvidenceId,
                              Confidence confidence, String proxyApplicability) {
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("securityKind", "AUTHORIZATION");
        attributes.put("policySource", "METHOD");
        attributes.put("annotationType", method.attributes().get("annotationType"));
        attributes.put("invocationKind", invocationKind);
        attributes.put("proxyApplicability", proxyApplicability);
        if (method.attributes().get("expressionKind") != null) {
            attributes.put("expressionKind", method.attributes().get("expressionKind"));
        }
        if (method.attributes().get("requiredAuthority") != null) {
            attributes.put("requiredAuthority", method.attributes().get("requiredAuthority"));
        }
        if (method.attributes().get("methodSecurityInfrastructure") != null) {
            attributes.put("methodSecurityInfrastructure", method.attributes().get("methodSecurityInfrastructure"));
        }
        String sourceKey = endpoint.attributes().get("handler");
        String sourceId = idGenerator.generate(serviceId, NodeType.HANDLER, sourceKey);
        String targetId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, method.subjectKey());
        Map<String, String> identity = Map.of("securityKind", "AUTHORIZATION", "policySource", "METHOD");
        String id = idGenerator.generateEdge(sourceId, targetId, EdgeType.SECURED_BY, identity);
        Set<String> evidenceIds = new TreeSet<>();
        evidenceIds.addAll(endpoint.evidenceIds());
        evidenceIds.addAll(method.evidenceIds());
        if (codeEvidenceId != null) {
            evidenceIds.add(codeEvidenceId);
        }
        return new Relation(id, sourceKey, method.subjectKey(), EdgeType.SECURED_BY,
                attributes, confidence, List.copyOf(evidenceIds));
    }

    private Evidence codeEvidence(String serviceId, Fact endpoint, Fact method, String location) {
        String key = "evidence|call|" + endpoint.subjectKey() + "|" + method.subjectKey();
        String id = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, key);
        return new Evidence(id, EvidenceSource.CODE_PATTERN, location,
                "Endpoint Handler 호출 명령·Bean 이름·Method Security Fact 일치; Receiver 런타임 Bean 동일성 미확인");
    }

    private RelationAggregation aggregateRelations(
            List<Relation> relations, List<AdapterDiagnostic> diagnostics) {
        Map<String, Relation> byId = new TreeMap<>();
        Set<String> conflictingIds = new LinkedHashSet<>();
        boolean partial = false;
        for (Relation relation : relations) {
            if (conflictingIds.contains(relation.id())) {
                continue;
            }
            Relation existing = byId.get(relation.id());
            if (existing == null) {
                byId.put(relation.id(), relation);
                continue;
            }
            if (!sameStructure(existing, relation)) {
                partial = true;
                diagnostics.add(diagnostic("Method SECURED_BY 구조 불일치로 병합 불가: " + relation.id()));
                conflictingIds.add(relation.id());
                byId.remove(relation.id());
                continue;
            }
            Set<String> evidenceIds = new TreeSet<>(existing.evidenceIds());
            evidenceIds.addAll(relation.evidenceIds());
            byId.put(relation.id(), new Relation(existing.id(), existing.sourceKey(), existing.targetKey(),
                    existing.type(), existing.attributes(), existing.confidence(), List.copyOf(evidenceIds)));
        }
        return new RelationAggregation(List.copyOf(byId.values()), partial);
    }

    private boolean sameStructure(Relation first, Relation second) {
        return first.sourceKey().equals(second.sourceKey())
                && first.targetKey().equals(second.targetKey())
                && first.type() == second.type()
                && first.attributes().equals(second.attributes())
                && first.confidence() == second.confidence();
    }

    private AnalysisResult unknown(String summary) {
        return result(List.of(), AnalysisStatus.UNKNOWN, List.of(diagnostic(summary)));
    }

    private AnalysisResult result(List<Relation> relations, AnalysisStatus status,
                                 List<AdapterDiagnostic> diagnostics) {
        return result(relations, status, diagnostics, List.of());
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
        return loader == null ? MethodSecurityAnalysisAdapter.class.getClassLoader() : loader;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private enum Applicability {
        CONFIRMED,
        UNKNOWN
    }

    private enum PolicyComparison {
        MATCH,
        DIFFERENT,
        UNKNOWN
    }

    private record UrlAnalysis(AnalysisStatus status, Map<String, List<UrlPolicy>> policiesByEndpoint) {
    }

    private record UrlPolicy(
            String targetKey,
            String policyKind,
            String requiredAuthority,
            String authorityOperator,
            List<String> evidenceIds
    ) {
    }

    private record HandlerSignature(String className, String methodName, List<String> parameterTypes) {
    }

    private record MethodLocation(String className, String methodName, String descriptor, int depth) {
        private MethodLocation(String className, String methodName, String descriptor) {
            this(className, methodName, descriptor, 0);
        }
    }

    private record CallSite(
            int opcode,
            String owner,
            String name,
            String descriptor,
            ReceiverValue receiver
    ) {
    }

    private record ReceiverValue(ReceiverKind kind, String fieldOwner, String fieldName) {
        private static ReceiverValue thisValue() {
            return new ReceiverValue(ReceiverKind.THIS, null, null);
        }

        private static ReceiverValue field(String owner, String name) {
            return new ReceiverValue(ReceiverKind.FIELD, owner, name);
        }

        private static ReceiverValue other() {
            return new ReceiverValue(ReceiverKind.OTHER, null, null);
        }

        private static ReceiverValue unknown() {
            return new ReceiverValue(ReceiverKind.UNKNOWN, null, null);
        }
    }

    private enum ReceiverKind {
        THIS,
        FIELD,
        OTHER,
        UNKNOWN
    }

    private record CallPath(CallPathKind kind, String location) {
        private static CallPath none() {
            return new CallPath(CallPathKind.NONE, null);
        }

        private static CallPath unknown() {
            return new CallPath(CallPathKind.UNKNOWN, null);
        }
    }

    private enum CallPathKind {
        NONE,
        EXTERNAL_CONFIRMED,
        EXTERNAL_UNCONFIRMED,
        SELF_INVOCATION,
        UNKNOWN
    }

    private record RelationAggregation(List<Relation> relations, boolean partial) {
    }
}
