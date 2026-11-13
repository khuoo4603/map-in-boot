package com.mapinboot.security.collector;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import io.github.classgraph.ClassGraph;
import io.github.classgraph.ClassInfo;
import io.github.classgraph.ScanResult;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.util.ClassUtils;

// 등록 Bean·Handler 기반 제한적 ClassGraph 후보 탐색
final class ApplicationClassDiscovery {
    private static final String HANDLER_MAPPING_TYPE =
            "org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping";

    private ApplicationClassDiscovery() {
    }

    static Discovery discover(ApplicationContext applicationContext, String adapterId, String subjectLabel) {
        ConfigurableApplicationContext configurableContext = (ConfigurableApplicationContext) applicationContext;
        ConfigurableListableBeanFactory beanFactory = configurableContext.getBeanFactory();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Set<Class<?>> targetClasses = new LinkedHashSet<>();
        Set<String> candidateClassNames = new TreeSet<>();
        Set<String> acceptedPackages = new TreeSet<>();
        boolean partial = false;
        int beanStartPoints = 0;
        int handlerStartPoints = 0;

        for (String beanName : new TreeSet<>(Arrays.asList(beanFactory.getBeanDefinitionNames()))) {
            beanStartPoints++;
            try {
                Class<?> targetClass = targetClass(applicationContext, beanFactory, beanName);
                String beanClassName = beanClassName(beanFactory, beanName);
                if (targetClass == null) {
                    if (isApplicationClassName(beanClassName)) {
                        candidateClassNames.add(beanClassName);
                        addPackage(beanClassName, acceptedPackages);
                    } else if (isApplicationBean(beanName, beanFactory)) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.INVALID_STATE,
                                subjectLabel + " Bean Target Class 조회 불완전: " + beanName));
                    }
                    continue;
                }
                if (targetClass.isSynthetic()) {
                    continue;
                }
                addCandidate(targetClass, targetClasses, candidateClassNames, acceptedPackages);
                if (isApplicationClassName(beanClassName)) {
                    candidateClassNames.add(beanClassName);
                    addPackage(beanClassName, acceptedPackages);
                }
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.ADAPTER_FAILED,
                        subjectLabel + " 대상 Bean 조회 실패: " + beanName));
            }
        }

        HandlerDiscovery handlerDiscovery = discoverHandlers(
                applicationContext, beanFactory, targetClasses, candidateClassNames, acceptedPackages, diagnostics,
                adapterId, subjectLabel);
        handlerStartPoints += handlerDiscovery.startPoints();
        partial |= handlerDiscovery.partial();

        ScanMetrics metrics = new ScanMetrics(
                acceptedPackages, beanStartPoints, handlerStartPoints, 0, 0, 0, 0);
        if (candidateClassNames.isEmpty() || acceptedPackages.isEmpty()) {
            return new Discovery(targetClasses, candidateClassNames, diagnostics, partial, metrics);
        }

        ClassLoader classLoader = classLoader(applicationContext, targetClasses);
        if (classLoader == null) {
            partial = true;
            diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.INVALID_STATE,
                    subjectLabel + " 후보 ClassLoader 조회 불완전"));
            return new Discovery(targetClasses, candidateClassNames, diagnostics, partial, metrics);
        }

        long startedAt = System.nanoTime();
        int metadataClassCount = 0;
        int metadataCandidateCount = 0;
        int loadedCandidateCount = 0;
        try (ScanResult scanResult = new ClassGraph()
                .enableClassInfo()
                .ignoreClassVisibility()
                .enableClassLoaders(classLoader)
                .ignoreParentClassLoaders()
                .acceptPackages(acceptedPackages.toArray(String[]::new))
                .scan()) {
            metadataClassCount = scanResult.getAllClasses().size();
            for (String candidateClassName : candidateClassNames) {
                ClassInfo classInfo = scanResult.getClassInfo(candidateClassName);
                if (classInfo == null) {
                    continue;
                }
                metadataCandidateCount++;
                Class<?> candidateClass = loadWithoutInitialization(classInfo.getName(), classLoader);
                if (candidateClass == null) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.INVALID_STATE,
                            subjectLabel + " 후보 Class 로딩 불가: " + candidateClassName));
                    continue;
                }
                if (candidateClass.isSynthetic()) {
                    continue;
                }
                addCandidate(candidateClass, targetClasses, candidateClassNames, acceptedPackages);
                loadedCandidateCount++;
            }
        } catch (RuntimeException | LinkageError exception) {
            partial = true;
            diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.ADAPTER_FAILED,
                    subjectLabel + " ClassGraph 후보 탐색 실패"));
        }
        long scanDurationMillis = (System.nanoTime() - startedAt) / 1_000_000;
        metrics = new ScanMetrics(
                acceptedPackages, beanStartPoints, handlerStartPoints, metadataClassCount,
                metadataCandidateCount, loadedCandidateCount, scanDurationMillis);
        return new Discovery(targetClasses, candidateClassNames, diagnostics, partial, metrics);
    }

    static List<Class<?>> sortedClasses(Set<Class<?>> targetClasses) {
        return targetClasses.stream().sorted(Comparator.comparing(Class::getName)).toList();
    }

    static boolean isFrameworkClass(Class<?> type) {
        return isFrameworkClassName(type.getName());
    }

    private static Class<?> targetClass(
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

    private static String beanClassName(ConfigurableListableBeanFactory beanFactory, String beanName) {
        try {
            return beanFactory.getBeanDefinition(beanName).getBeanClassName();
        } catch (RuntimeException exception) {
            return null;
        }
    }

    private static boolean isApplicationBean(String beanName, ConfigurableListableBeanFactory beanFactory) {
        if (beanName.startsWith("org.springframework.")) {
            return false;
        }
        String beanClassName = beanClassName(beanFactory, beanName);
        return !isFrameworkClassName(beanClassName);
    }

    private static void addCandidate(
            Class<?> type,
            Set<Class<?>> targetClasses,
            Set<String> candidateClassNames,
            Set<String> acceptedPackages
    ) {
        if (type == null || isFrameworkClass(type)) {
            return;
        }
        candidateClassNames.add(type.getName());
        addPackage(type.getName(), acceptedPackages);
        collectTypes(type, targetClasses);
    }

    private static void collectTypes(Class<?> type, Set<Class<?>> targetClasses) {
        if (type == null || type == Object.class || !targetClasses.add(type)) {
            return;
        }
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectTypes(interfaceType, targetClasses);
        }
        collectTypes(type.getSuperclass(), targetClasses);
    }

    private static HandlerDiscovery discoverHandlers(
            ApplicationContext applicationContext,
            ConfigurableListableBeanFactory beanFactory,
            Set<Class<?>> targetClasses,
            Set<String> candidateClassNames,
            Set<String> acceptedPackages,
            List<AdapterDiagnostic> diagnostics,
            String adapterId,
            String subjectLabel
    ) {
        ClassLoader classLoader = classLoader(applicationContext, targetClasses);
        if (classLoader == null) {
            return new HandlerDiscovery(0, false);
        }
        Class<?> mappingType;
        try {
            mappingType = Class.forName(HANDLER_MAPPING_TYPE, false, classLoader);
        } catch (ClassNotFoundException | LinkageError exception) {
            return new HandlerDiscovery(0, false);
        }

        int startPoints = 0;
        boolean partial = false;
        String[] beanNames = beanFactory.getBeanNamesForType(mappingType, true, false);
        Arrays.sort(beanNames);
        for (String beanName : beanNames) {
            Object singleton = beanFactory.getSingleton(beanName);
            if (singleton == null) {
                continue;
            }
            try {
                Method getHandlerMethods = mappingType.getMethod("getHandlerMethods");
                Object handlerMethods = getHandlerMethods.invoke(singleton);
                if (!(handlerMethods instanceof Map<?, ?> mappings)) {
                    partial = true;
                    diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.INVALID_STATE,
                            subjectLabel + " HandlerMapping 구조 확인 불가: " + beanName));
                    continue;
                }
                for (Object handlerMethod : mappings.values()) {
                    if (handlerMethod == null) {
                        continue;
                    }
                    Method getBeanType = handlerMethod.getClass().getMethod("getBeanType");
                    Object beanType = getBeanType.invoke(handlerMethod);
                    if (beanType instanceof Class<?> handlerClass && !handlerClass.isSynthetic()) {
                        startPoints++;
                        addCandidate(handlerClass, targetClasses, candidateClassNames, acceptedPackages);
                    }
                }
            } catch (ReflectiveOperationException | RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.ADAPTER_FAILED,
                        subjectLabel + " HandlerMapping 후보 조회 실패: " + beanName));
            }
        }
        return new HandlerDiscovery(startPoints, partial);
    }

    private static ClassLoader classLoader(ApplicationContext applicationContext, Set<Class<?>> targetClasses) {
        Set<ClassLoader> candidates = new LinkedHashSet<>();
        if (Thread.currentThread().getContextClassLoader() != null) {
            candidates.add(Thread.currentThread().getContextClassLoader());
        }
        if (applicationContext.getClassLoader() != null) {
            candidates.add(applicationContext.getClassLoader());
        }
        targetClasses.stream().map(Class::getClassLoader).filter(loader -> loader != null).forEach(candidates::add);
        ClassLoader best = null;
        int bestVisibleCount = -1;
        for (ClassLoader candidate : candidates) {
            int visibleCount = 0;
            for (Class<?> targetClass : targetClasses) {
                if (canLoad(candidate, targetClass.getName())) {
                    visibleCount++;
                }
            }
            if (visibleCount > bestVisibleCount) {
                best = candidate;
                bestVisibleCount = visibleCount;
            }
        }
        return best;
    }

    private static boolean canLoad(ClassLoader classLoader, String className) {
        try {
            Class.forName(className, false, classLoader);
            return true;
        } catch (ClassNotFoundException | LinkageError exception) {
            return false;
        }
    }

    private static Class<?> loadWithoutInitialization(String className, ClassLoader classLoader) {
        try {
            return Class.forName(className, false, classLoader);
        } catch (ClassNotFoundException | LinkageError exception) {
            return null;
        }
    }

    private static boolean isApplicationClassName(String className) {
        return className != null && !className.isBlank() && !isFrameworkClassName(className);
    }

    private static boolean isFrameworkClassName(String className) {
        return className != null && (className.startsWith("org.springframework.")
                || className.startsWith("java.")
                || className.startsWith("jakarta.")
                || className.startsWith("io.github.classgraph."));
    }

    private static void addPackage(String className, Set<String> acceptedPackages) {
        if (!isApplicationClassName(className)) {
            return;
        }
        int separator = className.lastIndexOf('.');
        if (separator > 0) {
            acceptedPackages.add(className.substring(0, separator));
        }
    }

    record Discovery(
            Set<Class<?>> targetClasses,
            Set<String> candidateClassNames,
            List<AdapterDiagnostic> diagnostics,
            boolean partial,
            ScanMetrics metrics
    ) {
        Discovery {
            targetClasses = Set.copyOf(targetClasses);
            candidateClassNames = Set.copyOf(candidateClassNames);
            diagnostics = List.copyOf(diagnostics);
        }
    }

    record ScanMetrics(
            Set<String> acceptedPackages,
            int beanStartPoints,
            int handlerStartPoints,
            int metadataClassCount,
            int metadataCandidateCount,
            int loadedCandidateCount,
            long scanDurationMillis
    ) {
        ScanMetrics {
            acceptedPackages = Set.copyOf(acceptedPackages);
        }
    }

    private record HandlerDiscovery(int startPoints, boolean partial) {
    }
}
