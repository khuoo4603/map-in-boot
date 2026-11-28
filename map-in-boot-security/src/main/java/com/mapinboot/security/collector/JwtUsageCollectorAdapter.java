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
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.LinkedList;
import java.util.List;
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

// JWT Claim·서명·검증 코드 패턴의 Fact·Evidence 수집
public class JwtUsageCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "JWT_USAGE";
    private static final String JWT_CLAIMS_BUILDER = "com/nimbusds/jwt/JWTClaimsSet$Builder";
    private static final String JWT_CLAIMS_SET = "com/nimbusds/jwt/JWTClaimsSet";
    private static final String SIGNED_JWT = "com/nimbusds/jwt/SignedJWT";
    private static final String SPRING_JWT = "org/springframework/security/oauth2/jwt/Jwt";
    private static final String JAVA_MAP = "java/util/Map";
    private static final String JWT_DECODER = "org/springframework/security/oauth2/jwt/JwtDecoder";
    private static final String NIMBUS_JWT_DECODER = "org/springframework/security/oauth2/jwt/NimbusJwtDecoder";
    private static final String JWT_DECODERS = "org/springframework/security/oauth2/jwt/JwtDecoders";
    private static final String JWT_VALIDATORS = "org/springframework/security/oauth2/jwt/JwtValidators";
    private static final String JWS_OBJECT = "com/nimbusds/jose/JWSObject";
    private static final Set<String> NIMBUS_VERIFIERS = Set.of(
            "com/nimbusds/jose/crypto/RSASSAVerifier",
            "com/nimbusds/jose/crypto/MACVerifier",
            "com/nimbusds/jose/crypto/ECDSAVerifier",
            "com/nimbusds/jose/crypto/Ed25519Verifier");

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public JwtUsageCollectorAdapter() {
        super("security-jwt-usage", "JWT Claim·서명·검증 코드 패턴 수집", Set.of(TYPE));
    }

    // ApplicationContext Bean 타입 기반 JWT 사용 Bytecode 수집
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
                        "JWT 사용 대상 Bean 조회 실패: " + beanName));
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
                        "JWT 사용 바이트코드 분석 실패: " + targetClass.getName()));
            }
        }

        usages.sort(Comparator.comparing(Usage::codeLocation)
                .thenComparing(Usage::operation)
                .thenComparing(Usage::apiOwner)
                .thenComparing(Usage::apiName)
                .thenComparing(Usage::apiDescriptor)
                .thenComparing(usage -> Objects.toString(usage.claimName(), ""))
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
            if (usage.claimName() != null) {
                attributes.put("claimName", usage.claimName());
            }
            if (usage.verificationKind() != null) {
                attributes.put("verificationKind", usage.verificationKind());
            }
            facts.add(new Fact(
                    idGenerator.generate(context.serviceId(), NodeType.SECURITY_DATA, "fact|" + subjectKey),
                    TYPE,
                    subjectKey,
                    attributes,
                    List.of(evidenceId)));
            evidence.add(new Evidence(evidenceId, EvidenceSource.CODE_PATTERN, usage.codeLocation(),
                    "JWT API 호출 패턴: " + usage.operation()));
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

    // 대상 Class Bytecode 기반 JWT API 호출 패턴 판독
    private ScanResult scan(Class<?> targetClass) {
        String resourceName = targetClass.getName().replace('.', '/') + ".class";
        ClassLoader classLoader = targetClass.getClassLoader();
        InputStream input = classLoader == null
                ? ClassLoader.getSystemResourceAsStream(resourceName)
                : classLoader.getResourceAsStream(resourceName);
        if (input == null) {
            return new ScanResult(List.of(), "JWT 사용 대상 Class 바이트코드 조회 불가: " + targetClass.getName());
        }
        try (input) {
            UsageClassVisitor visitor = new UsageClassVisitor(targetClass.getName());
            new ClassReader(input).accept(visitor, ClassReader.SKIP_FRAMES);
            return new ScanResult(visitor.usages(), null);
        } catch (IOException exception) {
            return new ScanResult(List.of(), "JWT 사용 대상 Class 바이트코드 읽기 실패: " + targetClass.getName());
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
            String apiType,
            String codeLocation,
            String apiOwner,
            String apiName,
            String apiDescriptor,
            String claimName,
            String verificationKind,
            int occurrence
    ) {
        private Usage withClaimName(String claimName) {
            return new Usage(operation, apiType, codeLocation, apiOwner, apiName, apiDescriptor,
                    claimName, verificationKind, occurrence);
        }

        private String subjectKey() {
            return "jwt|" + operation + "|" + codeLocation + "|" + apiOwner + "|"
                    + apiName + "|" + apiDescriptor + "|" + Objects.toString(claimName, "")
                    + "|" + occurrence;
        }
    }

    private record StackValue(String literal, Integer jwtClaimsUsageIndex) {
        private static StackValue unknown() {
            return new StackValue(null, null);
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
            pushValue(value instanceof String string ? new StackValue(string, null) : StackValue.unknown(),
                    value instanceof Long || value instanceof Double ? 2 : 1);
        }

        @Override
        public void visitVarInsn(int opcode, int varIndex) {
            if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.ASTORE) {
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
                stack.push(StackValue.unknown());
            }
        }

        @Override
        public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
            stack.clear();
        }

        @Override
        public void visitLookupSwitchInsn(
                org.objectweb.asm.Label defaultHandler, int[] keys, org.objectweb.asm.Label[] labels) {
            stack.clear();
        }

        @Override
        public void visitTableSwitchInsn(
                int min, int max, org.objectweb.asm.Label defaultHandler, org.objectweb.asm.Label... labels) {
            stack.clear();
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
            StackValue receiver = opcode == Opcodes.INVOKESTATIC ? null : peek();
            List<String> argumentLiterals = arguments.stream().map(StackValue::literal).toList();
            String claimName = claimName(owner, name, argumentLiterals);
            String operation = operation(owner, name);
            int usageIndex = -1;
            if (operation != null) {
                String verificationKind = verificationKind(owner, name);
                usageIndex = usages.size();
                usages.add(new Usage(operation, apiType(owner), codeLocation, owner, name, descriptor,
                        claimName, verificationKind, occurrence++));
            }
            if (JAVA_MAP.equals(owner) && "get".equals(name) && receiver != null
                    && receiver.jwtClaimsUsageIndex() != null && !argumentLiterals.isEmpty()) {
                attachClaimName(receiver.jwtClaimsUsageIndex(), argumentLiterals.get(0));
            }
            if (opcode != Opcodes.INVOKESTATIC) {
                pop(1);
            }
            Type returnType = Type.getReturnType(descriptor);
            if (!returnType.equals(Type.VOID_TYPE)) {
                StackValue returnValue = isJwtClaimsMap(owner, name, usageIndex)
                        ? new StackValue(null, usageIndex)
                        : StackValue.unknown();
                pushValue(returnValue, returnType.getSize());
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

        private List<StackValue> arguments(String descriptor) {
            List<Type> types = java.util.Arrays.asList(Type.getArgumentTypes(descriptor));
            List<StackValue> values = new ArrayList<>();
            for (int i = types.size() - 1; i >= 0; i--) {
                values.add(stack.isEmpty() ? StackValue.unknown() : stack.pop());
                if (types.get(i).getSize() == 2) {
                    pop(1);
                }
            }
            java.util.Collections.reverse(values);
            return values;
        }

        private StackValue peek() {
            return stack.isEmpty() ? StackValue.unknown() : stack.peek();
        }

        private void pushValue(StackValue value, int slots) {
            stack.push(value);
            if (slots == 2) {
                stack.push(StackValue.unknown());
            }
        }

        private boolean isJwtClaimsMap(String owner, String name, int usageIndex) {
            return usageIndex >= 0 && "getClaims".equals(name)
                    && (SPRING_JWT.equals(owner) || JWT_CLAIMS_SET.equals(owner));
        }

        private void attachClaimName(int usageIndex, String claimName) {
            if (claimName == null || usageIndex < 0 || usageIndex >= usages.size()) {
                return;
            }
            Usage usage = usages.get(usageIndex);
            if (usage.claimName() == null) {
                usages.set(usageIndex, usage.withClaimName(claimName));
            }
        }

        private String claimName(String owner, String name, List<String> arguments) {
            if (JWT_CLAIMS_BUILDER.equals(owner)) {
                return switch (name) {
                    case "subject" -> "sub";
                    case "issuer" -> "iss";
                    case "audience" -> "aud";
                    case "claim" -> arguments.isEmpty() ? null : arguments.get(0);
                    default -> null;
                };
            }
            if (SPRING_JWT.equals(owner) || JWT_CLAIMS_SET.equals(owner)) {
                if ("getSubject".equals(name)) {
                    return "sub";
                }
                if ("getClaim".equals(name)) {
                    return arguments.isEmpty() ? null : arguments.get(0);
                }
            }
            return null;
        }

        private String operation(String owner, String name) {
            if (JWT_CLAIMS_BUILDER.equals(owner)
                    && Set.of("subject", "issuer", "audience", "claim").contains(name)) {
                return "WRITE";
            }
            if ((SPRING_JWT.equals(owner) || JWT_CLAIMS_SET.equals(owner))
                    && Set.of("getSubject", "getClaim", "getClaims").contains(name)) {
                return "READ";
            }
            if (SIGNED_JWT.equals(owner) && "sign".equals(name)) {
                return "SIGN";
            }
            if (SIGNED_JWT.equals(owner) && "verify".equals(name)) {
                return "VERIFY";
            }
            if (JWT_DECODER.equals(owner) && "decode".equals(name)) {
                return "VERIFY";
            }
            if (NIMBUS_JWT_DECODER.equals(owner) && "decode".equals(name)) {
                return "VERIFY";
            }
            if (NIMBUS_JWT_DECODER.equals(owner) && name.startsWith("with")) {
                return "VERIFY_CONFIGURATION";
            }
            if (JWT_DECODERS.equals(owner) && name.startsWith("from")) {
                return "VERIFY_CONFIGURATION";
            }
            if (JWT_VALIDATORS.equals(owner) && name.startsWith("create")) {
                return "VERIFY_CONFIGURATION";
            }
            if (NIMBUS_JWT_DECODER.equals(owner) && "setJwtValidator".equals(name)) {
                return "VERIFY_CONFIGURATION";
            }
            if (owner.startsWith(NIMBUS_JWT_DECODER + "$") && "build".equals(name)) {
                return "VERIFY_CONFIGURATION";
            }
            if (JWS_OBJECT.equals(owner) && "verify".equals(name)) {
                return "VERIFY";
            }
            if (NIMBUS_VERIFIERS.contains(owner) && "<init>".equals(name)) {
                return "VERIFY_CONFIGURATION";
            }
            return null;
        }

        private String verificationKind(String owner, String name) {
            if ("VERIFY".equals(operation(owner, name))) {
                return "INVOCATION";
            }
            if ("VERIFY_CONFIGURATION".equals(operation(owner, name))) {
                return "CONFIGURATION";
            }
            return null;
        }

        private String apiType(String owner) {
            if (JWT_CLAIMS_BUILDER.equals(owner)) {
                return "NIMBUS_CLAIMS_BUILDER";
            }
            if (JWT_CLAIMS_SET.equals(owner)) {
                return "NIMBUS_CLAIMS_SET";
            }
            if (SPRING_JWT.equals(owner)) {
                return "SPRING_SECURITY_JWT";
            }
            if (SIGNED_JWT.equals(owner)) {
                return "NIMBUS_SIGNED_JWT";
            }
            if (JWT_DECODER.equals(owner)) {
                return "SPRING_SECURITY_JWT_DECODER";
            }
            if (NIMBUS_JWT_DECODER.equals(owner) || owner.startsWith(NIMBUS_JWT_DECODER + "$")) {
                return "SPRING_SECURITY_NIMBUS_DECODER";
            }
            if (JWT_DECODERS.equals(owner) || JWT_VALIDATORS.equals(owner)) {
                return "SPRING_SECURITY_JWT_VALIDATION";
            }
            if (JWS_OBJECT.equals(owner) || NIMBUS_VERIFIERS.contains(owner)) {
                return "NIMBUS_JWS_VERIFICATION";
            }
            return "SPRING_SECURITY_NIMBUS_DECODER";
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
