package com.mapinboot.security.collector;

import com.mapinboot.core.common.error.AdapterDiagnostic;
import com.mapinboot.core.common.error.ErrorCode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.util.ClassUtils;

// ApplicationContext 기반 사용자 Class·Proxy·Lazy Bean 탐색
final class ApplicationClassDiscovery {

    private ApplicationClassDiscovery() {
    }

    static Discovery discover(ApplicationContext applicationContext, String adapterId, String subjectLabel) {
        ConfigurableApplicationContext configurableContext = (ConfigurableApplicationContext) applicationContext;
        ConfigurableListableBeanFactory beanFactory = configurableContext.getBeanFactory();
        List<AdapterDiagnostic> diagnostics = new ArrayList<>();
        Set<Class<?>> targetClasses = new LinkedHashSet<>();
        boolean partial = false;
        for (String beanName : new TreeSet<>(java.util.Arrays.asList(beanFactory.getBeanDefinitionNames()))) {
            try {
                Class<?> targetClass = targetClass(applicationContext, beanFactory, beanName);
                if (targetClass == null) {
                    if (isApplicationBean(beanName, beanFactory)) {
                        partial = true;
                        diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.INVALID_STATE,
                                subjectLabel + " Bean Target Class 조회 불완전: " + beanName));
                    }
                    continue;
                }
                if (targetClass.isSynthetic()) {
                    continue;
                }
                collectTypes(targetClass, targetClasses);
            } catch (RuntimeException exception) {
                partial = true;
                diagnostics.add(new AdapterDiagnostic(adapterId, ErrorCode.ADAPTER_FAILED,
                        subjectLabel + " 대상 Bean 조회 실패: " + beanName));
            }
        }
        return new Discovery(targetClasses, diagnostics, partial);
    }

    static List<Class<?>> sortedClasses(Set<Class<?>> targetClasses) {
        return targetClasses.stream().sorted(Comparator.comparing(Class::getName)).toList();
    }

    static boolean isFrameworkClass(Class<?> type) {
        String name = type.getName();
        return name.startsWith("org.springframework.") || name.startsWith("java.")
                || name.startsWith("jakarta.");
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

    private static boolean isApplicationBean(String beanName, ConfigurableListableBeanFactory beanFactory) {
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

    private static void collectTypes(Class<?> type, Set<Class<?>> targetClasses) {
        if (type == null || type == Object.class || !targetClasses.add(type)) {
            return;
        }
        for (Class<?> interfaceType : type.getInterfaces()) {
            collectTypes(interfaceType, targetClasses);
        }
        collectTypes(type.getSuperclass(), targetClasses);
    }

    record Discovery(Set<Class<?>> targetClasses, List<AdapterDiagnostic> diagnostics, boolean partial) {
        Discovery {
            targetClasses = Set.copyOf(targetClasses);
            diagnostics = List.copyOf(diagnostics);
        }
    }
}
