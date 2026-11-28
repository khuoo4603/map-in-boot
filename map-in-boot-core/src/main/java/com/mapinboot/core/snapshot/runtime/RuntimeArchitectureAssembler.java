package com.mapinboot.core.snapshot.runtime;

import com.mapinboot.core.common.error.ErrorCode;
import com.mapinboot.core.common.error.MapInBootException;
import com.mapinboot.core.collection.model.CollectionReport;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.CoverageState;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.DeploymentMode;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeComponent;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeCoverage;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEnvironment;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEvidence;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeRelationship;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.WebApplicationType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

// Runtime Architecture 조각 병합·정렬·지문 검증
public class RuntimeArchitectureAssembler {
    private static final Set<String> VOLATILE_ATTRIBUTES = Set.of("activePort", "localPort", "runtimePort", "serverPort");

    public RuntimeArchitecture assemble(String serviceId, CollectionReport collectionReport,
                                        List<RuntimeArchitectureCollector> collectors) {
        if (serviceId == null || serviceId.isBlank()) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Runtime Architecture 서비스 식별 정보가 없습니다.");
        }
        List<RuntimeComponent> components = new ArrayList<>();
        List<RuntimeRelationship> relationships = new ArrayList<>();
        List<RuntimeCoverage> coverage = new ArrayList<>();
        List<RuntimeEvidence> evidence = new ArrayList<>();
        RuntimeEnvironment environment = unknownEnvironment();

        for (RuntimeArchitectureCollector collector : collectors) {
            try {
                RuntimeArchitectureContribution contribution = collector.collect(serviceId, collectionReport);
                if (contribution == null) {
                    throw new IllegalStateException("empty architecture contribution");
                }
                if (contribution.environment() != null) {
                    environment = mergeEnvironment(environment, contribution.environment());
                }
                components.addAll(contribution.components());
                relationships.addAll(contribution.relationships());
                coverage.addAll(contribution.coverage());
                evidence.addAll(contribution.evidence());
            } catch (RuntimeException exception) {
                coverage.add(new RuntimeCoverage(collector.id(), "RUNTIME_ARCHITECTURE", "APPLICATION",
                        CoverageState.PARTIAL, "COLLECTOR_FAILED", List.of()));
            }
        }

        List<RuntimeCoverage> mergedCoverage = mergeCoverage(coverage);
        RuntimeArchitecture architecture = new RuntimeArchitecture(environment,
                sorted(components, RuntimeComponent::id), sorted(relationships, RuntimeRelationship::id),
                mergedCoverage,
                sorted(evidence, RuntimeEvidence::id), "pending");
        String fingerprint = fingerprint(architecture);
        RuntimeArchitecture result = new RuntimeArchitecture(environment, architecture.components(),
                architecture.relationships(), architecture.coverage(), architecture.evidence(), fingerprint);
        validate(result);
        return result;
    }

    public static RuntimeArchitecture unknown() {
        RuntimeArchitecture architecture = new RuntimeArchitecture(unknownEnvironment(), List.of(), List.of(),
                List.of(new RuntimeCoverage("starter-runtime-architecture", "APPLICATION", "APPLICATION",
                        CoverageState.UNKNOWN, "COLLECTOR_NOT_CONFIGURED", List.of())), List.of(), "pending");
        return new RuntimeArchitecture(architecture.environment(), architecture.components(), architecture.relationships(),
                architecture.coverage(), architecture.evidence(), fingerprint(architecture));
    }

    public static void validate(RuntimeArchitecture architecture) {
        if (architecture == null || architecture.environment() == null || architecture.environment().webApplicationType() == null
                || architecture.environment().deploymentMode() == null || architecture.architectureFingerprint() == null
                || architecture.architectureFingerprint().isBlank()) {
            invalid("Runtime Architecture 필수 필드가 없습니다.");
        }
        Set<String> evidenceIds = new HashSet<>();
        for (RuntimeEvidence item : architecture.evidence()) {
            if (item == null || blank(item.id()) || blank(item.source()) || blank(item.location()) || blank(item.summary())
                    || !evidenceIds.add(item.id())) invalid("Runtime Evidence가 중복되거나 올바르지 않습니다.");
        }
        Map<String, RuntimeComponent> components = new HashMap<>();
        for (RuntimeComponent item : architecture.components()) {
            if (item == null || blank(item.id()) || blank(item.kind()) || components.putIfAbsent(item.id(), item) != null) {
                invalid("Runtime Component가 중복되거나 올바르지 않습니다.");
            }
            validateEvidenceRefs(item.evidenceIds(), evidenceIds);
        }
        Set<String> relationshipIds = new HashSet<>();
        for (RuntimeRelationship item : architecture.relationships()) {
            if (item == null || blank(item.id()) || blank(item.sourceId()) || blank(item.targetId()) || blank(item.kind())
                    || item.confidence() == null || !relationshipIds.add(item.id())
                    || !components.containsKey(item.sourceId()) || !components.containsKey(item.targetId())) {
                invalid("Runtime Relationship 참조가 올바르지 않습니다.");
            }
            validateEvidenceRefs(item.evidenceIds(), evidenceIds);
        }
        Set<String> coverageKeys = new HashSet<>();
        for (RuntimeCoverage item : architecture.coverage()) {
            if (item == null || blank(item.collectorId()) || blank(item.area()) || blank(item.scope())
                    || item.state() == null || blank(item.reasonCode())
                    || !coverageKeys.add(item.collectorId() + "|" + item.area() + "|" + item.scope())) {
                invalid("Runtime Coverage가 중복되거나 올바르지 않습니다.");
            }
            validateEvidenceRefs(item.evidenceIds(), evidenceIds);
        }
        for (RuntimeComponent item : architecture.components()) {
            if (item.parentId() != null && !components.containsKey(item.parentId())) {
                invalid("Runtime Component 상위 참조가 없습니다.");
            }
            for (String graphNodeId : item.graphNodeIds()) if (blank(graphNodeId)) invalid("Runtime Graph 참조가 비어 있습니다.");
        }
        detectParentCycles(components);
        if (!architecture.architectureFingerprint().equals(fingerprint(architecture))) {
            invalid("Runtime Architecture Fingerprint가 일치하지 않습니다.");
        }
    }

    public static String fingerprint(RuntimeArchitecture architecture) {
        StringBuilder canonical = new StringBuilder();
        RuntimeEnvironment env = architecture.environment();
        canonical.append(env.webApplicationType()).append('|').append(value(env.serverKind())).append('|')
                .append(value(env.serverClassName())).append('|').append(env.deploymentMode()).append('\n');
        new TreeMap<>(env.frameworkVersions()).forEach((key, value) -> canonical.append("V|").append(key).append('=').append(value).append('\n'));
        architecture.components().stream().sorted(Comparator.comparing(RuntimeComponent::id)).forEach(component -> {
            canonical.append("C|").append(component.id()).append('|').append(component.kind()).append('|')
                    .append(value(component.className())).append('|').append(value(component.beanName())).append('|')
                    .append(value(component.contextId())).append('|').append(value(component.parentId()));
            stableAttributes(component.attributes()).forEach((key, value) -> canonical.append('|').append(key).append('=').append(value));
            canonical.append('\n');
        });
        architecture.relationships().stream().sorted(Comparator.comparing(RuntimeRelationship::id)).forEach(relation -> {
            canonical.append("R|").append(relation.id()).append('|').append(relation.sourceId()).append('|')
                    .append(relation.targetId()).append('|').append(relation.kind()).append('|').append(relation.confidence());
            stableAttributes(relation.attributes()).forEach((key, value) -> canonical.append('|').append(key).append('=').append(value));
            canonical.append('\n');
        });
        architecture.coverage().stream().sorted(Comparator.comparing(item -> item.collectorId() + "|" + item.area() + "|" + item.scope()))
                .forEach(item -> canonical.append("S|").append(item.collectorId()).append('|').append(item.area()).append('|')
                        .append(item.scope()).append('|').append(item.state()).append('|').append(item.reasonCode()).append('\n'));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 미지원 환경", exception);
        }
    }

    public static String stableId(String serviceId, String kind, String contextId, String owner, String structuralKey) {
        if (blank(serviceId) || blank(kind) || blank(structuralKey)) {
            throw new MapInBootException(ErrorCode.INVALID_CONFIG, "Runtime Component 식별 정보가 없습니다.");
        }
        String canonical = List.of(serviceId, kind, value(contextId), value(owner), structuralKey).stream()
                .map(part -> part.length() + ":" + part).reduce("", String::concat);
        try {
            return "runtime-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new MapInBootException(ErrorCode.HASH_FAILED, "Runtime Architecture ID 계산에 실패했습니다.", exception);
        }
    }

    public static String stableContextId(String contextId, String contextClassName, String structuralScope) {
        if (blank(contextId) || blank(contextClassName) || !contextId.startsWith(contextClassName + "@")) {
            return contextId;
        }
        return contextClassName + "|" + value(structuralScope);
    }

    private static RuntimeEnvironment mergeEnvironment(RuntimeEnvironment current, RuntimeEnvironment next) {
        WebApplicationType type = current.webApplicationType() == WebApplicationType.UNKNOWN
                ? next.webApplicationType() : current.webApplicationType();
        String kind = prefer(current.serverKind(), next.serverKind());
        String className = prefer(current.serverClassName(), next.serverClassName());
        DeploymentMode mode = current.deploymentMode() == DeploymentMode.UNKNOWN
                ? next.deploymentMode() : current.deploymentMode();
        Map<String, String> versions = new TreeMap<>(current.frameworkVersions());
        versions.putAll(next.frameworkVersions());
        return new RuntimeEnvironment(type, kind, className, mode, versions);
    }

    private static List<RuntimeCoverage> mergeCoverage(List<RuntimeCoverage> entries) {
        Map<String, List<RuntimeCoverage>> grouped = new TreeMap<>();
        for (RuntimeCoverage item : entries) grouped.computeIfAbsent(item.area() + "|" + item.scope(), ignored -> new ArrayList<>()).add(item);
        List<RuntimeCoverage> merged = new ArrayList<>();
        for (Map.Entry<String, List<RuntimeCoverage>> entry : grouped.entrySet()) {
            List<RuntimeCoverage> values = entry.getValue();
            Set<CoverageState> resolved = new HashSet<>();
            values.stream().map(RuntimeCoverage::state).filter(state -> state != CoverageState.UNKNOWN).forEach(resolved::add);
            CoverageState state;
            String reason;
            if (resolved.contains(CoverageState.PARTIAL)) {
                state = CoverageState.PARTIAL;
                reason = "COLLECTOR_PARTIAL";
            } else if (resolved.size() > 1) {
                state = CoverageState.UNKNOWN;
                reason = "COLLECTOR_CONFLICT";
            } else if (resolved.isEmpty()) {
                state = CoverageState.UNKNOWN;
                reason = values.get(0).reasonCode();
            } else {
                state = resolved.iterator().next();
                reason = values.stream().filter(item -> item.state() == state)
                        .map(RuntimeCoverage::reasonCode).sorted().findFirst().orElse("OBSERVED");
            }
            String collectorIds = values.stream().map(RuntimeCoverage::collectorId).distinct().sorted()
                    .collect(java.util.stream.Collectors.joining(","));
            List<String> evidenceIds = values.stream().flatMap(item -> item.evidenceIds().stream())
                    .distinct().sorted().toList();
            RuntimeCoverage sample = values.get(0);
            merged.add(new RuntimeCoverage(collectorIds, sample.area(), sample.scope(), state, reason, evidenceIds));
        }
        return sorted(merged, item -> item.area() + "|" + item.scope());
    }

    private static RuntimeEnvironment unknownEnvironment() {
        return new RuntimeEnvironment(WebApplicationType.UNKNOWN, "UNKNOWN", null, DeploymentMode.UNKNOWN, Map.of());
    }

    private static Map<String, String> stableAttributes(Map<String, String> attributes) {
        Map<String, String> stable = new TreeMap<>();
        attributes.forEach((key, value) -> { if (!VOLATILE_ATTRIBUTES.contains(key)) stable.put(key, value); });
        return stable;
    }

    private static void validateEvidenceRefs(List<String> ids, Set<String> evidenceIds) {
        for (String id : ids) if (!evidenceIds.contains(id)) invalid("Runtime Evidence 참조가 없습니다.");
    }

    private static void detectParentCycles(Map<String, RuntimeComponent> components) {
        for (RuntimeComponent item : components.values()) {
            Set<String> seen = new HashSet<>();
            RuntimeComponent current = item;
            while (current.parentId() != null) {
                if (!seen.add(current.id())) invalid("Runtime Component 상위 관계 순환입니다.");
                current = components.get(current.parentId());
            }
        }
    }

    private static <T> List<T> sorted(List<T> values, java.util.function.Function<T, String> key) {
        return values.stream().sorted(Comparator.comparing(key)).toList();
    }

    private static String prefer(String first, String second) {
        return first == null || first.isBlank() || "UNKNOWN".equals(first) ? second : first;
    }

    private static String value(String input) { return input == null ? "" : input; }
    private static boolean blank(String input) { return input == null || input.isBlank(); }

    private static void invalid(String message) {
        throw new MapInBootException(ErrorCode.INVALID_SNAPSHOT, message);
    }
}
