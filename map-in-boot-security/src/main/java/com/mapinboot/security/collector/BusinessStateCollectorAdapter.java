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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.objectweb.asm.Type;
import org.springframework.context.ApplicationContext;

// 업무 보안 상태 Annotation 선언 수집
public class BusinessStateCollectorAdapter extends AbstractCollectorAdapter {
    private static final String TYPE = "BUSINESS_SECURITY_STATE";

    private final StableIdGenerator idGenerator = new StableIdGenerator();

    public BusinessStateCollectorAdapter() {
        super("security-business-state", "업무 보안 상태 선언 수집", Set.of(TYPE));
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
        String subjectKey = "state|" + handler + "|" + declaringMethod + "|"
                + action + "|" + stateName + "|" + (claim == null ? "" : claim);
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
