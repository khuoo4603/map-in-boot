package com.mapinboot.security.collector;

import com.mapinboot.core.annotation.RequiresObjectAuthorization;
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
import java.io.IOException;
import java.io.InputStream;
import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

// 객체 조회·주체 비교·거부 분기의 코드 근거 수집
public class ObjectAuthorizationCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "OBJECT_AUTHORIZATION";
    private static final String REQUIREMENT_TYPE = "OBJECT_AUTHORIZATION_REQUIREMENT";
    private static final String ACCESS_PATH_TYPE = "OBJECT_ACCESS_PATH";
    private static final String JWT = "org/springframework/security/oauth2/jwt/Jwt";
    private static final String AUTHENTICATION = "org/springframework/security/core/Authentication";
    private static final String OPTIONAL = "java/util/Optional";
    private static final String RESPONSE_ENTITY = "org/springframework/http/ResponseEntity";
    private static final String HTTP_STATUS = "org/springframework/http/HttpStatus";
    private static final int MAX_HELPER_DEPTH = 2;

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public ObjectAuthorizationCollectorAdapter() {
        super("security-object-authorization", "객체 Owner 비교·거부 구조 수집",
                Set.of(TYPE, REQUIREMENT_TYPE, ACCESS_PATH_TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("객체 인가 수집 실행 문맥 또는 서비스 식별자 부족");
        }

        ApplicationClassDiscovery.Discovery discovery;
        try {
            discovery = ApplicationClassDiscovery.discover(
                    context.applicationContext(), id(), "객체 인가 후보");
        } catch (RuntimeException exception) {
            return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                    List.of(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED, "객체 인가 후보 탐색 실패")));
        }

        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(discovery.diagnostics());
        boolean partial = discovery.partial();

        for (Class<?> targetClass : ApplicationClassDiscovery.sortedClasses(discovery.targetClasses())) {
            if (ApplicationClassDiscovery.isFrameworkClass(targetClass)) {
                continue;
            }
            for (Method method : endpointMethods(targetClass)) {
                String handler = handler(targetClass, method);
                String location = location(targetClass, method);
                RequiresObjectAuthorization requirement = method.getDeclaredAnnotation(
                        RequiresObjectAuthorization.class);
                String requirementKey = null;
                if (requirement != null) {
                    requirementKey = addRequirement(
                            context.serviceId(), handler, method, requirement, facts, evidence, diagnostics);
                    if (requirementKey == null) {
                        partial = true;
                    }
                }
                ScanOutcome outcome = new BytecodeAnalyzer(targetClass).scan(
                        method, parameterOrigins(method, location), List.of(), 0, new HashSet<>());
                if (!outcome.available()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "객체 인가 Bytecode 조회 불가: " + location));
                    continue;
                }
                if (outcome.uncertain()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "객체 인가 호출 경로 일부 미지원: " + location));
                }
                for (Check check : outcome.checks().stream()
                        .filter(Check::denied)
                        .sorted(Comparator.comparing(Check::location).thenComparing(Check::kind))
                        .toList()) {
                    addFact(context.serviceId(), handler, check, facts, evidence);
                }
                if (requirementKey != null) {
                    PathOutcome pathOutcome = pathOutcome(outcome, requirement);
                    if (pathOutcome != null) {
                        addAccessPath(context.serviceId(), handler, requirementKey, requirement,
                                pathOutcome, outcome, facts, evidence);
                    }
                }
            }
        }

        facts.sort(Comparator.comparing(Fact::subjectKey));
        evidence.sort(Comparator.comparing(Evidence::id));
        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    private String addRequirement(
            String serviceId,
            String handler,
            Method method,
            RequiresObjectAuthorization requirement,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        if (!Set.of("OWNER", "ASSIGNMENT").contains(requirement.kind())
                || !Set.of("JWT_SUBJECT", "AUTHENTICATION_NAME", "REQUEST_HEADER")
                .contains(requirement.principalSource())) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "지원하지 않는 객체 인가 요구 선언: " + handler));
            return null;
        }
        String declaringMethod = method.getDeclaringClass().getName() + "#" + method.getName()
                + Type.getMethodDescriptor(method);
        String resourceType = requirement.resourceType().getName();
        String subjectKey = "object-authorization-requirement|" + handler + "|"
                + requirement.kind() + "|" + resourceType + "|" + requirement.principalSource();
        String evidenceId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("handler", handler);
        attributes.put("declaringMethod", declaringMethod);
        attributes.put("requirementKind", requirement.kind());
        attributes.put("resourceType", resourceType);
        attributes.put("principalSource", requirement.principalSource());
        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "fact|" + subjectKey),
                REQUIREMENT_TYPE, subjectKey, attributes, List.of(evidenceId)));
        evidence.add(new Evidence(evidenceId, EvidenceSource.DECLARATION, declaringMethod,
                "객체 인가 요구 선언"));
        return subjectKey;
    }

    private void addAccessPath(
            String serviceId,
            String handler,
            String requirementKey,
            RequiresObjectAuthorization requirement,
            PathOutcome pathOutcome,
            ScanOutcome outcome,
            List<Fact> facts,
            List<Evidence> evidence
    ) {
        String resourceType = requirement.resourceType().getName();
        String codeLocation = pathOutcome.location();
        String subjectKey = "object-access-path|" + handler + "|" + requirementKey + "|"
                + codeLocation + "|" + pathOutcome.outcome();
        String evidenceId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("handler", handler);
        attributes.put("codeLocation", codeLocation);
        attributes.put("resourceType", resourceType);
        attributes.put("requirementKey", requirementKey);
        attributes.put("pathOutcome", pathOutcome.outcome());
        attributes.put("coverage", outcome.uncertain() ? "INCOMPLETE" : "COMPLETE_SUPPORTED_PATH");
        attributes.put("principalSource", pathOutcome.source());
        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "fact|" + subjectKey),
                ACCESS_PATH_TYPE, subjectKey, attributes, List.of(evidenceId)));
        evidence.add(new Evidence(evidenceId, EvidenceSource.CODE_PATTERN, codeLocation,
                "객체 접근 경로와 인가 결과 확인"));
    }

    private PathOutcome pathOutcome(ScanOutcome outcome, RequiresObjectAuthorization requirement) {
        String resourceType = requirement.resourceType().getName();
        List<Check> checks = outcome.checks().stream()
                .filter(check -> resourceType.equals(check.resourceType())
                        || ("ASSIGNMENT_DENY".equals(check.kind()) && check.resourceType() == null))
                .toList();
        if (!outcome.accesses().contains(resourceType)) {
            return null;
        }
        String location = outcome.accessLocations().stream().findFirst().orElse("unknown");
        if (!outcome.protectedAccesses().contains(resourceType)) {
            return outcome.uncertain()
                    ? new PathOutcome("UNRESOLVED", location, requirement.principalSource())
                    : null;
        }
        if (outcome.uncertain()) {
            return new PathOutcome("UNRESOLVED", location, requirement.principalSource());
        }
        Check matching = checks.stream()
                .filter(check -> requirement.principalSource().equals(check.source().kind()))
                .findFirst()
                .orElse(null);
        if (matching != null) {
            return new PathOutcome("GUARDED", matching.location(), matching.source().kind());
        }
        Check mismatched = checks.stream().findFirst().orElse(null);
        if (mismatched != null) {
            return new PathOutcome("SOURCE_MISMATCH", mismatched.location(), mismatched.source().kind());
        }
        return new PathOutcome("UNGUARDED", location, requirement.principalSource());
    }

    private void addFact(
            String serviceId,
            String handler,
            Check check,
            List<Fact> facts,
            List<Evidence> evidence
    ) {
        String subjectKey = "object-authorization|" + handler + "|" + check.location()
                + "|" + check.kind() + "|" + check.source().kind();
        String evidenceId = idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("codeLocation", check.location());
        attributes.put("checkKind", check.kind());
        attributes.put("handler", handler);
        attributes.put("credentialSource", check.source().kind());
        if (check.source().codeLocation() != null) {
            attributes.put("credentialCodeLocation", check.source().codeLocation());
        }
        if (check.source().owner() != null) {
            attributes.put("credentialApiOwner", check.source().owner().replace('/', '.'));
            attributes.put("credentialApiName", check.source().name());
            attributes.put("credentialApiDescriptor", check.source().descriptor());
        }
        if (check.ownerGetter() != null) {
            attributes.put("ownerGetter", check.ownerGetter());
        }
        if (check.repositoryCall() != null) {
            attributes.put("objectLookup", check.repositoryCall());
        }
        if (check.source().headerName() != null) {
            attributes.put("headerName", check.source().headerName());
        }

        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "fact|" + subjectKey),
                TYPE,
                subjectKey,
                attributes,
                List.of(evidenceId)));
        evidence.add(new Evidence(
                evidenceId,
                EvidenceSource.CODE_PATTERN,
                check.location(),
                "객체 인가 비교와 불일치 거부 경로 확인"));
    }

    private List<Method> endpointMethods(Class<?> targetClass) {
        return Arrays.stream(targetClass.getDeclaredMethods())
                .filter(method -> !method.isBridge() && !method.isSynthetic())
                .filter(this::isEndpointMethod)
                .sorted(Comparator.comparing(method -> location(targetClass, method)))
                .toList();
    }

    private boolean isEndpointMethod(Method method) {
        for (Annotation annotation : method.getDeclaredAnnotations()) {
            if (isRequestMapping(annotation.annotationType(), new HashSet<>())) {
                return true;
            }
        }
        return false;
    }

    private boolean isRequestMapping(Class<? extends Annotation> annotationType, Set<Class<?>> visited) {
        if (!visited.add(annotationType)) {
            return false;
        }
        if ("org.springframework.web.bind.annotation.RequestMapping".equals(annotationType.getName())) {
            return true;
        }
        return Arrays.stream(annotationType.getDeclaredAnnotations())
                .map(Annotation::annotationType)
                .anyMatch(meta -> isRequestMapping(meta, visited));
    }

    private List<Value> parameterOrigins(Method method, String location) {
        List<Value> origins = new ArrayList<>();
        for (Parameter parameter : method.getParameters()) {
            String typeName = parameter.getType().getName();
            String headerName = headerName(parameter);
            if (headerName != null) {
                origins.add(Value.header(new SourceRef(
                        "REQUEST_HEADER", location, null, null, null, headerName)));
            } else if (JWT.replace('/', '.').equals(typeName)) {
                origins.add(Value.jwt());
            } else if (AUTHENTICATION.replace('/', '.').equals(typeName)) {
                origins.add(Value.authentication());
            } else {
                origins.add(Value.input());
            }
        }
        return List.copyOf(origins);
    }

    private String headerName(Parameter parameter) {
        for (Annotation annotation : parameter.getDeclaredAnnotations()) {
            if (!"org.springframework.web.bind.annotation.RequestHeader".equals(annotation.annotationType().getName())) {
                continue;
            }
            String name = annotationValue(annotation, "name");
            if (isBlank(name)) {
                name = annotationValue(annotation, "value");
            }
            return isBlank(name) ? null : name;
        }
        return null;
    }

    private String annotationValue(Annotation annotation, String name) {
        try {
            Object value = annotation.annotationType().getMethod(name).invoke(annotation);
            return value instanceof String string ? string : null;
        } catch (ReflectiveOperationException | RuntimeException exception) {
            return null;
        }
    }

    private String handler(Class<?> targetClass, Method method) {
        return targetClass.getName() + "#" + method.getName() + "("
                + Arrays.stream(method.getParameterTypes()).map(Class::getName).collect(Collectors.joining(",")) + ")";
    }

    private String location(Class<?> targetClass, Method method) {
        return targetClass.getName() + "#" + method.getName() + Type.getMethodDescriptor(method);
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record SourceRef(
            String kind,
            String codeLocation,
            String owner,
            String name,
            String descriptor,
            String headerName
    ) {
        private static SourceRef jwt(String location, String owner, String name, String descriptor) {
            return new SourceRef("JWT_SUBJECT", location, owner, name, descriptor, null);
        }

        private static SourceRef authentication(String location, String owner, String name, String descriptor) {
            return new SourceRef("AUTHENTICATION_NAME", location, owner, name, descriptor, null);
        }
    }

    private record Check(
            String kind,
            String location,
            SourceRef source,
            String ownerGetter,
            String repositoryCall,
            String resourceType,
            boolean denied
    ) {
    }

    private record PathOutcome(String outcome, String location, String source) {
    }

    private record ScanOutcome(
            boolean available,
            boolean uncertain,
            List<Check> checks,
            Set<String> accesses,
            Set<String> accessLocations,
            Set<String> protectedAccesses
    ) {
        private ScanOutcome {
            checks = List.copyOf(checks);
            accesses = Set.copyOf(accesses);
            accessLocations = Set.copyOf(accessLocations);
            protectedAccesses = Set.copyOf(protectedAccesses);
        }

        private static ScanOutcome unavailable() {
            return new ScanOutcome(false, true, List.of(), Set.of(), Set.of(), Set.of());
        }
    }

    private enum ValueKind {
        UNKNOWN,
        INPUT,
        JWT,
        AUTHENTICATION,
        HEADER,
        OPTIONAL,
        OBJECT,
        OWNER,
        SUBJECT,
        CHECK,
        FORBIDDEN,
        THIS,
        OTHER
    }

    private record Value(
            ValueKind kind,
            SourceRef source,
            String ownerGetter,
            String repositoryCall,
            CheckCandidate candidate,
            Integer integer,
            String resourceType
    ) {
        private static Value unknown() {
            return new Value(ValueKind.UNKNOWN, null, null, null, null, null, null);
        }

        private static Value input() {
            return new Value(ValueKind.INPUT, null, null, null, null, null, null);
        }

        private static Value jwt() {
            return new Value(ValueKind.JWT, null, null, null, null, null, null);
        }

        private static Value authentication() {
            return new Value(ValueKind.AUTHENTICATION, null, null, null, null, null, null);
        }

        private static Value header(SourceRef source) {
            return new Value(ValueKind.HEADER, source, null, null, null, null, null);
        }

        private static Value optional(String call) {
            return new Value(ValueKind.OPTIONAL, null, null, call, null, null, null);
        }

        private static Value object(String call) {
            return new Value(ValueKind.OBJECT, null, null, call, null, null, null);
        }

        private static Value owner(Value object, String getter) {
            return new Value(ValueKind.OWNER, null, getter, object.repositoryCall(), null, null,
                    object.resourceType());
        }

        private static Value subject(SourceRef source) {
            return new Value(ValueKind.SUBJECT, source, null, null, null, null, null);
        }

        private static Value check(CheckCandidate candidate) {
            return new Value(ValueKind.CHECK, null, null, null, candidate, null,
                    candidate.resourceType());
        }

        private static Value forbidden() {
            return new Value(ValueKind.FORBIDDEN, null, null, null, null, null, null);
        }

        private static Value thisValue() {
            return new Value(ValueKind.THIS, null, null, null, null, null, null);
        }

        private static Value other() {
            return new Value(ValueKind.OTHER, null, null, null, null, null, null);
        }

        private static Value derived(Value source) {
            return new Value(ValueKind.OTHER, null, source.ownerGetter(), source.repositoryCall(),
                    null, null, source.resourceType());
        }

        private static Value integer(int value) {
            return new Value(ValueKind.OTHER, null, null, null, null, value, null);
        }

        private Value withResourceType(String type) {
            return new Value(kind, source, ownerGetter, repositoryCall, candidate, integer,
                    type == null || type.isBlank() ? resourceType : type.replace('/', '.'));
        }
    }

    private record CheckCandidate(
            String kind,
            String location,
            SourceRef source,
            String ownerGetter,
            String repositoryCall,
            String resourceType
    ) {
    }

    private record Branch(CheckCandidate candidate, int opcode, Label target, int eventIndex) {
    }

    private record Instruction(
            int opcode,
            Label target,
            boolean denial,
            boolean terminal
    ) {
    }

    private final class BytecodeAnalyzer {
        private final Class<?> targetClass;

        private BytecodeAnalyzer(Class<?> targetClass) {
            this.targetClass = targetClass;
        }

        private ScanOutcome scan(
                Method method,
                List<Value> parameterOrigins,
                List<Value> ignored,
                int depth,
                Set<String> visited
        ) {
            String descriptor = Type.getMethodDescriptor(method);
            String key = method.getName() + descriptor + "|"
                    + parameterOrigins.stream().map(value -> value.kind().name()).collect(Collectors.joining(","));
            if (!visited.add(key) || depth > MAX_HELPER_DEPTH) {
                return new ScanOutcome(true, true, List.of(), Set.of(), Set.of(), Set.of());
            }

            String resourceName = targetClass.getName().replace('.', '/') + ".class";
            ClassLoader classLoader = targetClass.getClassLoader();
            InputStream input = classLoader == null
                    ? ClassLoader.getSystemResourceAsStream(resourceName)
                    : classLoader.getResourceAsStream(resourceName);
            if (input == null) {
                return ScanOutcome.unavailable();
            }
            try (input) {
                MethodBytecodeVisitor visitor = new MethodBytecodeVisitor(
                        targetClass, method, parameterOrigins, depth, visited);
                new ClassReader(input).accept(visitor, ClassReader.SKIP_FRAMES);
                return visitor.result();
            } catch (IOException | RuntimeException exception) {
                return ScanOutcome.unavailable();
            }
        }

        private Method resolveMethod(String owner, String name, String descriptor) {
            if (!owner.equals(targetClass.getName().replace('.', '/')) || name.startsWith("<")) {
                return null;
            }
            for (Method candidate : targetClass.getDeclaredMethods()) {
                if (candidate.getName().equals(name) && Type.getMethodDescriptor(candidate).equals(descriptor)) {
                    return candidate;
                }
            }
            return null;
        }

        private final class MethodBytecodeVisitor extends ClassVisitor {
            private final Class<?> ownerClass;
            private final Method method;
            private final List<Value> parameterOrigins;
            private final int depth;
            private final Set<String> visited;
            private final List<CheckCandidate> candidates = new ArrayList<>();
            private final List<Check> nestedChecks = new ArrayList<>();
            private final List<Branch> branches = new ArrayList<>();
            private final List<Instruction> instructions = new ArrayList<>();
            private final Set<String> accessedTypes = new LinkedHashSet<>();
            private final Set<String> accessLocations = new LinkedHashSet<>();
            private final Set<String> protectedAccessTypes = new LinkedHashSet<>();
            private final Map<Label, Integer> labels = new HashMap<>();
            private boolean found;
            private boolean uncertain;
            private boolean denialConstructed;

            private MethodBytecodeVisitor(
                    Class<?> ownerClass,
                    Method method,
                    List<Value> parameterOrigins,
                    int depth,
                    Set<String> visited
            ) {
                super(Opcodes.ASM9);
                this.ownerClass = ownerClass;
                this.method = method;
                this.parameterOrigins = parameterOrigins;
                this.depth = depth;
                this.visited = visited;
            }

            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                if (!method.getName().equals(name) || !Type.getMethodDescriptor(method).equals(descriptor)) {
                    return null;
                }
                found = true;
                return new UsageMethodVisitor(access, descriptor);
            }

            private ScanOutcome result() {
                if (!found) {
                    return ScanOutcome.unavailable();
                }
                List<Check> checks = new ArrayList<>();
                for (Branch branch : branches) {
                    if (!mismatchBranchHasDenial(branch)) {
                        continue;
                    }
                    CheckCandidate candidate = branch.candidate();
                    checks.add(new Check(candidate.kind(), candidate.location(), candidate.source(),
                            candidate.ownerGetter(), candidate.repositoryCall(), candidate.resourceType(), true));
                }
                checks.addAll(nestedChecks);
                boolean effectiveDenial = instructions.stream().anyMatch(Instruction::denial);
                return new ScanOutcome(true, uncertain || (denialConstructed && !effectiveDenial),
                        checks, accessedTypes, accessLocations, protectedAccessTypes);
            }

            private boolean mismatchBranchHasDenial(Branch branch) {
                Integer targetIndex = labels.get(branch.target());
                if (targetIndex == null) {
                    return false;
                }
                int mismatchStart = branch.opcode() == Opcodes.IFEQ
                        ? targetIndex
                        : branch.eventIndex() + 1;
                return reachesDenial(mismatchStart);
            }

            private boolean reachesDenial(int start) {
                if (start < 0 || start >= instructions.size()) {
                    return false;
                }
                Deque<Integer> pending = new ArrayDeque<>();
                Set<Integer> visited = new HashSet<>();
                pending.add(start);
                while (!pending.isEmpty()) {
                    int index = pending.removeFirst();
                    if (index < 0 || index >= instructions.size() || !visited.add(index)) {
                        continue;
                    }
                    Instruction instruction = instructions.get(index);
                    if (instruction.denial()) {
                        return true;
                    }
                    if (instruction.terminal()) {
                        continue;
                    }
                    if (instruction.opcode() == Opcodes.GOTO || instruction.opcode() == Opcodes.JSR) {
                        Integer target = labels.get(instruction.target());
                        if (target != null) {
                            pending.add(target);
                        }
                        continue;
                    }
                    if (isConditional(instruction.opcode())) {
                        Integer target = labels.get(instruction.target());
                        if (target != null) {
                            pending.add(target);
                        }
                        pending.add(index + 1);
                        continue;
                    }
                    pending.add(index + 1);
                }
                return false;
            }

            private boolean isConditional(int opcode) {
                return (opcode >= Opcodes.IFEQ && opcode <= Opcodes.IF_ACMPNE)
                        || opcode == Opcodes.IFNULL || opcode == Opcodes.IFNONNULL;
            }

            private final class UsageMethodVisitor extends MethodVisitor {
                private final Deque<Value> stack = new ArrayDeque<>();
                private final Map<Integer, Value> locals = new LinkedHashMap<>();
                private final String methodDescriptor;
                private int eventIndex;

                private UsageMethodVisitor(int access, String methodDescriptor) {
                    super(Opcodes.ASM9);
                    this.methodDescriptor = methodDescriptor;
                    initializeLocals(access);
                }

                private void initializeLocals(int access) {
                    int local = Modifier.isStatic(access) ? 0 : 1;
                    if (!Modifier.isStatic(access)) {
                        locals.put(0, Value.thisValue());
                    }
                    Type[] parameters = Type.getArgumentTypes(methodDescriptor);
                    for (int index = 0; index < parameters.length; index++) {
                        Value value = index < parameterOrigins.size() ? parameterOrigins.get(index) : Value.other();
                        locals.put(local, value);
                        local += parameters[index].getSize();
                    }
                }

                @Override
                public void visitLabel(Label label) {
                    labels.put(label, instructions.size());
                    addInstruction(Opcodes.NOP, null, false, false);
                }

                @Override
                public void visitVarInsn(int opcode, int variable) {
                    if (opcode == Opcodes.ALOAD || opcode == Opcodes.ILOAD) {
                        stack.push(locals.getOrDefault(variable, Value.unknown()));
                    } else if (opcode == Opcodes.ASTORE || opcode == Opcodes.ISTORE) {
                        locals.put(variable, popValue());
                    } else if (opcode >= Opcodes.LSTORE && opcode <= Opcodes.DSTORE) {
                        locals.put(variable, popValue());
                    } else if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.ASTORE) {
                        locals.put(variable, popValue());
                    } else if (opcode >= Opcodes.ILOAD && opcode <= Opcodes.ALOAD) {
                        stack.push(locals.getOrDefault(variable, Value.unknown()));
                    } else {
                        uncertain = true;
                        stack.push(Value.unknown());
                    }
                    addInstruction(opcode, null, false, false);
                }

                @Override
                public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                    boolean denial = opcode == Opcodes.GETSTATIC
                            && HTTP_STATUS.equals(owner) && "FORBIDDEN".equals(name);
                    if (opcode == Opcodes.GETFIELD) {
                        popValue();
                        stack.push(Value.other());
                    } else if (opcode == Opcodes.GETSTATIC) {
                        stack.push(denial ? Value.forbidden() : Value.other());
                    } else if (opcode == Opcodes.PUTFIELD) {
                        popValue();
                        popValue();
                    } else {
                        popValue();
                    }
                    addInstruction(opcode, null, false, false);
                }

                @Override
                public void visitMethodInsn(int opcode, String owner, String name, String descriptor,
                                            boolean isInterface) {
                    List<Value> arguments = arguments(descriptor);
                    Value receiver = opcode == Opcodes.INVOKESTATIC ? Value.other() : popValue();
                    for (Value value : arguments) {
                        recordAccess(value);
                    }
                    recordAccess(receiver);
                    boolean resourceUse = isResourceValue(receiver)
                            || arguments.stream().anyMatch(this::isResourceValue);
                    boolean helperCall = isHelperCall(owner, name, descriptor, opcode, receiver);
                    if (isProtectedTarget(owner, name, descriptor, arguments)) {
                        arguments.stream().filter(this::isResourceValue)
                                .map(Value::resourceType).forEach(protectedAccessTypes::add);
                        if (isResourceValue(receiver)) {
                            protectedAccessTypes.add(receiver.resourceType());
                        }
                    } else if (resourceUse && !helperCall
                            && !isKnownResourceUse(owner, name, descriptor, receiver, arguments)) {
                        uncertain = true;
                    }
                    denialConstructed |= isForbiddenStatusCall(owner, name, arguments);
                    addInstruction(opcode, null, false, false);

                    if (helperCall) {
                        Method helper = resolveMethod(owner, name, descriptor);
                        if (helper != null && depth < MAX_HELPER_DEPTH) {
                            ScanOutcome nested = new BytecodeAnalyzer(ownerClass).scan(
                                    helper, arguments, List.of(), depth + 1, new HashSet<>(visited));
                            uncertain |= nested.uncertain();
                            nestedChecks.addAll(nested.checks());
                            accessedTypes.addAll(nested.accesses());
                            accessLocations.addAll(nested.accessLocations());
                            protectedAccessTypes.addAll(nested.protectedAccesses());
                            if (!nested.available()) {
                                uncertain = true;
                            }
                        }
                    }

                    Value returned = returnValue(owner, name, descriptor, receiver, arguments);
                    if (isForbiddenStatusCall(owner, name, arguments)
                            || isForbiddenBuilder(owner, name, receiver)) {
                        returned = Value.forbidden();
                    } else if (isAccessDeniedConstructor(owner, name)) {
                        returned = Value.forbidden();
                    }
                    if ("<init>".equals(name) && arguments.stream()
                            .anyMatch(this::isResourceValue)
                            && !stack.isEmpty()) {
                        Value resource = arguments.stream()
                                .filter(this::isResourceValue)
                                .findFirst().orElse(Value.unknown());
                        stack.pop();
                        stack.push(Value.derived(resource));
                    }
                    if (returned != null) {
                        stack.push(returned);
                    }
                }

                @Override
                public void visitInvokeDynamicInsn(String name, String descriptor,
                                                    Handle bootstrapMethodHandle, Object... bootstrapMethodArguments) {
                    arguments(descriptor).forEach(UsageMethodVisitor.this::recordAccess);
                    uncertain = true;
                    addInstruction(Opcodes.INVOKEDYNAMIC, null, false, false);
                    if (!Type.VOID_TYPE.equals(Type.getReturnType(descriptor))) {
                        stack.push(Value.unknown());
                    }
                }

                @Override
                public void visitJumpInsn(int opcode, Label label) {
                    Value condition = Value.unknown();
                    if (opcode == Opcodes.IFEQ || opcode == Opcodes.IFNE
                            || opcode == Opcodes.IFNULL || opcode == Opcodes.IFNONNULL) {
                        condition = popValue();
                    } else if (opcode >= Opcodes.IF_ICMPEQ && opcode <= Opcodes.IF_ACMPNE) {
                        popValue();
                        condition = popValue();
                    }
                    if (condition.kind() == ValueKind.UNKNOWN || condition.kind() == ValueKind.OTHER) {
                        uncertain = true;
                    }
                    int current = addInstruction(opcode, label, false, false);
                    if ((opcode == Opcodes.IFEQ || opcode == Opcodes.IFNE)
                            && condition.kind() == ValueKind.CHECK && condition.candidate() != null) {
                        branches.add(new Branch(condition.candidate(), opcode, label, current));
                    }
                }

                @Override
                public void visitInsn(int opcode) {
                    boolean effectiveDenial = false;
                    switch (opcode) {
                        case Opcodes.ACONST_NULL -> stack.push(Value.other());
                        case Opcodes.ICONST_M1 -> stack.push(Value.integer(-1));
                        case Opcodes.ICONST_0 -> stack.push(Value.integer(0));
                        case Opcodes.ICONST_1 -> stack.push(Value.integer(1));
                        case Opcodes.ICONST_2 -> stack.push(Value.integer(2));
                        case Opcodes.ICONST_3 -> stack.push(Value.integer(3));
                        case Opcodes.ICONST_4 -> stack.push(Value.integer(4));
                        case Opcodes.ICONST_5 -> stack.push(Value.integer(5));
                        case Opcodes.DUP -> stack.push(stack.isEmpty() ? Value.unknown() : stack.peek());
                        case Opcodes.POP, Opcodes.POP2 -> popValue();
                        case Opcodes.SWAP -> swap();
                        case Opcodes.IRETURN, Opcodes.FRETURN, Opcodes.ARETURN, Opcodes.ATHROW,
                                Opcodes.LRETURN, Opcodes.DRETURN -> {
                            Value returned = popValue();
                            effectiveDenial = returned.kind() == ValueKind.FORBIDDEN;
                            if (isResourceValue(returned)) {
                                protectedAccessTypes.add(returned.resourceType());
                            }
                        }
                        default -> {
                            if (opcode != Opcodes.NOP && opcode != Opcodes.RETURN) {
                                uncertain = true;
                            }
                        }
                    }
                    addInstruction(opcode, null, effectiveDenial, isTerminal(opcode));
                }

                @Override
                public void visitTypeInsn(int opcode, String type) {
                    if (opcode == Opcodes.NEW) {
                        stack.push(Value.other());
                    } else if (opcode == Opcodes.CHECKCAST) {
                        Value value = popValue();
                        stack.push(value.withResourceType(type));
                    } else if (opcode == Opcodes.ANEWARRAY || opcode == Opcodes.INSTANCEOF) {
                        popValue();
                        stack.push(Value.other());
                    } else {
                        uncertain = true;
                    }
                    addInstruction(opcode, null, false, false);
                }

                private void recordAccess(Value value) {
                    if (isResourceValue(value)) {
                        accessedTypes.add(value.resourceType());
                        accessLocations.add(location(method));
                    }
                }

                @Override
                public void visitLdcInsn(Object value) {
                    stack.push(value instanceof Integer integer ? Value.integer(integer) : Value.other());
                    addInstruction(Opcodes.LDC, null, false, false);
                }

                @Override
                public void visitIntInsn(int opcode, int operand) {
                    if (opcode == Opcodes.NEWARRAY) {
                        popValue();
                        stack.push(Value.other());
                    } else {
                        stack.push(Value.integer(operand));
                    }
                    addInstruction(opcode, null, false, false);
                }

                @Override
                public void visitTableSwitchInsn(int min, int max, Label defaultHandler, Label... labels) {
                    uncertain = true;
                    addInstruction(Opcodes.TABLESWITCH, defaultHandler, false, false);
                }

                @Override
                public void visitLookupSwitchInsn(Label defaultHandler, int[] keys, Label... labels) {
                    uncertain = true;
                    addInstruction(Opcodes.LOOKUPSWITCH, defaultHandler, false, false);
                }

                @Override
                public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
                    uncertain = true;
                }

                private Value returnValue(
                        String owner,
                        String name,
                        String descriptor,
                        Value receiver,
                        List<Value> arguments
                ) {
                    Type returnType = Type.getReturnType(descriptor);
                    if (Type.VOID_TYPE.equals(returnType)) {
                        return null;
                    }
                    if (isJwtSubject(owner, name, descriptor) && receiver.kind() == ValueKind.JWT) {
                        return Value.subject(SourceRef.jwt(location(method), owner, name, descriptor));
                    }
                    if (isAuthenticationName(owner, name, descriptor)
                            && receiver.kind() == ValueKind.AUTHENTICATION) {
                        return Value.subject(SourceRef.authentication(location(method), owner, name, descriptor));
                    }
                    if (isOptionalResult(descriptor) && !isFrameworkOwner(owner)) {
                        return Value.optional(owner + "#" + name + descriptor);
                    }
                    if (OPTIONAL.equals(owner) && ("orElse".equals(name) || "orElseGet".equals(name)
                            || "get".equals(name))
                            && receiver.kind() == ValueKind.OPTIONAL) {
                        return Value.object(receiver.repositoryCall());
                    }
                    if (isResourceValue(receiver) && isOwnerGetter(name, descriptor)) {
                        return Value.owner(receiver, name);
                    }
                    if (isStringEquals(owner, name, descriptor)) {
                        SourceMatch match = ownerSource(receiver, arguments);
                        if (match != null) {
                            CheckCandidate candidate = new CheckCandidate(
                                    "OWNER_MATCH_WITH_DENY", location(method), match.source(),
                                    match.ownerGetter(), match.repositoryCall(), receiver.resourceType());
                            candidates.add(candidate);
                            return Value.check(candidate);
                        }
                    }
                    if (isObjectsEquals(owner, name, descriptor)) {
                        SourceMatch match = ownerSource(arguments.size() > 0 ? arguments.get(0) : Value.unknown(),
                                arguments.size() > 1 ? List.of(arguments.get(1)) : List.of());
                        if (match == null && arguments.size() > 1) {
                            match = ownerSource(arguments.get(1), List.of(arguments.get(0)));
                        }
                        if (match != null) {
                            CheckCandidate candidate = new CheckCandidate(
                                    "OWNER_MATCH_WITH_DENY", location(method), match.source(),
                                    match.ownerGetter(), match.repositoryCall(),
                                    arguments.stream().map(Value::resourceType)
                                            .filter(java.util.Objects::nonNull).findFirst().orElse(null));
                            candidates.add(candidate);
                            return Value.check(candidate);
                        }
                    }
                    if (isResourceValue(receiver) && Type.getReturnType(descriptor).getSort() != Type.VOID) {
                        return Value.derived(receiver);
                    }
                    if (("java/util/Map".equals(owner) || "java/util/List".equals(owner))
                            && name.startsWith("of")
                            && arguments.stream().anyMatch(this::isResourceValue)) {
                        return Value.derived(arguments.stream()
                                .filter(this::isResourceValue)
                                .findFirst().orElse(Value.unknown()));
                    }
                    if (isAssignmentCheck(owner, name, descriptor, receiver, arguments)) {
                        SourceRef source = assignmentSource(arguments);
                        CheckCandidate candidate = new CheckCandidate(
                                "ASSIGNMENT_DENY", location(method), source, null, null, null);
                        candidates.add(candidate);
                        return Value.check(candidate);
                    }
                    return Value.other();
                }

                private SourceMatch ownerSource(Value receiver, List<Value> arguments) {
                    if (receiver.kind() != ValueKind.OWNER || arguments.size() != 1) {
                        return null;
                    }
                    Value source = arguments.get(0);
                    return (source.kind() == ValueKind.SUBJECT || source.kind() == ValueKind.HEADER)
                            ? new SourceMatch(source.source(), receiver.ownerGetter(), receiver.repositoryCall())
                            : null;
                }

                private boolean isHelperCall(
                        String owner,
                        String name,
                        String descriptor,
                        int opcode,
                        Value receiver
                ) {
                    return owner.equals(ownerClass.getName().replace('.', '/'))
                            && opcode != Opcodes.INVOKESTATIC
                            && receiver.kind() == ValueKind.THIS
                            && resolveMethod(owner, name, descriptor) != null;
                }

                private boolean isResourceValue(Value value) {
                    return value != null && value.resourceType() != null;
                }

                private boolean isProtectedTarget(String owner, String name, String descriptor,
                                                  List<Value> arguments) {
                    if (RESPONSE_ENTITY.equals(owner) && ("ok".equals(name) || "body".equals(name))) {
                        return arguments.stream().anyMatch(this::isResourceValue);
                    }
                    if ("<init>".equals(name) || isFrameworkOwner(owner)) {
                        return false;
                    }
                    return Set.of("save", "persist", "insert", "update", "delete").contains(name)
                            && arguments.stream().anyMatch(this::isResourceValue);
                }

                private boolean isKnownResourceUse(String owner, String name, String descriptor,
                                                    Value receiver, List<Value> arguments) {
                    return isProtectedTarget(owner, name, descriptor, arguments)
                            || isHelperCall(owner, name, descriptor, Opcodes.INVOKEVIRTUAL, receiver)
                            || isOwnerGetter(name, descriptor)
                            || isStringEquals(owner, name, descriptor)
                            || isObjectsEquals(owner, name, descriptor)
                            || "<init>".equals(name)
                            || (("java/util/Map".equals(owner) || "java/util/List".equals(owner))
                            && name.startsWith("of"));
                }

                private boolean isForbiddenStatusCall(String owner, String name, List<Value> arguments) {
                    return RESPONSE_ENTITY.equals(owner)
                            && "status".equals(name)
                            && arguments.stream().anyMatch(value -> value.kind() == ValueKind.FORBIDDEN
                            || Integer.valueOf(403).equals(value.integer()));
                }

                private boolean isForbiddenBuilder(String owner, String name, Value receiver) {
                    return receiver.kind() == ValueKind.FORBIDDEN
                            && "build".equals(name)
                            && owner.endsWith("ResponseEntity$BodyBuilder");
                }

                private boolean isAccessDeniedConstructor(String owner, String name) {
                    return "<init>".equals(name) && owner.endsWith("AccessDeniedException");
                }

                private List<Value> arguments(String descriptor) {
                    Type[] types = Type.getArgumentTypes(descriptor);
                    List<Value> values = new ArrayList<>();
                    for (int index = types.length - 1; index >= 0; index--) {
                        values.add(popValue());
                    }
                    java.util.Collections.reverse(values);
                    return values;
                }

                private Value popValue() {
                    return stack.isEmpty() ? Value.unknown() : stack.pop();
                }

                private void swap() {
                    Value first = popValue();
                    Value second = popValue();
                    stack.push(first);
                    stack.push(second);
                }

                private int addInstruction(int opcode, Label target, boolean denial, boolean terminal) {
                    int index = instructions.size();
                    instructions.add(new Instruction(opcode, target, denial, terminal));
                    eventIndex = index;
                    return index;
                }

                private boolean isTerminal(int opcode) {
                    return opcode == Opcodes.IRETURN || opcode == Opcodes.FRETURN || opcode == Opcodes.ARETURN
                            || opcode == Opcodes.LRETURN || opcode == Opcodes.DRETURN || opcode == Opcodes.RETURN
                            || opcode == Opcodes.ATHROW;
                }

                private String location(Method currentMethod) {
                    return ownerClass.getName() + "#" + currentMethod.getName()
                            + Type.getMethodDescriptor(currentMethod);
                }
            }
        }
    }

    private record SourceMatch(SourceRef source, String ownerGetter, String repositoryCall) {
    }

    private boolean isJwtSubject(String owner, String name, String descriptor) {
        return JWT.equals(owner) && "getSubject".equals(name) && "()Ljava/lang/String;".equals(descriptor);
    }

    private boolean isAuthenticationName(String owner, String name, String descriptor) {
        return AUTHENTICATION.equals(owner) && "getName".equals(name) && "()Ljava/lang/String;".equals(descriptor);
    }

    private boolean isOwnerGetter(String name, String descriptor) {
        return ("getOwnerId".equals(name) || "getUserId".equals(name))
                && "()Ljava/lang/String;".equals(descriptor);
    }

    private boolean isStringEquals(String owner, String name, String descriptor) {
        return "java/lang/String".equals(owner)
                && "equals".equals(name)
                && "(Ljava/lang/Object;)Z".equals(descriptor);
    }

    private boolean isObjectsEquals(String owner, String name, String descriptor) {
        return "java/util/Objects".equals(owner)
                && "equals".equals(name)
                && "(Ljava/lang/Object;Ljava/lang/Object;)Z".equals(descriptor);
    }

    private boolean isAssignmentCheck(
            String owner,
            String name,
            String descriptor,
            Value receiver,
            List<Value> arguments
    ) {
        return "isAssigned".equals(name)
                && "(Ljava/lang/String;Ljava/lang/String;)Z".equals(descriptor)
                && receiver.kind() != ValueKind.UNKNOWN
                && arguments.size() == 2
                && isCredential(arguments.get(0))
                && arguments.get(1).kind() == ValueKind.INPUT;
    }

    private SourceRef assignmentSource(List<Value> arguments) {
        return arguments.get(0).source();
    }

    private boolean isCredential(Value value) {
        return value.kind() == ValueKind.SUBJECT || value.kind() == ValueKind.HEADER;
    }

    private boolean isOptionalResult(String descriptor) {
        return Type.getReturnType(descriptor).getDescriptor().equals("Ljava/util/Optional;");
    }

    private boolean isFrameworkOwner(String owner) {
        return owner.startsWith("java/") || owner.startsWith("javax/") || owner.startsWith("jakarta/")
                || owner.startsWith("org/springframework/");
    }
}
