package com.mapinboot.security.collector;

import com.mapinboot.core.annotation.ProducesSecurityState;
import com.mapinboot.core.annotation.RequiresSecurityState;
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
import java.lang.reflect.Modifier;
import java.io.IOException;
import java.io.InputStream;
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
import org.objectweb.asm.Type;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.springframework.context.ApplicationContext;

// 업무 보안 상태 Annotation 선언 수집
public class BusinessStateCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "BUSINESS_SECURITY_STATE";
    private static final String EVALUATION_TYPE = "BUSINESS_STATE_EVALUATION";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public BusinessStateCollectorAdapter() {
        super("security-business-state", "업무 보안 상태 선언 수집", Set.of(TYPE, EVALUATION_TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부족");
        }
        ApplicationContext applicationContext = context.applicationContext();
        if (!(applicationContext instanceof org.springframework.context.ConfigurableApplicationContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ApplicationClassDiscovery.Discovery discovery = ApplicationClassDiscovery.discover(
                applicationContext, id(), "업무 보안 상태");
        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(discovery.diagnostics());
        Set<String> factKeys = new LinkedHashSet<>();
        boolean partial = discovery.partial();

        for (Class<?> targetClass : ApplicationClassDiscovery.sortedClasses(discovery.targetClasses())) {
            if (ApplicationClassDiscovery.isFrameworkClass(targetClass)
                    || targetClass.isInterface() || Modifier.isAbstract(targetClass.getModifiers())) {
                continue;
            }
            for (Method method : declarationMethods(targetClass)) {
                RequiresSecurityState requires = method.getDeclaredAnnotation(RequiresSecurityState.class);
                if (requires != null) {
                    partial |= addFact(context.serviceId(), targetClass, method, "REQUIRES",
                            requires.value(), requires.claim(), RequiresSecurityState.class,
                            factKeys, facts, evidence, diagnostics);
                    partial |= addEvaluation(context.serviceId(), targetClass, method, requires,
                            factKeys, facts, evidence, diagnostics);
                }
                ProducesSecurityState produces = method.getDeclaredAnnotation(ProducesSecurityState.class);
                if (produces != null) {
                    partial |= addFact(context.serviceId(), targetClass, method, "PRODUCES",
                            produces.value(), null, ProducesSecurityState.class,
                            factKeys, facts, evidence, diagnostics);
                }
            }
        }

        return new CollectionResult(id(), facts, evidence,
                partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY, diagnostics);
    }

    private boolean addEvaluation(
            String serviceId,
            Class<?> targetClass,
            Method method,
            RequiresSecurityState requirement,
            Set<String> factKeys,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        if (isBlank(requirement.claim())) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "업무 보안 상태 Claim 선언 확인 불가: " + handler(targetClass, method)));
            return true;
        }
        StateScanOutcome outcome = new StateBytecodeAnalyzer(targetClass, requirement.claim())
                .scan(method, 0, new HashSet<>());
        String handler = handler(targetClass, method);
        String requirementKey = stateSubjectKey(targetClass, method, "REQUIRES",
                requirement.value(), requirement.claim());
        String pathOutcome;
        if (!outcome.available()) {
            pathOutcome = "UNRESOLVED";
        } else if (outcome.enforced()) {
            pathOutcome = "ENFORCED";
        } else if (outcome.businessReached() && outcome.bypassPath() && !outcome.uncertain()) {
            pathOutcome = "BYPASS_PATH";
        } else {
            pathOutcome = "UNRESOLVED";
        }
        String coverage = outcome.uncertain() || !outcome.available()
                ? "INCOMPLETE" : "COMPLETE_SUPPORTED_PATH";
        String codeLocation = outcome.codeLocation() == null
                ? declaringMethod(method) : outcome.codeLocation();
        String subjectKey = "state-evaluation|" + handler + "|" + requirementKey
                + "|" + codeLocation + "|" + pathOutcome;
        if (!factKeys.add(subjectKey)) {
            return false;
        }
        String evidenceId = idGenerator.generate(serviceId, NodeType.BUSINESS_SECURITY_STATE,
                "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("handler", handler);
        attributes.put("requirementKey", requirementKey);
        attributes.put("stateName", requirement.value());
        attributes.put("claimName", requirement.claim());
        attributes.put("codeLocation", codeLocation);
        attributes.put("pathOutcome", pathOutcome);
        attributes.put("coverage", coverage);
        attributes.put("evaluationScope", "HANDLER_LOCAL");
        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.BUSINESS_SECURITY_STATE, "fact|" + subjectKey),
                EVALUATION_TYPE, subjectKey, attributes, List.of(evidenceId)));
        evidence.add(new Evidence(evidenceId, EvidenceSource.CODE_PATTERN, codeLocation,
                "업무 상태 Claim 평가·거부·업무 도달 경로 확인"));
        if ("UNRESOLVED".equals(pathOutcome)) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "업무 보안 상태 경로 판정 불완전: " + handler));
            return true;
        }
        return false;
    }

    private boolean addFact(
            String serviceId,
            Class<?> targetClass,
            Method method,
            String action,
            String stateName,
            String claim,
            Class<?> annotationType,
            Set<String> factKeys,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        if (isBlank(stateName)) {
            diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                    "업무 보안 상태 이름 확인 불가: " + declaringMethod(method)));
            return true;
        }
        String declaringMethod = declaringMethod(method);
        String handler = handler(targetClass, method);
        String subjectKey = stateSubjectKey(targetClass, method, action, stateName, claim);
        if (!factKeys.add(subjectKey)) {
            return false;
        }

        String evidenceId = idGenerator.generate(serviceId, NodeType.BUSINESS_SECURITY_STATE,
                "evidence|" + subjectKey);
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("declaringMethod", declaringMethod);
        attributes.put("handler", handler);
        attributes.put("stateAction", action);
        attributes.put("stateName", stateName);
        attributes.put("annotationType", annotationType.getName());
        if (!isBlank(claim)) {
            attributes.put("claim", claim);
        }
        facts.add(new Fact(
                idGenerator.generate(serviceId, NodeType.BUSINESS_SECURITY_STATE, "fact|" + subjectKey),
                TYPE, subjectKey, attributes, List.of(evidenceId)));
        evidence.add(new Evidence(evidenceId, EvidenceSource.DECLARATION, declaringMethod,
                "업무 보안 상태 선언: " + action));
        return false;
    }

    private String stateSubjectKey(
            Class<?> targetClass,
            Method method,
            String action,
            String stateName,
            String claim
    ) {
        String handler = handler(targetClass, method);
        String declaringMethod = declaringMethod(method);
        return "state|" + handler + "|" + declaringMethod + "|"
                + action + "|" + stateName + "|" + (claim == null ? "" : claim);
    }

    private record StateScanOutcome(
            boolean available,
            boolean uncertain,
            boolean claimRead,
            boolean comparison,
            boolean enforced,
            boolean denialPath,
            boolean businessReached,
            boolean bypassPath,
            String codeLocation
    ) {
    }

    private enum StateValueKind {
        UNKNOWN,
        JWT,
        MAP,
        CLAIM,
        CHECK,
        DENIAL,
        DENIAL_STATUS,
        OTHER,
        THIS
    }

    private record StateValue(StateValueKind kind, String literal) {
        private static StateValue unknown() {
            return new StateValue(StateValueKind.UNKNOWN, null);
        }

        private static StateValue jwt() {
            return new StateValue(StateValueKind.JWT, null);
        }

        private static StateValue other() {
            return new StateValue(StateValueKind.OTHER, null);
        }

        private static StateValue thisValue() {
            return new StateValue(StateValueKind.THIS, null);
        }

        private static StateValue literal(String value) {
            return new StateValue(StateValueKind.OTHER, value);
        }

        private StateValue withKind(StateValueKind valueKind) {
            return new StateValue(valueKind, literal);
        }
    }

    private record StateInstruction(int opcode, Label target, boolean denial, boolean business, boolean terminal) {
    }

    private record StateBranch(int opcode, Label target, int eventIndex) {
    }

    private final class StateBytecodeAnalyzer {
        private static final String JWT = "org/springframework/security/oauth2/jwt/Jwt";
        private static final String RESPONSE_ENTITY = "org/springframework/http/ResponseEntity";
        private static final String HTTP_STATUS = "org/springframework/http/HttpStatus";
        private static final String MAP = "java/util/Map";
        private static final String BOOLEAN = "java/lang/Boolean";
        private static final int MAX_DEPTH = 2;

        private final Class<?> targetClass;
        private final String claimName;

        private StateBytecodeAnalyzer(Class<?> targetClass, String claimName) {
            this.targetClass = targetClass;
            this.claimName = claimName;
        }

        private StateScanOutcome scan(Method method, int depth, Set<String> visited) {
            String descriptor = Type.getMethodDescriptor(method);
            String key = method.getName() + descriptor;
            if (!visited.add(key) || depth > MAX_DEPTH) {
                return new StateScanOutcome(true, true, false, false, false, false, false, false, location(method));
            }
            String resourceName = targetClass.getName().replace('.', '/') + ".class";
            ClassLoader classLoader = targetClass.getClassLoader();
            InputStream input = classLoader == null
                    ? ClassLoader.getSystemResourceAsStream(resourceName)
                    : classLoader.getResourceAsStream(resourceName);
            if (input == null) {
                return new StateScanOutcome(false, true, false, false, false, false, false, false, location(method));
            }
            try (input) {
                StateVisitor visitor = new StateVisitor(method, depth, visited);
                new ClassReader(input).accept(visitor, ClassReader.SKIP_FRAMES);
                return visitor.result();
            } catch (IOException | RuntimeException exception) {
                return new StateScanOutcome(false, true, false, false, false, false, false, false, location(method));
            }
        }

        private Method resolveMethod(String owner, String name, String descriptor) {
            if (!owner.equals(targetClass.getName().replace('.', '/')) || name.startsWith("<")) {
                return null;
            }
            return Arrays.stream(targetClass.getDeclaredMethods())
                    .filter(candidate -> candidate.getName().equals(name))
                    .filter(candidate -> Type.getMethodDescriptor(candidate).equals(descriptor))
                    .findFirst().orElse(null);
        }

        private String location(Method method) {
            return method.getDeclaringClass().getName() + "#" + method.getName()
                    + Type.getMethodDescriptor(method);
        }

        private final class StateVisitor extends ClassVisitor {
            private final Method method;
            private final int depth;
            private final Set<String> visited;
            private final List<StateInstruction> instructions = new ArrayList<>();
            private final List<StateBranch> branches = new ArrayList<>();
            private final Map<Label, Integer> labels = new HashMap<>();
            private boolean found;
            private boolean uncertain;
            private boolean claimRead;
            private boolean comparison;
            private boolean businessReached;
            private boolean forbiddenBuilderPending;

            private StateVisitor(Method method, int depth, Set<String> visited) {
                super(Opcodes.ASM9);
                this.method = method;
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
                return new UsageVisitor(access, descriptor);
            }

            private StateScanOutcome result() {
                if (!found) {
                    return new StateScanOutcome(false, true, claimRead, comparison,
                            false, hasDenial(), businessReached, false, location(method));
                }
                int firstBusiness = instructions.stream()
                        .filter(StateInstruction::business)
                        .mapToInt(instructions::indexOf)
                        .min().orElse(Integer.MAX_VALUE);
                int firstDenial = instructions.stream()
                        .filter(StateInstruction::denial)
                        .mapToInt(instructions::indexOf)
                        .min().orElse(Integer.MAX_VALUE);
                int firstStateBranch = branches.stream()
                        .mapToInt(StateBranch::eventIndex)
                        .min().orElse(Integer.MAX_VALUE);
                boolean businessBeforeStateBranch = firstBusiness < firstStateBranch;
                boolean hasEffectiveDenialBranch = branches.stream().anyMatch(this::reachesDenial);
                boolean bypassPath = businessReached && (!comparison || !claimRead || branches.isEmpty()
                        || businessBeforeStateBranch || !hasEffectiveDenialBranch
                        || firstBusiness < firstDenial);
                boolean enforced = comparison && claimRead && businessReached && firstBusiness < Integer.MAX_VALUE
                        && firstDenial < firstBusiness
                        && hasEffectiveDenialBranch
                        && !businessBeforeStateBranch;
                return new StateScanOutcome(true, uncertain, claimRead, comparison, enforced,
                        hasDenial(), businessReached, bypassPath, location(method));
            }

            private boolean hasDenial() {
                return instructions.stream().anyMatch(StateInstruction::denial);
            }

            private boolean reachesDenial(StateBranch branch) {
                Integer targetIndex = labels.get(branch.target());
                return (targetIndex != null && reachesEvent(targetIndex, StateInstruction::denial))
                        || reachesEvent(branch.eventIndex() + 1, StateInstruction::denial);
            }

            private boolean reachesEvent(int start, java.util.function.Predicate<StateInstruction> predicate) {
                return reachesEvent(start, predicate, Set.of());
            }

            private boolean reachesEvent(
                    int start,
                    java.util.function.Predicate<StateInstruction> predicate,
                    Set<Integer> blocked
            ) {
                Deque<Integer> pending = new ArrayDeque<>();
                Set<Integer> seen = new HashSet<>();
                pending.add(start);
                while (!pending.isEmpty()) {
                    int index = pending.removeFirst();
                    if (index < 0 || index >= instructions.size() || !seen.add(index)) {
                        continue;
                    }
                    if (blocked.contains(index)) {
                        continue;
                    }
                    StateInstruction instruction = instructions.get(index);
                    if (predicate.test(instruction)) {
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
                    } else if (isConditional(instruction.opcode())) {
                        Integer target = labels.get(instruction.target());
                        if (target != null) {
                            pending.add(target);
                        }
                        pending.add(index + 1);
                    } else {
                        pending.add(index + 1);
                    }
                }
                return false;
            }

            private boolean isConditional(int opcode) {
                return (opcode >= Opcodes.IFEQ && opcode <= Opcodes.IF_ACMPNE)
                        || opcode == Opcodes.IFNULL || opcode == Opcodes.IFNONNULL;
            }

            private final class UsageVisitor extends MethodVisitor {
                private final Deque<StateValue> stack = new ArrayDeque<>();
                private final Map<Integer, StateValue> locals = new LinkedHashMap<>();
                private final String descriptor;

                private UsageVisitor(int access, String descriptor) {
                    super(Opcodes.ASM9);
                    this.descriptor = descriptor;
                    initializeLocals(access);
                }

                private void initializeLocals(int access) {
                    int local = Modifier.isStatic(method.getModifiers()) ? 0 : 1;
                    if (!Modifier.isStatic(method.getModifiers())) {
                        locals.put(0, StateValue.thisValue());
                    }
                    Type[] parameters = Type.getArgumentTypes(descriptor);
                    for (Type parameter : parameters) {
                        locals.put(local, parameter.getClassName().equals(JWT.replace('/', '.'))
                                ? StateValue.jwt() : StateValue.other());
                        local += parameter.getSize();
                    }
                }

                @Override
                public void visitLabel(Label label) {
                    labels.put(label, instructions.size());
                    addInstruction(Opcodes.NOP, null, false, false, false);
                }

                @Override
                public void visitVarInsn(int opcode, int variable) {
                    if (opcode == Opcodes.ALOAD || opcode == Opcodes.ILOAD) {
                        stack.push(locals.getOrDefault(variable, StateValue.unknown()));
                    } else if (opcode == Opcodes.ASTORE || opcode == Opcodes.ISTORE) {
                        locals.put(variable, popValue());
                    }
                    addInstruction(opcode, null, false, false, false);
                }

                @Override
                public void visitFieldInsn(int opcode, String owner, String name, String fieldDescriptor) {
                    boolean forbidden = opcode == Opcodes.GETSTATIC
                            && HTTP_STATUS.equals(owner) && "FORBIDDEN".equals(name);
                    if (opcode == Opcodes.GETFIELD) {
                        popValue();
                        stack.push(StateValue.other());
                    } else if (opcode == Opcodes.PUTFIELD) {
                        popValue();
                        popValue();
                    }
                    if (opcode == Opcodes.GETSTATIC) {
                        stack.push(forbidden ? new StateValue(StateValueKind.DENIAL_STATUS, null)
                                : StateValue.other());
                    }
                    addInstruction(opcode, null, false, false, false);
                }

                @Override
                public void visitLdcInsn(Object value) {
                    stack.push(value instanceof String string ? StateValue.literal(string) : StateValue.other());
                    addInstruction(Opcodes.LDC, null, false, false, false);
                }

                @Override
                public void visitInsn(int opcode) {
                    boolean effectiveDenial = false;
                    if (opcode == Opcodes.DUP) {
                        stack.push(stack.isEmpty() ? StateValue.unknown() : stack.peek());
                    } else if (opcode == Opcodes.POP || opcode == Opcodes.POP2) {
                        popValue();
                    } else if (opcode == Opcodes.IRETURN || opcode == Opcodes.ARETURN
                            || opcode == Opcodes.ATHROW) {
                        StateValue returned = popValue();
                        effectiveDenial = returned.kind() == StateValueKind.DENIAL;
                    } else if (opcode == Opcodes.ACONST_NULL) {
                        stack.push(StateValue.other());
                    }
                    addInstruction(opcode, null, effectiveDenial, false, isTerminal(opcode));
                }

                @Override
                public void visitTypeInsn(int opcode, String type) {
                    if (opcode == Opcodes.CHECKCAST) {
                        StateValue value = popValue();
                        stack.push(value);
                    } else if (opcode == Opcodes.NEW) {
                        stack.push(StateValue.other());
                    }
                    addInstruction(opcode, null, false, false, false);
                }

                @Override
                public void visitIntInsn(int opcode, int operand) {
                    stack.push(StateValue.other());
                    addInstruction(opcode, null, false, false, false);
                }

                @Override
                public void visitMethodInsn(int opcode, String owner, String name, String methodDescriptor,
                                            boolean isInterface) {
                    List<StateValue> arguments = arguments(methodDescriptor);
                    StateValue receiver = opcode == Opcodes.INVOKESTATIC ? StateValue.other() : popValue();
                    boolean denial = isForbiddenStatus(owner, name, arguments);
                    boolean helperCall = isHelperCall(owner, name, methodDescriptor, opcode, receiver);
                    boolean business = isBusinessCall(owner, name, opcode, receiver);
                    boolean nestedDenial = false;
                    boolean forbiddenBuilder = isForbiddenBuilder(owner, name, receiver)
                            || (forbiddenBuilderPending && owner.endsWith("ResponseEntity$BodyBuilder")
                            && ("build".equals(name) || "body".equals(name)));
                    StateValue returned = StateValue.other();

                    if ((receiver.kind() == StateValueKind.JWT
                            || arguments.stream().anyMatch(value -> value.kind() == StateValueKind.JWT))
                            && !helperCall && !JWT.equals(owner) && !MAP.equals(owner)
                            && !BOOLEAN.equals(owner) && !RESPONSE_ENTITY.equals(owner)) {
                        uncertain = true;
                    }
                    if (denial) {
                        forbiddenBuilderPending = true;
                    } else if (forbiddenBuilder) {
                        forbiddenBuilderPending = false;
                    }

                    if (JWT.equals(owner) && "getClaims".equals(name)
                            && receiver.kind() == StateValueKind.JWT) {
                        returned = new StateValue(StateValueKind.MAP, null);
                    } else if (MAP.equals(owner) && "get".equals(name)
                            && receiver.kind() == StateValueKind.MAP) {
                        String requestedClaim = arguments.isEmpty() ? null : arguments.get(0).literal();
                        if (requestedClaim == null) {
                            uncertain = true;
                        } else if (requestedClaim.equals(claimName)) {
                            claimRead = true;
                            returned = new StateValue(StateValueKind.CLAIM, requestedClaim);
                        } else {
                            returned = StateValue.other();
                        }
                    } else if (BOOLEAN.equals(owner) && "equals".equals(name)
                            && arguments.stream().anyMatch(value -> value.kind() == StateValueKind.CLAIM)) {
                        comparison = true;
                        returned = new StateValue(StateValueKind.CHECK, null);
                    } else if (helperCall) {
                        Method helper = resolveMethod(owner, name, methodDescriptor);
                        if (helper != null && depth < MAX_DEPTH) {
                            StateScanOutcome nested = new StateBytecodeAnalyzer(targetClass, claimName)
                                    .scan(helper, depth + 1, new HashSet<>(visited));
                            claimRead |= nested.claimRead();
                            comparison |= nested.comparison();
                            uncertain |= nested.uncertain();
                            business |= nested.businessReached();
                            denial |= nested.denialPath();
                            nestedDenial = nested.denialPath();
                            if (nested.comparison()) {
                                returned = new StateValue(StateValueKind.CHECK, null);
                            } else if (nested.denialPath()) {
                                returned = new StateValue(StateValueKind.DENIAL, null);
                            }
                        } else {
                            uncertain = true;
                        }
                    }
                    addInstruction(opcode, null, nestedDenial, business, false);
                    if (denial || forbiddenBuilder
                            || isAccessDeniedConstructor(owner, name)) {
                        returned = new StateValue(StateValueKind.DENIAL, null);
                    }
                    if (!Type.VOID_TYPE.equals(Type.getReturnType(methodDescriptor))) {
                        stack.push(returned);
                    }
                    if (business) {
                        businessReached = true;
                    }
                }

                @Override
                public void visitJumpInsn(int opcode, Label label) {
                    StateValue condition = popValue();
                    int index = addInstruction(opcode, label, false, false, false);
                    if ((opcode == Opcodes.IFEQ || opcode == Opcodes.IFNE)
                            && condition.kind() == StateValueKind.CHECK) {
                        branches.add(new StateBranch(opcode, label, index));
                    }
                }

                @Override
                public void visitInvokeDynamicInsn(String name, String methodDescriptor,
                                                   org.objectweb.asm.Handle bootstrap, Object... arguments) {
                    uncertain = true;
                    addInstruction(Opcodes.INVOKEDYNAMIC, null, false, false, false);
                    if (!Type.VOID_TYPE.equals(Type.getReturnType(methodDescriptor))) {
                        stack.push(StateValue.unknown());
                    }
                }

                @Override
                public void visitTryCatchBlock(Label start, Label end, Label handler, String type) {
                    uncertain = true;
                }

                private boolean isHelperCall(String owner, String name, String methodDescriptor,
                                             int opcode, StateValue receiver) {
                    return owner.equals(targetClass.getName().replace('.', '/'))
                            && opcode != Opcodes.INVOKESTATIC
                            && receiver.kind() == StateValueKind.THIS
                            && resolveMethod(owner, name, methodDescriptor) != null;
                }

                private boolean isBusinessCall(String owner, String name, int opcode, StateValue receiver) {
                    return opcode != Opcodes.INVOKESTATIC
                            && receiver.kind() != StateValueKind.UNKNOWN
                            && !isFrameworkOwner(owner)
                            && owner.endsWith("Repository")
                            && Set.of("save", "persist", "insert", "update", "delete").contains(name);
                }

                private boolean isForbiddenStatus(String owner, String name, List<StateValue> arguments) {
                    return RESPONSE_ENTITY.equals(owner) && "status".equals(name)
                            && arguments.stream().anyMatch(value -> value.kind() == StateValueKind.DENIAL_STATUS);
                }

                private boolean isForbiddenBuilder(String owner, String name, StateValue receiver) {
                    return receiver.kind() == StateValueKind.DENIAL
                            && ("build".equals(name) || "body".equals(name))
                            && owner.endsWith("ResponseEntity$BodyBuilder");
                }

                private boolean isAccessDeniedConstructor(String owner, String name) {
                    return "<init>".equals(name) && owner.endsWith("AccessDeniedException");
                }

                private List<StateValue> arguments(String methodDescriptor) {
                    Type[] types = Type.getArgumentTypes(methodDescriptor);
                    List<StateValue> values = new ArrayList<>();
                    for (int index = types.length - 1; index >= 0; index--) {
                        values.add(popValue());
                    }
                    java.util.Collections.reverse(values);
                    return values;
                }

                private StateValue popValue() {
                    return stack.isEmpty() ? StateValue.unknown() : stack.pop();
                }

                private int addInstruction(int opcode, Label target, boolean denial,
                                           boolean business, boolean terminal) {
                    int index = instructions.size();
                    instructions.add(new StateInstruction(opcode, target, denial, business, terminal));
                    return index;
                }

                private boolean isTerminal(int opcode) {
                    return opcode == Opcodes.IRETURN || opcode == Opcodes.ARETURN
                            || opcode == Opcodes.RETURN || opcode == Opcodes.ATHROW;
                }
            }
        }

        private boolean isFrameworkOwner(String owner) {
            return owner.startsWith("java/") || owner.startsWith("javax/")
                    || owner.startsWith("jakarta/") || owner.startsWith("org/springframework/");
        }
    }

    private List<Method> declarationMethods(Class<?> targetClass) {
        Map<String, Method> methods = new LinkedHashMap<>();
        collectMethods(targetClass, new LinkedHashSet<>(), methods);
        return methods.values().stream()
                .sorted(Comparator.comparing(this::declaringMethod))
                .toList();
    }

    private void collectMethods(Class<?> type, Set<Class<?>> visited, Map<String, Method> methods) {
        if (type == null || type == Object.class || !visited.add(type)) {
            return;
        }
        Arrays.stream(type.getDeclaredMethods())
                .filter(method -> !method.isBridge() && !method.isSynthetic())
                .forEach(method -> methods.putIfAbsent(declaringMethod(method), method));
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectMethods(interfaceType, visited, methods);
        }
        collectMethods(type.getSuperclass(), visited, methods);
    }

    private String declaringMethod(Method method) {
        return method.getDeclaringClass().getName() + "#" + method.getName()
                + Type.getMethodDescriptor(method);
    }

    private String handler(Class<?> targetClass, Method method) {
        String parameters = Arrays.stream(method.getParameterTypes())
                .map(Class::getName)
                .reduce((first, second) -> first + "," + second)
                .orElse("");
        return targetClass.getName() + "#" + method.getName() + "(" + parameters + ")";
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
