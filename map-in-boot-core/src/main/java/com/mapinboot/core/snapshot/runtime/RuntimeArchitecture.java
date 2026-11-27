package com.mapinboot.core.snapshot.runtime;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// 실제 기동 환경에서 확인한 프레임워크 객체와 구성 관계
public record RuntimeArchitecture(
        RuntimeEnvironment environment,
        List<RuntimeComponent> components,
        List<RuntimeRelationship> relationships,
        List<RuntimeCoverage> coverage,
        List<RuntimeEvidence> evidence,
        String architectureFingerprint
) {
    public RuntimeArchitecture {
        components = List.copyOf(components);
        relationships = List.copyOf(relationships);
        coverage = List.copyOf(coverage);
        evidence = List.copyOf(evidence);
    }

    public enum WebApplicationType {
        SERVLET, REACTIVE, NON_WEB, UNKNOWN
    }

    public enum DeploymentMode {
        EMBEDDED, EXTERNAL, UNKNOWN, NOT_APPLICABLE
    }

    public enum CoverageState {
        PRESENT, ABSENT, PARTIAL, UNKNOWN, NOT_SUPPORTED
    }

    public enum Confidence {
        CONFIRMED, INFERRED, UNKNOWN
    }

    public record RuntimeEnvironment(
            WebApplicationType webApplicationType,
            String serverKind,
            String serverClassName,
            DeploymentMode deploymentMode,
            Map<String, String> frameworkVersions
    ) {
        public RuntimeEnvironment {
            frameworkVersions = immutableMap(frameworkVersions);
        }
    }

    public record RuntimeComponent(
            String id,
            String kind,
            String className,
            String beanName,
            String contextId,
            String parentId,
            Map<String, String> attributes,
            List<String> graphNodeIds,
            List<String> evidenceIds
    ) {
        public RuntimeComponent {
            attributes = immutableMap(attributes);
            graphNodeIds = List.copyOf(graphNodeIds);
            evidenceIds = List.copyOf(evidenceIds);
        }
    }

    public record RuntimeRelationship(
            String id,
            String sourceId,
            String targetId,
            String kind,
            Confidence confidence,
            Map<String, String> attributes,
            List<String> evidenceIds
    ) {
        public RuntimeRelationship {
            attributes = immutableMap(attributes);
            evidenceIds = List.copyOf(evidenceIds);
        }
    }

    public record RuntimeCoverage(
            String collectorId,
            String area,
            String scope,
            CoverageState state,
            String reasonCode,
            List<String> evidenceIds
    ) {
        public RuntimeCoverage {
            evidenceIds = List.copyOf(evidenceIds);
        }
    }

    public record RuntimeEvidence(
            String id,
            String source,
            String location,
            String summary
    ) {
    }

    public static Map<String, String> immutableMap(Map<String, String> values) {
        return values == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }
}
