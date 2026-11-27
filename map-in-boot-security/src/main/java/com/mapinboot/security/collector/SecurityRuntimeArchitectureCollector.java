package com.mapinboot.security.collector;

import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.common.type.NodeType;
import com.mapinboot.core.evidence.Fact;
import com.mapinboot.core.graph.StableIdGenerator;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.CoverageState;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeComponent;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeCoverage;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEvidence;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeRelationship;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureAssembler;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureCollector;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitectureContribution;
import jakarta.servlet.Filter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.DefaultSecurityFilterChain;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.savedrequest.RequestCache;
import org.springframework.security.web.util.matcher.RequestMatcher;

// 실제 FilterChainProxy·인증 및 Security Context 객체 수집
public class SecurityRuntimeArchitectureCollector implements RuntimeArchitectureCollector {
    private static final int MAX_CHAINS = 256;
    private static final int MAX_FILTERS = 1024;
    private static final int MAX_MANAGERS = 128;
    private final ApplicationContext applicationContext;
    private final StableIdGenerator graphIdGenerator = new StableIdGenerator();

    public SecurityRuntimeArchitectureCollector(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public String id() { return "security-runtime-architecture"; }

    @Override
    public RuntimeArchitectureContribution collect(String serviceId, CollectionReport collectionReport) {
        String contextId = contextScope(applicationContext);
        List<RuntimeComponent> components = new ArrayList<>();
        List<RuntimeRelationship> relationships = new ArrayList<>();
        List<RuntimeCoverage> coverage = new ArrayList<>();
        List<RuntimeEvidence> evidence = new ArrayList<>();
        List<Fact> facts = collectionReport == null ? List.of() : collectionReport.facts();
        BeanInventory<FilterChainProxy> proxies = singletonBeans(FilterChainProxy.class);
        boolean partial = proxies.instances().size() != proxies.beanCount();
        IdentityHashMap<Filter, String> filterIds = new IdentityHashMap<>();
        Map<String, Set<String>> filterGraphRefs = new HashMap<>();
        List<String> proxyEvidenceIds = new ArrayList<>();
        int chainCount = 0;
        int filterCount = 0;

        for (Map.Entry<String, FilterChainProxy> proxyEntry : proxies.instances().entrySet()) {
            FilterChainProxy proxy = proxyEntry.getValue();
            String proxyBeanName = beanName(proxyEntry.getKey());
            String proxyId = componentId(serviceId, contextId, "FILTER_CHAIN_PROXY", proxyEntry.getKey(), proxy.getClass().getName());
            proxyEvidenceIds.add(proxyId);
            addEvidence(evidence, proxyId, "FilterChainProxy Bean " + proxyEntry.getKey(), "실제 보안 Filter Proxy");
            components.add(new RuntimeComponent(proxyId, "FILTER_CHAIN_PROXY", proxy.getClass().getName(),
                    proxyEntry.getKey(), contextId, null, Map.of(), List.of(), List.of(proxyId)));
            List<SecurityFilterChain> chains;
            try {
                chains = proxy.getFilterChains();
            } catch (RuntimeException exception) {
                partial = true;
                continue;
            }
            if (chains == null || chains.size() > MAX_CHAINS) {
                partial = true;
                continue;
            }
            for (int chainIndex = 0; chainIndex < chains.size(); chainIndex++) {
                SecurityFilterChain chain = chains.get(chainIndex);
                if (chain == null) { partial = true; continue; }
                int chainOrder = chainIndex + 1;
                List<Fact> chainFacts = facts.stream().filter(fact -> "SECURITY_CHAIN".equals(fact.type())
                        && proxyBeanName.equals(fact.attributes().get("proxyBeanName"))
                        && Integer.toString(chainOrder).equals(fact.attributes().get("chainOrder"))).toList();
                Fact chainFact = chainFacts.size() == 1 ? chainFacts.get(0) : null;
                if (chainFacts.size() != 1) partial = true;
                String chainKey = chainFact == null ? "unresolved-chain-" + chainOrder : chainFact.attributes().get("chainKey");
                String matcherClass = "UNKNOWN";
                String chainId = componentId(serviceId, contextId, "SECURITY_FILTER_CHAIN", proxyEntry.getKey(),
                        chainKey + "|" + chainOrder);
                Map<String, String> chainAttributes = new TreeMap<>();
                chainAttributes.put("chainOrder", Integer.toString(chainOrder));
                chainAttributes.put("chainKey", chainKey);
                if (chainFact != null) {
                    matcherClass = chainFact.attributes().getOrDefault("matcherClass", "UNKNOWN");
                    for (String key : List.of("matcherType", "matcherClass", "matcherCondition", "httpMethod", "pathPatternSettings")) {
                        String value = chainFact.attributes().get(key);
                        if (value != null) chainAttributes.put(key, value);
                    }
                }
                addEvidence(evidence, chainId, "FilterChainProxy:" + proxyEntry.getKey() + "[" + chainOrder + "]",
                        "실제 SecurityFilterChain 순서");
                List<String> chainGraphIds = chainFact == null ? List.of()
                        : List.of(graphIdGenerator.generate(serviceId, NodeType.SECURITY_CHAIN, chainFact.subjectKey()));
                components.add(new RuntimeComponent(chainId, "SECURITY_FILTER_CHAIN", chain.getClass().getName(),
                        null, contextId, proxyId, chainAttributes, chainGraphIds, List.of(chainId)));
                relationships.add(relationship(serviceId, contextId, proxyId, chainId, "CONTAINS",
                        Map.of("chainOrder", Integer.toString(chainOrder))));
                chainCount++;

                if (chain instanceof DefaultSecurityFilterChain defaultChain) {
                    RequestMatcher matcher = defaultChain.getRequestMatcher();
                    if (matcher != null) {
                        String matcherId = componentId(serviceId, contextId, "REQUEST_MATCHER", chainKey,
                                matcher.getClass().getName());
                        addEvidence(evidence, matcherId, matcher.getClass().getName(), "SecurityFilterChain의 실제 RequestMatcher");
                        components.add(new RuntimeComponent(matcherId, "REQUEST_MATCHER", matcher.getClass().getName(),
                                null, contextId, null, Map.of("matcherType", value(chainAttributes.get("matcherType"))),
                                chainGraphIds, List.of(matcherId)));
                        relationships.add(relationship(serviceId, contextId, chainId, matcherId, "CONFIGURED_FOR", Map.of()));
                    } else {
                        partial = true;
                    }
                } else {
                    partial = true;
                }

                List<? extends Filter> filters;
                try {
                    filters = chain.getFilters();
                } catch (RuntimeException exception) {
                    partial = true;
                    continue;
                }
                if (filters == null || filterCount + filters.size() > MAX_FILTERS) {
                    partial = true;
                    continue;
                }
                for (int filterIndex = 0; filterIndex < filters.size(); filterIndex++) {
                    Filter filter = filters.get(filterIndex);
                    if (filter == null) { partial = true; continue; }
                    int filterOrder = filterIndex + 1;
                    String filterClass = filter.getClass().getName();
                    String filterId = filterIds.get(filter);
                    List<Fact> filterFacts = facts.stream().filter(fact -> "FILTER_REGISTRATION".equals(fact.type())
                            && "SECURITY".equals(fact.attributes().get("registrationKind"))
                            && proxyBeanName.equals(fact.attributes().get("proxyBeanName"))
                            && chainKey.equals(fact.attributes().get("chainKey"))
                            && Integer.toString(filterOrder).equals(fact.attributes().get("filterOrder"))
                            && filterClass.equals(fact.attributes().get("filterClass"))).toList();
                    List<String> filterGraphIds = filterFacts.stream()
                            .map(fact -> graphIdGenerator.generate(serviceId, NodeType.FILTER, fact.subjectKey()))
                            .sorted().toList();
                    if (filterId == null) {
                        filterId = componentId(serviceId, contextId, "SECURITY_FILTER", chainKey,
                                chainOrder + "|" + filterOrder + "|" + filterClass);
                        filterIds.put(filter, filterId);
                        if (filterFacts.size() != 1) partial = true;
                        Map<String, String> filterAttributes = filterFacts.size() == 1
                                ? new TreeMap<>(filterFacts.get(0).attributes()) : Map.of();
                        addEvidence(evidence, filterId, filterClass, "SecurityFilterChain에 등록된 실제 Filter 객체");
                        components.add(new RuntimeComponent(filterId, "SECURITY_FILTER", filterClass,
                                null, contextId, null, filterAttributes, filterGraphIds, List.of(filterId)));
                        filterGraphRefs.put(filterId, new HashSet<>(filterGraphIds));
                    } else if (filterGraphRefs.containsKey(filterId)) {
                        filterGraphRefs.get(filterId).addAll(filterGraphIds);
                        replaceGraphReferences(components, filterId, filterGraphRefs.get(filterId).stream().sorted().toList());
                    }
                    if (filterFacts.size() != 1) partial = true;
                    relationships.add(relationship(serviceId, contextId, chainId, filterId, "CONTAINS",
                            Map.of("filterOrder", Integer.toString(filterOrder))));
                    filterCount++;
                }
            }
        }

        partial |= collectSecurityBeans(serviceId, contextId, components, relationships, evidence);
        if (!proxies.instances().isEmpty()) partial |= collectHolderStrategy(serviceId, contextId, components, evidence);

        CoverageState state = proxies.beanCount() == 0 ? CoverageState.ABSENT
                : proxies.instances().isEmpty() ? CoverageState.UNKNOWN
                : partial ? CoverageState.PARTIAL : CoverageState.PRESENT;
        String reason = switch (state) {
            case ABSENT -> "FILTER_CHAIN_PROXY_ABSENT";
            case UNKNOWN -> "FILTER_CHAIN_PROXY_NOT_INITIALIZED";
            case PARTIAL -> "SECURITY_RUNTIME_PARTIAL";
            default -> chainCount == 0 ? "FILTER_CHAIN_PROXY_EMPTY" : "SECURITY_RUNTIME_OBSERVED";
        };
        coverage.add(new RuntimeCoverage(id(), "SECURITY", contextId, state, reason,
                proxyEvidenceIds));
        return new RuntimeArchitectureContribution(null, components, relationships, coverage, evidence);
    }

    private boolean collectSecurityBeans(String serviceId, String contextId, List<RuntimeComponent> components,
                                         List<RuntimeRelationship> relationships, List<RuntimeEvidence> evidence) {
        boolean partial = false;
        String applicationContextId = RuntimeArchitectureAssembler.stableId(serviceId, "APPLICATION_CONTEXT",
                contextId, applicationContext.getClass().getName(), applicationContext.getClass().getName());
        BeanInventory<AuthenticationManager> managers = singletonBeans(AuthenticationManager.class);
        IdentityHashMap<AuthenticationProvider, String> providerIds = new IdentityHashMap<>();
        Set<String> addedProviderIds = new HashSet<>();
        for (Map.Entry<String, AuthenticationManager> entry : managers.instances().entrySet()) {
            partial |= collectAuthenticationManager(serviceId, contextId, applicationContextId, entry.getKey(),
                    entry.getValue(), providerIds, addedProviderIds, components, relationships, evidence);
        }
        partial |= managers.instances().size() != managers.beanCount();
        collectConfiguredBeans(serviceId, contextId, applicationContextId, "SECURITY_CONTEXT_REPOSITORY",
                singletonBeans(SecurityContextRepository.class).instances(), components, relationships, evidence);
        collectConfiguredBeans(serviceId, contextId, applicationContextId, "CSRF_TOKEN_REPOSITORY",
                singletonBeans(CsrfTokenRepository.class).instances(), components, relationships, evidence);
        collectConfiguredBeans(serviceId, contextId, applicationContextId, "REQUEST_CACHE",
                singletonBeans(RequestCache.class).instances(), components, relationships, evidence);
        return partial;
    }

    private boolean collectAuthenticationManager(String serviceId, String contextId, String applicationContextId,
                                                 String beanName, AuthenticationManager manager,
                                                 IdentityHashMap<AuthenticationProvider, String> providerIds,
                                                 Set<String> addedProviderIds, List<RuntimeComponent> components,
                                                 List<RuntimeRelationship> relationships, List<RuntimeEvidence> evidence) {
        if (manager == null) return true;
        String managerId = componentId(serviceId, contextId, "AUTHENTICATION_MANAGER", beanName,
                manager.getClass().getName());
        addEvidence(evidence, managerId, beanName, "실제 AuthenticationManager Bean");
        components.add(new RuntimeComponent(managerId, "AUTHENTICATION_MANAGER", manager.getClass().getName(),
                beanName, contextId, applicationContextId, Map.of(), List.of(), List.of(managerId)));
        relationships.add(relationship(serviceId, contextId, applicationContextId, managerId, "CONTAINS", Map.of()));
        if (!(manager instanceof ProviderManager providerManager)) return false;
        boolean partial = false;
        List<AuthenticationProvider> providers = providerManager.getProviders();
        if (providers == null || providers.size() > MAX_MANAGERS) return true;
        for (int index = 0; index < providers.size(); index++) {
            AuthenticationProvider provider = providers.get(index);
            if (provider == null) { partial = true; continue; }
            String providerClass = provider.getClass().getName();
            String providerId = providerIds.get(provider);
            if (providerId == null) {
                providerId = componentId(serviceId, contextId, "AUTHENTICATION_PROVIDER", managerId,
                        index + "|" + providerClass);
                providerIds.put(provider, providerId);
            }
            if (addedProviderIds.add(providerId)) {
                addEvidence(evidence, providerId, providerClass, "ProviderManager에 등록된 실제 AuthenticationProvider");
                components.add(new RuntimeComponent(providerId, "AUTHENTICATION_PROVIDER", providerClass,
                        null, contextId, null, Map.of(), List.of(), List.of(providerId)));
            }
            relationships.add(relationship(serviceId, contextId, managerId, providerId, "USES_COMPONENT",
                    Map.of("registrationOrder", Integer.toString(index + 1))));
        }
        return partial;
    }

    private <T> void collectConfiguredBeans(String serviceId, String contextId, String applicationContextId, String kind,
                                            Map<String, T> beans, List<RuntimeComponent> components,
                                            List<RuntimeRelationship> relationships, List<RuntimeEvidence> evidence) {
        for (Map.Entry<String, T> entry : beans.entrySet()) {
            String className = entry.getValue().getClass().getName();
            String id = componentId(serviceId, contextId, kind, entry.getKey(), className);
            addEvidence(evidence, id, entry.getKey(), "실제 보안 구성 Bean");
            components.add(new RuntimeComponent(id, kind, className, entry.getKey(), contextId, applicationContextId,
                    Map.of(), List.of(), List.of(id)));
            relationships.add(relationship(serviceId, contextId, applicationContextId, id, "CONTAINS", Map.of()));
        }
    }

    private boolean collectHolderStrategy(String serviceId, String contextId, List<RuntimeComponent> components,
                                          List<RuntimeEvidence> evidence) {
        try {
            SecurityContextHolderStrategy strategy = SecurityContextHolder.getContextHolderStrategy();
            String className = strategy.getClass().getName();
            String id = componentId(serviceId, contextId, "SECURITY_CONTEXT_HOLDER_STRATEGY", "static-holder", className);
            addEvidence(evidence, id, className, "실제 SecurityContextHolderStrategy");
            components.add(new RuntimeComponent(id, "SECURITY_CONTEXT_HOLDER_STRATEGY", className,
                    null, contextId, null, Map.of(), List.of(), List.of(id)));
            return false;
        } catch (RuntimeException exception) {
            return true;
        }
    }

    private void replaceGraphReferences(List<RuntimeComponent> components, String componentId, List<String> graphNodeIds) {
        for (int index = 0; index < components.size(); index++) {
            RuntimeComponent item = components.get(index);
            if (!item.id().equals(componentId)) continue;
            components.set(index, new RuntimeComponent(item.id(), item.kind(), item.className(), item.beanName(),
                    item.contextId(), item.parentId(), item.attributes(), graphNodeIds, item.evidenceIds()));
            return;
        }
    }

    private <T> BeanInventory<T> singletonBeans(Class<T> type) {
        Map<String, T> instances = new TreeMap<>();
        int beanCount = 0;
        ApplicationContext current = applicationContext;
        while (current != null) {
            if (current instanceof ConfigurableApplicationContext configurable) {
                ConfigurableListableBeanFactory factory = configurable.getBeanFactory();
                String[] names = factory.getBeanNamesForType(type, false, false);
                beanCount += names.length;
                for (String name : names) {
                    if (!factory.containsSingleton(name)) continue;
                    Object bean = factory.getSingleton(name);
                    if (type.isInstance(bean)) instances.put(contextScope(current) + ":" + name, type.cast(bean));
                }
            }
            current = current.getParent();
        }
        return new BeanInventory<>(instances, beanCount);
    }

    private RuntimeRelationship relationship(String serviceId, String contextId, String sourceId,
                                             String targetId, String kind, Map<String, String> attributes) {
        String structure = sourceId + "|" + targetId + "|" + new TreeMap<>(attributes);
        String id = RuntimeArchitectureAssembler.stableId(serviceId, "RELATIONSHIP", contextId, kind, structure);
        return new RuntimeRelationship(id, sourceId, targetId, kind, RuntimeArchitecture.Confidence.CONFIRMED,
                attributes, List.of());
    }

    private String componentId(String serviceId, String contextId, String kind, String owner, String structure) {
        return RuntimeArchitectureAssembler.stableId(serviceId, kind, contextId, owner, structure);
    }

    private void addEvidence(List<RuntimeEvidence> evidence, String id, String location, String summary) {
        evidence.add(new RuntimeEvidence(id, "RUNTIME", location, summary));
    }

    private String value(String value) { return value == null ? "UNKNOWN" : value; }

    private String beanName(String qualifiedName) {
        int separator = qualifiedName.lastIndexOf(':');
        return separator < 0 ? qualifiedName : qualifiedName.substring(separator + 1);
    }

    private String contextScope(ApplicationContext context) {
        List<String> hierarchy = new ArrayList<>();
        ApplicationContext current = context;
        while (current != null) {
            hierarchy.add(current.getClass().getName());
            current = current.getParent();
        }
        java.util.Collections.reverse(hierarchy);
        String path = "";
        if (context instanceof WebApplicationContext webContext && webContext.getServletContext() != null) {
            try { path = webContext.getServletContext().getContextPath(); }
            catch (RuntimeException exception) { path = "UNKNOWN"; }
        }
        return RuntimeArchitectureAssembler.stableContextId(context.getId(), context.getClass().getName(),
                String.join(">", hierarchy) + "|" + path);
    }

    private record BeanInventory<T>(Map<String, T> instances, int beanCount) {
    }
}
