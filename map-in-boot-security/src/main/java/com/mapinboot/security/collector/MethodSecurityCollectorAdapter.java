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
import jakarta.annotation.security.RolesAllowed;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.aop.PointcutAdvisor;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.BridgeMethodResolver;
import org.springframework.security.authorization.method.AuthorizationManagerAfterMethodInterceptor;
import org.springframework.security.authorization.method.AuthorizationManagerBeforeMethodInterceptor;
import org.springframework.security.authorization.method.Jsr250AuthorizationManager;
import org.springframework.security.authorization.method.PostAuthorizeAuthorizationManager;
import org.springframework.security.authorization.method.PreAuthorizeAuthorizationManager;
import org.springframework.security.authorization.method.SecuredAuthorizationManager;
import org.springframework.security.access.annotation.Secured;
import org.springframework.security.access.prepost.PostAuthorize;
import org.springframework.security.access.prepost.PreAuthorize;

// Method Security 선언과 등록된 Advisor·Proxy 구조 수집기
public class MethodSecurityCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "METHOD_AUTHORIZATION";
    private static final Pattern HAS_AUTHORITY = Pattern.compile(
            "^hasAuthority\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)$");
    private static final Pattern HAS_ROLE = Pattern.compile(
            "^hasRole\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)$");

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public MethodSecurityCollectorAdapter() {
        super("security-method-authorization", "Method Security 선언 및 Proxy 적용 가능 구조 수집", Set.of(TYPE));
    }

    @Override
    public CollectionResult collect(CollectionContext context) {
        if (context == null || context.applicationContext() == null || isBlank(context.serviceId())) {
            return unavailable("수집 실행 문맥 또는 서비스 식별 정보 부재");
        }

        ApplicationContext applicationContext = context.applicationContext();
        if (!(applicationContext instanceof ConfigurableApplicationContext configurableContext)) {
            return unavailable("ConfigurableApplicationContext 미지원");
        }

        ConfigurableListableBeanFactory beanFactory = configurableContext.getBeanFactory();
        AdvisorScan advisorScan = methodSecurityAdvisors(beanFactory);
        List<AdvisorInfo> advisors = advisorScan.advisors();
        List<Fact> facts = new ArrayList<>();
        List<Evidence> evidence = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>(advisorScan.diagnostics());
        boolean partial = advisorScan.partial();

        for (String beanName : beanFactory.getBeanDefinitionNames()) {
            try {
                BeanInfo bean = beanInfo(applicationContext, beanFactory, beanName);
                if (bean.targetClass() == null) {
                    if (isRelevantUnknownBean(beanFactory, beanName)) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                                "Bean Target Class 조회 불확실: " + beanName));
                    }
                    continue;
                }
                if (bean.targetClass().getName().startsWith("org.springframework.")) {
                    continue;
                }
                CollectionState state = collectBean(
                        context.serviceId(), bean, advisors, facts, evidence, diagnostics);
                partial |= state.partial();
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.ADAPTER_FAILED,
                        "Method Security Bean 등록 정보 처리 실패: " + beanName));
            }
        }

        AnalysisStatus status = partial ? AnalysisStatus.PARTIAL : AnalysisStatus.READY;
        return new CollectionResult(id(), facts, evidence,
                status, diagnostics);
    }

    // 초기화를 유발하지 않는 기존 Bean·정적 Type 정보 확인
    private BeanInfo beanInfo(
            ApplicationContext applicationContext, ConfigurableListableBeanFactory beanFactory, String beanName) {
        Object singleton = beanFactory.getSingleton(beanName);
        if (singleton != null) {
            Class<?> targetClass = AopUtils.getTargetClass(singleton);
            return new BeanInfo(beanName, targetClass, singleton, true, AopUtils.isAopProxy(singleton));
        }
        return new BeanInfo(beanName, applicationContext.getType(beanName, false), null, false, false);
    }

    private boolean isRelevantUnknownBean(ConfigurableListableBeanFactory beanFactory, String beanName) {
        if (beanName.startsWith("org.springframework.")) {
            return false;
        }
        try {
            BeanDefinition definition = beanFactory.getBeanDefinition(beanName);
            String beanClassName = definition.getBeanClassName();
            if (beanClassName != null) {
                return !beanClassName.startsWith("org.springframework.");
            }
            String factoryBeanName = definition.getFactoryBeanName();
            return factoryBeanName != null && !factoryBeanName.startsWith("org.springframework.");
        } catch (RuntimeException exception) {
            return true;
        }
    }

    private CollectionState collectBean(
            String serviceId,
            BeanInfo bean,
            List<AdvisorInfo> advisors,
            List<Fact> facts,
            List<Evidence> evidence,
            List<AdapterDiagnostic> diagnostics
    ) {
        boolean partial = false;
        List<Method> methods = Arrays.stream(bean.targetClass().getMethods())
                .filter(method -> !method.isBridge() && !method.isSynthetic())
                .sorted(Comparator.comparing(this::methodSignature))
                .toList();
        for (Method method : methods) {
            for (Declaration declaration : declarations(bean.targetClass(), method)) {
                List<AdvisorInfo> matchingAdvisors = matchingAdvisors(
                        advisors, declaration, method, bean.targetClass());
                if (matchingAdvisors.isEmpty()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Method Security Advisor 적용 여부 미확인: " + handler(bean.targetClass(), method)));
                }
                if (!bean.instantiated()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "Lazy Bean Proxy 적용 여부 미확인: " + bean.beanName()));
                } else if (!bean.proxyDetected()) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                            "보호 대상 Bean AOP Proxy 미확인: " + bean.beanName()));
                }
                addFact(serviceId, bean, method, declaration, matchingAdvisors, facts, evidence);
            }
        }
        return new CollectionState(partial);
    }

    private List<Declaration> declarations(Class<?> targetClass, Method method) {
        Map<String, Declaration> declarations = new LinkedHashMap<>();
        for (Method candidate : methodCandidates(targetClass, method)) {
            addDeclarations(declarations, directDeclarations(candidate, "METHOD"));
        }
        for (Class<?> candidate : classCandidates(targetClass)) {
            addDeclarations(declarations, directDeclarations(candidate, "TYPE"));
        }
        return List.copyOf(declarations.values());
    }

    private void addDeclarations(Map<String, Declaration> declarations, List<Declaration> candidates) {
        for (Declaration candidate : candidates) {
            declarations.putIfAbsent(candidate.annotationType(), candidate);
        }
    }

    private List<Declaration> directDeclarations(Object element, String declarationKind) {
        List<Declaration> declarations = new ArrayList<>();
        addDeclaration(element, declarationKind, PreAuthorize.class, "PRE_AUTHORIZE", declarations);
        addDeclaration(element, declarationKind, PostAuthorize.class, "POST_AUTHORIZE", declarations);
        addDeclaration(element, declarationKind, Secured.class, "SECURED", declarations);
        addDeclaration(element, declarationKind, RolesAllowed.class, "ROLES_ALLOWED", declarations);
        return declarations;
    }

    private <A extends Annotation> void addDeclaration(
            Object element,
            String declarationKind,
            Class<A> annotationType,
            String annotationName,
            List<Declaration> declarations
    ) {
        A annotation = annotation(element, annotationType);
        if (annotation == null) {
            return;
        }
        String declaringClass = element instanceof Method method
                ? method.getDeclaringClass().getName()
                : ((Class<?>) element).getName();
        declarations.add(new Declaration(
                annotationName, declarationKind, declaringClass, annotationValue(annotation), expressionKind(annotation)));
    }

    private <A extends Annotation> A annotation(Object element, Class<A> annotationType) {
        if (element instanceof Method method) {
            return method.getDeclaredAnnotation(annotationType);
        }
        return ((Class<?>) element).getDeclaredAnnotation(annotationType);
    }

    private String annotationValue(Annotation annotation) {
        if (annotation instanceof PreAuthorize preAuthorize) {
            return preAuthorize.value();
        }
        if (annotation instanceof PostAuthorize postAuthorize) {
            return postAuthorize.value();
        }
        if (annotation instanceof Secured secured) {
            return String.join(",", Arrays.stream(secured.value()).sorted().toList());
        }
        RolesAllowed rolesAllowed = (RolesAllowed) annotation;
        return String.join(",", Arrays.stream(rolesAllowed.value()).sorted().toList());
    }

    private String expressionKind(Annotation annotation) {
        if (annotation instanceof Secured) {
            return "SECURED";
        }
        if (annotation instanceof RolesAllowed) {
            return "ROLES_ALLOWED";
        }
        String expression = annotationValue(annotation);
        if (HAS_AUTHORITY.matcher(expression).matches()) {
            return "HAS_AUTHORITY";
        }
        if (HAS_ROLE.matcher(expression).matches()) {
            return "HAS_ROLE";
        }
        return "EXPRESSION";
    }

    private void addFact(
            String serviceId,
            BeanInfo bean,
            Method method,
            Declaration declaration,
            List<AdvisorInfo> matchingAdvisors,
            List<Fact> facts,
            List<Evidence> evidence
    ) {
        String handler = handler(bean.targetClass(), method);
        String subjectKey = "method|" + bean.beanName() + "|" + handler + "|"
                + declaration.annotationType() + "|" + declaration.declarationKind() + "|"
                + declaration.declaringClass() + "|" + declaration.value();
        Map<String, String> attributes = new TreeMap<>();
        attributes.put("annotationType", declaration.annotationType());
        attributes.put("beanName", bean.beanName());
        attributes.put("declarationKind", declaration.declarationKind());
        attributes.put("declaringClass", declaration.declaringClass());
        attributes.put("expressionKind", declaration.expressionKind());
        attributes.put("handler", handler);
        attributes.put("methodSignature", methodSignature(method));
        attributes.put("policySource", "METHOD");
        attributes.put("targetClass", bean.targetClass().getName());
        if (bean.instantiated()) {
            attributes.put("proxyDetected", Boolean.toString(bean.proxyDetected()));
            if (bean.proxyDetected()) {
                attributes.put("proxyKind", proxyKind(bean.bean()));
            }
        }
        requiredAuthority(declaration).ifPresent(value -> attributes.put("requiredAuthority", value));
        if (!matchingAdvisors.isEmpty()) {
            attributes.put("methodSecurityInfrastructure", matchingAdvisors.stream()
                    .map(AdvisorInfo::beanName).sorted().collect(java.util.stream.Collectors.joining(",")));
        }

        List<String> evidenceIds = new ArrayList<>();
        String declarationEvidenceId = evidenceId(serviceId, "declaration", subjectKey);
        evidenceIds.add(declarationEvidenceId);
        evidence.add(new Evidence(declarationEvidenceId, EvidenceSource.DECLARATION,
                declaration.declaringClass() + ":" + handler,
                "Method Security 선언: " + declaration.annotationType()));
        if (!matchingAdvisors.isEmpty()) {
            String metadataEvidenceId = evidenceId(serviceId, "metadata", subjectKey);
            evidenceIds.add(metadataEvidenceId);
            evidence.add(new Evidence(metadataEvidenceId, EvidenceSource.SPRING_METADATA,
                    String.join(",", matchingAdvisors.stream().map(AdvisorInfo::beanName).sorted().toList()),
                    "Method Security Advisor 적용 가능 구조 확인"));
        }
        if (bean.instantiated() && bean.proxyDetected()) {
            String runtimeEvidenceId = evidenceId(serviceId, "runtime", subjectKey);
            evidenceIds.add(runtimeEvidenceId);
            evidence.add(new Evidence(runtimeEvidenceId, EvidenceSource.RUNTIME, bean.beanName(),
                    "Spring AOP Proxy 및 Target Class 확인"));
        }
        facts.add(new Fact(idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "fact|" + subjectKey),
                TYPE, subjectKey, attributes, evidenceIds));
    }

    private AdvisorScan methodSecurityAdvisors(ConfigurableListableBeanFactory beanFactory) {
        List<AdvisorInfo> advisors = new ArrayList<>();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        boolean partial = false;
        for (String beanName : beanFactory.getBeanNamesForType(PointcutAdvisor.class, false, false)) {
            Object bean = beanFactory.getSingleton(beanName);
            if (!(bean instanceof PointcutAdvisor advisor)) {
                continue;
            }
            try {
                Optional<String> annotationType = methodSecurityAdvisorType(advisor);
                if (annotationType.isPresent()) {
                    advisors.add(new AdvisorInfo(beanName, advisor, annotationType.get()));
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE,
                        "Method Security Advisor 유형 확인 실패: " + beanName));
            }
        }
        return new AdvisorScan(
                advisors.stream().sorted(Comparator.comparing(AdvisorInfo::beanName)).toList(), diagnostics, partial);
    }

    private Optional<String> methodSecurityAdvisorType(PointcutAdvisor advisor) {
        return methodSecurityAdvisorType(advisor, java.util.Collections.newSetFromMap(new IdentityHashMap<>()));
    }

    private Optional<String> methodSecurityAdvisorType(Object candidate, Set<Object> visited) {
        if (candidate == null || !visited.add(candidate)) {
            return Optional.empty();
        }
        if (candidate instanceof AuthorizationManagerBeforeMethodInterceptor before) {
            Object manager = readField(before, "authorizationManager");
            if (manager instanceof PreAuthorizeAuthorizationManager) {
                return Optional.of("PRE_AUTHORIZE");
            }
            if (manager instanceof SecuredAuthorizationManager) {
                return Optional.of("SECURED");
            }
            if (manager instanceof Jsr250AuthorizationManager) {
                return Optional.of("ROLES_ALLOWED");
            }
            return Optional.empty();
        }
        if (candidate instanceof AuthorizationManagerAfterMethodInterceptor after) {
            Object manager = readField(after, "authorizationManager");
            return manager instanceof PostAuthorizeAuthorizationManager
                    ? Optional.of("POST_AUTHORIZE")
                    : Optional.empty();
        }
        if (candidate instanceof Supplier<?> supplier) {
            return methodSecurityAdvisorType(supplier.get(), visited);
        }
        Object wrappedAdvisor = readField(candidate, "advisor");
        if (wrappedAdvisor != null) {
            return methodSecurityAdvisorType(wrappedAdvisor, visited);
        }
        Object deferredDelegate = readField(candidate, "delegate");
        return deferredDelegate == null
                ? Optional.empty()
                : methodSecurityAdvisorType(deferredDelegate, visited);
    }

    private List<AdvisorInfo> matchingAdvisors(
            List<AdvisorInfo> advisors, Declaration declaration, Method method, Class<?> targetClass) {
        return advisors.stream().filter(info -> {
            if (!info.annotationType().equals(declaration.annotationType())) {
                return false;
            }
            try {
                return info.advisor().getPointcut().getMethodMatcher().matches(method, targetClass);
            } catch (RuntimeException exception) {
                return false;
            }
        }).toList();
    }

    private Object readField(Object target, String name) {
        try {
            Field field = target.getClass().getDeclaredField(name);
            if (!field.trySetAccessible()) {
                return null;
            }
            return field.get(target);
        } catch (ReflectiveOperationException | SecurityException exception) {
            return null;
        }
    }

    private List<Method> methodCandidates(Class<?> targetClass, Method method) {
        LinkedHashSet<Method> methods = new LinkedHashSet<>();
        collectMethods(targetClass, method.getName(), method.getParameterTypes(), methods, new LinkedHashSet<>());
        methods.add(BridgeMethodResolver.findBridgedMethod(method));
        return List.copyOf(methods);
    }

    private void collectMethods(
            Class<?> type, String name, Class<?>[] parameterTypes, Set<Method> methods, Set<Class<?>> visited) {
        if (type == null || type == Object.class || !visited.add(type)) {
            return;
        }
        try {
            methods.add(BridgeMethodResolver.findBridgedMethod(type.getDeclaredMethod(name, parameterTypes)));
        } catch (NoSuchMethodException ignored) {
            // 상위 타입의 동일 시그니처 탐색 계속
        }
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectMethods(interfaceType, name, parameterTypes, methods, visited);
        }
        collectMethods(type.getSuperclass(), name, parameterTypes, methods, visited);
    }

    private List<Class<?>> classCandidates(Class<?> targetClass) {
        LinkedHashSet<Class<?>> classes = new LinkedHashSet<>();
        collectClasses(targetClass, classes, new LinkedHashSet<>());
        return List.copyOf(classes);
    }

    private void collectClasses(Class<?> type, Set<Class<?>> classes, Set<Class<?>> visited) {
        if (type == null || type == Object.class || !visited.add(type)) {
            return;
        }
        classes.add(type);
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectClasses(interfaceType, classes, visited);
        }
        collectClasses(type.getSuperclass(), classes, visited);
    }

    private java.util.Optional<String> requiredAuthority(Declaration declaration) {
        if ("SECURED".equals(declaration.expressionKind()) || "ROLES_ALLOWED".equals(declaration.expressionKind())) {
            return java.util.Optional.of(declaration.value());
        }
        Matcher matcher = HAS_AUTHORITY.matcher(declaration.value());
        if (matcher.matches()) {
            return java.util.Optional.of(matcher.group(1));
        }
        matcher = HAS_ROLE.matcher(declaration.value());
        return matcher.matches() ? java.util.Optional.of(matcher.group(1)) : java.util.Optional.empty();
    }

    private String evidenceId(String serviceId, String evidenceKind, String subjectKey) {
        return idGenerator.generate(serviceId, NodeType.AUTHORIZATION, "evidence|" + evidenceKind + "|" + subjectKey);
    }

    private String handler(Class<?> targetClass, Method method) {
        return targetClass.getName() + "#" + methodSignature(method);
    }

    private String methodSignature(Method method) {
        return method.getName() + "(" + Arrays.stream(method.getParameterTypes())
                .map(Class::getName).collect(java.util.stream.Collectors.joining(",")) + ")";
    }

    private String proxyKind(Object bean) {
        if (AopUtils.isJdkDynamicProxy(bean)) {
            return "JDK";
        }
        if (AopUtils.isCglibProxy(bean)) {
            return "CGLIB";
        }
        return "AOP";
    }

    private CollectionResult unavailable(String summary) {
        return new CollectionResult(id(), List.of(), List.of(), AnalysisStatus.UNKNOWN,
                List.of(new AdapterDiagnostic(id(), ErrorCode.INVALID_STATE, summary)));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record BeanInfo(
            String beanName, Class<?> targetClass, Object bean, boolean instantiated, boolean proxyDetected) {
    }

    private record AdvisorInfo(String beanName, PointcutAdvisor advisor, String annotationType) {
    }

    private record AdvisorScan(
            List<AdvisorInfo> advisors, List<AdapterDiagnostic> diagnostics, boolean partial) {
    }

    private record Declaration(
            String annotationType, String declarationKind, String declaringClass, String value, String expressionKind) {
    }

    private record CollectionState(boolean partial) {
    }
}
