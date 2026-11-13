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
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.util.ClassUtils;

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
        if (!(context.applicationContext() instanceof ConfigurableApplicationContext configurableContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ConfigurableListableBeanFactory beanFactory = configurableContext.getBeanFactory();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Set<Class<?>> targetClasses = new LinkedHashSet<>();
        boolean partial = false;
        for (String beanName : new TreeSet<>(java.util.Arrays.asList(beanFactory.getBeanDefinitionNames()))) {
            try {
                Class<?> targetClass = targetClass(context.applicationContext(), beanFactory, beanName);
                if (targetClass == null) {
                    if (isApplicationBean(beanName, beanFactory)) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                                "Bean Target Class 조회 불완전: " + beanName));
                    }
                    continue;
                }
                if (targetClass.isSynthetic()) {
                    continue;
                }
                collectTypes(targetClass, targetClasses);
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Session 사용 대상 Bean 조회 실패: " + beanName));
            }
        }

        List<Usage> usages = new ArrayList<>();
        for (Class<?> targetClass : targetClasses.stream()
                .sorted(Comparator.comparing(Class::getName)).toList()) {
            if (isFrameworkClass(targetClass)) {
                continue;
            }
            try {
                ScanResult result = scan(targetClass);
                usages.addAll(result.usages());
                if (result.diagnostic() != null) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, result.diagnostic()));
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

    private Class<?> targetClass(
            ApplicationContext applicationContext,
            ConfigurableListableBeanFactory beanFactory,
            String beanName
    ) {
        Object singleton = beanFactory.getSingleton(beanName);
        if (singleton != null) {
            return ClassUtils.getUserClass(AopUtils.getTargetClass(singleton));
        }
        return applicationContext.getType(beanName, false);
    }

    private boolean isApplicationBean(String beanName, ConfigurableListableBeanFactory beanFactory) {
        if (beanName.startsWith("org.springframework.")) {
            return false;
        }
        try {
            String beanClassName = beanFactory.getBeanDefinition(beanName).getBeanClassName();
            return beanClassName == null || !beanClassName.startsWith("org.springframework.");
        } catch (RuntimeException exception) {
            return true;
        }
    }

    private void collectTypes(Class<?> type, Set<Class<?>> targetClasses) {
        if (type == null || type == Object.class || !targetClasses.add(type)) {
            return;
        }
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectTypes(interfaceType, targetClasses);
        }
        collectTypes(type.getSuperclass(), targetClasses);
    }

    private boolean isFrameworkClass(Class<?> type) {
        String name = type.getName();
        return name.startsWith("org.springframework.") || name.startsWith("java.")
                || name.startsWith("jakarta.");
    }

    // 대상 Class Bytecode 기반 Session·인증 상태 API 호출 판독
    private ScanResult scan(Class<?> targetClass) {
        String resourceName = targetClass.getName().replace('.', '/') + ".class";
        ClassLoader classLoader = targetClass.getClassLoader();
        InputStream input = classLoader == null
                ? ClassLoader.getSystemResourceAsStream(resourceName)
                : classLoader.getResourceAsStream(resourceName);
        if (input == null) {
            return new ScanResult(List.of(), "Session 사용 대상 Class 바이트코드 조회 불가: " + targetClass.getName());
        }
        try (input) {
            UsageClassVisitor visitor = new UsageClassVisitor(targetClass.getName());
            new ClassReader(input).accept(visitor, ClassReader.SKIP_FRAMES);
            return new ScanResult(visitor.usages(), null);
        } catch (IOException exception) {
            return new ScanResult(List.of(), "Session 사용 대상 Class 바이트코드 읽기 실패: " + targetClass.getName());
        }
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record ScanResult(List<Usage> usages, String diagnostic) {
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

    private record StackValue(String literal) {
        private static StackValue unknown() {
            return new StackValue(null);
        }
    }

    private final class UsageClassVisitor extends ClassVisitor {
        private final String className;
        private final List<Usage> usages = new ArrayList<>();

        private UsageClassVisitor(String className) {
            super(Opcodes.ASM9);
            this.className = className;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            return new UsageMethodVisitor(className, name, descriptor, usages);
        }

        private List<Usage> usages() {
            return List.copyOf(usages);
        }
    }

    private final class UsageMethodVisitor extends MethodVisitor {
        private final String codeLocation;
        private final Deque<StackValue> stack = new LinkedList<>();
        private final Map<Integer, StackValue> locals = new HashMap<>();
        private final Set<org.objectweb.asm.Label> exceptionHandlers = new HashSet<>();
        private final List<Usage> usages;
        private int occurrence;

        private UsageMethodVisitor(
                String className, String methodName, String methodDescriptor, List<Usage> usages) {
            super(Opcodes.ASM9);
            this.codeLocation = className + "#" + methodName + methodDescriptor;
            this.usages = usages;
        }

        @Override
        public void visitLdcInsn(Object value) {
            pushValue(value instanceof String string ? new StackValue(string) : StackValue.unknown(),
                    value instanceof Long || value instanceof Double ? 2 : 1);
        }

        @Override
        public void visitVarInsn(int opcode, int varIndex) {
            if (opcode == Opcodes.ASTORE) {
                locals.put(varIndex, popValue());
                return;
            }
            if (opcode == Opcodes.ALOAD) {
                pushValue(locals.getOrDefault(varIndex, StackValue.unknown()), 1);
                return;
            }
            if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.DSTORE) {
                locals.remove(varIndex);
                pop(opcode == Opcodes.LSTORE || opcode == Opcodes.DSTORE ? 2 : 1);
            } else {
                pushValue(StackValue.unknown(), opcode == Opcodes.LLOAD || opcode == Opcodes.DLOAD ? 2 : 1);
            }
        }

        @Override
        public void visitTypeInsn(int opcode, String type) {
            if (opcode == Opcodes.NEW) {
                stack.push(StackValue.unknown());
            } else if (opcode == Opcodes.ANEWARRAY) {
                pop(1);
                stack.push(StackValue.unknown());
            } else if (opcode == Opcodes.CHECKCAST) {
                // CHECKCAST는 기존 Operand Stack 값의 출처 보존
            }
        }

        @Override
        public void visitInsn(int opcode) {
            switch (opcode) {
                case Opcodes.ACONST_NULL, Opcodes.ICONST_M1, Opcodes.ICONST_0, Opcodes.ICONST_1,
                        Opcodes.ICONST_2, Opcodes.ICONST_3, Opcodes.ICONST_4, Opcodes.ICONST_5,
                        Opcodes.FCONST_0, Opcodes.FCONST_1, Opcodes.FCONST_2 -> stack.push(StackValue.unknown());
                case Opcodes.LCONST_0, Opcodes.LCONST_1, Opcodes.DCONST_0, Opcodes.DCONST_1 ->
                        pushValue(StackValue.unknown(), 2);
                case Opcodes.DUP -> stack.push(stack.isEmpty() ? StackValue.unknown() : stack.peek());
                case Opcodes.POP -> pop(1);
                case Opcodes.POP2 -> pop(2);
                case Opcodes.SWAP -> swap();
                case Opcodes.ARETURN, Opcodes.IRETURN, Opcodes.FRETURN, Opcodes.ATHROW -> pop(1);
                case Opcodes.LRETURN, Opcodes.DRETURN -> pop(2);
                default -> {
                }
            }
        }

        @Override
        public void visitIntInsn(int opcode, int operand) {
            if (opcode == Opcodes.NEWARRAY) {
                pop(1);
            }
            stack.push(StackValue.unknown());
        }

        @Override
        public void visitLabel(org.objectweb.asm.Label label) {
            if (exceptionHandlers.contains(label)) {
                stack.clear();
                locals.clear();
                stack.push(StackValue.unknown());
            }
        }

        @Override
        public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitLookupSwitchInsn(
                org.objectweb.asm.Label defaultHandler, int[] keys, org.objectweb.asm.Label[] labels) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitTableSwitchInsn(
                int min, int max, org.objectweb.asm.Label defaultHandler, org.objectweb.asm.Label... labels) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
            if (opcode == Opcodes.GETSTATIC || opcode == Opcodes.GETFIELD) {
                if (opcode == Opcodes.GETFIELD) {
                    pop(1);
                }
                pushValue(StackValue.unknown(), Type.getType(descriptor).getSize());
            } else if (opcode == Opcodes.PUTFIELD) {
                pop(Type.getType(descriptor).getSize());
                pop(1);
            } else {
                pop(Type.getType(descriptor).getSize());
            }
        }

        @Override
        public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean isInterface) {
            List<StackValue> arguments = arguments(descriptor);
            UsagePattern pattern = usagePattern(owner, name, descriptor);
            if (pattern != null) {
                String attributeName = pattern.attributeOperation() ? literal(arguments, 0) : null;
                usages.add(new Usage(pattern.operation(), pattern.sourceKind(), pattern.observationKind(),
                        pattern.apiType(), codeLocation, owner, name, descriptor, attributeName, occurrence++));
            }
            if (opcode != Opcodes.INVOKESTATIC) {
                pop(1);
            }
            Type returnType = Type.getReturnType(descriptor);
            if (!returnType.equals(Type.VOID_TYPE)) {
                pushValue(StackValue.unknown(), returnType.getSize());
            }
        }

        @Override
        public void visitInvokeDynamicInsn(
                String name, String descriptor, org.objectweb.asm.Handle bootstrapMethodHandle,
                Object... bootstrapMethodArguments) {
            arguments(descriptor);
            Type returnType = Type.getReturnType(descriptor);
            if (!returnType.equals(Type.VOID_TYPE)) {
                pushValue(StackValue.unknown(), returnType.getSize());
            }
        }

        @Override
        public void visitTryCatchBlock(org.objectweb.asm.Label start, org.objectweb.asm.Label end,
                                       org.objectweb.asm.Label handler, String type) {
            exceptionHandlers.add(handler);
        }

        @Override
        public void visitMultiANewArrayInsn(String descriptor, int dims) {
            pop(dims);
            stack.push(StackValue.unknown());
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

        private String literal(List<StackValue> values, int index) {
            return index < values.size() ? values.get(index).literal() : null;
        }

        private List<StackValue> arguments(String descriptor) {
            List<Type> types = java.util.Arrays.asList(Type.getArgumentTypes(descriptor));
            List<StackValue> values = new ArrayList<>();
            for (int i = types.size() - 1; i >= 0; i--) {
                values.add(popValue());
                if (types.get(i).getSize() == 2) {
                    pop(1);
                }
            }
            java.util.Collections.reverse(values);
            return values;
        }

        private StackValue popValue() {
            return stack.isEmpty() ? StackValue.unknown() : stack.pop();
        }

        private void pushValue(StackValue value, int slots) {
            stack.push(value);
            if (slots == 2) {
                stack.push(StackValue.unknown());
            }
        }

        private void pop(int count) {
            for (int i = 0; i < count && !stack.isEmpty(); i++) {
                stack.pop();
            }
        }

        private void swap() {
            if (stack.size() < 2) {
                return;
            }
            StackValue first = stack.pop();
            StackValue second = stack.pop();
            stack.push(first);
            stack.push(second);
        }
    }
}
