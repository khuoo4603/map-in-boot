package com.mapinboot.core.snapshot.runtime;

import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeComponent;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeCoverage;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEnvironment;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeEvidence;
import com.mapinboot.core.snapshot.runtime.RuntimeArchitecture.RuntimeRelationship;
import java.util.List;

// 영역별 Collector가 제공하는 불변 구조 기여분
public record RuntimeArchitectureContribution(
        RuntimeEnvironment environment,
        List<RuntimeComponent> components,
        List<RuntimeRelationship> relationships,
        List<RuntimeCoverage> coverage,
        List<RuntimeEvidence> evidence
) {
    public RuntimeArchitectureContribution {
        components = List.copyOf(components);
        relationships = List.copyOf(relationships);
        coverage = List.copyOf(coverage);
        evidence = List.copyOf(evidence);
    }

    public static RuntimeArchitectureContribution empty() {
        return new RuntimeArchitectureContribution(null, List.of(), List.of(), List.of(), List.of());
    }
}
