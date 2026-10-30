package com.mapinboot.core.collection;

import java.util.Objects;
import java.util.Set;

// 수집 Adapter 공통 반환 계약
public abstract class AbstractCollectorAdapter implements CollectorAdapter {
    private final String adapterId;
    private final String description;
    private final Set<String> supportedTypes;

    protected AbstractCollectorAdapter(String adapterId, String description, Set<String> supportedTypes) {
        if (adapterId == null || adapterId.isBlank()) {
            throw new IllegalArgumentException("Adapter ID must not be blank");
        }
        this.adapterId = adapterId;
        this.description = Objects.requireNonNull(description);
        this.supportedTypes = Set.copyOf(Objects.requireNonNull(supportedTypes));
    }

    @Override
    public final String id() {
        return adapterId;
    }

    @Override
    public final String getDescription() {
        return description;
    }

    @Override
    public final Set<String> getSupportedTypes() {
        return supportedTypes;
    }

    @Override
    public final String toString() {
        return getClass().getSimpleName()
                + "[id=" + adapterId
                + ", supportedTypes=" + supportedTypes
                + ", description=" + description + "]";
    }
}
